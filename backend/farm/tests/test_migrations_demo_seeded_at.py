from datetime import timedelta

import pytest
from django.utils import timezone

from farm.tests.migration_base import MigrationTestBase


@pytest.mark.django_db
class TestDemoSeededAtBackfillMigration(MigrationTestBase):
    migrate_from = [('farm', '0110_repair_implicit_general_kultur_links')]
    migrate_to = [('farm', '0111_project_demo_seeded_at')]

    @classmethod
    def seed_before_migration(cls, apps):
        project_model = apps.get_model('farm', 'Project')
        revision_model = apps.get_model('farm', 'EntityRevision')

        cls.created_at = timezone.now() - timedelta(days=3)
        cls.seed_end = cls.created_at + timedelta(seconds=5)
        cls.demo_project = project_model.objects.create(
            name='Solawi Sonnenacker',
            slug='backfill-demo',
            description='Persönliches Demo-Projekt mit realistischen Beispieldaten.',
        )
        cls.untouched_demo_project = project_model.objects.create(
            name='Sunny Acre CSA',
            slug='backfill-demo-no-revisions',
            description='Personal demo project with realistic sample data.',
        )
        cls.regular_project = project_model.objects.create(name='Echt', slug='backfill-regular')
        project_model.objects.filter(
            pk__in=[cls.demo_project.pk, cls.untouched_demo_project.pk],
        ).update(created_at=cls.created_at)
        for offset, action in (
            (timedelta(seconds=1), 'created'),
            (timedelta(seconds=5), 'created'),
            (timedelta(hours=1), 'created'),
            (timedelta(hours=2), 'updated'),
        ):
            revision = revision_model.objects.create(
                project_id=cls.demo_project.pk,
                entity_type='crop',
                object_id=1,
                action=action,
                snapshot={},
            )
            revision_model.objects.filter(pk=revision.pk).update(
                created_at=cls.created_at + offset,
            )

    def _seeded_at(self, project):
        project_model = self.new_apps.get_model('farm', 'Project')
        return project_model.objects.get(pk=project.pk).demo_seeded_at

    def test_seed_end_is_the_last_crop_revision_within_the_seed_window(self):
        assert self._seeded_at(self.demo_project) == self.seed_end

    def test_a_demo_project_without_seed_revisions_falls_back_to_its_creation(self):
        assert self._seeded_at(self.untouched_demo_project) == self.created_at

    def test_regular_projects_stay_unmarked(self):
        assert self._seeded_at(self.regular_project) is None
