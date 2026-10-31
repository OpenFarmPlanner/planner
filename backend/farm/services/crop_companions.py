"""Companion planting (Mischkultur): good and bad neighbours of a Kultur.

Every rule lives here, so the API, the spreadsheet import, the planning check
and the crop library bridge resolve neighbours identically. The rules are
documented in docs/crop-companions.md; in short:

- Relations belong to the general crop (Kultur, empty variety). A Sorte uses
  its Kultur's relations: the general crop of its crop species, else the
  general crop with the same name.
- Between two Kulturen a relation is one shared pair, stored once with the
  lower crop id first. A relation to a plant family or to free text belongs to
  one Kultur only.
- In planning, two plans are neighbours when they are on the same bed and
  their occupied periods share at least one day. A bad neighbour is a warning
  and never blocks saving.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from django.db import transaction
from django.db.models import Q, QuerySet

from crops.plant_families import coerce_plant_family_key
from crops.services import find_species_by_common_name
from farm.models import Crop, CropCompanion, PlantingPlan
from farm.services.crop_inheritance import ensure_general_crop_for_variety, find_general_crop
from farm.utils import normalize_text

KINDS = (CropCompanion.KIND_GOOD, CropCompanion.KIND_BAD)
REASONS = tuple(value for value, _label in CropCompanion.REASON_CHOICES)

TARGET_CROP = 'crop'
TARGET_FAMILY = 'family'
TARGET_TEXT = 'text'


def active_relations(project_id: int) -> QuerySet[CropCompanion]:
    """The project's relations whose Kulturen are not soft-deleted."""
    return (
        CropCompanion.objects
        .filter(project_id=project_id, crop__deleted_at__isnull=True)
        .filter(Q(companion_crop__isnull=True) | Q(companion_crop__deleted_at__isnull=True))
        .select_related('crop', 'companion_crop')
    )


def is_kultur(crop: Crop) -> bool:
    return not (crop.variety or '').strip()


@dataclass
class KulturIndex:
    """Resolves any crop of a project to its Kultur, from one query."""

    by_species: dict[int, int]
    by_name: dict[str, int]
    family_by_id: dict[int, str | None]

    @classmethod
    def for_project(cls, project_id: int) -> KulturIndex:
        general_crops = (
            Crop.objects
            .filter(project_id=project_id, variety_normalized__isnull=True)
            # Descending, so the lowest primary key wins a tie, as in
            # crop_inheritance.build_general_crop_index.
            .order_by('-pk')
            .values_list('id', 'name_normalized', 'crop_species_id', 'crop_family_id')
        )
        by_species: dict[int, int] = {}
        by_name: dict[str, int] = {}
        family_by_id: dict[int, str | None] = {}
        for crop_id, name_normalized, species_id, family_id in general_crops:
            if species_id is not None:
                by_species[species_id] = crop_id
            if name_normalized:
                by_name[name_normalized] = crop_id
            family_by_id[crop_id] = family_id
        return cls(by_species=by_species, by_name=by_name, family_by_id=family_by_id)

    def kultur_id(self, crop: Crop) -> int | None:
        if is_kultur(crop):
            return crop.id
        if crop.crop_species_id and crop.crop_species_id in self.by_species:
            return self.by_species[crop.crop_species_id]
        return self.by_name.get(crop.name_normalized or '')

    def family(self, crop: Crop) -> str | None:
        """The plant family that counts for a crop: its Kultur's, else its own."""
        kultur_id = self.kultur_id(crop)
        kultur_family = self.family_by_id.get(kultur_id) if kultur_id is not None else None
        return kultur_family or crop.crop_family_id


def ensure_kultur(crop: Crop) -> Crop:
    """The crop's Kultur, created when its group has none yet.

    A species-linked Sorte gets its Kultur the way the crop form creates one;
    an unlinked Sorte gets a general crop with its name.
    """
    if is_kultur(crop):
        return crop
    if crop.crop_species_id:
        existing = find_general_crop(crop.project_id, crop.crop_species_id)
        return existing or ensure_general_crop_for_variety(crop) or crop
    existing = Crop.objects.filter(
        project_id=crop.project_id,
        name_normalized=crop.name_normalized,
        variety_normalized__isnull=True,
    ).first()
    if existing is not None:
        return existing
    return Crop.objects.create(project_id=crop.project_id, name=crop.name, variety='')


@dataclass(frozen=True)
class CompanionTarget:
    """What one relation points at, seen from a Kultur."""

    type: str
    crop: Crop | None = None
    family_key: str | None = None
    text: str = ''


def target_from(relation: CropCompanion, kultur_id: int) -> CompanionTarget:
    """The relation's other side, as seen from ``kultur_id``."""
    if relation.companion_crop_id is not None:
        other = relation.companion_crop if relation.crop_id == kultur_id else relation.crop
        return CompanionTarget(type=TARGET_CROP, crop=other)
    if relation.companion_family_id is not None:
        return CompanionTarget(type=TARGET_FAMILY, family_key=relation.companion_family_id)
    return CompanionTarget(type=TARGET_TEXT, text=relation.companion_text)


def relation_kwargs(kultur: Crop, target: CompanionTarget) -> dict[str, Any]:
    """Model fields for a relation of ``kultur`` with ``target``, pairs in canonical order."""
    if target.type == TARGET_CROP and target.crop is not None:
        first, second = sorted((kultur, target.crop), key=lambda crop: crop.id)
        return {'crop': first, 'companion_crop': second}
    if target.type == TARGET_FAMILY:
        return {'crop': kultur, 'companion_family_id': target.family_key}
    return {'crop': kultur, 'companion_text': target.text.strip()}


def find_relation(kultur: Crop, target: CompanionTarget) -> CropCompanion | None:
    return CropCompanion.objects.filter(**relation_kwargs(kultur, target)).first()


# --- Spreadsheet import ---------------------------------------------------------

def normalize_import_items(raw: Any) -> list[dict[str, str]]:
    """Validated ``{name, reason, note}`` items from an import row's companion field.

    The frontend parses spreadsheet cells into these items
    (frontend/src/crops/companions.ts); the JSON export writes them as is.
    """
    if not isinstance(raw, list):
        return []
    items: list[dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        name = str(item.get('name') or '').strip()[:200]
        if not name:
            continue
        reason = item.get('reason')
        items.append({
            'name': name,
            'reason': reason if reason in REASONS else CropCompanion.REASON_OTHER,
            'note': str(item.get('note') or '').strip()[:500],
        })
    return items


class CompanionNameResolver:
    """Resolves a neighbour's name to a Kultur, a plant family or free text.

    Order: a crop of the project with that name, then the project's crops of
    the crop species the name names (in any language), then a plant family
    (botanical name, translation or synonym), else free text. ``create`` makes
    a missing Kultur for a group that only has Sorten; the preview passes
    ``False`` and never writes.
    """

    def __init__(self, project_id: int, *, extra_names: Iterable[str] = ()) -> None:
        self.project_id = project_id
        self._cache: dict[str, CompanionTarget] = {}
        # Names of rows the import is about to create count as resolvable in
        # the preview, so a neighbour named later in the same file is not
        # reported as unknown.
        self._pending_names = {normalize_text(name) for name in extra_names if normalize_text(name)}

    def resolve(self, name: str, *, create: bool) -> CompanionTarget:
        key = f'{int(create)}:{normalize_text(name)}'
        if key not in self._cache:
            self._cache[key] = self._resolve(name, create=create)
        return self._cache[key]

    def _resolve(self, name: str, *, create: bool) -> CompanionTarget:
        normalized = normalize_text(name)
        crop = self._crop_by_name(normalized) or self._crop_by_species(name)
        if crop is not None:
            return CompanionTarget(type=TARGET_CROP, crop=ensure_kultur(crop) if create else crop)
        if not create and normalized in self._pending_names:
            return CompanionTarget(type=TARGET_CROP)
        family_key = coerce_plant_family_key(name)
        if family_key:
            return CompanionTarget(type=TARGET_FAMILY, family_key=family_key)
        return CompanionTarget(type=TARGET_TEXT, text=name)

    def _crop_by_name(self, normalized: str | None) -> Crop | None:
        if not normalized:
            return None
        return (
            Crop.objects.filter(project_id=self.project_id, name_normalized=normalized)
            .order_by('variety_normalized', 'id')
            .first()
        )

    def _crop_by_species(self, name: str) -> Crop | None:
        species = find_species_by_common_name(name)
        if species is None:
            return None
        return (
            Crop.objects.filter(project_id=self.project_id, crop_species=species)
            .order_by('variety_normalized', 'id')
            .first()
        )


@dataclass
class CompanionImportReport:
    created: int = 0
    unresolved: list[str] = field(default_factory=list)
    conflicts: list[dict[str, str]] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            'created': self.created,
            'unresolved': sorted(set(self.unresolved)),
            'conflicts': self.conflicts,
        }


def preview_row_companions(
    resolver: CompanionNameResolver,
    row: dict[str, Any],
) -> dict[str, Any] | None:
    """Which neighbours of an import row would stay free text."""
    names = [
        item['name']
        for kind in KINDS
        for item in normalize_import_items(row.get(f'{kind}_companions'))
    ]
    if not names:
        return None
    unresolved = [
        name for name in names if resolver.resolve(name, create=False).type == TARGET_TEXT
    ]
    return {'count': len(names), 'unresolved': unresolved}


def apply_import_companions(
    project_id: int,
    rows: list[tuple[Crop, dict[str, Any]]],
) -> CompanionImportReport:
    """Add the neighbours named by imported rows; existing relations are kept.

    Additive: nothing is deleted. A pair that already exists with the other
    kind (or is named both ways in the file) keeps the first one and is
    reported as a conflict.
    """
    resolver = CompanionNameResolver(project_id)
    report = CompanionImportReport()
    with transaction.atomic():
        for crop, row in rows:
            kultur = ensure_kultur(crop)
            for kind in KINDS:
                for item in normalize_import_items(row.get(f'{kind}_companions')):
                    _apply_import_item(kultur, kind, item, resolver, report)
    return report


def _apply_import_item(
    kultur: Crop,
    kind: str,
    item: dict[str, str],
    resolver: CompanionNameResolver,
    report: CompanionImportReport,
) -> None:
    target = resolver.resolve(item['name'], create=True)
    if target.type == TARGET_TEXT:
        report.unresolved.append(item['name'])
    if target.type == TARGET_CROP and target.crop is not None and target.crop.id == kultur.id:
        return
    existing = find_relation(kultur, target)
    if existing is not None:
        if existing.kind != kind:
            report.conflicts.append({
                'crop': kultur.name,
                'neighbour': item['name'],
                'kept': existing.kind,
            })
        return
    CropCompanion.objects.create(
        project_id=kultur.project_id,
        kind=kind,
        reason=item['reason'],
        note=item['note'],
        **relation_kwargs(kultur, target),
    )
    report.created += 1


# --- Planning check -------------------------------------------------------------


@dataclass(frozen=True)
class CompanionFinding:
    """Another plan on the same bed, in the same period, that is a listed neighbour."""

    kind: str
    reason: str
    note: str
    other_plan_id: int
    other_crop_id: int
    other_crop_label: str
    other_start: date
    other_end: date
    via_family_key: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            'kind': self.kind,
            'reason': self.reason,
            'note': self.note,
            'other_plan_id': self.other_plan_id,
            'other_crop_id': self.other_crop_id,
            'other_crop_label': self.other_crop_label,
            'other_start': self.other_start.isoformat(),
            'other_end': self.other_end.isoformat(),
            'via_family_key': self.via_family_key,
        }


@dataclass(frozen=True)
class _Occupancy:
    plan_id: int | None
    bed_id: int
    crop: Crop
    start: date
    end: date


def _plan_end(plan: PlantingPlan) -> date | None:
    if plan.planting_date is None:
        return None
    end = plan.harvest_end_date or plan.harvest_date or plan.planting_date
    return end if end >= plan.planting_date else plan.planting_date


class CompanionService:
    """Loads one project's relations and bed occupancies once and checks plans.

    A list response therefore costs a constant number of queries, whatever its
    length (pinned in farm/tests/test_api_query_counts.py).
    """

    def __init__(self, project_id: int) -> None:
        self.project_id = project_id
        self._kultur_index: KulturIndex | None = None
        self._crop_pairs: dict[tuple[int, int], CropCompanion] | None = None
        self._family_relations: dict[int, list[CropCompanion]] | None = None
        self._by_bed: dict[int, list[_Occupancy]] | None = None

    @property
    def kultur_index(self) -> KulturIndex:
        if self._kultur_index is None:
            self._kultur_index = KulturIndex.for_project(self.project_id)
        return self._kultur_index

    def _load_relations(self) -> None:
        if self._crop_pairs is not None:
            return
        pairs: dict[tuple[int, int], CropCompanion] = {}
        families: dict[int, list[CropCompanion]] = defaultdict(list)
        for relation in active_relations(self.project_id):
            if relation.companion_crop_id is not None:
                pairs[(relation.crop_id, relation.companion_crop_id)] = relation
            elif relation.companion_family_id is not None:
                families[relation.crop_id].append(relation)
        self._crop_pairs = pairs
        self._family_relations = dict(families)

    def _load_occupancies(self) -> dict[int, list[_Occupancy]]:
        if self._by_bed is None:
            plans = (
                PlantingPlan.objects
                .filter(
                    project_id=self.project_id,
                    bed__isnull=False,
                    crop__isnull=False,
                    planting_date__isnull=False,
                    crop__deleted_at__isnull=True,
                )
                .select_related('crop')
            )
            by_bed: dict[int, list[_Occupancy]] = defaultdict(list)
            for plan in plans:
                by_bed[plan.bed_id].append(_Occupancy(
                    plan_id=plan.pk,
                    bed_id=plan.bed_id,
                    crop=plan.crop,
                    start=plan.planting_date,
                    end=_plan_end(plan),
                ))
            self._by_bed = dict(by_bed)
        return self._by_bed

    def has_relations(self) -> bool:
        self._load_relations()
        return bool(self._crop_pairs) or bool(self._family_relations)

    def check(
        self,
        *,
        crop: Crop,
        bed_id: int | None,
        start: date | None,
        end: date | None,
        exclude_plan_id: int | None = None,
    ) -> list[CompanionFinding]:
        """Neighbour findings for a (possibly unsaved) plan of ``crop`` on ``bed_id``."""
        if bed_id is None or start is None or not self.has_relations():
            return []
        end = end if end is not None and end >= start else start
        kultur_id = self.kultur_index.kultur_id(crop)
        findings: list[CompanionFinding] = []
        for other in self._load_occupancies().get(bed_id, []):
            if exclude_plan_id is not None and other.plan_id == exclude_plan_id:
                continue
            if other.start > end or start > other.end:
                continue
            findings.extend(self._pair_findings(crop, kultur_id, other))
        findings.sort(key=lambda found: (found.kind != CropCompanion.KIND_BAD, found.other_start))
        return findings

    def check_plan(self, plan: PlantingPlan) -> list[CompanionFinding]:
        if plan.crop is None:
            return []
        return self.check(
            crop=plan.crop,
            bed_id=plan.bed_id,
            start=plan.planting_date,
            end=_plan_end(plan),
            exclude_plan_id=plan.pk,
        )

    def _family_relations_of(
        self, kultur_id: int | None, family: str | None,
    ) -> list[CropCompanion]:
        if kultur_id is None or not family:
            return []
        return [
            relation for relation in self._family_relations.get(kultur_id, [])
            if relation.companion_family_id == family
        ]

    def _pair_findings(
        self,
        crop: Crop,
        kultur_id: int | None,
        other: _Occupancy,
    ) -> list[CompanionFinding]:
        other_kultur_id = self.kultur_index.kultur_id(other.crop)
        relations: list[tuple[CropCompanion, str | None]] = []
        if kultur_id is not None and other_kultur_id is not None and kultur_id != other_kultur_id:
            pair = self._crop_pairs.get(tuple(sorted((kultur_id, other_kultur_id))))
            if pair is not None:
                relations.append((pair, None))
        other_family = self.kultur_index.family(other.crop)
        own_family = self.kultur_index.family(crop)
        for relation in self._family_relations_of(kultur_id, other_family):
            relations.append((relation, other_family))
        for relation in self._family_relations_of(other_kultur_id, own_family):
            relations.append((relation, own_family))
        return [
            CompanionFinding(
                kind=relation.kind,
                reason=relation.reason,
                note=relation.note,
                other_plan_id=other.plan_id,
                other_crop_id=other.crop.id,
                other_crop_label=str(other.crop),
                other_start=other.start,
                other_end=other.end,
                via_family_key=family_key,
            )
            for relation, family_key in relations
        ]
