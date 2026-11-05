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
from farm.services.crop_companions import (
    CompanionNameResolver,
    apply_import_companions,
    link_free_text_companions,
    preview_row_companions,
)
from farm.services.crop_inheritance import CROP_SPECIES_INVARIANT_FIELDS
from farm.services.timing_windows import (
    TIMING_WINDOW_KINDS,
    TimingWindow,
    load_timing_window_index,
    sort_windows,
)
from farm.utils import normalize_supplier_name, normalize_text

from .germination import apply_germination_cells
from .timing_windows import (
    ERROR_HARVEST_NOT_IMPORTED,
    PARSE_ERROR_MESSAGES,
    TimingWindowParseError,
    is_timing_window_text,
    parse_timing_window_cell,
)

_ROW_SHAPE_ERROR = 'Entry must be an object with at least a "name" field.'
_COMPANION_FIELDS = ('good_companions', 'bad_companions')


def _pop_companions(crop_data: dict) -> dict[str, Any]:
    """Take the neighbour columns off a row; they are applied once every row exists."""
    return {name: crop_data.pop(name) for name in _COMPANION_FIELDS if name in crop_data}


# One text column per window kind ("Anfang März bis Ende April; KW 30").
TIMING_WINDOW_COLUMNS: dict[str, str] = {f'{kind}_windows': kind for kind in TIMING_WINDOW_KINDS}

# The sheet's text in the harvest-duration column when it is no number. The
# spreadsheet reader sends it under this key only, so the row still imports.
HARVEST_DURATION_TEXT_KEY = 'harvest_duration_days_text'


def _harvest_duration_text_issue(crop_data: dict) -> dict[str, Any] | None:
    """An issue when the harvest-duration column holds a window instead of days.

    Other text there is dropped without a message, as before.
    """
    text = crop_data.pop(HARVEST_DURATION_TEXT_KEY, None)
    if text is None or not is_timing_window_text(text):
        return None
    return {
        'field': 'harvest_duration_days',
        'value': str(text).strip(),
        'code': ERROR_HARVEST_NOT_IMPORTED,
        'message': PARSE_ERROR_MESSAGES[ERROR_HARVEST_NOT_IMPORTED],
    }


def _own_windows(crop: Crop | None) -> list[TimingWindow]:
    if crop is None or crop.pk is None:
        return []
    return load_timing_window_index([crop.pk]).get(crop.pk, [])


def apply_timing_window_cells(crop_data: dict, existing_crop: Crop | None) -> list[dict[str, Any]]:
    """Turn the window columns of a row into ``timing_windows``; return one issue per rejected cell.

    A cell replaces the windows of its kind only; kinds without a cell keep the
    crop's windows (an empty cell changes nothing, like for every other
    column). A rejected cell is dropped with an issue and the rest of the row
    is imported.
    """
    cells = {key: crop_data.pop(key) for key in TIMING_WINDOW_COLUMNS if key in crop_data}
    parsed: dict[str, list[TimingWindow]] = {}
    harvest_issue = _harvest_duration_text_issue(crop_data)
    issues: list[dict[str, Any]] = [harvest_issue] if harvest_issue else []
    for column, value in cells.items():
        if value is None or not str(value).strip():
            continue
        try:
            parsed[TIMING_WINDOW_COLUMNS[column]] = parse_timing_window_cell(
                TIMING_WINDOW_COLUMNS[column], value,
            )
        except TimingWindowParseError as error:
            issues.append({
                'field': column,
                'value': error.value,
                'code': error.code,
                'message': PARSE_ERROR_MESSAGES[error.code],
            })
    if parsed:
        if 'timing_windows' in crop_data:
            base = [TimingWindow.from_dict(window) for window in crop_data['timing_windows'] or []]
        else:
            base = _own_windows(existing_crop)
        kept = [window for window in base if window.kind not in parsed]
        added = [window for windows in parsed.values() for window in windows]
        crop_data['timing_windows'] = [window.as_dict() for window in sort_windows(kept + added)]
    return issues


def _timing_window_diff(existing_crop: Crop, import_data: dict) -> list[dict]:
    """One diff entry per window kind the row changes, under that kind's column name."""
    if 'timing_windows' not in import_data:
        return []
    current = [window.as_dict() for window in _own_windows(existing_crop)]
    new = list(import_data['timing_windows'] or [])
    diff = []
    for column, kind in TIMING_WINDOW_COLUMNS.items():
        current_kind = [window for window in current if window['kind'] == kind]
        new_kind = [window for window in new if window['kind'] == kind]
        if current_kind != new_kind:
            diff.append({'field': column, 'current': current_kind, 'new': new_kind})
    return diff

# Read-only and auto-generated fields are excluded: a diff is only useful for
# values the import could actually change.
_COMPARABLE_FIELDS = [
    'name', 'variety', 'notes', 'seed_supplier', 'botanical_name',
    'crop_family', 'nutrient_demand', 'cultivation_type', 'cultivation_types', 'tags',
    'growth_duration_days', 'harvest_duration_days', 'propagation_duration_days',
    'germination_temperature_optimal_min_c', 'germination_temperature_optimal_max_c',
    'germination_temperature_min_c', 'germination_days_min', 'germination_days_max',
    'germination_types', 'germination_pretreatment',
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


def resolve_supplier(project: Project, crop_data: dict, *, create: bool = True) -> Supplier | None:
    """Resolve the row's supplier from `supplier_id`, or by name (created when `create`).

    The preview passes ``create=False``: it only reports what an import would
    do, so it must not leave suppliers behind when the user cancels.
    """
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
        if normalized and not create:
            return Supplier.objects.filter(name_normalized=normalized, project=project).first()
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

    # A project holds one crop per name and variety (the serializer rejects a
    # second one whatever its supplier; suppliers hang off it as
    # CropSupplierData). So a row naming another supplier still updates that
    # crop, its preferred supplier included, instead of failing as a "new" one.
    return (
        base_queryset.filter(supplier__isnull=True).first()
        or base_queryset.order_by('id').first()
    )


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
                # An empty value cannot clear it either (a JSON export writes
                # "" for every field the Sorte does not set itself).
                if import_value in (None, ''):
                    continue
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

    diff.extend(_timing_window_diff(existing_crop, import_data))
    supplier_diff = _supplier_diff(existing_crop, import_data)
    if supplier_diff is not None:
        diff.append(supplier_diff)

    return diff


def _supplier_diff(existing_crop: Crop, import_data: dict) -> dict | None:
    """The preferred-supplier change a row would make, if it names another one."""
    import_supplier = import_data.get('supplier_name') or import_data.get('seed_supplier')
    if not normalize_supplier_name(import_supplier):
        return None
    current = existing_crop.supplier.name if existing_crop.supplier else existing_crop.seed_supplier
    if normalize_supplier_name(import_supplier) == normalize_supplier_name(current):
        return None
    return {'field': 'supplier_name', 'current': current or None, 'new': import_supplier}


def _match_import_row(
    project: Project,
    crop_data: dict,
    *,
    create_supplier: bool = True,
) -> tuple[Supplier | None, Crop | None]:
    supplier = resolve_supplier(project, crop_data, create=create_supplier)
    return supplier, find_matching_crop(
        project,
        crop_data['name'],
        crop_data.get('variety', ''),
        supplier,
        crop_data.get('supplier_name') or crop_data.get('seed_supplier'),
    )


def _duplicate_row_indices(rows: list) -> dict[int, int]:
    """Map later occurrences to the first row, using the project's crop identity.

    Suppliers do not distinguish crops. Keep the first occurrence even when
    later rows have different data or the first row fails validation.
    """
    first_indices: dict[tuple[str, str | None], int] = {}
    duplicates: dict[int, int] = {}
    for index, row in enumerate(rows):
        if not _is_importable_row(row):
            continue
        try:
            key = (normalize_text(row['name']) or '', normalize_text(row.get('variety', '')))
        except (AttributeError, TypeError):
            continue  # Malformed identity values are handled by the row's normal error path.
        if key in first_indices:
            duplicates[index] = first_indices[key]
        else:
            first_indices[key] = index
    return duplicates


def preview_crop_import(project: Project, rows: list) -> list[dict]:
    """One outcome per row — `create`, `update_candidate`, `duplicate`, or an error.

    A row naming neighbours also reports which of them would stay free text
    (`companions`); names of rows in the same file count as known.
    """
    results: list[dict] = []
    duplicates = _duplicate_row_indices(rows)
    resolver = CompanionNameResolver(
        project.id,
        extra_names=[row.get('name') for row in rows if _is_importable_row(row)],
    )

    for idx, crop_data in enumerate(rows):
        if idx in duplicates:
            results.append({
                'index': idx,
                'status': 'duplicate',
                'duplicate_of_index': duplicates[idx],
                'import_data': crop_data,
            })
            continue
        if not _is_importable_row(crop_data):
            results.append({
                'index': idx,
                'error': _ROW_SHAPE_ERROR,
                'import_data': crop_data,
            })
            continue

        try:
            apply_germination_cells(crop_data)
            _normalize_crop_family(crop_data)
            _supplier, matching_crop = _match_import_row(project, crop_data, create_supplier=False)
            companions = preview_row_companions(resolver, crop_data)
            timing_window_issues = apply_timing_window_cells(crop_data, matching_crop)

            if matching_crop:
                result = {
                    'index': idx,
                    'status': 'update_candidate',
                    'matched_crop_id': matching_crop.id,
                    'diff': compute_crop_diff(matching_crop, crop_data),
                    'import_data': crop_data,
                }
            else:
                result = {
                    'index': idx,
                    'status': 'create',
                    'import_data': crop_data,
                }
            if companions is not None:
                result['companions'] = companions
            if timing_window_issues:
                result['timing_window_issues'] = timing_window_issues
            results.append(result)
        except Exception as error:
            results.append({
                'index': idx,
                'error': str(error),
                'import_data': crop_data,
            })

    return results


def apply_crop_import(project: Project, rows: list, *, confirm_updates: bool) -> dict[str, Any]:
    """Create the rows that are new and, when confirmed, update the ones that match.

    Neighbours named by the imported rows are added afterwards, so a neighbour
    created by a later row of the same file is found.
    """
    duplicates = _duplicate_row_indices(rows)
    created_count = 0
    updated_count = 0
    skipped_count = len(duplicates)
    errors: list[dict] = []
    timing_window_issues: list[dict[str, Any]] = []
    companion_rows: list[tuple[Crop, dict[str, Any]]] = []

    unique_rows = ((idx, row) for idx, row in enumerate(rows) if idx not in duplicates)
    for idx, crop_data in unique_rows:
        if not _is_importable_row(crop_data):
            errors.append({'index': idx, 'error': _ROW_SHAPE_ERROR})
            continue

        try:
            companions = _pop_companions(crop_data)
            apply_germination_cells(crop_data)
            _normalize_crop_family(crop_data)
            supplier, matching_crop = _match_import_row(project, crop_data)
            if supplier:
                crop_data['supplier'] = supplier.id

            if matching_crop:
                if not confirm_updates:
                    skipped_count += 1
                    continue
                timing_window_issues.extend(
                    {'index': idx, **issue}
                    for issue in apply_timing_window_cells(crop_data, matching_crop)
                )
                serializer = CropSerializer(
                    matching_crop, data=crop_data, partial=True,
                    context={'project': project, 'defer_companion_linking': True},
                )
                if serializer.is_valid():
                    saved = serializer.save()
                    updated_count += 1
                    if companions:
                        companion_rows.append((saved, companions))
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
                timing_window_issues.extend(
                    {'index': idx, **issue} for issue in apply_timing_window_cells(crop_data, None)
                )
                serializer = CropSerializer(
                    data=crop_data, context={'project': project, 'defer_companion_linking': True},
                )
                if serializer.is_valid():
                    saved = serializer.save(project=project)
                    created_count += 1
                    if companions:
                        companion_rows.append((saved, companions))
                else:
                    errors.append({'index': idx, 'error': serializer.errors})
        except Exception as error:
            errors.append({'index': idx, 'error': str(error)})

    summary: dict[str, Any] = {
        'created_count': created_count,
        'updated_count': updated_count,
        'skipped_count': skipped_count,
        'duplicate_count': len(duplicates),
        'errors': errors,
    }
    if timing_window_issues:
        summary['timing_window_issues'] = timing_window_issues
    if companion_rows:
        summary['companions'] = apply_import_companions(project.id, companion_rows).as_dict()
    # Once for the whole file: neighbours entered as free text before these
    # crops existed now link to them.
    link_free_text_companions(project.id)
    return summary
