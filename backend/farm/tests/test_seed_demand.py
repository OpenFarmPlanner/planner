from datetime import date
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from crops.models import CropSpecies, CropSpeciesTranslation
from farm.models import Location, Field, Bed, Crop, CropSupplierData, PlantingPlan, Project, ProjectMembership, Supplier
from farm.seed_units import (
    SEED_PACKAGE_UNIT_GRAMS,
    SEED_PACKAGE_UNIT_SEEDS,
    SEED_RATE_UNIT_G_PER_LFM,
    SEED_RATE_UNIT_G_PER_M2,
    SEED_RATE_UNIT_SEEDS_PER_M2,
    SEED_RATE_UNIT_SEEDS_PER_PLANT,
)
from farm.services.seed_demand import (
    CALCULATION_BLOCKER_MISSING_AREA,
    CALCULATION_BLOCKER_MISSING_PLANT_QUANTITY,
    CALCULATION_BLOCKER_MISSING_ROW_SPACING,
    CALCULATION_BLOCKER_MISSING_SEED_RATE,
    CALCULATION_BLOCKER_UNSUPPORTED_SEED_RATE_UNIT,
    REQUIRED_AMOUNT_WARNING_MISSING_TKG,
    compute_plan_requirement,
    convert_requirement_to_unit,
    get_required_amount_in_unit,
    parse_selected_suppliers,
    select_safety_margin_percent,
    select_seed_rate,
    select_tkg,
)

User = get_user_model()


@pytest.fixture
def project_context(db):
    user = User.objects.create_user(username='sduser', email='sd@example.com', password='testpass', is_active=True)
    project = Project.objects.create(name='Seed Demand Project', slug='seed-demand-project')
    ProjectMembership.objects.create(user=user, project=project, role='admin')
    return user, project


@pytest.fixture
def api_client(project_context):
    user, project = project_context
    client = APIClient()
    client.force_authenticate(user=user)
    client.defaults['HTTP_X_PROJECT_ID'] = str(project.id)
    return client


@pytest.fixture
def bed(project_context):
    _, project = project_context
    location = Location.objects.create(name='Loc', project=project)
    field = Field.objects.create(name='Field', location=location, project=project)
    return Bed.objects.create(name='Bed', field=field, area_sqm=100, project=project)


def _create_plan(crop: Crop, bed: Bed, area: float, quantity: int | None = None, cultivation_type: str = 'direct_sowing'):
    return PlantingPlan.objects.create(
        crop=crop,
        bed=bed,
        planting_date=date(2025, 3, 1),
        area_usage_sqm=area,
        quantity=quantity,
        cultivation_type=cultivation_type,
        project=bed.project,
    )


def _create_supplier_data(
    crop: Crop,
    package_size: float,
    package_unit: str,
    thousand_kernel_weight_g: float | None = None,
    germination_rate: float | None = None,
) -> None:
    supplier = Supplier.objects.create(
        name=f'Supplier {crop.name}',
        homepage_url=f'https://{crop.name.lower()}.example',
        project=crop.project,
    )
    CropSupplierData.objects.create(
        crop=crop,
        supplier=supplier,
        project=crop.project,
        packaging_sizes=[{'size_value': package_size, 'size_unit': package_unit}],
        thousand_kernel_weight_g=thousand_kernel_weight_g,
        germination_rate=germination_rate,
    )


@pytest.mark.django_db
def test_seed_demand_applies_safety_margin(api_client: APIClient, bed: Bed):
    crop = Crop.objects.create(
        name='Carrot',
        growth_duration_days=90,
        harvest_duration_days=14,
        cultivation_types=['direct_sowing'],
        seed_rate_direct_value=10,
        seed_rate_direct_unit='g_per_m2',
        sowing_calculation_safety_percent_direct=10,
        project=bed.project,
    )
    _create_plan(crop, bed, 5)
    _create_plan(crop, bed, 5)
    _create_supplier_data(crop, 25, 'g')

    response = api_client.get('/openfarmplanner/api/seed-demand/')
    row = response.json()['results'][0]
    assert response.status_code == 200
    assert row['required_amount_value'] == pytest.approx(110.0)
    assert row['calculation_blockers'] == []
    assert row['package_blocker'] is None
    assert row['required_amount_unit'] == 'g'
    assert row['package_suggestion']['pack_count'] == 5


@pytest.mark.django_db
def test_seed_demand_localizes_linked_crop_species_name(api_client: APIClient, bed: Bed):
    species = CropSpecies.objects.create(name='Seed Demand Localized Species')
    CropSpeciesTranslation.objects.create(species=species, language_code='de', common_name='Ackerbohne')
    CropSpeciesTranslation.objects.create(species=species, language_code='en', common_name='Broad bean')
    crop = Crop.objects.create(
        name='Ackerbohne',
        variety='Hangdown',
        crop_species=species,
        growth_duration_days=90,
        harvest_duration_days=14,
        cultivation_types=['direct_sowing'],
        seed_rate_direct_value=10,
        seed_rate_direct_unit='g_per_m2',
        project=bed.project,
    )
    _create_plan(crop, bed, 5)
    _create_supplier_data(crop, 25, 'g')

    response = api_client.get('/openfarmplanner/api/seed-demand/', HTTP_ACCEPT_LANGUAGE='en')

    row = response.json()['results'][0]
    assert response.status_code == 200
    assert row['crop_id'] == crop.id
    assert row['crop_name'] == 'Ackerbohne'
    assert row['crop_display_name'] == 'Broad bean'
    assert row['crop_display_language_code'] == 'en'
    assert row['variety'] == 'Hangdown'


@pytest.mark.django_db
def test_seed_demand_applies_germination_rate(api_client: APIClient, bed: Bed):
    crop = Crop.objects.create(
        name='Radish',
        growth_duration_days=30,
        harvest_duration_days=14,
        cultivation_types=['direct_sowing'],
        seed_rate_direct_value=10,
        seed_rate_direct_unit='g_per_m2',
        project=bed.project,
    )
    _create_plan(crop, bed, 10)
    _create_supplier_data(crop, 25, 'g', germination_rate=80)

    response = api_client.get('/openfarmplanner/api/seed-demand/')
    row = response.json()['results'][0]
    assert response.status_code == 200
    # 10 m² * 10 g/m² = 100g raw, inflated by 100/80 germination rate = 125g.
    assert row['required_amount_value'] == pytest.approx(125.0)
    assert row['required_amount_unit'] == 'g'
    assert row['package_suggestion']['pack_count'] == 5


@pytest.mark.django_db
def test_seed_demand_ignores_missing_germination_rate(api_client: APIClient, bed: Bed):
    crop = Crop.objects.create(
        name='Lettuce',
        growth_duration_days=45,
        harvest_duration_days=14,
        cultivation_types=['direct_sowing'],
        seed_rate_direct_value=10,
        seed_rate_direct_unit='g_per_m2',
        project=bed.project,
    )
    _create_plan(crop, bed, 10)
    _create_supplier_data(crop, 25, 'g')

    response = api_client.get('/openfarmplanner/api/seed-demand/')
    row = response.json()['results'][0]
    assert response.status_code == 200
    assert row['required_amount_value'] == pytest.approx(100.0)


@pytest.mark.django_db
def test_seed_demand_supports_seed_per_m2_and_seed_packages(api_client: APIClient, bed: Bed):
    crop = Crop.objects.create(
        name='Beetroot',
        growth_duration_days=90,
        harvest_duration_days=14,
        cultivation_types=['direct_sowing'],
        seed_rate_direct_value=9,
        seed_rate_direct_unit='seeds_per_m2',
        project=bed.project,
    )
    _create_plan(crop, bed, 10)
    _create_supplier_data(crop, 50, 'seeds')

    response = api_client.get('/openfarmplanner/api/seed-demand/')
    assert response.status_code == 200

    row = next(item for item in response.json()['results'] if item['crop_name'] == 'Beetroot')
    assert row['required_amount_value'] is None
    assert row['required_amount_unit'] == 'g'
    assert row['required_amount_warning'] == 'missing_tkg'
    assert row['package_suggestion']['pack_count'] == 2


@pytest.mark.django_db
def test_seed_demand_converts_grams_to_seed_packages_with_tkg(api_client: APIClient, bed: Bed):
    crop = Crop.objects.create(
        name='Spinach',
        growth_duration_days=55,
        harvest_duration_days=14,
        cultivation_types=['direct_sowing'],
        seed_rate_direct_value=20,
        seed_rate_direct_unit='g_per_m2',
        thousand_kernel_weight_g=10,
        project=bed.project,
    )
    _create_plan(crop, bed, 5)
    _create_supplier_data(crop, 5000, 'seeds', thousand_kernel_weight_g=2)

    response = api_client.get('/openfarmplanner/api/seed-demand/')
    assert response.status_code == 200

    row = next(item for item in response.json()['results'] if item['crop_name'] == 'Spinach')
    assert row['required_amount_unit'] == 'g'
    assert row['required_amount_value'] == pytest.approx(100.0)
    assert row['package_suggestion']['pack_count'] == 10


@pytest.mark.django_db
def test_seed_demand_returns_warning_when_conversion_missing(api_client: APIClient, bed: Bed):
    crop = Crop.objects.create(
        name='Radish',
        growth_duration_days=35,
        harvest_duration_days=10,
        cultivation_types=['pre_cultivation'],
        seed_rate_pre_cultivation_value=2,
        seed_rate_pre_cultivation_unit='seeds_per_plant',
        project=bed.project,
    )
    _create_plan(crop, bed, 10, quantity=30, cultivation_type='pre_cultivation')
    _create_supplier_data(crop, 5, 'g')

    response = api_client.get('/openfarmplanner/api/seed-demand/')
    assert response.status_code == 200

    row = next(item for item in response.json()['results'] if item['crop_name'] == 'Radish')
    assert row['required_amount_value'] is None
    assert row['required_amount_unit'] == 'g'
    assert row['required_amount_warning'] == 'missing_tkg'
    assert row['package_suggestion'] is None
    assert row['warning'] == 'missing_tkg'


@pytest.mark.django_db
def test_seed_demand_uses_method_specific_seed_rates_for_mixed_cultivation(api_client: APIClient, bed: Bed):
    crop = Crop.objects.create(
        name='Mixed',
        growth_duration_days=80,
        harvest_duration_days=20,
        cultivation_types=['pre_cultivation', 'direct_sowing'],
        seed_rate_direct_value=4,
        seed_rate_direct_unit='g_per_m2',
        sowing_calculation_safety_percent_direct=0,
        seed_rate_pre_cultivation_value=2,
        seed_rate_pre_cultivation_unit='g_per_m2',
        sowing_calculation_safety_percent_pre_cultivation=50,
        project=bed.project,
    )
    _create_plan(crop, bed, 10, cultivation_type='direct_sowing')
    _create_plan(crop, bed, 10, cultivation_type='pre_cultivation')
    response = api_client.get('/openfarmplanner/api/seed-demand/')
    assert response.status_code == 200
    row = next(item for item in response.json()['results'] if item['crop_name'] == 'Mixed')
    # direct: 40g; transplant with 50% margin: 30g => total 70g
    assert row['required_amount_value'] == pytest.approx(70.0)


@pytest.mark.django_db
def test_seed_demand_ignores_inactive_method_rates(api_client: APIClient, bed: Bed):
    crop = Crop.objects.create(
        name='InactiveDirect',
        growth_duration_days=80,
        harvest_duration_days=20,
        cultivation_types=['pre_cultivation'],
        seed_rate_direct_value=3,
        seed_rate_direct_unit='g_per_m2',
        seed_rate_pre_cultivation_value=2,
        seed_rate_pre_cultivation_unit='g_per_m2',
        project=bed.project,
    )
    _create_plan(crop, bed, 10, cultivation_type='direct_sowing')
    response = api_client.get('/openfarmplanner/api/seed-demand/')
    assert response.status_code == 200
    row = next(item for item in response.json()['results'] if item['crop_name'] == 'InactiveDirect')
    assert row['warning'] == 'Missing seed rate value or unit.'


@pytest.mark.django_db
def test_seed_demand_reports_all_missing_inputs_for_one_plan(api_client: APIClient, bed: Bed):
    crop = Crop.objects.create(
        name='Incomplete lfm crop',
        cultivation_types=['direct_sowing'],
        seed_rate_direct_value=3,
        seed_rate_direct_unit='g_per_lfm',
        row_spacing_m=None,
        project=bed.project,
    )
    _create_plan(crop, bed, 0)
    _create_supplier_data(crop, 25, 'g')

    response = api_client.get('/openfarmplanner/api/seed-demand/')
    assert response.status_code == 200
    row = response.json()['results'][0]

    assert row['required_amount_value'] is None
    assert row['calculation_blockers'] == ['missing_area', 'missing_row_spacing']
    assert row['package_suggestion'] is None
    assert row['package_blocker'] == 'required_amount_unavailable'


@pytest.mark.django_db
def test_seed_demand_single_supplier_selection_does_not_write_on_get(api_client: APIClient, bed: Bed):
    crop = Crop.objects.create(
        name='NoWriteSelection',
        growth_duration_days=60,
        harvest_duration_days=10,
        cultivation_types=['direct_sowing'],
        seed_rate_direct_value=5,
        seed_rate_direct_unit='g_per_m2',
        project=bed.project,
    )
    _create_plan(crop, bed, 10)
    supplier = Supplier.objects.create(
        name='Single Supplier',
        homepage_url='https://single.example',
        project=bed.project,
    )
    CropSupplierData.objects.create(
        crop=crop,
        supplier=supplier,
        project=bed.project,
        packaging_sizes=[{'size_value': 25, 'size_unit': 'g'}],
    )

    response = api_client.get('/openfarmplanner/api/seed-demand/')
    assert response.status_code == 200

    row = next(item for item in response.json()['results'] if item['crop_name'] == 'NoWriteSelection')
    assert row['selected_supplier_id'] == supplier.id

    crop.refresh_from_db()
    assert crop.selected_seed_demand_supplier_id is None


@pytest.mark.django_db
def test_seed_rate_unit_legacy_value_is_normalized(api_client: APIClient, project_context):
    payload = {
        'name': 'Bean',
        'variety': 'Runner',
        'growth_duration_days': 70,
        'harvest_duration_days': 10,
        'harvest_method': 'per_plant',
        'seed_rate_value': 2,
        'seed_rate_unit': 'pcs_per_plant',
        'supplier_name': 'Test Supplier',
        'project': project_context[1].id,
    }

    response = api_client.post('/openfarmplanner/api/crops/', payload, format='json')
    assert response.status_code == 201
    assert response.json()['seed_rate_unit'] == 'seeds_per_plant'


# ---------------------------------------------------------------------------
# Unit tests for the pure helpers the API tests above exercise only indirectly.
# These need no database: Crop and CropSupplierData are built unsaved.
# ---------------------------------------------------------------------------


def test_parse_selected_suppliers_reads_pairs():
    assert parse_selected_suppliers('1:2,3:4') == {1: 2, 3: 4}


def test_parse_selected_suppliers_tolerates_surrounding_whitespace():
    # Note: the explicit `.strip()` calls are redundant — `int()` already
    # tolerates surrounding whitespace — so this passes with or without them.
    assert parse_selected_suppliers(' 1 : 2 , 3 : 4 ') == {1: 2, 3: 4}


@pytest.mark.parametrize('raw', [None, '', ','])
def test_parse_selected_suppliers_has_no_selection_for(raw):
    assert parse_selected_suppliers(raw) == {}


def test_parse_selected_suppliers_skips_malformed_items_but_keeps_the_rest():
    # The parameter comes straight off the query string, so one bad pair must
    # not discard a selection the user made for another crop.
    assert parse_selected_suppliers('1:2,nonsense,3:x,:5,7:8') == {1: 2, 7: 8}


@pytest.mark.parametrize('raw', ['0:2', '1:0', '-1:2', '1:-2'])
def test_parse_selected_suppliers_rejects_non_positive_ids(raw):
    # A zero or negative id cannot name a row; keeping it would send the
    # calculation looking for a supplier that does not exist.
    assert parse_selected_suppliers(raw) == {}


def test_parse_selected_suppliers_keeps_only_the_first_colon():
    # `split(':', 1)` means a stray second colon makes the supplier part
    # unparsable rather than silently truncating it to the first number.
    assert parse_selected_suppliers('1:2:3') == {}


def test_parse_selected_suppliers_last_pair_wins_for_a_repeated_crop():
    assert parse_selected_suppliers('1:2,1:5') == {1: 5}


def test_select_seed_rate_prefers_the_cultivation_specific_field():
    crop = Crop(
        cultivation_types=['direct_sowing'],
        seed_rate_direct_value=3,
        seed_rate_direct_unit=SEED_RATE_UNIT_G_PER_M2,
        seed_rate_value=99,
        seed_rate_unit=SEED_RATE_UNIT_SEEDS_PER_M2,
    )
    assert select_seed_rate(crop, 'direct_sowing') == (Decimal('3'), SEED_RATE_UNIT_G_PER_M2)


def test_select_seed_rate_falls_back_to_the_cultivation_map():
    crop = Crop(
        cultivation_types=['pre_cultivation'],
        seed_rate_by_cultivation={
            'pre_cultivation': {'value': '2.5', 'unit': SEED_RATE_UNIT_SEEDS_PER_PLANT},
        },
        seed_rate_value=99,
        seed_rate_unit=SEED_RATE_UNIT_G_PER_M2,
    )
    assert select_seed_rate(crop, 'pre_cultivation') == (
        Decimal('2.5'),
        SEED_RATE_UNIT_SEEDS_PER_PLANT,
    )


def test_select_seed_rate_ignores_a_cultivation_map_entry_without_a_unit():
    crop = Crop(
        cultivation_types=['pre_cultivation'],
        seed_rate_by_cultivation={'pre_cultivation': {'value': '2.5'}},
        seed_rate_value=7,
        seed_rate_unit=SEED_RATE_UNIT_G_PER_M2,
    )
    assert select_seed_rate(crop, 'pre_cultivation') == (Decimal('7'), SEED_RATE_UNIT_G_PER_M2)


def test_select_seed_rate_ignores_a_cultivation_map_entry_that_is_not_a_mapping():
    # `seed_rate_by_cultivation` is free-form JSON, so an entry can be a bare
    # value rather than the {value, unit} object. Reading it as one would raise
    # AttributeError in the middle of the seed-demand list request.
    crop = Crop(
        cultivation_types=['pre_cultivation'],
        seed_rate_by_cultivation={'pre_cultivation': '2.5'},
        seed_rate_value=7,
        seed_rate_unit=SEED_RATE_UNIT_G_PER_M2,
    )
    assert select_seed_rate(crop, 'pre_cultivation') == (Decimal('7'), SEED_RATE_UNIT_G_PER_M2)


def test_select_seed_rate_ignores_a_cultivation_map_that_is_not_a_mapping():
    crop = Crop(
        cultivation_types=['pre_cultivation'],
        seed_rate_by_cultivation=['pre_cultivation'],
        seed_rate_value=7,
        seed_rate_unit=SEED_RATE_UNIT_G_PER_M2,
    )
    assert select_seed_rate(crop, 'pre_cultivation') == (Decimal('7'), SEED_RATE_UNIT_G_PER_M2)


def test_select_seed_rate_falls_back_to_the_legacy_single_rate():
    crop = Crop(seed_rate_value=4, seed_rate_unit=SEED_RATE_UNIT_G_PER_LFM)
    assert select_seed_rate(crop, None) == (Decimal('4'), SEED_RATE_UNIT_G_PER_LFM)


def test_select_seed_rate_refuses_a_cultivation_type_the_crop_does_not_offer():
    # A plan can outlive a change to the crop's enabled cultivation types;
    # inventing a rate for the stale one would quietly order the wrong seed.
    crop = Crop(
        cultivation_types=['direct_sowing'],
        seed_rate_value=4,
        seed_rate_unit=SEED_RATE_UNIT_G_PER_M2,
    )
    assert select_seed_rate(crop, 'pre_cultivation') == (None, None)


def test_select_seed_rate_allows_any_cultivation_type_when_the_crop_lists_none():
    crop = Crop(cultivation_types=[], seed_rate_value=4, seed_rate_unit=SEED_RATE_UNIT_G_PER_M2)
    assert select_seed_rate(crop, 'pre_cultivation') == (Decimal('4'), SEED_RATE_UNIT_G_PER_M2)


def test_select_seed_rate_has_no_rate_without_a_unit():
    assert select_seed_rate(Crop(seed_rate_value=4, seed_rate_unit=''), None) == (None, None)


def test_select_safety_margin_prefers_the_cultivation_specific_percentage():
    crop = Crop(
        cultivation_types=['direct_sowing'],
        sowing_calculation_safety_percent_direct=15,
        sowing_calculation_safety_percent=5,
    )
    assert select_safety_margin_percent(crop, 'direct_sowing') == Decimal('15')


@pytest.mark.parametrize(
    ('cultivation_type', 'field_name'),
    [
        ('direct_sowing', 'sowing_calculation_safety_percent_direct'),
        ('pre_cultivation', 'sowing_calculation_safety_percent_pre_cultivation'),
    ],
)
def test_select_safety_margin_honours_an_explicit_zero_rather_than_falling_back(
    cultivation_type, field_name,
):
    # 0 is a deliberate "no margin for this method"; falling through to the
    # general percentage would silently order more seed than asked for. Both
    # methods are checked because each has its own `is not None` test.
    crop = Crop(
        cultivation_types=[cultivation_type],
        sowing_calculation_safety_percent=5,
        **{field_name: 0},
    )
    assert select_safety_margin_percent(crop, cultivation_type) == Decimal('0')


def test_select_safety_margin_falls_back_to_the_general_percentage():
    crop = Crop(sowing_calculation_safety_percent=5)
    assert select_safety_margin_percent(crop, 'direct_sowing') == Decimal('5')


def test_select_safety_margin_is_zero_for_a_cultivation_type_the_crop_does_not_offer():
    crop = Crop(cultivation_types=['direct_sowing'], sowing_calculation_safety_percent=5)
    assert select_safety_margin_percent(crop, 'pre_cultivation') == Decimal('0')


def test_select_safety_margin_is_zero_when_nothing_is_configured():
    assert select_safety_margin_percent(Crop(), None) == Decimal('0')


def test_convert_requirement_returns_the_value_unchanged_for_the_same_unit():
    value, warning = convert_requirement_to_unit(
        requirement_value=Decimal('10'),
        requirement_unit=SEED_PACKAGE_UNIT_GRAMS,
        target_unit=SEED_PACKAGE_UNIT_GRAMS,
        tkg=None,
    )
    assert (value, warning) == (Decimal('10'), None)


def test_convert_requirement_needs_no_tkg_when_no_conversion_happens():
    # The same-unit shortcut is checked before the TKG guard, so a crop with no
    # TKG still gets its requirement through unchanged.
    value, _ = convert_requirement_to_unit(
        requirement_value=Decimal('10'),
        requirement_unit=SEED_PACKAGE_UNIT_SEEDS,
        target_unit=SEED_PACKAGE_UNIT_SEEDS,
        tkg=None,
    )
    assert value == Decimal('10')


@pytest.mark.parametrize('tkg', [None, Decimal('0'), Decimal('-1')])
def test_convert_requirement_reports_a_missing_tkg(tkg):
    value, warning = convert_requirement_to_unit(
        requirement_value=Decimal('1000'),
        requirement_unit=SEED_PACKAGE_UNIT_SEEDS,
        target_unit=SEED_PACKAGE_UNIT_GRAMS,
        tkg=tkg,
    )
    assert value is None
    assert 'thousand-kernel weight' in warning


def test_convert_requirement_converts_seeds_to_grams_via_tkg():
    # 1000 seeds at 5 g per thousand kernels is 5 g.
    value, warning = convert_requirement_to_unit(
        requirement_value=Decimal('1000'),
        requirement_unit=SEED_PACKAGE_UNIT_SEEDS,
        target_unit=SEED_PACKAGE_UNIT_GRAMS,
        tkg=Decimal('5'),
    )
    assert warning is None
    assert value == Decimal('5')


def test_convert_requirement_converts_grams_to_seeds_via_tkg():
    value, warning = convert_requirement_to_unit(
        requirement_value=Decimal('5'),
        requirement_unit=SEED_PACKAGE_UNIT_GRAMS,
        target_unit=SEED_PACKAGE_UNIT_SEEDS,
        tkg=Decimal('5'),
    )
    assert warning is None
    assert value == Decimal('1000')


def test_convert_requirement_refuses_units_that_do_not_convert():
    # The explicit `are_units_convertible` guard is redundant against the
    # fallthrough: it only rejects pairs that neither direction branch handles,
    # and those reach the identical message at the end of the function anyway.
    # Kept here as the behaviour, not as proof the guard is load-bearing.
    value, warning = convert_requirement_to_unit(
        requirement_value=Decimal('5'),
        requirement_unit=SEED_PACKAGE_UNIT_GRAMS,
        target_unit='lfm',
        tkg=Decimal('5'),
    )
    assert value is None
    assert 'Cannot convert' in warning


def test_required_amount_returns_the_target_unit_total_when_nothing_needs_converting():
    total, warning = get_required_amount_in_unit(
        amounts_by_unit={SEED_PACKAGE_UNIT_GRAMS: Decimal('12')},
        target_unit=SEED_PACKAGE_UNIT_GRAMS,
        tkg=None,
    )
    assert (total, warning) == (Decimal('12'), None)


def test_required_amount_sums_across_units():
    total, warning = get_required_amount_in_unit(
        amounts_by_unit={
            SEED_PACKAGE_UNIT_GRAMS: Decimal('5'),
            SEED_PACKAGE_UNIT_SEEDS: Decimal('1000'),
        },
        target_unit=SEED_PACKAGE_UNIT_GRAMS,
        tkg=Decimal('5'),
    )
    assert warning is None
    assert total == Decimal('10')


def test_required_amount_skips_a_zero_amount_in_another_unit():
    # A zero contribution needs no conversion, so a missing TKG must not block
    # the total it cannot change.
    total, warning = get_required_amount_in_unit(
        amounts_by_unit={
            SEED_PACKAGE_UNIT_GRAMS: Decimal('5'),
            SEED_PACKAGE_UNIT_SEEDS: Decimal('0'),
        },
        target_unit=SEED_PACKAGE_UNIT_GRAMS,
        tkg=None,
    )
    assert (total, warning) == (Decimal('5'), None)


def test_required_amount_reports_the_stable_missing_tkg_code():
    # Between grams and seeds the caller gets the machine-readable code rather
    # than the English sentence, because the UI localizes this one.
    total, warning = get_required_amount_in_unit(
        amounts_by_unit={SEED_PACKAGE_UNIT_SEEDS: Decimal('1000')},
        target_unit=SEED_PACKAGE_UNIT_GRAMS,
        tkg=None,
    )
    assert total is None
    assert warning == REQUIRED_AMOUNT_WARNING_MISSING_TKG


def test_required_amount_passes_other_conversion_warnings_through():
    total, warning = get_required_amount_in_unit(
        amounts_by_unit={'lfm': Decimal('3')},
        target_unit=SEED_PACKAGE_UNIT_GRAMS,
        tkg=Decimal('5'),
    )
    assert total is None
    assert warning is not None
    assert warning != REQUIRED_AMOUNT_WARNING_MISSING_TKG


def test_select_tkg_prefers_the_selected_supplier():
    supplier_data = CropSupplierData(thousand_kernel_weight_g=8)
    assert select_tkg(Decimal('5'), supplier_data) == Decimal('8')


def test_select_tkg_falls_back_to_the_crop_without_a_supplier():
    assert select_tkg(Decimal('5'), None) == Decimal('5')


@pytest.mark.parametrize('supplier_tkg', [None, 0])
def test_select_tkg_falls_back_when_the_supplier_has_no_usable_value(supplier_tkg):
    supplier_data = CropSupplierData(thousand_kernel_weight_g=supplier_tkg)
    assert select_tkg(Decimal('5'), supplier_data) == Decimal('5')


def test_compute_plan_requirement_multiplies_area_by_an_m2_rate():
    crop = Crop(seed_rate_value=2, seed_rate_unit=SEED_RATE_UNIT_G_PER_M2)
    plan = PlantingPlan(crop=crop, area_usage_sqm=10)
    result = compute_plan_requirement(plan)
    assert (result.value, result.unit, result.blockers) == (
        Decimal('20'), SEED_PACKAGE_UNIT_GRAMS, (),
    )


def test_compute_plan_requirement_divides_area_by_row_spacing_for_an_lfm_rate():
    # 10 m2 at 0.5 m row spacing is 20 running metres, at 2 g each.
    crop = Crop(seed_rate_value=2, seed_rate_unit=SEED_RATE_UNIT_G_PER_LFM, row_spacing_m=0.5)
    plan = PlantingPlan(crop=crop, area_usage_sqm=10)
    result = compute_plan_requirement(plan)
    assert result.value == Decimal('40')
    assert result.unit == SEED_PACKAGE_UNIT_GRAMS


def test_compute_plan_requirement_blocks_an_lfm_rate_without_row_spacing():
    crop = Crop(seed_rate_value=2, seed_rate_unit=SEED_RATE_UNIT_G_PER_LFM)
    plan = PlantingPlan(crop=crop, area_usage_sqm=10)
    result = compute_plan_requirement(plan)
    assert result.value is None
    assert CALCULATION_BLOCKER_MISSING_ROW_SPACING in result.blockers
    assert 'row spacing' in result.warning


def test_compute_plan_requirement_reports_both_lfm_blockers_but_names_the_area_first():
    # The warning sentence follows the first blocker, so a plan missing both
    # gets told about the area rather than the row spacing.
    crop = Crop(seed_rate_value=2, seed_rate_unit=SEED_RATE_UNIT_G_PER_LFM)
    plan = PlantingPlan(crop=crop, area_usage_sqm=0)
    result = compute_plan_requirement(plan)
    assert result.blockers == (
        CALCULATION_BLOCKER_MISSING_AREA,
        CALCULATION_BLOCKER_MISSING_ROW_SPACING,
    )
    assert 'area usage' in result.warning


def test_compute_plan_requirement_multiplies_quantity_by_a_per_plant_rate():
    crop = Crop(seed_rate_value=3, seed_rate_unit=SEED_RATE_UNIT_SEEDS_PER_PLANT)
    plan = PlantingPlan(crop=crop, quantity=50)
    result = compute_plan_requirement(plan)
    assert (result.value, result.unit) == (Decimal('150'), SEED_PACKAGE_UNIT_SEEDS)


def test_compute_plan_requirement_blocks_a_per_plant_rate_without_a_quantity():
    crop = Crop(seed_rate_value=3, seed_rate_unit=SEED_RATE_UNIT_SEEDS_PER_PLANT)
    plan = PlantingPlan(crop=crop, quantity=0)
    result = compute_plan_requirement(plan)
    assert result.blockers == (CALCULATION_BLOCKER_MISSING_PLANT_QUANTITY,)


@pytest.mark.parametrize('rate', [None, 0, -1])
def test_compute_plan_requirement_blocks_a_missing_or_non_positive_rate(rate):
    crop = Crop(seed_rate_value=rate, seed_rate_unit=SEED_RATE_UNIT_G_PER_M2)
    plan = PlantingPlan(crop=crop, area_usage_sqm=10)
    result = compute_plan_requirement(plan)
    assert result.blockers == (CALCULATION_BLOCKER_MISSING_SEED_RATE,)


def test_compute_plan_requirement_blocks_a_unit_it_does_not_understand():
    crop = Crop(seed_rate_value=2, seed_rate_unit='g_per_hectare')
    plan = PlantingPlan(crop=crop, area_usage_sqm=10)
    result = compute_plan_requirement(plan)
    assert result.blockers == (CALCULATION_BLOCKER_UNSUPPORTED_SEED_RATE_UNIT,)
