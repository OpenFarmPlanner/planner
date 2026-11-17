"""Apply dialog mappings atomically with the existing library action."""

from functools import wraps

from django.core.exceptions import ValidationError as ModelValidationError
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils.dateparse import parse_datetime
from rest_framework.exceptions import ValidationError

from config.responses import api_error_response
from farm.crops.serializers.plant_health import StagedCropPlantHealthMappingSerializer
from farm.services.crop_inheritance import crop_identity_write
from farm.services.crop_plant_health import PlantHealthMappingConflict, map_crop_plant_health


def with_staged_health_mappings(*, preview=False):
    def decorate(action):
        @wraps(action)
        def apply(view, request, *args, **kwargs):
            if request.method != 'POST' or not request.data.get('plant_health_mappings'):
                return action(view, request, *args, **kwargs)
            serializer = StagedCropPlantHealthMappingSerializer(
                data=request.data['plant_health_mappings'], many=True,
            )
            serializer.is_valid(raise_exception=True)
            mappings = serializer.validated_data
            if len({item['crop_id'] for item in mappings}) != len(mappings):
                raise ValidationError({'plant_health_mappings': 'Map each crop only once.'})
            crop = view.get_object()
            original_expected = request.data.get('expected_updated_at')
            try:
                with transaction.atomic(), crop_identity_write(crop.project_id):
                    crop.refresh_from_db()
                    original_updated_at = crop.updated_at.isoformat()
                    if not isinstance(original_expected, str) or parse_datetime(original_expected) != crop.updated_at:
                        raise PlantHealthMappingConflict()
                    for item in sorted(mappings, key=lambda item: item['crop_id']):
                        target = get_object_or_404(view.get_queryset(), pk=item['crop_id'])
                        view.check_object_permissions(request, target)
                        map_crop_plant_health(
                            target, expected_updated_at=item['expected_updated_at'], mappings=item['mappings'],
                        )
                        view._set_latest_revision_actor(target)
                    crop.refresh_from_db()
                    # The final action must check the version after our own mapped write.
                    request.data['expected_updated_at'] = crop.updated_at.isoformat()
                    response = action(view, request, *args, **kwargs)
                    if isinstance(response.data, dict) and 'crop_updated_at' in response.data:
                        response.data['crop_updated_at'] = original_updated_at
                    if preview or request.data.get('preview_only') is True or response.status_code >= 400:
                        transaction.set_rollback(True)
                    return response
            except ModelValidationError as error:
                return api_error_response(
                    code='plant_health_mapping_invalid', detail='Review the selected catalogue mapping.',
                    status_code=400, errors={'mappings': error.messages},
                )
            finally:
                request.data['expected_updated_at'] = original_expected
        return apply
    return decorate
