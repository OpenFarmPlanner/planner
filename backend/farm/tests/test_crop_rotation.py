"""Crop rotation (Fruchtfolge) rules, acceptance, and the rotation endpoints.

The pure rule tests drive :func:`evaluate_rotation` directly with hand-built
occupancies; the API tests below go through the real plant-family list that
the migrations seed (Brassicaceae 4 years, Amaryllidaceae 3, Poaceae none).
"""

from datetime import date

from django.test import SimpleTestCase
from django.utils import timezone
from rest_framework import status

from crops.models import CropSpecies
from farm.models import Bed, Crop, PlantingPlan, Season
from farm.services.crop_rotation import (
    BREAK_SOURCE_CROP,
    BREAK_SOURCE_FAMILY,
    KIND_FAMILY_CONFLICT,
    KIND_NO_BREAK,
    KIND_NO_FAMILY,
    KIND_NO_HISTORY,
    KIND_NUTRIENT_HINT,
    KIND_OK,
    STATUS_ACCEPTED,
    STATUS_CONFLICT,
    STATUS_HINT,
    STATUS_INFO,
    STATUS_OK,
    RotationCrop,
    RotationOccupancy,
    evaluate_rotation,
)
from farm.tests.api_base import ProjectApiTestCase


def rotation_crop(
    crop_id: int,
    label: str,
    family: str | None = 'Brassicaceae',
    break_years: int | None = 3,
    break_source: str | None = BREAK_SOURCE_FAMILY,
    nutrient_demand: str = '',
    is_soil_improver: bool = False,
) -> RotationCrop:
    return RotationCrop(
        crop_id=crop_id,
        label=label,
        family_key=family,
        family_name=family,
        break_years=break_years,
        break_source=break_source if break_years is not None else None,
        settings_crop_id=crop_id,
        settings_crop_label=label,
        nutrient_demand=nutrient_demand,
        is_soil_improver=is_soil_improver,
    )


def occupancy(
    plan_id: int,
    crop: RotationCrop,
    start: date,
    end: date | None = None,
    bed_id: int = 1,
) -> RotationOccupancy:
    return RotationOccupancy(plan_id=plan_id, bed_id=bed_id, start=start, end=end or start, crop=crop)


CABBAGE = rotation_crop(1, 'Kohl', nutrient_demand='high')
MUSTARD = rotation_crop(2, 'Senf')
CARROT = rotation_crop(3, 'Karotte', family='Apiaceae', nutrient_demand='low')
GARLIC = rotation_crop(4, 'Knoblauch', family='Amaryllidaceae')
ONION = rotation_crop(5, 'Zwiebel', family='Amaryllidaceae')
BEAN = rotation_crop(6, 'Bohne', family='Fabaceae', is_soil_improver=True)
TOMATO = rotation_crop(7, 'Tomate', family='Solanaceae', nutrient_demand='high')


class RotationRuleTest(SimpleTestCase):
    """The rules of docs/crop-rotation.md, without the database."""

    def test_same_family_within_break_is_a_conflict_with_earliest_year(self):
        result = evaluate_rotation(
            occupancy(10, CABBAGE, date(2026, 4, 1), date(2026, 8, 1)),
            [occupancy(1, MUSTARD, date(2025, 5, 1), date(2025, 7, 1))],
        )

        self.assertEqual(result.status, STATUS_CONFLICT)
        finding = result.findings[0]
        self.assertEqual(finding.kind, KIND_FAMILY_CONFLICT)
        self.assertEqual(finding.previous_crop_label, 'Senf')
        self.assertEqual(finding.year, 2025)
        self.assertEqual(finding.break_years, 3)
        self.assertEqual(finding.earliest_year, 2029)
        self.assertEqual(finding.break_source, BREAK_SOURCE_FAMILY)

    def test_family_is_allowed_again_from_last_year_plus_break_plus_one(self):
        result = evaluate_rotation(
            occupancy(10, CABBAGE, date(2029, 4, 1)),
            [
                occupancy(1, MUSTARD, date(2025, 5, 1)),
                occupancy(2, CARROT, date(2028, 4, 1)),
            ],
        )

        self.assertEqual(result.status, STATUS_OK)
        finding = result.findings[0]
        self.assertEqual(finding.kind, KIND_OK)
        self.assertEqual(finding.year, 2025)
        self.assertEqual(finding.previous_crop_label, 'Karotte')

    def test_same_year_is_a_conflict_when_break_is_at_least_one(self):
        one_year = rotation_crop(1, 'Kohl', break_years=1)

        result = evaluate_rotation(
            occupancy(10, one_year, date(2026, 8, 1)),
            [occupancy(1, one_year, date(2026, 4, 1))],
        )

        self.assertEqual(result.status, STATUS_CONFLICT)
        self.assertEqual(result.findings[0].earliest_year, 2028)

    def test_break_of_zero_never_conflicts(self):
        no_break = rotation_crop(1, 'Kohl', break_years=0, break_source=BREAK_SOURCE_CROP)

        result = evaluate_rotation(
            occupancy(10, no_break, date(2026, 8, 1)),
            [occupancy(1, no_break, date(2026, 4, 1))],
        )

        self.assertEqual(result.status, STATUS_OK)

    def test_plan_across_year_boundary_occupies_both_years(self):
        """Garlic planted in October and harvested in July blocks its family
        from its harvest year on, not only from its planting year."""
        garlic = occupancy(1, GARLIC, date(2025, 10, 15), date(2026, 7, 15))

        result = evaluate_rotation(occupancy(10, ONION, date(2029, 4, 1)), [garlic])

        self.assertEqual(result.status, STATUS_CONFLICT)
        self.assertEqual(result.findings[0].year, 2026)
        self.assertEqual(result.findings[0].earliest_year, 2030)

    def test_plan_across_year_boundary_conflicts_with_a_plan_in_its_second_year(self):
        garlic = occupancy(1, GARLIC, date(2025, 10, 15), date(2026, 7, 15))
        onion = occupancy(2, ONION, date(2026, 4, 1), date(2026, 9, 1))

        self.assertEqual(evaluate_rotation(onion, [garlic]).status, STATUS_CONFLICT)
        # Both occupy 2026, so the earlier plan is flagged for the later one too.
        self.assertEqual(evaluate_rotation(garlic, [onion]).status, STATUS_CONFLICT)

    def test_a_later_plan_does_not_flag_an_earlier_one(self):
        earlier = occupancy(1, CABBAGE, date(2025, 4, 1))
        later = occupancy(2, MUSTARD, date(2026, 4, 1))

        self.assertEqual(evaluate_rotation(later, [earlier]).status, STATUS_CONFLICT)
        self.assertNotEqual(evaluate_rotation(earlier, [later]).status, STATUS_CONFLICT)

    def test_break_from_the_culture_is_reported_as_such(self):
        own_break = rotation_crop(1, 'Kohl', break_years=5, break_source=BREAK_SOURCE_CROP)

        result = evaluate_rotation(
            occupancy(10, own_break, date(2026, 4, 1)),
            [occupancy(1, MUSTARD, date(2022, 4, 1))],
        )

        finding = result.findings[0]
        self.assertEqual(finding.break_years, 5)
        self.assertEqual(finding.break_source, BREAK_SOURCE_CROP)
        self.assertEqual(finding.crop_label, 'Kohl')
        self.assertEqual(finding.earliest_year, 2028)

    def test_stricter_break_of_the_previous_culture_wins(self):
        short = rotation_crop(1, 'Radieschen', break_years=1, break_source=BREAK_SOURCE_CROP)
        strict = rotation_crop(2, 'Rosenkohl', break_years=4, break_source=BREAK_SOURCE_CROP)

        result = evaluate_rotation(
            occupancy(10, short, date(2026, 4, 1)),
            [occupancy(1, strict, date(2023, 4, 1))],
        )

        self.assertEqual(result.status, STATUS_CONFLICT)
        finding = result.findings[0]
        self.assertEqual(finding.break_years, 4)
        self.assertEqual(finding.crop_label, 'Rosenkohl')
        self.assertEqual(finding.earliest_year, 2028)

    def test_missing_family_is_info_not_ok(self):
        unknown = rotation_crop(1, 'Unbekannt', family=None, break_years=None)

        result = evaluate_rotation(
            occupancy(10, unknown, date(2026, 4, 1)),
            [occupancy(1, CABBAGE, date(2025, 4, 1))],
        )

        self.assertEqual(result.status, STATUS_INFO)
        self.assertEqual(result.findings[0].kind, KIND_NO_FAMILY)

    def test_missing_break_is_info(self):
        grass = rotation_crop(1, 'Mais', family='Poaceae', break_years=None)

        result = evaluate_rotation(
            occupancy(10, grass, date(2026, 4, 1)),
            [occupancy(1, grass, date(2025, 4, 1))],
        )

        self.assertEqual(result.status, STATUS_INFO)
        self.assertEqual(result.findings[0].kind, KIND_NO_BREAK)

    def test_bed_without_history_in_the_checked_years_is_info(self):
        result = evaluate_rotation(
            occupancy(10, CABBAGE, date(2026, 4, 1)),
            [occupancy(1, CARROT, date(2020, 4, 1))],
        )

        self.assertEqual(result.status, STATUS_INFO)
        self.assertEqual(result.findings[0].kind, KIND_NO_HISTORY)

    def test_heavy_feeder_after_heavy_feeder_is_a_hint(self):
        result = evaluate_rotation(
            occupancy(10, TOMATO, date(2026, 5, 1)),
            [occupancy(1, CABBAGE, date(2025, 4, 1), date(2025, 9, 1))],
        )

        self.assertEqual(result.status, STATUS_HINT)
        self.assertEqual(result.findings[0].kind, KIND_NUTRIENT_HINT)
        self.assertEqual(result.findings[0].previous_crop_label, 'Kohl')

    def test_legume_in_between_suppresses_the_hint(self):
        result = evaluate_rotation(
            occupancy(10, TOMATO, date(2026, 5, 1)),
            [
                occupancy(1, CABBAGE, date(2025, 4, 1), date(2025, 7, 1)),
                occupancy(2, BEAN, date(2025, 7, 15), date(2025, 9, 30)),
            ],
        )

        self.assertEqual(result.status, STATUS_OK)

    def test_green_manure_counts_with_its_family(self):
        """Senf as green manure is still a Brassicaceae on the bed."""
        green_mustard = rotation_crop(2, 'Senf', is_soil_improver=True)

        result = evaluate_rotation(
            occupancy(10, CABBAGE, date(2026, 4, 1)),
            [occupancy(1, green_mustard, date(2025, 8, 1), date(2025, 10, 1))],
        )

        self.assertEqual(result.status, STATUS_CONFLICT)

    def test_accepted_conflict_keeps_its_findings(self):
        result = evaluate_rotation(
            occupancy(10, CABBAGE, date(2026, 4, 1)),
            [occupancy(1, MUSTARD, date(2025, 4, 1))],
            accepted=True,
        )

        self.assertEqual(result.status, STATUS_ACCEPTED)
        self.assertEqual(result.findings[0].kind, KIND_FAMILY_CONFLICT)


class CropRotationApiTest(ProjectApiTestCase):
    """Rotation status on planting plans, acceptance, and the rotation endpoints."""

    def setUp(self):
        super().setUp()
        self.season_2025 = Season.objects.create(
            project=self.project, start_date=date(2025, 1, 1), end_date=date(2025, 12, 31),
        )
        self.season_2026 = Season.objects.create(
            project=self.project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        )
        self.client.defaults['HTTP_X_SEASON_ID'] = str(self.season_2026.id)
        self.client.defaults['HTTP_ACCEPT_LANGUAGE'] = 'de'
        self.other_bed = Bed.objects.create(name='Beet 2', field=self.field, area_sqm=10, project=self.project)
        self.kale = Crop.objects.create(
            name='Grünkohl', project=self.project, crop_family_id='Brassicaceae',
            growth_duration_days=90, harvest_duration_days=30, nutrient_demand='high',
        )
        self.broccoli = Crop.objects.create(
            name='Brokkoli', project=self.project, crop_family_id='Brassicaceae',
            growth_duration_days=70, harvest_duration_days=14,
        )
        self.carrot = Crop.objects.create(
            name='Karotte', project=self.project, crop_family_id='Apiaceae',
            growth_duration_days=100, harvest_duration_days=30, nutrient_demand='low',
        )

    def plan(self, crop: Crop, bed: Bed, planting_date: date, season: Season, **extra) -> PlantingPlan:
        return PlantingPlan.objects.create(
            crop=crop, bed=bed, planting_date=planting_date, season=season,
            project=self.project, area_usage_sqm=5, **extra,
        )

    def test_list_reports_conflict_with_findings(self):
        self.plan(self.kale, self.bed, date(2025, 4, 1), self.season_2025)
        current = self.plan(self.broccoli, self.bed, date(2026, 4, 1), self.season_2026)

        response = self.client.get('/openfarmplanner/api/planting-plans/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        row = next(item for item in response.data['results'] if item['id'] == current.id)
        self.assertEqual(row['rotation_status'], STATUS_CONFLICT)
        finding = row['rotation_findings'][0]
        self.assertEqual(finding['previous_crop_label'], 'Grünkohl')
        self.assertEqual(finding['family_key'], 'Brassicaceae')
        self.assertEqual(finding['family_name'], 'Kreuzblütler')
        self.assertEqual(finding['year'], 2025)
        self.assertEqual(finding['break_years'], 4)
        self.assertEqual(finding['earliest_year'], 2030)
        self.assertEqual(finding['break_source'], BREAK_SOURCE_FAMILY)

    def test_variety_uses_family_and_break_of_its_general_kultur(self):
        species = CropSpecies.objects.create(name='Kohl Rotation', status=CropSpecies.STATUS_PUBLISHED)
        general = Crop.objects.create(
            name='Kohl', project=self.project, crop_species=species,
            crop_family_id='Brassicaceae', rotation_break_years=5,
        )
        variety = Crop.objects.create(name='Kohl', variety='Rot', project=self.project, crop_species=species)
        self.plan(self.kale, self.bed, date(2025, 4, 1), self.season_2025)
        current = self.plan(variety, self.bed, date(2026, 4, 1), self.season_2026)

        response = self.client.get(f'/openfarmplanner/api/planting-plans/{current.id}/')

        finding = response.data['rotation_findings'][0]
        self.assertEqual(finding['break_years'], 5)
        self.assertEqual(finding['break_source'], BREAK_SOURCE_CROP)
        self.assertEqual(finding['settings_crop_id'], general.id)

    def test_missing_family_and_incomplete_plan_are_info(self):
        no_family = self.plan(self.crop, self.bed, date(2026, 4, 1), self.season_2026)
        draft = PlantingPlan.objects.create(crop=self.kale, project=self.project, season=self.season_2026)

        response = self.client.get('/openfarmplanner/api/planting-plans/')

        rows = {item['id']: item for item in response.data['results']}
        self.assertEqual(rows[no_family.id]['rotation_status'], STATUS_INFO)
        self.assertEqual(rows[no_family.id]['rotation_findings'][0]['kind'], KIND_NO_FAMILY)
        self.assertEqual(rows[draft.id]['rotation_status'], STATUS_INFO)
        self.assertEqual(rows[draft.id]['rotation_findings'][0]['kind'], 'incomplete')

    def test_accepting_a_conflict_records_user_and_time(self):
        self.plan(self.kale, self.bed, date(2025, 4, 1), self.season_2025)
        current = self.plan(self.broccoli, self.bed, date(2026, 4, 1), self.season_2026)

        response = self.client.patch(
            f'/openfarmplanner/api/planting-plans/{current.id}/',
            {'rotation_conflict_accepted': True},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['rotation_status'], STATUS_ACCEPTED)
        self.assertTrue(response.data['rotation_conflict_accepted'])
        self.assertEqual(response.data['rotation_conflict_accepted_by_user']['id'], self.user.id)
        self.assertIsNotNone(response.data['rotation_conflict_accepted_at'])

    def test_acceptance_is_reset_when_bed_or_dates_change(self):
        self.plan(self.kale, self.bed, date(2025, 4, 1), self.season_2025)
        self.plan(self.kale, self.other_bed, date(2025, 4, 1), self.season_2025)
        current = self.plan(
            self.broccoli, self.bed, date(2026, 4, 1), self.season_2026,
            rotation_conflict_accepted_at=timezone.now(), rotation_conflict_accepted_by=self.user,
        )
        url = f'/openfarmplanner/api/planting-plans/{current.id}/'

        notes_response = self.client.patch(url, {'notes': 'unrelated'}, format='json')
        self.assertEqual(notes_response.data['rotation_status'], STATUS_ACCEPTED)

        moved_response = self.client.patch(url, {'bed': self.other_bed.id}, format='json')
        self.assertEqual(moved_response.status_code, status.HTTP_200_OK)
        self.assertEqual(moved_response.data['rotation_status'], STATUS_CONFLICT)
        self.assertFalse(moved_response.data['rotation_conflict_accepted'])
        self.assertIsNone(moved_response.data['rotation_conflict_accepted_by_user'])

        self.client.patch(url, {'rotation_conflict_accepted': True}, format='json')
        dated_response = self.client.patch(url, {'planting_date': '2026-05-01'}, format='json')
        self.assertEqual(dated_response.data['rotation_status'], STATUS_CONFLICT)

    def test_acceptance_is_reset_when_crop_changes(self):
        current = self.plan(
            self.broccoli, self.bed, date(2026, 4, 1), self.season_2026,
            rotation_conflict_accepted_at=timezone.now(), rotation_conflict_accepted_by=self.user,
        )

        current.crop = self.carrot
        current.save()

        current.refresh_from_db()
        self.assertIsNone(current.rotation_conflict_accepted_at)
        self.assertIsNone(current.rotation_conflict_accepted_by)

    def test_accepting_while_moving_keeps_the_acceptance(self):
        self.plan(self.kale, self.other_bed, date(2025, 4, 1), self.season_2025)
        current = self.plan(self.broccoli, self.bed, date(2026, 4, 1), self.season_2026)

        response = self.client.patch(
            f'/openfarmplanner/api/planting-plans/{current.id}/',
            {'bed': self.other_bed.id, 'rotation_conflict_accepted': True},
            format='json',
        )

        self.assertEqual(response.data['rotation_status'], STATUS_ACCEPTED)

    def test_rotation_check_endpoint_checks_an_unsaved_combination(self):
        self.plan(self.kale, self.bed, date(2025, 4, 1), self.season_2025)

        response = self.client.get('/openfarmplanner/api/planting-plans/rotation-check/', {
            'crop_id': self.broccoli.id, 'bed_id': self.bed.id, 'planting_date': '2026-04-01',
        })

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['status'], STATUS_CONFLICT)
        self.assertEqual(response.data['bed_history'][0]['crop_label'], 'Grünkohl')

    def test_rotation_check_endpoint_validates_parameters(self):
        response = self.client.get('/openfarmplanner/api/planting-plans/rotation-check/', {
            'crop_id': 'x', 'planting_date': '2026-04-01',
        })

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_bed_suggestions_rank_free_beds_and_skip_occupied_ones(self):
        full_bed = Bed.objects.create(name='Belegt', field=self.field, area_sqm=5, project=self.project)
        self.plan(self.carrot, full_bed, date(2026, 3, 1), self.season_2026)
        self.plan(self.kale, self.bed, date(2025, 4, 1), self.season_2025)
        self.plan(self.carrot, self.other_bed, date(2025, 4, 1), self.season_2025)

        response = self.client.get('/openfarmplanner/api/planting-plans/bed-suggestions/', {
            'crop_id': self.broccoli.id, 'planting_date': '2026-04-01',
        })

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        bed_ids = [row['bed_id'] for row in response.data['results']]
        self.assertNotIn(full_bed.id, bed_ids)
        self.assertEqual(bed_ids[0], self.other_bed.id)
        self.assertEqual(response.data['results'][0]['category'], 'good')
        by_bed = {row['bed_id']: row for row in response.data['results']}
        self.assertEqual(by_bed[self.bed.id]['category'], 'conflict')

    def test_season_copy_preview_and_conflict_modes(self):
        target = Season.objects.create(
            project=self.project, start_date=date(2027, 1, 1), end_date=date(2027, 12, 31),
        )
        self.plan(self.kale, self.bed, date(2026, 4, 1), self.season_2026)
        self.plan(self.carrot, self.other_bed, date(2026, 4, 1), self.season_2026)
        url = f'/openfarmplanner/api/seasons/{target.id}/'

        preview = self.client.get(f'{url}copy-preview/', {'source_season_id': self.season_2026.id})

        self.assertEqual(preview.status_code, status.HTTP_200_OK)
        self.assertEqual(preview.data['total'], 2)
        self.assertEqual(preview.data['conflict_count'], 2)
        self.assertEqual(preview.data['conflict_free_count'], 0)
        self.assertEqual(preview.data['items'][0]['status'], STATUS_CONFLICT)

        response = self.client.post(
            f'{url}copy-from/',
            {'source_season_id': self.season_2026.id, 'rotation_conflicts': 'without_bed'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        copies = PlantingPlan.objects.filter(season=target)
        self.assertEqual(copies.count(), 2)
        self.assertTrue(all(copy.bed_id is None for copy in copies))

    def test_season_copy_can_skip_conflicts(self):
        target = Season.objects.create(
            project=self.project, start_date=date(2027, 1, 1), end_date=date(2027, 12, 31),
        )
        self.plan(self.kale, self.bed, date(2026, 4, 1), self.season_2026)
        unchecked = self.plan(self.crop, self.other_bed, date(2026, 4, 1), self.season_2026)

        response = self.client.post(
            f'/openfarmplanner/api/seasons/{target.id}/copy-from/',
            {'source_season_id': self.season_2026.id, 'rotation_conflicts': 'skip'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        copy = PlantingPlan.objects.get(season=target)
        self.assertEqual(copy.crop_id, unchecked.crop_id)
        self.assertEqual(copy.bed_id, self.other_bed.id)

    def test_season_copy_keeps_conflicts_by_default(self):
        target = Season.objects.create(
            project=self.project, start_date=date(2027, 1, 1), end_date=date(2027, 12, 31),
        )
        self.plan(self.kale, self.bed, date(2026, 4, 1), self.season_2026)

        self.client.post(
            f'/openfarmplanner/api/seasons/{target.id}/copy-from/',
            {'source_season_id': self.season_2026.id},
            format='json',
        )

        self.assertEqual(PlantingPlan.objects.get(season=target).bed_id, self.bed.id)
