"""API endpoints for companion-planting relations (good and bad neighbours)."""

from django.db.models import Q
from rest_framework import viewsets

from farm.common.mixins import ProjectRevisionMixin, ProjectScopedMixin
from farm.models import CropCompanion, EntityRevision
from farm.services.crop_companions import active_relations

from ..serializers import CropCompanionSerializer


class CropCompanionViewSet(ProjectScopedMixin, ProjectRevisionMixin, viewsets.ModelViewSet):
    """The project's neighbour relations; ``?crop=<id>`` limits them to one Kultur.

    A relation between two Kulturen is returned once and applies to both.
    """

    # Read-only for project-bound API tokens, like the other per-crop data
    # (see farm/agent_api/permissions.py).
    api_token_actions = {'list', 'retrieve'}
    queryset = CropCompanion.objects.all()
    serializer_class = CropCompanionSerializer
    pagination_class = None

    def get_queryset(self):
        queryset = active_relations(self.request.active_project.id)
        crop_id = self.request.query_params.get('crop')
        if crop_id and crop_id.isdigit():
            queryset = queryset.filter(Q(crop_id=crop_id) | Q(companion_crop_id=crop_id))
        return queryset

    def perform_create(self, serializer):
        instance = serializer.save(project=self.request.active_project)
        self.record_revision(instance, EntityRevision.ACTION_CREATED)
