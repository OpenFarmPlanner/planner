"""API endpoints for companion-planting relations (good and bad neighbours)."""

from django.db import transaction
from django.db.models import Q
from drf_spectacular.utils import extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response

from farm.common.mixins import ProjectRevisionMixin, ProjectScopedMixin
from farm.history.records import _serialize_instance
from farm.models import CropCompanion, EntityRevision
from farm.services.crop_companions import active_relations, mark_library_copies_modified

from ..serializers import CropCompanionReplaceSerializer, CropCompanionSerializer


def _kultur_ids(relation: CropCompanion) -> tuple[int | None, int | None]:
    return relation.crop_id, relation.companion_crop_id


def _changes_relation(serializer: CropCompanionSerializer) -> bool:
    """Whether saving ``serializer`` would change its relation's stored values."""
    instance = serializer.instance
    return any(
        getattr(instance, name) != value for name, value in serializer.validated_data.items()
    )


class CropCompanionViewSet(ProjectScopedMixin, ProjectRevisionMixin, viewsets.ModelViewSet):
    """The project's neighbour relations; ``?crop=<id>`` limits them to one Kultur.

    A relation between two Kulturen is returned once and applies to both.
    Every write flags the affected Kulturen that are linked to the crop
    library as changed locally (see docs/crop-companions.md#crop-library).
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
        mark_library_copies_modified(_kultur_ids(instance))

    def perform_update(self, serializer):
        before = _kultur_ids(serializer.instance)
        super().perform_update(serializer)
        mark_library_copies_modified((*before, *_kultur_ids(serializer.instance)))

    def perform_destroy(self, instance):
        kultur_ids = _kultur_ids(instance)
        super().perform_destroy(instance)
        mark_library_copies_modified(kultur_ids)

    @extend_schema(
        request=CropCompanionReplaceSerializer,
        responses={200: CropCompanionSerializer(many=True)},
    )
    @action(detail=False, methods=['put'], url_path='replace')
    def replace(self, request: Request) -> Response:
        """Save a Kultur's whole neighbour list in one step (the crop form's save)."""
        serializer = CropCompanionReplaceSerializer(
            data=request.data, context=self.get_serializer_context(),
        )
        serializer.is_valid(raise_exception=True)
        kultur = serializer.validated_data['crop']
        touched: set[int | None] = set()
        with transaction.atomic():
            for relation in serializer.validated_data['removed']:
                touched.update(_kultur_ids(relation))
                self.perform_destroy(relation)
            for child in serializer.validated_data['children']:
                if child.instance is None:
                    instance = child.save(project=self.request.active_project)
                    self.record_revision(instance, EntityRevision.ACTION_CREATED)
                elif _changes_relation(child):
                    previous_snapshot = _serialize_instance(child.instance)
                    instance = child.save()
                    self.record_revision(
                        instance,
                        EntityRevision.ACTION_UPDATED,
                        previous_snapshot=previous_snapshot,
                    )
                else:
                    continue
                touched.update(_kultur_ids(instance))
            mark_library_copies_modified(touched)
        relations = self.get_queryset().filter(Q(crop=kultur) | Q(companion_crop=kultur))
        return Response(
            CropCompanionSerializer(relations, many=True).data, status=status.HTTP_200_OK,
        )
