"""DRF serializers for the planning domain (planting plans and tasks)."""

from datetime import date

from django.core.exceptions import ValidationError
from rest_framework import serializers

from config.languages import DEFAULT_LANGUAGE_CODE, resolve_request_language
from crops.models import CropSpecies
from farm.common.serializer_fields import (
    AuditUserSerializer,
    _resolve_active_project_from_serializer,
)
from farm.models import Crop, PlantingPlan, Season, Task
from farm.project_context import resolve_season_id_from_request
from farm.services.crop_display import resolve_crop_display_name
from farm.services.crop_inheritance import (
    build_general_crop_index,
    resolve_crop_field,
    resolve_plants_per_m2,
)
from farm.services.demo_project import find_demo_crop_species, is_demo_project_description


class PlantingPlanSerializer(serializers.ModelSerializer):
    # allow_null=True lets DRF's dotted-source lookup gracefully return None
    # instead of raising when `crop` itself is null (draft plans without
    # a crop chosen yet) — see get_attribute in rest_framework/fields.py.
    crop_name = serializers.CharField(source='crop.name', read_only=True, allow_null=True)
    crop_variety = serializers.CharField(source='crop.variety', read_only=True, allow_blank=True, allow_null=True)
    crop_display_name = serializers.SerializerMethodField(read_only=True)
    crop_display_language_code = serializers.SerializerMethodField(read_only=True)
    crop_display_color = serializers.CharField(source='crop.display_color', read_only=True, allow_blank=True, allow_null=True)
    # Crop timing/cultivation values the Gantt calendar plans from. Served as
    # *effective* values so a Sorte that only overrides some fields still drives
    # the calendar with its general Kultur's remaining values.
    crop_propagation_duration_days = serializers.SerializerMethodField(read_only=True)
    crop_cultivation_type = serializers.SerializerMethodField(read_only=True)
    crop_cultivation_types = serializers.SerializerMethodField(read_only=True)
    bed_name = serializers.SerializerMethodField(read_only=True)
    harvest_date = serializers.SerializerMethodField(read_only=True)
    harvest_end_date = serializers.SerializerMethodField(read_only=True)
    plants_count = serializers.SerializerMethodField(read_only=True)
    note_attachment_count = serializers.IntegerField(read_only=True)
    created_by_user = AuditUserSerializer(source='created_by', read_only=True)
    updated_by_user = AuditUserSerializer(source='updated_by', read_only=True)
    
    # Write-only fields for area input
    area_input_value = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        write_only=True,
        required=False,
        help_text='Area value to input (m² or plant count depending on unit)'
    )
    area_input_unit = serializers.ChoiceField(
        choices=[('M2', 'm²'), ('PLANTS', 'Plants')],
        write_only=True,
        required=False,
        help_text='Unit for area input: M2 (square meters) or PLANTS (plant count)'
    )

    def get_image_file(self, obj: PlantingPlan) -> dict[str, object] | None:
        if not obj.image_file_id:
            return None
        return {
            'id': obj.image_file_id,
            'storage_path': obj.image_file.storage_path,
        }

    def get_bed_name(self, obj: PlantingPlan) -> str | None:
        return obj.bed.name if obj.bed else None

    def _general_crop_index(self, obj: PlantingPlan) -> dict[int, Crop]:
        """The project's general Kulturen, built once per request (not per row)."""
        cache = self.context.setdefault('_general_crop_index_by_project', {})
        if obj.project_id not in cache:
            cache[obj.project_id] = build_general_crop_index(obj.project_id)
        return cache[obj.project_id]

    def _effective_crop_value(self, obj: PlantingPlan, field: str) -> object:
        """A crop field with the Sorte -> general Kultur fallback applied."""
        if obj.crop is None:
            return None
        return resolve_crop_field(obj.crop, field, self._general_crop_index(obj))

    def get_crop_propagation_duration_days(self, obj: PlantingPlan) -> int | None:
        return self._effective_crop_value(obj, 'propagation_duration_days')

    def get_crop_cultivation_type(self, obj: PlantingPlan) -> str | None:
        return self._effective_crop_value(obj, 'cultivation_type')

    def get_crop_cultivation_types(self, obj: PlantingPlan) -> list[str] | None:
        return self._effective_crop_value(obj, 'cultivation_types')

    def _request_language(self) -> str:
        request = self.context.get('request')
        if request is None:
            return DEFAULT_LANGUAGE_CODE
        return resolve_request_language(request)

    def _request_region(self) -> str:
        request = self.context.get('request')
        active_project = getattr(request, 'active_project', None) if request is not None else None
        if active_project is not None:
            return getattr(active_project, 'region', '') or ''
        plan_project = self.context.get('project')
        return getattr(plan_project, 'region', '') if plan_project is not None else ''

    def _get_crop_species(self, crop: Crop) -> CropSpecies | None:
        if crop.crop_species_id:
            return crop.crop_species
        if not is_demo_project_description(crop.project.description if crop.project_id else None):
            return None

        cache = self.context.setdefault('_demo_crop_species_by_name', {})
        if crop.name not in cache:
            cache[crop.name] = find_demo_crop_species(crop.name)
        return cache[crop.name]

    def _get_localized_crop_name(self, obj: PlantingPlan) -> tuple[str | None, str]:
        crop = obj.crop
        if crop is None:
            return None, ''
        if crop.crop_species_id:
            return resolve_crop_display_name(crop, self._request_language(), self._request_region())
        species = self._get_crop_species(crop)
        if species is None:
            return crop.name, ''
        return species.localized_name(self._request_language(), self._request_region())

    def get_crop_display_name(self, obj: PlantingPlan) -> str | None:
        return self._get_localized_crop_name(obj)[0]

    def get_crop_display_language_code(self, obj: PlantingPlan) -> str:
        return self._get_localized_crop_name(obj)[1]

    def _calculated_harvest_dates(self, obj: PlantingPlan) -> tuple[date | None, date | None]:
        cache = self.context.setdefault('_calculated_harvest_dates_by_plan', {})
        cache_key = obj.pk or id(obj)
        if cache_key not in cache:
            cache[cache_key] = obj.calculate_effective_harvest_dates(self._general_crop_index(obj))
        return cache[cache_key]

    def get_harvest_date(self, obj: PlantingPlan) -> date | None:
        """Return harvest start only when crop growth timing is known."""
        calculated_harvest_date, _ = self._calculated_harvest_dates(obj)
        if calculated_harvest_date is None:
            return None
        return obj.harvest_date or calculated_harvest_date

    def get_harvest_end_date(self, obj: PlantingPlan) -> date | None:
        """Return harvest end only when both growth and harvest timing are known."""
        _, calculated_harvest_end_date = self._calculated_harvest_dates(obj)
        if calculated_harvest_end_date is None:
            return None
        return obj.harvest_end_date or calculated_harvest_end_date

    class Meta:
        model = PlantingPlan
        fields = '__all__'
        read_only_fields = ['project', 'harvest_date', 'harvest_end_date', 'created_by', 'updated_by']
    
    def get_plants_count(self, obj: PlantingPlan) -> int | None:
        """Compute plant count from area and the crop's effective spacing."""
        if not obj.area_usage_sqm or not obj.crop:
            return None
        plants_per_m2 = resolve_plants_per_m2(obj.crop, self._general_crop_index(obj))
        if not plants_per_m2 or plants_per_m2 <= 0:
            return None
        return round(obj.area_usage_sqm * plants_per_m2)

    def validate(self, attrs):
        self._validate_minimal_identity(attrs)
        self._validate_project_scope(attrs)
        self._validate_create_has_active_season(attrs)
        self._validate_planting_date_within_season(attrs)
        self._apply_area_input_conversion(attrs)
        self._run_model_clean(attrs)
        return attrs

    def _resolve_target_season(self, attrs) -> Season | None:
        """The season the plan will end up in, mirroring PlantingPlanViewSet.

        Priority: an explicit ``season`` in the payload, then the season already
        on the instance (updates), then the active ``X-Season-Id`` header.
        """
        if 'season' in attrs:
            return attrs['season']
        if self.instance is not None and self.instance.season_id:
            return self.instance.season
        request = self.context.get('request')
        if request is None:
            return None
        season_id = resolve_season_id_from_request(request)
        if season_id is None:
            return None
        project = _resolve_active_project_from_serializer(self)
        queryset = Season.objects.filter(pk=season_id)
        if project is not None:
            queryset = queryset.filter(project=project)
        return queryset.first()

    def _validate_create_has_active_season(self, attrs) -> None:
        """New planting plans must be attached to an active season."""
        if self.instance is not None:
            return
        if 'season' in attrs and attrs['season'] is not None:
            return
        if self._resolve_target_season(attrs) is not None:
            return
        raise serializers.ValidationError({
            'season': 'An active season is required before creating planting plans.',
        })

    def _validate_planting_date_within_season(self, attrs) -> None:
        """Hard boundary: planting_date must fall inside the season's period."""
        planting_date = attrs.get('planting_date')
        if planting_date is None and self.instance is not None:
            planting_date = self.instance.planting_date
        if planting_date is None:
            return
        season = self._resolve_target_season(attrs)
        if season is None:
            return
        if season.start_date <= planting_date <= season.end_date:
            return
        period = (
            f"{season.start_date.strftime('%d.%m.%Y')} – "
            f"{season.end_date.strftime('%d.%m.%Y')}"
        )
        raise serializers.ValidationError({
            'planting_date': f'Pflanzdatum muss innerhalb der Saison liegen ({period}).',
        })

    def _validate_minimal_identity(self, attrs):
        """A plan can be saved as a draft missing bed/planting_date/
        cultivation_type, but it must identify itself by at least a crop
        or a bed — an entirely empty plan isn't a meaningful draft."""
        crop = attrs['crop'] if 'crop' in attrs else (self.instance.crop if self.instance else None)
        bed = attrs['bed'] if 'bed' in attrs else (self.instance.bed if self.instance else None)
        if crop is None and bed is None:
            raise serializers.ValidationError({
                'crop': 'Either crop or bed must be set.',
                'bed': 'Either crop or bed must be set.',
            })

    def _validate_project_scope(self, attrs):
        """Crop, bed, and season must belong to the active project."""
        project = _resolve_active_project_from_serializer(self)
        crop = attrs.get('crop') or (self.instance.crop if self.instance else None)
        bed = attrs.get('bed') or (self.instance.bed if self.instance else None)
        season = attrs.get('season') or (self.instance.season if self.instance else None)
        if project is not None and crop is not None and crop.project_id != project.id:
            raise serializers.ValidationError({'crop': 'Crop does not belong to the active project.'})
        if project is not None and bed is not None and bed.project_id != project.id:
            raise serializers.ValidationError({'bed': 'Bed does not belong to the active project.'})
        if project is not None and season is not None and season.project_id != project.id:
            raise serializers.ValidationError({'season': 'Season does not belong to the active project.'})

    def _apply_area_input_conversion(self, attrs):
        """Convert the M2/PLANTS area input into area_usage_sqm on attrs."""
        area_input_value = attrs.pop('area_input_value', None)
        area_input_unit = attrs.pop('area_input_unit', None)

        if area_input_value is None:
            return

        # Value must be positive
        if area_input_value <= 0:
            raise serializers.ValidationError({
                'area_input_value': 'Area input value must be greater than 0.'
            })

        # Unit is required when value is provided
        if not area_input_unit:
            raise serializers.ValidationError({
                'area_input_unit': (
                    'Area input unit is required when '
                    'area_input_value is provided.'
                )
            })

        # Get crop (could be from attrs for create, or from instance for update)
        crop = attrs.get('crop')
        if not crop and self.instance:
            crop = self.instance.crop

        # Convert based on unit
        if area_input_unit == 'M2':
            # Direct assignment
            attrs['area_usage_sqm'] = area_input_value
        elif area_input_unit == 'PLANTS':
            attrs['area_usage_sqm'] = self._plants_to_area(area_input_value, crop)

    def _plants_to_area(self, plant_count, crop):
        """Convert a plant count into an area in m² using the crop's spacing."""
        # Validate crop is present
        if not crop:
            raise serializers.ValidationError({
                'area_input_unit': 'Crop must be selected to input area as plant count.'
            })

        # Validate crop has valid spacing
        plants_per_m2 = resolve_plants_per_m2(crop)
        if plants_per_m2 is None or plants_per_m2 <= 0:
            raise serializers.ValidationError({
                'area_input_unit': (
                    'Crop spacing data is missing or invalid. '
                    'Cannot calculate area from plant count.'
                )
            })

        # Calculate area in m²: plants / (plants_per_m2)
        return plant_count / plants_per_m2

    def _run_model_clean(self, attrs):
        """Run PlantingPlan.clean on a throwaway instance without mutating the real one."""
        model_field_names = {field.name for field in PlantingPlan._meta.fields}
        if self.instance:
            validation_attrs = {}
            for field_name in model_field_names:
                if field_name in attrs:
                    validation_attrs[field_name] = attrs[field_name]
                elif hasattr(self.instance, field_name):
                    validation_attrs[field_name] = getattr(self.instance, field_name)
            instance = PlantingPlan(
                **{name: value for name, value in validation_attrs.items() if name in model_field_names}
            )
            instance.pk = self.instance.pk
        else:
            instance = PlantingPlan(**{name: value for name, value in attrs.items() if name in model_field_names})

        try:
            instance.clean()
        except ValidationError as e:
            raise serializers.ValidationError(e.message_dict) from e


class TaskSerializer(serializers.ModelSerializer):
    planting_plan_name = serializers.CharField(source='planting_plan.__str__', read_only=True)

    def get_image_file(self, obj):
        if not obj.image_file_id:
            return None
        return {
            'id': obj.image_file_id,
            'storage_path': obj.image_file.storage_path,
        }

    class Meta:
        model = Task
        fields = '__all__'
        # Server-assigned from the active project on create (see
        # TaskViewSet.perform_create); never client-settable so a member cannot
        # reassign a task across tenant boundaries via update.
        read_only_fields = ['project']

    def validate(self, attrs):
        attrs = super().validate(attrs)
        project = _resolve_active_project_from_serializer(self)
        planting_plan = attrs.get('planting_plan') or getattr(self.instance, 'planting_plan', None)
        if project is not None and planting_plan is not None and planting_plan.project_id != project.id:
            raise serializers.ValidationError({'planting_plan': 'Planting plan does not belong to the active project.'})
        return attrs
