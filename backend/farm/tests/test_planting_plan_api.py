from datetime import date, timedelta

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from crops.models import CropSpecies, CropSpeciesTranslation
from farm.models import (
    Bed,
    Crop,
    Field,
    Location,
    PlantingPlan,
    Project,
    ProjectMembership,
    Season,
)
from farm.services.demo_project import DEMO_PROJECT_DESCRIPTION

User = get_user_model()


@pytest.mark.django_db
def test_planting_plan_list_includes_crop_propagation_metadata():
    user = User.objects.create_user(
        username='calendar-user',
        email='calendar@example.com',
        password='testpass',
        is_active=True,
    )
    project = Project.objects.create(name='Calendar Project', slug='calendar-project')
    ProjectMembership.objects.create(user=user, project=project, role='admin')

    location = Location.objects.create(name='Hof', project=project)
    field = Field.objects.create(name='Nordfeld', location=location, project=project)
    bed = Bed.objects.create(name='Beet A', field=field, project=project)
    crop = Crop.objects.create(
        name='Salat',
        variety='Bijella',
        propagation_duration_days=25,
        cultivation_type='pre_cultivation',
        cultivation_types=['pre_cultivation', 'direct_sowing'],
        display_color='#00aa44',
        growth_duration_days=50,
        harvest_duration_days=7,
        project=project,
    )
    PlantingPlan.objects.create(
        crop=crop,
        bed=bed,
        planting_date=date(2026, 5, 10),
        project=project,
    )

    client = APIClient()
    client.force_authenticate(user=user)
    client.defaults['HTTP_X_PROJECT_ID'] = str(project.id)

    response = client.get('/openfarmplanner/api/planting-plans/')

    assert response.status_code == 200
    row = response.json()['results'][0]
    assert row['crop_name'] == 'Salat'
    assert row['crop_display_name'] == 'Salat'
    assert row['crop_display_language_code'] == ''
    assert row['crop_variety'] == 'Bijella'
    assert row['crop_display_color'] == '#00aa44'
    assert row['crop_propagation_duration_days'] == 25
    assert row['crop_cultivation_type'] == 'pre_cultivation'
    assert row['crop_cultivation_types'] == ['pre_cultivation', 'direct_sowing']


@pytest.mark.django_db
def test_planting_plan_list_localizes_linked_crop_species_name():
    user = User.objects.create_user(
        username='localized-plan-user',
        email='localized-plan@example.com',
        password='testpass',
        is_active=True,
    )
    project = Project.objects.create(name='Localized Project', slug='localized-project')
    ProjectMembership.objects.create(user=user, project=project, role='admin')

    species = CropSpecies.objects.get(name_normalized='karotte')
    CropSpeciesTranslation.objects.update_or_create(
        species=species,
        language_code='de',
        defaults={'common_name': 'Karotte'},
    )
    CropSpeciesTranslation.objects.update_or_create(
        species=species,
        language_code='en',
        defaults={'common_name': 'Carrot'},
    )
    location = Location.objects.create(name='Hof', project=project)
    field = Field.objects.create(name='Nordfeld', location=location, project=project)
    bed = Bed.objects.create(name='Beet A', field=field, project=project)
    crop = Crop.objects.create(
        name='Karotte',
        variety='Nantaise 2',
        crop_species=species,
        project=project,
    )
    PlantingPlan.objects.create(
        crop=crop,
        bed=bed,
        planting_date=date(2026, 3, 12),
        project=project,
    )

    client = APIClient()
    client.force_authenticate(user=user)
    client.defaults['HTTP_X_PROJECT_ID'] = str(project.id)

    response = client.get('/openfarmplanner/api/planting-plans/', HTTP_ACCEPT_LANGUAGE='en')

    assert response.status_code == 200
    row = response.json()['results'][0]
    assert row['crop_name'] == 'Karotte'
    assert row['crop_display_name'] == 'Carrot'
    assert row['crop_display_language_code'] == 'en'
    assert row['crop_variety'] == 'Nantaise 2'


@pytest.mark.django_db
def test_planting_plan_list_localizes_legacy_demo_crop_names():
    user = User.objects.create_user(
        username='legacy-demo-plan-user',
        email='legacy-demo-plan@example.com',
        password='testpass',
        is_active=True,
    )
    project = Project.objects.create(
        name='Legacy Demo Project',
        slug='legacy-demo-project',
        description=DEMO_PROJECT_DESCRIPTION,
    )
    ProjectMembership.objects.create(user=user, project=project, role='admin')

    species = CropSpecies.objects.get(name='Rote Rübe')
    CropSpeciesTranslation.objects.update_or_create(
        species=species,
        language_code='en',
        defaults={'common_name': 'Beetroot'},
    )
    location = Location.objects.create(name='Hof', project=project)
    field = Field.objects.create(name='Nordfeld', location=location, project=project)
    bed = Bed.objects.create(name='Beet A', field=field, project=project)
    crop = Crop.objects.create(name='Rote Bete', variety='Robuschka', project=project)
    PlantingPlan.objects.create(
        crop=crop,
        bed=bed,
        planting_date=date(2026, 3, 12),
        project=project,
    )

    client = APIClient()
    client.force_authenticate(user=user)
    client.defaults['HTTP_X_PROJECT_ID'] = str(project.id)

    response = client.get('/openfarmplanner/api/planting-plans/', HTTP_ACCEPT_LANGUAGE='en')

    assert response.status_code == 200
    row = response.json()['results'][0]
    assert row['crop_name'] == 'Rote Bete'
    assert row['crop_display_name'] == 'Beetroot'
    assert row['crop_display_language_code'] == 'en'


@pytest.mark.django_db
def test_planting_plan_list_serializes_uncomputable_harvest_dates_as_null():
    user = User.objects.create_user(
        username='harvest-date-user',
        email='harvest-date@example.com',
        password='testpass',
        is_active=True,
    )
    project = Project.objects.create(name='Harvest Date Project', slug='harvest-date-project')
    ProjectMembership.objects.create(user=user, project=project, role='admin')

    location = Location.objects.create(name='Hof', project=project)
    field = Field.objects.create(name='Nordfeld', location=location, project=project)
    bed = Bed.objects.create(name='Beet A', field=field, project=project)
    planting_date = date(2026, 4, 1)
    complete_crop = Crop.objects.create(
        name='Complete',
        growth_duration_days=30,
        harvest_duration_days=7,
        project=project,
    )
    missing_crop = Crop.objects.create(name='Missing', project=project)
    partial_crop = Crop.objects.create(
        name='Partial',
        growth_duration_days=20,
        project=project,
    )
    complete_plan = PlantingPlan.objects.create(
        crop=complete_crop,
        bed=bed,
        planting_date=planting_date,
        project=project,
    )
    missing_plan = PlantingPlan.objects.create(
        crop=missing_crop,
        bed=bed,
        planting_date=planting_date,
        project=project,
    )
    partial_plan = PlantingPlan.objects.create(
        crop=partial_crop,
        bed=bed,
        planting_date=planting_date,
        project=project,
    )

    PlantingPlan.objects.filter(pk=missing_plan.pk).update(
        harvest_date=planting_date,
        harvest_end_date=planting_date,
    )
    PlantingPlan.objects.filter(pk=partial_plan.pk).update(
        harvest_end_date=planting_date + timedelta(days=20),
    )

    client = APIClient()
    client.force_authenticate(user=user)
    client.defaults['HTTP_X_PROJECT_ID'] = str(project.id)

    response = client.get('/openfarmplanner/api/planting-plans/')

    assert response.status_code == 200
    rows_by_id = {row['id']: row for row in response.json()['results']}
    assert rows_by_id[complete_plan.id]['harvest_date'] == '2026-05-01'
    assert rows_by_id[complete_plan.id]['harvest_end_date'] == '2026-05-08'
    assert rows_by_id[missing_plan.id]['harvest_date'] is None
    assert rows_by_id[missing_plan.id]['harvest_end_date'] is None
    assert rows_by_id[partial_plan.id]['harvest_date'] == '2026-04-21'
    assert rows_by_id[partial_plan.id]['harvest_end_date'] is None


@pytest.mark.django_db
def test_planting_plan_can_be_saved_as_draft_with_only_crop():
    """A planting plan can be created with just a crop selected — the user
    should be able to leave bed/planting_date/cultivation_type for later
    without losing what they've already entered. Downstream endpoints
    (calendar, seed demand, yield calendar) must tolerate such a record."""
    user = User.objects.create_user(
        username='draft-user',
        email='draft@example.com',
        password='testpass',
        is_active=True,
    )
    project = Project.objects.create(name='Draft Project', slug='draft-project')
    ProjectMembership.objects.create(user=user, project=project, role='admin')

    crop = Crop.objects.create(
        name='Mais',
        variety='Rot',
        propagation_duration_days=21,
        cultivation_type='direct_sowing',
        cultivation_types=['direct_sowing'],
        project=project,
    )

    season = Season.objects.create(
        project=project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
    )

    client = APIClient()
    client.force_authenticate(user=user)
    client.defaults['HTTP_X_PROJECT_ID'] = str(project.id)
    client.defaults['HTTP_X_SEASON_ID'] = str(season.id)

    create_response = client.post(
        '/openfarmplanner/api/planting-plans/',
        data={'crop': crop.id},
    )
    assert create_response.status_code == 201, create_response.content
    body = create_response.json()
    assert body['bed'] is None
    assert body['bed_name'] is None
    assert body['planting_date'] is None
    assert body['cultivation_type'] == ''

    plan = PlantingPlan.objects.get(pk=body['id'])
    assert plan.cultivation_type == ''
    assert str(plan) == 'Mais in – - –'

    seed_demand_response = client.get('/openfarmplanner/api/seed-demand/')
    assert seed_demand_response.status_code == 200

    yield_calendar_response = client.get('/openfarmplanner/api/yield-calendar/')
    assert yield_calendar_response.status_code == 200

    list_response = client.get('/openfarmplanner/api/planting-plans/')
    assert list_response.status_code == 200
    assert list_response.json()['results'][0]['id'] == plan.id


@pytest.mark.django_db
def test_planting_plan_can_be_saved_as_draft_with_only_bed():
    """The reverse of the crop-only draft: a bed can be chosen before a
    crop, and the record must still serialize/str() without crashing on
    the now-absent crop."""
    user = User.objects.create_user(
        username='draft-bed-user',
        email='draft-bed@example.com',
        password='testpass',
        is_active=True,
    )
    project = Project.objects.create(name='Draft Bed Project', slug='draft-bed-project')
    ProjectMembership.objects.create(user=user, project=project, role='admin')

    location = Location.objects.create(name='Hof', project=project)
    field = Field.objects.create(name='Nordfeld', location=location, project=project)
    bed = Bed.objects.create(name='Beet A', field=field, project=project)
    season = Season.objects.create(
        project=project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
    )

    client = APIClient()
    client.force_authenticate(user=user)
    client.defaults['HTTP_X_PROJECT_ID'] = str(project.id)
    client.defaults['HTTP_X_SEASON_ID'] = str(season.id)

    create_response = client.post(
        '/openfarmplanner/api/planting-plans/',
        data={'bed': bed.id},
    )
    assert create_response.status_code == 201, create_response.content
    body = create_response.json()
    assert body['crop'] is None
    assert body['crop_name'] is None
    assert body['bed'] == bed.id

    plan = PlantingPlan.objects.get(pk=body['id'])
    assert str(plan) == '– in Beet A - –'

    seed_demand_response = client.get('/openfarmplanner/api/seed-demand/')
    assert seed_demand_response.status_code == 200

    yield_calendar_response = client.get('/openfarmplanner/api/yield-calendar/')
    assert yield_calendar_response.status_code == 200


@pytest.mark.django_db
def test_planting_plan_without_crop_or_bed_is_rejected():
    """The backend keeps a minimal integrity floor even though the frontend
    also blocks this: at least one of crop/bed is required."""
    user = User.objects.create_user(
        username='draft-empty-user',
        email='draft-empty@example.com',
        password='testpass',
        is_active=True,
    )
    project = Project.objects.create(name='Draft Empty Project', slug='draft-empty-project')
    ProjectMembership.objects.create(user=user, project=project, role='admin')

    client = APIClient()
    client.force_authenticate(user=user)
    client.defaults['HTTP_X_PROJECT_ID'] = str(project.id)

    create_response = client.post('/openfarmplanner/api/planting-plans/', data={})
    assert create_response.status_code == 400, create_response.content


def _season_boundary_fixture(slug: str) -> tuple[APIClient, Project, Crop, Season]:
    """A project with a non-calendar-aligned season and one crop."""
    user = User.objects.create_user(
        username=f'{slug}-user',
        email=f'{slug}@example.com',
        password='testpass',
        is_active=True,
    )
    project = Project.objects.create(name=f'{slug} Project', slug=f'{slug}-project')
    ProjectMembership.objects.create(user=user, project=project, role='admin')
    crop = Crop.objects.create(name='Mais', variety='', project=project)
    season = Season.objects.create(
        project=project,
        start_date=date(2025, 9, 1),
        end_date=date(2026, 8, 31),
    )
    client = APIClient()
    client.force_authenticate(user=user)
    client.defaults['HTTP_X_PROJECT_ID'] = str(project.id)
    client.defaults['HTTP_X_SEASON_ID'] = str(season.id)
    return client, project, crop, season


@pytest.mark.django_db
def test_planting_plan_create_rejects_planting_date_outside_active_season():
    client, _project, crop, _season = _season_boundary_fixture('season-create-oob')

    response = client.post(
        '/openfarmplanner/api/planting-plans/',
        data={'crop': crop.id, 'planting_date': '2025-03-15'},
    )

    assert response.status_code == 400, response.content
    assert 'Pflanztermin muss innerhalb der Saison liegen' in str(response.content)
    assert '01.09.2025' in response.json()['planting_date'][0]


@pytest.mark.django_db
def test_planting_plan_create_accepts_planting_date_inside_active_season():
    client, _project, crop, season = _season_boundary_fixture('season-create-ok')

    response = client.post(
        '/openfarmplanner/api/planting-plans/',
        data={'crop': crop.id, 'planting_date': '2025-10-01'},
    )

    assert response.status_code == 201, response.content
    plan = PlantingPlan.objects.get(pk=response.json()['id'])
    assert plan.season_id == season.id


@pytest.mark.django_db
def test_planting_plan_update_rejects_moving_planting_date_outside_season():
    client, project, crop, season = _season_boundary_fixture('season-update-oob')
    plan = PlantingPlan.objects.create(
        crop=crop, project=project, season=season, planting_date=date(2025, 10, 1),
    )

    response = client.patch(
        f'/openfarmplanner/api/planting-plans/{plan.id}/',
        data={'planting_date': '2026-11-01'},
    )

    assert response.status_code == 400, response.content
    plan.refresh_from_db()
    assert plan.planting_date == date(2025, 10, 1)


def _inheritance_fixture(slug: str) -> tuple[APIClient, Project, Crop, Bed]:
    """A project with a general Kultur, a Sorte that overrides nothing, and a bed."""
    user = User.objects.create_user(
        username=f'{slug}-user',
        email=f'{slug}@example.com',
        password='testpass',
        is_active=True,
    )
    project = Project.objects.create(name=f'{slug} Project', slug=f'{slug}-project')
    ProjectMembership.objects.create(user=user, project=project, role='admin')

    location = Location.objects.create(name='Hof', project=project)
    field = Field.objects.create(name='Nordfeld', location=location, project=project)
    bed = Bed.objects.create(name='Beet A', field=field, project=project)

    species = CropSpecies.objects.create(name=f'Species {slug}')
    Crop.objects.create(
        name='Karotte',
        variety='',
        crop_species=species,
        growth_duration_days=70,
        harvest_duration_days=21,
        propagation_duration_days=14,
        row_spacing_m=0.25,
        distance_within_row_m=0.05,
        cultivation_type='pre_cultivation',
        cultivation_types=['pre_cultivation'],
        project=project,
    )
    sorte = Crop.objects.create(
        name='Karotte',
        variety='Nantaise',
        crop_species=species,
        project=project,
    )

    client = APIClient()
    client.force_authenticate(user=user)
    client.defaults['HTTP_X_PROJECT_ID'] = str(project.id)
    return client, project, sorte, bed


@pytest.mark.django_db
def test_plan_for_a_sorte_uses_the_general_kultur_timing():
    """A Sorte with no own durations still gets computed harvest dates."""
    client, project, sorte, bed = _inheritance_fixture('inherit-timing')

    plan = PlantingPlan.objects.create(
        crop=sorte, bed=bed, planting_date=date(2026, 4, 1), project=project,
    )

    assert plan.harvest_date == date(2026, 4, 1) + timedelta(days=70)
    assert plan.harvest_end_date == plan.harvest_date + timedelta(days=21)


@pytest.mark.django_db
def test_plan_list_serves_inherited_timing_and_cultivation_metadata():
    client, project, sorte, bed = _inheritance_fixture('inherit-serializer')
    PlantingPlan.objects.create(
        crop=sorte, bed=bed, planting_date=date(2026, 4, 1),
        area_usage_sqm=10, project=project,
    )

    response = client.get('/openfarmplanner/api/planting-plans/')
    assert response.status_code == 200, response.content
    row = response.json()['results'][0]

    assert row['harvest_date'] == '2026-06-10'
    assert row['harvest_end_date'] == '2026-07-01'
    assert row['crop_propagation_duration_days'] == 14
    assert row['crop_cultivation_type'] == 'pre_cultivation'
    assert row['crop_cultivation_types'] == ['pre_cultivation']
    # 25 cm row spacing x 5 cm within the row -> 10000/125 = 80 plants/m², over 10 m².
    assert row['plants_count'] == 800


@pytest.mark.django_db
def test_plan_list_derives_missing_stored_harvest_dates_from_inherited_timing():
    client, project, sorte, bed = _inheritance_fixture('inherit-derived-snapshot')
    plan = PlantingPlan.objects.create(
        crop=sorte,
        bed=bed,
        planting_date=date(2026, 4, 1),
        project=project,
    )
    PlantingPlan.objects.filter(pk=plan.pk).update(harvest_date=None, harvest_end_date=None)

    response = client.get('/openfarmplanner/api/planting-plans/')

    assert response.status_code == 200, response.content
    row = response.json()['results'][0]
    assert row['harvest_date'] == '2026-06-10'
    assert row['harvest_end_date'] == '2026-07-01'


@pytest.mark.django_db
def test_plan_list_keeps_harvest_dates_null_when_effective_timing_is_missing():
    client, project, sorte, bed = _inheritance_fixture('inherit-missing-effective')
    general = Crop.objects.get(project=project, crop_species=sorte.crop_species, variety='')
    general.harvest_duration_days = None
    general.save(update_fields=['harvest_duration_days'])
    plan = PlantingPlan.objects.create(
        crop=sorte,
        bed=bed,
        planting_date=date(2026, 4, 1),
        project=project,
    )
    PlantingPlan.objects.filter(pk=plan.pk).update(harvest_end_date=date(2026, 7, 1))

    response = client.get('/openfarmplanner/api/planting-plans/')

    assert response.status_code == 200, response.content
    row = response.json()['results'][0]
    assert row['harvest_date'] == '2026-06-10'
    assert row['harvest_end_date'] is None


@pytest.mark.django_db
def test_plan_list_preserves_stored_harvest_dates_over_derived_values():
    client, project, sorte, bed = _inheritance_fixture('inherit-stored-wins')
    plan = PlantingPlan.objects.create(
        crop=sorte,
        bed=bed,
        planting_date=date(2026, 4, 1),
        project=project,
    )
    PlantingPlan.objects.filter(pk=plan.pk).update(
        harvest_date=date(2026, 6, 15),
        harvest_end_date=date(2026, 7, 10),
    )

    response = client.get('/openfarmplanner/api/planting-plans/')

    assert response.status_code == 200, response.content
    row = response.json()['results'][0]
    assert row['harvest_date'] == '2026-06-15'
    assert row['harvest_end_date'] == '2026-07-10'


@pytest.mark.django_db
def test_an_own_sorte_value_still_wins_over_the_general_kultur():
    client, project, sorte, bed = _inheritance_fixture('inherit-override')
    sorte.harvest_duration_days = 3
    sorte.save(update_fields=['harvest_duration_days'])

    plan = PlantingPlan.objects.create(
        crop=sorte, bed=bed, planting_date=date(2026, 4, 1), project=project,
    )

    assert plan.harvest_end_date == plan.harvest_date + timedelta(days=3)


@pytest.mark.django_db
def test_stored_harvest_dates_stay_a_snapshot_until_the_plan_is_saved_again():
    """Making a value resolvable must not silently rewrite existing plans."""
    client, project, sorte, bed = _inheritance_fixture('inherit-snapshot')
    free_text = Crop.objects.create(
        name='Freitext', variety='Sorte', project=project,
    )
    plan = PlantingPlan.objects.create(
        crop=free_text, bed=bed, planting_date=date(2026, 4, 1), project=project,
    )
    assert plan.harvest_date is None

    plan.crop = sorte
    plan.save()
    plan.refresh_from_db()
    assert plan.harvest_date == date(2026, 4, 1) + timedelta(days=70)
