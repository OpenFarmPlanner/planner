"""DRF serializers for the farm structure domain (locations, fields, beds, layouts)."""

from decimal import Decimal

from rest_framework import serializers

from farm.common.serializer_fields import _resolve_active_project_from_serializer
from farm.models import Bed, BedLayout, Field, FieldLayout, Location

FIELD_NAME_DUPLICATE_MESSAGE = 'Eine Parzelle mit diesem Namen existiert in diesem Standort bereits.'


BED_NAME_DUPLICATE_MESSAGE = 'Ein Beet mit diesem Namen existiert in dieser Parzelle bereits.'


class LocationSerializer(serializers.ModelSerializer):
    @staticmethod
    def _parse_coordinate(value, field_name: str):
        if value in (None, ''):
            return None
        if isinstance(value, str):
            value = value.strip().replace(',', '.')
            if value == '':
                return None
        try:
            return float(value)
        except (TypeError, ValueError) as exc:
            raise serializers.ValidationError({field_name: f'{field_name.capitalize()} must be a valid number.'}) from exc

    def to_internal_value(self, data):
        payload = data.copy() if isinstance(data, dict) else data
        if isinstance(payload, dict):
            if 'latitude' in payload:
                payload['latitude'] = self._parse_coordinate(payload.get('latitude'), 'latitude')
            if 'longitude' in payload:
                payload['longitude'] = self._parse_coordinate(payload.get('longitude'), 'longitude')
        return super().to_internal_value(payload)

    def validate_latitude(self, value):
        if value is None:
            return value
        if not (-90 <= value <= 90):
            raise serializers.ValidationError('Latitude must be between -90 and 90.')
        return value

    def validate_longitude(self, value):
        if value is None:
            return value
        if not (-180 <= value <= 180):
            raise serializers.ValidationError('Longitude must be between -180 and 180.')
        return value

    def get_image_file(self, obj):
        if not obj.image_file_id:
            return None
        return {
            'id': obj.image_file_id,
            'storage_path': obj.image_file.storage_path,
        }

    class Meta:
        model = Location
        fields = '__all__'
        # Server-assigned from the active project on create; never client-settable
        # (prevents cross-tenant record reassignment via update).
        read_only_fields = ['project']


class FieldSerializer(serializers.ModelSerializer):
    location_name = serializers.CharField(source='location.name', read_only=True)

    def get_image_file(self, obj):
        if not obj.image_file_id:
            return None
        return {
            'id': obj.image_file_id,
            'storage_path': obj.image_file.storage_path,
        }

    class Meta:
        model = Field
        fields = '__all__'
        validators = []
        # `project` is server-assigned on create and never client-settable
        # (prevents cross-tenant record reassignment via update).
        read_only_fields = ['project']
        extra_kwargs = {
            'name': {'label': 'Parzelle'},
        }
    
    def validate_area_sqm(self, value):
        if value is not None:
            if value < Field.MIN_AREA_SQM:
                raise serializers.ValidationError(
                    f'Area must be at least {Field.MIN_AREA_SQM} sqm.'
                )
            if value > Field.MAX_AREA_SQM:
                raise serializers.ValidationError(
                    f'Area must not exceed {Field.MAX_AREA_SQM} sqm (100 hectares).'
                )
            if value.as_tuple().exponent < -1:
                raise serializers.ValidationError('Area must have at most one decimal place for fields.')
        return value

    def validate_length_m(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError('Length must be greater than or equal to 0.')
        return value

    def validate_width_m(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError('Width must be greater than or equal to 0.')
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        project = _resolve_active_project_from_serializer(self)
        location = attrs.get('location') or getattr(self.instance, 'location', None)
        if project is not None and location is not None and location.project_id != project.id:
            raise serializers.ValidationError({'location': 'Location does not belong to the active project.'})
        name = attrs.get('name') or getattr(self.instance, 'name', None)
        if location is not None and name:
            duplicate_fields = Field.objects.filter(location=location, name=name)
            if self.instance is not None and self.instance.pk is not None:
                duplicate_fields = duplicate_fields.exclude(pk=self.instance.pk)
            if duplicate_fields.exists():
                raise serializers.ValidationError({'name': FIELD_NAME_DUPLICATE_MESSAGE})
        return attrs


class BedSerializer(serializers.ModelSerializer):
    field_name = serializers.CharField(source='field.name', read_only=True)

    def get_image_file(self, obj):
        if not obj.image_file_id:
            return None
        return {
            'id': obj.image_file_id,
            'storage_path': obj.image_file.storage_path,
        }

    class Meta:
        model = Bed
        fields = '__all__'
        validators = []
        # `project` is server-assigned on create and never client-settable
        # (prevents cross-tenant record reassignment via update).
        read_only_fields = ['project']
        extra_kwargs = {
            'field': {'label': 'Parzelle'},
        }

    def validate_area_sqm(self, value):
        if value is not None:
            if value < Bed.MIN_AREA_SQM:
                raise serializers.ValidationError(
                    f'Area must be at least {Bed.MIN_AREA_SQM} sqm.'
                )
            if value > Bed.MAX_AREA_SQM:
                raise serializers.ValidationError(
                    f'Area must not exceed {Bed.MAX_AREA_SQM} sqm (1 hectare).'
                )
            if value.as_tuple().exponent < -1:
                raise serializers.ValidationError('Area must have at most one decimal place for beds.')
        return value

    def validate_length_m(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError('Length must be greater than or equal to 0.')
        return value

    def validate_width_m(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError('Width must be greater than or equal to 0.')
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        project = _resolve_active_project_from_serializer(self)
        field = attrs.get('field') or getattr(self.instance, 'field', None)
        if project is not None and field is not None and field.project_id != project.id:
            raise serializers.ValidationError({'field': 'Field does not belong to the active project.'})
        name = attrs.get('name') or getattr(self.instance, 'name', None)
        if field is not None and name:
            duplicate_beds = Bed.objects.filter(field=field, name=name)
            if self.instance is not None and self.instance.pk is not None:
                duplicate_beds = duplicate_beds.exclude(pk=self.instance.pk)
            if duplicate_beds.exists():
                raise serializers.ValidationError({'name': BED_NAME_DUPLICATE_MESSAGE})
        return attrs


MAX_BULK_BED_COUNT = 200


class BulkBedItemSerializer(serializers.Serializer):
    """One bed of a bulk create; dimensions in meters, both required."""

    name = serializers.CharField(max_length=200)
    length_m = serializers.FloatField(min_value=0, help_text='Bed length in meters (> 0).')
    width_m = serializers.FloatField(min_value=0, help_text='Bed width in meters (> 0).')

    def validate(self, attrs: dict) -> dict:
        attrs = super().validate(attrs)
        if attrs['length_m'] <= 0 or attrs['width_m'] <= 0:
            raise serializers.ValidationError('Length and width must be greater than 0.')
        # Same rounding as Bed.save(), which derives area_sqm from the dimensions.
        area = Decimal(str(attrs['length_m'] * attrs['width_m'])).quantize(Decimal('0.1'))
        if area < Bed.MIN_AREA_SQM or area > Bed.MAX_AREA_SQM:
            raise serializers.ValidationError(
                f'Area must be between {Bed.MIN_AREA_SQM} and {Bed.MAX_AREA_SQM} sqm.'
            )
        return attrs


class BulkBedCreateSerializer(serializers.Serializer):
    """Validates a series of beds created in one field in one request."""

    field = serializers.PrimaryKeyRelatedField(queryset=Field.objects.none())
    beds = BulkBedItemSerializer(many=True)

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        # Only the active project's fields resolve, so a foreign field id
        # reads as nonexistent instead of confirming that it exists.
        project = _resolve_active_project_from_serializer(self)
        if project is not None:
            self.fields['field'].queryset = Field.objects.filter(project=project)

    def validate_beds(self, value: list[dict]) -> list[dict]:
        if not 1 <= len(value) <= MAX_BULK_BED_COUNT:
            raise serializers.ValidationError(
                f'Between 1 and {MAX_BULK_BED_COUNT} beds can be created at once.'
            )
        names = [entry['name'] for entry in value]
        if len(set(names)) != len(names):
            raise serializers.ValidationError('Bed names must be unique.')
        return value

    def validate(self, attrs: dict) -> dict:
        attrs = super().validate(attrs)
        project = _resolve_active_project_from_serializer(self)
        field = attrs['field']
        if project is None or field.project_id != project.id:
            raise serializers.ValidationError(
                {'field': 'Field does not belong to the active project.'}
            )
        names = [entry['name'] for entry in attrs['beds']]
        taken = sorted(
            Bed.objects.filter(field=field, name__in=names).values_list('name', flat=True)
        )
        if taken:
            raise serializers.ValidationError(
                {'beds': [BED_NAME_DUPLICATE_MESSAGE], 'taken_names': taken}
            )
        return attrs


class FieldDuplicateSerializer(serializers.Serializer):
    """Input of "Parzelle duplizieren": the new name and how to copy the beds."""

    name = serializers.CharField(max_length=200)
    copy_beds = serializers.BooleanField(default=True)
    # Not trimmed: a space can be part of what is searched or inserted.
    replace_search = serializers.CharField(
        max_length=200, required=False, allow_blank=True, trim_whitespace=False, default='',
        help_text='Replaced in each copied bed name, first case-sensitive occurrence only.',
    )
    replace_with = serializers.CharField(
        max_length=200, required=False, allow_blank=True, trim_whitespace=False, default='',
    )


class FieldLayoutSerializer(serializers.ModelSerializer):
    class Meta:
        model = FieldLayout
        fields = [
            'id',
            'field',
            'location',
            'x',
            'y',
            'version',
            'scale',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate(self, attrs):
        attrs = super().validate(attrs)
        field = attrs.get('field') or getattr(self.instance, 'field', None)
        location = attrs.get('location') or getattr(self.instance, 'location', None)
        if field and location and field.location_id != location.id:
            raise serializers.ValidationError('Layout location must match the field location.')
        return attrs


class BedLayoutSerializer(serializers.ModelSerializer):
    field_id = serializers.IntegerField(source='bed.field_id', read_only=True)

    class Meta:
        model = BedLayout
        fields = [
            'id',
            'bed',
            'location',
            'field_id',
            'x',
            'y',
            'version',
            'scale',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'field_id', 'created_at', 'updated_at']

    def validate(self, attrs):
        attrs = super().validate(attrs)
        bed = attrs.get('bed') or getattr(self.instance, 'bed', None)
        location = attrs.get('location') or getattr(self.instance, 'location', None)
        if bed and location and bed.field.location_id != location.id:
            raise serializers.ValidationError('Layout location must match the bed location.')
        return attrs
