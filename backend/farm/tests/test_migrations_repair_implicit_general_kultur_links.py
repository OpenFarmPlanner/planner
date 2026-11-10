from datetime import timedelta

import pytest
from django.conf import settings
from django.utils import timezone

from farm.tests.migration_base import MigrationTestBase


@pytest.mark.django_db
class TestRepairImplicitGeneralKulturLinks(MigrationTestBase):
    """The repair of general Kultur links a Sorte publish wrote implicitly."""

    migrate_from = [('farm', '0109_crop_derived_from_public_crop')]
    migrate_to = [('farm', '0110_repair_implicit_general_kultur_links')]

    @classmethod
    def seed_before_migration(cls, apps):
        cls.user_model = apps.get_model(*settings.AUTH_USER_MODEL.split('.'))
        cls.project_model = apps.get_model('farm', 'Project')
        cls.crop_model = apps.get_model('farm', 'Crop')
        cls.public_crop_model = apps.get_model('farm', 'PublicCrop')
        cls.revision_model = apps.get_model('farm', 'PublicCropRevision')
        cls.entity_revision_model = apps.get_model('farm', 'EntityRevision')

        cls.publisher = cls.user_model.objects.create(username='publisher', email='p@example.com')
        cls.other = cls.user_model.objects.create(username='other', email='o@example.com')
        cls.project = cls.project_model.objects.create(name='P', slug='p')
        cls.link_time = timezone.now() - timedelta(days=10)

        foreign_owner = cls._general_kultur('Foreign owner kultur', growth=99)
        cls.foreign_entry = cls._entry('Bean', owner=cls.other, source=foreign_owner, growth=99)
        cls.foreign_linked = cls._general_kultur('Bean', growth=60)
        cls._link(cls.foreign_linked, cls.foreign_entry, rejected_version=1)

        cls.explicitly_linked = cls._general_kultur(
            'Bean explicit', growth=60, origin_type='imported',
        )
        cls._link(cls.explicitly_linked, cls.foreign_entry)

        cls.unedited_since_link = cls._general_kultur('Pea', growth=60)
        cls.created_entry = cls._entry(
            'Pea', owner=cls.publisher, source=cls.unedited_since_link, growth=50,
        )
        cls._link(cls.unedited_since_link, cls.created_entry)

        cls.edited_after_link = cls._general_kultur('Radish', growth=60)
        edited_entry = cls._entry(
            'Radish', owner=cls.publisher, source=cls.edited_after_link, growth=50,
        )
        cls._link(cls.edited_after_link, edited_entry)
        cls.crop_model._base_manager.filter(pk=cls.edited_after_link.pk).update(
            updated_at=cls.link_time + timedelta(days=1),
        )

        cls.edited_through_history = cls._general_kultur('Kale', growth=60)
        history_entry = cls._entry(
            'Kale', owner=cls.publisher, source=cls.edited_through_history, growth=50,
        )
        cls._link(cls.edited_through_history, history_entry)
        revision = cls.entity_revision_model.objects.create(
            project=cls.project, entity_type='crop', object_id=cls.edited_through_history.pk,
            action='updated', snapshot={},
        )
        cls.entity_revision_model.objects.filter(pk=revision.pk).update(
            created_at=cls.link_time + timedelta(days=1),
        )

        cls.matching = cls._general_kultur('Leek', growth=50)
        matching_entry = cls._entry(
            'Leek', owner=cls.publisher, source=cls.matching, growth=50,
        )
        cls._link(cls.matching, matching_entry)

    @classmethod
    def _general_kultur(cls, name, *, growth, origin_type='manual'):
        crop = cls.crop_model.objects.create(
            name=name, name_normalized=name.lower(), variety='', variety_normalized=None,
            project=cls.project, growth_duration_days=growth, harvest_duration_days=14,
            origin_type=origin_type,
        )
        cls.crop_model._base_manager.filter(pk=crop.pk).update(
            updated_at=cls.link_time - timedelta(days=1),
        )
        return crop

    @classmethod
    def _entry(cls, name, *, owner, source, growth):
        entry = cls.public_crop_model.objects.create(
            name=name, name_normalized=name.lower(), variety='', variety_normalized='',
            status='published', version=1, created_by=owner,
            source_project=source.project, source_project_crop=source,
            growth_duration_days=growth, harvest_duration_days=14,
        )
        revision = cls.revision_model.objects.create(
            public_crop=entry, version=1, action='created',
        )
        cls.revision_model.objects.filter(pk=revision.pk).update(created_at=cls.link_time)
        return entry

    @classmethod
    def _link(cls, crop, entry, *, rejected_version=None):
        cls.crop_model._base_manager.filter(pk=crop.pk).update(
            source_public_crop=entry,
            source_public_version=entry.version,
            rejected_public_version=rejected_version,
            is_modified_from_source=True,
        )

    def _migrated(self, crop):
        return self.new_apps.get_model('farm', 'Crop')._base_manager.get(pk=crop.pk)

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
