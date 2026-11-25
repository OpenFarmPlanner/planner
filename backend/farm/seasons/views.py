"""API endpoints for the seasons domain: seasons, the season pattern, and
the first-run setup that migrates a project's unassigned planting plans."""

from datetime import date, timedelta

from django.db import transaction
from django.db.models import Count, Value
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from config.languages import resolve_request_language
from config.responses import api_error_response
from farm.common.mixins import ProjectRevisionMixin, ProjectScopedMixin
from farm.history import (
    _current_actor_label,
    _entity_display_name,
    _serialize_instance,
    record_entity_revision,
    start_batch_operation,
)
from farm.history.project_restore import (
    capture_project_state,
    ensure_project_checkpoint,
    record_project_checkpoint,
)
from farm.history.records import internal_project_versions
from farm.history.restore import (
    SEASON_TASK_BEFORE,
    _record_cascade_deletions,
)
from farm.models import BatchOperation, EntityRevision, PlantingPlan, Season, SeasonPattern, Task
from farm.project_context import get_active_project_or_400
from farm.services.crop_inheritance import lock_crop_project
from farm.services.crop_rotation import COPY_CONFLICTS_KEEP, RotationService, preview_season_copy
from farm.services.parcel_rotation_copy import ParcelRotationConflict, preview_parcel_rotation
from farm.services.seasons import (
    analyze_period_transition,
    build_planting_plan_copies,
    build_season_creation_options,
    compute_custom_season_period,
    compute_first_future_pattern_period,
    compute_preview_periods,
    compute_setup_target_period,
    copy_planting_plans,
    create_or_resurrect_season,
    distribute_planting_plans,
    find_due_but_missing_season,
    find_soft_deleted_season,
    get_or_create_season_for_period,
    get_or_create_season_pattern,
    is_historical_copy_period,
    latest_existing_season,
    preceding_season_copy_source,
    restore_season_contents,
    resurrect_season,
    season_pattern_for_planning,
    serialize_period_transition,
    synchronize_season_harvest_tasks,
)
from farm.services.tasks import generate_tasks_for_plans

from .serializers import (
    CreateTransitionSeasonsSerializer,
    SeasonCopyDateBasisSerializer,
    SeasonCopyFromSerializer,
    SeasonCreateAndCopySerializer,
    SeasonCreationOptionsSerializer,
    SeasonPatternSerializer,
    SeasonSerializer,
)


class ParcelRotationConfirmationRequired(APIException):
    status_code = status.HTTP_409_CONFLICT

    def __init__(self):
        super().__init__({
            'code': 'parcel_rotation_preview_changed',
            'detail': 'Refresh the parcel rotation preview before copying.',
        })


def _confirmed_rotation(options: dict) -> str | None:
    if options.get('rotate_parcels'):
        return options.get('parcel_rotation_fingerprint', '')
    return None


class SeasonViewSet(ProjectScopedMixin, ProjectRevisionMixin, viewsets.ModelViewSet):
    """CRUD for project-scoped seasons, plus copy-data and due-suggestion actions."""

    queryset = (
        Season.objects
        .annotate(planting_plan_count=Count('planting_plans'))
        .order_by('-start_date')
    )
    serializer_class = SeasonSerializer

    @transaction.atomic
    def perform_create(self, serializer):
        current_user = self.request.user if self.request.user.is_authenticated else None
        project = self.request.active_project

        # A soft-deleted season still occupies its (project, start_date) slot via
        # the unique constraint, and the active-only overlap check in the
        # serializer cannot see it. Resurrect it instead of hitting an
        # IntegrityError when the same period is created again.
        resurrected = find_soft_deleted_season(project, serializer.validated_data['start_date'])
        if resurrected is not None:
            batch = start_batch_operation(
                project=project, operation_type=BatchOperation.TYPE_SEASON_CREATE,
                context={'season_label': resurrected.label},
                user_name=_current_actor_label(request=self.request),
            )
            resurrect_season(
                resurrected, serializer.validated_data['end_date'], current_user, batch,
                user_name=_current_actor_label(request=self.request),
            )
            serializer.instance = (
                Season.objects
                .annotate(planting_plan_count=Count('planting_plans'))
                .get(pk=resurrected.pk)
            )
            return

        instance = serializer.save(project=project, created_by=current_user)
        batch = start_batch_operation(
            project=project, operation_type=BatchOperation.TYPE_SEASON_CREATE,
            context={'season_label': instance.label},
            user_name=_current_actor_label(request=self.request),
        )
        synchronize_season_harvest_tasks(instance)
        self.record_revision(instance, EntityRevision.ACTION_CREATED, batch_operation=batch)

    @transaction.atomic
    def perform_update(self, serializer):
        previous = serializer.instance
        snapshot = _serialize_instance(previous)
        previous_period = (previous.start_date, previous.end_date)
        instance = serializer.save()
        if previous_period != (instance.start_date, instance.end_date):
            synchronize_season_harvest_tasks(instance, previous_period=previous_period)
        self.record_revision(instance, EntityRevision.ACTION_UPDATED, previous_snapshot=snapshot)

    def destroy(self, request, *args, **kwargs):
        season = self.get_object()
        if season.deleted_at is not None:
            return Response(status=status.HTTP_204_NO_CONTENT)
        snapshot = _serialize_instance(season)
        display_name = _entity_display_name(season)
        with transaction.atomic():
            # A season "contains" its planting plans, so deleting it deletes
            # them too. They are hard-deleted (PlantingPlan has no soft-delete),
            # but each deletion is recorded so version history / point-in-time
            # restore and this season's own undelete can bring them back. All
            # those revisions are grouped under one BatchOperation so the
            # cascade shows up as a single collapsible history entry.
            batch = start_batch_operation(
                project=self.request.active_project,
                operation_type=BatchOperation.TYPE_SEASON_DELETE,
                context={'season_label': season.label},
                user_name=_current_actor_label(request),
            )
            season.deleted_at = timezone.now()
            season.save(update_fields=["deleted_at", "updated_at"])
            with internal_project_versions():
                self._delete_planting_plans_with_season(season, batch)
            # Tasks of other plans stay attached to this temporarily hidden season.
            self.record_revision(
                season,
                EntityRevision.ACTION_DELETED,
                previous_snapshot=snapshot,
                display_name=display_name,
                changed_fields=["deleted_at"],
                batch_operation=batch,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)

    def _delete_planting_plans_with_season(self, season: Season, batch: BatchOperation) -> None:
        plan_rows = PlantingPlan.objects.filter(project_id=season.project_id, season=season)
        plans = list(plan_rows.select_related('crop', 'bed'))
        for plan in plans:
            self.record_revision(
                plan, EntityRevision.ACTION_DELETED,
                object_id=plan.pk, snapshot=_serialize_instance(plan),
                display_name=_entity_display_name(plan), changed_fields=[],
                batch_operation=batch,
            )
        # Preserve generated source identities while the plans are absent.
        task_rows = Task.objects.filter(project_id=season.project_id, planting_plan__in=plans)
        tasks = list(task_rows)
        generated_ids = [task.pk for task in tasks if task.source_key]
        Task.objects.filter(project_id=season.project_id, pk__in=generated_ids).update(
            planting_plan=None,
            deleted_at=Coalesce('deleted_at', Value(season.deleted_at)),
            updated_at=season.deleted_at,
        )
        for task in tasks:
            snapshot = _serialize_instance(task)
            if task.source_key:
                # The Task instance still holds the two values changed by the bulk update.
                snapshot[SEASON_TASK_BEFORE] = {
                    'deleted_at': task.deleted_at.isoformat() if task.deleted_at else None,
                    'planting_plan_id': task.planting_plan_id,
                }
            self.record_revision(
                task, EntityRevision.ACTION_DELETED,
                object_id=task.pk, snapshot=snapshot,
                display_name=task.title, changed_fields=[], batch_operation=batch,
            )
        _record_cascade_deletions(
            self.request.active_project, plans, batch, _current_actor_label(self.request),
        )
        task_rows.filter(source_key='').delete()
        plan_rows.delete()

    @action(detail=True, methods=['post'], url_path='undelete')
    def undelete(self, request, pk=None):
        season = Season.all_objects.filter(project=self.request.active_project).filter(pk=pk).first()
        if season is None:
            return api_error_response(code='season_not_found', detail='Season not found.', status_code=status.HTTP_404_NOT_FOUND)
        if season.deleted_at is not None:
            with transaction.atomic():
                batch = start_batch_operation(
                    project=self.request.active_project,
                    operation_type=BatchOperation.TYPE_SEASON_UNDELETE,
                    context={'season_label': season.label},
                    user_name=_current_actor_label(request),
                )
                season.deleted_at = None
                season.save(update_fields=['deleted_at', 'updated_at'])
                restore_season_contents(season, batch, user_name=_current_actor_label(request))
                self.record_revision(
                    season, EntityRevision.ACTION_UPDATED,
                    changed_fields=['deleted_at'], batch_operation=batch,
                )
        return Response(SeasonSerializer(season).data)

    @staticmethod
    def _invalid_copy_source_id() -> Response:
        return api_error_response(
            code='invalid_source_season_id', detail='source_season_id must be an integer.',
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    @staticmethod
    def _invalid_copy_options(errors) -> Response:
        return api_error_response(
            code='invalid_season_copy_options', detail='Invalid season copy options.',
            status_code=status.HTTP_400_BAD_REQUEST, fields=errors,
        )

    def _get_copy_source(self, source_season_id: object) -> Season | Response:
        try:
            source_pk = int(source_season_id)
        except (TypeError, ValueError):
            return self._invalid_copy_source_id()
        source_season = Season.objects.filter(
            project=self.request.active_project, pk=source_pk,
        ).first()
        if source_season is None:
            return api_error_response(
                code='source_season_not_found', detail='Source season not found.',
                status_code=status.HTTP_404_NOT_FOUND,
            )
        return source_season

    def _resolve_existing_copy_source(
        self, target_season: Season, source_id: object,
    ) -> Season | Response:
        source_season = self._get_copy_source(source_id)
        if isinstance(source_season, Response):
            return source_season
        if source_season.pk == target_season.pk:
            return api_error_response(
                code='same_source_and_target_season',
                detail='Source and target season must be different.',
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        if not is_historical_copy_period(source_season, target_season.start_date):
            return self._copy_source_not_earlier()
        return source_season

    @staticmethod
    def _copy_source_not_earlier() -> Response:
        return api_error_response(
            code='season_copy_source_not_earlier',
            detail='The source season must end before the target season starts.',
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    def _resolve_creation_copy_source(
        self, target_start: date, source_id: object,
    ) -> Season | Response:
        source_season = self._get_copy_source(source_id)
        if isinstance(source_season, Response):
            return source_season
        if not is_historical_copy_period(source_season, target_start):
            return self._copy_source_not_earlier()
        return source_season

    @action(detail=True, methods=['get'], url_path='copy-preview')
    def copy_preview(self, request, pk=None):
        """Preview a historical source, or resolve the predecessor for older clients."""
        target_season = self.get_object()
        source_id = request.query_params.get('source_season_id')
        preceding = preceding_season_copy_source(request.active_project, target_season.start_date)
        if source_id is None and request.query_params.get('resolve_source') == 'true':
            if preceding is None:
                return api_error_response(
                    code='season_copy_no_preceding_source',
                    detail='There is no immediately preceding season to copy from.',
                    status_code=status.HTTP_400_BAD_REQUEST,
                )
            source_season = preceding
        else:
            source_season = self._resolve_existing_copy_source(target_season, source_id)
        if isinstance(source_season, Response):
            return source_season
        options = SeasonCopyDateBasisSerializer(data=request.query_params)
        if not options.is_valid():
            return self._invalid_copy_options(options.errors)
        pairs, skipped_count, continuing_count, unconfigured_count = build_planting_plan_copies(
            source_season=source_season, target_season=target_season,
            use_actual_dates=options.validated_data['use_actual_dates'],
        )
        parcel_rotation = preview_parcel_rotation(
            source_season, target_season, pairs, preceding=source_season == preceding,
            requested=options.validated_data.get('rotate_parcels', False),
            continuing_count=continuing_count,
            language_code=resolve_request_language(request),
        )
        crop_rotation = parcel_rotation.summary.get('crop_rotation')
        if crop_rotation is None:
            service = RotationService(
                target_season.project_id,
                language_code=resolve_request_language(request),
                region=self.request.active_project.region or '',
            )
            crop_rotation = preview_season_copy(service, parcel_rotation.pairs)
        return Response({
            **crop_rotation,
            'skipped_count': skipped_count,
            'continuing_count': continuing_count,
            'unconfigured_perennial_count': unconfigured_count,
            'source_season_id': source_season.pk,
            'source_season_label': source_season.label,
            'is_preceding_source': source_season == preceding,
            'parcel_rotation': parcel_rotation.summary,
        })

    @action(detail=True, methods=['post'], url_path='copy-from', history_read_only=True)
    @transaction.atomic
    def copy_from(self, request, pk=None):
        # Ordinary project mutations already take this lock with their history
        # checkpoint. Validate under that lock before creating any checkpoint.
        lock_crop_project(request.active_project.pk)
        target_season = self.get_object()
        serializer = SeasonCopyFromSerializer(data=request.data)
        if not serializer.is_valid():
            if 'source_season_id' in serializer.errors:
                return self._invalid_copy_source_id()
            return self._invalid_copy_options(serializer.errors)
        source_season = self._resolve_existing_copy_source(
            target_season, serializer.validated_data['source_season_id'],
        )
        if isinstance(source_season, Response):
            return source_season

        ensure_project_checkpoint(request.active_project, user_name=_current_actor_label(request))
        return Response(self._copy_plans(
            source_season, target_season, serializer.validated_data['rotation_conflicts'],
            use_actual_dates=serializer.validated_data['use_actual_dates'],
            parcel_rotation_fingerprint=_confirmed_rotation(serializer.validated_data),
        ))

    @action(
        detail=False, methods=['post'], url_path='create-and-copy',
        history_read_only=True, serializer_class=SeasonCreateAndCopySerializer,
    )
    @transaction.atomic
    def create_and_copy(self, request):
        """Create a suggested season and copy from the source the user confirmed."""
        lock_crop_project(request.active_project.pk)
        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            if 'source_season_id' in serializer.errors:
                return self._invalid_copy_source_id()
            if 'use_actual_dates' in serializer.errors:
                return self._invalid_copy_options(serializer.errors)
            raise ValidationError(serializer.errors)
        source_season = self._resolve_creation_copy_source(
            serializer.validated_data['start_date'],
            serializer.validated_data['source_season_id'],
        )
        if isinstance(source_season, Response):
            return source_season

        ensure_project_checkpoint(request.active_project, user_name=_current_actor_label(request))
        self.perform_create(serializer)
        result = self._copy_plans(
            source_season, serializer.instance,
            use_actual_dates=serializer.validated_data['use_actual_dates'],
            parcel_rotation_fingerprint=_confirmed_rotation(serializer.validated_data),
        )
        serializer.instance.planting_plan_count = result['target_planting_plan_count']
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def _copy_plans(
        self, source_season: Season, target_season: Season,
        rotation_conflicts: str = COPY_CONFLICTS_KEEP,
        *, use_actual_dates: bool = False,
        parcel_rotation_fingerprint: str | None = None,
    ) -> dict[str, int]:
        try:
            result = copy_planting_plans(
                source_season=source_season, target_season=target_season,
                rotation_conflicts=rotation_conflicts,
                language_code=resolve_request_language(self.request),
                use_actual_dates=use_actual_dates,
                parcel_rotation_fingerprint=parcel_rotation_fingerprint,
            )
        except ParcelRotationConflict as exc:
            raise ParcelRotationConfirmationRequired() from exc
        created_plans, skipped_count, continuing_count, unconfigured_count = result
        if created_plans:
            # Group the created revisions while keeping each copy individually restorable.
            batch = start_batch_operation(
                project=self.request.active_project,
                operation_type=BatchOperation.TYPE_SEASON_COPY_DATA,
                context={
                    'source_season_label': source_season.label,
                    'target_season_label': target_season.label,
                },
                user_name=_current_actor_label(self.request),
            )
            for plan in (
                PlantingPlan.objects
                .filter(pk__in=[plan.pk for plan in created_plans])
                .select_related('crop', 'bed')
            ):
                self.record_revision(
                    plan, EntityRevision.ACTION_CREATED, batch_operation=batch,
                )
        total_count = PlantingPlan.objects.filter(season=target_season).count()
        return {
            'copied_count': len(created_plans),
            'skipped_count': skipped_count,
            'continuing_count': continuing_count,
            'unconfigured_perennial_count': unconfigured_count,
            'target_planting_plan_count': total_count,
        }

    @action(detail=False, methods=['get'], url_path='creation-options')
    def creation_options(self, request):
        """Describe the gap/overlap decision for the next season the user would create."""
        manual_start_param = request.query_params.get('manual_start_date')
        manual_start = None
        if manual_start_param:
            try:
                manual_start = date.fromisoformat(manual_start_param)
            except ValueError:
                return api_error_response(
                    code='invalid_manual_start_date',
                    detail='manual_start_date must be an ISO date (YYYY-MM-DD).',
                    status_code=status.HTTP_400_BAD_REQUEST,
                )

        options = SeasonCreationOptionsSerializer(data=request.query_params)
        if not options.is_valid():
            if 'source_season_id' in options.errors:
                return self._invalid_copy_source_id()
            return self._invalid_copy_options(options.errors)
        source = None
        if 'source_season_id' in options.validated_data:
            source = self._get_copy_source(options.validated_data['source_season_id'])
            if isinstance(source, Response):
                return source
        result = build_season_creation_options(
            request.active_project, manual_start=manual_start,
            use_actual_dates=options.validated_data['use_actual_dates'],
            copy_source=source,
            copy_target=options.validated_data.get('copy_target'),
            rotate_parcels=options.validated_data.get('rotate_parcels', False),
            language_code=resolve_request_language(request),
        )
        if result is None:
            return self._copy_source_not_earlier()
        if request.active_project.demo_seeded_at:
            result['preferred_active_season_id'] = (
                Season.objects.filter(project=request.active_project, planting_plans__isnull=False)
                .order_by('-start_date').values_list('pk', flat=True).first()
            )
        return Response(result)

    @action(detail=False, methods=['post'], url_path='create-transition', history_read_only=True)
    @transaction.atomic
    def create_transition(self, request):
        """Create the gap-filling transition season AND the regular follow-up
        season in one transaction, distributing the selected source's plans across
        both (each plan shifted once and routed to the season it lands in).
        """
        options = CreateTransitionSeasonsSerializer(data=request.data)
        if not options.is_valid():
            if 'source_season_id' in options.errors:
                return self._invalid_copy_source_id()
            return self._invalid_copy_options(options.errors)
        project = request.active_project
        lock_crop_project(project.pk)
        pattern = season_pattern_for_planning(project)
        latest_season = latest_existing_season(project)
        due_period = find_due_but_missing_season(project, pattern=pattern)
        if latest_season is None or due_period is None:
            return api_error_response(
                code='season_transition_not_applicable',
                detail='No transition season is applicable.',
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        due_start, due_end = due_period
        if analyze_period_transition(latest_season.end_date, due_start) is None:
            return api_error_response(
                code='season_transition_not_required',
                detail='There is no gap between the last season and the next pattern period.',
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        seamless_start, seamless_end = compute_custom_season_period(
            pattern, latest_season.end_date + timedelta(days=1),
        )
        current_periods = {
            'expected_transition': {'start_date': seamless_start, 'end_date': seamless_end},
            'expected_followup': {'start_date': due_start, 'end_date': due_end},
        }
        if any(options.validated_data.get(key, period) != period
               for key, period in current_periods.items()):
            return api_error_response(
                code='season_transition_period_changed',
                detail='The transition periods have changed. Refresh the creation options.',
                status_code=status.HTTP_409_CONFLICT,
            )
        source = None
        if options.validated_data['copy']:
            source = self._resolve_creation_copy_source(
                seamless_start, options.validated_data.get('source_season_id', latest_season.pk),
            )
            if isinstance(source, Response):
                return source
        user = request.user if request.user.is_authenticated else None
        ensure_project_checkpoint(project, user_name=_current_actor_label(request))

        transition_label = Season(start_date=seamless_start, end_date=seamless_end).computed_label
        batch = start_batch_operation(
            project=project, operation_type=BatchOperation.TYPE_SEASON_CREATE,
            context={'season_label': transition_label},
            user_name=_current_actor_label(request=request),
        )
        actor_label = _current_actor_label(request=request)
        transition_season = create_or_resurrect_season(
            project, seamless_start, seamless_end, user, batch, user_name=actor_label,
        )
        followup_season = create_or_resurrect_season(
            project, due_start, due_end, user, batch, user_name=actor_label,
        )
        distribution = {'transition': [], 'followup': [], 'skipped': 0}
        if source is not None:
            distribution = self._copy_transition_plans(
                source, transition_season, followup_season, options.validated_data,
            )
            created_ids = [
                plan.pk
                for plan in (*distribution['transition'], *distribution['followup'])
            ]
            for plan in (
                PlantingPlan.objects
                .filter(pk__in=created_ids)
                .select_related('crop', 'bed')
            ):
                self.record_revision(plan, EntityRevision.ACTION_CREATED, batch_operation=batch)

        annotated = (
            Season.objects
            .annotate(planting_plan_count=Count('planting_plans'))
            .in_bulk([transition_season.pk, followup_season.pk])
        )
        return Response({
            'transition_season': SeasonSerializer(annotated[transition_season.pk]).data,
            'followup_season': SeasonSerializer(annotated[followup_season.pk]).data,
            'transition_copied_count': len(distribution['transition']),
            'followup_copied_count': len(distribution['followup']),
            'skipped_count': distribution['skipped'],
            'continuing_count': distribution.get('continuing_count', 0),
            'unconfigured_perennial_count': distribution.get('unconfigured_perennial_count', 0),
        }, status=status.HTTP_201_CREATED)

    def _copy_transition_plans(self, source, transition, followup, validated_data):
        try:
            return distribute_planting_plans(
                source_season=source, transition_season=transition, followup_season=followup,
                use_actual_dates=validated_data['use_actual_dates'],
                parcel_rotation_fingerprint=_confirmed_rotation(validated_data),
                language_code=resolve_request_language(self.request),
            )
        except ParcelRotationConflict as exc:
            raise ParcelRotationConfirmationRequired() from exc

    @action(detail=False, methods=['get'], url_path='due-suggestion')
    def due_suggestion(self, request):
        due_period = find_due_but_missing_season(self.request.active_project)
        if due_period is None:
            return Response({'due': False})
        start_date, end_date = due_period
        return Response({
            'due': True,
            'start_date': start_date.isoformat(),
            'end_date': end_date.isoformat(),
        })


class SeasonPatternView(APIView):
    """Get/update the project's season pattern, and preview computed periods."""

    def get(self, request):
        active_project = get_active_project_or_400(request)
        pattern = get_or_create_season_pattern(active_project)
        return Response(SeasonPatternSerializer(pattern).data)

    def patch(self, request):
        active_project = get_active_project_or_400(request)
        pattern = get_or_create_season_pattern(active_project)
        serializer = SeasonPatternSerializer(pattern, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        ensure_project_checkpoint(active_project, user_name=_current_actor_label(request))
        pattern._history_user_name = _current_actor_label(request)
        serializer.save()
        return Response(serializer.data)


class SeasonPatternPreviewView(APIView):
    """Preview the previous/current/next computed periods for a (possibly unsaved) pattern."""

    def get(self, request):
        active_project = get_active_project_or_400(request)
        pattern = get_or_create_season_pattern(active_project)
        start_day = request.query_params.get('start_day')
        start_month = request.query_params.get('start_month')
        if start_day is not None:
            try:
                pattern.start_day = int(start_day)
            except ValueError:
                return api_error_response(code='invalid_start_day', detail='start_day must be an integer.', status_code=status.HTTP_400_BAD_REQUEST)
        if start_month is not None:
            try:
                pattern.start_month = int(start_month)
            except ValueError:
                return api_error_response(code='invalid_start_month', detail='start_month must be an integer.', status_code=status.HTTP_400_BAD_REQUEST)

        periods = compute_preview_periods(pattern, date.today())
        latest_season = latest_existing_season(active_project)
        reference_season = None
        transition = None
        if latest_season is not None:
            reference_season = {
                'start_date': latest_season.start_date.isoformat(),
                'end_date': latest_season.end_date.isoformat(),
                'label': latest_season.label,
            }
            future_start, _ = compute_first_future_pattern_period(pattern, latest_season)
            raw_transition = analyze_period_transition(latest_season.end_date, future_start)
            if raw_transition is not None:
                transition = serialize_period_transition(raw_transition)
        return Response({
            'periods': [
                {
                    'start_date': period['start_date'].isoformat(),
                    'end_date': period['end_date'].isoformat(),
                    'is_current': period['is_current'],
                }
                for period in periods
            ],
            'reference_season': reference_season,
            'transition': transition,
        })


class SeasonSetupStatusView(APIView):
    """Report whether the project still needs the first-run season setup."""

    def get(self, request):
        active_project = get_active_project_or_400(request)
        unassigned_count = PlantingPlan.objects.filter(project=active_project, season__isnull=True).count()
        pattern = get_or_create_season_pattern(active_project)
        preview_pattern = pattern
        start_day_param = request.query_params.get('start_day')
        start_month_param = request.query_params.get('start_month')
        if start_day_param is not None or start_month_param is not None:
            try:
                preview_pattern = SeasonPattern(
                    start_day=int(start_day_param) if start_day_param is not None else pattern.start_day,
                    start_month=int(start_month_param) if start_month_param is not None else pattern.start_month,
                )
            except ValueError:
                return api_error_response(code='invalid_season_pattern', detail='start_day and start_month must be integers.', status_code=status.HTTP_400_BAD_REQUEST)
        target_start, target_end = compute_setup_target_period(active_project, preview_pattern)
        return Response({
            'needs_setup': unassigned_count > 0,
            'unassigned_planting_plan_count': unassigned_count,
            'start_day': pattern.start_day,
            'start_month': pattern.start_month,
            'computed_start_date': target_start.isoformat(),
            'computed_end_date': target_end.isoformat(),
        })


class SeasonSetupApplyView(APIView):
    """Apply the first-run season setup: save the pattern and assign existing plans."""

    def post(self, request: Request) -> Response:
        active_project = get_active_project_or_400(request)
        try:
            start_day = int(request.data.get('start_day'))
            start_month = int(request.data.get('start_month'))
        except (TypeError, ValueError):
            return api_error_response(code='season_pattern_required', detail='start_day and start_month are required integers.', status_code=status.HTTP_400_BAD_REQUEST)

        pattern_serializer = SeasonPatternSerializer(
            get_or_create_season_pattern(active_project),
            data={'start_day': start_day, 'start_month': start_month},
            partial=True,
        )
        pattern_serializer.is_valid(raise_exception=True)
        ensure_project_checkpoint(active_project, user_name=_current_actor_label(request))
        pattern_serializer.instance._history_user_name = _current_actor_label(request)
        pattern_serializer.instance._history_internal = True
        pattern = pattern_serializer.save()

        start_date, end_date = compute_setup_target_period(active_project, pattern)
        season = get_or_create_season_for_period(
            active_project,
            start_date,
            end_date,
            created_by=request.user if request.user.is_authenticated else None,
            user_name=_current_actor_label(request),
        )
        unassigned = PlantingPlan.objects.filter(project=active_project, season__isnull=True)
        assigned_ids = list(unassigned.values_list('pk', flat=True))
        assigned_count = unassigned.update(season=season, updated_at=timezone.now())
        for plan in PlantingPlan.objects.filter(pk__in=assigned_ids).select_related('crop', 'bed'):
            record_entity_revision(
                project=active_project, entity_type='planting_plan', object_id=plan.pk,
                action=EntityRevision.ACTION_UPDATED,
                snapshot={**_serialize_instance(plan), '_project_version_internal': True},
                display_name=_entity_display_name(plan), changed_fields=['season_id'],
                user_name=_current_actor_label(request),
            )

        generate_tasks_for_plans(
            PlantingPlan.objects.filter(project=active_project, season=season)
            .select_related('crop', 'season'),
        )
        record_project_checkpoint(
            active_project, capture_project_state(active_project),
            user_name=_current_actor_label(request), action=EntityRevision.ACTION_UPDATED,
        )
        return Response({
            'season': SeasonSerializer(Season.objects.annotate(planting_plan_count=Count('planting_plans')).get(pk=season.pk)).data,
            'assigned_planting_plan_count': assigned_count,
            'start_day': pattern.start_day,
            'start_month': pattern.start_month,
        })
