from datetime import date, timedelta

from django.test import TestCase
from django.utils import timezone

from django.contrib.auth import get_user_model

from accounts.models import PublicProfile
from crops.models import CropSpecies
from farm.models import Bed, Crop, Field, Location, PlantingPlan, Project, PublicCrop, Supplier, Task, is_supplier_domain

User = get_user_model()

class SupplierModelTest(TestCase):
    def setUp(self):
        self.project = Project.objects.create(name='Supplier Test Project', slug='supplier-test-project')

    def _create_supplier(self, **kwargs) -> Supplier:
        defaults = {'project': self.project}
        defaults.update(kwargs)
        return Supplier.objects.create(**defaults)

    def test_supplier_creation(self):
        """Test creating a supplier"""
        supplier = self._create_supplier(name="Green Seeds Co.", homepage_url="https://green.example")
        self.assertEqual(str(supplier), "Green Seeds Co.")
        self.assertEqual(supplier.name, "Green Seeds Co.")

    def test_supplier_name_normalization(self):
        """Test that supplier names are normalized (lowercased, stripped)"""
        supplier = self._create_supplier(name="  ACME Seeds  ", homepage_url="https://acme.example")
        self.assertEqual(supplier.name_normalized, "acme seeds")

    def test_supplier_normalization_removes_legal_suffixes(self):
        """Test that legal suffixes are removed from normalized names"""
        supplier1 = self._create_supplier(name="Green Inc.", homepage_url="https://green-inc.example")
        self.assertEqual(supplier1.name_normalized, "green")
        
        supplier2 = self._create_supplier(name="Farm Ltd", homepage_url="https://farm.example")
        self.assertEqual(supplier2.name_normalized, "farm")
        
        supplier3 = self._create_supplier(name="Seeds GmbH", homepage_url="https://seeds.example")
        self.assertEqual(supplier3.name_normalized, "seeds")

    def test_supplier_normalization_deduplication(self):
        """Test that suppliers with same normalized name cannot be created"""
        from django.db import IntegrityError
        
        self._create_supplier(name="ACME Seeds", homepage_url="https://acme.example")
        
        # Try to create another with same normalized name
        with self.assertRaises(IntegrityError):
            self._create_supplier(name="acme seeds", homepage_url="https://acme-2.example")


    def test_supplier_slug_and_allowed_domains_derived_from_homepage(self):
        supplier = self._create_supplier(name="ReinSaat GmbH", homepage_url="https://www.reinsaat.at")
        self.assertEqual(supplier.slug, 'reinsaat')
        self.assertEqual(supplier.allowed_domains, ['reinsaat.at', 'www.reinsaat.at'])

    def test_supplier_allowed_domains_can_be_set_and_normalized(self):
        supplier = self._create_supplier(
            name="Domain Supplier",
            homepage_url="https://example.org",
            allowed_domains=['HTTP://Shop.Example.ORG/path']
        )
        self.assertEqual(supplier.allowed_domains, ['shop.example.org', 'www.shop.example.org'])

    def test_is_supplier_domain_helper(self):
        supplier = self._create_supplier(name="Demo Supplier", homepage_url="https://www.reinsaat.at")
        self.assertTrue(is_supplier_domain('https://shop.reinsaat.at/product', supplier))
        self.assertFalse(is_supplier_domain('https://other.example/product', supplier))

class LocationModelTest(TestCase):
    def setUp(self):
        self.project = Project.objects.create(name='Location Test Project', slug='location-test-project')

    def test_location_creation(self):
        location = Location.objects.create(
            name="Main Farm",
            address="123 Farm Road",
            description="Acker hinter Hof",
            soil_type=Location.SOIL_TYPE_LOAM,
            exposure=Location.EXPOSURE_SOUTH,
            project=self.project,
        )
        self.assertEqual(str(location), "Main Farm")
        self.assertEqual(location.name, "Main Farm")
        self.assertEqual(location.soil_type, Location.SOIL_TYPE_LOAM)
        self.assertEqual(location.exposure, Location.EXPOSURE_SOUTH)


class FieldModelTest(TestCase):
    def setUp(self):
        self.project = Project.objects.create(name='Field Test Project', slug='field-test-project')
        self.location = Location.objects.create(name="Test Location", project=self.project)

    def test_field_creation(self):
        field = Field.objects.create(
            name="North Field",
            location=self.location,
            area_sqm=1000.50,
            project=self.project,
        )
        self.assertEqual(str(field), "Test Location - North Field")
    
    def test_field_area_validation_too_small(self):
        from django.core.exceptions import ValidationError
        field = Field(
            name="Tiny Field",
            location=self.location,
            area_sqm=0.001  # Less than MIN_AREA_SQM (0.01)
        )
        with self.assertRaises(ValidationError) as cm:
            field.full_clean()
        self.assertIn('area_sqm', cm.exception.message_dict)
    
    def test_field_area_validation_too_large(self):
        from django.core.exceptions import ValidationError
        field = Field(
            name="Huge Field",
            location=self.location,
            area_sqm=2000000  # Greater than MAX_AREA_SQM (1,000,000)
        )
        with self.assertRaises(ValidationError) as cm:
            field.full_clean()
        self.assertIn('area_sqm', cm.exception.message_dict)
    
    def test_field_area_validation_valid_range(self):
        # Test minimum valid value
        field_min = Field.objects.create(
            name="Min Field",
            location=self.location,
            area_sqm=0.01,
            project=self.project,
        )
        self.assertEqual(field_min.area_sqm, 0.01)
        
        # Test a large valid value (max_digits=10, decimal_places=2 means max 8 digits before decimal)
        field_large = Field.objects.create(
            name="Large Field",
            location=self.location,
            area_sqm=12345678.90,
            project=self.project,
        )
        self.assertEqual(field_large.area_sqm, 12345678.90)


class BedModelTest(TestCase):
    def setUp(self):
        self.project = Project.objects.create(name='Bed Test Project', slug='bed-test-project')
        self.location = Location.objects.create(name="Test Location", project=self.project)
        self.field = Field.objects.create(name="Test Field", location=self.location, project=self.project)

    def test_bed_creation(self):
        bed = Bed.objects.create(
            name="Bed A",
            field=self.field,
            area_sqm=12.0,
            project=self.project,
        )
        self.assertEqual(str(bed), "Test Field - Bed A")
    
    def test_bed_area_validation_too_small(self):
        from django.core.exceptions import ValidationError
        bed = Bed(
            name="Tiny Bed",
            field=self.field,
            area_sqm=0.001  # Less than MIN_AREA_SQM (0.01)
        )
        with self.assertRaises(ValidationError):
            bed.full_clean()
    
    def test_bed_area_validation_too_large(self):
        from django.core.exceptions import ValidationError
        bed = Bed(
            name="Huge Bed",
            field=self.field,
            area_sqm=20000  # Greater than MAX_AREA_SQM (10,000)
        )
        with self.assertRaises(ValidationError):
            bed.full_clean()
    
    def test_bed_area_validation_valid_range(self):
        # Test minimum valid value
        bed_min = Bed.objects.create(
            name="Min Bed",
            field=self.field,
            area_sqm=0.01,
            project=self.project,
        )
        self.assertEqual(bed_min.area_sqm, 0.01)
        
        # Test a large valid value within MAX_AREA_SQM
        bed_large = Bed.objects.create(
            name="Large Bed",
            field=self.field,
            area_sqm=9999.99,
            project=self.project,
        )
        self.assertEqual(bed_large.area_sqm, 9999.99)

    def test_bed_get_total_area(self):
        bed = Bed.objects.create(
            name="Bed B",
            field=self.field,
            area_sqm=15.0,
            project=self.project,
        )
        self.assertEqual(bed.get_total_area(), 15.0)

    def test_bed_get_total_area_no_dimensions(self):
        bed = Bed.objects.create(
            name="Bed C",
            field=self.field,
            project=self.project,
        )
        self.assertIsNone(bed.get_total_area())




class CropModelTest(TestCase):
    def setUp(self):
        self.project = Project.objects.create(name='Crop Test Project', slug='crop-test-project')

    def test_crop_creation_with_variety(self):
        crop = Crop.objects.create(
            name="Tomato",
            variety="Cherry",
            growth_duration_days=8,
            harvest_duration_days=4,
            project=self.project,
        )
        self.assertEqual(str(crop), "Tomato (Cherry)")
    
    def test_crop_creation_without_variety(self):
        """Test creating a crop without a variety"""
        crop = Crop.objects.create(
            name="Lettuce",
            growth_duration_days=4,
            harvest_duration_days=2,
            project=self.project,
        )
        self.assertEqual(str(crop), "Lettuce")
    
    def test_crop_with_manual_planning_fields(self):
        """Test creating a crop with all manual planning fields"""
        crop = Crop.objects.create(
            name="Broccoli",
            variety="Calabrese",
            notes="Great for winter growing",
            crop_family_id="Brassicaceae",
            nutrient_demand="high",
            rotation_break_years=4,
            cultivation_type="pre_cultivation",
            growth_duration_days=10,
            harvest_duration_days=3,
            propagation_duration_days=4,
            harvest_method="per_plant",
            expected_yield=500.0,
            distance_within_row_m=0.40,  # 40 cm = 0.40 m
            row_spacing_m=0.60,  # 60 cm = 0.60 m
            sowing_depth_m=0.015,  # 1.5 cm = 0.015 m
            project=self.project,
        )
        self.assertEqual(crop.name, "Broccoli")
        self.assertEqual(crop.crop_family_id, "Brassicaceae")
        self.assertEqual(crop.nutrient_demand, "high")
        self.assertEqual(crop.rotation_break_years, 4)
        self.assertEqual(crop.cultivation_type, "pre_cultivation")
        self.assertEqual(crop.growth_duration_days, 10)
        self.assertEqual(crop.harvest_duration_days, 3)
        self.assertEqual(crop.propagation_duration_days, 4)
        self.assertEqual(crop.harvest_method, "per_plant")
        self.assertEqual(float(crop.expected_yield), 500.0)
        self.assertAlmostEqual(crop.distance_within_row_m, 0.40, places=4)
        self.assertAlmostEqual(crop.row_spacing_m, 0.60, places=4)
        self.assertAlmostEqual(crop.sowing_depth_m, 0.015, places=4)
    
    def test_display_color_auto_generation(self):
        """Test that display color is automatically generated on creation"""
        crop = Crop.objects.create(
            name="Carrot",
            growth_duration_days=10,
            harvest_duration_days=3,
            project=self.project,
        )
        self.assertIsNotNone(crop.display_color)
        self.assertTrue(crop.display_color.startswith('#'))
        self.assertEqual(len(crop.display_color), 7)
    
    def test_display_color_custom_preserved(self):
        """Test that custom display color is preserved"""
        custom_color = "#FF5733"
        crop = Crop.objects.create(
            name="Lettuce",
            growth_duration_days=4,
            harvest_duration_days=2,
            display_color=custom_color,
            project=self.project,
        )
        self.assertEqual(crop.display_color, custom_color)
    
    def test_display_color_distinct_for_multiple_crops(self):
        """Test that generated colors are distinct"""
        colors = set()
        for i in range(10):
            crop = Crop.objects.create(
                name=f"Crop {i}",
                growth_duration_days=4,
                harvest_duration_days=2,
                project=self.project,
            )
            colors.add(crop.display_color)
        
        # All colors should be unique
        self.assertEqual(len(colors), 10)
    
    def test_negative_numeric_fields_validation(self):
        """Test that negative values for numeric fields are rejected"""
        from django.core.exceptions import ValidationError
        
        crop = Crop(
            name="Lettuce",
            growth_duration_days=-1,
            harvest_duration_days=2
        )
        with self.assertRaises(ValidationError) as context:
            crop.clean()
        self.assertIn('growth_duration_days', context.exception.message_dict)

    def test_negative_rotation_break_years_validation(self):
        """Test that a negative rotation break in years is rejected"""
        from django.core.exceptions import ValidationError

        crop = Crop(
            name="Lettuce",
            growth_duration_days=4,
            harvest_duration_days=2,
            rotation_break_years=-1,
        )
        with self.assertRaises(ValidationError) as context:
            crop.clean()
        self.assertIn('rotation_break_years', context.exception.message_dict)


    def test_display_color_format_validation(self):
        """Test that display color must be in hex format"""
        from django.core.exceptions import ValidationError
        
        # Invalid color format
        crop = Crop(
            name="Tomato",
            growth_duration_days=8,
            harvest_duration_days=4,
            display_color="invalid"
        )
        with self.assertRaises(ValidationError) as context:
            crop.clean()
        self.assertIn('display_color', context.exception.message_dict)
        
        # Valid color format
        crop2 = Crop(
            name="Tomato",
            growth_duration_days=8,
            harvest_duration_days=4,
            harvest_method='per_sqm',
            display_color="#FF5733"
        )
        crop2.clean()  # Should not raise


    def test_harvest_duration_does_not_require_harvest_method(self):
        crop = Crop(
            name='Kohl',
            variety='Türkis',
            growth_duration_days=90,
            harvest_duration_days=21,
        )

        crop.clean()



class PlantingPlanModelTest(TestCase):
    def setUp(self):
        self.project = Project.objects.create(name='Planting Plan Test Project', slug='planting-plan-test-project')
        self.location = Location.objects.create(name="Test Location", project=self.project)
        self.field = Field.objects.create(name="Test Field", location=self.location, project=self.project)
        self.bed = Bed.objects.create(
            name="Test Bed",
            field=self.field,
            area_sqm=20.0,  # Total area: 20 sqm
            project=self.project,
        )
        self.crop = Crop.objects.create(
            name="Carrot",
            growth_duration_days=70,
            harvest_duration_days=3,
            project=self.project,
        )

    def test_auto_harvest_date(self):
        planting_date = date(2024, 3, 1)
        plan = PlantingPlan.objects.create(
            crop=self.crop,
            bed=self.bed,
            planting_date=planting_date,
            quantity=100,
            project=self.project,
        )
        expected_harvest = planting_date + timedelta(days=70)
        self.assertEqual(plan.harvest_date, expected_harvest)

    def test_harvest_date_recalculates_when_planting_date_changes(self):
        """Test that harvest dates recalculate when planting_date changes"""
        planting_date = date(2024, 3, 1)
        plan = PlantingPlan.objects.create(
            crop=self.crop,
            bed=self.bed,
            planting_date=planting_date,
            quantity=100,
            project=self.project,
        )
        expected_harvest = planting_date + timedelta(days=70)
        self.assertEqual(plan.harvest_date, expected_harvest)
        
        # Change planting date
        new_planting_date = date(2024, 4, 1)
        plan.planting_date = new_planting_date
        plan.save()
        
        # Harvest date should recalculate
        new_expected_harvest = new_planting_date + timedelta(days=70)
        self.assertEqual(plan.harvest_date, new_expected_harvest)
    
    def test_harvest_date_recalculates_when_crop_changes(self):
        """Test that harvest dates recalculate when crop changes"""
        planting_date = date(2024, 3, 1)
        plan = PlantingPlan.objects.create(
            crop=self.crop,
            bed=self.bed,
            planting_date=planting_date,
            quantity=100,
            project=self.project,
        )
        expected_harvest = planting_date + timedelta(days=70)
        self.assertEqual(plan.harvest_date, expected_harvest)
        
        # Create new crop with different harvest days
        new_crop = Crop.objects.create(
            name="Tomato",
            growth_duration_days=90,
            harvest_duration_days=2,
            project=self.project,
        )
        plan.crop = new_crop
        plan.save()
        
        # Harvest date should recalculate with new crop's timing
        new_expected_harvest = planting_date + timedelta(days=90)
        self.assertEqual(plan.harvest_date, new_expected_harvest)

    def test_harvest_dates_recalculate_when_crop_timing_changes(self):
        planting_date = date(2024, 3, 1)
        plan = PlantingPlan.objects.create(
            crop=self.crop,
            bed=self.bed,
            planting_date=planting_date,
            quantity=100,
            project=self.project,
        )

        self.crop.growth_duration_days = 80
        self.crop.harvest_duration_days = 5
        self.crop.save(update_fields=['growth_duration_days', 'harvest_duration_days'])

        plan.refresh_from_db()
        expected_harvest_start = planting_date + timedelta(days=80)
        self.assertEqual(plan.harvest_date, expected_harvest_start)
        self.assertEqual(plan.harvest_end_date, expected_harvest_start + timedelta(days=5))

    def test_inheriting_sorte_harvest_dates_recalculate_when_general_crop_timing_changes(self):
        species = CropSpecies.objects.create(name='Parsnip')
        general_crop = Crop.objects.create(
            name='Parsnip',
            variety='',
            crop_species=species,
            growth_duration_days=70,
            harvest_duration_days=21,
            project=self.project,
        )
        sorte = Crop.objects.create(
            name='Parsnip',
            variety='Nantaise',
            crop_species=species,
            project=self.project,
        )
        own_harvest_sorte = Crop.objects.create(
            name='Parsnip',
            variety='Nantaise Early',
            crop_species=species,
            harvest_duration_days=5,
            project=self.project,
        )
        planting_date = date(2024, 3, 1)
        inherited_plan = PlantingPlan.objects.create(
            crop=sorte,
            bed=self.bed,
            planting_date=planting_date,
            quantity=100,
            project=self.project,
        )
        own_harvest_plan = PlantingPlan.objects.create(
            crop=own_harvest_sorte,
            bed=self.bed,
            planting_date=planting_date,
            quantity=100,
            project=self.project,
        )

        general_crop.harvest_duration_days = 30
        general_crop.save(update_fields=['harvest_duration_days'])

        inherited_plan.refresh_from_db()
        own_harvest_plan.refresh_from_db()
        self.assertEqual(inherited_plan.harvest_end_date, planting_date + timedelta(days=100))
        self.assertEqual(own_harvest_plan.harvest_end_date, planting_date + timedelta(days=75))
    
    def test_harvest_end_date_with_growth_and_harvest_duration(self):
        """Test that harvest_end_date is calculated from growth + harvest duration."""
        crop_with_median = Crop.objects.create(
            name="Broccoli",
            growth_duration_days=65,
            harvest_duration_days=25,
            project=self.project,
        )
        planting_date = date(2024, 3, 1)
        plan = PlantingPlan.objects.create(
            crop=crop_with_median,
            bed=self.bed,
            planting_date=planting_date,
            quantity=100,
            project=self.project,
        )
        
        expected_harvest_start = planting_date + timedelta(days=65)
        self.assertEqual(plan.harvest_date, expected_harvest_start)
        
        expected_harvest_end = expected_harvest_start + timedelta(days=25)
        self.assertEqual(plan.harvest_end_date, expected_harvest_end)
    
    def test_harvest_end_date_defaults_to_harvest_date(self):
        """Test harvest_end_date calculation when both crop durations exist."""
        planting_date = date(2024, 3, 1)
        plan = PlantingPlan.objects.create(
            crop=self.crop,
            bed=self.bed,
            planting_date=planting_date,
            quantity=100,
            project=self.project,
        )
        
        self.assertEqual(plan.harvest_end_date, plan.harvest_date + timedelta(days=3))

    def test_harvest_dates_are_null_without_crop_timing(self):
        crop_without_timing = Crop.objects.create(
            name="Unknown timing",
            project=self.project,
        )
        planting_date = date(2024, 3, 1)
        plan = PlantingPlan.objects.create(
            crop=crop_without_timing,
            bed=self.bed,
            planting_date=planting_date,
            quantity=100,
            project=self.project,
        )

        self.assertEqual(plan.planting_date, planting_date)
        self.assertIsNone(plan.harvest_date)
        self.assertIsNone(plan.harvest_end_date)
        self.assertIsNone(plan._get_active_period())

    def test_partial_crop_timing_calculates_only_available_harvest_date(self):
        crop_without_harvest_duration = Crop.objects.create(
            name="Partial timing",
            growth_duration_days=30,
            project=self.project,
        )
        planting_date = date(2024, 3, 1)
        plan = PlantingPlan.objects.create(
            crop=crop_without_harvest_duration,
            bed=self.bed,
            planting_date=planting_date,
            quantity=100,
            project=self.project,
        )

        self.assertEqual(plan.harvest_date, planting_date + timedelta(days=30))
        self.assertIsNone(plan.harvest_end_date)
        self.assertIsNone(plan._get_active_period())

    def test_explicit_zero_durations_are_valid_harvest_periods(self):
        crop_with_zero_timing = Crop.objects.create(
            name="Zero timing",
            growth_duration_days=0,
            harvest_duration_days=0,
            project=self.project,
        )
        planting_date = date(2024, 3, 1)
        plan = PlantingPlan.objects.create(
            crop=crop_with_zero_timing,
            bed=self.bed,
            planting_date=planting_date,
            quantity=100,
            project=self.project,
        )

        self.assertEqual(plan.harvest_date, planting_date)
        self.assertEqual(plan.harvest_end_date, planting_date)
        self.assertEqual(plan._get_active_period(), (planting_date, planting_date))

    def test_area_usage_no_bed_dimensions(self):
        """Test that validation is skipped when bed has no dimensions"""
        from django.core.exceptions import ValidationError
        
        bed_no_dims = Bed.objects.create(name="No Dims Bed", field=self.field, project=self.project)
        plan = PlantingPlan(
            crop=self.crop,
            bed=bed_no_dims,
            planting_date=date(2024, 3, 1),
            area_usage_sqm=100.0,  # Large value, but should be allowed
            project=self.project,
        )
        # Should not raise ValidationError since bed has no dimensions
        plan.clean()
        plan.save()



class TaskModelTest(TestCase):
    def setUp(self):
        self.project = Project.objects.create(name='Task Test Project', slug='task-test-project')

    def test_task_creation(self):
        task = Task.objects.create(
            title="Water plants",
            description="Water all beds in field A",
            status="pending",
            project=self.project,
        )
        self.assertEqual(str(task), "Water plants (pending)")
        self.assertEqual(task.status, "pending")


class PublicCropAttributionTest(TestCase):
    """created_by_label must never surface an email, username, or private name (privacy-sensitive);
    it only ever shows the user's explicitly-set public display name, or nothing (anonymous)."""

    def test_label_is_empty_when_no_public_display_name_is_set(self):
        user = User.objects.create_user(
            username='market_gardener_ab12cd34',
            email='real.person@example.com',
            first_name='Real',
            last_name='Person',
        )
        crop = PublicCrop.objects.create(name='Lettuce', created_by=user)

        self.assertEqual(crop.created_by_label, '')

    def test_label_is_the_public_display_name_when_set(self):
        user = User.objects.create_user(username='market_gardener_ab12cd34', email='real.person@example.com')
        PublicProfile.objects.create(user=user, public_display_name='Grüner Hof')
        crop = PublicCrop.objects.create(name='Lettuce', created_by=user)

        self.assertEqual(crop.created_by_label, 'Grüner Hof')
        self.assertNotIn('@', crop.created_by_label)

    def test_label_is_empty_when_no_creator_is_set(self):
        crop = PublicCrop.objects.create(name='Carrot', created_by=None)

        self.assertEqual(crop.created_by_label, '')

    def test_label_is_anonymous_after_account_anonymization(self):
        """An anonymized user's public library entries fall back to anonymous
        attribution, even if a public display name had been set previously."""
        user = User.objects.create_user(username='former_user_11223344', email='deleted-user-1@deleted.local')
        PublicProfile.objects.create(user=user, public_display_name='Grüner Hof')
        crop = PublicCrop.objects.create(name='Kale', created_by=user)

        PublicProfile.objects.filter(user=user).update(public_display_name='')
        crop = PublicCrop.objects.get(pk=crop.pk)

        self.assertEqual(crop.created_by_label, '')


class CropNormalizedFieldsTest(TestCase):
    """Tests for Crop model normalized fields."""
    def setUp(self):
        self.project = Project.objects.create(name='Crop Normalization Project', slug='crop-normalization-project')
    
    def test_crop_normalized_fields_populated(self):
        """Test that normalized fields are populated on save."""
        crop = Crop.objects.create(
            name="  Tomato  ",
            variety="  Cherry  ",
            growth_duration_days=60,
            harvest_duration_days=30,
            project=self.project,
        )
        
        self.assertEqual(crop.name_normalized, "tomato")
        self.assertEqual(crop.variety_normalized, "cherry")
    
    def test_crop_normalized_empty_variety(self):
        """Test normalized fields with empty variety."""
        crop = Crop.objects.create(
            name="Carrot",
            variety="",
            growth_duration_days=60,
            harvest_duration_days=30,
            project=self.project,
        )
        
        self.assertEqual(crop.name_normalized, "carrot")
        self.assertIsNone(crop.variety_normalized)
    
    def test_crop_unique_constraint(self):
        """Test unique constraint on normalized fields."""
        from django.db import IntegrityError
        
        supplier = Supplier.objects.create(name="Test Supplier", project=self.project)
        
        Crop.objects.create(
            name="Tomato",
            variety="Cherry",
            supplier=supplier,
            growth_duration_days=60,
            harvest_duration_days=30,
            project=self.project,
        )
        
        # Try to create duplicate with same normalized values
        with self.assertRaises(IntegrityError):
            Crop.objects.create(
                name="TOMATO",  # Different case
                variety="cherry",  # Different case
                supplier=supplier,
                growth_duration_days=60,
                harvest_duration_days=30,
                project=self.project,
            )
    
    def test_crop_unique_constraint_different_supplier(self):
        """Test that same crop with different supplier is allowed."""
        supplier1 = Supplier.objects.create(name="Supplier 1", project=self.project)
        supplier2 = Supplier.objects.create(name="Supplier 2", project=self.project)
        
        crop1 = Crop.objects.create(
            name="Tomato",
            variety="Cherry",
            supplier=supplier1,
            growth_duration_days=60,
            harvest_duration_days=30,
            project=self.project,
        )
        
        crop2 = Crop.objects.create(
            name="Tomato",
            variety="Cherry",
            supplier=supplier2,
            growth_duration_days=60,
            harvest_duration_days=30,
            project=self.project,
        )
        
        self.assertNotEqual(crop1.id, crop2.id)
