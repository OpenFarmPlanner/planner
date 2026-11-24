"""Project-scoped harvest records, plan suggestions, and recorded totals."""

from django.db import transaction
from django.db.models import Prefetch
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound
from rest_framework.response import Response

from farm.common.mixins import ProjectRevisionMixin, ProjectScopedMixin
from farm.history import _serialize_instance
from farm.history.records import internal_project_versions
from farm.models import Crop, EntityRevision, HarvestAllocation, HarvestRecord, Season
from farm.project_context import resolve_season_id_from_request
from farm.services.harvests import HarvestTotals, eligible_harvest_plans, harvest_plan_sort_key

from .harvest_serializers import HarvestRecordSerializer
from .season_context import resolve_record_season


class HarvestSuggestionQuery(serializers.Serializer):
    crop = serializers.IntegerField(min_value=1)
    date = serializers.DateField()


class HarvestRecordViewSet(ProjectScopedMixin, ProjectRevisionMixin, viewsets.ModelViewSet):
    queryset = HarvestRecord.objects.all()
    serializer_class = HarvestRecordSerializer
    api_token_actions = set()

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.action in {"list", "summary"}:
            queryset = self._scope_record_dates(queryset)
        if self.action in {"update", "partial_update", "destroy"}:
            queryset = queryset.select_for_update(of=("self",))
        return self._with_details(queryset)

    @staticmethod
    def _with_details(queryset):
        allocations = HarvestAllocation.objects.select_related(
            "planting_plan__bed",
            "planting_plan__season",
        )
        return queryset.select_related("crop", "crop__crop_species").prefetch_related(
            "crop__crop_species__translations",
            Prefetch("allocations", queryset=allocations),
        )

    def _scope_record_dates(self, queryset):
        plan = self.request.query_params.get("planting_plan") if self.action == "list" else None
        if plan is not None:
            try:
                plan_id = serializers.IntegerField(min_value=1).run_validation(plan)
            except serializers.ValidationError as error:
                raise serializers.ValidationError({"planting_plan": error.detail}) from error
            queryset = queryset.filter(allocations__planting_plan_id=plan_id)
            season = resolve_record_season(self.request)
            if season is not None:
                queryset = queryset.filter(date__range=(season.start_date, season.end_date))
            return queryset
        season_id = resolve_season_id_from_request(self.request)
        if season_id is None:
            return queryset
        season = Season.objects.filter(pk=season_id, project=self.request.active_project).first()
        if season is None:
            return queryset.none()
        return queryset.filter(date__range=(season.start_date, season.end_date))

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
        harvest = serializer.save(project=self.request.active_project)
        serializer.instance = self._record_saved_harvest(harvest, {})

    def perform_update(self, serializer):
        previous = _serialize_instance(serializer.instance)
        allocations = {
            row.pk: _serialize_instance(row) for row in serializer.instance.allocations.all()
        }
        harvest = serializer.save()
        serializer.instance = self._record_saved_harvest(harvest, allocations, previous)

    def perform_destroy(self, instance: HarvestRecord) -> None:
        with internal_project_versions():
            for allocation in instance.allocations.all():
                self.record_revision(allocation, EntityRevision.ACTION_DELETED)
        super().perform_destroy(instance)

    def _record_saved_harvest(self, harvest, previous_allocations, previous=None):
        saved = self._with_details(self.queryset).get(
            pk=harvest.pk, project=self.request.active_project
        )
        with internal_project_versions():
            for allocation in saved.allocations.all():
                before = previous_allocations.pop(allocation.pk, None)
                action = (
                    EntityRevision.ACTION_CREATED
                    if before is None
                    else EntityRevision.ACTION_UPDATED
                )
                self.record_revision(allocation, action, previous_snapshot=before)
            # Children removed from a saved record are absent without deleting the record.
            for pk, snapshot in previous_allocations.items():
                removed = HarvestAllocation(pk=pk)
                self.record_revision(
                    removed, EntityRevision.ACTION_DELETED, snapshot=snapshot, display_name=""
                )
        action = (
            EntityRevision.ACTION_CREATED if previous is None else EntityRevision.ACTION_UPDATED
        )
        self.record_revision(saved, action, previous_snapshot=previous)
        return saved

    @action(detail=False, methods=["get"])
    def suggestions(self, request):
        query = HarvestSuggestionQuery(data=request.query_params)
        query.is_valid(raise_exception=True)
        crop_id = query.validated_data["crop"]
        project = request.active_project
        if not Crop.objects.filter(project=project, pk=crop_id).exists():
            raise NotFound("Crop is not available in this project.")
        day = query.validated_data["date"]
        plans = eligible_harvest_plans(project.pk, crop_id, day).select_related(
            "bed__field", "season"
        )
        ranked = sorted(plans, key=lambda plan: harvest_plan_sort_key(plan, day))
        return Response(
            [
                {
                    "id": plan.pk,
                    "bed_name": plan.bed.name if plan.bed_id is not None else "",
                    "field_name": plan.bed.field.name
                    if plan.bed_id is not None and plan.bed.field_id
                    else "",
                    "season_label": plan.season.label if plan.season_id is not None else "",
                    "planting_date": plan.planting_date,
                    "harvest_start": plan.harvest_date,
                    "harvest_end": plan.harvest_end_date,
                    "area_sqm": str(plan.area_usage_sqm)
                    if plan.area_usage_sqm is not None
                    else None,
                }
                for plan in ranked
            ],
            status=status.HTTP_200_OK,
        )

    @action(detail=False, methods=["get"])
    def summary(self, request):
        totals = HarvestTotals()
        rows = self._scope_record_dates(super().get_queryset())
        # Each record contributes only once, independently of how it is assigned.
        for quantity, unit, factor in rows.values_list(
            "quantity", "unit", "grams_per_unit"
        ).iterator():
            totals.add(quantity, unit, factor)
        return Response({"quantities": totals.quantities_payload(), **totals.weight_payload()})
