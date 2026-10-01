from datetime import timedelta

import pytest
from django.conf import settings
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.utils import timezone


@pytest.mark.django_db(transaction=True)
class TestRepairImplicitGeneralKulturLinks:
    """The repair of general Kultur links a Sorte publish wrote implicitly."""

    migrate_from = ('farm', '0109_crop_derived_from_public_crop')
    migrate_to = ('farm', '0110_repair_implicit_general_kultur_links')

    def setup_method(self):
        self.executor = MigrationExecutor(connection)
        self.executor.migrate([self.migrate_from])
        old_apps = self.executor.loader.project_state([self.migrate_from]).apps

        self.user_model = old_apps.get_model(*settings.AUTH_USER_MODEL.split('.'))
        self.project_model = old_apps.get_model('farm', 'Project')
        self.crop_model = old_apps.get_model('farm', 'Crop')
        self.public_crop_model = old_apps.get_model('farm', 'PublicCrop')
        self.revision_model = old_apps.get_model('farm', 'PublicCropRevision')
        self.entity_revision_model = old_apps.get_model('farm', 'EntityRevision')

        self.publisher = self.user_model.objects.create(username='publisher', email='p@example.com')
        self.other = self.user_model.objects.create(username='other', email='o@example.com')
        self.project = self.project_model.objects.create(name='P', slug='p')
        self.link_time = timezone.now() - timedelta(days=10)

        foreign_owner = self._general_kultur('Foreign owner kultur', growth=99)
        self.foreign_entry = self._entry('Bean', owner=self.other, source=foreign_owner, growth=99)
        self.foreign_linked = self._general_kultur('Bean', growth=60)
        self._link(self.foreign_linked, self.foreign_entry, rejected_version=1)

        self.explicitly_linked = self._general_kultur(
            'Bean explicit', growth=60, origin_type='imported',
        )
        self._link(self.explicitly_linked, self.foreign_entry)

        self.unedited_since_link = self._general_kultur('Pea', growth=60)
        self.created_entry = self._entry(
            'Pea', owner=self.publisher, source=self.unedited_since_link, growth=50,
        )
        self._link(self.unedited_since_link, self.created_entry)

        self.edited_after_link = self._general_kultur('Radish', growth=60)
        edited_entry = self._entry(
            'Radish', owner=self.publisher, source=self.edited_after_link, growth=50,
        )
        self._link(self.edited_after_link, edited_entry)
        self.crop_model._base_manager.filter(pk=self.edited_after_link.pk).update(
            updated_at=self.link_time + timedelta(days=1),
        )

        self.edited_through_history = self._general_kultur('Kale', growth=60)
        history_entry = self._entry(
            'Kale', owner=self.publisher, source=self.edited_through_history, growth=50,
        )
        self._link(self.edited_through_history, history_entry)
        revision = self.entity_revision_model.objects.create(
            project=self.project, entity_type='crop', object_id=self.edited_through_history.pk,
            action='updated', snapshot={},
        )
        self.entity_revision_model.objects.filter(pk=revision.pk).update(
            created_at=self.link_time + timedelta(days=1),
        )

        self.matching = self._general_kultur('Leek', growth=50)
        matching_entry = self._entry(
            'Leek', owner=self.publisher, source=self.matching, growth=50,
        )
        self._link(self.matching, matching_entry)

        self.executor.loader.build_graph()
        self.executor.migrate([self.migrate_to])
        apps = self.executor.loader.project_state([self.migrate_to]).apps
        self.migrated_crop_model = apps.get_model('farm', 'Crop')

    def teardown_method(self):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(executor.loader.graph.leaf_nodes())

    def _general_kultur(self, name, *, growth, origin_type='manual'):
        crop = self.crop_model.objects.create(
            name=name, name_normalized=name.lower(), variety='', variety_normalized=None,
            project=self.project, growth_duration_days=growth, harvest_duration_days=14,
            origin_type=origin_type,
        )
        self.crop_model._base_manager.filter(pk=crop.pk).update(
            updated_at=self.link_time - timedelta(days=1),
        )
        return crop

    def _entry(self, name, *, owner, source, growth):
        entry = self.public_crop_model.objects.create(
            name=name, name_normalized=name.lower(), variety='', variety_normalized='',
            status='published', version=1, created_by=owner,
            source_project=source.project, source_project_crop=source,
            growth_duration_days=growth, harvest_duration_days=14,
        )
        revision = self.revision_model.objects.create(
            public_crop=entry, version=1, action='created',
        )
        self.revision_model.objects.filter(pk=revision.pk).update(created_at=self.link_time)
        return entry

    def _link(self, crop, entry, *, rejected_version=None):
        self.crop_model._base_manager.filter(pk=crop.pk).update(
            source_public_crop=entry,
            source_public_version=entry.version,
            rejected_public_version=rejected_version,
            is_modified_from_source=True,
        )

    def _migrated(self, crop):
        return self.migrated_crop_model._base_manager.get(pk=crop.pk)

    def test_link_to_a_foreign_general_entry_is_removed(self):
        crop = self._migrated(self.foreign_linked)

        assert crop.source_public_crop_id is None
        assert crop.source_public_version is None
        assert crop.rejected_public_version is None
        assert crop.derived_from_public_crop_id == self.foreign_entry.pk
        assert crop.growth_duration_days == 60
        assert crop.origin_type == 'manual'
        assert crop.is_modified_from_source is True

    def test_explicit_link_to_a_foreign_general_entry_stays(self):
        crop = self._migrated(self.explicitly_linked)

        assert crop.source_public_crop_id == self.foreign_entry.pk
        assert crop.source_public_version == 1

    def test_baseline_never_matched_since_the_link_is_cleared(self):
        crop = self._migrated(self.unedited_since_link)

        assert crop.source_public_crop_id == self.created_entry.pk
        assert crop.source_public_version is None
        assert crop.growth_duration_days == 60

    def test_crop_edited_after_the_link_keeps_its_baseline(self):
        assert self._migrated(self.edited_after_link).source_public_version == 1

    def test_crop_with_a_history_revision_after_the_link_keeps_its_baseline(self):
        assert self._migrated(self.edited_through_history).source_public_version == 1

    def test_matching_crop_keeps_its_baseline(self):
        assert self._migrated(self.matching).source_public_version == 1
