"""Atomic removal of saved individual plants or only their positions (#1727)."""

from django.db import IntegrityError, transaction
from django.db.models import QuerySet
from django.utils import timezone
from rest_framework import serializers

from farm.history.project_restore import ensure_project_checkpoint
from farm.history.records import revision_batch, start_batch_operation
from farm.models import BatchOperation, PlantingPlan
from farm.services.tasks import synchronize_plan_tasks

from .individual_graphic import IndividualGraphicConflict
from .individual_graphic_writes import _request_hash, _update_plan
from .individual_planting import MAX_INDIVIDUAL_POSITIONS, PlacementConflict

MAX_REMOVAL_PLANS = 100
REMOVE_PLANT = 'plant'
REMOVE_POSITION = 'position'


class IndividualRemovalPlanSerializer(serializers.Serializer):
    plan = serializers.IntegerField(min_value=1)
    placement_updated_at = serializers.DateTimeField()
    stems = serializers.ListField(
        child=serializers.UUIDField(), allow_empty=False, max_length=MAX_INDIVIDUAL_POSITIONS,
    )


class IndividualRemovalRequestSerializer(serializers.Serializer):
    """One validated removal: either the plants themselves or only their positions."""

    request_id = serializers.UUIDField()
    mode = serializers.ChoiceField(choices=[REMOVE_PLANT, REMOVE_POSITION])
    plans = IndividualRemovalPlanSerializer(
        many=True, allow_empty=False, max_length=MAX_REMOVAL_PLANS,
    )

    def validate_plans(self, plans: list[dict]) -> list[dict]:
        ids = [item['plan'] for item in plans]
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError('Each planting plan may appear only once.')
        for item in plans:
            if len(item['stems']) != len(set(item['stems'])):
                raise serializers.ValidationError('Each stem may appear only once.')
        return plans


def has_recorded_outcomes(plan: PlantingPlan) -> bool:
    """Harvests and losses are actual records: a planned-total correction must not rewrite them."""
    return (
        bool(plan.harvest_occurrence_actuals)
        or plan.harvest_allocations.exists()
        or plan.crop_losses.exists()
    )


def _planned_change(
    plan: PlantingPlan, stems: set[str], mode: str,
) -> tuple[list[dict], int | None]:
    positions = plan.individual_positions or []
    remaining = [stem for stem in positions if str(stem['id']) not in stems]
    removed = len(positions) - len(remaining)
    if not plan.is_individual or removed != len(stems):
        raise PlacementConflict()
    if mode == REMOVE_POSITION:
        # The plant stays planned: the exact total keeps every removed position as pending.
        return remaining, plan.individual_total
    if plan.individual_total - removed < 1:
        raise IndividualGraphicConflict('individual_removal_last_plant')
    if has_recorded_outcomes(plan):
        raise IndividualGraphicConflict('individual_removal_protected')
    return remaining, None if plan.individual_count is None else plan.individual_count - removed


def _completed_removal(existing: BatchOperation, project, user, expected_hash: str) -> list[int]:
    if (
        existing.project_id != project.pk
        or existing.initiated_by_id != user.pk
        or existing.operation_type != BatchOperation.TYPE_INDIVIDUAL_REMOVAL
        or not existing.completed_at
        or existing.context.get('_request_hash') != expected_hash
    ):
        raise IndividualGraphicConflict('individual_request_changed')
    return list(existing.context['plans'])


def remove_individual_stems(view, data: dict, visible: QuerySet[PlantingPlan]) -> list[int]:
    """Validate every plan first, then save all of them as one reversible batch, or none."""
    project, user = view.request.active_project, view.request.user
    expected_hash = _request_hash(data)
    previous = BatchOperation.objects.filter(request_id=data['request_id']).first()
    if previous is not None:
        return _completed_removal(previous, project, user, expected_hash)
    ids = sorted(item['plan'] for item in data['plans'])
    locked = {
        plan.pk: plan for plan in PlantingPlan.objects.select_for_update()
        .filter(project=project, pk__in=ids).order_by('pk')
    }
    visible_ids = set(visible.filter(pk__in=ids).values_list('pk', flat=True))
    if len(locked) != len(ids) or visible_ids != set(ids):
        raise PlacementConflict()
    updates = []
    for item in data['plans']:
        plan = locked[item['plan']]
        if plan.updated_at != item['placement_updated_at']:
            raise PlacementConflict()
        stems = {str(stem) for stem in item['stems']}
        remaining, count = _planned_change(plan, stems, data['mode'])
        updates.append((plan, remaining, count))
    ensure_project_checkpoint(project)
    try:
        with transaction.atomic():
            batch = start_batch_operation(
                project=project,
                operation_type=BatchOperation.TYPE_INDIVIDUAL_REMOVAL,
                request_id=data['request_id'],
                initiated_by_id=user.pk,
            )
    except IntegrityError as exc:
        raise IndividualGraphicConflict('individual_request_changed') from exc
    with revision_batch(batch):
        for plan, remaining, count in updates:
            _update_plan(view, plan, individual_positions=remaining, individual_count=count)
            synchronize_plan_tasks(plan)
    batch.context = {
        'plans': ids,
        'removed_count': sum(len(item['stems']) for item in data['plans']),
        'mode': data['mode'],
        '_request_hash': expected_hash,
    }
    batch.completed_at = timezone.now()
    batch.save(update_fields=['context', 'completed_at'])
    return ids
