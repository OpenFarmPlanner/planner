"""Write and read dated harvests with validated planting-plan allocations."""

from decimal import Decimal

from rest_framework import serializers

from config.languages import resolve_request_language
from farm.models import Crop, HarvestAllocation, HarvestRecord
from farm.models.harvests import MIN_HARVEST_QUANTITY, HarvestConversionSource
from farm.services.crop_display import format_crop_label
from farm.services.harvests import (
    REFERENCE_WEIGHT_FIELDS,
    eligible_harvest_plans,
    estimated_weight_kg,
    harvest_number,
    measured_weight_kg,
    reference_weight,
)


class HarvestAllocationSerializer(serializers.Serializer):
    id = serializers.IntegerField(read_only=True)
    planting_plan = serializers.IntegerField(source="planting_plan_id", min_value=1)
    quantity = serializers.DecimalField(
        max_digits=12, decimal_places=3, min_value=MIN_HARVEST_QUANTITY
    )
    harvested_area_sqm = serializers.DecimalField(
        max_digits=10,
        decimal_places=3,
        min_value=MIN_HARVEST_QUANTITY,
        allow_null=True,
        required=False,
    )
    bed_name = serializers.CharField(
        source="planting_plan.bed.name", allow_null=True, read_only=True
    )
    parcel_name = serializers.CharField(
        source="planting_plan.parcel.name", allow_null=True, read_only=True
    )
    site_name = serializers.CharField(
        source="planting_plan.site.name", allow_null=True, read_only=True
    )
    season_label = serializers.CharField(
        source="planting_plan.season.label", allow_null=True, read_only=True
    )
    planting_date = serializers.DateField(source="planting_plan.planting_date", read_only=True)
    kilograms_per_harvested_sqm = serializers.SerializerMethodField()

    def get_kilograms_per_harvested_sqm(self, allocation: HarvestAllocation) -> str | None:
        if allocation.harvested_area_sqm is None:
            return None
        harvest = allocation.harvest
        weight = measured_weight_kg(allocation.quantity, harvest.unit)
        if weight is None:
            weight = estimated_weight_kg(allocation.quantity, harvest.grams_per_unit)
        return (
            harvest_number(weight / allocation.harvested_area_sqm) if weight is not None else None
        )


class HarvestRecordSerializer(serializers.ModelSerializer):
    allocations = HarvestAllocationSerializer(many=True, required=False, max_length=200)
    crop_label = serializers.SerializerMethodField()
    measured_kg = serializers.SerializerMethodField()
    estimated_kg = serializers.SerializerMethodField()
    unallocated_quantity = serializers.SerializerMethodField()

    class Meta:
        model = HarvestRecord
        fields = (
            "id",
            "crop",
            "crop_label",
            "date",
            "quantity",
            "unit",
            "note",
            "grams_per_unit",
            "conversion_source",
            "measured_kg",
            "estimated_kg",
            "unallocated_quantity",
            "allocations",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("conversion_source", "created_at", "updated_at")
        extra_kwargs = {"note": {"max_length": 10000}}

    def get_fields(self):
        fields = super().get_fields()
        project = getattr(self.context.get("request"), "active_project", None)
        fields["crop"].queryset = (
            Crop.all_objects.filter(project=project) if project is not None else Crop.objects.none()
        )
        return fields

    def get_crop_label(self, harvest: HarvestRecord) -> str:
        request = self.context["request"]
        return format_crop_label(
            harvest.crop, resolve_request_language(request), request.active_project.region
        )

    def get_measured_kg(self, harvest: HarvestRecord) -> str | None:
        return harvest_number(measured_weight_kg(harvest.quantity, harvest.unit))

    def get_estimated_kg(self, harvest: HarvestRecord) -> str | None:
        return harvest_number(estimated_weight_kg(harvest.quantity, harvest.grams_per_unit))

    def get_unallocated_quantity(self, harvest: HarvestRecord) -> str:
        allocated = sum((row.quantity for row in harvest.allocations.all()), Decimal(0))
        return harvest_number(harvest.quantity - allocated)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        current = self.instance
        crop = attrs.get("crop", getattr(current, "crop", None))
        if crop.deleted_at is not None and (current is None or crop.pk != current.crop_id):
            raise serializers.ValidationError(
                {"crop": "Select a crop that is available in this project."}
            )
        day = attrs.get("date", getattr(current, "date", None))
        changed_assignment = (
            current is None
            or "allocations" in attrs
            or day != current.date
            or crop.pk != current.crop_id
        )
        rows = attrs["allocations"] if "allocations" in attrs else self._saved_allocations(current)
        self._validate_allocations(
            rows,
            attrs.get("quantity", getattr(current, "quantity", None)),
            crop,
            day,
            validate_plans=changed_assignment,
        )
        self._set_conversion(attrs, current, crop)
        return attrs

    @staticmethod
    def _saved_allocations(current: HarvestRecord | None) -> list[dict]:
        if current is None:
            return []
        return [
            {
                "planting_plan_id": row.planting_plan_id,
                "quantity": row.quantity,
                "harvested_area_sqm": row.harvested_area_sqm,
            }
            for row in current.allocations.all()
        ]

    @staticmethod
    def _validate_allocations(rows, total, crop, day, *, validate_plans: bool) -> None:
        if not rows:
            return
        plan_ids = {row["planting_plan_id"] for row in rows}
        if len(plan_ids) != len(rows):
            raise serializers.ValidationError(
                {"allocations": "Assign each planting plan at most once."}
            )
        if sum(row["quantity"] for row in rows) > total:
            raise serializers.ValidationError(
                {"allocations": "Assigned quantities exceed the harvest quantity."}
            )
        if not validate_plans:
            return
        eligible = dict(
            eligible_harvest_plans(crop.project_id, crop.pk, day)
            .filter(
                pk__in=plan_ids,
            )
            .order_by("pk")
            .select_for_update(of=("self",))
            .values_list("pk", "area_usage_sqm")
        )
        if eligible.keys() != plan_ids:
            raise serializers.ValidationError(
                {
                    "allocations": "Select planting plans for this crop and harvest date.",
                }
            )
        for row in rows:
            area = row.get("harvested_area_sqm")
            plan_area = eligible[row["planting_plan_id"]]
            if area is not None and plan_area and area > plan_area:
                raise serializers.ValidationError(
                    {
                        "allocations": "Harvested area cannot exceed the planting plan area.",
                    }
                )

    @staticmethod
    def _set_conversion(attrs, current: HarvestRecord | None, crop: Crop) -> None:
        unit = attrs.get("unit", getattr(current, "unit", None))
        factor = attrs.get("grams_per_unit")
        same_unit_and_crop = (
            current is not None and unit == current.unit and crop.pk == current.crop_id
        )
        if unit not in REFERENCE_WEIGHT_FIELDS:
            if factor is not None:
                raise serializers.ValidationError(
                    {
                        "grams_per_unit": "Only pieces and bunches can have an estimated weight.",
                    }
                )
            attrs.update(grams_per_unit=None, conversion_source="")
        elif same_unit_and_crop and (
            "grams_per_unit" not in attrs or factor == current.grams_per_unit
        ):
            return
        elif "grams_per_unit" in attrs:
            attrs["conversion_source"] = (
                HarvestConversionSource.MANUAL if factor is not None else ""
            )
        else:
            attrs["grams_per_unit"], attrs["conversion_source"] = reference_weight(crop, unit)

    def create(self, validated_data):
        rows = validated_data.pop("allocations", [])
        harvest = super().create(validated_data)
        self._save_allocations(harvest, rows)
        return harvest

    def update(self, instance, validated_data):
        rows = validated_data.pop("allocations", None)
        harvest = super().update(instance, validated_data)
        if rows is not None:
            self._save_allocations(harvest, rows)
        return harvest

    @staticmethod
    def _save_allocations(harvest: HarvestRecord, rows: list[dict]) -> None:
        retained = [row["planting_plan_id"] for row in rows]
        HarvestAllocation.objects.filter(harvest=harvest).exclude(
            planting_plan_id__in=retained,
        ).delete()
        for row in rows:
            HarvestAllocation.objects.update_or_create(
                harvest=harvest,
                planting_plan_id=row["planting_plan_id"],
                defaults={
                    "project_id": harvest.project_id,
                    "quantity": row["quantity"],
                    "harvested_area_sqm": row.get("harvested_area_sqm"),
                },
            )
        # Updates may start from a prefetched detail instance.
        getattr(harvest, "_prefetched_objects_cache", {}).pop("allocations", None)
