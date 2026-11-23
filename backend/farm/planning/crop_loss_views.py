"""Project-scoped CRUD for individual planting-plan loss incidents."""

from django.db import transaction
from rest_framework import serializers, viewsets

from farm.common.mixins import ProjectRevisionMixin, ProjectScopedMixin
from farm.models import CropLoss, EntityRevision, PlantingPlan, Season
from farm.models.crop_losses import CropLossType, CropLossUnit
from farm.project_context import resolve_season_id_from_request

from .season_context import resolve_record_season

MAX_PLANTING_PLAN_ID = 2**63 - 1


class CropLossSerializer(serializers.ModelSerializer):
    planting_plan = serializers.IntegerField(
        source="planting_plan_id",
        min_value=1,
        max_value=MAX_PLANTING_PLAN_ID,
    )

    class Meta:
        model = CropLoss
        fields = (
            "id",
            "planting_plan",
            "date",
            "loss_type",
            "cause",
            "extent_value",
            "extent_unit",
            "note",
        )

    def validate_planting_plan(self, plan_id):
        if self.instance is not None:
            if self.instance.planting_plan_id != plan_id:
                raise serializers.ValidationError("The planting plan cannot be changed.")
            return plan_id
        plans = PlantingPlan.objects.select_for_update(of=("self",)).filter(
            pk=plan_id,
            project=self.context["request"].active_project,
            season__deleted_at__isnull=True,
        )
        if plans.only("pk").first() is None:
            raise serializers.ValidationError("Choose a planting plan in the active project.")
        return plan_id

    def validate(self, attrs):
        loss_type = attrs.get("loss_type", getattr(self.instance, "loss_type", None))
        if loss_type == CropLossType.TOTAL:
            if attrs.get("extent_value") is not None or attrs.get("extent_unit"):
                raise serializers.ValidationError(
                    {"extent_value": "A total loss has no separate extent."}
                )
            return {**attrs, "extent_value": None, "extent_unit": ""}

        extent = attrs.get("extent_value", getattr(self.instance, "extent_value", None))
        unit = attrs.get("extent_unit", getattr(self.instance, "extent_unit", ""))
        if extent is None:
            if unit:
                raise serializers.ValidationError(
                    {"extent_value": "Enter the amount in the selected unit."}
                )
            return attrs
        if not unit:
            raise serializers.ValidationError({"extent_unit": "Choose an extent unit."})
        if extent < 0 or (unit == CropLossUnit.PERCENT and extent > 100):
            raise serializers.ValidationError(
                {"extent_value": "Enter a non-negative extent (at most 100 percent)."}
            )
        if unit == CropLossUnit.PLANTS and extent != extent.to_integral_value():
            raise serializers.ValidationError({"extent_value": "Enter a whole number of plants."})
        return attrs


class CropLossViewSet(ProjectScopedMixin, ProjectRevisionMixin, viewsets.ModelViewSet):
    queryset = CropLoss.objects.all()
    serializer_class = CropLossSerializer
    api_token_actions = set()

    def get_queryset(self):
        queryset = (
            super()
            .get_queryset()
            .filter(
                planting_plan__project=self.request.active_project,
                planting_plan__season__deleted_at__isnull=True,
            )
        )
        if self.action in {"update", "partial_update", "destroy"}:
            return queryset.select_for_update(of=("self",))
        if self.action != "list":
            return queryset

        plan = self.request.query_params.get("planting_plan")
        if plan is not None:
            try:
                plan_id = serializers.IntegerField(
                    min_value=1, max_value=MAX_PLANTING_PLAN_ID
                ).run_validation(plan)
            except serializers.ValidationError as error:
                raise serializers.ValidationError({"planting_plan": error.detail}) from error
            queryset = queryset.filter(planting_plan_id=plan_id)
            season = resolve_record_season(self.request)
            if season is not None:
                queryset = queryset.filter(date__range=(season.start_date, season.end_date))
            return queryset

        season_id = resolve_season_id_from_request(self.request)
        if season_id is None:
            return queryset
        season = Season.objects.filter(pk=season_id, project=self.request.active_project).first()
        return (
            queryset.filter(date__range=(season.start_date, season.end_date))
            if season
            else queryset.none()
        )

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        return super().create(request, *args, **kwargs)

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        return super().update(request, *args, **kwargs)

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        return super().destroy(request, *args, **kwargs)

    def perform_create(self, serializer):
        incident = serializer.save(project=self.request.active_project)
        self.record_revision(incident, EntityRevision.ACTION_CREATED)
