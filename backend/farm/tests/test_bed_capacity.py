"""Bed occupancy with firm and soft stages (docs/bed-occupancy.md).

The pure rule tests drive :func:`find_harvest_overlaps` with hand-built
occupancies; the database tests go through the save check's capacity rule,
the ``remaining-area`` endpoint and the planting-plan list.
"""

from datetime import date
from decimal import Decimal

from django.test import SimpleTestCase
from rest_framework import status

from farm.models import Bed, Crop, PlantingPlan, Season
from farm.services.bed_capacity import (
    ROLE_PREDECESSOR,
    ROLE_SUCCESSOR,
    BedOccupancy,
    SuccessionRule,
    actual_harvest_end,
    build_occupancy,
    calculate_bed_capacity,
    find_harvest_overlaps,
)
from farm.tests.api_base import ProjectApiTestCase

DEFAULT_RULE = SuccessionRule()
BED_AREA = Decimal('10')


def occupancy(
    plan_id: int,
    start: date,
    harvest_start: date | None,
    end: date | None,
    area: str = '10',
    rule: SuccessionRule = DEFAULT_RULE,
) -> BedOccupancy:
    return build_occupancy(
        rule=rule, start=start, harvest_start=harvest_start, end=end,
        area_sqm=Decimal(area), plan_id=plan_id, crop_label=f'Kultur {plan_id}',
    )


class SuccessionRuleTest(SimpleTestCase):
    """Where the firm stage ends."""

    def test_firm_stage_ends_the_day_before_harvest_start_plus_min_gap(self):
        self.assertEqual(
            DEFAULT_RULE.firm_end(date(2026, 3, 1), date(2026, 5, 1), date(2026, 7, 1)),
            date(2026, 5, 14),
        )

    def test_harvest_phase_shorter_than_min_gap_is_firm_throughout(self):
        self.assertEqual(
            DEFAULT_RULE.firm_end(date(2026, 3, 1), date(2026, 5, 1), date(2026, 5, 10)),
            date(2026, 5, 10),
        )

    def test_switched_off_the_whole_harvest_phase_is_firm(self):
        rule = SuccessionRule(allow_during_harvest=False)
        self.assertEqual(
            rule.firm_end(date(2026, 3, 1), date(2026, 5, 1), date(2026, 7, 1)), date(2026, 7, 1),
        )

    def test_min_gap_zero_makes_the_whole_harvest_phase_soft(self):
        rule = SuccessionRule(min_days_after_harvest_start=0)
        self.assertEqual(
            rule.firm_end(date(2026, 3, 1), date(2026, 5, 1), date(2026, 7, 1)), date(2026, 4, 30),
        )

    def test_without_harvest_start_everything_is_firm(self):
        self.assertEqual(
            DEFAULT_RULE.firm_end(date(2026, 3, 1), None, date(2026, 7, 1)), date(2026, 7, 1),
        )


class HarvestOverlapRuleTest(SimpleTestCase):
    """Which plans overlap in a harvest phase, from either plan's view."""

    def setUp(self):
        # Harvest from 1 May to 1 July; firm until 14 May (min gap 14 days).
        self.predecessor = occupancy(1, date(2026, 3, 1), date(2026, 5, 1), date(2026, 7, 1))

    def test_follow_up_in_the_soft_stage_is_reported_on_both_plans(self):
        successor = occupancy(2, date(2026, 5, 20), date(2026, 7, 1), date(2026, 8, 1))

        on_predecessor = find_harvest_overlaps(self.predecessor, [successor], BED_AREA)
        on_successor = find_harvest_overlaps(successor, [self.predecessor], BED_AREA)

        self.assertEqual([(item.role, item.other_plan_id, item.date) for item in on_predecessor], [
            (ROLE_PREDECESSOR, 2, date(2026, 5, 20)),
        ])
        self.assertEqual(on_predecessor[0].other_crop_label, 'Kultur 2')
        self.assertEqual([(item.role, item.other_plan_id, item.date) for item in on_successor], [
            (ROLE_SUCCESSOR, 1, date(2026, 7, 1)),
        ])
        self.assertEqual(actual_harvest_end(on_predecessor), date(2026, 5, 20))
        self.assertIsNone(actual_harvest_end(on_successor))

    def test_follow_up_in_the_firm_stage_is_no_info(self):
        """Starting in the firm stage is the save check's error, never an info."""
        successor = occupancy(2, date(2026, 5, 10), date(2026, 7, 1), date(2026, 8, 1))

        self.assertEqual(find_harvest_overlaps(self.predecessor, [successor], BED_AREA), [])

    def test_partial_plans_that_fit_side_by_side_are_no_overlap(self):
        predecessor = occupancy(1, date(2026, 3, 1), date(2026, 5, 1), date(2026, 7, 1), area='4')
        successor = occupancy(2, date(2026, 5, 20), date(2026, 7, 1), date(2026, 8, 1), area='4')

        self.assertEqual(find_harvest_overlaps(predecessor, [successor], BED_AREA), [])

    def test_partial_plans_of_several_predecessors(self):
        first = occupancy(1, date(2026, 3, 1), date(2026, 5, 1), date(2026, 7, 1), area='5')
        second = occupancy(2, date(2026, 3, 5), date(2026, 5, 5), date(2026, 7, 5), area='3')
        successor = occupancy(3, date(2026, 5, 25), date(2026, 7, 1), date(2026, 8, 1), area='5')

        overlaps = find_harvest_overlaps(successor, [first, second], BED_AREA)

        self.assertEqual(
            [(item.role, item.other_plan_id) for item in overlaps],
            [(ROLE_SUCCESSOR, 1), (ROLE_SUCCESSOR, 2)],
        )
        self.assertEqual(
            [item.other_plan_id for item in find_harvest_overlaps(second, [first, successor], BED_AREA)],
            [3],
        )

    def test_several_follow_ups_end_the_harvest_on_the_earliest_start(self):
        later = occupancy(2, date(2026, 6, 10), date(2026, 7, 20), date(2026, 8, 1), area='5')
        earlier = occupancy(3, date(2026, 5, 20), date(2026, 7, 1), date(2026, 8, 1), area='5')

        overlaps = find_harvest_overlaps(self.predecessor, [later, earlier], BED_AREA)

        self.assertEqual([item.other_plan_id for item in overlaps], [3, 2])
        self.assertEqual(actual_harvest_end(overlaps), date(2026, 5, 20))

    def test_without_bed_area_nothing_overlaps(self):
        successor = occupancy(2, date(2026, 5, 20), date(2026, 7, 1), date(2026, 8, 1))

        self.assertEqual(find_harvest_overlaps(self.predecessor, [successor], None), [])

    def test_switched_off_there_is_no_soft_stage(self):
        rule = SuccessionRule(allow_during_harvest=False)
        predecessor = occupancy(1, date(2026, 3, 1), date(2026, 5, 1), date(2026, 7, 1), rule=rule)
        successor = occupancy(2, date(2026, 5, 20), date(2026, 7, 1), date(2026, 8, 1), rule=rule)

        self.assertEqual(find_harvest_overlaps(predecessor, [successor], BED_AREA), [])


class BedOccupancyApiTest(ProjectApiTestCase):
    """The save check's capacity rule, ``remaining-area`` and the plan list."""

    def setUp(self):
        super().setUp()
        self.season = Season.objects.create(
            project=self.project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        )
        self.client.defaults['HTTP_X_SEASON_ID'] = str(self.season.id)
        self.client.defaults['HTTP_ACCEPT_LANGUAGE'] = 'de'
        self.full_bed = Bed.objects.create(name='Beet 10', field=self.field, area_sqm=10, project=self.project)
        self.salad = Crop.objects.create(
            name='Salat', project=self.project, growth_duration_days=61, harvest_duration_days=61,
        )
        self.kale = Crop.objects.create(
            name='Grünkohl', project=self.project, growth_duration_days=40, harvest_duration_days=60,
        )

    def plan(
        self,
        start: date,
        harvest_start: date,
        harvest_end: date,
        area: str = '10',
        crop: Crop | None = None,
    ) -> PlantingPlan:
        plan = PlantingPlan.objects.create(
            crop=crop or self.salad, bed=self.full_bed, planting_date=start, season=self.season,
            project=self.project, area_usage_sqm=Decimal(area),
        )
        PlantingPlan.objects.filter(pk=plan.pk).update(
            harvest_date=harvest_start, harvest_end_date=harvest_end,
        )
        plan.refresh_from_db()
        return plan

    def capacity_for(self, start: date, harvest_start: date, end: date, exclude: PlantingPlan | None = None):
        return calculate_bed_capacity(
            self.full_bed, start=start, end=end, harvest_start=harvest_start,
            exclude_plan_id=exclude.pk if exclude is not None else None,
        )

    def remaining_area(self, **params) -> dict:
        response = self.client.get('/openfarmplanner/api/planting-plans/remaining-area/', {
            'bed_id': self.full_bed.id, **params,
        })
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        return response.data

    def test_follow_up_in_the_soft_stage_fits(self):
        self.plan(date(2026, 3, 1), date(2026, 5, 1), date(2026, 7, 1))

        capacity = self.capacity_for(date(2026, 5, 15), date(2026, 6, 15), date(2026, 8, 1))

        self.assertTrue(capacity.has_room_for(Decimal('10')))

    def test_follow_up_in_the_firm_stage_does_not_fit(self):
        predecessor = self.plan(date(2026, 3, 1), date(2026, 5, 1), date(2026, 7, 1))

        capacity = self.capacity_for(date(2026, 5, 14), date(2026, 6, 15), date(2026, 8, 1))

        self.assertFalse(capacity.has_room_for(Decimal('1')))
        self.assertEqual(capacity.last_ending_plan().plan_id, predecessor.pk)
        self.assertEqual(capacity.last_ending_plan().end, date(2026, 5, 14))

    def test_harvest_phase_shorter_than_min_gap_blocks_until_harvest_end(self):
        self.plan(date(2026, 3, 1), date(2026, 5, 1), date(2026, 5, 10))

        self.assertFalse(
            self.capacity_for(date(2026, 5, 10), date(2026, 6, 15), date(2026, 8, 1)).has_room_for(Decimal('1')),
        )
        self.assertTrue(
            self.capacity_for(date(2026, 5, 11), date(2026, 6, 15), date(2026, 8, 1)).has_room_for(Decimal('10')),
        )

    def test_switched_off_the_whole_harvest_phase_blocks(self):
        self.project.allow_succession_during_harvest = False
        self.project.save()
        self.plan(date(2026, 3, 1), date(2026, 5, 1), date(2026, 7, 1))

        capacity = self.capacity_for(date(2026, 6, 20), date(2026, 7, 15), date(2026, 8, 1))

        self.assertFalse(capacity.has_room_for(Decimal('1')))

    def test_min_gap_zero_allows_a_follow_up_from_harvest_start(self):
        self.project.succession_min_days_after_harvest_start = 0
        self.project.save()
        self.plan(date(2026, 3, 1), date(2026, 5, 1), date(2026, 7, 1))

        self.assertTrue(
            self.capacity_for(date(2026, 5, 1), date(2026, 6, 15), date(2026, 8, 1)).has_room_for(Decimal('10')),
        )
        self.assertFalse(
            self.capacity_for(date(2026, 4, 30), date(2026, 6, 15), date(2026, 8, 1)).has_room_for(Decimal('1')),
        )

    def test_only_the_peak_of_firm_stages_counts(self):
        """Two half-bed plans one after the other leave half the bed free."""
        self.plan(date(2026, 3, 1), date(2026, 4, 1), date(2026, 4, 5), area='5')
        self.plan(date(2026, 4, 10), date(2026, 5, 1), date(2026, 5, 5), area='5')

        capacity = self.capacity_for(date(2026, 3, 15), date(2026, 5, 1), date(2026, 5, 20))

        self.assertEqual(capacity.used_area_sqm, Decimal('5'))
        self.assertTrue(capacity.has_room_for(Decimal('5')))
        self.assertFalse(capacity.has_room_for(Decimal('6')))

    def test_moving_the_predecessor_later_is_checked_against_the_follow_up(self):
        """Symmetric: the predecessor's firm stage must not reach the follow-up."""
        predecessor = self.plan(date(2026, 3, 1), date(2026, 5, 1), date(2026, 7, 1))
        self.plan(date(2026, 5, 20), date(2026, 7, 1), date(2026, 8, 1))

        unchanged = self.capacity_for(date(2026, 3, 1), date(2026, 5, 1), date(2026, 7, 1), exclude=predecessor)
        moved = self.capacity_for(date(2026, 3, 10), date(2026, 5, 10), date(2026, 7, 10), exclude=predecessor)

        self.assertTrue(unchanged.has_room_for(Decimal('10')))
        self.assertFalse(moved.has_room_for(Decimal('1')))

    def test_remaining_area_reports_the_overlap_and_the_succession_limit(self):
        self.plan(date(2026, 3, 1), date(2026, 5, 1), date(2026, 7, 1))

        allowed = self.remaining_area(
            start_date='2026-05-20', end_date='2026-08-01', harvest_start_date='2026-07-01', area_sqm='10',
        )
        blocked = self.remaining_area(
            start_date='2026-05-10', end_date='2026-08-01', harvest_start_date='2026-07-01', area_sqm='10',
        )

        self.assertEqual(allowed['remaining_area_sqm'], 10.0)
        self.assertEqual(allowed['harvest_overlaps'], [{
            'role': ROLE_SUCCESSOR, 'other_plan_id': allowed['harvest_overlaps'][0]['other_plan_id'],
            'other_crop_label': 'Salat', 'date': '2026-07-01',
        }])
        self.assertEqual(blocked['remaining_area_sqm'], 0.0)
        self.assertEqual(blocked['harvest_overlaps'], [])
        self.assertEqual(blocked['succession_limit'], {
            'crop_label': 'Salat',
            'harvest_start_date': '2026-05-01',
            'min_days_after_harvest_start': 14,
            'earliest_date': '2026-05-15',
        })

    def test_remaining_area_derives_the_harvest_phase_from_the_crop(self):
        """Without dates the crop's timing places the plan's own harvest phase."""
        self.plan(date(2026, 6, 1), date(2026, 7, 15), date(2026, 8, 1))

        # Kale planted 1 April: harvest from 11 May to 10 July, firm until 24 May.
        data = self.remaining_area(start_date='2026-04-01', crop_id=self.kale.id, area_sqm='10')

        self.assertEqual(data['harvest_start_date'], '2026-05-11')
        self.assertEqual(data['remaining_area_sqm'], 10.0)
        self.assertEqual(
            [(item['role'], item['date']) for item in data['harvest_overlaps']],
            [(ROLE_PREDECESSOR, '2026-06-01')],
        )

    def test_list_reports_overlaps_and_recalculates_after_a_setting_change(self):
        predecessor = self.plan(date(2026, 3, 1), date(2026, 5, 1), date(2026, 7, 1))
        early = self.plan(date(2026, 5, 20), date(2026, 7, 1), date(2026, 8, 1), area='5', crop=self.kale)
        late = self.plan(date(2026, 6, 10), date(2026, 7, 20), date(2026, 8, 1), area='5')

        rows = self.list_rows()

        self.assertEqual(rows[predecessor.pk]['actual_harvest_end_date'], date(2026, 5, 20))
        self.assertEqual(
            [(item['other_plan_id'], item['other_crop_label'], item['date'])
             for item in rows[predecessor.pk]['harvest_overlaps']],
            [(early.pk, 'Grünkohl', '2026-05-20'), (late.pk, 'Salat', '2026-06-10')],
        )
        self.assertEqual(
            [(item['role'], item['date']) for item in rows[early.pk]['harvest_overlaps']],
            [(ROLE_SUCCESSOR, '2026-07-01')],
        )
        self.assertIsNone(rows[early.pk]['actual_harvest_end_date'])

        self.project.allow_succession_during_harvest = False
        self.project.save()

        rows = self.list_rows()
        self.assertEqual(rows[predecessor.pk]['harvest_overlaps'], [])
        self.assertIsNone(rows[predecessor.pk]['actual_harvest_end_date'])

    def list_rows(self) -> dict[int, dict]:
        response = self.client.get('/openfarmplanner/api/planting-plans/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return {row['id']: row for row in response.data['results']}

    def test_project_settings_round_trip_and_validation(self):
        url = f'/openfarmplanner/api/projects/{self.project.id}/'

        response = self.client.get(url)
        self.assertTrue(response.data['allow_succession_during_harvest'])
        self.assertEqual(response.data['succession_min_days_after_harvest_start'], 14)

        response = self.client.patch(url, {
            'allow_succession_during_harvest': False, 'succession_min_days_after_harvest_start': 0,
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.project.refresh_from_db()
        self.assertFalse(self.project.allow_succession_during_harvest)
        self.assertEqual(self.project.succession_min_days_after_harvest_start, 0)

        response = self.client.patch(url, {'succession_min_days_after_harvest_start': -1}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
