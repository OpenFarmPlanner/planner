"""Serializer for crops (unit conversion, seed rates, supplier rows)."""

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any

from django.core.exceptions import ValidationError
from django.db import IntegrityError, models, transaction
from rest_framework import serializers
from rest_framework.exceptions import APIException

from config.languages import DEFAULT_LANGUAGE_CODE, resolve_request_language
from crops.models import CropSpecies
from crops.permissions import is_public_library_moderator
from farm.common.serializer_fields import (
    CentimetersField,
    LocalizedDecimalField,
    _resolve_active_project_from_serializer,
)
from farm.enum_normalization import normalize_seed_rate_unit
from farm.models import (
    Crop,
    CropSupplierData,
    MediaFile,
    Project,
    PublicCrop,
    SeedPackage,
    Supplier,
    is_supplier_domain,
)
from farm.seed_units import (
    SEED_PACKAGE_UNIT_GRAMS,
    SEED_PACKAGE_UNIT_SEEDS,
    SEED_RATE_UNITS,
)
from farm.services.crop_display import resolve_crop_display_name
from farm.services.crop_inheritance import (
    CROP_INHERITABLE_FIELDS,
    build_effective_crop_values,
    build_general_crop_index,
    build_inherited_crop_values,
    clear_species_invariant_overrides,
    ensure_general_crop_for_variety,
    get_general_crop,
    resolve_plants_per_m2,
)
from farm.services.public_crops import (
    has_open_public_crop_update,
    is_public_crop_contributor,
    is_public_crop_update_rejected,
    resolve_public_publish_block,
)

from .seed_packages import SeedPackageSerializer
from .seed_rates import (
    EMPTY_SEED_RATE_UNIT_VALUES,
    PRE_CULTIVATION_SEED_RATE_UNITS,
    _normalize_seed_rate_unit_value,
    _seed_rate_entry_error,
)
from .suppliers import (
    CropSupplierDataSerializer,
    SupplierSerializer,
    _is_empty_supplier_data_payload,
    _supplier_data_payload_has_information,
    _supplier_data_payload_has_supplier,
)

# Sentinel so a resolved `None` is cached instead of re-queried per field.
_UNRESOLVED = object()


class CropNameConflict(APIException):
    status_code = 409
    default_code = 'crop_name_conflict'

    def __init__(self) -> None:
        super().__init__({
            'code': self.default_code,
            'detail': 'A general crop with this name already exists in this project.',
        })

# The inheritable model fields whose API name differs from the model field name
# (distances are stored in meters and exposed in centimeters).
_INHERITABLE_API_FIELD_NAMES = {
    'distance_within_row_m': 'distance_within_row_cm',
    'row_spacing_m': 'row_spacing_cm',
    'sowing_depth_m': 'sowing_depth_cm',
}

_SEED_RATE_UNIT_FIELDS = (
    'seed_rate_unit',
    'seed_rate_direct_unit',
    'seed_rate_pre_cultivation_unit',
)


def _normalized_seed_rate_unit_representation(raw_value: Any) -> Any:
    """Apply the same unit normalization the own-value representation uses."""
    if raw_value in EMPTY_SEED_RATE_UNIT_VALUES:
        return None
    return normalize_seed_rate_unit(raw_value) or raw_value


def _add_seed_rate_unit_constraint_error(
    errors: dict[str, str],
    error_field: str,
    method: str,
    value: object,
    unit: object,
) -> None:
    """Add a unit-specific seed-rate error for flat crop fields."""
    if value is None or not unit or error_field in errors:
        return
    entry_error = _seed_rate_entry_error(method, {'value': value, 'unit': unit})
    if entry_error:
        errors[error_field] = entry_error


class CropSerializer(serializers.ModelSerializer):
    """Serializer for crop data with unit conversion and supplier helpers."""
    crop_display_name = serializers.SerializerMethodField(read_only=True)
    crop_display_language_code = serializers.SerializerMethodField(read_only=True)
    description_language_code = serializers.SerializerMethodField(read_only=True)
    crop_species_translations = serializers.SerializerMethodField(read_only=True)
    variety = serializers.CharField(
        required=False,
        allow_blank=True,
        allow_null=True,
        default='',
        help_text='Crop variety; blank or null for species-level general data'
    )
    distance_within_row_cm = CentimetersField(
        source='distance_within_row_m',
        required=False,
        allow_null=True,
        help_text='Distance within row in centimeters'
    )
    row_spacing_cm = CentimetersField(
        source='row_spacing_m',
        required=False,
        allow_null=True,
        help_text='Row spacing in centimeters'
    )
    sowing_depth_cm = CentimetersField(
        source='sowing_depth_m',
        required=False,
        allow_null=True,
        help_text='Sowing depth in centimeters'
    )
    
    image_file = serializers.SerializerMethodField()
    image_file_id = serializers.PrimaryKeyRelatedField(
        queryset=MediaFile.objects.all(),
        source='image_file',
        write_only=True,
        required=False,
        allow_null=True,
    )

    supplier = SupplierSerializer(read_only=True)
    supplier_id = serializers.PrimaryKeyRelatedField(
        queryset=Supplier.objects.all(),
        source='supplier',
        write_only=True,
        required=False,
        allow_null=True,
        help_text='Supplier ID (alternative to supplier_name)'
    )
    supplier_name = serializers.CharField(
        write_only=True,
        required=False,
        allow_blank=True,
        allow_null=True,
        help_text='Supplier name for get-or-create (alternative to supplier_id)'
    )

    origin_type = serializers.CharField(required=False, allow_blank=True)
    seed_rate_value = serializers.FloatField(
        required=False,
        allow_null=True,
        help_text='Seed rate value (per m², per meter, or per plant, depending on unit)'
    )
    seed_rate_unit = serializers.CharField(
        required=False,
        allow_blank=True,
        allow_null=True,
        help_text="Unit for seed rate (e.g. 'g/m²', 'seeds/m', 'seeds_per_plant')"
    )
    cultivation_types = serializers.ListField(
        child=serializers.CharField(),
        required=False,
        allow_empty=False,
    )
    seed_rate_by_cultivation = serializers.JSONField(required=False, allow_null=True)
    sowing_calculation_safety_percent = serializers.FloatField(
        required=False,
        allow_null=True,
        help_text='Safety margin for seeding calculation in percent (0-100)'
    )
    seed_rate_direct_value = serializers.FloatField(required=False, allow_null=True)
    seed_rate_direct_unit = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    sowing_calculation_safety_percent_direct = serializers.FloatField(
        required=False,
        allow_null=True,
    )
    seed_rate_pre_cultivation_value = serializers.FloatField(required=False, allow_null=True)
    seed_rate_pre_cultivation_unit = serializers.CharField(
        required=False,
        allow_blank=True,
        allow_null=True,
    )
    sowing_calculation_safety_percent_pre_cultivation = serializers.FloatField(
        required=False,
        allow_null=True,
    )
    seed_requirements = serializers.JSONField(
        required=False,
        help_text=(
            'Preferred agent-facing seed-rate object keyed by cultivation method. '
            'Example: {"pre_cultivation": {"value": 2, "unit": "seeds_per_plant"}}. '
            'This is a rate, not the total amount to buy.'
        ),
    )
    thousand_kernel_weight_g = LocalizedDecimalField(
        max_digits=6,
        decimal_places=2,
        required=False,
        allow_null=True,
        help_text='Weight of 1000 kernels in grams'
    )
    seeding_requirement = serializers.FloatField(
        required=False,
        allow_null=True,
        help_text='Total seeding requirement (g or seeds, depending on type)'
    )
    seeding_requirement_type = serializers.CharField(
        required=False,
        allow_blank=True,
        help_text="Type of seeding requirement (e.g. 'g', 'seeds')"
    )
    seed_packages = SeedPackageSerializer(many=True, required=False)
    supplier_data = serializers.SerializerMethodField()
    supplier_data_input = serializers.ListField(
        child=serializers.DictField(),
        write_only=True,
        required=False,
    )
    copy_values_to_crop = serializers.BooleanField(
        write_only=True,
        required=False,
        default=False,
        help_text=(
            'When creating a linked variety, also fill currently empty timing, '
            'yield, and seed fields on its general crop from the variety values.'
        ),
    )

    plants_per_m2 = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        read_only=True,
        help_text=(
            'Calculated plants per square meter from the effective spacing — a Sorte '
            'without its own spacing uses the general Kultur\'s (read-only)'
        ),
    )
    general_crop = serializers.SerializerMethodField(
        read_only=True,
        help_text=(
            'ID of the general Kultur this Sorte inherits unset field values from '
            '(same project, same crop species, no variety), or null.'
        ),
    )
    inherited_fields = serializers.SerializerMethodField(
        read_only=True,
        help_text=(
            'Fields whose effective value comes from the general Kultur, not from this row.'
        ),
    )
    effective_values = serializers.SerializerMethodField(
        read_only=True,
        help_text=(
            'Effective value per inheritable field: this row\'s own value when set, '
            'otherwise the general Kultur\'s. Empty when there is no general Kultur '
            'to inherit from, in which case the raw fields already are the effective values.'
        ),
    )
    owned_public_crop_id = serializers.SerializerMethodField()
    owned_public_crop_role = serializers.SerializerMethodField()
    public_update_available = serializers.SerializerMethodField()
    public_update_rejected = serializers.SerializerMethodField()
    public_publish_blocked_reason = serializers.SerializerMethodField()
    public_crop_species_pending = serializers.SerializerMethodField()

    def get_image_file(self, obj):
        if not obj.image_file_id:
            return None
        return {
            'id': obj.image_file_id,
            'storage_path': obj.image_file.storage_path,
        }

    def get_supplier_data(self, obj):
        rows = obj.supplier_data.all()
        return CropSupplierDataSerializer(rows, many=True).data

    class Meta:
        model = Crop
        fields = '__all__'
        # `project` is assigned server-side from the active project on create
        # (see CropViewSet.perform_create) and must never be settable by the
        # client, otherwise a member could reassign a record to another project
        # via update and inject data across tenant boundaries.
        read_only_fields = ['project']

    def _request_language(self) -> str:
        request = self.context.get('request')
        if request is None:
            return DEFAULT_LANGUAGE_CODE
        return resolve_request_language(request)

    def _request_region(self) -> str:
        request = self.context.get('request')
        active_project = getattr(request, 'active_project', None) if request is not None else None
        if active_project is None:
            active_project = _resolve_active_project_from_serializer(self)
        return getattr(active_project, 'region', '') if active_project is not None else ''

    def _get_crop_species(self, obj: Crop) -> CropSpecies | None:
        if obj.crop_species_id:
            return obj.crop_species
        return None

    def _get_localized_crop_name(self, obj: Crop) -> tuple[str | None, str]:
        return resolve_crop_display_name(obj, self._request_language(), self._request_region())

    def get_crop_display_name(self, obj: Crop) -> str | None:
        return self._get_localized_crop_name(obj)[0]

    def get_crop_display_language_code(self, obj: Crop) -> str:
        return self._get_localized_crop_name(obj)[1]

    def get_description_language_code(self, obj: Crop) -> str | None:
        if (
            not obj.source_public_crop_id
            or obj.is_modified_from_source
            or not (obj.notes or '').strip()
        ):
            return None
        return obj.source_public_crop.original_language_code or None

    def get_crop_species_translations(self, obj: Crop) -> dict[str, str]:
        species = self._get_crop_species(obj)
        if species is None:
            return {}
        return species.translations_by_language()

    def _general_crop_index(self, obj: Crop) -> dict[int, Crop]:
        """The active project's general Kulturen, built once per request.

        A list response would otherwise cost one sibling lookup per Sorte; the
        index turns that into a single query for the whole page.
        """
        cache = self.context.setdefault('_general_crop_index_by_project', {})
        if obj.project_id not in cache:
            cache[obj.project_id] = build_general_crop_index(obj.project_id)
        return cache[obj.project_id]

    def _resolve_general_crop(self, obj: Crop) -> Crop | None:
        cached = getattr(obj, '_serialized_general_crop', _UNRESOLVED)
        if cached is not _UNRESOLVED:
            return cached
        resolved = get_general_crop(obj, self._general_crop_index(obj))
        obj._serialized_general_crop = resolved
        return resolved

    def _inherited_values(self, obj: Crop) -> dict[str, Any]:
        """Inherited values keyed by model field name (see the resolver service)."""
        cached = getattr(obj, '_serialized_inherited_values', None)
        if cached is not None:
            return cached
        if self._resolve_general_crop(obj) is None:
            resolved: dict[str, Any] = {}
        else:
            resolved = build_inherited_crop_values(obj, self._general_crop_index(obj))
        obj._serialized_inherited_values = resolved
        return resolved

    def _api_representation(self, model_field: str, value: Any) -> Any:
        """Render a raw model value the way this serializer renders the own value."""
        api_field = _INHERITABLE_API_FIELD_NAMES.get(model_field, model_field)
        if value is None:
            return None
        representation = self.fields[api_field].to_representation(value)
        if api_field in _SEED_RATE_UNIT_FIELDS:
            return _normalized_seed_rate_unit_representation(representation)
        return representation

    def get_general_crop(self, obj: Crop) -> int | None:
        general_crop = self._resolve_general_crop(obj)
        return general_crop.pk if general_crop else None

    def get_inherited_fields(self, obj: Crop) -> list[str]:
        return [
            _INHERITABLE_API_FIELD_NAMES.get(model_field, model_field)
            for model_field in CROP_INHERITABLE_FIELDS
            if model_field in self._inherited_values(obj)
        ]

    def get_effective_values(self, obj: Crop) -> dict[str, Any]:
        if self._resolve_general_crop(obj) is None:
            return {}
        effective = build_effective_crop_values(obj, self._general_crop_index(obj))
        return {
            _INHERITABLE_API_FIELD_NAMES.get(model_field, model_field): self._api_representation(
                model_field, value,
            )
            for model_field, value in effective.items()
        }
    
    def _resolve_owned_public_crop(self, obj: Crop) -> PublicCrop | None:
        """The published public-library entry the requesting user may act on for this crop."""
        cached = getattr(obj, '_resolved_owned_public_crop', _UNRESOLVED)
        if cached is not _UNRESOLVED:
            return cached

        resolved = self._query_owned_public_crop(obj)
        obj._resolved_owned_public_crop = resolved
        return resolved

    def _query_owned_public_crop(self, obj: Crop) -> PublicCrop | None:
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not user or not user.is_authenticated:
            return None

        if obj.source_public_crop_id:
            source_public = obj.source_public_crop
            if (
                source_public
                and source_public.status == PublicCrop.STATUS_PUBLISHED
                and (
                    source_public.created_by_id == user.id
                    or self._can_moderate_public_crops(user)
                )
            ):
                return source_public
            return None

        prefetched = getattr(obj, '_prefetched_owned_public_crops', None)
        if prefetched is not None:
            if prefetched:
                return prefetched[0]
            return self._resolve_owned_general_public_crop(obj, user)

        linked_public = PublicCrop.objects.filter(
            source_project_crop=obj,
            status=PublicCrop.STATUS_PUBLISHED,
        )
        if not self._can_moderate_public_crops(user):
            linked_public = linked_public.filter(created_by=user)
        resolved = linked_public.order_by('-updated_at', '-id').first()
        if resolved is not None:
            return resolved
        return self._resolve_owned_general_public_crop(obj, user)

    def _resolve_owned_general_public_crop(self, obj: Crop, user) -> PublicCrop | None:
        """A user's species-level public entry can belong to another source project.

        Publishing a Sorte does not overwrite an existing general public entry.
        When that entry is already the user's own entry from a different
        project, the current project's general Kultur should still act on that
        public Kultur instead of offering a duplicate publication.
        """
        if not obj.crop_species_id or (obj.variety or '').strip():
            return None

        cache = self.context.setdefault('_owned_general_public_crop_index_by_project_user', {})
        cache_key = (obj.project_id, user.id)
        if cache_key not in cache:
            general_row_filter = (
                models.Q(variety_normalized__isnull=True)
                | models.Q(variety_normalized='')
            )
            species_ids = (
                Crop.objects
                .filter(general_row_filter, project_id=obj.project_id, crop_species__isnull=False)
                .values_list('crop_species_id', flat=True)
                .distinct()
            )
            index: dict[int, PublicCrop] = {}
            public_rows = (
                PublicCrop.objects
                .filter(
                    general_row_filter,
                    crop_species_id__in=species_ids,
                    created_by=user,
                    status=PublicCrop.STATUS_PUBLISHED,
                )
                .select_related('crop_species')
                .order_by('crop_species_id', '-updated_at', '-id')
            )
            for public_crop in public_rows:
                index.setdefault(public_crop.crop_species_id, public_crop)
            cache[cache_key] = index
        return cache[cache_key].get(obj.crop_species_id)

    def get_owned_public_crop_id(self, obj: Crop) -> int | None:
        public_crop = self._resolve_owned_public_crop(obj)
        return public_crop.id if public_crop else None

    def get_owned_public_crop_role(self, obj: Crop) -> str | None:
        """How the requesting user relates to the linked public entry.

        `contributor` means they published it themselves and can withdraw it
        without a reason; `moderator` means removing it is a moderation action
        that requires a structured reason.
        """
        public_crop = self._resolve_owned_public_crop(obj)
        if public_crop is None:
            return None
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if is_public_crop_contributor(public_crop=public_crop, user=user):
            return 'contributor'
        return 'moderator'

    def get_public_update_available(self, obj: Crop) -> bool:
        """Whether an undecided library update should be announced for this crop.

        Reads the already `select_related`ed `source_public_crop`, so the
        flag costs no extra query per row. The field-level preview behind it
        lives on the `public-update` detail endpoint and is only fetched when
        the user opens it. A version the user rejected is excluded here — the
        notice is gone, but `public_update_rejected` keeps the divergence
        visible so the diff stays reachable.
        """
        return has_open_public_crop_update(obj, self._general_crop_index(obj))

    def get_public_update_rejected(self, obj: Crop) -> bool:
        """Whether the pending library version was explicitly declined by the user."""
        return is_public_crop_update_rejected(obj, self._general_crop_index(obj))

    def get_public_crop_species_pending(self, obj: Crop) -> bool:
        """Whether this crop's own public entry sits under an unreviewed species.

        True only while a moderator has not decided on the species proposal:
        the publication is real but provisional, which the crop detail
        marks with a "proposal under review" chip.
        """
        public_crop = self._resolve_owned_public_crop(obj)
        species = public_crop.crop_species if public_crop else None
        return bool(species and species.is_pending)

    def get_public_publish_blocked_reason(self, obj: Crop) -> str | None:
        """Why publishing/updating the public entry from this copy is blocked, if it is."""
        return resolve_public_publish_block(
            obj, self._resolve_owned_public_crop(obj), self._general_crop_index(obj),
        )

    def _can_moderate_public_crops(self, user) -> bool:
        request = self.context.get('request')
        if request is None:
            return is_public_library_moderator(user)
        cache_attribute = '_can_moderate_public_crops'
        cached = getattr(request, cache_attribute, None)
        if cached is None:
            cached = is_public_library_moderator(user)
            setattr(request, cache_attribute, cached)
        return cached

    def to_representation(self, instance):
        data = super().to_representation(instance)
        for field_name in _SEED_RATE_UNIT_FIELDS:
            data[field_name] = _normalized_seed_rate_unit_representation(data.get(field_name))
        data['seed_requirements'] = self._build_seed_requirements_representation(data)
        # Plant counts must agree with the planting-plan side, which plans from
        # the effective spacing; leaving this on the row's own spacing would let
        # a Sorte show a plant count the grid then refuses to edit.
        data['plants_per_m2'] = self._api_representation(
            'plants_per_m2', resolve_plants_per_m2(instance, self._general_crop_index(instance)),
        )
        return data

    def _build_seed_requirements_representation(self, data: dict[str, Any]) -> dict[str, Any]:
        """Return the preferred agent-facing seed-rate object."""
        requirements = {}
        for method, value_field, unit_field, safety_field in (
            (
                'direct_sowing',
                'seed_rate_direct_value',
                'seed_rate_direct_unit',
                'sowing_calculation_safety_percent_direct',
            ),
            (
                'pre_cultivation',
                'seed_rate_pre_cultivation_value',
                'seed_rate_pre_cultivation_unit',
                'sowing_calculation_safety_percent_pre_cultivation',
            ),
        ):
            value = data.get(value_field)
            unit = data.get(unit_field)
            if value is None or not unit:
                continue
            entry = {'value': value, 'unit': unit}
            safety_percent = data.get(safety_field)
            if safety_percent is not None:
                entry['safety_percent'] = safety_percent
            requirements[method] = entry
        return requirements

    def validate_seed_packages(self, value):
        seen: set[str] = set()
        normalized_packages = []
        quantum = Decimal('0.1')

        for idx, item in enumerate(value):
            raw_size_value = item.get('size_value')
            size_unit = item.get('size_unit') or SeedPackage.UNIT_GRAMS

            try:
                size_value = Decimal(str(raw_size_value))
            except (InvalidOperation, TypeError):
                raise serializers.ValidationError({idx: 'size_value must be a valid number.'})

            if size_value <= 0:
                raise serializers.ValidationError({idx: 'size_value must be > 0'})
            if size_unit not in {SEED_PACKAGE_UNIT_GRAMS, SEED_PACKAGE_UNIT_SEEDS}:
                raise serializers.ValidationError({idx: 'Unsupported package size unit.'})

            normalized_size = size_value
            if size_unit == SEED_PACKAGE_UNIT_GRAMS:
                normalized_size = size_value.quantize(quantum, rounding=ROUND_HALF_UP)
                if size_value != normalized_size:
                    raise serializers.ValidationError({idx: 'Gram package sizes must have at most one decimal place.'})

            uniqueness_key = f"{size_unit}:{normalized_size}"
            if uniqueness_key in seen:
                raise serializers.ValidationError({idx: 'Duplicate package size.'})
            seen.add(uniqueness_key)

            normalized_item = dict(item)
            normalized_item['size_unit'] = size_unit
            normalized_item['size_value'] = normalized_size
            normalized_item.pop('crop', None)
            normalized_packages.append(normalized_item)

        return normalized_packages

    def create(self, validated_data):
        copy_values_to_crop = validated_data.pop('copy_values_to_crop', False)
        supplier_data_input = validated_data.pop('supplier_data_input', [])
        seed_packages = validated_data.pop('seed_packages', [])
        try:
            with transaction.atomic():
                crop = super().create(validated_data)
                crop._auto_general_crop = ensure_general_crop_for_variety(
                    crop,
                    copy_values=copy_values_to_crop,
                )
                # The species-invariant fields belong to the general Kultur.
                # ensure_general_crop_for_variety has just had its chance to
                # lift a genuinely new value up there; whatever is still on the
                # Sorte is a dead override and gets dropped (the API "silently
                # discards" a Sorte-level value rather than rejecting it).
                clear_species_invariant_overrides(crop)
        except IntegrityError as exc:
            self._raise_name_conflict_if_general_name_constraint(exc)
            raise
        if isinstance(supplier_data_input, list):
            for row in supplier_data_input:
                if not isinstance(row, dict):
                    continue
                row_data = dict(row)
                if _is_empty_supplier_data_payload(row_data):
                    continue
                serializer = CropSupplierDataSerializer(
                    data=row_data,
                    context={**self.context, 'parent_crop': crop},
                )
                serializer.is_valid(raise_exception=True)
                serializer.save(crop=crop, project=crop.project)
        if isinstance(seed_packages, list):
            for package_data in seed_packages:
                if isinstance(package_data, dict):
                    package_data = dict(package_data)
                    package_data.pop('crop', None)
                    package_data.setdefault('project', crop.project)
                    SeedPackage.objects.create(crop=crop, **package_data)
        return crop

    def update(self, instance, validated_data):
        supplier_data_input = validated_data.pop('supplier_data_input', None)
        seed_packages = validated_data.pop('seed_packages', None)
        try:
            with transaction.atomic():
                crop = super().update(instance, validated_data)
                crop._auto_general_crop = ensure_general_crop_for_variety(crop)
                clear_species_invariant_overrides(crop)
        except IntegrityError as exc:
            self._raise_name_conflict_if_general_name_constraint(exc)
            raise
        if supplier_data_input is not None:
            self._sync_supplier_data_rows(crop, supplier_data_input)
        if seed_packages is not None:
            self._replace_seed_packages(crop, seed_packages)
        return crop

    def _sync_supplier_data_rows(self, crop, supplier_data_input):
        """Upsert the supplied supplier-data rows and delete rows no longer present."""
        existing_by_id = {row.id: row for row in crop.supplier_data.all()}
        seen_ids: set[int] = set()
        if isinstance(supplier_data_input, list):
            for row in supplier_data_input:
                saved_id = self._save_supplier_data_row(crop, row, existing_by_id)
                if saved_id is not None:
                    seen_ids.add(saved_id)

        ids_to_delete = [row_id for row_id in existing_by_id if row_id not in seen_ids]
        if ids_to_delete:
            CropSupplierData.objects.filter(id__in=ids_to_delete).delete()

    def _save_supplier_data_row(self, crop, row, existing_by_id) -> int | None:
        """Upsert one supplier-data row; returns its id, or None if skipped."""
        if not isinstance(row, dict):
            return None
        row_data = dict(row)
        if _is_empty_supplier_data_payload(row_data):
            return None
        raw_row_id = row_data.get('id')
        try:
            row_id = int(raw_row_id)
        except (TypeError, ValueError):
            row_id = None
        instance_row = existing_by_id.get(row_id) if row_id is not None else None
        serializer = CropSupplierDataSerializer(
            instance=instance_row,
            data=row_data,
            context={**self.context, 'parent_crop': crop},
            partial=instance_row is not None,
        )
        serializer.is_valid(raise_exception=True)
        saved_row = serializer.save(crop=crop, project=crop.project)
        return saved_row.id

    def _replace_seed_packages(self, crop, seed_packages):
        """Delete all existing seed packages and recreate them from the payload."""
        crop.seed_packages.all().delete()
        if isinstance(seed_packages, list):
            for package_data in seed_packages:
                if isinstance(package_data, dict):
                    package_data = dict(package_data)
                    package_data.pop('crop', None)
                    package_data.setdefault('project', crop.project)
                    SeedPackage.objects.create(crop=crop, **package_data)

    def validate_origin_type(self, value):
        if value in {None, ''}:
            if self.instance and self.instance.source_public_crop_id:
                return Crop.ORIGIN_IMPORTED
            return Crop.ORIGIN_MANUAL

        normalized = str(value).strip().lower()
        if normalized == Crop.ORIGIN_MANUAL:
            return Crop.ORIGIN_MANUAL
        if normalized == Crop.ORIGIN_IMPORTED or normalized.startswith('import'):
            return Crop.ORIGIN_IMPORTED
        return Crop.ORIGIN_MANUAL

    def validate_seed_rate_unit(self, value):
        """Normalize legacy seed rate unit values and validate supported units."""
        return _normalize_seed_rate_unit_value(value)

    def validate_seed_rate_direct_unit(self, value):
        """Normalize direct-sowing seed rate units and legacy empty placeholders."""
        return _normalize_seed_rate_unit_value(value)

    def validate_seed_rate_pre_cultivation_unit(self, value):
        """Normalize pre-cultivation seed rate units and legacy empty placeholders."""
        return _normalize_seed_rate_unit_value(value)

    def validate_growth_duration_days(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError('Growth duration must be non-negative.')
        return value
    
    def validate_harvest_duration_days(self, value):
        if value is None:
            return value
        if value < 0:
            raise serializers.ValidationError('Harvest duration must be non-negative.')
        return value
    
    def validate_rotation_break_years(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError('Rotation break must be non-negative.')
        return value

    def validate_germination_rate(self, value):
        if value is not None and (value < 0 or value > 100):
            raise serializers.ValidationError('Germination rate must be between 0 and 100.')
        return value
    
    def validate_safety_margin(self, value):
        if value is not None and (value < 0 or value > 100):
            raise serializers.ValidationError('Safety margin must be between 0 and 100.')
        return value
    
    def validate(self, attrs):
        """Validate cross-field rules and supplier get-or-create.

        Split into one helper per field group. The intermediate error gates
        (raise-before-continuing) mirror the original monolithic method:
        later phases assume the earlier ones produced consistent data.
        """
        errors = {}

        general_name_conflict = self._validate_name_and_duplicates(attrs, errors)
        cultivation_types = self._validate_cultivation_types(attrs, errors)
        self._apply_seed_requirements_alias(attrs, errors, cultivation_types)
        self._validate_seed_rate_by_cultivation(attrs, errors, cultivation_types)
        self._validate_seed_rate_fields(attrs, errors, cultivation_types)
        self._validate_supplier_data_rows(attrs, errors)
        self._resolve_supplier_from_name(attrs)
        self._normalize_variety(attrs)
        if general_name_conflict and set(errors) == {'name'}:
            raise CropNameConflict()
        if errors:
            raise serializers.ValidationError(errors)

        self._validate_supplier_consistency(attrs, errors)
        if errors:
            raise serializers.ValidationError(errors)

        self._validate_seeding_requirement(attrs, errors)
        if errors:
            raise serializers.ValidationError(errors)

        self._run_model_clean(attrs)
        return attrs

    def _resolve_project(self, attrs, *, instance_first: bool):
        """Resolve the project the way the original inline blocks did.

        The name/duplicate check prefers attrs -> request -> instance, while
        the supplier get-or-create prefers attrs -> instance -> request.
        """
        project = attrs.get('project')
        if instance_first:
            if project is None and self.instance is not None:
                project = self.instance.project
            if project is None:
                request = self.context.get('request')
                project = getattr(request, 'active_project', None)
            return project
        if project is None:
            request = self.context.get('request')
            if request is not None:
                project = getattr(request, 'active_project', None)
        if project is None and self.instance is not None:
            project = self.instance.project
        return project

    def _validate_name_and_duplicates(self, attrs, errors) -> bool:
        """Require a name and reject duplicate crop identities per project.

        Returns whether the only problem found was a general-crop name
        conflict, so ``validate()`` can still raise the dedicated
        ``CropNameConflict`` (409) for that case alone, while any other
        validation errors discovered by later phases get aggregated into the
        normal ``errors`` dict instead of being swallowed by an early raise.
        """
        from farm.utils import normalize_text

        raw_name = attrs.get(
            'name',
            getattr(self.instance, 'name', None) if self.instance else None,
        )
        raw_variety = attrs.get(
            'variety',
            getattr(self.instance, 'variety', '') if self.instance else '',
        )
        normalized_name = normalize_text(raw_name)
        normalized_variety = normalize_text(raw_variety)
        if not normalized_name:
            errors['name'] = 'Name is required.'
            return False
        attrs['name'] = ' '.join(str(raw_name).split())
        attrs['variety'] = ' '.join(str(raw_variety or '').split())
        project = self._resolve_project(attrs, instance_first=False)
        if project is None:
            return False

        # Keep existing duplicate records editable when the normalized identity is
        # unchanged on update. This preserves compatibility with legacy data that
        # may already contain duplicates.
        if (
            self.instance is not None
            and normalize_text(getattr(self.instance, 'name', None)) == normalized_name
            and normalize_text(getattr(self.instance, 'variety', None)) == normalized_variety
        ):
            return False
        if normalized_variety is None:
            existing_general_query = Crop.all_objects.filter(
                project=project,
                deleted_at__isnull=True,
                name_normalized=normalized_name,
            ).filter(models.Q(variety_normalized__isnull=True) | models.Q(variety_normalized=''))
            if self.instance is not None:
                existing_general_query = existing_general_query.exclude(pk=self.instance.pk)
            if existing_general_query.exists():
                errors['name'] = 'A general crop with this name already exists in this project.'
                return True
        existing_name_query = Crop.all_objects.filter(
            project=project,
            deleted_at__isnull=True,
            name_normalized=normalized_name,
            variety_normalized=normalized_variety,
        )
        if self.instance is not None:
            existing_name_query = existing_name_query.exclude(pk=self.instance.pk)
        if existing_name_query.exists():
            errors['name'] = 'A crop with this name and variety already exists.'
        return False

    @staticmethod
    def _raise_name_conflict_if_general_name_constraint(exc: IntegrityError) -> None:
        if 'unique_general_crop_name_per_project' in str(exc):
            raise CropNameConflict() from exc

    def _validate_cultivation_types(self, attrs, errors):
        """Normalize cultivation_types; returns the resolved raw value."""
        cultivation_types = attrs.get(
            'cultivation_types',
            getattr(self.instance, 'cultivation_types', None) if self.instance else None,
        )
        legacy_cultivation_type = attrs.get(
            'cultivation_type',
            getattr(self.instance, 'cultivation_type', '') if self.instance else '',
        )
        if cultivation_types is None:
            cultivation_types = [legacy_cultivation_type] if legacy_cultivation_type else []
        if not isinstance(cultivation_types, list):
            errors['cultivation_types'] = 'Cultivation types must be a list.'
            return cultivation_types
        normalized_types = [str(item).strip() for item in cultivation_types if str(item).strip()]
        allowed_types = {'pre_cultivation', 'direct_sowing'}
        if not normalized_types:
            normalized_types = ['pre_cultivation']
        if len(set(normalized_types)) != len(normalized_types):
            errors['cultivation_types'] = 'Cultivation types must be unique.'
        elif any(item not in allowed_types for item in normalized_types):
            errors['cultivation_types'] = 'Cultivation types contain unsupported values.'
        else:
            attrs['cultivation_types'] = normalized_types
            attrs['cultivation_type'] = normalized_types[0]
        return cultivation_types

    def _apply_seed_requirements_alias(
        self,
        attrs: dict[str, Any],
        errors: dict[str, str],
        cultivation_types: list[str] | None,
    ) -> None:
        """Map the preferred nested seed-rate object onto the stored fields."""
        if 'seed_requirements' not in attrs:
            return

        seed_requirements = attrs.pop('seed_requirements')
        if not isinstance(seed_requirements, dict):
            errors['seed_requirements'] = 'Seed requirements must be an object.'
            return

        method_error = self._seed_requirements_method_error(
            attrs,
            cultivation_types,
            seed_requirements,
        )
        if method_error:
            errors['seed_requirements'] = method_error
            return

        normalized_requirements = {}
        for method, payload in seed_requirements.items():
            normalized_entry, entry_error = self._normalize_seed_requirement_entry(
                method,
                payload,
            )
            if entry_error:
                errors['seed_requirements'] = entry_error
                return
            value = normalized_entry['value']
            unit = normalized_entry['unit']
            safety_percent = normalized_entry.get('safety_percent')
            value_field, unit_field, safety_field = self._seed_requirement_method_fields()[method]
            conflict = self._seed_requirement_conflict(
                attrs,
                value_field=value_field,
                unit_field=unit_field,
                safety_field=safety_field,
                value=value,
                unit=unit,
                safety_percent=safety_percent,
            )
            if conflict:
                errors['seed_requirements'] = conflict
                return

            attrs[value_field] = value
            attrs[unit_field] = unit
            if safety_percent is not None:
                attrs[safety_field] = safety_percent
            normalized_requirements[method] = normalized_entry

        if normalized_requirements:
            attrs['seed_rate_by_cultivation'] = {
                method: {
                    'value': entry['value'],
                    'unit': entry['unit'],
                }
                for method, entry in normalized_requirements.items()
            }

    def _seed_requirement_method_fields(self) -> dict[str, tuple[str, str, str]]:
        """Return storage fields for each seed requirement method."""
        return {
            'direct_sowing': (
                'seed_rate_direct_value',
                'seed_rate_direct_unit',
                'sowing_calculation_safety_percent_direct',
            ),
            'pre_cultivation': (
                'seed_rate_pre_cultivation_value',
                'seed_rate_pre_cultivation_unit',
                'sowing_calculation_safety_percent_pre_cultivation',
            ),
        }

    def _seed_requirements_method_error(
        self,
        attrs: dict[str, Any],
        cultivation_types: list[str] | None,
        seed_requirements: dict[str, Any],
    ) -> str | None:
        """Return a method-level validation error for the seed requirements object."""
        target_types = set(attrs.get('cultivation_types') or cultivation_types or [])
        allowed_methods = set(self._seed_requirement_method_fields())
        unknown_methods = set(seed_requirements) - allowed_methods
        if unknown_methods:
            return 'Seed requirements contain unsupported methods.'
        if target_types and not set(seed_requirements).issubset(target_types):
            return 'Seed requirement methods must be subset of cultivation_types.'
        return None

    def _normalize_seed_requirement_entry(
        self,
        method: str,
        payload: Any,
    ) -> tuple[dict[str, Any] | None, str | None]:
        """Normalize one seed requirement entry or return a validation message."""
        if not isinstance(payload, dict):
            return None, 'Seed requirement entries must be objects.'
        try:
            value = float(payload.get('value'))
        except (TypeError, ValueError):
            return None, 'Seed requirement values must be numeric.'
        if value <= 0:
            return None, 'Seed requirement values must be positive.'
        try:
            unit = _normalize_seed_rate_unit_value(payload.get('unit'))
        except serializers.ValidationError:
            return None, 'Seed requirement unit is unsupported.'
        if unit is None:
            return None, 'Seed requirement unit is required.'

        entry_error = _seed_rate_entry_error(method, {'value': value, 'unit': unit})
        if entry_error:
            return None, entry_error

        normalized_entry = {'value': value, 'unit': unit}
        safety_percent, safety_error = self._normalize_seed_requirement_safety(payload)
        if safety_error:
            return None, safety_error
        if safety_percent is not None:
            normalized_entry['safety_percent'] = safety_percent
        return normalized_entry, None

    def _normalize_seed_requirement_safety(
        self,
        payload: dict[str, Any],
    ) -> tuple[float | None, str | None]:
        """Normalize optional seed requirement safety_percent."""
        safety_percent = payload.get('safety_percent')
        if safety_percent is None:
            return None, None
        try:
            safety_percent = float(safety_percent)
        except (TypeError, ValueError):
            return None, 'Seed requirement safety_percent must be numeric.'
        if safety_percent < 0 or safety_percent > 100:
            return None, 'Seed requirement safety_percent must be between 0 and 100.'
        return safety_percent, None

    def _seed_requirement_conflict(
        self,
        attrs,
        *,
        value_field: str,
        unit_field: str,
        safety_field: str,
        value: float,
        unit: str,
        safety_percent: float | None,
    ) -> str | None:
        """Return a validation message when nested and flat seed rates disagree."""
        if value_field in attrs and attrs[value_field] is not None:
            try:
                existing_value = float(attrs[value_field])
            except (TypeError, ValueError):
                existing_value = None
            if existing_value != value:
                return f'{value_field} conflicts with seed_requirements.'
        if unit_field in attrs:
            try:
                existing_unit = _normalize_seed_rate_unit_value(attrs[unit_field])
            except serializers.ValidationError:
                existing_unit = attrs[unit_field]
            if existing_unit != unit:
                return f'{unit_field} conflicts with seed_requirements.'
        if safety_percent is not None and safety_field in attrs and attrs[safety_field] is not None:
            try:
                existing_safety = float(attrs[safety_field])
            except (TypeError, ValueError):
                existing_safety = None
            if existing_safety != safety_percent:
                return f'{safety_field} conflicts with seed_requirements.'
        return None

    def _validate_seed_rate_by_cultivation(self, attrs, errors, cultivation_types):
        """Validate the per-cultivation seed rate map and derive the legacy fields."""
        seed_rate_by_cultivation = attrs.get(
            'seed_rate_by_cultivation',
            getattr(self.instance, 'seed_rate_by_cultivation', None) if self.instance else None,
        )
        if seed_rate_by_cultivation is None:
            return
        if not isinstance(seed_rate_by_cultivation, dict):
            errors['seed_rate_by_cultivation'] = 'Seed rate by cultivation must be an object.'
            return
        target_types = set(attrs.get('cultivation_types') or cultivation_types or [])
        if not set(seed_rate_by_cultivation.keys()).issubset(target_types):
            errors['seed_rate_by_cultivation'] = 'Seed rate keys must be subset of cultivation_types.'
        else:
            for method, payload in seed_rate_by_cultivation.items():
                entry_error = _seed_rate_entry_error(method, payload)
                if entry_error:
                    errors['seed_rate_by_cultivation'] = entry_error
                    break

        if 'seed_rate_by_cultivation' not in errors:
            if 'pre_cultivation' in seed_rate_by_cultivation:
                primary = seed_rate_by_cultivation['pre_cultivation']
            elif 'direct_sowing' in seed_rate_by_cultivation:
                primary = seed_rate_by_cultivation['direct_sowing']
            else:
                primary = None
            if isinstance(primary, dict):
                attrs['seed_rate_value'] = float(primary.get('value'))
                attrs['seed_rate_unit'] = primary.get('unit')

    def _validate_seed_rate_fields(self, attrs, errors, cultivation_types):
        """Validate the flat direct-sowing / pre-cultivation seed rate fields."""
        direct_value = attrs.get(
            'seed_rate_direct_value',
            getattr(self.instance, 'seed_rate_direct_value', None) if self.instance else None,
        )
        direct_unit = attrs.get(
            'seed_rate_direct_unit',
            getattr(self.instance, 'seed_rate_direct_unit', None) if self.instance else None,
        )
        pre_value = attrs.get(
            'seed_rate_pre_cultivation_value',
            getattr(self.instance, 'seed_rate_pre_cultivation_value', None) if self.instance else None,
        )
        pre_unit = attrs.get(
            'seed_rate_pre_cultivation_unit',
            getattr(self.instance, 'seed_rate_pre_cultivation_unit', None) if self.instance else None,
        )
        active_types = set(attrs.get('cultivation_types') or cultivation_types or [])
        direct_unit = _normalize_seed_rate_unit_value(direct_unit)
        pre_unit = _normalize_seed_rate_unit_value(pre_unit)
        if 'seed_rate_direct_unit' in attrs:
            attrs['seed_rate_direct_unit'] = direct_unit
        if 'seed_rate_pre_cultivation_unit' in attrs:
            attrs['seed_rate_pre_cultivation_unit'] = pre_unit

        if 'direct_sowing' in active_types and direct_value is not None and not direct_unit:
            errors['seed_rate_direct_unit'] = 'Direct sowing seed rate unit is required when direct sowing value is set.'
        if direct_value is not None and direct_value <= 0:
            errors['seed_rate_direct_value'] = 'Direct sowing seed rate value must be greater than zero.'
        if direct_value is not None and direct_unit and direct_unit not in SEED_RATE_UNITS:
            errors['seed_rate_direct_unit'] = 'Direct sowing seed rate unit is unsupported.'
        _add_seed_rate_unit_constraint_error(
            errors,
            'seed_rate_direct_value',
            'direct_sowing',
            direct_value,
            direct_unit,
        )

        if 'pre_cultivation' in active_types and pre_value is not None and not pre_unit:
            errors['seed_rate_pre_cultivation_unit'] = 'Pre-cultivation seed rate unit is required when pre-cultivation value is set.'
        if pre_value is not None and pre_value <= 0:
            errors['seed_rate_pre_cultivation_value'] = 'Pre-cultivation seed rate value must be greater than zero.'
        if pre_value is not None and pre_unit and pre_unit not in PRE_CULTIVATION_SEED_RATE_UNITS:
            errors['seed_rate_pre_cultivation_unit'] = 'Pre-cultivation seed rate unit is unsupported.'
        _add_seed_rate_unit_constraint_error(
            errors,
            'seed_rate_pre_cultivation_value',
            'pre_cultivation',
            pre_value,
            pre_unit,
        )

    def _validate_supplier_data_rows(self, attrs, errors):
        """Require a supplier on any non-empty supplier_data_input row."""
        supplier_data_input = attrs.get('supplier_data_input')
        if not isinstance(supplier_data_input, list):
            return
        existing_supplier_rows = {}
        if self.instance is not None:
            existing_supplier_rows = {row.id: row for row in self.instance.supplier_data.all()}

        supplier_data_errors = {}
        for index, row in enumerate(supplier_data_input):
            if not isinstance(row, dict) or _is_empty_supplier_data_payload(row):
                continue

            has_supplier = _supplier_data_payload_has_supplier(row)
            raw_row_id = row.get('id')
            try:
                row_id = int(raw_row_id)
            except (TypeError, ValueError):
                row_id = None
            if (
                not has_supplier
                and row_id is not None
                and row_id in existing_supplier_rows
                and 'supplier_id' not in row
                and 'supplier' not in row
            ):
                has_supplier = True

            if not has_supplier and _supplier_data_payload_has_information(row):
                supplier_data_errors[index] = {
                    'supplier_id': 'supplier_data_missing_supplier',
                }

        if supplier_data_errors:
            errors['supplier_data_input'] = supplier_data_errors

    def _resolve_supplier_from_name(self, attrs):
        """Handle supplier_name via get-or-create to keep imports ergonomic.

        If supplier_id was explicitly provided (including null), respect it and
        do not implicitly override from supplier_name.
        """
        supplier_name = attrs.pop('supplier_name', None)
        supplier_explicitly_set = 'supplier' in attrs
        if not supplier_name or supplier_explicitly_set or attrs.get('supplier'):
            return
        from farm.utils import normalize_supplier_name
        project = self._resolve_project(attrs, instance_first=True)
        if project is None:
            project, _ = Project.objects.get_or_create(
                slug='gelawi-zwiebelzopf',
                defaults={'name': 'Gelawi Zwiebelzopf', 'description': '', 'is_active': True},
            )
        normalized = normalize_supplier_name(supplier_name) or ''
        try:
            with transaction.atomic():
                supplier, _created = Supplier.objects.get_or_create(
                    name_normalized=normalized,
                    project=project,
                    defaults={
                        'name': supplier_name,
                        'homepage_url': 'https://example.invalid',
                        'project': project,
                    },
                )
        except IntegrityError as exc:
            supplier = Supplier.objects.filter(project=project, name_normalized=normalized).first()
            if supplier is None:
                raise serializers.ValidationError({'supplier': 'Lieferant konnte nicht gespeichert werden.'}) from exc
        attrs['supplier'] = supplier

    def _normalize_variety(self, attrs):
        """Keep variety optional for compatibility with existing API/tests."""
        if 'variety' not in attrs and not self.instance:
            attrs['variety'] = ''
        elif 'variety' in attrs:
            attrs['variety'] = (attrs.get('variety') or '').strip()

    def _validate_supplier_consistency(self, attrs, errors):
        """Suppliers and the product URL must match the active project/domains."""
        supplier = attrs.get('supplier', getattr(self.instance, 'supplier', None) if self.instance else None)
        project = attrs.get('project') or _resolve_active_project_from_serializer(self)
        image_file = attrs.get(
            'image_file',
            getattr(self.instance, 'image_file', None) if self.instance else None,
        )
        if project is not None and image_file is not None and image_file.project_id != project.id:
            errors['image_file_id'] = 'image_file_project_mismatch'
        if project is not None and supplier is not None and supplier.project_id != project.id:
            errors['supplier'] = 'supplier_project_mismatch'
        selected_supplier = attrs.get(
            'selected_seed_demand_supplier',
            getattr(self.instance, 'selected_seed_demand_supplier', None) if self.instance else None,
        )
        if project is not None and selected_supplier is not None and selected_supplier.project_id != project.id:
            errors['selected_seed_demand_supplier'] = 'selected_supplier_project_mismatch'
        supplier_product_url = attrs.get(
            'supplier_product_url',
            getattr(self.instance, 'supplier_product_url', None) if self.instance else None,
        )
        if supplier_product_url:
            if not supplier or not is_supplier_domain(supplier_product_url, supplier):
                errors['supplier_product_url'] = {
                    'code': 'supplier_product_url_domain_mismatch',
                    'message': 'Supplier product URL must match supplier allowed domains.',
                }

    def _validate_seeding_requirement(self, attrs, errors):
        seeding_requirement = attrs.get('seeding_requirement', getattr(self.instance, 'seeding_requirement', None) if self.instance else None)
        seeding_requirement_type = attrs.get('seeding_requirement_type', getattr(self.instance, 'seeding_requirement_type', '') if self.instance else '')
        if seeding_requirement is None and seeding_requirement_type:
            errors['seeding_requirement'] = 'Seeding requirement value is required when seeding requirement type is set.'
        if seeding_requirement is not None and not seeding_requirement_type:
            errors['seeding_requirement_type'] = 'Seeding requirement type is required when seeding requirement is set.'

    def _run_model_clean(self, attrs):
        """Run Crop.clean on a throwaway instance without mutating the real one."""
        try:
            model_field_names = {field.name for field in Crop._meta.fields}

            if self.instance:
                temp_attrs = {}
                for field_name in model_field_names:
                    if field_name in attrs:
                        temp_attrs[field_name] = attrs[field_name]
                    elif hasattr(self.instance, field_name):
                        temp_attrs[field_name] = getattr(self.instance, field_name)
                temp_instance = Crop(**temp_attrs)
                temp_instance.pk = self.instance.pk
            else:
                temp_instance = Crop(**{k: v for k, v in attrs.items() if k in model_field_names})

            # Validate without mutating the real instance.
            temp_instance.clean()
        except ValidationError as e:
            raise serializers.ValidationError(e.message_dict) from e
