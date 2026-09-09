"""API endpoints for the farm structure domain (locations, fields, beds, layouts)."""

import logging

from django.db import IntegrityError
from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from config.responses import api_error_response
from farm.common.mixins import ProjectRevisionMixin, ProjectScopedMixin
from farm.history import _serialize_instance
from farm.models import Bed, BedLayout, EntityRevision, Field, FieldLayout, Location
from farm.project_context import get_active_project_or_400
from farm.services.bed_layouts import extract_layout_payloads, save_location_layouts

from .serializers import (
    BED_NAME_DUPLICATE_MESSAGE,
    FIELD_NAME_DUPLICATE_MESSAGE,
    BedLayoutSerializer,
    BedSerializer,
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

    def perform_destroy(self, instance):
        instance_id = instance.pk
        snapshot = _serialize_instance(instance)
        name = instance.name
        instance.delete()
        self.record_revision(
            instance, EntityRevision.ACTION_DELETED,
            object_id=instance_id, snapshot=snapshot, display_name=name, changed_fields=[],
        )
