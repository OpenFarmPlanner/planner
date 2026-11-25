"""API endpoints for the planning domain (planting plans, tasks, yield calendar)."""

import logging
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import (
    BooleanField,
    Case,
    Count,
    OuterRef,
    Prefetch,
    Q,
    QuerySet,
    Subquery,
    Value,
    When,
)
from django.db.models.functions import Coalesce
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_date
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import generics, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from config.languages import resolve_request_language
from config.responses import api_error_response
from farm.agent_api.schema import SEASON_HEADER_PARAMETER
from farm.common.mixins import ProjectRevisionMixin, ProjectScopedMixin
from farm.history import _serialize_instance
from farm.models import (
    Bed,
    Crop,
    CropLoss,
    EntityRevision,
    HarvestAllocation,
    PlantingPlan,
    Season,
    Task,
)
from farm.project_context import get_active_project_or_400, resolve_season_id_from_request
from farm.services.actual_harvest import (
    HARVEST_DATE_FIELDS,
    apply_legacy_harvest_patch,
    detach_stored_legacy_dates,
    harvest_actual_occurrences,
    recorded_harvest_plan_ids,
    update_harvest_actuals,
)
from farm.services.bed_capacity import (
    BedCapacity,
    HarvestOverlapIndex,
    SuccessionRule,
    calculate_bed_capacity,
)
from farm.services.crop_companions import CompanionService
from farm.services.crop_display import format_crop_label
from farm.services.crop_inheritance import (
    GeneralCropIndex,
    build_general_crop_index,
    resolve_crop_field,
)
from farm.services.crop_rotation import RotationService, suggest_beds
from farm.services.germination_check import check_germination
from farm.services.seasonal_harvest import (
    early_recorded_perennial_plan_ids,
    harvest_occurrence_page,
    recurring_harvest_schedule,
    seasonal_harvest_payload,
)
from farm.services.site_suitability import check_site_suitability
from farm.services.tasks import (
    detach_plan_tasks,
    generate_plan_tasks,
    synchronize_plan_tasks,
    synchronize_recurring_harvest_tasks,
)
from farm.services.timing_window_check import TimingWindowChecker
from farm.services.yield_calendar import build_yield_forecast
from farm.services.yield_comparison import (
    YieldComparisonScope,
    build_yield_comparison,
    comparison_crops,
    comparison_filter_options,
)

from .season_context import resolve_record_season
from .serializers import (
    HarvestActualDateResultSerializer,
    HarvestActualDateUpdateSerializer,
    HarvestDateRangeSerializer,
    PlantingPlanDetailSerializer,
    PlantingPlanSerializer,
    TaskFilterSerializer,
    TaskSerializer,
    YieldComparisonQuerySerializer,
)

logger = logging.getLogger(__name__)


def _parse_remaining_area_params(query_params) -> tuple[dict | None, str | None]:
    """Parse/validate the remaining-area query parameters.

    ``bed_id`` and ``start_date`` are required. Without ``end_date`` an annual
    plan uses its effective harvest end. A perennial uses ``clearing_date``,
    its saved removal date, or the suggested removal date from its lifespan.
    ``area_sqm`` (the plan's area) is only needed for harvest overlaps.

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

    clearing_date, error = _parse_clearing_date(query_params)
    if error:
        return None, error

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
        'clearing_date': clearing_date,
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


def _parse_clearing_date(query_params) -> tuple[date | None, str | None]:
    value = query_params.get('clearing_date')
    if not value:
        return None, None
    try:
        parsed = parse_date(value)
    except ValueError:
        parsed = None
    return (parsed, None) if parsed else (None, 'clearing_date must use YYYY-MM-DD format.')


def _capacity_interval(
    draft: PlantingPlan,
    crop_index: GeneralCropIndex | None,
    *,
    existing_plan: PlantingPlan | None,
    end_date: date | None,
    clearing_date: date | None,
) -> tuple[date | None, date | None, bool]:
    """Return the occupancy end, any soft-phase harvest start, and perennial status."""
    saved_clearing_date = (
        existing_plan.clearing_date
        if existing_plan is not None and draft.crop_id == existing_plan.crop_id else None
    )
    perennial = saved_clearing_date is not None or (
        resolve_crop_field(draft.crop, 'life_cycle', crop_index) == 'perennial'
    )
    if perennial:
        removal = clearing_date or saved_clearing_date or draft.suggested_clearing_date(crop_index)
        if removal is not None:
            return removal, None, True
    harvest_start, harvest_end = draft.calculate_effective_harvest_dates(crop_index)
    derived_end = harvest_end or harvest_start
    if perennial:
        return derived_end, None, True
    return end_date or derived_end, harvest_start, False


_CAPACITY_CULTIVATION_TYPE = serializers.ChoiceField(
    choices=PlantingPlan.CULTIVATION_TYPE_CHOICES, allow_blank=True, allow_null=True,
)


def _capacity_start(
    draft: PlantingPlan, existing: PlantingPlan | None, crop_index: GeneralCropIndex | None,
    *, cultivation_type: str | None,
) -> date:
    """Include the recorded start for the proposed cultivation type."""
    cultivation_type = _CAPACITY_CULTIVATION_TYPE.run_validation(cultivation_type)
    if existing is None or not (existing.actual_sowing_date or existing.actual_transplanting_date):
        return draft.planting_date
    if draft.crop_id is None:
        draft.crop = existing.crop
    draft.cultivation_type = (
        existing.cultivation_type if cultivation_type is None else cultivation_type
    )
    draft.actual_sowing_date = existing.actual_sowing_date
    draft.actual_transplanting_date = existing.actual_transplanting_date
    schedule = recurring_harvest_schedule(draft, crop_index)
    return schedule.occupied_from if schedule is not None else draft.planting_date


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

    ``crop_id`` and ``planting_date`` are required. The optional ``end_date``
    is the harvest boundary; ``clearing_date`` is the perennial removal date.
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
    clearing_date, error = _parse_clearing_date(query_params)
    if error:
        return None, error
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
        'clearing_date': clearing_date,
        'bed_id': bed_id,
        'exclude_plan_id': exclude_plan_id,
    }, None


class YieldCalendarListView(generics.GenericAPIView):
    """Return expected yield in kilograms, aggregated by ISO week and crop."""

    @extend_schema(
        description=(
            'Forecast kilograms by ISO week from each plan’s effective crop rate in kg/m² '
            'or kg/plant and its area or calculated plant count. The default response is '
            'an array of weeks. With include_incomplete=true, the response contains weeks '
            'and incomplete_plans with the reasons those plans are omitted.'
        ),
        parameters=[
            SEASON_HEADER_PARAMETER,
            OpenApiParameter('year', int, description='Limit the forecast to one ISO year.'),
            OpenApiParameter(
                'include_incomplete', bool, description='Include omitted plan details.',
            ),
        ],
    )
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
        # Harvest dates define a season's forecast, including harvests from
        # older plans. An explicit year further limits the harvest interval.
        include_incomplete = request.query_params.get('include_incomplete') == 'true'
        forecast = build_yield_forecast(
            active_project, language_code,
            iso_year=None if season is not None and not year_param else iso_year,
            season=season, season_id=season_id, include_incomplete=include_incomplete,
        )
        return Response(forecast if include_incomplete else forecast['weeks'])


class YieldComparisonView(generics.GenericAPIView):
    """Read comparable yields and recorded observations across a project's seasons."""

    @extend_schema(
        description=(
            'List crops with planting plans or harvest records. With crop_id, compare that crop '
            'across the active project’s non-deleted season periods. Supply season_window '
            'to compare a filtered set of crops, growing areas and seasons.'
        ),
        parameters=[
            OpenApiParameter('crop_id', int, many=True, description='Crop IDs to compare.'),
            OpenApiParameter('season_window', str, enum=['3', '5', 'all']),
            OpenApiParameter('location_id', int),
            OpenApiParameter('field_id', int),
            OpenApiParameter('bed_id', int),
            OpenApiParameter('variety_id', int),
            OpenApiParameter('filters', bool, description='Return comparison filter choices.'),
        ],
    )
    def get(self, request):
        project = get_active_project_or_400(request)
        language = resolve_request_language(request)
        params = request.query_params
        if params.get('filters') == 'true':
            return Response(comparison_filter_options(project, language))
        if 'season_window' in params:
            query = YieldComparisonQuerySerializer(data={
                **params.dict(), 'crop_ids': params.getlist('crop_id'),
            })
            query.is_valid(raise_exception=True)
            filters = query.validated_data.copy()
            limit = filters.pop('season_window')
            crop_ids = tuple(filters.pop('crop_ids'))
            return Response(build_yield_comparison(project, YieldComparisonScope(
                crop_ids=crop_ids, season_limit=None if limit == 'all' else int(limit), **filters,
            ), language))
        if 'crop_id' not in params:
            return Response({'crops': comparison_crops(project, language)})
        crop_id = serializers.IntegerField(min_value=1, max_value=2**63 - 1).run_validation(
            params['crop_id'],
        )
        crop = get_object_or_404(Crop.all_objects, project=project, pk=crop_id)
        return Response(build_yield_comparison(
            project, YieldComparisonScope(crop_ids=(crop.pk,)), language, crop=crop,
        ))


@extend_schema_view(
    list=extend_schema(parameters=[
        SEASON_HEADER_PARAMETER,
        OpenApiParameter('bed', int, description='Limit plans to this bed.'),
        OpenApiParameter('field', int, description='Limit plans to this field.'),
        OpenApiParameter(
            'location', int, description='Limit plans assigned to beds at this location.',
        ),
    ]),
    retrieve=extend_schema(parameters=[SEASON_HEADER_PARAMETER, OpenApiParameter(
        'across_seasons', bool,
        description='Read a plan in any non-deleted season of the active project.',
    )]),
)
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
            'crop', 'crop__crop_species', 'crop__project', 'bed__field__location',
            'created_by', 'updated_by',
            'rotation_conflict_accepted_by', 'season',
        )
        .prefetch_related('crop__crop_species__translations')
        .annotate(note_attachment_count=Count('attachments'))
        .order_by('-planting_date')
    )
    serializer_class = PlantingPlanSerializer

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return PlantingPlanDetailSerializer
        return super().get_serializer_class()

    def get_serializer_context(self):
        context = super().get_serializer_context()
        season = getattr(self, '_harvest_season', None)
        if self.action in {'create', 'update', 'partial_update'}:
            season_id = resolve_season_id_from_request(self.request)
            if season_id is not None:
                season = Season.objects.filter(
                    pk=season_id, project=self.request.active_project,
                ).first()
        context['harvest_season'] = season
        context['harvest_overlaps_for_bed'] = (
            self.action in {'retrieve', 'create', 'update', 'partial_update'}
            or (self.action == 'list' and self.request.query_params.get('bed') is not None)
        )
        crop_index = getattr(self, '_harvest_crop_index', None)
        if crop_index is not None:
            context['_general_crop_index_by_project'] = {self.request.active_project.pk: crop_index}
        return context

    def get_queryset(self):
        queryset = super().get_queryset()
        season_id = resolve_season_id_from_request(self.request)
        across_seasons = (
            self.action == 'retrieve' and self.request.query_params.get('across_seasons') == 'true'
        )
        record_season = resolve_record_season(self.request) if across_seasons else None
        season_id = record_season.pk if record_season is not None else season_id
        if season_id is not None:
            if self.action in {'list', 'retrieve'}:
                queryset = self._read_season_plans(
                    queryset, season_id, across_seasons, record_season=record_season,
                )
            else:
                queryset = queryset.filter(season_id=season_id)
        elif across_seasons:
            queryset = queryset.filter(season__deleted_at__isnull=True)
        if self.action == 'list':
            for name, lookup in (
                ('bed', 'bed_id'),
                ('field', 'bed__field_id'),
                ('location', 'bed__field__location_id'),
            ):
                value = self.request.query_params.get(name)
                if value is not None:
                    try:
                        queryset = queryset.filter(**{lookup: int(value)})
                    except ValueError:
                        return queryset.none()
        if self.action in {'list', 'retrieve'}:
            allocations = HarvestAllocation.objects.filter(
                project=self.request.active_project,
            ).select_related('harvest').only(
                'planting_plan_id', 'quantity', 'harvest__crop_id',
                'harvest__unit', 'harvest__grams_per_unit', 'harvest__date',
            )
            season = getattr(self, '_harvest_season', None)
            if season is not None:
                allocations = allocations.filter(
                    harvest__date__range=(season.start_date, season.end_date),
                )
            queryset = queryset.prefetch_related(Prefetch(
                'harvest_allocations', queryset=allocations, to_attr='visible_harvest_allocations',
            ))
            queryset = self._with_crop_loss_count(queryset, season)
        return queryset

    def _with_crop_loss_count(
        self, queryset: QuerySet[PlantingPlan], season: Season | None,
    ) -> QuerySet[PlantingPlan]:
        losses = CropLoss.objects.filter(
            project=self.request.active_project, planting_plan_id=OuterRef('pk'),
        )
        if season is not None:
            losses = losses.filter(date__range=(season.start_date, season.end_date))
        counts = (
            losses.order_by().values('planting_plan_id').annotate(total=Count('pk')).values('total')
        )
        return queryset.annotate(crop_loss_count=Coalesce(Subquery(counts), 0))

    def _read_season_plans(
        self, queryset: QuerySet[PlantingPlan], season_id: int, across_seasons: bool,
        *, record_season: Season | None = None,
    ) -> QuerySet[PlantingPlan]:
        active_season = record_season or Season.objects.filter(
            pk=season_id, project=self.request.active_project,
        ).first()
        queryset = queryset.filter(season__deleted_at__isnull=True)
        if active_season is None:
            return queryset if across_seasons else queryset.none()
        self._harvest_season = active_season
        queryset = queryset.alias(occupied_until=PlantingPlan.occupancy_end_expression())
        starts_before = Q(
            bed__isnull=False,
            planting_date__lt=active_season.start_date,
            occupied_until__gte=active_season.start_date,
        )
        bounds = (active_season.start_date, active_season.end_date)
        recorded_harvest_overlap = Q(
            bed__isnull=False, planting_date__lte=active_season.end_date,
        ) & (
            Q(actual_harvest_start_date__range=bounds) | Q(recorded_harvest_end_date__range=bounds)
            | Q(actual_harvest_start_date__lt=active_season.start_date,
                recorded_harvest_end_date__gt=active_season.end_date)
        )
        project_id = self.request.active_project.pk
        candidates = PlantingPlan.objects.filter(
            project_id=project_id, season__deleted_at__isnull=True,
        ).exclude(season_id=season_id)
        early_plans, self._harvest_crop_index = early_recorded_perennial_plan_ids(
            candidates, project_id, active_season.start_date, active_season.end_date,
        )
        carries = starts_before | Q(pk__in=early_plans) | recorded_harvest_overlap
        if self.action in {'list', 'retrieve'}:
            after_occupancy = candidates.alias(
                occupied_until=PlantingPlan.occupancy_end_expression(),
            ).exclude(carries)
            carries |= Q(pk__in=recorded_harvest_plan_ids(after_occupancy, active_season))
        carried_over = carries & ~Q(season_id=season_id)
        if not across_seasons:
            queryset = queryset.filter(Q(season_id=season_id) | carried_over)
        return queryset.annotate(carried_over=Case(
            When(carried_over, then=Value(True)), default=Value(False), output_field=BooleanField(),
        ))

    @transaction.atomic
    def perform_create(self, serializer: PlantingPlanSerializer) -> None:
        current_user = self.request.user if self.request.user.is_authenticated else None
        extra_fields = {}
        if 'season' not in serializer.validated_data:
            season_id = resolve_season_id_from_request(self.request)
            if season_id is not None:
                extra_fields['season_id'] = season_id
        instance = serializer.save(
            created_by=current_user, updated_by=current_user, project=self.request.active_project, **extra_fields,
        )
        generate_plan_tasks(instance)
        self.record_revision(instance, EntityRevision.ACTION_CREATED)

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        # Serialize ordinary edits with amendments to the same plan's forecast.
        self._lock_plan()
        return super().update(request, *args, **kwargs)

    def _lock_plan(self) -> PlantingPlan:
        return generics.get_object_or_404(
            PlantingPlan.objects.select_for_update().filter(project=self.request.active_project),
            pk=self.kwargs['pk'],
        )

    @transaction.atomic
    def perform_update(self, serializer: PlantingPlanSerializer) -> None:
        current_user = self.request.user if self.request.user.is_authenticated else None
        previous_snapshot = _serialize_instance(serializer.instance)
        actual_dates_only = serializer.is_actual_date_update(serializer.validated_data)
        save_legacy_occurrence = actual_dates_only and self._apply_legacy_harvest_patch(serializer)
        instance = serializer.save(updated_by=current_user)
        if save_legacy_occurrence:
            instance.save(update_fields=['harvest_occurrence_actuals', 'updated_at'])
        if not actual_dates_only:
            synchronize_plan_tasks(instance)
        elif {'actual_sowing_date', 'actual_transplanting_date'} & serializer.validated_data.keys():
            synchronize_recurring_harvest_tasks(PlantingPlan.objects.filter(pk=instance.pk))
        self.record_revision(instance, EntityRevision.ACTION_UPDATED, previous_snapshot=previous_snapshot)

    def _apply_legacy_harvest_patch(self, serializer: PlantingPlanSerializer) -> bool:
        fields = serializer.validated_data
        plan = serializer.instance
        if not fields.keys() & set(HARVEST_DATE_FIELDS) or not plan.harvest_occurrence_actuals:
            return False
        schedule = recurring_harvest_schedule(plan, build_general_crop_index(plan.project_id))
        if schedule is None:
            detached = detach_stored_legacy_dates(plan)
            if detached:
                for field in HARVEST_DATE_FIELDS:
                    fields.setdefault(field, None)
            return detached
        try:
            return apply_legacy_harvest_patch(
                plan, schedule, serializer.context.get('harvest_season') or plan.season, fields,
            )
        except DjangoValidationError as error:
            raise serializers.ValidationError(error.message_dict) from error

    @extend_schema(
        request=HarvestActualDateUpdateSerializer, responses=HarvestActualDateResultSerializer,
    )
    @action(detail=True, methods=['patch'], url_path='harvest-actual-dates')
    @transaction.atomic
    def harvest_actual_dates(self, request, pk=None):
        plan = self._lock_plan()
        self.check_object_permissions(request, plan)
        if plan.season_id is not None and plan.season.deleted_at is not None:
            raise Http404
        season = resolve_record_season(request)
        if season is None:
            season = get_object_or_404(
                Season, pk=resolve_season_id_from_request(request), project=request.active_project,
            )
        if season.deleted_at is not None:
            raise Http404
        crop_index = build_general_crop_index(plan.project_id)
        schedule = recurring_harvest_schedule(plan, crop_index)
        planned = plan.planned_harvest_dates(crop_index)
        occurrences = harvest_actual_occurrences(plan, season, schedule, planned)
        if not occurrences:
            raise Http404

        payload = HarvestActualDateUpdateSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        dates = dict(payload.validated_data)
        year = dates.pop('year')
        if year not in {occurrence['year'] for occurrence in occurrences}:
            raise serializers.ValidationError({
                'year': 'Select a harvest occurrence in this season.',
            })
        before = _serialize_instance(plan)
        try:
            fields = update_harvest_actuals(plan, schedule, year, dates)
        except DjangoValidationError as error:
            raise serializers.ValidationError(error.message_dict) from error
        if fields:
            plan.updated_by = request.user
            plan.save(update_fields=(*fields, 'updated_by', 'updated_at'))
            self.record_revision(plan, EntityRevision.ACTION_UPDATED, previous_snapshot=before)
        return Response({
            'actual_harvest_start_date': plan.actual_harvest_start_date,
            'recorded_harvest_end_date': plan.recorded_harvest_end_date,
            'harvest_actual_occurrences': harvest_actual_occurrences(
                plan, season, schedule, planned,
            ),
            'seasonal_harvest': (
                seasonal_harvest_payload(plan, season, schedule) if schedule else None
            ),
        })

    @extend_schema(
        parameters=[SEASON_HEADER_PARAMETER, HarvestDateRangeSerializer],
        responses={200: {
            'type': 'object',
            'required': ['windows_by_plan', 'next_start_date'],
            'properties': {
                'next_start_date': {'type': ['string', 'null'], 'format': 'date'},
                'windows_by_plan': {
                    'type': 'object',
                    'additionalProperties': {
                        'type': 'array',
                        'items': {
                            'type': 'object',
                            'required': ['start_date', 'end_date', 'occurrence_start_date'],
                            'properties': {
                                'start_date': {'type': 'string', 'format': 'date'},
                                'end_date': {'type': 'string', 'format': 'date'},
                                'occurrence_start_date': {'type': 'string', 'format': 'date'},
                            },
                        },
                    },
                },
            },
        }},
    )
    @action(detail=False, methods=['get'], url_path='calendar-harvest-windows')
    def calendar_harvest_windows(self, request):
        """Project visible plans in bulk for the requested Crop Calendar axis."""
        dates = HarvestDateRangeSerializer(data=request.query_params)
        dates.is_valid(raise_exception=True)
        start, end = dates.validated_data['start_date'], dates.validated_data['end_date']
        if start > end:
            raise serializers.ValidationError({'end_date': 'Use a date on or after start_date.'})
        season_id = resolve_season_id_from_request(request)
        if season_id is None:
            return Response({'windows_by_plan': {}, 'next_start_date': None})

        # Bound the work per request while allowing a wider calendar to continue fetching.
        page_end = min(end, date(min(start.year + 9, date.max.year), 12, 31))
        next_start = page_end + timedelta(days=1) if page_end < end else None

        project_id = request.active_project.pk
        candidates = PlantingPlan.objects.filter(
            project_id=project_id, bed__isnull=False, crop__isnull=False,
            planting_date__isnull=False,
        )
        plans = self._read_season_plans(candidates, season_id, across_seasons=False)
        if getattr(self, '_harvest_season', None) is None:
            return Response({'windows_by_plan': {}, 'next_start_date': None})
        crop_index = self._harvest_crop_index
        if crop_index is None:
            crop_index = build_general_crop_index(project_id)
        windows_by_plan = {}
        for plan in plans.filter(occupied_until__gte=start).select_related('crop'):
            schedule = recurring_harvest_schedule(plan, crop_index)
            if schedule is not None:
                windows_by_plan[str(plan.pk)] = [
                    {
                        'start_date': window.start_date,
                        'end_date': window.end_date,
                        'occurrence_start_date': window.window_start,
                    }
                    for window in schedule.project(start, page_end)
                ]
        return Response({'windows_by_plan': windows_by_plan, 'next_start_date': next_start})

    @extend_schema(request=HarvestDateRangeSerializer, methods=['PUT'])
    @action(detail=True, methods=['put', 'delete'], url_path=r'harvest-window/(?P<year>[0-9]{4})')
    @transaction.atomic
    def harvest_window(self, request, pk=None, year=None):
        plan = self._lock_plan()
        self.check_object_permissions(request, plan)
        season_id = resolve_season_id_from_request(request)
        season = plan.season
        if season_id != plan.season_id or (season is not None and season.deleted_at is not None):
            return api_error_response(
                code='origin_season_required', detail='Edit the plan in its originating season.',
                status_code=status.HTTP_404_NOT_FOUND,
            )
        occurrence_year = int(year)
        if occurrence_year < date.min.year:
            raise serializers.ValidationError({'year': 'A valid occurrence year is required.'})

        crop_index = build_general_crop_index(plan.project_id)
        schedule = recurring_harvest_schedule(plan, crop_index)
        if schedule is None:
            raise serializers.ValidationError({
                'year': 'This plan has no recurring harvest window.',
            })

        stored = dict(plan.harvest_window_overrides)
        key = str(occurrence_year)
        if request.method == 'DELETE':
            stored.pop(key, None)
        else:
            dates = HarvestDateRangeSerializer(data=request.data)
            dates.is_valid(raise_exception=True)
            start, end = dates.validated_data['start_date'], dates.validated_data['end_date']
            if not schedule.can_override(occurrence_year, start, end):
                return api_error_response(
                    code='invalid_harvest_window',
                    detail='Use ordered dates within this occurrence and the growing period.',
                    status_code=status.HTTP_400_BAD_REQUEST,
                )
            stored[key] = {'start_date': start.isoformat(), 'end_date': end.isoformat()}

        if stored != plan.harvest_window_overrides:
            before = _serialize_instance(plan)
            plan.harvest_window_overrides = stored
            plan.updated_by = request.user
            plan.save(update_fields=['harvest_window_overrides', 'updated_by', 'updated_at'])
            synchronize_recurring_harvest_tasks(PlantingPlan.objects.filter(pk=plan.pk))
            self.record_revision(plan, EntityRevision.ACTION_UPDATED, previous_snapshot=before)
            schedule = recurring_harvest_schedule(plan, crop_index)
        return Response({
            'harvest_windows_by_year': harvest_occurrence_page(plan, schedule, occurrence_year),
            'seasonal_harvest': (
                seasonal_harvest_payload(plan, season, schedule) if season else None
            ),
        })

    @transaction.atomic
    def perform_destroy(self, instance: PlantingPlan) -> None:
        detach_plan_tasks(instance)
        super().perform_destroy(instance)

    @action(detail=False, methods=['get'], url_path='remaining-area')
    def remaining_area(self, request):
        """Calculate remaining bed area for a time interval.

        The planting-plan table's save check uses this, so it applies the same
        capacity rule (farm/services/bed_capacity.py) as the bed options and
        suggestions of ``bed-suggestions``.

        :param request: DRF request with a bed, start date and optional harvest or removal dates.
        :return: Remaining area payload for the requested bed and interval.
        """
        active_project = request.active_project
        params, error_detail = _parse_remaining_area_params(request.query_params)
        if error_detail:
            return api_error_response(code='invalid_remaining_area_parameters', detail=error_detail, status_code=status.HTTP_400_BAD_REQUEST)

        bed = Bed.objects.filter(id=params['bed_id'], project=active_project).only('id', 'area_sqm', 'project_id').first()
        if bed is None:
            return api_error_response(code='bed_not_found', detail='Bed not found.', status_code=status.HTTP_404_NOT_FOUND)

        existing_plan = None
        if params['exclude_plan_id'] is not None:
            existing_plan = PlantingPlan.objects.filter(
                id=params['exclude_plan_id'], project=active_project,
            ).only(
                'crop_id', 'clearing_date', 'cultivation_type',
                'actual_sowing_date', 'actual_transplanting_date',
            ).first()
            if existing_plan is None:
                return api_error_response(code='exclude_plan_not_found', detail='exclude_plan_id not found in active project.', status_code=status.HTTP_400_BAD_REQUEST)

        crop = None
        if params['crop_id'] is not None:
            crop = Crop.objects.filter(pk=params['crop_id'], project=active_project).first()
            if crop is None:
                return api_error_response(code='crop_not_found', detail='Crop not found.', status_code=status.HTTP_404_NOT_FOUND)
        start_date = params['start_date']
        crop_index = build_general_crop_index(active_project.pk) if crop is not None else None
        draft = PlantingPlan(crop=crop, planting_date=start_date)
        end_date, harvest_start, perennial = _capacity_interval(
            draft, crop_index,
            existing_plan=existing_plan, end_date=params['end_date'],
            clearing_date=params['clearing_date'],
        )
        end_date = end_date or start_date
        if end_date < start_date:
            field = 'clearing_date' if perennial else 'end_date'
            if params[field] is not None:
                return api_error_response(
                    code='invalid_remaining_area_interval',
                    detail=f'{field} must be greater than or equal to start_date.',
                    status_code=status.HTTP_400_BAD_REQUEST,
                )
            end_date = start_date
        harvest_start_date = None if perennial else params['harvest_start_date'] or harvest_start
        occupancy_start = _capacity_start(
            draft, existing_plan, crop_index,
            cultivation_type=request.query_params.get('cultivation_type'),
        )

        language_code = resolve_request_language(request)
        region = getattr(active_project, 'region', '') or ''
        rule = SuccessionRule.for_project(active_project)
        capacity = calculate_bed_capacity(
            bed,
            start=occupancy_start,
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
            start=occupancy_start,
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
                capacity, rule, crop=crop, start=occupancy_start, harvest_start=harvest_start_date,
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
        existing_plan = None
        if params['exclude_plan_id'] is not None:
            existing_plan = PlantingPlan.objects.filter(
                pk=params['exclude_plan_id'], project=active_project,
            ).only(
                'crop_id', 'clearing_date', 'cultivation_type',
                'actual_sowing_date', 'actual_transplanting_date',
            ).first()
        draft = PlantingPlan(crop=crop, planting_date=params['planting_date'])
        params['end_date'], _, params['perennial'] = _capacity_interval(
            draft, service.general_crop_index, existing_plan=existing_plan,
            end_date=params['end_date'], clearing_date=params['clearing_date'],
        )
        params['occupancy_start'] = _capacity_start(
            draft, existing_plan, service.general_crop_index,
            cultivation_type=request.query_params.get('cultivation_type'),
        )
        if (
            params['perennial'] and params['clearing_date']
            and params['clearing_date'] < params['planting_date']
        ):
            return api_error_response(
                code='invalid_rotation_parameters',
                detail='clearing_date must be greater than or equal to planting_date.',
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        return params, crop, service

    @action(detail=False, methods=['get'], url_path='timing-window-check')
    def timing_window_check(self, request):
        """Timing-window hints for an unsaved crop/date/cultivation-type combination.

        The planting-plan dialog asks this while the user edits; the same
        service produces ``timing_window_findings`` on saved plans
        (farm/services/timing_window_check.py). Hints only, never blocking.
        """
        crop_id, error_detail = _parse_optional_int(request.query_params.get('crop_id'), 'crop_id')
        try:
            planting_date = parse_date(request.query_params.get('planting_date') or '')
        except ValueError:  # well-formed but not a calendar date, e.g. 2026-02-30
            planting_date = None
        cultivation_type = request.query_params.get('cultivation_type') or ''
        valid_types = {value for value, _label in PlantingPlan.CULTIVATION_TYPE_CHOICES}
        if error_detail is None and (crop_id is None or planting_date is None):
            error_detail = 'crop_id and planting_date (YYYY-MM-DD) are required.'
        if error_detail is None and cultivation_type and cultivation_type not in valid_types:
            error_detail = 'Unknown cultivation_type.'
        nursery_dates = {}
        for field in ('planned_propagation_start_date', 'planned_sowing_date'):
            value = request.query_params.get(field)
            if error_detail is None and value:
                try:
                    nursery_dates[field] = parse_date(value)
                except ValueError:
                    nursery_dates[field] = None
                if nursery_dates[field] is None:
                    error_detail = f'{field} must use YYYY-MM-DD format.'
        if error_detail:
            return api_error_response(
                code='invalid_timing_window_parameters', detail=error_detail,
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        crop = Crop.objects.filter(pk=crop_id, project=request.active_project).first()
        if crop is None:
            return api_error_response(code='crop_not_found', detail='Crop not found.', status_code=status.HTTP_404_NOT_FOUND)
        checker = TimingWindowChecker(request.active_project.pk)
        candidate = PlantingPlan(
            project=request.active_project, crop=crop,
            planting_date=planting_date, cultivation_type=cultivation_type,
            **nursery_dates,
        )
        findings = checker.check_plan(candidate)
        return Response({
            'timing_window_findings': [finding.as_dict() for finding in findings],
            **check_germination(candidate, checker),
        })

    @action(detail=False, methods=['get'], url_path='site-suitability-check')
    def site_suitability_check(self, request):
        """Preview site hints while a draft has a crop and bed but no date."""
        crop_id, crop_error = _parse_optional_int(request.query_params.get('crop_id'), 'crop_id')
        bed_id, bed_error = _parse_optional_int(request.query_params.get('bed_id'), 'bed_id')
        if crop_id is None or bed_id is None or crop_error or bed_error:
            return api_error_response(
                code='invalid_site_suitability_parameters',
                detail=crop_error or bed_error or 'crop_id and bed_id are required.',
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        project = request.active_project
        crop = Crop.objects.filter(pk=crop_id, project=project).first()
        if crop is None:
            return api_error_response(
                code='crop_not_found', detail='Crop not found.',
                status_code=status.HTTP_404_NOT_FOUND,
            )
        bed = (
            Bed.objects.select_related('field__location')
            .filter(pk=bed_id, project=project).first()
        )
        if bed is None:
            return api_error_response(
                code='bed_not_found', detail='Bed not found.',
                status_code=status.HTTP_404_NOT_FOUND,
            )
        findings = check_site_suitability(crop, bed, build_general_crop_index(project.pk))
        return Response({'site_suitability_findings': findings})

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
        bed = Bed.objects.select_related('field__location').filter(
            pk=params['bed_id'], project=request.active_project,
        ).first()
        if bed is None:
            return api_error_response(code='bed_not_found', detail='Bed not found.', status_code=status.HTTP_404_NOT_FOUND)
        candidate = service.occupancy(
            crop=crop,
            bed_id=params['bed_id'],
            start=params['occupancy_start'],
            end=params['end_date'],
            plan_id=params['exclude_plan_id'],
        )
        companion_findings = CompanionService(request.active_project.id).check(
            crop=crop,
            bed_id=params['bed_id'],
            start=candidate.start,
            end=candidate.end,
            exclude_plan_id=params['exclude_plan_id'],
        )
        return Response({
            **service.check(candidate).as_dict(),
            'bed_history': service.bed_history(params['bed_id'], exclude_plan_id=params['exclude_plan_id']),
            'companion_findings': [finding.as_dict() for finding in companion_findings],
            'site_suitability_findings': check_site_suitability(
                crop, bed, service.general_crop_index,
            ),
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
            firm_occupancy=params['perennial'],
            occupancy_start=params['occupancy_start'],
        )
        return Response({
            'count': len(results),
            'available_count': sum(1 for row in results if row['has_enough_area']),
            'start_date': params['planting_date'].isoformat(),
            'end_date': end_date.isoformat(),
            'results': results,
        })


@extend_schema_view(list=extend_schema(parameters=[TaskFilterSerializer, SEASON_HEADER_PARAMETER]))
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

    def get_queryset(self) -> QuerySet[Task]:
        queryset = super().get_queryset().filter(
            season__deleted_at__isnull=True, deleted_at__isnull=True,
            suppressed_by_harvest_configuration=False,
        )
        filters = TaskFilterSerializer(data=self.request.query_params)
        filters.is_valid(raise_exception=True)
        across_seasons = filters.validated_data.pop('across_seasons', False)
        record_season = resolve_record_season(self.request)
        if record_season is not None:
            queryset = queryset.filter(
                Q(due_date__range=(record_season.start_date, record_season.end_date))
                | Q(due_date__isnull=True, season_id=record_season.pk),
            )
        elif self.action == 'list' and across_seasons and 'planting_plan' in filters.validated_data:
            queryset = queryset.filter(
                planting_plan__project=self.request.active_project,
                planting_plan__season__deleted_at__isnull=True,
            )
        else:
            season_id = resolve_season_id_from_request(self.request)
            if season_id is not None:
                queryset = queryset.filter(season_id=season_id)
        field_id = filters.validated_data.pop('field', None)
        if field_id is not None:
            queryset = queryset.filter(
                Q(planting_plan__isnull=True, field_id=field_id)
                | Q(planting_plan__bed__field_id=field_id),
            )
        return queryset.filter(**filters.validated_data)

    def perform_create(self, serializer: TaskSerializer) -> None:
        instance = serializer.save(project=self.request.active_project)
        self.record_revision(instance, EntityRevision.ACTION_CREATED)

    def perform_destroy(self, instance: Task) -> None:
        instance_id = instance.pk
        snapshot = _serialize_instance(instance)
        title = getattr(instance, 'title', None)
        if instance.source_key:
            instance.deleted_at = timezone.now()
            instance.save(update_fields=['deleted_at', 'updated_at'])
            snapshot = _serialize_instance(instance)
        else:
            instance.delete()
        self.record_revision(
            instance, EntityRevision.ACTION_DELETED,
            object_id=instance_id, snapshot=snapshot, display_name=title, changed_fields=[],
        )
