from datetime import date
from decimal import Decimal
from typing import ClassVar

import pytest
from django.apps.registry import Apps

from farm.tests.migration_base import MigrationTestBase


@pytest.mark.django_db
class TestGrowingAreaGeometryVersionMigration(MigrationTestBase):
    migrate_from: ClassVar = [('farm', '0174_add_individual_removal_batch_type')]
    migrate_to: ClassVar = [('farm', '0175_growing_area_geometry_version')]

    @classmethod
    def seed_before_migration(cls, apps: Apps) -> None:
        project = apps.get_model('farm', 'Project').objects.create(
            name='Legacy geometry', slug='legacy-geometry',
        )
        location_model = apps.get_model('farm', 'Location')
        field_model = apps.get_model('farm', 'Field')
        bed_model = apps.get_model('farm', 'Bed')
        cls.measured_site = location_model.objects.create(
            project=project, name='Measured site', length_m=40, width_m=25.5,
        )
        cls.partial_site = location_model.objects.create(
            project=project, name='Partial site', length_m=12,
        )
        cls.declared_parcel = field_model.objects.create(
            project=project, location=cls.measured_site, name='Declared', area_sqm=Decimal('80.0'),
        )
        cls.measured_parcel = field_model.objects.create(
            project=project, location=cls.measured_site, name='Measured',
            length_m=10, width_m=8, area_sqm=Decimal('80.0'),
        )
        cls.bed = bed_model.objects.create(
            project=project, field=cls.measured_parcel, name='Bed 42',
            length_m=10, width_m=1, area_sqm=Decimal('10.0'),
        )
        # Written behind the model's back: the stored area contradicts the sides.
        cls.contradictory_bed = bed_model.objects.create(
            project=project, field=cls.measured_parcel, name='Contradictory',
            length_m=4, width_m=1, area_sqm=Decimal('9.0'),
        )
        cls.zero_bed = bed_model.objects.create(
            project=project, field=cls.declared_parcel, name='Zero', length_m=0, width_m=2,
        )
        cls.empty_bed = bed_model.objects.create(
            project=project, field=cls.declared_parcel, name='Empty',
        )

    def _version(self, **owner):
        return self.new_apps.get_model('farm', 'GrowingAreaGeometryVersion').objects.get(**owner)

    def test_records_one_observation_per_area_at_the_cutover(self):
        versions = self.new_apps.get_model('farm', 'GrowingAreaGeometryVersion').objects
        assert versions.count() == 8
        assert set(versions.values_list('effective_from', flat=True)) == {date.today()}
        assert set(versions.values_list('origin', flat=True)) == {'legacy_observation'}
        assert set(versions.values_list('state', flat=True)) == {'active'}

    def test_measured_rows_keep_their_sides_and_derived_area(self):
        site = self._version(location_id=self.measured_site.pk)
        assert (site.length_m, site.width_m) == (40, 25.5)
        assert site.confirmed_area_sqm == Decimal('1020.00')
        assert site.measurement_basis == 'dimensions'
        assert site.parent_location_id is None and site.parent_field_id is None
        bed = self._version(bed_id=self.bed.pk)
        assert bed.confirmed_area_sqm == Decimal('10.0')
        assert bed.measurement_basis == 'dimensions'
        assert bed.parent_field_id == self.measured_parcel.pk

    def test_declared_area_and_parent_are_kept(self):
        parcel = self._version(field_id=self.declared_parcel.pk)
        assert parcel.measurement_basis == 'declared_area'
        assert parcel.confirmed_area_sqm == Decimal('80.0')
        assert parcel.length_m is None and parcel.width_m is None
        assert parcel.parent_location_id == self.measured_site.pk

    def test_absent_zero_and_contradictory_evidence_stays_unknown(self):
        contradictory = self._version(bed_id=self.contradictory_bed.pk)
        assert contradictory.measurement_basis == 'unknown'
        assert contradictory.confirmed_area_sqm is None
        assert contradictory.length_m is None and contradictory.width_m is None
        zero = self._version(bed_id=self.zero_bed.pk)
        assert zero.measurement_basis == 'unknown'
        assert zero.length_m is None and zero.width_m == 2
        assert self._version(bed_id=self.empty_bed.pk).measurement_basis == 'unknown'
        partial = self._version(location_id=self.partial_site.pk)
        assert partial.measurement_basis == 'unknown'
        assert partial.length_m == 12 and partial.confirmed_area_sqm is None

    def test_present_measurements_are_left_unchanged(self):
        beds = self.new_apps.get_model('farm', 'Bed').objects
        contradictory = beds.get(pk=self.contradictory_bed.pk)
        assert contradictory.area_sqm == Decimal('9.0')
        assert (contradictory.length_m, contradictory.width_m) == (4, 1)
