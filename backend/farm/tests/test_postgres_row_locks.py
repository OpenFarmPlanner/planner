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


@pytest.mark.django_db(transaction=True)
def test_concurrent_first_season_requests_create_one_period_and_its_pattern():
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections, connection
    from rest_framework.test import APIClient

    from farm.models import Project, ProjectMembership, Season, SeasonPattern
    from farm.tests.api_base import User

    if connection.vendor != 'postgresql':
        pytest.skip('PostgreSQL row-lock regression')
    user = User.objects.create_user(username='concurrent-first-season')
    project = Project.objects.create(name='Concurrent first season', slug='concurrent-first-season')
    ProjectMembership.objects.create(project=project, user=user, role='admin')
    barrier = Barrier(2)

    def create_season(year, month):
        close_old_connections()
        try:
            client = APIClient()
            client.force_authenticate(user)
            barrier.wait(timeout=10)
            return client.post(
                '/openfarmplanner/api/seasons/create-first/',
                {'start_year': year, 'start_month': month}, format='json',
                HTTP_X_PROJECT_ID=str(project.pk),
            )
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(create_season, 2027, 1)
        second = executor.submit(create_season, 2028, 10)
        accepted, rejected = sorted(
            (first.result(timeout=30), second.result(timeout=30)),
            key=lambda response: response.status_code,
        )
    assert accepted.status_code == 201, accepted.data
    assert rejected.status_code == 409, rejected.data
    assert rejected.data['code'] == 'first_season_unavailable'
    season = Season.objects.get(project=project)
    pattern = SeasonPattern.objects.get(project=project)
    assert season.pk == accepted.data['id']
    assert (pattern.start_day, pattern.start_month) == (1, season.start_date.month)


@pytest.mark.django_db(transaction=True)
def test_two_projects_cannot_claim_the_same_import_uuid_concurrently():
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from unittest.mock import patch
    from uuid import uuid4

    from django.db import close_old_connections, connection
    from rest_framework.test import APIClient

    from farm.history.records import start_batch_operation
    from farm.models import BatchOperation, Crop, Project, ProjectMembership
    from farm.tests.api_base import User

    if connection.vendor != "postgresql":
        pytest.skip("PostgreSQL unique-key race regression")
    user = User.objects.create_user(username="import-uuid-race-owner")
    projects = [
        Project.objects.create(name=f"Import race {n}", slug=f"import-race-{n}") for n in range(2)
    ]
    for project in projects:
        ProjectMembership.objects.create(project=project, user=user, role="admin")
    identifier = str(uuid4())
    barrier = Barrier(2)

    def synchronized_start(**kwargs):
        barrier.wait(timeout=10)
        return start_batch_operation(**kwargs)

    def import_once(project_id):
        close_old_connections()
        try:
            client = APIClient()
            client.force_authenticate(User.objects.get(pk=user.pk))
            client.credentials(HTTP_X_PROJECT_ID=str(project_id))
            return client.post(
                "/openfarmplanner/api/crops/import/apply/",
                {
                    "items": [{"name": "UUID race crop"}],
                    "phase": "crops",
                    "import_operation_id": identifier,
                },
                format="json",
            ).status_code
        finally:
            close_old_connections()

    with patch(
        "farm.history.import_operations.start_batch_operation", side_effect=synchronized_start
    ):
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(import_once, project.pk) for project in projects]
            outcomes = [future.result(timeout=30) for future in futures]
    assert sorted(outcomes) == [200, 409]
    assert BatchOperation.objects.filter(request_id=identifier).count() == 1
    assert Crop.objects.filter(project__in=projects).count() == 1


class PlanTaskSynchronizationLockTest(TaskTimingFixture):
    def setUp(self) -> None:
        super().setUp()
        self.client.defaults["HTTP_X_SEASON_ID"] = str(self.season.pk)

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
@pytest.mark.parametrize('variety', ['', 'Concurrent synthetic variety'])
def test_concurrent_library_imports_create_one_project_row(establish_link, variety):
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
    entry = PublicCrop.objects.create(name=species.name, crop_species=species, variety=variety,
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
    assert Crop.objects.filter(project=project, crop_species=species, variety=variety).count() == 1


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


@pytest.mark.django_db(transaction=True)
def test_library_sync_refuses_a_concurrent_project_identity_write():
    from concurrent.futures import ThreadPoolExecutor

    from django.db import close_old_connections, connection, transaction
    from rest_framework.test import APIClient

    from farm.models import Crop, Project, ProjectMembership, PublicCrop
    from farm.tests.api_base import User

    if connection.vendor != 'postgresql':
        pytest.skip('PostgreSQL row-lock regression')
    user = User.objects.create_user(username='sync-project-race')
    project = Project.objects.create(name='Sync project race', slug='sync-project-race')
    ProjectMembership.objects.create(project=project, user=user, role='admin')
    entry = PublicCrop.objects.create(name='Synthetic sync', status='published', created_by=user)
    crop = Crop.objects.create(project=project, name='Synthetic local',
                               source_public_crop=entry, source_public_version=entry.version)

    def sync():
        close_old_connections()
        try:
            client = APIClient()
            client.force_authenticate(user=user)
            return client.post(f'/api/crops/{crop.pk}/public-sync/', {
                'public_crop_id': entry.pk, 'base_version': entry.version,
                'pull_fields': ['name'], 'push_fields': [],
            }, format='json', HTTP_X_PROJECT_ID=str(project.pk))
        finally:
            close_old_connections()

    with transaction.atomic():
        Project.objects.select_for_update().get(pk=project.pk)
        with ThreadPoolExecutor(max_workers=1) as executor:
            response = executor.submit(sync).result(timeout=15)
    assert response.status_code == 409
    assert response.data['code'] == 'crop_name_conflict'
    crop.refresh_from_db()
    assert crop.name == 'Synthetic local'


@pytest.mark.django_db(transaction=True)
def test_library_sync_translates_a_real_postgres_name_race_after_rollback():
    from concurrent.futures import ThreadPoolExecutor
    from unittest.mock import patch

    from django.db import close_old_connections, connection
    from rest_framework.test import APIClient

    from farm.models import Crop, EntityRevision, Project, ProjectMembership, PublicCrop
    from farm.tests.api_base import User

    if connection.vendor != 'postgresql':
        pytest.skip('PostgreSQL constraint-race regression')
    user = User.objects.create_user(username='sync-constraint-race')
    project = Project.objects.create(name='Sync constraint race', slug='sync-constraint-race')
    ProjectMembership.objects.create(project=project, user=user, role='admin')
    entry = PublicCrop.objects.create(
        name='Synthetic conflict', status='published', created_by=user,
    )
    target = Crop.objects.create(project=project, name='Synthetic conflict (2)',
                                 source_public_crop=entry, source_public_version=entry.version)
    other = Crop.objects.create(project=project, name='Synthetic unclaimed')
    from farm.history.project_restore import ensure_project_checkpoint

    ensure_project_checkpoint(project)
    before = Crop.objects.filter(pk=target.pk).values().get()
    revisions = list(EntityRevision.objects.filter(object_id=target.pk).values())
    save = Crop.save

    def competing_write():
        close_old_connections()
        try:
            with connection.cursor() as cursor:
                cursor.execute("SET lock_timeout = '5s'")
            # An older writer bypasses the cooperative project lock. Updating an
            # existing row does not need to recheck its unchanged project FK.
            Crop.objects.filter(pk=other.pk).update(
                name='Synthetic conflict', name_normalized='synthetic conflict',
            )
        finally:
            close_old_connections()

    def save_after_race(instance, *args, **kwargs):
        if instance.pk == target.pk:
            with ThreadPoolExecutor(max_workers=1) as executor:
                executor.submit(competing_write).result(timeout=15)
        return save(instance, *args, **kwargs)

    client = APIClient()
    client.force_authenticate(user=user)
    with patch.object(Crop, 'save', new=save_after_race):
        response = client.post(f'/api/crops/{target.pk}/public-sync/', {
            'public_crop_id': entry.pk, 'base_version': entry.version,
            'pull_fields': ['name'], 'push_fields': [],
        }, format='json', HTTP_X_PROJECT_ID=str(project.pk))
    assert response.status_code == 409
    assert response.data['code'] == 'crop_name_conflict'
    assert Crop.objects.filter(pk=target.pk).values().get() == before
    assert list(EntityRevision.objects.filter(object_id=target.pk).values()) == revisions
    other.refresh_from_db()
    assert other.name == 'Synthetic conflict'


@pytest.mark.django_db(transaction=True)
def test_new_library_import_translates_a_real_postgres_general_name_race():
    from concurrent.futures import ThreadPoolExecutor
    from unittest.mock import patch

    from django.db import close_old_connections, connection
    from rest_framework.test import APIClient

    from farm.models import Crop, Project, ProjectMembership, PublicCrop
    from farm.tests.api_base import User

    if connection.vendor != 'postgresql':
        pytest.skip('PostgreSQL import constraint-race regression')
    user = User.objects.create_user(username='import-constraint-race')
    project = Project.objects.create(name='Import constraint race', slug='import-constraint-race')
    ProjectMembership.objects.create(project=project, user=user, role='admin')
    entry = PublicCrop.objects.create(
        name='Synthetic raced import', status='published', created_by=user,
    )
    other = Crop.objects.create(project=project, name='Synthetic unclaimed import')
    from farm.history.project_restore import ensure_project_checkpoint

    ensure_project_checkpoint(project)
    save = Crop.save

    def competing_write():
        close_old_connections()
        try:
            with connection.cursor() as cursor:
                cursor.execute("SET lock_timeout = '5s'")
            Crop.objects.filter(pk=other.pk).update(
                name=entry.name, name_normalized='synthetic raced import',
            )
        finally:
            close_old_connections()

    def save_after_race(crop, *args, **kwargs):
        if crop.pk is None and crop.project_id == project.pk:
            with ThreadPoolExecutor(max_workers=1) as executor:
                executor.submit(competing_write).result(timeout=15)
        return save(crop, *args, **kwargs)

    client = APIClient()
    client.force_authenticate(user=user)
    with patch.object(Crop, 'save', new=save_after_race):
        response = client.post(f'/api/public-crops/{entry.pk}/import/', {
            'base_version': entry.version, 'expected_project_id': project.pk,
        }, format='json', HTTP_X_PROJECT_ID=str(project.pk))
    assert response.status_code == 409
    assert response.data['code'] == 'crop_name_conflict'
    assert list(Crop.objects.filter(project=project).values_list('pk', flat=True)) == [other.pk]
    other.refresh_from_db()
    assert other.name == entry.name


@pytest.mark.django_db(transaction=True)
def test_concurrent_selected_variety_imports_commit_one_complete_scope():
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections, connection

    from crops.models import CropSpecies
    from farm.models import Crop, Project, PublicCrop
    from farm.services.public_crop_import_selection import import_public_crop_selection
    from farm.tests.api_base import User

    if connection.vendor != "postgresql":
        pytest.skip("PostgreSQL row-lock regression")
    user = User.objects.create_user(username="concurrent-selection-user")
    project = Project.objects.create(name="Concurrent selection", slug="concurrent-selection")
    species = CropSpecies.objects.create(name="Concurrent selection carrot")
    entries = [
        PublicCrop.objects.create(
            name=species.name, crop_species=species, variety=variety, status="published"
        )
        for variety in ("", "One", "Two", "Three")
    ]
    decisions = [
        {
            "public_crop_id": entry.pk,
            "base_version": entry.version,
            "link_to_library": True,
            "mode": "auto",
        }
        for entry in entries
    ]
    barrier = Barrier(2)

    def import_once():
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            return import_public_crop_selection(
                parent=entries[0], project=project, decisions=decisions, user=user, language="en"
            )
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(import_once) for _ in range(2)]
        results = [future.result(timeout=30) for future in futures]
    assert {entry["crop_id"] for entry in results[0]} == {entry["crop_id"] for entry in results[1]}
    assert sorted(entry["operation"] for result in results for entry in result) == (
        ["created"] * 4 + ["unchanged"] * 4
    )
    assert Crop.objects.filter(project=project).count() == 4


@pytest.mark.django_db(transaction=True)
def test_existing_baseline_mutations_cannot_enter_an_import_capture_window():
    from concurrent.futures import ThreadPoolExecutor
    from uuid import uuid4

    from django.db import close_old_connections, connection, transaction
    from rest_framework.test import APIClient

    from farm.history.import_operations import execute_import_request
    from farm.history.project_restore import ensure_project_checkpoint
    from farm.models import BatchOperation, Crop, Project, ProjectMembership, Task
    from farm.tests.api_base import User

    if connection.vendor != 'postgresql':
        pytest.skip('PostgreSQL import capture isolation regression')
    user = User.objects.create_user(username='import-window-user')
    project = Project.objects.create(name='Import window', slug='import-window')
    ProjectMembership.objects.create(project=project, user=user, role='admin')
    task = Task.objects.create(project=project, title='Independent original task')
    ensure_project_checkpoint(project)

    def update_task():
        close_old_connections()
        try:
            client = APIClient()
            client.force_authenticate(user=user)
            return client.patch(f'/api/tasks/{task.pk}/', {'title': 'Independent later edit'},
                                format='json', HTTP_X_PROJECT_ID=str(project.pk))
        finally:
            close_old_connections()

    def run():
        with ThreadPoolExecutor(max_workers=1) as pool:
            response = pool.submit(update_task).result(timeout=15)
        assert response.status_code == 409
        crop = Crop.objects.create(project=project, name='Import-owned crop')
        return {'results': [{'status': 'created', 'crop_id': crop.pk}]}

    with transaction.atomic():
        execute_import_request(project, request_id=str(uuid4()), actor_id=user.pk,
                               actor_label=user.username, phase='finalize', run=run)
    task.refresh_from_db()
    assert task.title == 'Independent original task'
    batch = BatchOperation.objects.get(project=project, operation_type='crop_import')
    assert 'task' not in batch.context['_import_changes']
    assert update_task().status_code == 200
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.post(f'/api/history/batch/{batch.pk}/revert/',
                           HTTP_X_PROJECT_ID=str(project.pk))
    assert response.status_code == 200
    task.refresh_from_db()
    assert task.title == 'Independent later edit'


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize('operation', ['undelete', 'restore', 'public-sync'])
def test_variety_constraint_race_rolls_back_restore_and_sync(operation):
    from concurrent.futures import ThreadPoolExecutor
    from unittest.mock import patch

    from django.db import close_old_connections, connection
    from rest_framework.test import APIClient

    from farm.history.project_restore import ensure_project_checkpoint
    from farm.models import Crop, EntityRevision, Project, ProjectMembership, PublicCrop, Supplier
    from farm.tests.api_base import User

    if connection.vendor != 'postgresql':
        pytest.skip('PostgreSQL variety constraint-race regression')
    user = User.objects.create_user(username=f'variety-race-{operation}')
    project = Project.objects.create(name='Variety race', slug=f'variety-race-{operation}')
    ProjectMembership.objects.create(project=project, user=user, role='admin')
    supplier = Supplier.objects.create(project=project, name='Synthetic supplier')
    entry = PublicCrop.objects.create(
        name='Synthetic', variety='New', status='published', created_by=user,
    )
    target = Crop.objects.create(
        project=project, name='Synthetic', variety='New', supplier=supplier,
        source_public_crop=entry, source_public_version=entry.version,
    )
    revision = EntityRevision.objects.filter(entity_type='crop', object_id=target.pk).latest('pk')
    if operation == 'undelete':
        from django.utils import timezone

        target.deleted_at = timezone.now()
        target.save()
    else:
        target.variety = 'Old'
        target.save()
    other = Crop.objects.create(
        project=project, name='Synthetic', variety='Unclaimed', supplier=supplier,
    )
    ensure_project_checkpoint(project)
    before = Crop.all_objects.filter(pk=target.pk).values().get()
    revisions = list(EntityRevision.objects.filter(project=project).order_by('pk').values())
    save = Crop.save

    def competing_write():
        close_old_connections()
        try:
            with connection.cursor() as cursor:
                cursor.execute("SET lock_timeout = '5s'")
            Crop.objects.filter(pk=other.pk).update(variety='New', variety_normalized='new')
        finally:
            close_old_connections()

    def save_after_race(instance, *args, **kwargs):
        if instance.pk == target.pk:
            with ThreadPoolExecutor(max_workers=1) as executor:
                executor.submit(competing_write).result(timeout=15)
        return save(instance, *args, **kwargs)

    client = APIClient()
    client.force_authenticate(user=user)
    payload = {
        'undelete': {}, 'restore': {'history_id': revision.pk},
        'public-sync': {'public_crop_id': entry.pk, 'base_version': entry.version,
                        'pull_fields': ['variety'], 'push_fields': []},
    }[operation]
    with patch.object(Crop, 'save', new=save_after_race):
        response = client.post(f'/api/crops/{target.pk}/{operation}/', payload,
                               format='json', HTTP_X_PROJECT_ID=str(project.pk))
    assert response.status_code == 409
    assert response.data['code'] == 'crop_variety_conflict'
    assert Crop.all_objects.filter(pk=target.pk).values().get() == before
    assert list(EntityRevision.objects.filter(project=project).order_by('pk').values()) == revisions
    other.refresh_from_db()
    assert other.variety == 'New'


@pytest.mark.django_db(transaction=True)
def test_crop_rename_reads_the_current_sibling_group_after_locking():
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from django.contrib.sessions.middleware import SessionMiddleware
    from django.db import close_old_connections, connection
    from rest_framework.test import APIRequestFactory, force_authenticate

    from farm.crops.views.crops import CropViewSet
    from farm.history.project_restore import ensure_project_checkpoint
    from farm.models import Crop, Project, ProjectMembership
    from farm.tests.api_base import User

    if connection.vendor != 'postgresql':
        pytest.skip('PostgreSQL crop rename lock regression')
    user = User.objects.create_user(username='crop-rename-lock-owner')
    project = Project.objects.create(name='Rename ordering', slug='rename-ordering')
    ProjectMembership.objects.create(project=project, user=user, role='admin')
    general, first, second = [
        Crop.objects.create(project=project, name='Original crop', variety=variety)
        for variety in ('', 'First variety', 'Second variety')
    ]
    ensure_project_checkpoint(project)
    second_at_lock = Event()
    first_finished = Event()
    # Dispatch the normal DRF action without Django's request-wide transaction.
    # The checkpoint's separate lock can then complete before the rename races.
    update_crop = CropViewSet.as_view({'patch': 'partial_update'})

    def rename(pk, name):
        request = APIRequestFactory().patch(
            f'/api/crops/{pk}/', {'name': name}, format='json',
            HTTP_X_PROJECT_ID=str(project.pk),
        )
        SessionMiddleware(update_crop).process_request(request)
        force_authenticate(request, user=user)
        return update_crop(request, pk=pk)

    def rename_second():
        close_old_connections()
        read_crop = False

        def wait_before_project_lock(execute, sql, params, many, context):
            nonlocal read_crop
            if 'FROM "farm_crop"' in sql and sql.startswith('SELECT'):
                read_crop = True
            if (
                read_crop and not second_at_lock.is_set()
                and 'FROM "farm_project"' in sql and 'FOR UPDATE' in sql
            ):
                second_at_lock.set()
                assert first_finished.wait(timeout=15)
            return execute(sql, params, many, context)

        try:
            with connection.execute_wrapper(wait_before_project_lock):
                return rename(second.pk, 'Final crop')
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=1) as executor:
        pending = executor.submit(rename_second)
        try:
            if not second_at_lock.wait(timeout=15):
                outcome = pending.result(timeout=5)
                pytest.fail(f'The second request did not reach its rename lock: {outcome.data}')
            first_response = rename(first.pk, 'Intermediate crop')
            assert first_response.status_code == 200, first_response.data
            assert Crop.objects.filter(project=project, name='Intermediate crop').count() == 3
        finally:
            first_finished.set()
        second_response = pending.result(timeout=15)

    assert second_response.status_code == 200, second_response.data
    stored = Crop.objects.filter(project=project).values_list('pk', 'name', 'name_normalized')
    assert set(stored) == {
        (crop.pk, 'Final crop', 'final crop') for crop in (general, first, second)
    }


@pytest.mark.django_db(transaction=True)
def test_crop_restore_locks_shared_references_until_save(monkeypatch):
    from concurrent.futures import ThreadPoolExecutor

    from django.db import OperationalError, close_old_connections, connection, transaction
    from rest_framework.test import APIClient

    from crops.models import CropSpecies, PlantFamily
    from farm.history.records import _serialize_instance
    from farm.models import Crop, EntityRevision, Project, ProjectMembership, PublicCrop
    from farm.tests.api_base import User

    if connection.vendor != 'postgresql':
        pytest.skip('PostgreSQL crop restore reference locks')
    user = User.objects.create_user(username='crop-restore-reference-owner')
    project = Project.objects.create(name='Restore references', slug='restore-references')
    ProjectMembership.objects.create(project=project, user=user, role='admin')
    crop = Crop.objects.create(project=project, name='Restore reference crop')
    species = CropSpecies.objects.create(name='Restore reference species')
    family = PlantFamily.objects.create(botanical_name='Restore-testaceae')
    entry = PublicCrop.objects.create(
        name=species.name, crop_species=species, status='published', created_by=user,
    )
    version = EntityRevision.objects.create(
        project=project, entity_type='crop', object_id=crop.pk,
        action=EntityRevision.ACTION_UPDATED,
        snapshot={
            **_serialize_instance(crop), 'crop_species_id': species.pk, 'crop_family_id': family.pk,
            'source_public_crop_id': entry.pk, 'derived_from_public_crop_id': entry.pk,
        },
    )

    def check_reference_locks():
        close_old_connections()
        try:
            for reference in (species, family, entry):
                with pytest.raises(OperationalError) as locked, transaction.atomic():
                    type(reference).objects.select_for_update(nowait=True).get(pk=reference.pk)
                cause = locked.value.__cause__
                sqlstate = getattr(cause, 'sqlstate', None) or getattr(cause, 'pgcode', None)
                assert sqlstate == '55P03'
        finally:
            close_old_connections()

    original_save = Crop.save

    def save_with_lock_check(instance, *args, **kwargs):
        if instance.pk == crop.pk:
            with ThreadPoolExecutor(max_workers=1) as executor:
                executor.submit(check_reference_locks).result(timeout=15)
        return original_save(instance, *args, **kwargs)

    monkeypatch.setattr(Crop, 'save', save_with_lock_check)
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.post(
        f'/api/crops/{crop.pk}/restore/', {'history_id': version.pk}, format='json',
        HTTP_X_PROJECT_ID=str(project.pk),
    )
    assert response.status_code == 200, response.data
    crop.refresh_from_db()
    assert (crop.crop_species_id, crop.crop_family_id, crop.source_public_crop_id) == (
        species.pk, family.pk, entry.pk,
    )


@pytest.mark.django_db(transaction=True)
def test_crop_delete_reads_image_under_the_restore_project_lock(monkeypatch):
    from concurrent.futures import ThreadPoolExecutor

    from django.contrib.sessions.middleware import SessionMiddleware
    from django.db import OperationalError, close_old_connections, connection, transaction
    from rest_framework.test import APIRequestFactory, force_authenticate

    from farm.crops.views.crops import CropViewSet
    from farm.models import Crop, MediaFile, Project, ProjectMembership
    from farm.tests.api_base import User

    if connection.vendor != 'postgresql':
        pytest.skip('PostgreSQL image deletion and restore serialization')
    user = User.objects.create_user(username='crop-delete-image-owner')
    project = Project.objects.create(name='Crop image deletion', slug='crop-image-deletion')
    ProjectMembership.objects.create(project=project, user=user, role='admin')
    image = MediaFile.objects.create(project=project, storage_path='synthetic-delete-image.png')
    crop = Crop.objects.create(project=project, name='Crop with image', image_file=image)

    def check_project_lock():
        close_old_connections()
        try:
            with pytest.raises(OperationalError) as locked, transaction.atomic():
                Project.objects.select_for_update(nowait=True).get(pk=project.pk)
            cause = locked.value.__cause__
            sqlstate = getattr(cause, 'sqlstate', None) or getattr(cause, 'pgcode', None)
            assert sqlstate == '55P03'
        finally:
            close_old_connections()

    get_object = CropViewSet.get_object

    def get_crop_after_lock(view):
        with ThreadPoolExecutor(max_workers=1) as executor:
            executor.submit(check_project_lock).result(timeout=15)
        return get_object(view)

    monkeypatch.setattr(CropViewSet, 'get_object', get_crop_after_lock)
    # The view's own lock matters even without the request-wide transaction.
    delete_crop = CropViewSet.as_view({'delete': 'destroy'})
    request = APIRequestFactory().delete(
        f'/api/crops/{crop.pk}/', HTTP_X_PROJECT_ID=str(project.pk),
    )
    SessionMiddleware(delete_crop).process_request(request)
    force_authenticate(request, user=user)
    response = delete_crop(request, pk=crop.pk)

    assert response.status_code == 204
    image.refresh_from_db()
    assert image.orphaned_at is not None


@pytest.mark.django_db(transaction=True)
def test_supplierless_undeletes_cannot_create_duplicate_varieties_concurrently():
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections, connection
    from django.utils import timezone
    from rest_framework.test import APIClient

    from farm.history.project_restore import ensure_project_checkpoint
    from farm.models import Crop, Project, ProjectMembership
    from farm.tests.api_base import User

    if connection.vendor != 'postgresql':
        pytest.skip('PostgreSQL supplierless identity lock regression')
    user = User.objects.create_user(username='supplierless-race')
    project = Project.objects.create(name='Supplierless race', slug='supplierless-race')
    ProjectMembership.objects.create(project=project, user=user, role='admin')
    targets = [Crop.objects.create(project=project, name='Carrot', variety='Nantes',
                                   deleted_at=timezone.now()) for _ in range(2)]
    ensure_project_checkpoint(project)
    barrier = Barrier(2)

    def restore(pk):
        close_old_connections()
        try:
            client = APIClient()
            client.force_authenticate(user=user)
            barrier.wait(timeout=10)
            return client.post(f'/api/crops/{pk}/undelete/', format='json',
                               HTTP_X_PROJECT_ID=str(project.pk)).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as executor:
        statuses = list(executor.map(restore, [crop.pk for crop in targets]))
    assert sorted(statuses) == [200, 409]
    assert Crop.objects.filter(project=project, name='Carrot', variety='Nantes').count() == 1
