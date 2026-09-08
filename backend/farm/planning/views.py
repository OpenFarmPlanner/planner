"""API endpoints for the planning domain (planting plans, tasks, yield calendar)."""

import logging
from datetime import date

from django.db.models import Count
from django.utils.dateparse import parse_date
from rest_framework import generics, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from config.languages import resolve_request_language
from farm.common.mixins import ProjectRevisionMixin, ProjectScopedMixin
from farm.common.responses import api_error_response
from farm.history import _serialize_instance
from farm.models import Bed, EntityRevision, PlantingPlan, Season, Task
from farm.project_context import get_active_project_or_400, resolve_season_id_from_request
from farm.services.yield_calendar import build_yield_calendar, build_yield_calendar_for_season
from farm.services_area import calculate_remaining_bed_area

from .serializers import PlantingPlanSerializer, TaskSerializer

logger = logging.getLogger(__name__)


def _parse_remaining_area_params(query_params) -> tuple[dict | None, str | None]:
    """Parse/validate the remaining-area query parameters.

    Returns (params, None) on success or (None, error_detail) on failure.
    """
    bed_id_param = query_params.get('bed_id')
    start_date_param = query_params.get('start_date')
    end_date_param = query_params.get('end_date')
    exclude_plan_id_param = query_params.get('exclude_plan_id')

    if not bed_id_param or not start_date_param or not end_date_param:
        return None, 'bed_id, start_date and end_date are required.'

    try:
        bed_id = int(bed_id_param)
    except ValueError:
        return None, 'bed_id must be an integer.'

    start_date = parse_date(start_date_param)
    end_date = parse_date(end_date_param)
    if start_date is None or end_date is None:
        return None, 'start_date and end_date must use YYYY-MM-DD format.'

    exclude_plan_id: int | None = None
    if exclude_plan_id_param:
        try:
            exclude_plan_id = int(exclude_plan_id_param)
        except ValueError:
            return None, 'exclude_plan_id must be an integer.'

    return {
        'bed_id': bed_id,
        'start_date': start_date,
        'end_date': end_date,
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
        .select_related('crop', 'crop__crop_species', 'crop__project', 'bed', 'created_by', 'updated_by')
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

        :param request: DRF request with bed_id, start_date, end_date and optional exclude_plan_id.
        :return: Remaining area payload for the requested bed and interval.
        """
        active_project = request.active_project
        params, error_detail = _parse_remaining_area_params(request.query_params)
        if error_detail:
            return api_error_response(code='invalid_remaining_area_parameters', detail=error_detail, status_code=status.HTTP_400_BAD_REQUEST)

        bed = Bed.objects.filter(id=params['bed_id'], project=active_project).only('id').first()
        if bed is None:
            return api_error_response(code='bed_not_found', detail='Bed not found.', status_code=status.HTTP_404_NOT_FOUND)

        if params['exclude_plan_id'] is not None:
            plan_exists = PlantingPlan.objects.filter(id=params['exclude_plan_id'], project=active_project).exists()
            if not plan_exists:
                return api_error_response(code='exclude_plan_not_found', detail='exclude_plan_id not found in active project.', status_code=status.HTTP_400_BAD_REQUEST)

        try:
            payload = calculate_remaining_bed_area(
                bed_id=params['bed_id'],
                start_date=params['start_date'],
                end_date=params['end_date'],
                exclude_plan_id=params['exclude_plan_id'],
            )
        except ValueError as error:
            return api_error_response(code='invalid_remaining_area_interval', detail=str(error), status_code=status.HTTP_400_BAD_REQUEST)
        except Bed.DoesNotExist:
            return api_error_response(code='bed_not_found', detail='Bed not found.', status_code=status.HTTP_404_NOT_FOUND)

        return Response({
            'bed_id': payload['bed_id'],
            'bed_area_sqm': float(payload['bed_area_sqm']),
            'overlapping_used_area_sqm': float(payload['overlapping_used_area_sqm']),
            'remaining_area_sqm': float(payload['remaining_area_sqm']),
            'start_date': params['start_date'].isoformat(),
            'end_date': params['end_date'].isoformat(),
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
