from datetime import date
from importlib import import_module
from unittest.mock import patch

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.utils import timezone
from rest_framework.test import APIClient


@pytest.mark.django_db(transaction=True)
class TestDemoDashboardTaskMigration:
    migrate_from = [('farm', '0134_validate_template_recurrence')]
    migrate_to = [('farm', '0135_backfill_demo_dashboard_tasks')]

    def setup_method(self):
        executor = MigrationExecutor(connection)
        executor.migrate(self.migrate_from)
        apps = executor.loader.project_state(self.migrate_from).apps
        Project = apps.get_model('farm', 'Project')
        Season = apps.get_model('farm', 'Season')
        Task = apps.get_model('farm', 'Task')
        User = apps.get_model('auth', 'User')
        Membership = apps.get_model('farm', 'ProjectMembership')
        Revision = apps.get_model('farm', 'EntityRevision')
        self.owner_id = User.objects.create(
            username='legacy-demo-owner', email='owner@example.local',
        ).pk
        self.projects = {}
        self.seasons = {}
        for key in [
            'de', 'en', 'regular', 'manual', 'edited', 'deleted',
            'inactive', 'no-season', 'unmarked',
        ]:
            language = 'en' if key == 'en' else 'de'
            description = {
                'de': 'Persönliches Demo-Projekt mit realistischen Beispieldaten.',
                'en': 'Personal demo project with realistic sample data.',
            }[language]
            project = Project.objects.create(
                name='Keep custom name', slug=f'legacy-{key}',
                description='Normal project' if key == 'regular' else description,
                demo_seeded_at=None if key == 'unmarked' else timezone.now(),
                is_active=key != 'inactive',
            )
            self.projects[key] = project.pk
            Membership.objects.create(project_id=project.pk, user_id=self.owner_id, role='admin')
            if key == 'no-season':
                continue
            # Deliberately old: the overview selects the newest stored season,
            # rather than requiring that it contain today's date.
            season = Season.objects.create(
                project_id=project.pk, start_date=date(2025, 1, 1), end_date=date(2025, 12, 31),
            )
            self.seasons[key] = season.pk
            Season.objects.create(
                project_id=project.pk, start_date=date(2024, 1, 1), end_date=date(2024, 12, 31),
            )
            if key == 'manual':
                Task.objects.create(
                    project_id=project.pk, season_id=season.pk, title='Keep my task',
                )
            if key == 'edited':
                Revision.objects.create(
                    project_id=project.pk, entity_type='task', object_id=123,
                    action='deleted', snapshot={},
                )
            if key == 'deleted':
                Task.objects.create(
                    project_id=project.pk, season_id=season.pk, title='Removed intentionally',
                    deleted_at=timezone.now(),
                )
        self.automatic = Task.objects.create(
            project_id=self.projects['de'], season_id=self.seasons['de'],
            title='Keep completed event', origin='automatic', status='completed',
            due_date=date(2025, 6, 1), due_date_overridden=True,
        ).pk
        executor = MigrationExecutor(connection)
        with patch('django.utils.timezone.localdate', return_value=date(2026, 11, 6)):
            executor.migrate(self.migrate_to)
        self.apps = executor.loader.project_state(self.migrate_to).apps

    def teardown_method(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())

    def test_backfills_visible_work_without_overwriting_user_data_and_survives_rollback(self):
        Task = self.apps.get_model('farm', 'Task')
        Project = self.apps.get_model('farm', 'Project')
        for language, title in [('de', 'Beete jäten'), ('en', 'Weed the beds')]:
            manual = Task.objects.filter(project_id=self.projects[language], origin='manual')
            assert manual.count() == 7
            assert set(manual.values_list('season_id', flat=True)) == {self.seasons[language]}
            assert manual.filter(
                title=title, due_date=date(2026, 11, 6), status='in_progress',
            ).exists()
            assert manual.filter(status='pending', due_date=date(2026, 11, 4)).exists()
            assert manual.filter(status='pending', due_date=date(2026, 11, 8)).exists()
            assert manual.filter(due_date__isnull=True, assigned_to__isnull=True).exists()
            assert not manual.filter(due_date__isnull=False).exclude(
                assigned_to_id=self.owner_id,
            ).exists()
            assert Project.objects.get(pk=self.projects[language]).name == 'Keep custom name'
        original = Task.objects.get(pk=self.automatic)
        assert original.title == 'Keep completed event'
        assert original.status == 'completed'
        assert original.due_date == date(2025, 6, 1)
        assert original.due_date_overridden
        for key in ['regular', 'edited', 'inactive', 'no-season', 'unmarked']:
            assert not Task.objects.filter(project_id=self.projects[key]).exists()
        assert Task.objects.filter(project_id=self.projects['manual']).count() == 1
        assert Task.objects.filter(project_id=self.projects['deleted']).count() == 1

        # Exercise the same project + season request context as the overview.
        from django.contrib.auth import get_user_model
        client = APIClient()
        client.force_authenticate(get_user_model().objects.get(pk=self.owner_id))
        response = client.get('/openfarmplanner/api/tasks/',
                              HTTP_X_PROJECT_ID=str(self.projects['de']),
                              HTTP_X_SEASON_ID=str(self.seasons['de']))
        assert response.status_code == 200
        assert any(row['title'] == 'Beete jäten' for row in response.data['results'])
        assert all(row['project'] == self.projects['de'] for row in response.data['results'])

        before = list(Task.objects.order_by('pk').values())
        migration = import_module('farm.migrations.0135_backfill_demo_dashboard_tasks')
        with connection.schema_editor() as editor:
            migration.backfill_demo_tasks(self.apps, editor)
        assert list(Task.objects.order_by('pk').values()) == before
        executor = MigrationExecutor(connection)
        executor.migrate(self.migrate_from)
        assert list(Task.objects.order_by('pk').values()) == before
