"""Resolve the record season selected inside planting-plan details."""

from django.shortcuts import get_object_or_404
from rest_framework import serializers

from farm.models import Season


def resolve_record_season(request) -> Season | None:
    value = request.query_params.get('record_season')
    if value is None:
        return None
    try:
        season_id = serializers.IntegerField(min_value=1, max_value=2**63 - 1).run_validation(value)
    except serializers.ValidationError as error:
        raise serializers.ValidationError({'record_season': error.detail}) from error
    return get_object_or_404(Season, pk=season_id, project=request.active_project)
