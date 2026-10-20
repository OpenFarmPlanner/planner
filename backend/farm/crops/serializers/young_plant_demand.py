"""DTO serializers for the young-plant-demand endpoint."""

from rest_framework import serializers


class YoungPlantDemandWeekSerializer(serializers.Serializer):
    iso_year = serializers.IntegerField()
    iso_week = serializers.IntegerField()
    start_date = serializers.DateField()
    end_date = serializers.DateField()


class YoungPlantDemandPlanSerializer(serializers.Serializer):
    plan_id = serializers.IntegerField()
    planting_date = serializers.DateField(allow_null=True)
    bed_id = serializers.IntegerField(allow_null=True)
    bed_name = serializers.CharField(allow_blank=True)
    field_name = serializers.CharField(allow_blank=True)
    location_name = serializers.CharField(allow_blank=True)
    area_usage_sqm = serializers.FloatField(allow_null=True, help_text='Area in m².')
    plant_count = serializers.IntegerField(allow_null=True)
    calculation_blockers = serializers.ListField(child=serializers.CharField())


class YoungPlantDemandSerializer(serializers.Serializer):
    """Read-only serializer for one crop + planting-week group of bought-in transplants."""
    key = serializers.CharField()
    crop_id = serializers.IntegerField()
    crop_name = serializers.CharField()
    crop_display_name = serializers.CharField(allow_blank=True, allow_null=True)
    crop_display_language_code = serializers.CharField(allow_blank=True)
    variety = serializers.CharField(allow_blank=True)
    planting_week = YoungPlantDemandWeekSerializer(allow_null=True)
    plant_count = serializers.IntegerField(
        allow_null=True,
        help_text='Summed plant count without reserve; null when any plan cannot be calculated.',
    )
    plant_count_with_reserve = serializers.IntegerField(
        allow_null=True,
        help_text='plant_count plus reserve_percent, rounded up to whole plants.',
    )
    reserve_percent = serializers.FloatField()
    calculation_blockers = serializers.ListField(child=serializers.CharField())
    plan_count = serializers.IntegerField()
    bed_count = serializers.IntegerField()
    plans = YoungPlantDemandPlanSerializer(many=True)
