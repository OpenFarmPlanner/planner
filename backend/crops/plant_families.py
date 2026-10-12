"""Curated plant-family list and the rules that map free text onto it.

The list is global master data (see :class:`crops.models.PlantFamily`): it is
seeded by migration, edited only in the Django admin, and shared by project
crops and the public crop library. The botanical name is the stable key.

``default_rotation_break_years`` are initial reference values. They still have
to be verified against LfL Bayern / Bio Austria through the crop-data workflow
(docs/crop-library-architecture.md, "Plant families").

:func:`resolve_plant_family_key` is the single mapping rule for free text. The
data migration that replaced the old free-text ``crop_family`` column uses it
for private and public crops alike, and the crop import uses it for incoming
values, so the same spelling always lands on the same family.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class PlantFamilySeed:
    """One curated plant family with its display names and mapping aliases."""

    botanical_name: str
    names: dict[str, str]
    default_rotation_break_years: int | None
    # Additional spellings that unambiguously mean this family: historical
    # botanical synonyms, common German/English names, and older groupings.
    aliases: tuple[str, ...] = field(default_factory=tuple)


PLANT_FAMILY_SEED_DATA: tuple[PlantFamilySeed, ...] = (
    PlantFamilySeed(
        'Brassicaceae',
        {'de': 'Kreuzblütler', 'en': 'Cabbage family'},
        4,
        (
            'Cruciferae', 'Kreuzblütengewächse', 'Kreuzblütlergewächse', 'Kohlgewächse',
            'Kreuzblüter', 'Brassicas', 'Brassica family', 'Crucifers', 'Mustard family',
        ),
    ),
    PlantFamilySeed(
        'Solanaceae',
        {'de': 'Nachtschattengewächse', 'en': 'Nightshade family'},
        3,
        ('Nachtschatten', 'Nightshades', 'Potato family'),
    ),
    PlantFamilySeed(
        'Apiaceae',
        {'de': 'Doldenblütler', 'en': 'Carrot family'},
        3,
        (
            'Umbelliferae', 'Doldengewächse', 'Doldenblütengewächse', 'Umbellifers',
            'Parsley family', 'Celery family',
        ),
    ),
    PlantFamilySeed(
        'Amaryllidaceae',
        {'de': 'Lauchgewächse', 'en': 'Onion family'},
        3,
        (
            'Alliaceae', 'Zwiebelgewächse', 'Amaryllisgewächse', 'Allium', 'Alliums',
            'Allium family', 'Amaryllis family',
        ),
    ),
    PlantFamilySeed(
        'Fabaceae',
        {'de': 'Hülsenfrüchtler', 'en': 'Legume family'},
        3,
        (
            'Leguminosae', 'Papilionaceae', 'Leguminosen', 'Hülsenfrüchte',
            'Schmetterlingsblütler', 'Schmetterlingsblütengewächse', 'Legumes',
            'Pea family', 'Bean family',
        ),
    ),
    PlantFamilySeed(
        'Amaranthaceae',
        {'de': 'Fuchsschwanzgewächse', 'en': 'Amaranth family'},
        3,
        ('Chenopodiaceae', 'Gänsefußgewächse', 'Goosefoot family', 'Chenopods'),
    ),
    PlantFamilySeed(
        'Cucurbitaceae',
        {'de': 'Kürbisgewächse', 'en': 'Gourd family'},
        2,
        ('Cucurbits', 'Cucumber family', 'Squash family', 'Pumpkin family'),
    ),
    PlantFamilySeed(
        'Asteraceae',
        {'de': 'Korbblütler', 'en': 'Daisy family'},
        2,
        (
            'Compositae', 'Korbblütengewächse', 'Composites', 'Aster family',
            'Sunflower family',
        ),
    ),
    PlantFamilySeed(
        'Poaceae',
        {'de': 'Süßgräser', 'en': 'Grass family'},
        None,
        ('Gramineae', 'Gräser', 'Grasses'),
    ),
    PlantFamilySeed(
        'Lamiaceae',
        {'de': 'Lippenblütler', 'en': 'Mint family'},
        None,
        ('Labiatae', 'Lippenblütengewächse'),
    ),
    PlantFamilySeed(
        'Caprifoliaceae',
        {'de': 'Geißblattgewächse (Feldsalat)', 'en': "Honeysuckle family (lamb's lettuce)"},
        None,
        (
            'Valerianaceae', 'Geißblattgewächse', 'Baldriangewächse', 'Honeysuckle family',
            'Valerian family',
        ),
    ),
    PlantFamilySeed(
        'Boraginaceae',
        {'de': 'Raublattgewächse', 'en': 'Borage family'},
        None,
        ('Borretschgewächse',),
    ),
    PlantFamilySeed(
        'Polygonaceae',
        {'de': 'Knöterichgewächse', 'en': 'Knotweed family'},
        None,
        ('Buckwheat family',),
    ),
    PlantFamilySeed(
        'Malvaceae',
        {'de': 'Malvengewächse', 'en': 'Mallow family'},
        None,
    ),
    PlantFamilySeed(
        'Montiaceae',
        {'de': 'Quellkrautgewächse', 'en': 'Miner\'s lettuce family'},
        None,
        ('Montia family',),
    ),
    PlantFamilySeed(
        'Tropaeolaceae',
        {'de': 'Kapuzinerkressengewächse', 'en': 'Nasturtium family'},
        None,
    ),
)

PLANT_FAMILY_BOTANICAL_NAMES: tuple[str, ...] = tuple(
    seed.botanical_name for seed in PLANT_FAMILY_SEED_DATA
)

_UMLAUT_REPLACEMENTS = str.maketrans({'ä': 'ae', 'ö': 'oe', 'ü': 'ue'})
_PART_SEPARATORS = re.compile(r'[()\[\]/,;|]+')
_EDGE_PUNCTUATION = '"\'„“”‚‘’`.:-–— '


def normalize_plant_family_label(value: str | None) -> str:
    """Comparison key for a family spelling.

    Case-insensitive, whitespace-insensitive and umlaut-insensitive, so
    "Kreuzblütler", " kreuzbluetler " and "KREUZBLÜTLER" share one key.
    """
    text = ' '.join((value or '').split()).casefold()
    text = text.translate(_UMLAUT_REPLACEMENTS)
    return text.strip(_EDGE_PUNCTUATION)


def _build_alias_index() -> dict[str, str]:
    index: dict[str, str] = {}
    for seed in PLANT_FAMILY_SEED_DATA:
        spellings = (seed.botanical_name, *seed.names.values(), *seed.aliases)
        for spelling in spellings:
            key = normalize_plant_family_label(spelling)
            existing = index.get(key)
            if existing is not None and existing != seed.botanical_name:
                raise ValueError(f'Ambiguous plant family alias: {spelling!r}')
            index[key] = seed.botanical_name
    return index


PLANT_FAMILY_ALIAS_INDEX: dict[str, str] = _build_alias_index()


def resolve_plant_family_key(value: str | None) -> str | None:
    """The botanical name a free-text family value means, or ``None``.

    The whole value is matched first. Failing that, a compound value such as
    "Kreuzblütler (Brassicaceae)" or "Kohlgewächse / Cruciferae" is split into
    parts; it resolves only when every part names the same family, so a mixed
    or partly unknown value ("Nachtschatten / Kürbis") is never guessed.
    """
    key = normalize_plant_family_label(value)
    if not key:
        return None
    direct = PLANT_FAMILY_ALIAS_INDEX.get(key)
    if direct is not None:
        return direct
    part_keys = [
        part_key
        for part in _PART_SEPARATORS.split(key)
        if (part_key := normalize_plant_family_label(part))
    ]
    matches = {PLANT_FAMILY_ALIAS_INDEX.get(part_key) for part_key in part_keys}
    if len(part_keys) < 2 or len(matches) != 1:
        return None
    return matches.pop()


def load_plant_family_default_breaks() -> dict[str, int | None]:
    """Botanical name → ``default_rotation_break_years`` for every stored family."""
    from crops.models import PlantFamily

    return dict(PlantFamily.objects.values_list('botanical_name', 'default_rotation_break_years'))


def coerce_plant_family_key(value: str | None) -> str | None:
    """A stored family key for ``value``: an existing botanical name, else its mapping.

    For values written before the plant-family list existed (old public-crop
    version snapshots, history entries): a current key passes through, free
    text goes through :func:`resolve_plant_family_key`, and anything that does
    not name a stored family becomes ``None``.
    """
    if not value or not isinstance(value, str):
        return None
    from crops.models import PlantFamily

    if PlantFamily.objects.filter(pk=value).exists():
        return value
    family_key = resolve_plant_family_key(value)
    if family_key and PlantFamily.objects.filter(pk=family_key).exists():
        return family_key
    return None


def seed_plant_families(plant_family_model: Any, translation_model: Any) -> None:
    """Create or refresh the curated families; families added in the admin stay untouched.

    Takes the model classes so migration ``crops.0019`` can pass its historical
    models and the test suite (``backend/conftest.py``) the real ones.
    """
    for seed in PLANT_FAMILY_SEED_DATA:
        family, _created = plant_family_model.objects.update_or_create(
            botanical_name=seed.botanical_name,
            defaults={'default_rotation_break_years': seed.default_rotation_break_years},
        )
        for language_code, name in seed.names.items():
            translation_model.objects.update_or_create(
                family=family,
                language_code=language_code,
                defaults={'name': name},
            )
