"""Atomic plan updates for stems assigned by their position in Graphic."""

from hashlib import sha256
from json import dumps
from uuid import uuid4

from django.core.serializers.json import DjangoJSONEncoder
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import serializers

from farm.history import _serialize_instance
from farm.history.project_restore import ensure_project_checkpoint
from farm.history.records import revision_batch, start_batch_operation
from farm.models import BatchOperation, EntityRevision, PlantingPlan
from farm.services.crop_inheritance import lock_crop_project
from farm.services.seasons import PLANTING_PLAN_COPY_FIELDS
from farm.services.tasks import generate_plan_tasks

from .individual_graphic import (
    GraphicParentSerializer,
    GraphicPointSerializer,
    GraphicSceneSerializer,
    IndividualGraphicConflict,
    lock_graphic_scene,
)
from .individual_planting import (
    MAX_INDIVIDUAL_POSITIONS,
    IndividualPlantPositionSerializer,
    PlacementConflict,
    _normalize_positions,
)


class GraphicPlacementPointSerializer(GraphicPointSerializer):
    id = serializers.UUIDField(required=False)


class GraphicPlacementRequestSerializer(serializers.Serializer):
    request_id = serializers.UUIDField()
    scene = GraphicSceneSerializer()
    points = GraphicPlacementPointSerializer(
        many=True, allow_empty=False, max_length=MAX_INDIVIDUAL_POSITIONS
    )
    plan = serializers.IntegerField(min_value=1, required=False)
    placement_updated_at = serializers.DateTimeField(required=False)
    individual_count = serializers.IntegerField(
        min_value=1, max_value=2_147_483_647, allow_null=True, required=False,
    )
    pending_parent = GraphicParentSerializer(required=False)
    existing_positions = IndividualPlantPositionSerializer(
        many=True, required=False, max_length=MAX_INDIVIDUAL_POSITIONS
    )
    crop = serializers.IntegerField(min_value=1, required=False)
    planting_date = serializers.DateField(required=False)
    cultivation_type = serializers.ChoiceField(
        choices=PlantingPlan.CULTIVATION_TYPE_CHOICES, required=False
    )
    estimated_canopy_diameter_m = serializers.DecimalField(
        max_digits=7,
        decimal_places=2,
        allow_null=True,
        required=False,
    )

    def validate(self, attrs):
        crop_inputs = {'crop', 'planting_date', 'cultivation_type'}
        if 'plan' in attrs:
            unexpected = (crop_inputs | {'pending_parent'}) & attrs.keys()
            if 'placement_updated_at' not in attrs or unexpected:
                raise serializers.ValidationError(
                    'Supply the current plan version when filling its positions.'
                )
        else:
            if not crop_inputs <= attrs.keys() or 'existing_positions' in attrs:
                raise serializers.ValidationError(
                    'Choose a crop, planting date and cultivation type.'
                )
            if any('id' in point for point in attrs['points']):
                raise serializers.ValidationError({
                    'points': 'New positions cannot specify a plant ID.',
                })
            if ('pending_parent' in attrs) != (attrs.get('individual_count') is not None):
                raise serializers.ValidationError(
                    'Choose which parent keeps the unpositioned plants.'
                )
        canopy = attrs.get('estimated_canopy_diameter_m')
        if canopy is not None and canopy <= 0:
            raise serializers.ValidationError(
                {'estimated_canopy_diameter_m': 'Enter a positive canopy diameter.'}
            )
        return attrs


class GraphicMoveRequestSerializer(serializers.Serializer):
    scene = GraphicSceneSerializer()
    point = GraphicPointSerializer()
    stem = serializers.UUIDField()
    placement_updated_at = serializers.DateTimeField()


def _group_points(scene, points):
    groups = {}
    for point in points:
        area, stem = scene.resolve(point)
        if 'id' in point:
            stem['id'] = str(point['id'])
        key = area.parent['kind'], area.entity.pk
        groups.setdefault(key, []).append(stem)
    return groups


def _plan_parent(plan):
    if plan.individual_bed:
        return 'bed', plan.bed_id
    if plan.parcel_id is not None:
        return 'field', plan.parcel_id
    return 'location', plan.site_id


def _parent_options(key):
    kind, pk = key
    mode = {
        'bed': PlantingPlan.PLACEMENT_BED,
        'field': PlantingPlan.PLACEMENT_PARCEL,
        'location': PlantingPlan.PLACEMENT_SITE,
    }[kind]
    return {
        'placement_mode': mode,
        'bed': pk if kind == 'bed' else None,
        'parcel': pk if kind == 'field' else None,
        'site': pk if kind == 'location' else None,
    }


def _parent_columns(key):
    options = _parent_options(key)
    return {
        'bed_id': options['bed'],
        'parcel_id': options['parcel'],
        'site_id': options['site'],
        'individual_bed': key[0] == 'bed',
    }


def _require_safe_split(plan):
    actuals = any(getattr(plan, field) is not None for field in plan.ACTUAL_DATE_FIELDS)
    protected_tasks = plan.tasks.filter(deleted_at__isnull=True).exclude(
        origin='automatic', status='pending'
    )
    if (
        actuals
        or plan.harvest_occurrence_actuals
        or plan.harvest_allocations.exists()
        or plan.crop_losses.exists()
        or plan.attachments.exists()
        or protected_tasks.exists()
    ):
        raise IndividualGraphicConflict('individual_split_protected')


def _update_plan(view, plan, **values):
    before = _serialize_instance(plan)
    for name, value in values.items():
        setattr(plan, name, value)
    plan.updated_by = view.request.user
    plan.save(update_fields=[*values, 'updated_by', 'updated_at'])
    view.record_revision(plan, EntityRevision.ACTION_UPDATED, previous_snapshot=before)
    return plan


def _split_plan(view, plan, key, stems, *, exact_count, canopy):
    values = {field: getattr(plan, field) for field in PLANTING_PLAN_COPY_FIELDS}
    values.update(_parent_columns(key))
    values.update(
        individual_count=len(stems) if exact_count is not None else None,
        estimated_canopy_diameter_m=canopy,
        individual_positions=stems,
        harvest_window_overrides=plan.harvest_window_overrides,
        parcel_rotation_basis={},
        project_id=plan.project_id,
        season_id=plan.season_id,
        created_by=view.request.user,
        updated_by=view.request.user,
    )
    result = PlantingPlan.objects.create(**values)
    # Regenerate plan-specific automatic tasks. Existing task records stay with the source.
    generate_plan_tasks(result)
    view.record_revision(result, EntityRevision.ACTION_CREATED)
    return result


def _new_plans(view, data, groups):
    metadata = {
        field: data[field]
        for field in (
            'crop',
            'planting_date',
            'cultivation_type',
            'estimated_canopy_diameter_m',
        )
        if field in data
    }
    pending = 0
    parent = None
    exact = data.get('individual_count')
    if exact is not None:
        pending = exact - sum(map(len, groups.values()))
        if pending < 0:
            raise IndividualGraphicConflict('individual_count_exhausted')
        parent = data['pending_parent']['kind'], data['pending_parent']['id']
        if pending:
            groups.setdefault(parent, [])
    plans = []
    for key, stems in groups.items():
        count = len(stems) + (pending if key == parent else 0)
        serializer = view.get_serializer(
            data={
                **metadata, **_parent_options(key), 'individual_positions': stems,
                'individual_count': count if exact is not None else None,
            }
        )
        serializer.is_valid(raise_exception=True)
        view.perform_create(serializer)
        plans.append(serializer.instance)
    return plans


def _fill_plan(view, source, groups, data):
    moved_ids = [stem['id'] for stems in groups.values() for stem in stems if 'id' in stem]
    previous_ids = {stem['id'] for stem in source.individual_positions}
    if len(moved_ids) != len(set(moved_ids)) or not previous_ids.issuperset(moved_ids):
        raise PlacementConflict()
    old_positions = [stem for stem in source.individual_positions if stem['id'] not in moved_ids]
    if 'existing_positions' in data:
        old_positions = _normalize_positions(
            data['existing_positions'], old_positions, source.placement_parent
        )
    source_key = _plan_parent(source)
    within_parent = groups.pop(source_key, [])
    cross_parent_count = sum(len(stems) for stems in groups.values())
    added = len(within_parent) + cross_parent_count
    exact_count = data.get('individual_count', source.individual_count)
    canopy = data.get('estimated_canopy_diameter_m', source.estimated_canopy_diameter_m)
    if exact_count is not None and exact_count < len(old_positions) + added:
        raise IndividualGraphicConflict('individual_count_exhausted')
    if len(old_positions) + len(within_parent) > MAX_INDIVIDUAL_POSITIONS:
        raise IndividualGraphicConflict('individual_count_exhausted')
    parent_updates = {}
    if (
        groups
        and not old_positions
        and not within_parent
        and exact_count in (None, cross_parent_count)
    ):
        # Keep the source ID when the source has no remaining plants at its old parent.
        retained_parent = next(iter(groups))
        within_parent = groups.pop(retained_parent)
        cross_parent_count -= len(within_parent)
        parent_updates = _parent_columns(retained_parent)
    if groups:
        _require_safe_split(source)
    plans = [
        _split_plan(view, source, key, _with_ids(stems), exact_count=exact_count, canopy=canopy)
        for key, stems in groups.items()
    ]
    values = {
        'individual_positions': [*old_positions, *_with_ids(within_parent)],
        'estimated_canopy_diameter_m': canopy,
        'individual_count': exact_count - cross_parent_count if exact_count is not None else None,
        **parent_updates,
    }
    plans.insert(0, _update_plan(view, source, **values))
    return plans


def _with_ids(stems):
    return [stem if 'id' in stem else {**stem, 'id': str(uuid4())} for stem in stems]


def _request_hash(data):
    return sha256(dumps(data, cls=DjangoJSONEncoder, sort_keys=True).encode()).hexdigest()


def _completed_plans(existing, project, user, expected_hash):
    if (
        existing.project_id != project.pk
        or existing.initiated_by_id != user.pk
        or existing.operation_type != BatchOperation.TYPE_INDIVIDUAL_PLACEMENT
        or not existing.completed_at
        or existing.context.get('_request_hash') != expected_hash
    ):
        raise IndividualGraphicConflict('individual_request_changed')
    return list(PlantingPlan.objects.filter(project=project, pk__in=existing.context['plans']))


def save_graphic_placement(view, data, source):
    project, user = view.request.active_project, view.request.user
    lock_crop_project(project.pk)
    expected_hash = _request_hash(data)
    previous = BatchOperation.objects.filter(request_id=data['request_id']).first()
    if previous is not None:
        return _completed_plans(previous, project, user, expected_hash)
    scene = lock_graphic_scene(project, data['scene'])
    if source is not None:
        _check_source(source, scene, data['placement_updated_at'])
    pending = data.get('pending_parent')
    if pending and not any(
        area.parent == pending for area in (
            scene.site, *scene.parcels.values(),
            *(bed for beds in scene.beds_by_field.values() for bed in beds),
        )
    ):
        raise IndividualGraphicConflict('individual_geometry_changed')
    groups = _group_points(scene, data['points'])
    ensure_project_checkpoint(project)
    try:
        with transaction.atomic():
            batch = start_batch_operation(
                project=project,
                operation_type=BatchOperation.TYPE_INDIVIDUAL_PLACEMENT,
                request_id=data['request_id'],
                initiated_by_id=user.pk,
            )
    except IntegrityError as exc:
        raise IndividualGraphicConflict('individual_request_changed') from exc
    with revision_batch(batch):
        plans = (
            _new_plans(view, data, groups)
            if source is None
            else _fill_plan(view, source, groups, data)
        )
    batch.context = {'plans': [plan.pk for plan in plans], '_request_hash': expected_hash}
    batch.completed_at = timezone.now()
    batch.save(update_fields=['context', 'completed_at'])
    return plans


def _check_source(plan, scene, expected):
    if (
        not plan.is_individual
        or plan.growing_area_location != scene.site.entity
        or plan.updated_at != expected
    ):
        raise PlacementConflict()


def move_graphic_stem(view, plan, data):
    project = view.request.active_project
    lock_crop_project(project.pk)
    scene = lock_graphic_scene(project, data['scene'])
    _check_source(plan, scene, data['placement_updated_at'])
    area, stem = scene.resolve(data['point'])
    stem['id'] = str(data['stem'])
    if not any(item['id'] == stem['id'] for item in plan.individual_positions):
        raise PlacementConflict()
    key = area.parent['kind'], area.entity.pk
    others = [item for item in plan.individual_positions if item['id'] != stem['id']]
    if key == _plan_parent(plan):
        updated = [stem if item['id'] == stem['id'] else item for item in plan.individual_positions]
        return [_update_plan(view, plan, individual_positions=updated)]
    if plan.individual_total == 1:
        return [_update_plan(view, plan, individual_positions=[stem], **_parent_columns(key))]
    _require_safe_split(plan)
    ensure_project_checkpoint(project)
    batch = start_batch_operation(
        project=project,
        operation_type=BatchOperation.TYPE_INDIVIDUAL_PLACEMENT,
        initiated_by_id=view.request.user.pk,
    )
    with revision_batch(batch):
        split = _split_plan(
            view, plan, key, [stem], exact_count=plan.individual_count,
            canopy=plan.estimated_canopy_diameter_m,
        )
        values = {'individual_positions': others}
        if plan.individual_count is not None:
            values['individual_count'] = plan.individual_count - 1
        _update_plan(view, plan, **values)
    return [plan, split]
