"""API endpoints for the planning domain (planting plans, tasks, yield calendar)."""

import logging
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from django.db.models import Count
from django.utils.dateparse import parse_date
from drf_spectacular.utils import extend_schema, extend_schema_view
from rest_framework import generics, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from config.languages import resolve_request_language
from config.responses import api_error_response
from farm.agent_api.schema import SEASON_HEADER_PARAMETER
from farm.common.mixins import ProjectRevisionMixin, ProjectScopedMixin
from farm.history import _serialize_instance
from farm.models import Bed, Crop, EntityRevision, PlantingPlan, Season, Task
from farm.project_context import get_active_project_or_400, resolve_season_id_from_request
from farm.services.bed_capacity import (
    BedCapacity,
    HarvestOverlapIndex,
    SuccessionRule,
    calculate_bed_capacity,
)
from farm.services.crop_display import format_crop_label
from farm.services.crop_rotation import RotationService, suggest_beds
from farm.services.yield_calendar import build_yield_calendar, build_yield_calendar_for_season

from .serializers import PlantingPlanSerializer, TaskSerializer

logger = logging.getLogger(__name__)


def _parse_remaining_area_params(query_params) -> tuple[dict | None, str | None]:
    """Parse/validate the remaining-area query parameters.

    ``bed_id`` and ``start_date`` are required. Without ``end_date`` the period
    ends where a saved plan of ``crop_id`` would end (its effective harvest
    end), else on ``start_date``; without ``harvest_start_date`` the harvest
    starts where it would for ``crop_id``. ``area_sqm`` (the plan's area) is
    only needed for the harvest overlaps.

    Returns (params, None) on success or (None, error_detail) on failure.
    """
    bed_id_param = query_params.get('bed_id')
    start_date_param = query_params.get('start_date')
    end_date_param = query_params.get('end_date')

    if not bed_id_param or not start_date_param:
        return None, 'bed_id and start_date are required.'

    try:
        bed_id = int(bed_id_param)
    except ValueError:
        return None, 'bed_id must be an integer.'

    start_date = parse_date(start_date_param)
    end_date = parse_date(end_date_param) if end_date_param else None
    if start_date is None or (end_date_param and end_date is None):
        return None, 'start_date and end_date must use YYYY-MM-DD format.'

    harvest_start_param = query_params.get('harvest_start_date')
    harvest_start_date = parse_date(harvest_start_param) if harvest_start_param else None
    if harvest_start_param and harvest_start_date is None:
        return None, 'harvest_start_date must use YYYY-MM-DD format.'

    exclude_plan_id, error = _parse_optional_int(query_params.get('exclude_plan_id'), 'exclude_plan_id')
    if error:
        return None, error
    crop_id, error = _parse_optional_int(query_params.get('crop_id'), 'crop_id')
    if error:
        return None, error
    area_sqm, error = _parse_optional_decimal(query_params.get('area_sqm'), 'area_sqm')
    if error:
        return None, error

    return {
        'bed_id': bed_id,
        'start_date': start_date,
        'end_date': end_date,
        'harvest_start_date': harvest_start_date,
        'exclude_plan_id': exclude_plan_id,
        'crop_id': crop_id,
        'area_sqm': area_sqm,
    }, None


def _parse_optional_decimal(value: str | None, name: str) -> tuple[Decimal | None, str | None]:
    if not value:
        return None, None
    try:
        parsed = Decimal(value)
    except InvalidOperation:
        return None, f'{name} must be a number.'
    if not parsed.is_finite() or parsed < 0:
        return None, f'{name} must be a non-negative number.'
    return parsed, None


def _derive_harvest_dates(
    crop: Crop | None,
    planting_date: date,
    project,
    general_crop_index=None,
) -> tuple[date | None, date | None]:
    """Harvest start and end of a saved plan of ``crop`` planted on ``planting_date``."""
    if crop is None:
        return None, None
    draft = PlantingPlan(crop=crop, planting_date=planting_date, project=project)
    return draft.calculate_effective_harvest_dates(general_crop_index)


def _derive_plan_end(
    crop: Crop | None,
    planting_date: date,
    project,
    general_crop_index=None,
) -> date | None:
    """Where a saved plan of ``crop`` planted on ``planting_date`` would end."""
    harvest_start, harvest_end = _derive_harvest_dates(
        crop, planting_date, project, general_crop_index,
    )
    return harvest_end or harvest_start


def _succession_limit_payload(
    capacity: BedCapacity,
    rule: SuccessionRule,
    *,
    crop: Crop | None,
    start: date,
    harvest_start: date | None,
    language_code: str,
    region: str,
) -> dict | None:
    """When a follow-up may take over the bed, for the "Beetfläche überschritten" message.

    Of the checked plan and the plan whose firm stage frees its area last, the
    one that starts first is the predecessor; ``None`` when it has no harvest
    start or the project does not allow a follow-up during the harvest phase.
    """
    blocker = capacity.last_ending_plan()
    if blocker is None or not rule.allow_during_harvest:
        return None
    if blocker.start is not None and blocker.start <= start:
        predecessor_crop = (
            Crop.objects.filter(pk=blocker.crop_id)
            .select_related('crop_species')
            .prefetch_related('crop_species__translations')
            .first()
            if blocker.crop_id else None
        )
        predecessor_harvest_start = blocker.harvest_start
    else:
        predecessor_crop, predecessor_harvest_start = crop, harvest_start
    if predecessor_harvest_start is None:
        return None
    min_days = rule.min_days_after_harvest_start
    return {
        'crop_label': (
            format_crop_label(predecessor_crop, language_code, region) if predecessor_crop else ''
        ),
        'harvest_start_date': predecessor_harvest_start.isoformat(),
        'min_days_after_harvest_start': min_days,
        'earliest_date': (predecessor_harvest_start + timedelta(days=min_days)).isoformat(),
    }


def _parse_optional_int(value: str | None, name: str) -> tuple[int | None, str | None]:
    if not value:
        return None, None
    try:
        return int(value), None
    except ValueError:
        return None, f'{name} must be an integer.'


def _parse_rotation_params(query_params) -> tuple[dict | None, str | None]:
    """Parse the crop/date parameters shared by the rotation endpoints.

    ``crop_id`` and ``planting_date`` are required; ``end_date`` falls back to
    the crop's effective harvest end, ``bed_id`` and ``exclude_plan_id`` are
    optional.
    """
    crop_id, error = _parse_optional_int(query_params.get('crop_id'), 'crop_id')
    if error:
        return None, error
    planting_date = parse_date(query_params.get('planting_date') or '')
    if crop_id is None or planting_date is None:
        return None, 'crop_id and planting_date (YYYY-MM-DD) are required.'
    end_date_param = query_params.get('end_date')
    end_date = parse_date(end_date_param) if end_date_param else None
    if end_date_param and end_date is None:
        return None, 'end_date must use YYYY-MM-DD format.'
    bed_id, error = _parse_optional_int(query_params.get('bed_id'), 'bed_id')
    if error:
        return None, error
    exclude_plan_id, error = _parse_optional_int(query_params.get('exclude_plan_id'), 'exclude_plan_id')
    if error:
        return None, error
    return {
        'crop_id': crop_id,
        'planting_date': planting_date,
        'end_date': end_date,
        'bed_id': bed_id,
        'exclude_plan_id': exclude_plan_id,
    }, None


class YieldCalendarListView(generics.GenericAPIView):
    """Return expected yield distribution aggregated by ISO week and crop."""

    def get(self, request):
        active_project = get_active_project_or_400(request)
        year_param = request.query_params.get('year')
        try:
            iso_year = int(year_param) if year_param else date.today().year
        except ValueError:
            return api_error_response(code='invalid_year', detail='Invalid year parameter.', status_code=status.HTTP_400_BAD_REQUEST)

        if iso_year < 1 or iso_year > 9999:
            return api_error_response(code='year_out_of_range', detail='Year out of supported range.', status_code=status.HTTP_400_BAD_REQUEST)

        language_code = resolve_request_language(request)
        season_id = resolve_season_id_from_request(request)
        season = (
            Season.objects.filter(pk=season_id, project=active_project).first()
            if season_id is not None
            else None
        )
        # An active season fully scopes the calendar (same as the planting-plans
        # list) — return every ISO year it spans, not just one, so a season that
        # straddles a calendar-year boundary is shown whole. An explicit ?year=
        # still wins for backwards compatibility with direct API callers.
        if season is not None and not year_param:
            return Response(build_yield_calendar_for_season(active_project, season, language_code))
        return Response(build_yield_calendar(active_project, iso_year, language_code, season_id=season_id))


@extend_schema_view(list=extend_schema(parameters=[SEASON_HEADER_PARAMETER]))
class PlantingPlanViewSet(ProjectScopedMixin, ProjectRevisionMixin, viewsets.ModelViewSet):
    """ViewSet for PlantingPlan model providing CRUD operations.
    
    Provides list, create, retrieve, update, and delete operations
    for planting plans. The harvest_date is automatically calculated
    on creation and update based on the crop's growth_duration_days.
    
    Attributes:
        queryset: All PlantingPlan objects ordered by planting_date (descending)
        serializer_class: PlantingPlanSerializer for serialization
    """

    # Read-only for project-bound API tokens: agents may look these up to
    # resolve references, but changing them stays session-only in this
    # version (see farm/agent_api/permissions.py).
    api_token_actions = {'list', 'retrieve'}
    queryset = (
        PlantingPlan.objects
        .select_related(
            'crop', 'crop__crop_species', 'crop__project', 'bed', 'created_by', 'updated_by',
            'rotation_conflict_accepted_by',
        )
        .prefetch_related('crop__crop_species__translations')
        .annotate(note_attachment_count=Count('attachments'))
        .order_by('-planting_date')
    )
    serializer_class = PlantingPlanSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        season_id = resolve_season_id_from_request(self.request)
        if season_id is not None:
            queryset = queryset.filter(season_id=season_id)
        return queryset

    def perform_create(self, serializer):
        current_user = self.request.user if self.request.user.is_authenticated else None
        extra_fields = {}
        if 'season' not in serializer.validated_data:
            season_id = resolve_season_id_from_request(self.request)
            if season_id is not None:
                extra_fields['season_id'] = season_id
        instance = serializer.save(
            created_by=current_user, updated_by=current_user, project=self.request.active_project, **extra_fields,
        )
        self.record_revision(instance, EntityRevision.ACTION_CREATED)

    def perform_update(self, serializer):
        current_user = self.request.user if self.request.user.is_authenticated else None
        previous_snapshot = _serialize_instance(serializer.instance)
        instance = serializer.save(updated_by=current_user)
        self.record_revision(instance, EntityRevision.ACTION_UPDATED, previous_snapshot=previous_snapshot)

    @action(detail=False, methods=['get'], url_path='remaining-area')
    def remaining_area(self, request):
        """Calculate remaining bed area for a time interval.

        The planting-plan table's save check uses this, so it applies the same
        capacity rule (farm/services/bed_capacity.py) as the bed options and
        suggestions of ``bed-suggestions``.

        :param request: DRF request with bed_id, start_date and optional end_date, crop_id and exclude_plan_id.
        :return: Remaining area payload for the requested bed and interval.
        """
        active_project = request.active_project
        params, error_detail = _parse_remaining_area_params(request.query_params)
        if error_detail:
            return api_error_response(code='invalid_remaining_area_parameters', detail=error_detail, status_code=status.HTTP_400_BAD_REQUEST)

        bed = Bed.objects.filter(id=params['bed_id'], project=active_project).only('id', 'area_sqm', 'project_id').first()
        if bed is None:
            return api_error_response(code='bed_not_found', detail='Bed not found.', status_code=status.HTTP_404_NOT_FOUND)

        if params['exclude_plan_id'] is not None:
            plan_exists = PlantingPlan.objects.filter(id=params['exclude_plan_id'], project=active_project).exists()
            if not plan_exists:
                return api_error_response(code='exclude_plan_not_found', detail='exclude_plan_id not found in active project.', status_code=status.HTTP_400_BAD_REQUEST)

        crop = None
        if params['crop_id'] is not None:
            crop = Crop.objects.filter(pk=params['crop_id'], project=active_project).first()
            if crop is None:
                return api_error_response(code='crop_not_found', detail='Crop not found.', status_code=status.HTTP_404_NOT_FOUND)
        start_date = params['start_date']
        derived_harvest_start, derived_harvest_end = _derive_harvest_dates(crop, start_date, active_project)
        end_date = params['end_date'] or derived_harvest_end or derived_harvest_start or start_date
        if end_date < start_date:
            if params['end_date'] is not None:
                return api_error_response(code='invalid_remaining_area_interval', detail='end_date must be greater than or equal to start_date.', status_code=status.HTTP_400_BAD_REQUEST)
            end_date = start_date
        harvest_start_date = params['harvest_start_date'] or derived_harvest_start

        language_code = resolve_request_language(request)
        region = getattr(active_project, 'region', '') or ''
        rule = SuccessionRule.for_project(active_project)
        capacity = calculate_bed_capacity(
            bed,
            start=start_date,
            end=end_date,
            harvest_start=harvest_start_date,
            exclude_plan_id=params['exclude_plan_id'],
            rule=rule,
        )
        overlap_index = HarvestOverlapIndex(
            active_project.pk,
            crop_label=lambda item: format_crop_label(item, language_code, region),
            rule=rule,
            bed_ids=[bed.pk],
        )
        harvest_overlaps = overlap_index.candidate_overlaps(
            bed,
            start=start_date,
            harvest_start=harvest_start_date,
            end=end_date,
            area_sqm=params['area_sqm'],
            exclude_plan_id=params['exclude_plan_id'],
        )
        free_area = capacity.free_area_sqm
        return Response({
            'bed_id': bed.pk,
            'bed_area_sqm': float(capacity.bed_area_sqm or 0),
            'has_bed_area': capacity.bed_area_sqm is not None,
            'overlapping_used_area_sqm': float(capacity.used_area_sqm),
            'remaining_area_sqm': float(free_area if free_area is not None else 0),
            'start_date': start_date.isoformat(),
            'end_date': end_date.isoformat(),
            'harvest_start_date': harvest_start_date.isoformat() if harvest_start_date else None,
            'harvest_overlaps': [overlap.as_dict() for overlap in harvest_overlaps],
            'succession_limit': _succession_limit_payload(
                capacity, rule, crop=crop, start=start_date, harvest_start=harvest_start_date,
                language_code=language_code, region=region,
            ),
        })

    def _rotation_request_context(self, request) -> tuple[dict, Crop, RotationService] | Response:
        """Validated rotation parameters, the crop, and a service for the project."""
        active_project = request.active_project
        params, error_detail = _parse_rotation_params(request.query_params)
        if error_detail is None:
            params['area_sqm'], error_detail = _parse_optional_decimal(request.query_params.get('area_sqm'), 'area_sqm')
        if error_detail:
            return api_error_response(code='invalid_rotation_parameters', detail=error_detail, status_code=status.HTTP_400_BAD_REQUEST)
        crop = (
            Crop.objects
            .filter(pk=params['crop_id'], project=active_project)
            .select_related('crop_species')
            .prefetch_related('crop_species__translations')
            .first()
        )
        if crop is None:
            return api_error_response(code='crop_not_found', detail='Crop not found.', status_code=status.HTTP_404_NOT_FOUND)
        service = RotationService(
            active_project.pk,
            language_code=resolve_request_language(request),
            region=getattr(active_project, 'region', '') or '',
        )
        if params['end_date'] is None:
            params['end_date'] = _derive_plan_end(
                crop, params['planting_date'], active_project, service.general_crop_index,
            )
        return params, crop, service

    @action(detail=False, methods=['get'], url_path='rotation-check')
    def rotation_check(self, request):
        """Crop rotation check for an unsaved crop/bed/date combination.

        Used by the planting-plan dialog before saving; the same rules produce
        ``rotation_status`` on saved plans. Returns the bed's recorded history
        too, for "Belegung ansehen".
        """
        context = self._rotation_request_context(request)
        if isinstance(context, Response):
            return context
        params, crop, service = context
        if params['bed_id'] is None:
            return api_error_response(code='invalid_rotation_parameters', detail='bed_id is required.', status_code=status.HTTP_400_BAD_REQUEST)
        if not Bed.objects.filter(pk=params['bed_id'], project=request.active_project).exists():
            return api_error_response(code='bed_not_found', detail='Bed not found.', status_code=status.HTTP_404_NOT_FOUND)
        candidate = service.occupancy(
            crop=crop,
            bed_id=params['bed_id'],
            start=params['planting_date'],
            end=params['end_date'],
            plan_id=params['exclude_plan_id'],
        )
        return Response({
            **service.check(candidate).as_dict(),
            'bed_history': service.bed_history(params['bed_id'], exclude_plan_id=params['exclude_plan_id']),
        })

    @action(detail=False, methods=['get'], url_path='bed-suggestions')
    def bed_suggestions(self, request):
        """Every bed for the crop and period, ranked by crop rotation fit.

        One row per bed of the project with its rotation status and its free
        area in the period. With ``area_sqm`` (the plan's area), beds that
        cannot hold it are flagged ``has_enough_area: false`` and listed last;
        the bed options of "Anbaufläche ändern" show them disabled and the
        suggestions leave them out.
        """
        context = self._rotation_request_context(request)
        if isinstance(context, Response):
            return context
        params, crop, service = context
        end_date = params['end_date'] if params['end_date'] and params['end_date'] >= params['planting_date'] else params['planting_date']
        results = suggest_beds(
            service,
            crop=crop,
            start=params['planting_date'],
            end=end_date,
            exclude_plan_id=params['exclude_plan_id'],
            needed_area_sqm=params['area_sqm'],
        )
        return Response({
            'count': len(results),
            'available_count': sum(1 for row in results if row['has_enough_area']),
            'start_date': params['planting_date'].isoformat(),
            'end_date': end_date.isoformat(),
            'results': results,
        })


class TaskViewSet(ProjectScopedMixin, ProjectRevisionMixin, viewsets.ModelViewSet):
    """ViewSet for Task model providing CRUD operations.
    
    Provides list, create, retrieve, update, and delete operations
    for farm management tasks.
    
    Attributes:
        queryset: All Task objects ordered by due_date and created_at
        serializer_class: TaskSerializer for serialization
    """

    # Read-only for project-bound API tokens: agents may look these up to
    # resolve references, but changing them stays session-only in this
    # version (see farm/agent_api/permissions.py).
    api_token_actions = {'list', 'retrieve'}
    queryset = Task.objects.select_related('planting_plan', 'planting_plan__crop', 'planting_plan__bed').all()
    serializer_class = TaskSerializer

    def perform_create(self, serializer):
        instance = serializer.save(project=self.request.active_project)
        self.record_revision(instance, EntityRevision.ACTION_CREATED)

    def perform_destroy(self, instance):
        instance_id = instance.pk
        snapshot = _serialize_instance(instance)
        title = getattr(instance, 'title', None)
        instance.delete()
        self.record_revision(
            instance, EntityRevision.ACTION_DELETED,
            object_id=instance_id, snapshot=snapshot, display_name=title, changed_fields=[],
        )
