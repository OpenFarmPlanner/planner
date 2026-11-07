"""Fixed test data for the cross-browser screenshot suite (frontend/e2e-cross-browser/).

This is test data, not a demo. Every value below ends up in a screenshot
baseline or in an assertion of that suite, so change it only together with the
baselines (re-recorded in Docker, see docs/testing-and-ci.md, "Cross-browser
suite") and the names and counts the specs assert. It deliberately shares
nothing with the demo seeding code (farm/services/demo_project.py,
demo_features.py): enriching the demo must never move a baseline.

All dates are absolute and sit around the suite's fixed browser clock
(`FIXED_NOW`, 15 May 2026, in frontend/e2e-cross-browser/fixtures.ts), so the
data does not depend on the server date.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any

from django.db import transaction
from django.utils import timezone

from crops.services import find_species_by_common_name
from farm.models import Bed, Crop, CropCompanion, Field, Location, PlantingPlan, Project
from farm.services.crop_companions import CompanionTarget, relation_kwargs
from farm.services.seasons import get_or_create_season_for_date

CROSS_BROWSER_PROJECT_NAME = 'Testgärtnerei Morgentau'
# The season the browser clock falls into, and the one before it (history for
# the rotation check and the second entry of the season switcher).
CURRENT_YEAR = 2026
PREVIOUS_YEAR = CURRENT_YEAR - 1


@dataclass(frozen=True)
class CropSpec:
    key: str
    name: str
    variety: str
    color: str
    # Sorten leave the inherited fields empty and take them from their Kultur.
    cultivation_types: tuple[str, ...] = ()
    crop_family: str | None = None
    nutrient_demand: str = ''
    growth_days: int | None = None
    harvest_days: int | None = None
    propagation_days: int | None = None
    values: tuple[tuple[str, Any], ...] = ()


@dataclass(frozen=True)
class PlanSpec:
    crop_key: str
    bed_key: str
    cultivation_type: str
    planting_date: date
    area_usage_sqm: Decimal
    quantity: int | None = None
    notes: str = ''
    rotation_conflict_accepted: bool = False


# (location, field, bed length m, bed width m, beds as (key, name)).
AREAS: tuple[tuple[str, str, float, float, tuple[tuple[str, str], ...]], ...] = (
    ('Gartenhof', 'Folientunnel', 20.0, 0.8, (
        ('tunnel-1', 'Tunnel 1'), ('tunnel-2', 'Tunnel 2'), ('tunnel-3', 'Tunnel 3'),
    )),
    ('Gartenhof', 'Frühbeete', 10.0, 0.75, (
        ('fruehbeet-1', 'Frühbeet 1'), ('fruehbeet-2', 'Frühbeet 2'),
    )),
    ('Feld am Bach', 'Schlag Ost', 20.0, 1.2, (
        ('reihe-1', 'Reihe 1'), ('reihe-2', 'Reihe 2'), ('reihe-3', 'Reihe 3'),
    )),
    ('Feld am Bach', 'Schlag West', 20.0, 1.2, (
        ('reihe-4', 'Reihe 4'), ('reihe-5', 'Reihe 5'), ('reihe-6', 'Reihe 6'),
    )),
)

# The Kultur "Tomate" fills every section of the crop form the suite
# screenshots: tags, rotation, neighbours, spacing, a decimal sowing depth and
# the pre-cultivation seed demand. Its Sorte "Roma" overrides a few values so
# the Sorte form shows highlighted own values next to inherited ones.
CROPS: tuple[CropSpec, ...] = (
    CropSpec(
        key='tomate', name='Tomate', variety='', color='#b91c1c',
        cultivation_types=('pre_cultivation',), crop_family='Solanaceae', nutrient_demand='high',
        growth_days=78, harvest_days=56, propagation_days=45,
        values=(
            ('botanical_name', 'Solanum lycopersicum'),
            ('tags', ['Fruchtgemüse']),
            ('row_spacing_m', 0.80),
            ('distance_within_row_m', 0.50),
            ('sowing_depth_m', 0.005),
            ('expected_yield', Decimal('4.50')),
            ('harvest_method', 'per_plant'),
            ('seed_rate_pre_cultivation_value', 1.0),
            ('seed_rate_pre_cultivation_unit', 'seeds_per_plant'),
            ('sowing_calculation_safety_percent_pre_cultivation', 20),
            ('thousand_kernel_weight_g', Decimal('3.10')),
        ),
    ),
    CropSpec(
        key='tomate-roma', name='Tomate', variety='Roma', color='#dc2626', growth_days=72,
        values=(
            ('row_spacing_m', 0.70),
            ('distance_within_row_m', 0.45),
            ('expected_yield', Decimal('4.20')),
            ('thousand_kernel_weight_g', Decimal('3.20')),
        ),
    ),
    CropSpec(
        key='kartoffel', name='Kartoffel', variety='', color='#a16207',
        cultivation_types=('direct_sowing',), crop_family='Solanaceae', nutrient_demand='high',
        growth_days=100, harvest_days=21,
        values=(('botanical_name', 'Solanum tuberosum'), ('sowing_depth_m', 0.10)),
    ),
    CropSpec(
        key='salat', name='Salat', variety='', color='#65a30d',
        cultivation_types=('pre_cultivation',), crop_family='Asteraceae', nutrient_demand='low',
        growth_days=55, harvest_days=21, propagation_days=28,
    ),
    CropSpec(key='salat-maikoenig', name='Salat', variety='Maikönig', color='#84cc16'),
    CropSpec(
        key='gurke', name='Gurke', variety='', color='#15803d',
        cultivation_types=('pre_cultivation',), crop_family='Cucurbitaceae', nutrient_demand='high',
        growth_days=60, harvest_days=60, propagation_days=28,
    ),
    CropSpec(key='gurke-arola', name='Gurke', variety='Arola', color='#16a34a'),
    CropSpec(
        key='karotte', name='Karotte', variety='', color='#c2410c',
        cultivation_types=('direct_sowing',), crop_family='Apiaceae', nutrient_demand='medium',
        growth_days=100, harvest_days=28,
    ),
    CropSpec(key='karotte-nantaise', name='Karotte', variety='Nantaise 2', color='#ea580c'),
    CropSpec(
        key='zucchini', name='Zucchini', variety='', color='#0f766e',
        cultivation_types=('pre_cultivation',), crop_family='Cucurbitaceae', nutrient_demand='high',
        growth_days=48, harvest_days=75, propagation_days=26,
    ),
    CropSpec(
        key='buschbohne', name='Buschbohne', variety='', color='#4d7c0f',
        cultivation_types=('direct_sowing',), crop_family='Fabaceae', nutrient_demand='low',
        growth_days=60, harvest_days=30,
    ),
    CropSpec(
        key='phacelia', name='Phacelia', variety='', color='#7c3aed',
        cultivation_types=('direct_sowing',), crop_family='Boraginaceae', nutrient_demand='low',
        growth_days=60,
    ),
)

# Every bed except "Tunnel 3" carries one previous-season plan, so the current
# season shows each rotation status once: conflict (lettuce on "Frühbeet 1"),
# accepted conflict (tomato on "Tunnel 1"), hint (tomato after cucumber on
# "Tunnel 2"), not checkable ("Tunnel 3" without history, phacelia without a
# rotation break) and ok. The first plan by planting date is the conflict, so
# the area-assignment dialog opened from the first grid row shows its warning.
PRE = 'pre_cultivation'
DIRECT = 'direct_sowing'
BOUGHT = 'purchased_transplant'
PLANS: tuple[PlanSpec, ...] = (
    PlanSpec('salat-maikoenig', 'fruehbeet-1', PRE, date(PREVIOUS_YEAR, 4, 10), Decimal('7.5'), 95),
    PlanSpec('karotte-nantaise', 'fruehbeet-2', DIRECT, date(PREVIOUS_YEAR, 3, 15), Decimal('7.5')),
    PlanSpec('tomate-roma', 'tunnel-1', PRE, date(PREVIOUS_YEAR, 4, 28), Decimal('16.0'), 35),
    PlanSpec('gurke-arola', 'tunnel-2', PRE, date(PREVIOUS_YEAR, 5, 12), Decimal('16.0'), 38),
    PlanSpec('kartoffel', 'reihe-1', DIRECT, date(PREVIOUS_YEAR, 4, 12), Decimal('24.0')),
    PlanSpec('buschbohne', 'reihe-2', DIRECT, date(PREVIOUS_YEAR, 5, 8), Decimal('24.0')),
    PlanSpec('zucchini', 'reihe-3', PRE, date(PREVIOUS_YEAR, 5, 20), Decimal('24.0'), 20),
    PlanSpec('karotte-nantaise', 'reihe-4', DIRECT, date(PREVIOUS_YEAR, 3, 20), Decimal('24.0')),
    PlanSpec('buschbohne', 'reihe-5', DIRECT, date(PREVIOUS_YEAR, 5, 6), Decimal('24.0')),
    PlanSpec('salat-maikoenig', 'reihe-6', PRE, date(PREVIOUS_YEAR, 3, 20), Decimal('24.0'), 300),
    PlanSpec('salat-maikoenig', 'fruehbeet-1', PRE, date(CURRENT_YEAR, 2, 18), Decimal('7.5'), 95),
    PlanSpec('karotte-nantaise', 'reihe-1', DIRECT, date(CURRENT_YEAR, 3, 12), Decimal('24.0')),
    PlanSpec('salat-maikoenig', 'fruehbeet-2', PRE, date(CURRENT_YEAR, 3, 22), Decimal('7.5'), 95),
    PlanSpec('kartoffel', 'reihe-2', DIRECT, date(CURRENT_YEAR, 4, 12), Decimal('24.0')),
    PlanSpec('phacelia', 'reihe-4', DIRECT, date(CURRENT_YEAR, 4, 18), Decimal('24.0')),
    PlanSpec(
        'tomate-roma', 'tunnel-1', PRE, date(CURRENT_YEAR, 4, 25), Decimal('16.0'), 35,
        notes='Tomaten im Tunnel bewusst nach Tomaten; Boden im Winter ausgetauscht.',
        rotation_conflict_accepted=True,
    ),
    PlanSpec('tomate-roma', 'tunnel-2', BOUGHT, date(CURRENT_YEAR, 5, 2), Decimal('16.0'), 35),
    # The date-entry spec edits this one: the only plan planted on 10 May.
    PlanSpec('gurke-arola', 'tunnel-3', PRE, date(CURRENT_YEAR, 5, 10), Decimal('16.0'), 38),
    PlanSpec('buschbohne', 'reihe-3', DIRECT, date(CURRENT_YEAR, 5, 12), Decimal('24.0')),
    PlanSpec('zucchini', 'reihe-5', PRE, date(CURRENT_YEAR, 5, 18), Decimal('24.0'), 20),
    PlanSpec('karotte-nantaise', 'reihe-6', DIRECT, date(CURRENT_YEAR, 5, 20), Decimal('24.0')),
    PlanSpec('salat-maikoenig', 'fruehbeet-1', PRE, date(CURRENT_YEAR, 8, 25), Decimal('7.5'), 95),
)

NEIGHBOUR_NOTE = 'Beispiel für die betriebseigene Mischkulturplanung.'


def populate_cross_browser_project(project: Project, *, owner: Any) -> None:
    """Fill an empty fixture project with the cross-browser suite's data."""
    with transaction.atomic():
        beds = _create_beds(project)
        crops = _create_crops(project)
        _create_neighbours(project, crops)
        _create_plans(project, crops, beds, owner)


def _create_beds(project: Project) -> dict[str, Bed]:
    locations: dict[str, Location] = {}
    beds: dict[str, Bed] = {}
    for location_name, field_name, length_m, width_m, bed_specs in AREAS:
        if location_name not in locations:
            locations[location_name] = Location.objects.create(name=location_name, project=project)
        field = Field.objects.create(
            name=field_name,
            location=locations[location_name],
            length_m=length_m,
            width_m=len(bed_specs) * width_m,
            project=project,
        )
        for key, name in bed_specs:
            beds[key] = Bed.objects.create(
                name=name, field=field, length_m=length_m, width_m=width_m, project=project,
            )
    return beds


def _create_crops(project: Project) -> dict[str, Crop]:
    crops: dict[str, Crop] = {}
    for spec in CROPS:
        crops[spec.key] = Crop.objects.create(
            project=project,
            name=spec.name,
            variety=spec.variety,
            crop_species=find_species_by_common_name(spec.name),
            display_color=spec.color,
            cultivation_types=list(spec.cultivation_types),
            cultivation_type=spec.cultivation_types[0] if spec.cultivation_types else '',
            crop_family_id=spec.crop_family,
            nutrient_demand=spec.nutrient_demand,
            growth_duration_days=spec.growth_days,
            harvest_duration_days=spec.harvest_days,
            propagation_duration_days=spec.propagation_days,
            **dict(spec.values),
        )
    return crops


def _create_neighbours(project: Project, crops: dict[str, Crop]) -> None:
    tomato = crops['tomate']
    CropCompanion.objects.create(
        project=project, crop=tomato, companion_text='Blühstreifen',
        kind='good', reason='other', note=NEIGHBOUR_NOTE,
    )
    CropCompanion.objects.create(
        project=project, kind='bad', reason='shared_pests_diseases', note=NEIGHBOUR_NOTE,
        **relation_kwargs(tomato, CompanionTarget(type='crop', crop=crops['kartoffel'])),
    )


def _create_plans(
    project: Project, crops: dict[str, Crop], beds: dict[str, Bed], owner: Any,
) -> None:
    for spec in PLANS:
        accepted = spec.rotation_conflict_accepted
        PlantingPlan.objects.create(
            project=project,
            season=get_or_create_season_for_date(project, spec.planting_date, created_by=owner),
            crop=crops[spec.crop_key],
            bed=beds[spec.bed_key],
            cultivation_type=spec.cultivation_type,
            planting_date=spec.planting_date,
            area_usage_sqm=spec.area_usage_sqm,
            quantity=spec.quantity,
            notes=spec.notes,
            created_by=owner,
            updated_by=owner,
            rotation_conflict_accepted_by=owner if accepted else None,
            rotation_conflict_accepted_at=timezone.now() if accepted else None,
        )
