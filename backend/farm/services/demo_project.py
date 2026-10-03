from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import F, Q
from django.utils import timezone
from django.utils.crypto import get_random_string
from django.utils.text import slugify

from accounts.models import UserProjectSettings
from config.languages import normalize_language_tag, resolve_request_language
from crops.models import CropSpecies
from crops.services import find_species_by_common_name
from farm.models import (
    BatchOperation,
    Bed,
    BedLayout,
    Crop,
    CropSupplierData,
    EntityRevision,
    Field,
    FieldLayout,
    Location,
    PlantingPlan,
    Project,
    ProjectMembership,
    PublicCrop,
    Season,
    SeedPackage,
    Supplier,
)
from farm.services.project_users import get_or_create_project_user
from farm.services.seasons import assign_unassigned_planting_plans, get_or_create_season_for_date

User = get_user_model()

DEMO_PROJECT_NAME = 'Solawi Sonnenacker'
DEMO_PROJECT_SLUG = 'solawi-sonnenacker'
DEMO_PROJECT_DESCRIPTION = 'Pers\u00f6nliches Demo-Projekt mit realistischen Beispieldaten.'
DEMO_PROJECT_NAME_EN = 'Sunny Acre CSA'
DEMO_PROJECT_DESCRIPTION_EN = 'Personal demo project with realistic sample data.'
DEMO_SCREENSHOT_PROJECT_DESCRIPTION = 'Reproduzierbares Demo-Projekt f\u00fcr Produkt-Screenshots.'
DEMO_SCREENSHOT_PROJECT_DESCRIPTION_EN = 'Reproducible demo project for product screenshots.'
DEMO_PROJECT_DESCRIPTIONS = frozenset({
    DEMO_PROJECT_DESCRIPTION,
    DEMO_PROJECT_DESCRIPTION_EN,
    DEMO_SCREENSHOT_PROJECT_DESCRIPTION,
    DEMO_SCREENSHOT_PROJECT_DESCRIPTION_EN,
})
DEMO_LANGUAGE_DEFAULT = 'de'
DEMO_USER_EMAIL = 'demo-openfarmplanner@example.local'
DEMO_USERNAME = 'openfarmplanner-demo'
DEMO_PASSWORD = 'OpenFarmPlannerDemo2026!'

DEMO_PROJECT_NAMES = {
    'de': DEMO_PROJECT_NAME,
    'en': DEMO_PROJECT_NAME_EN,
}
DEMO_PERSONAL_PROJECT_DESCRIPTIONS = {
    'de': DEMO_PROJECT_DESCRIPTION,
    'en': DEMO_PROJECT_DESCRIPTION_EN,
}
DEMO_SCREENSHOT_PROJECT_DESCRIPTIONS = {
    'de': DEMO_SCREENSHOT_PROJECT_DESCRIPTION,
    'en': DEMO_SCREENSHOT_PROJECT_DESCRIPTION_EN,
}

DEMO_TEXT = {
    'de': {
        'locations': {
            'hofgarten': ('Hofgarten', 'Gesch\u00fctzte Fl\u00e4chen nahe Waschplatz und Jungpflanzenhaus.'),
            'bachacker': ('Acker am Bach', 'Freilandfl\u00e4che f\u00fcr Wurzelgem\u00fcse und Kohlkulturen.'),
        },
        'fields': {
            'fruehbeete': 'Fr\u00fchbeete Nord',
            'tunnel': 'Folientunnel S\u00fcd',
            'wurzel': 'Wurzelgem\u00fcse',
            'kohl': 'Kohlquartier',
        },
        'beds': {
            'salat-1': 'Salat 1',
            'salat-2': 'Salat 2',
            'kraeuter': 'Kr\u00e4uter & Mangold',
            'tomate-1': 'Tomatenreihe 1',
            'tomate-2': 'Tomatenreihe 2',
            'gurke': 'Gurkenreihe',
            'karotte-1': 'Karotten 1',
            'karotte-2': 'Karotten 2',
            'rote-bete': 'Rote Bete',
            'kohlrabi': 'Kohlrabi',
            'zucchini': 'Zucchini',
            'reserve': 'Gr\u00fcnd\u00fcngung Reserve',
        },
        'crops': {
            'karotte': ('Karotte', 'Nantaise 2', 'Doldenbl\u00fctler'),
            'salat': ('Salat', 'Lollo Bionda', 'Korbbl\u00fctler'),
            'tomate': ('Tomate', 'Ruthje', 'Nachtschattengew\u00e4chse'),
            'gurke': ('Gurke', 'Tanja', 'K\u00fcrbisgew\u00e4chse'),
            'mangold': ('Mangold', 'Bright Lights', 'Fuchsschwanzgew\u00e4chse'),
            'rote-bete': ('Rote Bete', 'Robuschka', 'Fuchsschwanzgew\u00e4chse'),
            'kohlrabi': ('Kohlrabi', 'Azur Star', 'Kreuzbl\u00fctler'),
            'zucchini': ('Zucchini', 'Costata Romanesco', 'K\u00fcrbisgew\u00e4chse'),
        },
        'plan_notes': {
            'salat_frueh': 'Fr\u00fcher Satz f\u00fcr die erste Abo-Kiste.',
            'tomate': 'Stabtomaten nach Jungpflanzenanzucht.',
            'salat_herbst': 'Herbstsatz nach der Sommerpause.',
        },
    },
    'en': {
        'locations': {
            'hofgarten': ('Farm Garden', 'Sheltered beds near the wash station and propagation house.'),
            'bachacker': ('Creekside Field', 'Open field for root vegetables and brassicas.'),
        },
        'fields': {
            'fruehbeete': 'North Early Beds',
            'tunnel': 'South Polytunnel',
            'wurzel': 'Root Vegetables',
            'kohl': 'Brassica Block',
        },
        'beds': {
            'salat-1': 'Lettuce 1',
            'salat-2': 'Lettuce 2',
            'kraeuter': 'Herbs & Chard',
            'tomate-1': 'Tomato Row 1',
            'tomate-2': 'Tomato Row 2',
            'gurke': 'Cucumber Row',
            'karotte-1': 'Carrots 1',
            'karotte-2': 'Carrots 2',
            'rote-bete': 'Beetroot',
            'kohlrabi': 'Kohlrabi',
            'zucchini': 'Zucchini',
            'reserve': 'Green Manure Reserve',
        },
        'crops': {
            'karotte': ('Carrot', 'Nantaise 2', 'Carrot family'),
            'salat': ('Lettuce', 'Lollo Bionda', 'Daisy family'),
            'tomate': ('Tomato', 'Ruthje', 'Nightshade family'),
            'gurke': ('Cucumber', 'Tanja', 'Cucumber family'),
            'mangold': ('Chard', 'Bright Lights', 'Amaranth family'),
            'rote-bete': ('Beetroot', 'Robuschka', 'Amaranth family'),
            'kohlrabi': ('Kohlrabi', 'Azur Star', 'Cabbage family'),
            'zucchini': ('Zucchini', 'Costata Romanesco', 'Cucumber family'),
        },
        'plan_notes': {
            'salat_frueh': 'Early succession for the first CSA box.',
            'tomate': 'Stake tomatoes after propagation.',
            'salat_herbst': 'Autumn succession after the summer break.',
        },
    },
}


@dataclass(frozen=True)
class DemoProjectResult:
    project: Project
    user: Any
    created_project: bool
    created_user: bool


@dataclass(frozen=True)
class CropSpec:
    key: str
    name: str
    variety: str
    color: str
    cultivation_types: list[str]
    growth_days: int | None
    harvest_days: int | None
    propagation_days: int | None
    crop_family: str
    nutrient_demand: str
    row_spacing_m: float | None
    distance_within_row_m: float | None
    expected_yield: Decimal | None
    harvest_method: str
    sowing_depth_m: float | None = None
    seed_rate_direct_value: float | None = None
    seed_rate_direct_unit: str | None = None
    seed_rate_pre_value: float | None = None
    seed_rate_pre_unit: str | None = None
    safety_direct: float | None = None
    safety_pre: float | None = None
    safety_general: float | None = None
    tkg: Decimal | None = None
    seeding_requirement: float | None = None
    seeding_requirement_type: str = ''
    supplier_key: str = 'bingenheimer'
    packaging_sizes: list[dict[str, float | str]] | None = None
    germination_rate: float | None = None
    is_species: bool = False


@dataclass(frozen=True)
class PlanSpec:
    crop_key: str
    bed_key: str
    cultivation_type: str
    planting_date: date
    area_usage_sqm: Decimal
    quantity: int | None = None
    notes: str = ''


def reset_project_demo_data(project: Project) -> None:
    """Remove farm-planning records from one project before recreating the demo."""
    PlantingPlan.objects.filter(project=project).delete()
    Season.all_objects.filter(project=project).delete()
    BedLayout.objects.filter(project=project).delete()
    FieldLayout.objects.filter(project=project).delete()
    Bed.objects.filter(project=project).delete()
    Field.objects.filter(project=project).delete()
    Location.objects.filter(project=project).delete()
    CropSupplierData.objects.filter(project=project).delete()
    SeedPackage.objects.filter(project=project).delete()
    Crop.all_objects.filter(project=project).delete()
    Supplier.objects.filter(project=project).delete()
    # These hard deletes record no ACTION_DELETED revisions, so any surviving
    # history would still describe the wiped rows as "active" and make a later
    # point-in-time restore recreate them (and collide on unique constraints).
    # A demo reset is a clean slate — drop the project's history too.
    EntityRevision.objects.filter(project=project).delete()
    BatchOperation.objects.filter(project=project).delete()


def demo_project_used_filter(prefix: str = '') -> Q:
    """Match demo projects with at least one change made after seeding.

    Seeding records revisions of its own (`Crop.save()` writes one per crop),
    so only revisions after `demo_seeded_at` count. A project without that
    marker counts any revision. Pass `prefix` (e.g. `'project__'`) to filter a
    related model; combine with `.distinct()` when counting.
    """
    return Q(**{f'{prefix}entity_revisions__created_at__gt': F(f'{prefix}demo_seeded_at')}) | Q(
        **{f'{prefix}demo_seeded_at__isnull': True, f'{prefix}entity_revisions__isnull': False},
    )


def is_demo_project_description(description: str | None) -> bool:
    """Return whether a project description marks one of the demo templates."""
    return (description or '') in DEMO_PROJECT_DESCRIPTIONS


def find_demo_crop_species(name: str | None) -> CropSpecies | None:
    """Resolve a demo crop name through all language variants in the template."""
    species = find_species_by_common_name(name)
    if species is not None:
        return species

    for text in DEMO_TEXT.values():
        for crop_key, crop_text in text['crops'].items():
            if crop_text[0] != name:
                continue
            for fallback_text in DEMO_TEXT.values():
                species = find_species_by_common_name(fallback_text['crops'][crop_key][0])
                if species is not None:
                    return species
    return None


def resolve_demo_language(language_code: str | None) -> str:
    """Resolve a requested demo language, preserving German as template default."""
    return normalize_language_tag(language_code) or DEMO_LANGUAGE_DEFAULT


def resolve_demo_request_language(request: Any) -> str:
    """Resolve the demo template language from a request, defaulting to German."""
    return resolve_request_language(request, default=DEMO_LANGUAGE_DEFAULT)


def get_demo_project_name(language_code: str | None) -> str:
    """Return the localized demo project name."""
    language = resolve_demo_language(language_code)
    return DEMO_PROJECT_NAMES[language]


def get_demo_project_description(language_code: str | None, *, screenshot: bool = False) -> str:
    """Return the localized demo project description."""
    language = resolve_demo_language(language_code)
    descriptions = DEMO_SCREENSHOT_PROJECT_DESCRIPTIONS if screenshot else DEMO_PERSONAL_PROJECT_DESCRIPTIONS
    return descriptions[language]


def populate_demo_project(project: Project, *, owner: Any | None = None, language_code: str | None = None) -> None:
    """Create a compact, realistic demo farm for screenshots and local demos."""
    language = resolve_demo_language(language_code)
    with transaction.atomic():
        reset_project_demo_data(project)

        suppliers = _create_suppliers(project)
        locations, fields, beds = _create_area_hierarchy(project, language_code=language)
        _create_layouts(project, fields, beds)
        crops = _create_crops(project, suppliers, language_code=language)
        _create_planting_plans(project, crops, beds, owner, language_code=language)
        assign_unassigned_planting_plans(project, owner=owner)
        project.demo_seeded_at = timezone.now()
        Project.objects.filter(pk=project.pk).update(demo_seeded_at=project.demo_seeded_at)


def populate_public_demo_library_from_project(project: Project, *, owner: Any | None = None, language_code: str | None = None) -> None:
    """Create public-library demo rows from the local demo project without supplier data."""
    language = resolve_demo_language(language_code)
    with transaction.atomic():
        PublicCrop.objects.filter(source_project=project).delete()
        for crop in Crop.objects.filter(project=project).order_by('name', 'variety'):
            seed_rate_by_cultivation: dict[str, dict[str, float | str]] = {}
            if crop.seed_rate_direct_value is not None and crop.seed_rate_direct_unit:
                seed_rate_by_cultivation['direct_sowing'] = {
                    'value': crop.seed_rate_direct_value,
                    'unit': crop.seed_rate_direct_unit,
                }
            if crop.seed_rate_pre_cultivation_value is not None and crop.seed_rate_pre_cultivation_unit:
                seed_rate_by_cultivation['pre_cultivation'] = {
                    'value': crop.seed_rate_pre_cultivation_value,
                    'unit': crop.seed_rate_pre_cultivation_unit,
                }

            PublicCrop.objects.create(
                status=PublicCrop.STATUS_PUBLISHED,
                created_by=owner if owner and getattr(owner, 'pk', None) else None,
                name=crop.name,
                variety=crop.variety or '',
                notes=crop.notes or '',
                crop_species=crop.crop_species,
                original_language_code=language,
                source_project_crop=crop,
                source_project=project,
                crop_family=crop.crop_family,
                nutrient_demand=crop.nutrient_demand,
                cultivation_types=crop.cultivation_types or [],
                cultivation_type=crop.cultivation_type,
                growth_duration_days=crop.growth_duration_days,
                harvest_duration_days=crop.harvest_duration_days,
                propagation_duration_days=crop.propagation_duration_days,
                harvest_method=crop.harvest_method,
                expected_yield=crop.expected_yield,
                distance_within_row_m=crop.distance_within_row_m,
                row_spacing_m=crop.row_spacing_m,
                sowing_depth_m=crop.sowing_depth_m,
                seed_rate_by_cultivation=seed_rate_by_cultivation or None,
                thousand_kernel_weight_g=crop.thousand_kernel_weight_g,
                seeding_requirement=crop.seeding_requirement,
                seeding_requirement_type=crop.seeding_requirement_type,
                display_color=crop.display_color,
                seed_packages=[],
            )


def create_or_reset_demo_project(
    *,
    user_email: str = DEMO_USER_EMAIL,
    username: str = DEMO_USERNAME,
    password: str = DEMO_PASSWORD,
    project_name: str | None = None,
    project_slug: str = DEMO_PROJECT_SLUG,
    language_code: str | None = None,
    seed_public_library: bool = False,
) -> DemoProjectResult:
    """Create a local demo user/project and replace the project's demo data."""
    language = resolve_demo_language(language_code)
    resolved_project_name = project_name or get_demo_project_name(language)
    project_description = get_demo_project_description(language, screenshot=True)
    with transaction.atomic():
        user, created_user = get_or_create_project_user(
            email=user_email,
            username=username,
            password=password,
        )

        project, created_project = Project.objects.get_or_create(
            slug=project_slug,
            defaults={
                'name': resolved_project_name,
                'description': project_description,
            },
        )
        if not created_project:
            project.name = resolved_project_name
            project.description = project_description
            project.deleted_at = None
            project.is_active = True
            project.save(update_fields=['name', 'description', 'deleted_at', 'is_active', 'updated_at'])

        ProjectMembership.objects.update_or_create(
            user=user,
            project=project,
            defaults={'role': ProjectMembership.ROLE_ADMIN},
        )
        settings_obj, _ = UserProjectSettings.objects.get_or_create(user=user)
        settings_obj.default_project = project
        settings_obj.last_project = project
        settings_obj.save(update_fields=['default_project', 'last_project', 'updated_at'])

        populate_demo_project(project, owner=user, language_code=language)
        if seed_public_library:
            populate_public_demo_library_from_project(project, owner=user, language_code=language)

    return DemoProjectResult(
        project=project,
        user=user,
        created_project=created_project,
        created_user=created_user,
    )


def create_personal_demo_project(
    *,
    user: Any,
    project_name: str | None = None,
    language_code: str | None = None,
) -> DemoProjectResult:
    """Create or return one editable demo project owned by the given user."""
    language = resolve_demo_language(language_code)
    resolved_project_name = project_name or get_demo_project_name(language)
    project_description = get_demo_project_description(language)
    with transaction.atomic():
        locked_user = User.objects.select_for_update().get(pk=user.pk)
        existing_project = (
            Project.objects.select_for_update()
            .filter(
                memberships__user=locked_user,
                name=resolved_project_name,
                description=project_description,
                is_active=True,
                deleted_at__isnull=True,
            )
            .order_by('id')
            .first()
        )
        if existing_project is not None:
            _apply_project_settings(user=locked_user, project=existing_project)
            return DemoProjectResult(
                project=existing_project,
                user=locked_user,
                created_project=False,
                created_user=False,
            )

        project = Project.objects.create(
            name=resolved_project_name,
            slug=_build_unique_demo_project_slug(resolved_project_name),
            description=project_description,
        )
        ProjectMembership.objects.create(
            user=locked_user,
            project=project,
            role=ProjectMembership.ROLE_ADMIN,
        )
        _apply_project_settings(user=locked_user, project=project)
        populate_demo_project(project, owner=locked_user, language_code=language)

    return DemoProjectResult(
        project=project,
        user=locked_user,
        created_project=True,
        created_user=False,
    )


def _apply_project_settings(*, user: Any, project: Project) -> None:
    settings_obj, _ = UserProjectSettings.objects.get_or_create(user=user)
    update_fields = ['last_project', 'updated_at']
    if settings_obj.default_project_id is None:
        settings_obj.default_project = project
        update_fields.append('default_project')
    settings_obj.last_project = project
    settings_obj.save(update_fields=update_fields)


def _build_unique_demo_project_slug(project_name: str) -> str:
    base_slug = slugify(project_name) or get_random_string(8).lower()
    candidate = base_slug
    suffix = 2
    while Project.objects.filter(slug=candidate).exists():
        candidate = f'{base_slug}-{suffix}'
        suffix += 1
    return candidate


def _create_suppliers(project: Project) -> dict[str, Supplier]:
    specs = {
        'bingenheimer': ('Bingenheimer Saatgut', 'https://www.bingenheimersaatgut.de'),
        'sativa': ('Sativa Rheinau', 'https://www.sativa.bio'),
        'reinsaat': ('Reinsaat', 'https://www.reinsaat.at'),
    }
    return {
        key: Supplier.objects.create(name=name, homepage_url=url, project=project)
        for key, (name, url) in specs.items()
    }


def _create_area_hierarchy(
    project: Project,
    *,
    language_code: str,
) -> tuple[dict[str, Location], dict[str, Field], dict[str, Bed]]:
    text = DEMO_TEXT[language_code]
    locations = {
        'hofgarten': Location.objects.create(
            name=text['locations']['hofgarten'][0],
            description=text['locations']['hofgarten'][1],
            soil_type='loam',
            exposure='south',
            project=project,
        ),
        'bachacker': Location.objects.create(
            name=text['locations']['bachacker'][0],
            description=text['locations']['bachacker'][1],
            soil_type='loam',
            exposure='flat',
            project=project,
        ),
    }

    field_specs = [
        ('fruehbeete', text['fields']['fruehbeete'], 'hofgarten', 36.0, 7.5),
        ('tunnel', text['fields']['tunnel'], 'hofgarten', 30.0, 8.0),
        ('wurzel', text['fields']['wurzel'], 'bachacker', 45.0, 6.0),
        ('kohl', text['fields']['kohl'], 'bachacker', 42.0, 6.0),
    ]
    fields = {
        key: Field.objects.create(
            name=name,
            location=locations[location_key],
            length_m=length_m,
            width_m=width_m,
            project=project,
        )
        for key, name, location_key, length_m, width_m in field_specs
    }

    bed_specs = [
        ('salat-1', text['beds']['salat-1'], 'fruehbeete', 12.0, 0.75),
        ('salat-2', text['beds']['salat-2'], 'fruehbeete', 12.0, 0.75),
        ('kraeuter', text['beds']['kraeuter'], 'fruehbeete', 12.0, 0.75),
        ('tomate-1', text['beds']['tomate-1'], 'tunnel', 24.0, 0.80),
        ('tomate-2', text['beds']['tomate-2'], 'tunnel', 24.0, 0.80),
        ('gurke', text['beds']['gurke'], 'tunnel', 24.0, 0.80),
        ('karotte-1', text['beds']['karotte-1'], 'wurzel', 25.0, 0.75),
        ('karotte-2', text['beds']['karotte-2'], 'wurzel', 25.0, 0.75),
        ('rote-bete', text['beds']['rote-bete'], 'wurzel', 25.0, 0.75),
        ('kohlrabi', text['beds']['kohlrabi'], 'kohl', 22.0, 0.75),
        ('zucchini', text['beds']['zucchini'], 'kohl', 18.0, 1.20),
        ('reserve', text['beds']['reserve'], 'kohl', 18.0, 1.20),
    ]
    beds = {
        key: Bed.objects.create(
            name=name,
            field=fields[field_key],
            length_m=length_m,
            width_m=width_m,
            project=project,
        )
        for key, name, field_key, length_m, width_m in bed_specs
    }

    return locations, fields, beds


def _create_layouts(
    project: Project,
    fields: dict[str, Field],
    beds: dict[str, Bed],
) -> None:
    field_positions = {
        'fruehbeete': (40, 40),
        'tunnel': (240, 40),
        'wurzel': (40, 40),
        'kohl': (220, 40),
    }
    for key, field in fields.items():
        x, y = field_positions[key]
        FieldLayout.objects.create(field=field, location=field.location, project=project, x=x, y=y)

    bed_positions = {
        'salat-1': (12, 12),
        'salat-2': (52, 12),
        'kraeuter': (92, 12),
        'tomate-1': (14, 18),
        'tomate-2': (54, 18),
        'gurke': (94, 18),
        'karotte-1': (8, 20),
        'karotte-2': (38, 20),
        'rote-bete': (68, 20),
        'kohlrabi': (8, 24),
        'zucchini': (36, 24),
        'reserve': (64, 24),
    }
    for key, bed in beds.items():
        x, y = bed_positions[key]
        BedLayout.objects.create(
            bed=bed,
            location=bed.field.location,
            project=project,
            x=x,
            y=y,
        )


def _create_crops(project: Project, suppliers: dict[str, Supplier], *, language_code: str) -> dict[str, Crop]:
    crop_text = DEMO_TEXT[language_code]['crops']
    crop_specs = [
        CropSpec(
            key='tomate-art',
            name=crop_text['tomate'][0],
            variety='',
            color='#b91c1c',
            cultivation_types=['pre_cultivation'],
            growth_days=78,
            harvest_days=56,
            propagation_days=45,
            crop_family=crop_text['tomate'][2],
            nutrient_demand='high',
            row_spacing_m=0.80,
            distance_within_row_m=0.50,
            expected_yield=Decimal('4.50'),
            harvest_method='per_plant',
            sowing_depth_m=0.005,
            seed_rate_pre_value=1.2,
            seed_rate_pre_unit='seeds_per_plant',
            safety_pre=20,
            tkg=Decimal('3.10'),
            is_species=True,
        ),
        CropSpec(
            key='tomate',
            name=crop_text['tomate'][0],
            variety='Roma',
            color='#dc2626',
            cultivation_types=[],
            growth_days=72,
            harvest_days=None,
            propagation_days=None,
            crop_family='',
            nutrient_demand='',
            row_spacing_m=0.70,
            distance_within_row_m=0.45,
            expected_yield=Decimal('4.20'),
            harvest_method='',
            tkg=Decimal('3.20'),
            supplier_key='reinsaat',
            packaging_sizes=[{'size_value': 25, 'size_unit': 'seeds'}, {'size_value': 100, 'size_unit': 'seeds'}],
            germination_rate=85,
        ),
        CropSpec(
            key='tomate-moneymaker',
            name=crop_text['tomate'][0],
            variety='Moneymaker',
            color='#ef4444',
            cultivation_types=[],
            growth_days=None,
            harvest_days=65,
            propagation_days=None,
            crop_family='',
            nutrient_demand='',
            row_spacing_m=None,
            distance_within_row_m=0.55,
            expected_yield=Decimal('5.20'),
            harvest_method='',
            tkg=None,
            supplier_key='bingenheimer',
            packaging_sizes=[{'size_value': 20, 'size_unit': 'seeds'}, {'size_value': 100, 'size_unit': 'seeds'}],
            germination_rate=86,
        ),
        CropSpec(
            key='tomate-san-marzano',
            name=crop_text['tomate'][0],
            variety='San Marzano',
            color='#991b1b',
            cultivation_types=[],
            growth_days=84,
            harvest_days=50,
            propagation_days=None,
            crop_family='',
            nutrient_demand='',
            row_spacing_m=0.90,
            distance_within_row_m=0.60,
            expected_yield=Decimal('4.80'),
            harvest_method='',
            tkg=Decimal('3.40'),
            supplier_key='sativa',
            packaging_sizes=[{'size_value': 25, 'size_unit': 'seeds'}, {'size_value': 250, 'size_unit': 'seeds'}],
            germination_rate=84,
        ),
        CropSpec(
            key='karotte-art',
            name=crop_text['karotte'][0],
            variety='',
            color='#ea580c',
            cultivation_types=['direct_sowing'],
            growth_days=100,
            harvest_days=28,
            propagation_days=None,
            crop_family=crop_text['karotte'][2],
            nutrient_demand='medium',
            row_spacing_m=0.25,
            distance_within_row_m=0.04,
            expected_yield=Decimal('3.80'),
            harvest_method='per_sqm',
            sowing_depth_m=0.015,
            seed_rate_direct_value=0.7,
            seed_rate_direct_unit='g_per_m2',
            safety_direct=12,
            tkg=Decimal('1.20'),
            is_species=True,
        ),
        CropSpec(
            key='karotte',
            name=crop_text['karotte'][0],
            variety=crop_text['karotte'][1],
            color='#f97316',
            cultivation_types=[],
            growth_days=95,
            harvest_days=None,
            propagation_days=None,
            crop_family='',
            nutrient_demand='',
            row_spacing_m=None,
            distance_within_row_m=None,
            expected_yield=None,
            harvest_method='',
            tkg=None,
            supplier_key='bingenheimer',
            packaging_sizes=[{'size_value': 5, 'size_unit': 'g'}, {'size_value': 25, 'size_unit': 'g'}],
            germination_rate=82,
        ),
        CropSpec(
            key='karotte-rodelika',
            name=crop_text['karotte'][0],
            variety='Rodelika',
            color='#fb923c',
            cultivation_types=[],
            growth_days=110,
            harvest_days=35,
            propagation_days=None,
            crop_family='',
            nutrient_demand='',
            row_spacing_m=0.30,
            distance_within_row_m=0.06,
            expected_yield=Decimal('4.20'),
            harvest_method='',
            seed_rate_direct_value=0.8,
            seed_rate_direct_unit='g_per_m2',
            safety_direct=15,
            tkg=Decimal('1.35'),
            supplier_key='reinsaat',
            packaging_sizes=[{'size_value': 10, 'size_unit': 'g'}, {'size_value': 50, 'size_unit': 'g'}],
            germination_rate=80,
        ),
        CropSpec(
            key='salat-art',
            name=crop_text['salat'][0],
            variety='',
            color='#4d7c0f',
            cultivation_types=['pre_cultivation'],
            growth_days=44,
            harvest_days=10,
            propagation_days=24,
            crop_family=crop_text['salat'][2],
            nutrient_demand='medium',
            row_spacing_m=0.30,
            distance_within_row_m=0.30,
            expected_yield=Decimal('2.20'),
            harvest_method='per_sqm',
            sowing_depth_m=None,
            seed_rate_pre_value=1.2,
            seed_rate_pre_unit='seeds_per_plant',
            safety_pre=20,
            tkg=None,
            is_species=True,
        ),
        CropSpec(
            key='salat',
            name=crop_text['salat'][0],
            variety=crop_text['salat'][1],
            color='#65a30d',
            cultivation_types=[],
            growth_days=42,
            harvest_days=None,
            propagation_days=None,
            crop_family='',
            nutrient_demand='',
            row_spacing_m=None,
            distance_within_row_m=None,
            expected_yield=None,
            harvest_method='',
            tkg=Decimal('1.10'),
            supplier_key='sativa',
            packaging_sizes=[{'size_value': 250, 'size_unit': 'seeds'}, {'size_value': 1000, 'size_unit': 'seeds'}],
            germination_rate=88,
        ),
        CropSpec(
            key='salat-maikoenig',
            name=crop_text['salat'][0],
            variety='Maikönig' if language_code == 'de' else 'May King',
            color='#84cc16',
            cultivation_types=['direct_sowing'],
            growth_days=50,
            harvest_days=8,
            propagation_days=None,
            crop_family='',
            nutrient_demand='',
            row_spacing_m=0.25,
            distance_within_row_m=0.25,
            expected_yield=Decimal('1.80'),
            harvest_method='',
            seed_rate_direct_value=0.25,
            seed_rate_direct_unit='g_per_m2',
            safety_direct=15,
            tkg=None,
            supplier_key='bingenheimer',
            packaging_sizes=[{'size_value': 5, 'size_unit': 'g'}],
            germination_rate=84,
        ),
        CropSpec(
            key='gurke-art',
            name=crop_text['gurke'][0],
            variety='',
            color='#15803d',
            cultivation_types=['pre_cultivation', 'direct_sowing'],
            growth_days=58,
            harvest_days=45,
            propagation_days=28,
            crop_family=crop_text['gurke'][2],
            nutrient_demand='high',
            row_spacing_m=0.80,
            distance_within_row_m=0.40,
            expected_yield=Decimal('5.00'),
            harvest_method='per_plant',
            sowing_depth_m=0.02,
            seed_rate_pre_value=1.2,
            seed_rate_pre_unit='seeds_per_plant',
            seed_rate_direct_value=2.0,
            seed_rate_direct_unit='seeds_per_plant',
            safety_pre=20,
            safety_direct=10,
            tkg=Decimal('28.00'),
            is_species=True,
        ),
        CropSpec(
            key='gurke',
            name=crop_text['gurke'][0],
            variety='Arola',
            color='#16a34a',
            cultivation_types=['pre_cultivation'],
            growth_days=55,
            harvest_days=None,
            propagation_days=None,
            crop_family='',
            nutrient_demand='',
            row_spacing_m=None,
            distance_within_row_m=None,
            expected_yield=Decimal('5.60'),
            harvest_method='',
            tkg=Decimal('26.00'),
            supplier_key='bingenheimer',
            packaging_sizes=[{'size_value': 20, 'size_unit': 'seeds'}, {'size_value': 100, 'size_unit': 'seeds'}],
            germination_rate=86,
        ),
        CropSpec(
            key='mangold-art',
            name=crop_text['mangold'][0],
            variety='',
            color='#5b21b6',
            cultivation_types=['pre_cultivation', 'direct_sowing'],
            growth_days=60,
            harvest_days=75,
            propagation_days=32,
            crop_family=crop_text['mangold'][2],
            nutrient_demand='medium',
            row_spacing_m=0.35,
            distance_within_row_m=0.30,
            expected_yield=Decimal('16.00'),
            harvest_method='per_sqm',
            sowing_depth_m=0.02,
            seed_rate_pre_value=1.5,
            seed_rate_pre_unit='seeds_per_plant',
            seed_rate_direct_value=1.0,
            seed_rate_direct_unit='g_per_m2',
            safety_pre=18,
            safety_direct=12,
            tkg=Decimal('14.00'),
            is_species=True,
        ),
        CropSpec(
            key='mangold',
            name=crop_text['mangold'][0],
            variety=crop_text['mangold'][1],
            color='#7c3aed',
            cultivation_types=['pre_cultivation', 'direct_sowing'],
            growth_days=58,
            harvest_days=70,
            propagation_days=30,
            crop_family=crop_text['mangold'][2],
            nutrient_demand='medium',
            row_spacing_m=0.35,
            distance_within_row_m=0.30,
            expected_yield=Decimal('18.00'),
            harvest_method='per_sqm',
            seed_rate_pre_value=1.5,
            seed_rate_pre_unit='seeds_per_plant',
            seed_rate_direct_value=1.2,
            seed_rate_direct_unit='g_per_m2',
            safety_pre=18,
            safety_direct=10,
            tkg=Decimal('15.00'),
            supplier_key='sativa',
            packaging_sizes=[{'size_value': 5, 'size_unit': 'g'}, {'size_value': 25, 'size_unit': 'g'}],
            germination_rate=80,
        ),
        CropSpec(
            key='rote-bete-art',
            name=crop_text['rote-bete'][0],
            variety='',
            color='#9f1239',
            cultivation_types=['direct_sowing'],
            growth_days=90,
            harvest_days=40,
            propagation_days=None,
            crop_family=crop_text['rote-bete'][2],
            nutrient_demand='medium',
            row_spacing_m=0.30,
            distance_within_row_m=0.08,
            expected_yield=Decimal('28.00'),
            harvest_method='per_sqm',
            sowing_depth_m=0.02,
            seed_rate_direct_value=1.0,
            seed_rate_direct_unit='g_per_m2',
            safety_direct=12,
            tkg=Decimal('12.50'),
            is_species=True,
        ),
        CropSpec(
            key='rote-bete',
            name=crop_text['rote-bete'][0],
            variety=crop_text['rote-bete'][1],
            color='#be123c',
            cultivation_types=['direct_sowing'],
            growth_days=85,
            harvest_days=35,
            propagation_days=None,
            crop_family=crop_text['rote-bete'][2],
            nutrient_demand='medium',
            row_spacing_m=0.30,
            distance_within_row_m=0.08,
            expected_yield=Decimal('30.00'),
            harvest_method='per_sqm',
            seed_rate_direct_value=1.1,
            seed_rate_direct_unit='g_per_m2',
            safety_direct=10,
            tkg=Decimal('13.00'),
            supplier_key='reinsaat',
            packaging_sizes=[{'size_value': 10, 'size_unit': 'g'}, {'size_value': 50, 'size_unit': 'g'}],
            germination_rate=84,
        ),
        CropSpec(
            key='kohlrabi-art',
            name=crop_text['kohlrabi'][0],
            variety='',
            color='#1d4ed8',
            cultivation_types=['pre_cultivation'],
            growth_days=52,
            harvest_days=16,
            propagation_days=30,
            crop_family=crop_text['kohlrabi'][2],
            nutrient_demand='medium',
            row_spacing_m=0.30,
            distance_within_row_m=0.25,
            expected_yield=Decimal('22.00'),
            harvest_method='per_sqm',
            sowing_depth_m=0.01,
            seed_rate_pre_value=1.2,
            seed_rate_pre_unit='seeds_per_plant',
            safety_pre=18,
            tkg=Decimal('4.00'),
            is_species=True,
        ),
        CropSpec(
            key='kohlrabi',
            name=crop_text['kohlrabi'][0],
            variety=crop_text['kohlrabi'][1],
            color='#2563eb',
            cultivation_types=['pre_cultivation'],
            growth_days=48,
            harvest_days=14,
            propagation_days=28,
            crop_family=crop_text['kohlrabi'][2],
            nutrient_demand='medium',
            row_spacing_m=0.30,
            distance_within_row_m=0.25,
            expected_yield=Decimal('24.00'),
            harvest_method='per_sqm',
            seed_rate_pre_value=1.2,
            seed_rate_pre_unit='seeds_per_plant',
            safety_pre=18,
            tkg=Decimal('4.20'),
            supplier_key='bingenheimer',
            packaging_sizes=[{'size_value': 250, 'size_unit': 'seeds'}, {'size_value': 1000, 'size_unit': 'seeds'}],
            germination_rate=90,
        ),
        CropSpec(
            key='zucchini-art',
            name=crop_text['zucchini'][0],
            variety='',
            color='#115e59',
            cultivation_types=['pre_cultivation'],
            growth_days=48,
            harvest_days=75,
            propagation_days=26,
            crop_family=crop_text['zucchini'][2],
            nutrient_demand='high',
            row_spacing_m=1.20,
            distance_within_row_m=0.80,
            expected_yield=Decimal('40.00'),
            harvest_method='per_plant',
            sowing_depth_m=0.02,
            seed_rate_pre_value=1.2,
            seed_rate_pre_unit='seeds_per_plant',
            safety_pre=20,
            tkg=Decimal('115.00'),
            is_species=True,
        ),
        CropSpec(
            key='zucchini',
            name=crop_text['zucchini'][0],
            variety=crop_text['zucchini'][1],
            color='#0f766e',
            cultivation_types=['pre_cultivation'],
            growth_days=45,
            harvest_days=70,
            propagation_days=24,
            crop_family=crop_text['zucchini'][2],
            nutrient_demand='high',
            row_spacing_m=1.20,
            distance_within_row_m=0.80,
            expected_yield=Decimal('42.00'),
            harvest_method='per_plant',
            seed_rate_pre_value=1.2,
            seed_rate_pre_unit='seeds_per_plant',
            safety_pre=20,
            tkg=Decimal('120.00'),
            supplier_key='reinsaat',
            packaging_sizes=[{'size_value': 10, 'size_unit': 'seeds'}, {'size_value': 50, 'size_unit': 'seeds'}],
            germination_rate=88,
        ),
    ]

    crops: dict[str, Crop] = {}
    for spec in crop_specs:
        supplier = None if spec.is_species else suppliers[spec.supplier_key]
        crop = Crop.objects.create(
            name=spec.name,
            variety=spec.variety,
            crop_species=find_demo_crop_species(spec.name),
            crop_family=spec.crop_family,
            nutrient_demand=spec.nutrient_demand,
            cultivation_types=spec.cultivation_types,
            cultivation_type=spec.cultivation_types[0] if spec.cultivation_types else '',
            growth_duration_days=spec.growth_days,
            harvest_duration_days=spec.harvest_days,
            propagation_duration_days=spec.propagation_days,
            harvest_method=spec.harvest_method,
            expected_yield=spec.expected_yield,
            row_spacing_m=spec.row_spacing_m,
            distance_within_row_m=spec.distance_within_row_m,
            sowing_depth_m=spec.sowing_depth_m,
            seed_rate_value=None,
            seed_rate_unit=None,
            seed_rate_direct_value=spec.seed_rate_direct_value,
            seed_rate_direct_unit=spec.seed_rate_direct_unit,
            seed_rate_pre_cultivation_value=spec.seed_rate_pre_value,
            seed_rate_pre_cultivation_unit=spec.seed_rate_pre_unit,
            sowing_calculation_safety_percent=spec.safety_general,
            sowing_calculation_safety_percent_direct=spec.safety_direct,
            sowing_calculation_safety_percent_pre_cultivation=spec.safety_pre,
            thousand_kernel_weight_g=spec.tkg,
            seeding_requirement=spec.seeding_requirement,
            seeding_requirement_type=spec.seeding_requirement_type,
            supplier=supplier,
            selected_seed_demand_supplier=supplier,
            display_color=spec.color,
            project=project,
        )
        if supplier is not None:
            CropSupplierData.objects.create(
                crop=crop,
                supplier=supplier,
                supplier_name=supplier.name,
                packaging_sizes=spec.packaging_sizes or [],
                thousand_kernel_weight_g=spec.tkg,
                germination_rate=spec.germination_rate,
                project=project,
            )
            for package in spec.packaging_sizes or []:
                SeedPackage.objects.create(
                    crop=crop,
                    project=project,
                    size_value=Decimal(str(package['size_value'])),
                    size_unit=str(package['size_unit']),
                )
        crops[spec.key] = crop

    return crops


def _create_planting_plans(
    project: Project,
    crops: dict[str, Crop],
    beds: dict[str, Bed],
    owner: Any | None,
    *,
    language_code: str,
) -> None:
    plan_notes = DEMO_TEXT[language_code]['plan_notes']
    plan_specs = [
        # 2025 season (previous, already harvested) — gives the demo a second
        # season to switch between, next to the current one below.
        PlanSpec('salat', 'salat-1', 'pre_cultivation', date(2025, 2, 24), Decimal('8.5'), 95),
        PlanSpec('tomate', 'tomate-1', 'pre_cultivation', date(2025, 4, 28), Decimal('14.0'), 35),
        PlanSpec('karotte', 'karotte-1', 'direct_sowing', date(2025, 3, 18), Decimal('16.0')),
        PlanSpec('kohlrabi', 'kohlrabi', 'pre_cultivation', date(2025, 3, 30), Decimal('14.0'), 180),
        PlanSpec('zucchini', 'zucchini', 'pre_cultivation', date(2025, 5, 22), Decimal('18.0'), 18),
        # 2026 season (current)
        PlanSpec('salat', 'salat-1', 'pre_cultivation', date(2026, 2, 18), Decimal('8.5'), 95, plan_notes['salat_frueh']),
        PlanSpec('salat', 'salat-2', 'pre_cultivation', date(2026, 3, 22), Decimal('8.5'), 95),
        PlanSpec('mangold', 'kraeuter', 'pre_cultivation', date(2026, 4, 6), Decimal('7.5'), 72),
        PlanSpec('tomate', 'tomate-1', 'pre_cultivation', date(2026, 4, 25), Decimal('14.0'), 35, plan_notes['tomate']),
        PlanSpec('tomate', 'tomate-2', 'pre_cultivation', date(2026, 5, 2), Decimal('14.0'), 35),
        PlanSpec('gurke', 'gurke', 'pre_cultivation', date(2026, 5, 10), Decimal('12.0'), 38),
        PlanSpec('karotte', 'karotte-1', 'direct_sowing', date(2026, 3, 12), Decimal('16.0')),
        PlanSpec('karotte', 'karotte-2', 'direct_sowing', date(2026, 5, 18), Decimal('16.0')),
        PlanSpec('rote-bete', 'rote-bete', 'direct_sowing', date(2026, 4, 10), Decimal('15.0')),
        PlanSpec('kohlrabi', 'kohlrabi', 'pre_cultivation', date(2026, 3, 28), Decimal('14.0'), 180),
        PlanSpec('zucchini', 'zucchini', 'pre_cultivation', date(2026, 5, 18), Decimal('18.0'), 18),
        PlanSpec('salat', 'salat-1', 'pre_cultivation', date(2026, 8, 25), Decimal('8.5'), 95, plan_notes['salat_herbst']),
    ]

    for spec in plan_specs:
        season = get_or_create_season_for_date(
            project,
            spec.planting_date,
            created_by=owner if owner and getattr(owner, 'pk', None) else None,
        )
        PlantingPlan.objects.create(
            crop=crops[spec.crop_key],
            bed=beds[spec.bed_key],
            cultivation_type=spec.cultivation_type,
            planting_date=spec.planting_date,
            area_usage_sqm=spec.area_usage_sqm,
            quantity=spec.quantity,
            notes=spec.notes,
            created_by=owner if owner and getattr(owner, 'pk', None) else None,
            updated_by=owner if owner and getattr(owner, 'pk', None) else None,
            project=project,
            season=season,
        )
