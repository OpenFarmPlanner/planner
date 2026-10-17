"""Read the frozen crop-species bootstrap snapshot used by historical migrations.

The snapshot is the starting catalogue for a fresh database, not a maintained
data source: the database is. This module deliberately imports nothing from
the app, so the migrations that read it keep producing the same rows no matter
how application code evolves. See README.md in this directory.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

SNAPSHOT_PATH = Path(__file__).with_name('species_bootstrap_v1.json')


@dataclass(frozen=True)
class BootstrapSpeciesEntry:
    """One species of the bootstrap catalogue, keyed language-independently."""

    key: str
    translations: dict[str, str]
    scientific_name: str = ''
    family: str = ''
    categories: tuple[str, ...] = ()


def _load_snapshot() -> dict:
    with SNAPSHOT_PATH.open(encoding='utf-8') as snapshot_file:
        return json.load(snapshot_file)


_SNAPSHOT = _load_snapshot()

BOOTSTRAP_SPECIES: tuple[BootstrapSpeciesEntry, ...] = tuple(
    BootstrapSpeciesEntry(
        key=item['key'],
        translations=dict(item['translations']),
        scientific_name=item['scientific_name'],
        family=item['family'],
        categories=tuple(item['categories']),
    )
    for item in _SNAPSHOT['species']
)

BOOTSTRAP_SPECIES_SYNONYMS: dict[str, dict[str, tuple[str, ...]]] = {
    key: {language_code: tuple(synonyms) for language_code, synonyms in by_language.items()}
    for key, by_language in _SNAPSHOT['synonyms'].items()
}

BOOTSTRAP_SPECIES_REGIONAL_NAMES: dict[str, dict[str, dict[str, str]]] = {
    key: {language_code: dict(names) for language_code, names in by_language.items()}
    for key, by_language in _SNAPSHOT['regional_names'].items()
}


def get_bootstrap_species_name(entry: BootstrapSpeciesEntry, language_code: str = 'de') -> str:
    """Name in the requested language, falling back to German."""
    return entry.translations.get(language_code) or entry.translations['de']


def get_bootstrap_species_synonyms(key: str, language_code: str = 'de') -> tuple[str, ...]:
    """Search aliases of one species in one language."""
    return BOOTSTRAP_SPECIES_SYNONYMS.get(key, {}).get(language_code, ())


def get_bootstrap_species_regional_names(key: str, language_code: str = 'de') -> dict[str, str]:
    """Region -> display name of one species in one language."""
    return dict(BOOTSTRAP_SPECIES_REGIONAL_NAMES.get(key, {}).get(language_code, {}))
