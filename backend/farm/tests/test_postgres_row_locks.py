"""Row-lock regressions that only PostgreSQL can reproduce.

SQLite ignores `select_for_update()`, so these tests only prove something when
the suite runs with `TEST_DB_ENGINE=postgres` (the `backend-postgres-tests` CI
job runs every test marked `postgres`). PostgreSQL rejects `FOR UPDATE` on the
nullable side of an outer join, which `select_related()` on a nullable foreign
key produces unless the lock is limited with `of=('self',)`.
"""

from datetime import date

import pytest

from farm.models import CropTaskTemplate, Task
from farm.services.tasks import synchronize_plan_tasks
from farm.tests.test_task_generation import TaskTimingFixture

pytestmark = pytest.mark.postgres


class PlanTaskSynchronizationLockTest(TaskTimingFixture):
    def setUp(self) -> None:
        super().setUp()
        self.client.defaults['HTTP_X_SEASON_ID'] = str(self.season.pk)

    def test_updating_plan_dates_synchronizes_automatic_and_template_tasks(self) -> None:
        CropTaskTemplate.objects.create(
            project=self.project, crop=self.crop, title='Water',
            reference_event='planting', day_offset=-7,
        )
        plan = self.plan(cultivation_type='pre_cultivation')
        synchronize_plan_tasks(plan)

        response = self.client.patch(f'/api/planting-plans/{plan.pk}/', {
            'planting_date': '2026-06-01',
        }, format='json')

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            Task.objects.get(planting_plan=plan, origin='template').due_date, date(2026, 5, 25),
        )
        self.assertEqual(
            Task.objects.get(planting_plan=plan, source_key__endswith=':planting').due_date,
            date(2026, 6, 1),
        )

    def test_synchronizing_a_draft_plan_without_crop_succeeds(self) -> None:
        plan = self.plan(crop=None)

        synchronize_plan_tasks(plan)

        self.assertFalse(Task.objects.filter(planting_plan=plan, origin='automatic').exists())


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize('establish_link', [True, False])
def test_concurrent_general_library_imports_create_one_project_row(establish_link):
    """The project lock serializes identity checks even before a crop exists."""
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections, connection

    from crops.models import CropSpecies
    from farm.models import Crop, Project, PublicCrop
    from farm.services.public_crops import CropLinkConflictError, import_public_crop_into_project
    from farm.tests.api_base import User

    if connection.vendor != 'postgresql':
        pytest.skip('PostgreSQL row-lock regression')
    user = User.objects.create_user(username='concurrent-library-user')
    project = Project.objects.create(name='Concurrent library import', slug='concurrent-library')
    species = CropSpecies.objects.create(name='Concurrent synthetic Tomato')
    entry = PublicCrop.objects.create(name=species.name, crop_species=species, variety='',
                                     status='published', created_by=user)
    barrier = Barrier(2)

    def import_once():
        close_old_connections()
        try:
            local_project = Project.objects.get(pk=project.pk)
            public_crop = PublicCrop.objects.get(pk=entry.pk)
            barrier.wait(timeout=10)
            try:
                return import_public_crop_into_project(
                    public_crop=public_crop, project=local_project,
                    establish_link=establish_link, base_version=entry.version,
                )[0].pk
            except CropLinkConflictError:
                if establish_link:
                    raise
                return None
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(import_once) for _ in range(2)]
        ids = [future.result(timeout=30) for future in futures]
    if establish_link:
        assert ids[0] == ids[1]
    else:
        assert ids.count(None) == 1
    assert Crop.objects.filter(project=project, crop_species=species, variety='').count() == 1


@pytest.mark.django_db(transaction=True)
def test_direct_general_create_cannot_race_a_library_import():
    from concurrent.futures import ThreadPoolExecutor

    from django.db import close_old_connections, connection, transaction

    from crops.models import CropSpecies
    from farm.crops.serializers.crops import CropSerializer
    from farm.models import Crop, Project, PublicCrop
    from farm.services.crop_inheritance import GeneralCropIdentityConflict
    from farm.services.public_crops import import_public_crop_into_project
    from farm.tests.api_base import User

    if connection.vendor != 'postgresql':
        pytest.skip('PostgreSQL row-lock regression')
    user = User.objects.create_user(username='direct-import-race')
    project = Project.objects.create(name='Direct import race', slug='direct-import-race')
    species = CropSpecies.objects.create(name='Direct import race species')
    entry = PublicCrop.objects.create(name=species.name, crop_species=species,
                                     status='published', created_by=user)

    def direct_create():
        close_old_connections()
        try:
            with pytest.raises(GeneralCropIdentityConflict):
                CropSerializer().create({
                    'project': project, 'crop_species': species, 'name': 'Other label',
                })
        finally:
            close_old_connections()

    with transaction.atomic():
        Project.objects.select_for_update().get(pk=project.pk)
        with ThreadPoolExecutor(max_workers=1) as executor:
            executor.submit(direct_create).result(timeout=15)
        imported, _ = import_public_crop_into_project(public_crop=entry, project=project)
    assert Crop.objects.filter(project=project, crop_species=species).get().pk == imported.pk


@pytest.mark.django_db(transaction=True)
def test_companion_write_cannot_interleave_with_a_link_confirmation():
    from concurrent.futures import ThreadPoolExecutor

    from django.db import close_old_connections, connection, transaction
    from rest_framework.test import APIClient

    from farm.models import Crop, CropCompanion, Project, ProjectMembership
    from farm.tests.api_base import User

    if connection.vendor != 'postgresql':
        pytest.skip('PostgreSQL row-lock regression')
    user = User.objects.create_user(username='companion-link-race', is_active=True)
    project = Project.objects.create(name='Companion link race', slug='companion-link-race')
    ProjectMembership.objects.create(project=project, user=user, role='admin')
    crop = Crop.objects.create(project=project, name='Companion race tomato')
    neighbour = Crop.objects.create(project=project, name='Companion race cabbage')

    def change_companions():
        close_old_connections()
        try:
            client = APIClient()
            client.force_authenticate(user=user)
            return client.post('/api/crop-companions/', {
                'crop': crop.pk, 'companion_crop': neighbour.pk, 'kind': 'good',
            }, format='json', HTTP_X_PROJECT_ID=str(project.pk)).status_code
        finally:
            close_old_connections()

    with transaction.atomic():
        Project.objects.select_for_update().get(pk=project.pk)
        with ThreadPoolExecutor(max_workers=1) as executor:
            assert executor.submit(change_companions).result(timeout=15) == 409
    assert not CropCompanion.objects.filter(project=project).exists()


@pytest.mark.django_db(transaction=True)
def test_concurrent_one_time_copies_only_accept_one_preview_confirmation():
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections, connection

    from farm.models import Crop, Project, PublicCrop
    from farm.services.public_crops import (
        CropLinkConflictError,
        link_project_crop_to_public_reference,
    )
    from farm.tests.api_base import User

    if connection.vendor != 'postgresql':
        pytest.skip('PostgreSQL row-lock regression')
    user = User.objects.create_user(username='concurrent-library-copy')
    project = Project.objects.create(name='Concurrent copy', slug='concurrent-library-copy')
    crop = Crop.objects.create(project=project, name='Copy crop', growth_duration_days=90)
    entry = PublicCrop.objects.create(name=crop.name, status='published', created_by=user,
                                     growth_duration_days=110)
    expected = crop.updated_at.isoformat()
    barrier = Barrier(2)

    def copy_once():
        close_old_connections()
        try:
            local = Crop.objects.get(pk=crop.pk)
            public = PublicCrop.objects.get(pk=entry.pk)
            barrier.wait(timeout=10)
            try:
                link_project_crop_to_public_reference(
                    crop=local, public_crop=public, pull_fields=['growth_duration_days'],
                    base_version=entry.version, expected_updated_at=expected, establish_link=False,
                )
                return 'copied'
            except CropLinkConflictError:
                return 'stale'
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: copy_once(), range(2)))
    assert sorted(results) == ['copied', 'stale']
    crop.refresh_from_db()
    assert crop.growth_duration_days == 110
    assert crop.source_public_crop_id is None
    assert crop.derived_from_public_crop_id == entry.pk
    entry.refresh_from_db()
    assert entry.growth_duration_days == 110
    assert entry.version == 1
