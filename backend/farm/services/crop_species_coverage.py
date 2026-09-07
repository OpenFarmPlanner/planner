"""Compare project crop names against the official crop-species library.

Answers one question: which crop names do people actually use in their
projects that the public suggestion list does not know? Read-only — the
decision whether a reported gap becomes a new species, an alias, or a variety
belongs to a human and follows docs/crop-taxonomy-guidelines.md.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from crops.models import CropSpecies
from crops.services import find_species_by_common_name
from farm.models import Crop
from farm.utils import normalize_text

# A near-match is a hint that the name is probably a spelling variant, an alias,
# or a use-form split of a species that already exists, so it must not be
# auto-created. Two edits covers spelling variants ("Zucchetti"/"Zucchini",
# umlaut and ss spellings) without turning unrelated short names into false
# neighbours.
MAX_NEAR_MATCH_DISTANCE = 2
# German crop names are compounds, and the shared part is what gives away a
# related crop ("Schnittkohl"/"Grünkohl", "Zuckererbse"/"Erbse"). Four characters
# is the shortest German crop head worth matching on ("kohl", "bohne" minus its
# ending); a shared start needs one more character because prefixes collide more
# easily ("Kartoffel"/"Karotte").
MIN_SHARED_SUFFIX_LENGTH = 4
MIN_SHARED_PREFIX_LENGTH = 5


@dataclass(frozen=True)
class CropNameUsage:
    """One distinct project crop name and where it is used."""

    name: str
    normalized_name: str
    crop_count: int
    project_ids: tuple[int, ...]


@dataclass(frozen=True)
class CropNameGap:
    """A project crop name with no species behind it."""

    usage: CropNameUsage
    near_matches: tuple[str, ...] = ()

    @property
    def needs_manual_decision(self) -> bool:
        """True when an existing species is close enough to be the same crop."""
        return bool(self.near_matches)


@dataclass(frozen=True)
class CropSpeciesCoverageReport:
    """Result of one comparison run."""

    matched: list[CropNameUsage] = field(default_factory=list)
    missing: list[CropNameGap] = field(default_factory=list)
    borderline: list[CropNameGap] = field(default_factory=list)

    @property
    def checked_name_count(self) -> int:
        return len(self.matched) + len(self.missing) + len(self.borderline)


def _bounded_levenshtein(left: str, right: str, max_distance: int) -> int:
    """Edit distance, giving up as soon as it exceeds ``max_distance``."""
    if abs(len(left) - len(right)) > max_distance:
        return max_distance + 1
    previous = list(range(len(right) + 1))
    for left_index, left_char in enumerate(left, start=1):
        current = [left_index]
        row_min = current[0]
        for right_index, right_char in enumerate(right, start=1):
            substitution_cost = 0 if left_char == right_char else 1
            current.append(
                min(
                    previous[right_index] + 1,
                    current[right_index - 1] + 1,
                    previous[right_index - 1] + substitution_cost,
                )
            )
            row_min = min(row_min, current[-1])
        if row_min > max_distance:
            return max_distance + 1
        previous = current
    return previous[-1]


def collect_project_crop_names(project_ids: list[int] | None = None) -> list[CropNameUsage]:
    """Distinct crop names used in projects, most-used first."""
    queryset = Crop.objects.all()
    if project_ids:
        queryset = queryset.filter(project_id__in=project_ids)

    usages: dict[str, dict] = {}
    for name, project_id in queryset.values_list('name', 'project_id').iterator():
        normalized = normalize_text(name)
        if not normalized:
            continue
        usage = usages.setdefault(
            normalized,
            {'name': ' '.join(name.split()), 'crop_count': 0, 'project_ids': set()},
        )
        usage['crop_count'] += 1
        usage['project_ids'].add(project_id)

    return sorted(
        (
            CropNameUsage(
                name=usage['name'],
                normalized_name=normalized,
                crop_count=usage['crop_count'],
                project_ids=tuple(sorted(usage['project_ids'])),
            )
            for normalized, usage in usages.items()
        ),
        key=lambda usage: (-usage.crop_count, usage.normalized_name),
    )


def _library_search_names() -> list[str]:
    """Every name the library can currently be found by, canonical or alias."""
    names: list[str] = []
    queryset = (
        CropSpecies.objects
        .filter(status=CropSpecies.STATUS_PUBLISHED)
        .prefetch_related('translations')
    )
    for species in queryset:
        names.extend(species.search_names())
    return names


def _shared_prefix_length(left: str, right: str) -> int:
    length = 0
    for left_char, right_char in zip(left, right, strict=False):
        if left_char != right_char:
            break
        length += 1
    return length


def _is_near_match(normalized: str, normalized_library_name: str) -> bool:
    """Whether two normalized crop names are close enough to need a decision."""
    if normalized in normalized_library_name or normalized_library_name in normalized:
        return True
    distance = _bounded_levenshtein(
        normalized, normalized_library_name, MAX_NEAR_MATCH_DISTANCE,
    )
    if distance <= MAX_NEAR_MATCH_DISTANCE:
        return True
    shared_suffix = _shared_prefix_length(normalized[::-1], normalized_library_name[::-1])
    if shared_suffix >= MIN_SHARED_SUFFIX_LENGTH:
        return True
    return _shared_prefix_length(normalized, normalized_library_name) >= MIN_SHARED_PREFIX_LENGTH


def find_near_matches(name: str, library_names: list[str]) -> tuple[str, ...]:
    """Library names close enough to ``name`` that a human has to decide.

    A small edit distance ("Zucchetti" vs "Zucchini") and a shared compound part
    ("Schnittkohl" vs "Grünkohl") both count: either can hide an alias or a
    use-form split behind a new-looking name.
    """
    normalized = normalize_text(name) or ''
    if not normalized:
        return ()

    matches: list[str] = []
    for library_name in library_names:
        normalized_library_name = normalize_text(library_name) or ''
        if not normalized_library_name or normalized_library_name == normalized:
            continue
        if _is_near_match(normalized, normalized_library_name):
            matches.append(library_name)
    return tuple(dict.fromkeys(matches))


def build_crop_species_coverage_report(
    project_ids: list[int] | None = None,
) -> CropSpeciesCoverageReport:
    """Compare every project crop name against the official species list."""
    library_names = _library_search_names()
    report = CropSpeciesCoverageReport()

    for usage in collect_project_crop_names(project_ids):
        if find_species_by_common_name(usage.name) is not None:
            report.matched.append(usage)
            continue
        gap = CropNameGap(usage=usage, near_matches=find_near_matches(usage.name, library_names))
        if gap.needs_manual_decision:
            report.borderline.append(gap)
        else:
            report.missing.append(gap)
    return report
