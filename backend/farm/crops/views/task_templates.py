"""Task templates save independently of crop editing."""

from django.db import transaction
from django.db.models import QuerySet
from django.utils import timezone
from rest_framework import serializers, viewsets

from farm.common.mixins import ProjectRevisionMixin, ProjectScopedMixin
from farm.models import CropTaskTemplate, PlantingPlan
from farm.services.tasks import synchronize_plan_tasks

from ..serializers.task_templates import CropTaskTemplateSerializer


class CropTaskTemplateViewSet(ProjectScopedMixin, ProjectRevisionMixin, viewsets.ModelViewSet):
    api_token_actions = {'list', 'retrieve'}
    queryset = CropTaskTemplate.objects.select_related('crop').all()
    serializer_class = CropTaskTemplateSerializer

    def get_queryset(self) -> QuerySet[CropTaskTemplate]:
        queryset = super().get_queryset().filter(
            deleted_at__isnull=True, crop__deleted_at__isnull=True,
        )
        crop_id = self.request.query_params.get('crop')
        if crop_id is not None:
            try:
                crop_id = int(crop_id)
                if crop_id < 1:
                    raise ValueError
            except (ValueError, TypeError) as exc:
                raise serializers.ValidationError({'crop': 'Must be a positive integer.'}) from exc
            queryset = queryset.filter(crop_id=crop_id)
        return queryset

    def _synchronize(self, template: CropTaskTemplate) -> None:
        for plan in PlantingPlan.objects.filter(
            project_id=template.project_id, crop_id=template.crop_id,
            season__deleted_at__isnull=True,
        ).iterator():
            synchronize_plan_tasks(plan)

    @transaction.atomic
    def perform_create(self, serializer: CropTaskTemplateSerializer) -> None:
        serializer.save(project=self.request.active_project)
        self._synchronize(serializer.instance)

    @transaction.atomic
    def perform_update(self, serializer: CropTaskTemplateSerializer) -> None:
        serializer.save()
        self._synchronize(serializer.instance)

    @transaction.atomic
    def perform_destroy(self, instance: CropTaskTemplate) -> None:
        instance.deleted_at = timezone.now()
        instance.save(update_fields=['deleted_at', 'updated_at'])
        self._synchronize(instance)
