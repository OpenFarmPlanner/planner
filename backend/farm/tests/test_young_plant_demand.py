from datetime import date
from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from farm.models import Bed, Crop, Field, Location, PlantingPlan, Project, ProjectMembership, Season
from farm.services.plant_count import (
    PLANT_COUNT_BLOCKER_MISSING_AREA,
    PLANT_COUNT_BLOCKER_MISSING_PLANT_SPACING,
    compute_plan_plant_count,
)
from farm.services.young_plant_demand import apply_reserve, parse_reserve_percent

User = get_user_model()

URL = '/openfarmplanner/api/young-plant-demand/'
PURCHASED = PlantingPlan.CULTIVATION_TYPE_PURCHASED_TRANSPLANT


@pytest.fixture
def project(db) -> Project:
    return Project.objects.create(name='Young Plant Project', slug='young-plant-project')


@pytest.fixture
def season(project: Project) -> Season:
    return Season.objects.create(
        project=project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
    )


@pytest.fixture
def api_client(project: Project, season: Season) -> APIClient:
    user = User.objects.create_user(
        username='ypuser', email='yp@example.com', password='testpass', is_active=True,
    )
    ProjectMembership.objects.create(user=user, project=project, role='admin')
    client = APIClient()
    client.force_authenticate(user=user)
    client.defaults['HTTP_X_PROJECT_ID'] = str(project.id)
    client.defaults['HTTP_X_SEASON_ID'] = str(season.id)
    return client


@pytest.fixture
def beds(project: Project) -> list[Bed]:
    location = Location.objects.create(name='Loc', project=project)
    field = Field.objects.create(name='Field', location=location, project=project)
    return [
        Bed.objects.create(name=f'Bed {index}', field=field, area_sqm=20, project=project)
        for index in range(3)
    ]


@pytest.fixture
def lettuce(project: Project) -> Crop:
    # 30 cm x 25 cm -> 13.33 plants per m²
    return Crop.objects.create(
        name='Lettuce', variety='Batavia', project=project,
        cultivation_types=['pre_cultivation'], row_spacing_m=0.30, distance_within_row_m=0.25,
    )


def _plan(
    crop: Crop, bed: Bed, season: Season, planting_date: date | None, area: float | None, **extra,
) -> PlantingPlan:
    return PlantingPlan.objects.create(
        crop=crop, bed=bed, season=season, project=bed.project,
        planting_date=planting_date, area_usage_sqm=area,
        cultivation_type=extra.pop('cultivation_type', PURCHASED), **extra,
    )


@pytest.mark.django_db
def test_groups_by_crop_and_planting_week_and_sums_counts(api_client, beds, season, lettuce):
    # Monday and Thursday of ISO week 15/2026 share a group; the next week does not.
    _plan(lettuce, beds[0], season, date(2026, 4, 6), 3)
    _plan(lettuce, beds[1], season, date(2026, 4, 9), 6)
    _plan(lettuce, beds[2], season, date(2026, 4, 13), 3)

    response = api_client.get(URL)

    assert response.status_code == 200
    rows = response.json()['results']
    assert len(rows) == 2
    first = rows[0]
    assert first['planting_week'] == {
        'iso_year': 2026, 'iso_week': 15, 'start_date': '2026-04-06', 'end_date': '2026-04-12',
    }
    assert first['crop_name'] == 'Lettuce'
    assert first['variety'] == 'Batavia'
    # round(3 * 13.33) + round(6 * 13.33) = 40 + 80
    assert first['plant_count'] == 120
    assert first['plant_count_with_reserve'] == 120
    assert first['plan_count'] == 2
    assert first['bed_count'] == 2
    assert [plan['plant_count'] for plan in first['plans']] == [40, 80]
    assert rows[1]['planting_week']['iso_week'] == 16


@pytest.mark.django_db
def test_only_lists_purchased_transplants_of_the_active_season(
    api_client, project, beds, season, lettuce,
):
    _plan(lettuce, beds[0], season, date(2026, 4, 6), 3, cultivation_type='pre_cultivation')
    _plan(lettuce, beds[0], season, date(2026, 4, 6), 3, cultivation_type='direct_sowing')
    other_season = Season.objects.create(
        project=project, start_date=date(2027, 1, 1), end_date=date(2027, 12, 31),
    )
    _plan(lettuce, beds[0], other_season, date(2027, 4, 6), 3)

    response = api_client.get(URL)

    assert response.json()['results'] == []


@pytest.mark.django_db
def test_reserve_rounds_up_to_whole_plants(api_client, beds, season, lettuce):
    _plan(lettuce, beds[0], season, date(2026, 4, 6), 3)

    response = api_client.get(URL, {'reserve_percent': '10'})

    row = response.json()['results'][0]
    assert row['plant_count'] == 40
    assert row['plant_count_with_reserve'] == 44
    assert row['reserve_percent'] == 10.0


@pytest.mark.django_db
def test_missing_spacing_keeps_the_entry_with_a_blocker(api_client, project, beds, season):
    crop = Crop.objects.create(
        name='Kohlrabi', project=project, cultivation_types=['pre_cultivation'],
    )
    _plan(crop, beds[0], season, date(2026, 4, 6), 3)

    row = api_client.get(URL).json()['results'][0]

    assert row['plant_count'] is None
    assert row['plant_count_with_reserve'] is None
    assert row['calculation_blockers'] == [PLANT_COUNT_BLOCKER_MISSING_PLANT_SPACING]
    assert row['plans'][0]['plant_count'] is None


@pytest.mark.django_db
def test_one_uncalculable_plan_invalidates_the_group_total(api_client, beds, season, lettuce):
    _plan(lettuce, beds[0], season, date(2026, 4, 6), 3)
    _plan(lettuce, beds[1], season, date(2026, 4, 7), None)

    row = api_client.get(URL).json()['results'][0]

    assert row['plant_count'] is None
    assert row['calculation_blockers'] == [PLANT_COUNT_BLOCKER_MISSING_AREA]
    assert [plan['plant_count'] for plan in row['plans']] == [40, None]


@pytest.mark.django_db
def test_plans_without_planting_date_are_listed_last(api_client, beds, season, lettuce):
    _plan(lettuce, beds[0], season, None, 3)
    _plan(lettuce, beds[1], season, date(2026, 4, 6), 3)

    rows = api_client.get(URL).json()['results']

    assert [row['planting_week'] is None for row in rows] == [False, True]


@pytest.mark.django_db
def test_seed_demand_skips_purchased_transplants(api_client, beds, season, project):
    crop = Crop.objects.create(
        name='Leek', project=project, cultivation_types=['pre_cultivation'],
        seed_rate_pre_cultivation_value=2, seed_rate_pre_cultivation_unit='seeds_per_plant',
    )
    _plan(crop, beds[0], season, date(2026, 4, 6), 3, quantity=10)

    response = api_client.get('/openfarmplanner/api/seed-demand/')

    assert response.json()['results'] == []


@pytest.mark.django_db
def test_plant_count_matches_the_planting_plan_column(api_client, beds, season, lettuce):
    plan = _plan(lettuce, beds[0], season, date(2026, 4, 6), 3)

    plans = api_client.get('/openfarmplanner/api/planting-plans/').json()['results']

    assert plans[0]['plants_count'] == compute_plan_plant_count(plan).count == 40


@pytest.mark.parametrize(
    ('raw', 'expected'),
    [(None, Decimal('0')), ('', Decimal('0')), ('abc', Decimal('0')), ('-5', Decimal('0')),
     ('7,5', Decimal('7.5')), ('250', Decimal('100')), ('nan', Decimal('0'))],
)
def test_parse_reserve_percent(raw, expected):
    assert parse_reserve_percent(raw) == expected


def test_apply_reserve_rounds_up():
    assert apply_reserve(100, Decimal('0')) == 100
    assert apply_reserve(101, Decimal('5')) == 107
    assert apply_reserve(0, Decimal('10')) == 0
