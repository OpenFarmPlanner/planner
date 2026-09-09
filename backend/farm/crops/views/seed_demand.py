"""Seed-demand list endpoint and supplier-selection POST."""


from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.response import Response

from config.languages import resolve_request_language
from farm.common.mixins import ProjectScopedMixin
from farm.common.responses import api_error_response
from farm.models import (
    Crop,
    CropSupplierData,
    Supplier,
)
from farm.project_context import resolve_season_id_from_request
from farm.services.seed_demand import build_seed_demand_rows, parse_selected_suppliers

from ..serializers import (
    SeedDemandSerializer,
)


class SeedDemandListView(ProjectScopedMixin, generics.ListAPIView):
    """Read-only endpoint returning typed seed demand aggregated by crop.

    The calculation itself lives in farm.services.seed_demand (see
    docs/seed-demand-calculation.md); this view only parses the request,
    delegates, and serializes the result.
    """

    serializer_class = SeedDemandSerializer

    def list(self, request, *args, **kwargs):
        rows = build_seed_demand_rows(
            project=request.active_project,
            selected_supplier_by_crop=parse_selected_suppliers(
                request.query_params.get('supplier_selection')
            ),
            language_code=resolve_request_language(request),
            season_id=resolve_season_id_from_request(request),
        )
        serializer = self.get_serializer(rows, many=True)
        return Response({'count': len(rows), 'next': None, 'previous': None, 'results': serializer.data})

    def post(self, request, *args, **kwargs):
        crop_id = request.data.get('crop_id')
        supplier_id = request.data.get('supplier_id')
        try:
            crop_id = int(crop_id)
        except (TypeError, ValueError):
            return api_error_response(
                code='invalid_crop_id',
                detail='crop_id must be a positive integer.',
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        if crop_id <= 0:
            return api_error_response(
                code='invalid_crop_id',
                detail='crop_id must be a positive integer.',
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        crop = get_object_or_404(Crop, id=crop_id, project=request.active_project)

        if supplier_id in (None, ''):
            crop.selected_seed_demand_supplier = None
            crop.save(update_fields=['selected_seed_demand_supplier', 'updated_at'])
            return Response({'crop_id': crop.id, 'selected_supplier_id': None}, status=status.HTTP_200_OK)

        try:
            supplier_id = int(supplier_id)
        except (TypeError, ValueError):
            return api_error_response(
                code='invalid_supplier_id',
                detail='supplier_id must be an integer or null.',
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        supplier = get_object_or_404(Supplier, id=supplier_id, project=request.active_project)
        has_supplier_data = CropSupplierData.objects.filter(
            project=request.active_project,
            crop=crop,
            supplier=supplier,
        ).exists()
        if not has_supplier_data:
            return api_error_response(
                code='supplier_not_available_for_crop',
                detail='Supplier is not available for this crop.',
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        crop.selected_seed_demand_supplier = supplier
        crop.save(update_fields=['selected_seed_demand_supplier', 'updated_at'])
        return Response({'crop_id': crop.id, 'selected_supplier_id': supplier.id}, status=status.HTTP_200_OK)
