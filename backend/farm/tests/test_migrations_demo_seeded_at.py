from datetime import timedelta

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.utils import timezone


@pytest.mark.django_db(transaction=True)
class TestDemoSeededAtBackfillMigration:
    migrate_from = [('farm', '0110_repair_implicit_general_kultur_links')]
    migrate_to = [('farm', '0111_project_demo_seeded_at')]

    def setup_method(self):
        self.executor = MigrationExecutor(connection)
        self.executor.migrate(self.migrate_from)
        old_apps = self.executor.loader.project_state(self.migrate_from).apps
        project_model = old_apps.get_model('farm', 'Project')
        revision_model = old_apps.get_model('farm', 'EntityRevision')

        self.created_at = timezone.now() - timedelta(days=3)
        self.seed_end = self.created_at + timedelta(seconds=5)
        self.demo_project = project_model.objects.create(
            name='Solawi Sonnenacker',
            slug='backfill-demo',
            description='Persönliches Demo-Projekt mit realistischen Beispieldaten.',
        )
        self.untouched_demo_project = project_model.objects.create(
            name='Sunny Acre CSA',
            slug='backfill-demo-no-revisions',
            description='Personal demo project with realistic sample data.',
        )
        self.regular_project = project_model.objects.create(name='Echt', slug='backfill-regular')
        project_model.objects.filter(
            pk__in=[self.demo_project.pk, self.untouched_demo_project.pk],
        ).update(created_at=self.created_at)
        for offset, action in (
            (timedelta(seconds=1), 'created'),
            (timedelta(seconds=5), 'created'),
            (timedelta(hours=1), 'created'),
            (timedelta(hours=2), 'updated'),
        ):
            revision = revision_model.objects.create(
                project_id=self.demo_project.pk,
                entity_type='crop',
                object_id=1,
                action=action,
                snapshot={},
            )
            revision_model.objects.filter(pk=revision.pk).update(
                created_at=self.created_at + offset,
            )

        self.executor.loader.build_graph()
        self.executor.migrate(self.migrate_to)
        self.new_apps = self.executor.loader.project_state(self.migrate_to).apps

    def teardown_method(self):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(executor.loader.graph.leaf_nodes())

    def _seeded_at(self, project):
        project_model = self.new_apps.get_model('farm', 'Project')
        return project_model.objects.get(pk=project.pk).demo_seeded_at

    def test_seed_end_is_the_last_crop_revision_within_the_seed_window(self):
        assert self._seeded_at(self.demo_project) == self.seed_end

    def test_a_demo_project_without_seed_revisions_falls_back_to_its_creation(self):
        assert self._seeded_at(self.untouched_demo_project) == self.created_at

    def test_regular_projects_stay_unmarked(self):
        assert self._seeded_at(self.regular_project) is None
