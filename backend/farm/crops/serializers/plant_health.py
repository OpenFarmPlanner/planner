from rest_framework import serializers


class PlantHealthMappingSerializer(serializers.Serializer):
    local_name = serializers.CharField(max_length=200, allow_blank=False)
    catalogue_identity = serializers.UUIDField()


class CropPlantHealthMappingSerializer(serializers.Serializer):
    expected_updated_at = serializers.DateTimeField()
    mappings = PlantHealthMappingSerializer(many=True, allow_empty=False)

    def validate_mappings(self, values):
        names = [" ".join(item["local_name"].split()).casefold() for item in values]
        if len(names) != len(set(names)):
            raise serializers.ValidationError("Map each local name only once.")
        return values


class StagedCropPlantHealthMappingSerializer(CropPlantHealthMappingSerializer):
    crop_id = serializers.IntegerField(min_value=1)
