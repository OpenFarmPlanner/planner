"""API endpoints for suppliers and per-crop supplier data."""


from django.db import IntegrityError, transaction
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.request import Request
from rest_framework.response import Response

from config.responses import api_error_response
from farm.common.mixins import ProjectRevisionMixin, ProjectScopedMixin
from farm.history import (
    _serialize_instance,
)
from farm.models import (
    CropSupplierData,
    EntityRevision,
    Supplier,
)
from farm.services.suppliers import (
    DuplicateSupplierNameError,
    SupplierPayloadError,
    SupplierRestoreConflictError,
    SupplierRestoreFailedError,
    SUPPLIER_NAME_DUPLICATE_MESSAGE,
    build_delete_undo_payload,
    build_delete_usage,
    create_supplier,
    normalize_new_supplier_payload,
    restore_unlinked_supplier,
    unlink_supplier_references,
)

from ..serializers import (
    CropSupplierDataSerializer,
    SupplierSerializer,
)


class SupplierViewSet(ProjectScopedMixin, ProjectRevisionMixin, viewsets.ModelViewSet):
    """ViewSet for Supplier model providing CRUD operations.

    Provides list, create, retrieve, update, and delete operations
    for seed suppliers. Supports filtering by name via query parameter.
    POST endpoint rejects duplicate names within the active project.

    Attributes:
        queryset: All Supplier objects ordered by name
        serializer_class: SupplierSerializer for serialization
    """

    # Read-only for project-bound API tokens: agents may look these up to
    # resolve references, but changing them stays session-only in this
    # version (see farm/agent_api/permissions.py).
    api_token_actions = {'list', 'retrieve'}
    queryset = Supplier.objects.all()
    serializer_class = SupplierSerializer

    def perform_update(self, serializer: SupplierSerializer) -> None:
        previous_snapshot = _serialize_instance(serializer.instance)
        try:
            instance = serializer.save()
        except IntegrityError as exc:
            raise DRFValidationError({'name': [SUPPLIER_NAME_DUPLICATE_MESSAGE]}) from exc
        self.record_revision(instance, EntityRevision.ACTION_UPDATED, previous_snapshot=previous_snapshot)

    @action(detail=True, methods=['get'], url_path='delete-usage')
    def delete_usage(self, request: Request, pk: int | None = None) -> Response:
        supplier = self.get_object()
        return Response(build_delete_usage(supplier))

    def destroy(self, request: Request, *args: object, **kwargs: object) -> Response:
        """Delete the supplier and return the payload needed to restore it.

        The client offers an undo action after the delete, so the response
        carries the same undo payload as `unlink-and-delete` instead of an
        empty 204 body.
        """
        instance = self.get_object()
        usage = build_delete_usage(instance)
        if not usage['can_delete']:
            return api_error_response(
                code='supplier_in_use',
                detail='Supplier is still used and cannot be deleted.',
                status_code=status.HTTP_409_CONFLICT,
                usage=usage,
            )
        undo_payload = build_delete_undo_payload(instance)
        self.perform_destroy(instance)
        return Response({'undo_payload': undo_payload}, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='unlink-and-delete')
    def unlink_and_delete(self, request: Request, pk: int | None = None) -> Response:
        supplier = self.get_object()
        usage = build_delete_usage(supplier)
        undo_payload = build_delete_undo_payload(supplier)

        with transaction.atomic():
            unlink_supplier_references(supplier)
            supplier_id = supplier.pk
            supplier_snapshot = _serialize_instance(supplier)
            supplier_name = supplier.name
            supplier.delete()
            self.record_revision(
                supplier, EntityRevision.ACTION_DELETED,
                object_id=supplier_id, snapshot=supplier_snapshot, display_name=supplier_name, changed_fields=[],
            )

        return Response({
            'affected_crop_count': usage['total_crop_count'],
            'undo_payload': undo_payload,
        })

    @action(detail=False, methods=['post'], url_path='restore-unlinked-delete')
    def restore_unlinked_delete(self, request: Request) -> Response:
        payload = request.data if isinstance(request.data, dict) else {}
        try:
            result = restore_unlinked_supplier(
                project=request.active_project,
                payload=payload,
                record_restore=lambda supplier: self.record_revision(supplier, EntityRevision.ACTION_RESTORED),
            )
        except SupplierPayloadError as exc:
            raise DRFValidationError(exc.errors) from exc
        except SupplierRestoreConflictError:
            return api_error_response(
                code='supplier_restore_conflict',
                detail='Supplier cannot be restored because the id is already in use.',
                status_code=status.HTTP_409_CONFLICT,
            )
        except SupplierRestoreFailedError as exc:
            raise DRFValidationError({'detail': ['Supplier could not be restored.']}) from exc

        serializer = self.get_serializer(result.supplier)
        return Response({
            'supplier': serializer.data,
            'restored_crop_count': result.restored_crop_count,
            'restored_supplier_data_count': result.restored_supplier_data_count,
        })

    def perform_destroy(self, instance: Supplier) -> None:
        instance_id = instance.pk
        snapshot = _serialize_instance(instance)
        name = instance.name
        instance.delete()
        self.record_revision(
            instance, EntityRevision.ACTION_DELETED,
            object_id=instance_id, snapshot=snapshot, display_name=name, changed_fields=[],
        )

    def get_queryset(self):
        """Filter suppliers by name if query parameter is provided.

        :return: Filtered queryset based on query parameters
        """
        queryset = super().get_queryset()
        query = self.request.query_params.get('q', None)

        if query:
            # Case-insensitive search in name
            queryset = queryset.filter(name__icontains=query)

        queryset = queryset.order_by('name')

        # Limit only list responses for autocomplete-like usage.
        # Detail/update/delete must be able to resolve any existing supplier by PK.
        if getattr(self, 'action', None) == 'list':
            return queryset[:20]

        return queryset

    def create(self, request, *args, **kwargs):
        """Create a supplier with project-scoped duplicate-name validation.

        :param request: HTTP request containing supplier data
        :return: Response with supplier data and created flag
        """
        try:
            fields = normalize_new_supplier_payload(
                name=request.data.get('name'),
                homepage_url=request.data.get('homepage_url'),
                allowed_domains=request.data.get('allowed_domains', []),
            )
            supplier = create_supplier(project=request.active_project, **fields)
        except SupplierPayloadError as exc:
            return api_error_response(
                code='invalid_supplier_payload',
                detail='Supplier data is invalid.',
                status_code=status.HTTP_400_BAD_REQUEST,
                **exc.errors,
            )
        except DuplicateSupplierNameError as exc:
            return api_error_response(
                code='duplicate_supplier_name',
                detail='A supplier with this name already exists in the project.',
                status_code=status.HTTP_400_BAD_REQUEST,
                name=[SUPPLIER_NAME_DUPLICATE_MESSAGE],
            )

        serializer = self.get_serializer(supplier)
        data = serializer.data
        data['created'] = True

        self.record_revision(supplier, EntityRevision.ACTION_CREATED)
        return Response(
            data,
            status=status.HTTP_201_CREATED
        )


class CropSupplierDataViewSet(ProjectScopedMixin, ProjectRevisionMixin, viewsets.ModelViewSet):

    # Read-only for project-bound API tokens: agents may look these up to
    # resolve references, but changing them stays session-only in this
    # version (see farm/agent_api/permissions.py).
    api_token_actions = {'list', 'retrieve'}
    queryset = CropSupplierData.objects.select_related('crop', 'supplier')
    serializer_class = CropSupplierDataSerializer

    def get_queryset(self):
        return self.queryset.filter(project=self.request.active_project)

    def perform_create(self, serializer):
        instance = serializer.save(project=self.request.active_project)
        self.record_revision(instance, EntityRevision.ACTION_CREATED)
