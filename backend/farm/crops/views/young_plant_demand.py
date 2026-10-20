"""Young-plant-demand list endpoint."""

from rest_framework import generics
from rest_framework.response import Response

from config.languages import resolve_request_language
from farm.common.mixins import ProjectScopedMixin
from farm.project_context import resolve_season_id_from_request
from farm.services.young_plant_demand import build_young_plant_demand_rows, parse_reserve_percent

from ..serializers import YoungPlantDemandSerializer


class YoungPlantDemandListView(ProjectScopedMixin, generics.ListAPIView):
    """Read-only endpoint listing the active season's bought-in transplants.

    The grouping and plant counts live in farm.services.young_plant_demand
    (see docs/young-plant-demand.md); this view only parses the request,
    delegates, and serializes the result.
    """

    serializer_class = YoungPlantDemandSerializer

    def list(self, request, *args, **kwargs):
        rows = build_young_plant_demand_rows(
            project=request.active_project,
            language_code=resolve_request_language(request),
            season_id=resolve_season_id_from_request(request),
            reserve_percent=parse_reserve_percent(request.query_params.get('reserve_percent')),
        )
        serializer = self.get_serializer(rows, many=True)
        return Response(
            {'count': len(rows), 'next': None, 'previous': None, 'results': serializer.data},
        )
