"""API endpoints for the farm structure domain (locations, fields, beds, layouts)."""

import logging

from django.core import signing
from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from config.responses import api_error_response
from farm.common.mixins import ProjectRevisionMixin, ProjectScopedMixin
from farm.history import _current_actor_label, _serialize_instance, record_entity_revision
from farm.history.project_restore import ensure_project_checkpoint
from farm.history.records import internal_project_versions
from farm.models import Bed, BedLayout, EntityRevision, Field, FieldLayout, Location, PlantingPlan
from farm.planning.individual_planting import (
    lock_individual_parcel,
    validate_individual_bed_dimensions,
    validate_individual_parcel_dimensions,
)
from farm.project_context import get_active_project_or_400
from farm.services.bed_layouts import (
    create_bed_layout,
    extract_layout_payloads,
    lock_layout_parcels,
    move_bed_layouts,
    parse_location_boundary,
    preserve_relocated_bed_layouts,
    save_location_boundary,
    save_location_layouts,
    serialize_location_boundary,
)
from farm.services.field_duplication import (
    BedNameConflictError,
    FieldNameTakenError,
    InvalidBedNameError,
    duplicate_field,
)

from .serializers import (
    BED_NAME_DUPLICATE_MESSAGE,
    FIELD_NAME_DUPLICATE_MESSAGE,
    BedLayoutSerializer,
    BedSerializer,
    BulkBedCreateSerializer,
    FieldDuplicateSerializer,
    FieldLayoutSerializer,
    FieldSerializer,
    LocationSerializer,
)

logger = logging.getLogger(__name__)
BULK_BED_UNDO_SALT = 'farm.bulk_bed_create.undo'
BULK_BED_UNDO_HEADER = 'X-Bulk-Bed-Undo'

class BedLayoutByLocationView(APIView):
    """GET/PUT bed and field layout entries for a given location."""

    def get(self, request, location_id: int):
        active_project = get_active_project_or_400(request)
        location = get_object_or_404(Location, pk=location_id, project=active_project)
        # Bed offsets are relative to their parcel and survive a parcel move.
        bed_layouts = BedLayout.objects.filter(
            project=active_project, bed__project=active_project,
            bed__field__project=active_project, bed__field__location=location,
        ).select_related('bed__field')
        field_layouts = FieldLayout.objects.filter(location=location).select_related('field')
        return Response(
            {
                'bed_layouts': BedLayoutSerializer(bed_layouts, many=True).data,
                'field_layouts': FieldLayoutSerializer(field_layouts, many=True).data,
                'location_boundary': serialize_location_boundary(location),
            }
        )

    def put(self, request, location_id: int):
        active_project = get_active_project_or_400(request)
        location = get_object_or_404(Location, pk=location_id, project=active_project)
        bed_payload, field_payload = extract_layout_payloads(request.data)

        if not isinstance(bed_payload, list) or not isinstance(field_payload, list):
            return api_error_response(
                code='invalid_layout_collections',
                detail='Expected lists under "bed_layouts" and "field_layouts".',
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        boundary_present, boundary_origin, boundary_error = parse_location_boundary(request.data)
        if boundary_error:
            return api_error_response(
                code='invalid_location_boundary',
                detail=boundary_error,
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        ensure_project_checkpoint(active_project)
        outcome = save_location_layouts(
            location, bed_payload, field_payload, user_name=_current_actor_label(request)
        )
        if boundary_present and not outcome.error_detail and save_location_boundary(
            location, boundary_origin, user_name=_current_actor_label(request)
        ):
            outcome.changed_count += 1
        if outcome.changed_count:
            record_entity_revision(
                project=active_project, entity_type='project', object_id=active_project.pk,
                action=EntityRevision.ACTION_UPDATED, snapshot={},
                display_name=active_project.name, user_name=_current_actor_label(request),
            )
        if outcome.error_detail:
            return api_error_response(
                code='invalid_location_layout',
                detail=outcome.error_detail,
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            {
                'bed_layouts': BedLayoutSerializer(outcome.bed_layouts, many=True).data,
                'field_layouts': FieldLayoutSerializer(outcome.field_layouts, many=True).data,
                'location_boundary': serialize_location_boundary(location),
            },
            status=status.HTTP_200_OK,
        )


class LocationViewSet(ProjectScopedMixin, ProjectRevisionMixin, viewsets.ModelViewSet):
    """ViewSet for Location model providing CRUD operations.
    
    Provides list, create, retrieve, update, and delete operations
    for farm locations. All locations are returned without filtering.
    
    Attributes:
        queryset: All Location objects ordered by name
        serializer_class: LocationSerializer for serialization
    """

    # Read-only for project-bound API tokens: agents may look these up to
    # resolve references, but changing them stays session-only in this
    # version (see farm/agent_api/permissions.py).
    api_token_actions = {'list', 'retrieve'}
    queryset = Location.objects.all()
    serializer_class = LocationSerializer
    ensure_default_location = True

    def perform_create(self, serializer):
        instance = serializer.save(project=self.request.active_project)
        self.record_revision(instance, EntityRevision.ACTION_CREATED)

    @transaction.atomic
    def perform_destroy(self, instance):
        preserve_relocated_bed_layouts(instance, user_name=_current_actor_label(self.request))
        super().perform_destroy(instance)


class FieldViewSet(ProjectScopedMixin, ProjectRevisionMixin, viewsets.ModelViewSet):
    """ViewSet for Field model providing CRUD operations.
    
    Provides list, create, retrieve, update, and delete operations
    for fields within locations.
    
    Attributes:
        queryset: All Field objects ordered by location and name
        serializer_class: FieldSerializer for serialization
    """

    # Read-only for project-bound API tokens: agents may look these up to
    # resolve references, but changing them stays session-only in this
    # version (see farm/agent_api/permissions.py).
    api_token_actions = {'list', 'retrieve'}
    queryset = Field.objects.select_related('location').all()
    serializer_class = FieldSerializer

    def perform_create(self, serializer):
        try:
            instance = serializer.save(project=self.request.active_project)
        except IntegrityError as exc:
            raise DRFValidationError({'name': [FIELD_NAME_DUPLICATE_MESSAGE]}) from exc
        self.record_revision(instance, EntityRevision.ACTION_CREATED)

    @transaction.atomic
    def perform_update(self, serializer):
        serializer.instance = lock_individual_parcel(serializer.instance)
        validate_individual_parcel_dimensions(serializer.instance, serializer.validated_data)
        previous_snapshot = _serialize_instance(serializer.instance)
        previous_location_id = serializer.instance.location_id
        try:
            instance = serializer.save()
        except IntegrityError as exc:
            raise DRFValidationError({'name': [FIELD_NAME_DUPLICATE_MESSAGE]}) from exc
        if instance.location_id != previous_location_id:
            move_bed_layouts(
                BedLayout.objects.filter(project_id=instance.project_id, bed__field=instance),
                instance.location_id, user_name=_current_actor_label(self.request),
            )
        self.record_revision(instance, EntityRevision.ACTION_UPDATED, previous_snapshot=previous_snapshot)

    @action(detail=True, methods=['post'], url_path='duplicate')
    def duplicate(self, request, pk: str | None = None) -> Response:
        """Copy a field and, on request, its beds in one transaction ("Parzelle duplizieren").

        Returns 409 when the new field name is taken in the location
        (`field_name_taken`) or when the find-and-replace would give two
        copied beds the same name (`bed_names_conflict`, with `names`).
        """
        source = self.get_object()
        serializer = FieldDuplicateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            with transaction.atomic():
                result = duplicate_field(
                    source,
                    name=data['name'],
                    copy_beds=data['copy_beds'],
                    search=data['replace_search'],
                    replacement=data['replace_with'],
                )
                with internal_project_versions():
                    for bed in result.beds:
                        self.record_revision(bed, EntityRevision.ACTION_CREATED)
                self.record_revision(result.field, EntityRevision.ACTION_CREATED)
        except FieldNameTakenError:
            return api_error_response(
                code='field_name_taken',
                detail=FIELD_NAME_DUPLICATE_MESSAGE,
                status_code=status.HTTP_409_CONFLICT,
            )
        except BedNameConflictError as exc:
            return api_error_response(
                code='bed_names_conflict',
                detail='The renamed beds would share a name in the new field.',
                status_code=status.HTTP_409_CONFLICT,
                names=exc.names,
            )
        except InvalidBedNameError as exc:
            return api_error_response(
                code='invalid_bed_names',
                detail='The renamed bed names must not be empty or longer than 200 characters.',
                status_code=status.HTTP_400_BAD_REQUEST,
                names=exc.names,
            )
        return Response(
            {
                'field': FieldSerializer(result.field, context=self.get_serializer_context()).data,
                'beds': BedSerializer(
                    result.beds, many=True, context=self.get_serializer_context()
                ).data,
            },
            status=status.HTTP_201_CREATED,
        )


class BedViewSet(ProjectScopedMixin, ProjectRevisionMixin, viewsets.ModelViewSet):
    """ViewSet for Bed model providing CRUD operations.
    
    Provides list, create, retrieve, update, and delete operations
    for beds within fields.
    
    Attributes:
        queryset: All Bed objects ordered by field and name
        serializer_class: BedSerializer for serialization
    """

    # Read-only for project-bound API tokens: agents may look these up to
    # resolve references, but changing them stays session-only in this
    # version (see farm/agent_api/permissions.py).
    api_token_actions = {'list', 'retrieve'}
    queryset = Bed.objects.select_related('field', 'field__location').all()
    serializer_class = BedSerializer

    def perform_create(self, serializer):
        try:
            instance = serializer.save(project=self.request.active_project)
        except IntegrityError as exc:
            raise DRFValidationError({'name': [BED_NAME_DUPLICATE_MESSAGE]}) from exc
        self.record_revision(instance, EntityRevision.ACTION_CREATED)

    @transaction.atomic
    def perform_update(self, serializer):
        bed = get_object_or_404(
            Bed.objects.select_for_update(no_key=True),
            pk=serializer.instance.pk, project_id=self.request.active_project.pk,
        )
        serializer.instance = bed
        validate_individual_bed_dimensions(bed, serializer.validated_data)
        previous_snapshot = _serialize_instance(bed)
        destination = serializer.validated_data.get('field')
        if destination is not None and destination.pk != bed.field_id:
            parcels = {parcel.pk: parcel for parcel in lock_layout_parcels(
                bed.project_id, {bed.field_id, destination.pk},
            )}
            destination = parcels.get(destination.pk)
            if destination is None:
                raise DRFValidationError({
                    'field': ['The destination parcel is no longer available.'],
                })
            serializer.validated_data['field'] = destination
        else:
            destination = None
        try:
            instance = serializer.save()
        except IntegrityError as exc:
            raise DRFValidationError({'name': [BED_NAME_DUPLICATE_MESSAGE]}) from exc
        if destination is not None:
            move_bed_layouts(
                BedLayout.objects.filter(project_id=instance.project_id, bed=instance),
                destination.location_id, user_name=_current_actor_label(self.request),
            )
        self.record_revision(
            instance, EntityRevision.ACTION_UPDATED, previous_snapshot=previous_snapshot,
        )

    @action(detail=False, methods=['post'], url_path='bulk-create')
    def bulk_create(self, request) -> Response:
        """Create a series of beds in one field atomically ("Mehrere Beete anlegen").

        All-or-nothing, so a failed name never leaves half a series behind,
        and one request instead of one per bed keeps a large series inside
        the per-account write throttle.
        """
        serializer = BulkBedCreateSerializer(
            data=request.data, context=self.get_serializer_context()
        )
        serializer.is_valid(raise_exception=True)
        field = serializer.validated_data['field']
        created: list[Bed] = []
        undo_snapshot: dict[int, list[str | None]] = {}
        user_name = _current_actor_label(request)
        try:
            with transaction.atomic():
                field = lock_individual_parcel(field)
                for entry in serializer.validated_data['beds']:
                    bed = Bed.objects.create(
                        project=request.active_project,
                        field=field,
                        name=entry['name'],
                        length_m=entry['length_m'],
                        width_m=entry['width_m'],
                    )
                    layout = None
                    if 'layout' in entry:
                        layout = create_bed_layout(bed, entry['layout'], user_name=user_name)
                    self.record_revision(bed, EntityRevision.ACTION_CREATED)
                    undo_snapshot[bed.pk] = [
                        bed.updated_at.isoformat(),
                        layout.updated_at.isoformat() if layout else None,
                    ]
                    created.append(bed)
        except IntegrityError as exc:
            raise DRFValidationError({'beds': [BED_NAME_DUPLICATE_MESSAGE]}) from exc
        token = signing.dumps({
            'project': request.active_project.pk, 'user': request.user.pk, 'beds': undo_snapshot,
        }, salt=BULK_BED_UNDO_SALT, compress=True)
        return Response(BedSerializer(created, many=True).data, status=status.HTTP_201_CREATED,
                        headers={BULK_BED_UNDO_HEADER: token})

    @action(detail=False, methods=['post'], url_path='undo-bulk-create')
    def undo_bulk_create(self, request) -> Response:
        """Remove a still unchanged batch, including its layouts, in one transaction."""
        token = request.data.get('token') if isinstance(request.data, dict) else None
        if not isinstance(token, str):
            raise DRFValidationError({'token': 'An undo token is required.'})
        try:
            snapshot = signing.loads(token, salt=BULK_BED_UNDO_SALT, max_age=600)
        except signing.BadSignature as exc:
            raise DRFValidationError({'token': 'The undo token is invalid or expired.'}) from exc
        project = request.active_project
        if snapshot['project'] != project.pk or snapshot['user'] != request.user.pk:
            raise DRFValidationError({'token': 'The undo token is invalid for this project.'})
        original = {int(bed_id): times for bed_id, times in snapshot['beds'].items()}
        with transaction.atomic():
            beds = list(Bed.objects.select_for_update().filter(
                project=project, pk__in=original,
            ).order_by('pk'))
            if not beds:
                return Response(status=status.HTTP_204_NO_CONTENT)
            layouts = dict(BedLayout.objects.select_for_update().filter(
                project=project, bed_id__in=original,
            ).order_by('bed_id').values_list('bed_id', 'updated_at'))
            unchanged = len(beds) == len(original) and all(
                original[bed.pk] == [
                    bed.updated_at.isoformat(),
                    layouts[bed.pk].isoformat() if bed.pk in layouts else None,
                ] for bed in beds
            )
            if not unchanged or PlantingPlan.objects.filter(bed_id__in=original).exists():
                return api_error_response(
                    code='bulk_bed_undo_conflict',
                    detail='The batch has changed or beds have planting plans.',
                    status_code=status.HTTP_409_CONFLICT,
                )
            for bed in beds:
                self.perform_destroy(bed)
        return Response(status=status.HTTP_204_NO_CONTENT)
