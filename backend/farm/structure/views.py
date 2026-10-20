"""API endpoints for the farm structure domain (locations, fields, beds, layouts)."""

import logging

from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from config.responses import api_error_response
from farm.common.mixins import ProjectRevisionMixin, ProjectScopedMixin
from farm.history import _serialize_instance
from farm.models import Bed, BedLayout, EntityRevision, Field, FieldLayout, Location
from farm.project_context import get_active_project_or_400
from farm.services.bed_layouts import extract_layout_payloads, save_location_layouts
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

class BedLayoutByLocationView(APIView):
    """GET/PUT bed and field layout entries for a given location."""

    def get(self, request, location_id: int):
        active_project = get_active_project_or_400(request)
        location = get_object_or_404(Location, pk=location_id, project=active_project)
        bed_layouts = BedLayout.objects.filter(location=location).select_related('bed__field')
        field_layouts = FieldLayout.objects.filter(location=location).select_related('field')
        return Response(
            {
                'bed_layouts': BedLayoutSerializer(bed_layouts, many=True).data,
                'field_layouts': FieldLayoutSerializer(field_layouts, many=True).data,
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

        outcome = save_location_layouts(location, bed_payload, field_payload)
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

    def perform_update(self, serializer):
        previous_snapshot = _serialize_instance(serializer.instance)
        try:
            instance = serializer.save()
        except IntegrityError as exc:
            raise DRFValidationError({'name': [FIELD_NAME_DUPLICATE_MESSAGE]}) from exc
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
            result = duplicate_field(
                source,
                name=data['name'],
                copy_beds=data['copy_beds'],
                search=data['replace_search'],
                replacement=data['replace_with'],
                on_created=lambda instance: self.record_revision(
                    instance, EntityRevision.ACTION_CREATED
                ),
            )
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

    def perform_destroy(self, instance):
        instance_id = instance.pk
        snapshot = _serialize_instance(instance)
        name = instance.name
        instance.delete()
        self.record_revision(
            instance, EntityRevision.ACTION_DELETED,
            object_id=instance_id, snapshot=snapshot, display_name=name, changed_fields=[],
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

    def perform_update(self, serializer):
        previous_snapshot = _serialize_instance(serializer.instance)
        try:
            instance = serializer.save()
        except IntegrityError as exc:
            raise DRFValidationError({'name': [BED_NAME_DUPLICATE_MESSAGE]}) from exc
        self.record_revision(instance, EntityRevision.ACTION_UPDATED, previous_snapshot=previous_snapshot)

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
        try:
            with transaction.atomic():
                for entry in serializer.validated_data['beds']:
                    bed = Bed.objects.create(
                        project=request.active_project,
                        field=field,
                        name=entry['name'],
                        length_m=entry['length_m'],
                        width_m=entry['width_m'],
                    )
                    self.record_revision(bed, EntityRevision.ACTION_CREATED)
                    created.append(bed)
        except IntegrityError as exc:
            raise DRFValidationError({'beds': [BED_NAME_DUPLICATE_MESSAGE]}) from exc
        return Response(
            BedSerializer(created, many=True).data, status=status.HTTP_201_CREATED
        )

    def perform_destroy(self, instance):
        instance_id = instance.pk
        snapshot = _serialize_instance(instance)
        name = instance.name
        instance.delete()
        self.record_revision(
            instance, EntityRevision.ACTION_DELETED,
            object_id=instance_id, snapshot=snapshot, display_name=name, changed_fields=[],
        )
