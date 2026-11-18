"""Effective (inherited) site conditions of the growing-area hierarchy (#1075).

Light, soil moisture, irrigation availability and soil type are set as a
default on a location and can be overridden on a field and again on a bed.
The effective value of a property is the nearest explicitly set value along
bed -> field -> location; when none is set it is unknown (``None``), which is
deliberately different from an explicit "unavailable".

This module is the single place that resolves the rule. Later crop-to-bed
planning hints must read effective conditions from here. The frontend twin
``frontend/src/components/hierarchy/utils/siteConditions.ts`` is pinned to the
same cases by ``tests/fixtures/site_conditions.json``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol

INHERITED_SITE_CONDITION_FIELDS: tuple[str, ...] = (
    'light_condition',
    'soil_moisture',
    'irrigation',
    'soil_type',
)

SourceLevel = Literal['location', 'field', 'bed']


class _HierarchyNode(Protocol):
    id: int | None
    name: str


@dataclass(frozen=True)
class EffectiveCondition:
    """One resolved property: its value and where it was set."""

    value: str | None
    source: SourceLevel | None
    source_id: int | None
    source_name: str | None

    def as_dict(self) -> dict[str, str | int | None]:
        return {
            'value': self.value,
            'source': self.source,
            'source_id': self.source_id,
            'source_name': self.source_name,
        }


_UNKNOWN = EffectiveCondition(value=None, source=None, source_id=None, source_name=None)


def resolve_effective_conditions(
    chain: list[tuple[SourceLevel, _HierarchyNode]],
) -> dict[str, EffectiveCondition]:
    """Resolve every inherited property along ``chain``, nearest entity first.

    ``chain`` lists the entity itself and then its ancestors, e.g.
    ``[('bed', bed), ('field', field), ('location', location)]``.
    """
    resolved: dict[str, EffectiveCondition] = {}
    for field_name in INHERITED_SITE_CONDITION_FIELDS:
        resolved[field_name] = _UNKNOWN
        for level, node in chain:
            value = getattr(node, field_name, None)
            if value:
                resolved[field_name] = EffectiveCondition(
                    value=value, source=level, source_id=node.id, source_name=node.name,
                )
                break
    return resolved


def effective_conditions_for_location(location: _HierarchyNode) -> dict[str, EffectiveCondition]:
    return resolve_effective_conditions([('location', location)])


def effective_conditions_for_field(field: _HierarchyNode) -> dict[str, EffectiveCondition]:
    location = field.location  # type: ignore[attr-defined]
    return resolve_effective_conditions([('field', field), ('location', location)])


def effective_conditions_for_bed(bed: _HierarchyNode) -> dict[str, EffectiveCondition]:
    field = bed.field  # type: ignore[attr-defined]
    return resolve_effective_conditions(
        [('bed', bed), ('field', field), ('location', field.location)],
    )
