"""Preview and apply for the crops page's spreadsheet import.

Separate from `analysis`/`apply` in this package, which serve the agent API's
draft-based import: this one takes already-parsed rows straight from the
spreadsheet the user uploaded and reports, or applies, one outcome per row.
"""

from decimal import Decimal, InvalidOperation
from typing import Any

from crops.plant_families import coerce_plant_family_key
from crops.services import find_species_by_common_name
from farm.crops.serializers import CropSerializer
from farm.models import Crop, Project, Supplier
from farm.services.crop_inheritance import CROP_SPECIES_INVARIANT_FIELDS
from farm.utils import normalize_supplier_name, normalize_text

_ROW_SHAPE_ERROR = 'Entry must be an object with at least a "name" field.'

# Read-only and auto-generated fields are excluded: a diff is only useful for
# values the import could actually change.
_COMPARABLE_FIELDS = [
    'name', 'variety', 'notes', 'seed_supplier',
    'crop_family', 'nutrient_demand', 'cultivation_type',
    'growth_duration_days', 'harvest_duration_days', 'propagation_duration_days',
    'harvest_method', 'expected_yield',
    'distance_within_row_cm', 'row_spacing_cm', 'sowing_depth_cm',
    'seed_rate_value', 'seed_rate_unit', 'sowing_calculation_safety_percent',
    'seed_rate_direct_value', 'seed_rate_direct_unit', 'sowing_calculation_safety_percent_direct',
    'seed_rate_pre_cultivation_value', 'seed_rate_pre_cultivation_unit',
    'sowing_calculation_safety_percent_pre_cultivation',
    'thousand_kernel_weight_g',
    'seeding_requirement', 'seeding_requirement_type', 'display_color',
]


def _is_importable_row(crop_data: Any) -> bool:
    return isinstance(crop_data, dict) and bool(crop_data.get('name'))


def _normalize_crop_family(crop_data: dict) -> None:
    """Map a family name or synonym in the sheet ("Kreuzblütler") to its botanical name.

    A value that names no listed family is left as it is, so the serializer
    reports it as an unknown plant family instead of the import dropping it.
    """
    raw_family = crop_data.get('crop_family')
    if isinstance(raw_family, str) and raw_family.strip():
        crop_data['crop_family'] = coerce_plant_family_key(raw_family) or raw_family


def _resolve_crop_species(crop_data: dict) -> None:
    """Link a new row to the species its name names, as the crop form does.

    A sheet has no species column, so without this an imported Sorte had no
    species, hence no general Kultur to inherit from, and lost every value it
    inherits (nutrient demand, family, cultivation type, ...).
    """
    if crop_data.get('crop_species'):
        return
    species = find_species_by_common_name(crop_data.get('name'))
    if species is not None:
        crop_data['crop_species'] = species.pk


def resolve_supplier(project: Project, crop_data: dict) -> Supplier | None:
    """Resolve the row's supplier from `supplier_id`, or create it by name."""
    supplier_id = crop_data.get('supplier_id')
    supplier_name = crop_data.get('supplier_name')

    if supplier_id:
        # Project-scoped so a supplied id cannot pull in a supplier from
        # another project and attach it to this project's crop.
        try:
            return Supplier.objects.get(id=supplier_id, project=project)
        except Supplier.DoesNotExist:
            return None
    elif supplier_name:
        normalized = normalize_supplier_name(supplier_name)
        if normalized:
            supplier, _ = Supplier.objects.get_or_create(
                name_normalized=normalized,
                project=project,
                defaults={
                    'name': supplier_name,
                    'homepage_url': 'https://example.invalid',
                    'project': project,
                },
            )
            return supplier

    return None


def find_matching_crop(
    project: Project,
    name: str,
    variety: str | None,
    supplier: Supplier | None,
    supplier_name: str | None = None,
) -> Crop | None:
    """Find the crop an import row would update, by normalized name/variety."""
    name_norm = normalize_text(name) or ''
    variety_norm = normalize_text(variety)

    # Scoped to the active project: without this filter an import row could
    # match — and then overwrite — a crop belonging to a different
    # project that happens to share a name/variety pair.
    base_queryset = Crop.objects.filter(
        project=project,
        name_normalized=name_norm,
        variety_normalized=variety_norm,
    )

    # Prefer exact FK match when supplier could be resolved.
    if supplier:
        direct_match = base_queryset.filter(supplier=supplier).first()
        if direct_match:
            return direct_match

    # Fallback for legacy/partial imports: match supplier names case-insensitively,
    # whether supplier is stored as FK supplier or legacy seed_supplier text.
    supplier_name_normalized = normalize_supplier_name(supplier_name)
    if not supplier_name_normalized and supplier:
        supplier_name_normalized = supplier.name_normalized

    if supplier_name_normalized:
        for candidate in base_queryset.select_related('supplier'):
            candidate_supplier_normalized = normalize_supplier_name(
                candidate.supplier.name if candidate.supplier else candidate.seed_supplier
            )
            if candidate_supplier_normalized == supplier_name_normalized:
                return candidate

    # Final fallback: legacy behavior when no supplier information is available.
    return base_queryset.filter(supplier__isnull=True).first()


def _is_number(value: Any) -> bool:
    return isinstance(value, int | float | Decimal) and not isinstance(value, bool)


def _values_equal(import_value: Any, existing_value: Any) -> bool:
    """Equal, treating a number and its decimal string as one value ("5.60" == 5.6)."""
    if import_value == existing_value:
        return True
    if not (_is_number(import_value) or _is_number(existing_value)):
        return False
    try:
        return Decimal(str(import_value)) == Decimal(str(existing_value))
    except (InvalidOperation, ValueError):
        return False


def compute_crop_diff(existing_crop: Crop, import_data: dict) -> list[dict]:
    """Field-by-field differences the import row would apply to the crop."""
    diff = []
    existing_data = CropSerializer(existing_crop).data
    effective_values = existing_data.get('effective_values') or {}

    for field in _COMPARABLE_FIELDS:
        if field in import_data:
            import_value = import_data[field]
            existing_value = existing_data.get(field)
            # A linked Sorte keeps family and nutrient demand on its Kultur and
            # the import routes them there, so its own column is not the value.
            if field in CROP_SPECIES_INVARIANT_FIELDS and field in effective_values:
                existing_value = effective_values[field]

            if not _values_equal(import_value, existing_value):
                # An empty string and a missing value mean the same thing here.
                if (import_value == '' and existing_value is None) or \
                   (import_value is None and existing_value == ''):
                    continue

                diff.append({
                    'field': field,
                    'current': existing_value,
                    'new': import_value,
                })

    return diff


def _match_import_row(project: Project, crop_data: dict) -> tuple[Supplier | None, Crop | None]:
    supplier = resolve_supplier(project, crop_data)
    return supplier, find_matching_crop(
        project,
        crop_data['name'],
        crop_data.get('variety', ''),
        supplier,
        crop_data.get('supplier_name') or crop_data.get('seed_supplier'),
    )


def preview_crop_import(project: Project, rows: list) -> list[dict]:
    """One outcome per row — `create`, `update_candidate` (with a diff), or an error."""
    results: list[dict] = []

    for idx, crop_data in enumerate(rows):
        if not _is_importable_row(crop_data):
            results.append({
                'index': idx,
                'error': _ROW_SHAPE_ERROR,
                'import_data': crop_data,
            })
            continue

        try:
            _normalize_crop_family(crop_data)
            _supplier, matching_crop = _match_import_row(project, crop_data)

            if matching_crop:
                results.append({
                    'index': idx,
                    'status': 'update_candidate',
                    'matched_crop_id': matching_crop.id,
                    'diff': compute_crop_diff(matching_crop, crop_data),
                    'import_data': crop_data,
                })
            else:
                results.append({
                    'index': idx,
                    'status': 'create',
                    'import_data': crop_data,
                })
        except Exception as error:
            results.append({
                'index': idx,
                'error': str(error),
                'import_data': crop_data,
            })

    return results


def apply_crop_import(project: Project, rows: list, *, confirm_updates: bool) -> dict[str, Any]:
    """Create the rows that are new and, when confirmed, update the ones that match."""
    created_count = 0
    updated_count = 0
    skipped_count = 0
    errors: list[dict] = []

    for idx, crop_data in enumerate(rows):
        if not _is_importable_row(crop_data):
            errors.append({'index': idx, 'error': _ROW_SHAPE_ERROR})
            continue

        try:
            _normalize_crop_family(crop_data)
            supplier, matching_crop = _match_import_row(project, crop_data)
            if supplier:
                crop_data['supplier'] = supplier.id

            if matching_crop:
                if not confirm_updates:
                    skipped_count += 1
                    continue
                serializer = CropSerializer(
                    matching_crop, data=crop_data, partial=True,
                    context={'project': project},
                )
                if serializer.is_valid():
                    serializer.save()
                    updated_count += 1
                else:
                    errors.append({'index': idx, 'error': serializer.errors})
            else:
                # `project` is read-only on the serializer, so it is assigned
                # server-side from the active project here; any client-supplied
                # project in the payload is intentionally ignored to keep
                # imports project-scoped.
                #
                # The project also goes into the context: this runs outside a
                # request cycle, and without it the serializer's cross-project
                # checks on `image_file_id`/`supplier_id`/
                # `selected_seed_demand_supplier` have no project to compare
                # against on a create (there is no bound instance either).
                _resolve_crop_species(crop_data)
                serializer = CropSerializer(data=crop_data, context={'project': project})
                if serializer.is_valid():
                    serializer.save(project=project)
                    created_count += 1
                else:
                    errors.append({'index': idx, 'error': serializer.errors})
        except Exception as error:
            errors.append({'index': idx, 'error': str(error)})

    return {
        'created_count': created_count,
        'updated_count': updated_count,
        'skipped_count': skipped_count,
        'errors': errors,
    }
