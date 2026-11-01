"""Read-only analysis of a crop import payload.

Running this never writes anything. It produces the preview an operator (or an
agent's user) confirms: for every row and every field, what the source said,
what the API would store, how confident the conversion is, and whether the row
would create, update, or skip a crop.

Rows carrying errors are marked ``blocked`` and are refused by the apply step,
so a confirmation can never execute a row whose preview showed an error.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from crops.plant_families import coerce_plant_family_key
from farm.enum_normalization import normalize_choice_value
from farm.models import Crop
from farm.services.crop_tags import normalize_tags

from .field_specs import (
    DIMENSION_LENGTH,
    INPUT_KEY_INDEX,
    KIND_COLOR,
    KIND_ENUM,
    KIND_ENUM_LIST,
    KIND_INTEGER,
    KIND_STRING,
    KIND_STRING_LIST,
    SEED_RATE_PLAUSIBILITY,
    FieldSpec,
    seed_rate_value_constraint_error,
)
from .units import (
    CONFIDENCE_EXACT,
    CONFIDENCE_INVALID,
    CONFIDENCE_NEEDS_CLARIFICATION,
    ConvertedValue,
    convert_plain_number,
    convert_to_canonical_length,
    normalize_seed_rate_unit_input,
    parse_raw_amount,
)

ACTION_CREATE = 'create'
ACTION_UPDATE = 'update'
ACTION_SKIP = 'skip'
ACTION_BLOCKED = 'blocked'

HEX_COLOR_PATTERN = re.compile(r'^#[0-9A-Fa-f]{6}$')

# Human-readable text for every machine code the analyzer can emit. Agents are
# expected to branch on the code; the message exists for the person reading the
# preview table.
MESSAGES: dict[str, str] = {
    'not_a_number': 'Value is not a number.',
    'unit_missing': (
        'No unit given. Send an explicit unit (for example the *_cm or *_m field '
        'spelling) — the value is not interpreted without one.'
    ),
    'unit_unknown': 'Unit is not recognized and was not converted.',
    'below_hard_min': 'Value is below the smallest agronomically possible value.',
    'above_hard_max': 'Value exceeds the largest agronomically possible value. Check the unit.',
    'below_warn_min': 'Value is unusually small — please confirm the unit.',
    'above_warn_max': 'Value is unusually large — please confirm the unit.',
    'enum_unknown': 'Value is not one of the allowed values.',
    'too_long': 'Text exceeds the maximum length and was not truncated.',
    'invalid_color': 'Colour must be a #RRGGBB hex string.',
    'not_a_list': 'Value must be a list.',
    'missing_name': 'A crop name is required.',
    'unknown_field': 'Field is not part of the crop schema and was ignored.',
    'duplicate_key': 'Several input keys map to the same API field.',
    'missing_companion': 'Field requires its companion field to be present.',
    'seed_rate_without_cultivation_type': (
        'A seed rate was given for a cultivation type the crop does not use.'
    ),
    'whole_number_required': 'This seed-rate unit requires a whole-number value.',
    'below_unit_minimum': 'Value is below the minimum for this seed-rate unit.',
    'duplicate_in_payload': 'Another row in this import refers to the same crop.',
}


@dataclass
class FieldAnalysis:
    """Per-field outcome shown in the preview table."""

    field_name: str
    source_key: str | None = None
    source_value: Any = None
    source_unit: str | None = None
    api_value: Any = None
    api_unit: str | None = None
    confidence: str = CONFIDENCE_EXACT
    warnings: list[dict[str, str]] = field(default_factory=list)
    errors: list[dict[str, str]] = field(default_factory=list)
    current_value: Any = None
    changes_existing: bool = False

    @property
    def is_usable(self) -> bool:
        """Return True when the field produced a value that may be written."""
        return not self.errors

    def to_dict(self) -> dict[str, Any]:
        """Return the JSON-serializable preview representation."""
        return {
            'field': self.field_name,
            'source_key': self.source_key,
            'source_value': _jsonable(self.source_value),
            'source_unit': self.source_unit,
            'api_value': _jsonable(self.api_value),
            'api_unit': self.api_unit,
            'confidence': self.confidence,
            'warnings': self.warnings,
            'errors': self.errors,
            'current_value': _jsonable(self.current_value),
            'changes_existing': self.changes_existing,
        }


def _issue(code: str, detail: str = '') -> dict[str, str]:
    """Build a machine-readable issue entry with a human-readable message."""
    return {'code': code, 'message': f'{MESSAGES.get(code, code)}{f" {detail}" if detail else ""}'}


def _jsonable(value: Any) -> Any:
    """Convert Decimals to floats so the preview survives JSONField storage."""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, list):
        return [_jsonable(item) for item in value]
    if isinstance(value, dict):
        return {key: _jsonable(item) for key, item in value.items()}
    return value


# --------------------------------------------------------------------------
# Single-field analysis
# --------------------------------------------------------------------------

def _analyze_string(spec: FieldSpec, analysis: FieldAnalysis, raw_value: Any) -> None:
    """Validate and normalize a free-text field."""
    if raw_value is None:
        analysis.api_value = ''
        return
    text = str(raw_value).strip()
    if spec.max_length is not None and len(text) > spec.max_length:
        analysis.errors.append(_issue('too_long', f'Maximum is {spec.max_length} characters.'))
        analysis.confidence = CONFIDENCE_INVALID
        return
    analysis.api_value = text


def _analyze_plant_family(spec: FieldSpec, analysis: FieldAnalysis, raw_value: Any) -> None:
    """Map a family name or synonym onto the botanical name of a listed plant family."""
    canonical = coerce_plant_family_key(str(raw_value).strip())
    if canonical is None:
        analysis.errors.append(
            _issue('enum_unknown', f'Allowed: {", ".join(spec.enum_values or ())}.')
        )
        analysis.confidence = CONFIDENCE_INVALID
        return
    analysis.api_value = canonical
    analysis.confidence = CONFIDENCE_EXACT if str(raw_value).strip() == canonical else 'converted'


def _analyze_enum(spec: FieldSpec, analysis: FieldAnalysis, raw_value: Any) -> None:
    """Normalize an enum value to the project's canonical vocabulary."""
    if raw_value is None or str(raw_value).strip() == '':
        analysis.api_value = None
        return

    if spec.name == 'crop_family':
        _analyze_plant_family(spec, analysis, raw_value)
        return

    if spec.name.endswith('_unit'):
        canonical, error_code = normalize_seed_rate_unit_input(raw_value)
        if error_code:
            analysis.errors.append(
                _issue(error_code, f'Allowed: {", ".join(spec.enum_values or ())}.')
            )
            analysis.confidence = CONFIDENCE_INVALID
            return
        analysis.api_value = canonical
        analysis.confidence = (
            CONFIDENCE_EXACT if str(raw_value).strip() == canonical else 'converted'
        )
        return

    normalized = normalize_choice_value(spec.name, raw_value)
    if normalized not in (spec.enum_values or ()):
        analysis.errors.append(
            _issue('enum_unknown', f'Allowed: {", ".join(spec.enum_values or ())}.')
        )
        analysis.confidence = CONFIDENCE_INVALID
        return
    analysis.api_value = normalized
    analysis.confidence = CONFIDENCE_EXACT if str(raw_value).strip() == normalized else 'converted'


def _analyze_enum_list(spec: FieldSpec, analysis: FieldAnalysis, raw_value: Any) -> None:
    """Normalize a list of enum values, accepting a single value for convenience."""
    if raw_value is None:
        analysis.api_value = None
        return
    raw_items = raw_value if isinstance(raw_value, list | tuple) else [raw_value]
    if isinstance(raw_value, dict):
        analysis.errors.append(_issue('not_a_list'))
        analysis.confidence = CONFIDENCE_INVALID
        return

    normalized_items: list[str] = []
    for item in raw_items:
        normalized = normalize_choice_value('cultivation_type', item)
        if normalized not in (spec.enum_values or ()):
            analysis.errors.append(
                _issue('enum_unknown', f'Allowed: {", ".join(spec.enum_values or ())}.')
            )
            analysis.confidence = CONFIDENCE_INVALID
            return
        if normalized not in normalized_items:
            normalized_items.append(normalized)

    analysis.api_value = normalized_items
    analysis.confidence = CONFIDENCE_EXACT if list(raw_items) == normalized_items else 'converted'


def _analyze_string_list(analysis: FieldAnalysis, raw_value: Any) -> None:
    """Normalize free-text names given as a list or as one separated text."""
    if raw_value is None:
        analysis.api_value = None
        return
    if isinstance(raw_value, dict):
        analysis.errors.append(_issue('not_a_list'))
        analysis.confidence = CONFIDENCE_INVALID
        return
    raw_items = raw_value if isinstance(raw_value, list | tuple) else str(raw_value)
    analysis.api_value = normalize_tags(raw_items)
    analysis.confidence = (
        CONFIDENCE_EXACT if isinstance(raw_value, list) and raw_value == analysis.api_value
        else 'converted'
    )


def _analyze_color(analysis: FieldAnalysis, raw_value: Any) -> None:
    """Validate a hex colour string."""
    if raw_value is None or str(raw_value).strip() == '':
        analysis.api_value = ''
        return
    text = str(raw_value).strip()
    if not HEX_COLOR_PATTERN.match(text):
        analysis.errors.append(_issue('invalid_color'))
        analysis.confidence = CONFIDENCE_INVALID
        return
    analysis.api_value = text


def _analyze_number(
    spec: FieldSpec,
    analysis: FieldAnalysis,
    raw_value: Any,
    implied_unit: str | None,
) -> None:
    """Parse, convert, and range-check a numeric field."""
    if raw_value is None or (isinstance(raw_value, str) and not raw_value.strip()):
        analysis.api_value = None
        return

    parsed = parse_raw_amount(raw_value, implied_unit)
    if spec.dimension == DIMENSION_LENGTH:
        converted = convert_to_canonical_length(parsed)
    else:
        converted = convert_plain_number(parsed, spec.unit)

    analysis.source_unit = converted.source_unit
    analysis.api_unit = converted.canonical_unit
    if converted.error:
        _record_conversion_failure(analysis, converted)
        return

    analysis.confidence = converted.confidence
    value = converted.value
    if spec.kind == KIND_INTEGER:
        value = _coerce_integer(analysis, value)
        if value is None:
            return

    analysis.api_value = value
    _check_bounds(spec, analysis, Decimal(str(value)))


def _record_conversion_failure(analysis: FieldAnalysis, converted: ConvertedValue) -> None:
    """Turn a conversion failure into the right error/clarification entry."""
    if converted.confidence == CONFIDENCE_NEEDS_CLARIFICATION:
        analysis.confidence = CONFIDENCE_NEEDS_CLARIFICATION
        analysis.errors.append(_issue(converted.error or 'unit_missing'))
        return
    analysis.confidence = CONFIDENCE_INVALID
    analysis.errors.append(_issue(converted.error or 'not_a_number'))


def _coerce_integer(analysis: FieldAnalysis, value: Decimal | None) -> int | None:
    """Round a whole-number value to int, rejecting fractional input."""
    if value is None:
        return None
    if value != value.to_integral_value():
        analysis.errors.append(_issue('not_a_number', 'A whole number is required.'))
        analysis.confidence = CONFIDENCE_INVALID
        return None
    return int(value)


def _check_bounds(spec: FieldSpec, analysis: FieldAnalysis, value: Decimal) -> None:
    """Apply hard bounds (reject) and plausibility bounds (warn)."""
    if spec.hard_min is not None:
        hard_min = Decimal(str(spec.hard_min))
        below = value <= hard_min if spec.exclusive_min else value < hard_min
        if below:
            analysis.errors.append(
                _issue('below_hard_min', f'Minimum is {spec.hard_min}{_unit_suffix(spec)}.')
            )
            analysis.confidence = CONFIDENCE_INVALID
            return
    if spec.hard_max is not None and value > Decimal(str(spec.hard_max)):
        analysis.errors.append(
            _issue('above_hard_max', f'Maximum is {spec.hard_max}{_unit_suffix(spec)}.')
        )
        analysis.confidence = CONFIDENCE_INVALID
        return

    if spec.warn_min is not None and value < Decimal(str(spec.warn_min)):
        analysis.warnings.append(
            _issue(
                'below_warn_min',
                f'Values below {spec.warn_min}{_unit_suffix(spec)} are unusual.',
            )
        )
    if spec.warn_max is not None and value > Decimal(str(spec.warn_max)):
        analysis.warnings.append(
            _issue(
                'above_warn_max',
                f'Values above {spec.warn_max}{_unit_suffix(spec)} are unusual.',
            )
        )


def _unit_suffix(spec: FieldSpec) -> str:
    """Return ``" m"``-style unit text for messages, or an empty string."""
    return f' {spec.unit}' if spec.unit else ''


def analyze_field(
    spec: FieldSpec,
    source_key: str,
    raw_value: Any,
    implied_unit: str | None,
) -> FieldAnalysis:
    """Analyze one raw payload entry against its field spec.

    :param spec: The canonical spec for the target field.
    :param source_key: Key exactly as it appeared in the payload.
    :param raw_value: Value exactly as it appeared in the payload.
    :param implied_unit: Unit implied by ``source_key``, or None.
    :return: The per-field analysis.
    """
    analysis = FieldAnalysis(
        field_name=spec.name,
        source_key=source_key,
        source_value=raw_value,
        api_unit=spec.unit,
    )

    if spec.kind == KIND_STRING:
        _analyze_string(spec, analysis, raw_value)
    elif spec.kind == KIND_ENUM:
        _analyze_enum(spec, analysis, raw_value)
    elif spec.kind == KIND_ENUM_LIST:
        _analyze_enum_list(spec, analysis, raw_value)
    elif spec.kind == KIND_STRING_LIST:
        _analyze_string_list(analysis, raw_value)
    elif spec.kind == KIND_COLOR:
        _analyze_color(analysis, raw_value)
    else:
        _analyze_number(spec, analysis, raw_value, implied_unit)

    return analysis


# --------------------------------------------------------------------------
# Row-level analysis
# --------------------------------------------------------------------------

def _map_payload_keys(
    raw_item: dict,
) -> tuple[dict[str, tuple[FieldSpec, str, Any, str | None]], list[dict[str, str]]]:
    """Split a raw row into recognized fields and ignored keys.

    Unknown keys are reported, never guessed into a neighbouring field: an
    order export containing ``article_no`` or ``package_size`` must not have
    those values land in ``variety`` or ``seed_rate_direct_value``.
    """
    recognized: dict[str, tuple[FieldSpec, str, Any, str | None]] = {}
    ignored: list[dict[str, str]] = []

    for raw_key, raw_value in raw_item.items():
        entry = INPUT_KEY_INDEX.get(str(raw_key).strip().lower())
        if entry is None:
            ignored.append({'key': str(raw_key), **_issue('unknown_field')})
            continue
        spec, implied_unit = entry
        if spec.name in recognized:
            ignored.append({'key': str(raw_key), **_issue('duplicate_key')})
            continue
        recognized[spec.name] = (spec, str(raw_key), raw_value, implied_unit)

    return recognized, ignored


def _validate_coupled_seed_rates(analyses: dict[str, FieldAnalysis]) -> None:
    """Reject a seed-rate value without its unit, and a unit without its value."""
    for value_field, unit_field in (
        ('seed_rate_direct_value', 'seed_rate_direct_unit'),
        ('seed_rate_pre_cultivation_value', 'seed_rate_pre_cultivation_unit'),
    ):
        value_analysis = analyses.get(value_field)
        unit_analysis = analyses.get(unit_field)
        has_value = value_analysis is not None and value_analysis.api_value is not None
        has_unit = unit_analysis is not None and unit_analysis.api_value is not None

        if has_value and not has_unit and (unit_analysis is None or not unit_analysis.errors):
            value_analysis.errors.append(_issue('missing_companion', f'Send {unit_field} as well.'))
            value_analysis.confidence = CONFIDENCE_NEEDS_CLARIFICATION
        if has_unit and not has_value and (value_analysis is None or not value_analysis.errors):
            unit_analysis.errors.append(_issue('missing_companion', f'Send {value_field} as well.'))
            unit_analysis.confidence = CONFIDENCE_NEEDS_CLARIFICATION


def _warn_seed_rate_plausibility(analyses: dict[str, FieldAnalysis]) -> None:
    """Warn about seed rates far outside the usual band for their unit."""
    for value_field, unit_field in (
        ('seed_rate_direct_value', 'seed_rate_direct_unit'),
        ('seed_rate_pre_cultivation_value', 'seed_rate_pre_cultivation_unit'),
    ):
        value_analysis = analyses.get(value_field)
        unit_analysis = analyses.get(unit_field)
        if value_analysis is None or unit_analysis is None:
            continue
        if value_analysis.errors or unit_analysis.errors:
            continue
        band = SEED_RATE_PLAUSIBILITY.get(str(unit_analysis.api_value))
        if band is None or value_analysis.api_value is None:
            continue
        low, high = band
        numeric = Decimal(str(value_analysis.api_value))
        if numeric < Decimal(str(low)):
            value_analysis.warnings.append(
                _issue('below_warn_min', f'Below {low} {unit_analysis.api_value} is unusual.')
            )
        if numeric > Decimal(str(high)):
            value_analysis.warnings.append(
                _issue('above_warn_max', f'Above {high} {unit_analysis.api_value} is unusual.')
            )


def _validate_seed_rate_unit_constraints(analyses: dict[str, FieldAnalysis]) -> None:
    """Reject seed-rate values that violate unit-specific value constraints."""
    for value_field, unit_field in (
        ('seed_rate_direct_value', 'seed_rate_direct_unit'),
        ('seed_rate_pre_cultivation_value', 'seed_rate_pre_cultivation_unit'),
    ):
        value_analysis = analyses.get(value_field)
        unit_analysis = analyses.get(unit_field)
        if value_analysis is None or unit_analysis is None:
            continue
        if value_analysis.errors or unit_analysis.errors:
            continue
        if value_analysis.api_value is None or unit_analysis.api_value is None:
            continue
        error_code = seed_rate_value_constraint_error(
            value_analysis.api_value,
            unit_analysis.api_value,
        )
        if error_code is None:
            continue
        value_analysis.errors.append(_issue(error_code, f'Unit: {unit_analysis.api_value}.'))
        value_analysis.confidence = CONFIDENCE_INVALID


def _warn_unused_cultivation_types(
    analyses: dict[str, FieldAnalysis],
    existing: Crop | None,
) -> None:
    """Warn when a seed rate targets a cultivation type the crop does not use."""
    types_analysis = analyses.get('cultivation_types')
    if types_analysis is not None and types_analysis.api_value:
        effective_types = list(types_analysis.api_value)
    elif existing is not None:
        effective_types = list(existing.cultivation_types or [])
    else:
        return

    for value_field, cultivation_type in (
        ('seed_rate_direct_value', 'direct_sowing'),
        ('seed_rate_pre_cultivation_value', 'pre_cultivation'),
    ):
        value_analysis = analyses.get(value_field)
        if value_analysis is None or value_analysis.api_value is None or value_analysis.errors:
            continue
        if cultivation_type not in effective_types:
            value_analysis.warnings.append(
                _issue('seed_rate_without_cultivation_type', f'"{cultivation_type}" is not listed.')
            )


def find_matching_crop(project, name: str, variety: str, supplier_name: str) -> Crop | None:
    """Find the existing crop an import row refers to, within one project.

    Matching mirrors the ``unique_crop_normalized`` database constraint —
    normalized name, normalized variety, and supplier — which is what makes a
    repeated import converge on the same row instead of creating duplicates.
    The queryset is project-scoped, so a row can never resolve to (and then
    overwrite) a crop belonging to somebody else's project.

    :param project: The project the import is bound to.
    :param name: Crop name from the import row.
    :param variety: Crop variety from the import row.
    :param supplier_name: Supplier name from the import row, possibly empty.
    :return: The matching crop, or None.
    """
    from farm.utils import normalize_supplier_name, normalize_text

    candidates = Crop.objects.filter(
        project=project,
        name_normalized=normalize_text(name) or '',
        variety_normalized=normalize_text(variety),
    ).select_related('supplier')

    normalized_supplier = normalize_supplier_name(supplier_name)
    if not normalized_supplier:
        # No supplier stated: only match a crop that has no supplier either,
        # so an unspecified row never silently overwrites a supplier-specific one.
        return candidates.filter(supplier__isnull=True).first()

    for candidate in candidates:
        candidate_supplier = normalize_supplier_name(
            candidate.supplier.name if candidate.supplier else candidate.seed_supplier
        )
        if candidate_supplier == normalized_supplier:
            return candidate
    return None


def _resolve_identity(analyses: dict[str, FieldAnalysis]) -> dict[str, str]:
    """Return the name/variety/supplier trio used for matching and de-duplication."""
    def value_of(field_name: str) -> str:
        analysis = analyses.get(field_name)
        if analysis is None or analysis.errors or analysis.api_value is None:
            return ''
        return str(analysis.api_value)

    return {
        'name': value_of('name'),
        'variety': value_of('variety'),
        'supplier_name': value_of('supplier_name'),
    }


def _annotate_existing_values(analyses: dict[str, FieldAnalysis], existing: Crop) -> None:
    """Fill in each field's current value and whether the import would change it."""
    for field_name, analysis in analyses.items():
        if analysis.errors or field_name == 'supplier_name':
            continue
        current = getattr(existing, field_name, None)
        if isinstance(current, Decimal):
            current = float(current)
        analysis.current_value = current
        analysis.changes_existing = not _values_match(current, analysis.api_value)


def _values_match(current: Any, proposed: Any) -> bool:
    """Compare a stored value with a proposed one, tolerating None/'' and float noise."""
    if current is None and proposed in (None, ''):
        return True
    if current == '' and proposed in (None, ''):
        return True
    if isinstance(current, int | float) and isinstance(proposed, int | float | Decimal):
        return abs(float(current) - float(proposed)) < 1e-9
    if isinstance(current, list) and isinstance(proposed, list):
        return current == proposed
    return str(current) == str(proposed)


def _decide_action(
    analyses: dict[str, FieldAnalysis],
    existing: Crop | None,
    row_errors: list[dict[str, str]],
) -> str:
    """Choose create / update / skip / blocked for one row."""
    if row_errors or any(analysis.errors for analysis in analyses.values()):
        return ACTION_BLOCKED
    if existing is None:
        return ACTION_CREATE
    if any(analysis.changes_existing for analysis in analyses.values()):
        return ACTION_UPDATE
    # An already-identical row is the steady state of a repeated import: it is
    # skipped rather than rewritten, so re-running an import is a no-op.
    return ACTION_SKIP


def analyze_item(
    index: int,
    raw_item: Any,
    *,
    project,
    seen_identities: dict[tuple[str, str, str], int],
) -> dict[str, Any]:
    """Analyze a single import row without touching the database contents.

    :param index: Zero-based position of the row in the payload.
    :param raw_item: The row exactly as received.
    :param project: The project the import is bound to.
    :param seen_identities: Identities already claimed by earlier rows.
    :return: JSON-serializable row preview.
    """
    if not isinstance(raw_item, dict):
        return {
            'index': index,
            'action': ACTION_BLOCKED,
            'identity': {'name': '', 'variety': '', 'supplier_name': ''},
            'matched_crop_id': None,
            'fields': [],
            'ignored_fields': [],
            'warnings': [],
            'errors': [_issue('not_a_list', 'Each import row must be an object.')],
        }

    recognized, ignored = _map_payload_keys(raw_item)
    analyses = {
        name: analyze_field(spec, source_key, raw_value, implied_unit)
        for name, (spec, source_key, raw_value, implied_unit) in recognized.items()
    }

    row_errors: list[dict[str, str]] = []
    identity = _resolve_identity(analyses)
    if not identity['name']:
        row_errors.append(_issue('missing_name'))

    _validate_coupled_seed_rates(analyses)
    _validate_seed_rate_unit_constraints(analyses)
    _warn_seed_rate_plausibility(analyses)

    existing = None
    if identity['name']:
        existing = find_matching_crop(
            project, identity['name'], identity['variety'], identity['supplier_name']
        )
        identity_key = (
            identity['name'].casefold(),
            identity['variety'].casefold(),
            identity['supplier_name'].casefold(),
        )
        if identity_key in seen_identities:
            row_errors.append(
                _issue('duplicate_in_payload', f'See row {seen_identities[identity_key]}.')
            )
        else:
            seen_identities[identity_key] = index

    _warn_unused_cultivation_types(analyses, existing)
    if existing is not None:
        _annotate_existing_values(analyses, existing)

    action = _decide_action(analyses, existing, row_errors)
    return {
        'index': index,
        'action': action,
        'identity': identity,
        'matched_crop_id': existing.id if existing else None,
        'matched_by': 'name_variety_supplier' if existing else None,
        'fields': [analyses[name].to_dict() for name in sorted(analyses)],
        'ignored_fields': ignored,
        'warnings': [
            {**warning, 'field': name}
            for name in sorted(analyses)
            for warning in analyses[name].warnings
        ],
        'errors': row_errors + [
            {**error, 'field': name}
            for name in sorted(analyses)
            for error in analyses[name].errors
        ],
    }


def analyze_import_payload(items: Any, *, project) -> dict[str, Any]:
    """Analyze a whole crop-import payload without writing anything.

    :param items: List of raw import rows.
    :param project: The project the import is bound to.
    :return: Preview document with per-row analyses and a summary.
    """
    if not isinstance(items, list):
        raise ValueError('items must be a list of crop objects.')

    seen_identities: dict[tuple[str, str, str], int] = {}
    analyzed = [
        analyze_item(index, raw_item, project=project, seen_identities=seen_identities)
        for index, raw_item in enumerate(items)
    ]

    summary = {
        'total': len(analyzed),
        'create': sum(1 for item in analyzed if item['action'] == ACTION_CREATE),
        'update': sum(1 for item in analyzed if item['action'] == ACTION_UPDATE),
        'skip': sum(1 for item in analyzed if item['action'] == ACTION_SKIP),
        'blocked': sum(1 for item in analyzed if item['action'] == ACTION_BLOCKED),
        'warnings': sum(len(item['warnings']) for item in analyzed),
    }
    return {
        'summary': summary,
        'items': analyzed,
        'has_errors': summary['blocked'] > 0,
        'has_warnings': summary['warnings'] > 0,
    }
