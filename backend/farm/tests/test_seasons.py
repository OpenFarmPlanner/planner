"""Tests for the seasons domain: label computation, pattern math, CRUD, copy-data, and setup."""

from datetime import date

from farm.models import BatchOperation, EntityRevision, PlantingPlan, Season, SeasonPattern
from farm.services.demo_project import populate_demo_project
from farm.services.hint_test_project import populate_hint_test_project
from farm.services.seasons import (
    add_months,
    analyze_period_transition,
    assign_unassigned_planting_plans,
    compute_custom_season_period,
    compute_due_season_period,
    compute_manual_season_period,
    compute_period_containing,
    compute_preview_periods,
    compute_season_period,
    copy_planting_plans,
    find_due_but_missing_season,
    whole_year_offset_into_period,
)
from farm.tests.api_base import ProjectApiTestCase


class SeasonLabelTest(ProjectApiTestCase):
    def test_calendar_year_label(self):
        season = Season.objects.create(
            project=self.project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        )
        self.assertEqual(season.label, '2026')

    def test_split_year_label(self):
        season = Season.objects.create(
            project=self.project, start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
        )
        self.assertEqual(season.label, '25/26')

    def test_partial_year_within_one_calendar_year_uses_four_digit_label(self):
        season = Season.objects.create(
            project=self.project, start_date=date(2026, 9, 1), end_date=date(2026, 12, 31),
        )
        self.assertEqual(season.label, '2026')

    def test_custom_label_overrides_computed(self):
        season = Season.objects.create(
            project=self.project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
            custom_label='Vor der Renovierung',
        )
        self.assertEqual(season.label, 'Vor der Renovierung')
        self.assertEqual(season.computed_label, '2026')


class SeasonPatternMathTest(ProjectApiTestCase):
    def test_compute_season_period_clamps_short_month(self):
        pattern = SeasonPattern(project=self.project, start_day=31, start_month=2)
        start_date, end_date = compute_season_period(pattern, 2026)
        self.assertEqual(start_date, date(2026, 2, 28))
        self.assertEqual(end_date, date(2027, 2, 27))

    def test_compute_period_containing_before_and_after_start(self):
        pattern = SeasonPattern(project=self.project, start_day=1, start_month=9)
        before_start = compute_period_containing(pattern, date(2026, 3, 1))
        self.assertEqual(before_start, (date(2025, 9, 1), date(2026, 8, 31)))
        after_start = compute_period_containing(pattern, date(2026, 10, 1))
        self.assertEqual(after_start, (date(2026, 9, 1), date(2027, 8, 31)))

    def test_preview_periods_mark_current(self):
        pattern = SeasonPattern(project=self.project, start_day=1, start_month=1)
        periods = compute_preview_periods(pattern, date(2026, 6, 1))
        self.assertEqual([period['is_current'] for period in periods], [False, True, False])
        self.assertEqual(periods[1]['start_date'], date(2026, 1, 1))
        self.assertEqual(periods[1]['end_date'], date(2026, 12, 31))

    def test_next_suggestion_follows_latest_season_independent_of_today(self):
        SeasonPattern.objects.update_or_create(
            project=self.project,
            defaults={'start_day': 1, 'start_month': 9},
        )
        Season.objects.create(
            project=self.project,
            start_date=date(2024, 9, 1),
            end_date=date(2025, 8, 31),
        )
        Season.objects.create(
            project=self.project,
            start_date=date(2025, 9, 1),
            end_date=date(2026, 8, 31),
        )

        suggestion = find_due_but_missing_season(self.project, today=date(2026, 2, 1))

        self.assertEqual(suggestion, (date(2026, 9, 1), date(2027, 8, 31)))

    def test_next_suggestion_advances_after_future_season_is_created(self):
        SeasonPattern.objects.update_or_create(
            project=self.project,
            defaults={'start_day': 1, 'start_month': 9},
        )
        Season.objects.create(
            project=self.project,
            start_date=date(2025, 9, 1),
            end_date=date(2026, 8, 31),
        )
        Season.objects.create(
            project=self.project,
            start_date=date(2026, 9, 1),
            end_date=date(2027, 8, 31),
        )

        suggestion = find_due_but_missing_season(self.project, today=date(2026, 2, 1))

        self.assertEqual(suggestion, (date(2027, 9, 1), date(2028, 8, 31)))


class SeasonTransitionMathTest(ProjectApiTestCase):
    def test_custom_season_period_snaps_to_next_pattern_start(self):
        pattern = SeasonPattern(project=self.project, start_day=1, start_month=1)
        start_date, end_date = compute_custom_season_period(pattern, date(2026, 4, 15))
        self.assertEqual(start_date, date(2026, 4, 15))
        self.assertEqual(end_date, date(2026, 12, 31))

    def test_custom_season_period_from_pattern_start_runs_a_full_year(self):
        pattern = SeasonPattern(project=self.project, start_day=1, start_month=9)
        start_date, end_date = compute_custom_season_period(pattern, date(2026, 9, 1))
        self.assertEqual(end_date, date(2027, 8, 31))

    def test_manual_season_period_runs_through_the_following_full_pattern_period(self):
        pattern = SeasonPattern(project=self.project, start_day=1, start_month=1)
        start_date, end_date = compute_manual_season_period(pattern, date(2026, 9, 1))
        self.assertEqual(start_date, date(2026, 9, 1))
        self.assertEqual(end_date, date(2027, 12, 31))

    def test_manual_season_period_from_a_grid_start_still_absorbs_one_more_year(self):
        pattern = SeasonPattern(project=self.project, start_day=1, start_month=9)
        _, end_date = compute_manual_season_period(pattern, date(2026, 5, 1))
        self.assertEqual(end_date, date(2027, 8, 31))

    def test_whole_year_offset_into_period_picks_the_year_that_fits(self):
        # Same calendar-year target: April plan -> the following April.
        self.assertEqual(
            whole_year_offset_into_period(date(2026, 4, 1), date(2028, 1, 1), date(2028, 12, 31)),
            2,
        )
        # Sep-Aug target: an April plan belongs to the second calendar year of it.
        self.assertEqual(
            whole_year_offset_into_period(date(2025, 4, 1), date(2026, 9, 1), date(2027, 8, 31)),
            2,
        )
        # A month the short target never covers lands just outside (then dropped).
        offset = whole_year_offset_into_period(date(2025, 9, 1), date(2026, 1, 1), date(2026, 4, 30))
        self.assertEqual(offset, 0)

    def test_analyze_period_transition_detects_gap_overlap_and_seam(self):
        self.assertIsNone(analyze_period_transition(date(2026, 8, 31), date(2026, 9, 1)))
        gap = analyze_period_transition(date(2026, 8, 31), date(2026, 10, 1))
        self.assertEqual(
            gap,
            {'kind': 'gap', 'start_date': date(2026, 9, 1), 'end_date': date(2026, 9, 30)},
        )
        overlap = analyze_period_transition(date(2026, 8, 31), date(2026, 6, 1))
        self.assertEqual(
            overlap,
            {'kind': 'overlap', 'start_date': date(2026, 6, 1), 'end_date': date(2026, 8, 31)},
        )


class SeasonGapDecisionApiTest(ProjectApiTestCase):
    def _set_pattern(self, day: int, month: int) -> None:
        SeasonPattern.objects.update_or_create(
            project=self.project, defaults={'start_day': day, 'start_month': month},
        )

    def test_transition_input_errors_use_structured_codes(self):
        invalid_date = self.client.get(
            '/openfarmplanner/api/seasons/creation-options/',
            {'manual_start_date': 'not-a-date'},
        )
        self.assertEqual(invalid_date.status_code, 400)
        self.assertEqual(invalid_date.data['code'], 'invalid_manual_start_date')

        not_applicable = self.client.post('/openfarmplanner/api/seasons/create-transition/', {})
        self.assertEqual(not_applicable.status_code, 400)
        self.assertEqual(not_applicable.data['code'], 'season_transition_not_applicable')

        self._set_pattern(1, 1)
        Season.objects.create(
            project=self.project,
            start_date=date(2025, 1, 1),
            end_date=date(2025, 12, 31),
        )
        not_required = self.client.post('/openfarmplanner/api/seasons/create-transition/', {})
        self.assertEqual(not_required.status_code, 400)
        self.assertEqual(not_required.data['code'], 'season_transition_not_required')

    def test_pattern_preview_includes_reference_season_and_gap_row(self):
        self._set_pattern(1, 1)
        Season.objects.create(
            project=self.project, start_date=date(2024, 9, 1), end_date=date(2025, 8, 31),
        )

        response = self.client.get(
            '/openfarmplanner/api/season-pattern/preview/', {'start_day': 1, 'start_month': 1},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['reference_season']['start_date'], '2024-09-01')
        self.assertEqual(response.data['transition']['kind'], 'gap')
        self.assertEqual(response.data['transition']['start_date'], '2025-09-01')
        self.assertEqual(response.data['transition']['end_date'], '2025-12-31')
        self.assertTrue(response.data['periods'])

    def test_pattern_preview_has_no_transition_without_seasons(self):
        self._set_pattern(1, 1)
        response = self.client.get('/openfarmplanner/api/season-pattern/preview/')
        self.assertIsNone(response.data['reference_season'])
        self.assertIsNone(response.data['transition'])

    def test_creation_options_reports_gap_and_bridging_periods(self):
        self._set_pattern(1, 9)
        Season.objects.create(
            project=self.project, start_date=date(2024, 9, 1), end_date=date(2025, 3, 31),
        )

        response = self.client.get('/openfarmplanner/api/seasons/creation-options/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['last_season']['end_date'], '2025-03-31')
        self.assertEqual(response.data['due_period']['start_date'], '2025-09-01')
        self.assertEqual(response.data['transition']['kind'], 'gap')
        self.assertEqual(response.data['seamless_period'], {
            'start_date': '2025-04-01', 'end_date': '2025-08-31',
        })

    def test_creation_options_reports_manual_overlap_without_adjusting_the_date(self):
        self._set_pattern(1, 1)
        Season.objects.create(
            project=self.project, start_date=date(2025, 4, 1), end_date=date(2026, 3, 31),
        )

        response = self.client.get(
            '/openfarmplanner/api/seasons/creation-options/',
            {'manual_start_date': '2026-01-01'},
        )

        self.assertEqual(response.status_code, 200)
        # The regular suggestion skips to the first non-overlapping pattern
        # period. The explicitly entered date is preserved and its overlap is
        # reported for the user to resolve rather than silently corrected.
        self.assertEqual(response.data['due_period'], {
            'start_date': '2027-01-01', 'end_date': '2027-12-31',
        })
        self.assertEqual(response.data['manual_period']['start_date'], '2026-01-01')
        self.assertEqual(response.data['manual_residual'], {
            'kind': 'overlap', 'start_date': '2026-01-01', 'end_date': '2026-03-31',
        })

    def test_creation_options_manual_start_reports_residual_gap(self):
        self._set_pattern(1, 9)
        Season.objects.create(
            project=self.project, start_date=date(2024, 9, 1), end_date=date(2025, 3, 31),
        )

        response = self.client.get(
            '/openfarmplanner/api/seasons/creation-options/', {'manual_start_date': '2025-05-01'},
        )

        # The manual season closes the gap from the chosen start and then runs
        # through the end of the following full pattern period (Sep 2025 - Aug
        # 2026), so copied plans land back in range.
        self.assertEqual(response.data['manual_period'], {
            'start_date': '2025-05-01', 'end_date': '2026-08-31',
        })
        self.assertEqual(response.data['manual_residual'], {
            'kind': 'gap', 'start_date': '2025-04-01', 'end_date': '2025-04-30',
        })

    def test_creation_options_manual_start_closing_the_gap_has_no_residual(self):
        self._set_pattern(1, 9)
        Season.objects.create(
            project=self.project, start_date=date(2024, 9, 1), end_date=date(2025, 3, 31),
        )

        response = self.client.get(
            '/openfarmplanner/api/seasons/creation-options/', {'manual_start_date': '2025-04-01'},
        )

        self.assertIsNone(response.data['manual_residual'])

    def test_create_transition_distributes_plans_across_both_new_seasons(self):
        self._set_pattern(1, 1)
        last_season = Season.objects.create(
            project=self.project, start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
        )
        # One plan per month across the source season (Sep 2025 – Aug 2026).
        months = [(2025, m) for m in (9, 10, 11, 12)] + [(2026, m) for m in range(1, 9)]
        for year, month in months:
            PlantingPlan.objects.create(
                crop=self.crop, bed=self.bed, project=self.project,
                season=last_season, planting_date=date(year, month, 15),
            )

        response = self.client.post(
            '/openfarmplanner/api/seasons/create-transition/', {'copy': True},
        )

        self.assertEqual(response.status_code, 201, getattr(response, 'data', None))
        transition = Season.objects.get(pk=response.data['transition_season']['id'])
        followup = Season.objects.get(pk=response.data['followup_season']['id'])
        self.assertEqual((transition.start_date, transition.end_date), (date(2026, 9, 1), date(2026, 12, 31)))
        self.assertEqual((followup.start_date, followup.end_date), (date(2027, 1, 1), date(2027, 12, 31)))

        transition_dates = sorted(PlantingPlan.objects.filter(season=transition).values_list('planting_date', flat=True))
        followup_dates = sorted(PlantingPlan.objects.filter(season=followup).values_list('planting_date', flat=True))
        self.assertEqual(transition_dates, [date(2026, m, 15) for m in (9, 10, 11, 12)])
        self.assertEqual(followup_dates, [date(2027, m, 15) for m in range(1, 9)])
        self.assertEqual(response.data['transition_copied_count'], 4)
        self.assertEqual(response.data['followup_copied_count'], 8)
        self.assertEqual(response.data['skipped_count'], 0)
        # Every source plan landed in exactly one of the two seasons.
        self.assertEqual(len(transition_dates) + len(followup_dates), len(months))

    def test_create_transition_resurrecting_seasons_restores_their_planting_plans(self):
        self._set_pattern(1, 1)
        last_season = Season.objects.create(
            project=self.project, start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
        )
        for planting_date in (date(2025, 10, 15), date(2025, 11, 15), date(2026, 3, 15)):
            PlantingPlan.objects.create(
                crop=self.crop, bed=self.bed, project=self.project,
                season=last_season, planting_date=planting_date,
            )

        first = self.client.post('/openfarmplanner/api/seasons/create-transition/', {'copy': True})
        self.assertEqual(first.status_code, 201, getattr(first, 'data', None))
        transition_id = first.data['transition_season']['id']
        followup_id = first.data['followup_season']['id']
        plans_by_season = {
            transition_id: sorted(
                PlantingPlan.objects.filter(season_id=transition_id).values_list('pk', flat=True)
            ),
            followup_id: sorted(
                PlantingPlan.objects.filter(season_id=followup_id).values_list('pk', flat=True)
            ),
        }
        self.assertTrue(plans_by_season[transition_id] and plans_by_season[followup_id])

        # Delete both new seasons (hard-deletes their plans), leaving the gap.
        self.client.delete(f'/openfarmplanner/api/seasons/{transition_id}/')
        self.client.delete(f'/openfarmplanner/api/seasons/{followup_id}/')
        self.assertEqual(PlantingPlan.objects.exclude(season=last_season).count(), 0)

        # Re-running the transition flow resurrects both seasons AND brings
        # their previously contained plans back with their original ids.
        second = self.client.post('/openfarmplanner/api/seasons/create-transition/', {})
        self.assertEqual(second.status_code, 201, getattr(second, 'data', None))
        self.assertEqual(second.data['transition_season']['id'], transition_id)
        self.assertEqual(second.data['followup_season']['id'], followup_id)
        for season_id, plan_ids in plans_by_season.items():
            self.assertEqual(
                sorted(
                    PlantingPlan.objects.filter(season_id=season_id).values_list('pk', flat=True)
                ),
                plan_ids,
            )

    def test_creation_options_reports_copy_preview_for_each_option(self):
        self._set_pattern(1, 1)
        last_season = Season.objects.create(
            project=self.project, start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
        )
        for planting_date in (date(2025, 10, 15), date(2025, 12, 20), date(2026, 3, 1)):
            PlantingPlan.objects.create(
                crop=self.crop, bed=self.bed, project=self.project,
                season=last_season, planting_date=planting_date,
            )

        response = self.client.get('/openfarmplanner/api/seasons/creation-options/')

        self.assertEqual(response.data['seamless_period'], {
            'start_date': '2026-09-01', 'end_date': '2026-12-31',
        })
        self.assertEqual(response.data['due_period']['start_date'], '2027-01-01')
        self.assertEqual(response.data['copy_source_label'], last_season.label)
        preview = response.data['copy_preview']
        # Bridged routing: 2 of 3 plans land in the transition season, 1 in the
        # follow-up season, none are lost.
        self.assertEqual(preview['transition'], {'total': 3, 'copied': 2, 'skipped': 0})
        self.assertEqual(preview['transition_followup'], {'total': 3, 'copied': 1, 'skipped': 0})
        # Adopting the due period shifts each plan into 2027 by its own month,
        # so all three fit even though they span two calendar years in the source.
        self.assertEqual(preview['adopt'], {'total': 3, 'copied': 3, 'skipped': 0})

    def test_creation_options_manual_start_copies_every_plan_of_the_last_season(self):
        self._set_pattern(1, 1)
        last_season = Season.objects.create(
            project=self.project, start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
        )
        # Plans spread across the whole source season, including spring months
        # that a short Sep-Dec transition season could never hold.
        for planting_date in (date(2025, 10, 15), date(2026, 3, 1), date(2026, 6, 20)):
            PlantingPlan.objects.create(
                crop=self.crop, bed=self.bed, project=self.project,
                season=last_season, planting_date=planting_date,
            )

        response = self.client.get(
            '/openfarmplanner/api/seasons/creation-options/',
            {'manual_start_date': '2026-09-01'},
        )

        self.assertEqual(response.data['manual_period'], {
            'start_date': '2026-09-01', 'end_date': '2027-12-31',
        })
        self.assertEqual(
            response.data['copy_preview']['manual'],
            {'total': 3, 'copied': 3, 'skipped': 0},
        )


class SeasonCopyServiceTest(ProjectApiTestCase):
    def test_copy_is_additive_not_replacing(self):
        source = Season.objects.create(project=self.project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31))
        target = Season.objects.create(project=self.project, start_date=date(2027, 1, 1), end_date=date(2027, 12, 31))
        PlantingPlan.objects.create(
            crop=self.crop, bed=self.bed, project=self.project, season=source, planting_date=date(2026, 4, 1),
        )
        existing_target_plan = PlantingPlan.objects.create(
            crop=self.crop, bed=self.bed, project=self.project, season=target, planting_date=date(2027, 4, 1),
        )

        created_plans, skipped_count = copy_planting_plans(source_season=source, target_season=target)

        self.assertEqual(len(created_plans), 1)
        self.assertEqual(skipped_count, 0)
        target_plans = PlantingPlan.objects.filter(season=target)
        self.assertEqual(target_plans.count(), 2)
        self.assertTrue(target_plans.filter(pk=existing_target_plan.pk).exists())

    def test_copy_shifts_dates_into_the_target_seasons_year(self):
        source = Season.objects.create(project=self.project, start_date=date(2025, 9, 1), end_date=date(2026, 8, 31))
        target = Season.objects.create(project=self.project, start_date=date(2027, 9, 1), end_date=date(2028, 8, 31))
        original = PlantingPlan.objects.create(
            crop=self.crop, bed=self.bed, project=self.project, season=source,
            planting_date=date(2026, 4, 1),
        )

        copy_planting_plans(source_season=source, target_season=target)

        copied = PlantingPlan.objects.get(season=target)
        self.assertEqual(copied.planting_date, date(2028, 4, 1))
        self.assertEqual(copied.harvest_date, add_months(original.harvest_date, 24))
        self.assertEqual(copied.harvest_end_date, add_months(original.harvest_end_date, 24))

    def test_copy_clamps_leap_day_when_shifted_year_is_not_a_leap_year(self):
        source = Season.objects.create(project=self.project, start_date=date(2024, 1, 1), end_date=date(2024, 12, 31))
        target = Season.objects.create(project=self.project, start_date=date(2025, 1, 1), end_date=date(2025, 12, 31))
        PlantingPlan.objects.create(
            crop=self.crop, bed=self.bed, project=self.project, season=source, planting_date=date(2024, 2, 29),
        )

        copy_planting_plans(source_season=source, target_season=target)

        self.assertEqual(PlantingPlan.objects.get(season=target).planting_date, date(2025, 2, 28))

    def test_copy_skips_plans_whose_shifted_planting_date_leaves_a_short_target(self):
        source = Season.objects.create(
            project=self.project, start_date=date(2025, 1, 1), end_date=date(2025, 12, 31),
        )
        target = Season.objects.create(
            project=self.project, start_date=date(2026, 1, 1), end_date=date(2026, 4, 30),
        )
        PlantingPlan.objects.create(
            crop=self.crop, bed=self.bed, project=self.project, season=source,
            planting_date=date(2025, 3, 1),
        )
        PlantingPlan.objects.create(
            crop=self.crop, bed=self.bed, project=self.project, season=source,
            planting_date=date(2025, 9, 1),
        )

        created_plans, skipped_count = copy_planting_plans(source_season=source, target_season=target)

        self.assertEqual(len(created_plans), 1)
        self.assertEqual(skipped_count, 1)
        self.assertEqual(created_plans[0].planting_date, date(2026, 3, 1))

    def test_copy_from_a_multi_year_source_season_shifts_each_plan_into_range(self):
        # A manual transition season can span two calendar years (Sep 2026 -
        # Dec 2027). Its plans do not share one year offset relative to the next
        # regular season, so the shift must be derived per plan.
        source = Season.objects.create(
            project=self.project, start_date=date(2026, 9, 1), end_date=date(2027, 12, 31),
        )
        target = Season.objects.create(
            project=self.project, start_date=date(2028, 1, 1), end_date=date(2028, 12, 31),
        )
        PlantingPlan.objects.create(
            crop=self.crop, bed=self.bed, project=self.project, season=source,
            planting_date=date(2026, 10, 15),
        )
        PlantingPlan.objects.create(
            crop=self.crop, bed=self.bed, project=self.project, season=source,
            planting_date=date(2027, 3, 20),
        )

        created_plans, skipped_count = copy_planting_plans(source_season=source, target_season=target)

        self.assertEqual(skipped_count, 0)
        self.assertEqual(
            sorted(plan.planting_date for plan in created_plans),
            [date(2028, 3, 20), date(2028, 10, 15)],
        )


class SeasonApiTest(ProjectApiTestCase):
    def test_create_list_and_soft_delete_with_undelete(self):
        create_response = self.client.post('/openfarmplanner/api/seasons/', {
            'start_date': '2026-01-01', 'end_date': '2026-12-31',
        })
        self.assertEqual(create_response.status_code, 201)
        season_id = create_response.data['id']
        self.assertEqual(create_response.data['label'], '2026')

        delete_response = self.client.delete(f'/openfarmplanner/api/seasons/{season_id}/')
        self.assertEqual(delete_response.status_code, 204)
        self.assertFalse(Season.objects.filter(pk=season_id).exists())
        self.assertTrue(Season.all_objects.filter(pk=season_id).exists())

        undelete_response = self.client.post(f'/openfarmplanner/api/seasons/{season_id}/undelete/')
        self.assertEqual(undelete_response.status_code, 200)
        self.assertTrue(Season.objects.filter(pk=season_id).exists())

    def test_create_rejects_unassigned_plan_outside_period(self):
        plan = PlantingPlan.objects.create(
            crop=self.crop, bed=self.bed, project=self.project,
            planting_date=date(2026, 12, 15),
        )
        PlantingPlan.objects.filter(pk=plan.pk).update(harvest_end_date=date(2027, 1, 20))

        response = self.client.post('/openfarmplanner/api/seasons/', {
            'start_date': '2026-01-01', 'end_date': '2026-12-31',
        })

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['code'][0], 'season_unassigned_data_outside_period')
        self.assertEqual(str(response.data['conflict_count'][0]), '1')
        self.assertEqual(str(response.data['conflicts'][0]['id']), str(plan.pk))

    def test_whole_project_restore_rebuilds_seasons_and_keeps_plans_linked(self):
        season = Season.objects.create(
            project=self.project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        )
        plan = PlantingPlan.objects.create(
            crop=self.crop, bed=self.bed, project=self.project, season=season,
            planting_date=date(2026, 4, 1),
        )
        rename = self.client.patch(
            f'/openfarmplanner/api/seasons/{season.pk}/', {'custom_label': 'Ursprung'},
        )
        self.assertEqual(rename.status_code, 200)
        restore_point = self.client.get('/openfarmplanner/api/history/project/').json()[0]['history_id']

        self.client.patch(f'/openfarmplanner/api/seasons/{season.pk}/', {'custom_label': 'Geändert'})
        restore = self.client.post(
            '/openfarmplanner/api/history/project/restore/', {'history_id': restore_point},
        )

        self.assertEqual(restore.status_code, 200, restore.data)
        season.refresh_from_db()
        self.assertEqual(season.custom_label, 'Ursprung')
        # The plan stayed attached to the (rebuilt) season, not orphaned.
        self.assertTrue(PlantingPlan.objects.filter(pk=plan.pk, season=season).exists())

    def test_deleting_a_season_records_and_restores_its_plans_tasks(self):
        from farm.models import Task
        season = Season.objects.create(
            project=self.project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        )
        plan = PlantingPlan.objects.create(
            crop=self.crop, bed=self.bed, project=self.project, season=season,
            planting_date=date(2026, 4, 1),
        )
        task_id = Task.objects.create(
            project=self.project, planting_plan=plan, title='Aussäen',
        ).pk

        self.client.delete(f'/openfarmplanner/api/seasons/{season.pk}/')
        self.assertEqual(Task.objects.filter(pk=task_id).count(), 0)
        self.assertTrue(
            EntityRevision.objects.filter(
                project=self.project, entity_type='task', object_id=task_id,
                action=EntityRevision.ACTION_DELETED,
            ).exists()
        )

        self.client.post(f'/openfarmplanner/api/seasons/{season.pk}/undelete/')
        restored = Task.objects.get(pk=task_id)
        self.assertEqual(restored.title, 'Aussäen')
        self.assertEqual(restored.planting_plan_id, plan.pk)

    def test_reverting_season_create_records_the_cascade_deleted_plans(self):
        create = self.client.post('/openfarmplanner/api/seasons/', {
            'start_date': '2026-01-01', 'end_date': '2026-12-31',
        })
        season_id = create.data['id']
        plan_id = PlantingPlan.objects.create(
            crop=self.crop, bed=self.bed, project=self.project,
            season_id=season_id, planting_date=date(2026, 4, 1),
        ).pk
        batch = BatchOperation.objects.get(project=self.project, operation_type='season_create')

        revert = self.client.post(f'/openfarmplanner/api/history/batch/{batch.pk}/revert/')
        self.assertEqual(revert.status_code, 200, revert.data)
        self.assertFalse(Season.all_objects.filter(pk=season_id).exists())
        self.assertEqual(PlantingPlan.objects.filter(pk=plan_id).count(), 0)

        # The plan the DB cascade removed is recorded on the revert batch, so
        # reverting the revert brings both season and plan back.
        revert_batch = BatchOperation.objects.filter(
            project=self.project, operation_type='batch_reverted',
        ).latest('id')
        self.assertTrue(
            revert_batch.revisions.filter(
                entity_type='planting_plan', object_id=plan_id,
                action=EntityRevision.ACTION_DELETED,
            ).exists()
        )
        second = self.client.post(f'/openfarmplanner/api/history/batch/{revert_batch.pk}/revert/')
        self.assertEqual(second.status_code, 200, second.data)
        self.assertTrue(Season.objects.filter(pk=season_id).exists())
        self.assertTrue(PlantingPlan.objects.filter(pk=plan_id, season_id=season_id).exists())

    def test_undelete_nulls_a_planting_plan_fk_whose_target_is_gone(self):
        from farm.models import Bed
        bed = Bed.objects.create(project=self.project, field=self.field, name='Doomed', area_sqm=5)
        season = Season.objects.create(
            project=self.project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        )
        plan_id = PlantingPlan.objects.create(
            crop=self.crop, bed=bed, project=self.project, season=season,
            planting_date=date(2026, 4, 1),
        ).pk
        self.client.delete(f'/openfarmplanner/api/seasons/{season.pk}/')
        bed.delete()

        response = self.client.post(f'/openfarmplanner/api/seasons/{season.pk}/undelete/')

        self.assertEqual(response.status_code, 200, getattr(response, 'data', None))
        restored = PlantingPlan.objects.get(pk=plan_id)
        self.assertIsNone(restored.bed_id)
        self.assertEqual(restored.season_id, season.pk)

    def test_recreating_a_seasons_period_also_restores_its_planting_plans(self):
        season = Season.objects.create(
            project=self.project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        )
        plan_id = PlantingPlan.objects.create(
            crop=self.crop, bed=self.bed, project=self.project, season=season,
            planting_date=date(2026, 4, 1),
        ).pk
        self.client.delete(f'/openfarmplanner/api/seasons/{season.pk}/')
        self.assertEqual(PlantingPlan.objects.filter(pk=plan_id).count(), 0)

        create = self.client.post('/openfarmplanner/api/seasons/', {
            'start_date': '2026-01-01', 'end_date': '2026-12-31',
        })

        self.assertEqual(create.status_code, 201)
        self.assertEqual(create.data['id'], season.pk)
        self.assertTrue(PlantingPlan.objects.filter(pk=plan_id, season_id=season.pk).exists())

    def test_deleting_a_season_deletes_its_planting_plans_and_undelete_restores_them(self):
        season = Season.objects.create(
            project=self.project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        )
        plan_ids = [
            PlantingPlan.objects.create(
                crop=self.crop, bed=self.bed, project=self.project, season=season,
                planting_date=date(2026, 4, day),
            ).pk
            for day in (1, 8, 15)
        ]

        self.client.delete(f'/openfarmplanner/api/seasons/{season.pk}/')

        self.assertEqual(PlantingPlan.objects.filter(pk__in=plan_ids).count(), 0)
        self.assertEqual(
            EntityRevision.objects.filter(
                project=self.project, entity_type='planting_plan',
                object_id__in=plan_ids, action=EntityRevision.ACTION_DELETED,
            ).count(),
            3,
        )

        self.client.post(f'/openfarmplanner/api/seasons/{season.pk}/undelete/')

        restored = PlantingPlan.objects.filter(season=season)
        self.assertEqual(sorted(restored.values_list('pk', flat=True)), sorted(plan_ids))
        self.assertEqual(
            {plan.planting_date for plan in restored},
            {date(2026, 4, 1), date(2026, 4, 8), date(2026, 4, 15)},
        )

    def test_season_delete_groups_its_cascade_into_one_batch_operation(self):
        season = Season.objects.create(
            project=self.project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        )
        for day in (1, 8, 15):
            PlantingPlan.objects.create(
                crop=self.crop, bed=self.bed, project=self.project, season=season,
                planting_date=date(2026, 4, day),
            )

        self.client.delete(f'/openfarmplanner/api/seasons/{season.pk}/')

        batch = BatchOperation.objects.get(project=self.project, operation_type='season_delete')
        self.assertEqual(batch.context, {'season_label': season.label})
        # 1 season revision + 3 planting-plan revisions, all in the same batch.
        self.assertEqual(batch.revisions.count(), 4)
        self.assertEqual(
            batch.revisions.filter(entity_type='planting_plan').count(), 3,
        )
        self.assertEqual(
            batch.revisions.filter(entity_type='season', object_id=season.pk).count(), 1,
        )
        # Nothing from this cascade was left ungrouped.
        self.assertFalse(
            EntityRevision.objects
            .filter(project=self.project, batch_operation__isnull=True)
            .filter(entity_type__in=['season', 'planting_plan'])
            .exists()
        )

        history = self.client.get('/openfarmplanner/api/history/project/').json()
        batch_entries = [entry for entry in history if entry.get('is_batch')]
        self.assertEqual(len(batch_entries), 1)
        self.assertEqual(batch_entries[0]['batch_operation_type'], 'season_delete')
        self.assertEqual(len(batch_entries[0]['children']), 4)
        child_ids = {child['history_id'] for child in batch_entries[0]['children']}
        self.assertEqual(child_ids, set(batch.revisions.values_list('id', flat=True)))

    def test_copy_from_records_grouped_created_revisions_for_copied_plans(self):
        source = Season.objects.create(project=self.project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31))
        target = Season.objects.create(project=self.project, start_date=date(2027, 1, 1), end_date=date(2027, 12, 31))
        for day in (1, 8):
            PlantingPlan.objects.create(
                crop=self.crop, bed=self.bed, project=self.project, season=source,
                planting_date=date(2026, 4, day),
            )

        response = self.client.post(f'/openfarmplanner/api/seasons/{target.pk}/copy-from/', {
            'source_season_id': source.pk,
        })

        self.assertEqual(response.data['copied_count'], 2)
        batch = BatchOperation.objects.get(project=self.project, operation_type='season_copy_data')
        self.assertEqual(batch.context['target_season_label'], target.label)
        self.assertEqual(
            batch.revisions.filter(action=EntityRevision.ACTION_CREATED, entity_type='planting_plan').count(),
            2,
        )

    def test_reverting_a_season_delete_batch_brings_season_and_plans_back(self):
        create = self.client.post('/openfarmplanner/api/seasons/', {
            'start_date': '2026-01-01', 'end_date': '2026-12-31',
        })
        season_id = create.data['id']
        plan_ids = [
            PlantingPlan.objects.create(
                crop=self.crop, bed=self.bed, project=self.project,
                season_id=season_id, planting_date=date(2026, 4, day),
            ).pk
            for day in (1, 8)
        ]
        self.client.delete(f'/openfarmplanner/api/seasons/{season_id}/')
        self.assertFalse(Season.objects.filter(pk=season_id).exists())
        self.assertEqual(PlantingPlan.objects.filter(pk__in=plan_ids).count(), 0)

        batch = BatchOperation.objects.get(project=self.project, operation_type='season_delete')
        revert = self.client.post(f'/openfarmplanner/api/history/batch/{batch.pk}/revert/')

        self.assertEqual(revert.status_code, 200, revert.data)
        self.assertTrue(Season.objects.filter(pk=season_id).exists())
        self.assertEqual(
            sorted(PlantingPlan.objects.filter(season_id=season_id).values_list('pk', flat=True)),
            sorted(plan_ids),
        )

        # Reverting the revert re-applies the deletion.
        revert_batch = BatchOperation.objects.filter(
            project=self.project, operation_type='batch_reverted',
        ).latest('id')
        second = self.client.post(f'/openfarmplanner/api/history/batch/{revert_batch.pk}/revert/')
        self.assertEqual(second.status_code, 200, second.data)
        self.assertFalse(Season.objects.filter(pk=season_id).exists())

    def test_reverting_a_season_create_batch_deletes_the_season(self):
        create = self.client.post('/openfarmplanner/api/seasons/', {
            'start_date': '2026-01-01', 'end_date': '2026-12-31',
        })
        season_id = create.data['id']
        batch = BatchOperation.objects.get(project=self.project, operation_type='season_create')

        revert = self.client.post(f'/openfarmplanner/api/history/batch/{batch.pk}/revert/')

        self.assertEqual(revert.status_code, 200, revert.data)
        self.assertFalse(Season.all_objects.filter(pk=season_id).exists())
        # Reverting again is idempotent, not an error.
        self.assertEqual(
            self.client.post(f'/openfarmplanner/api/history/batch/{batch.pk}/revert/').status_code, 200,
        )
        self.assertFalse(Season.all_objects.filter(pk=season_id).exists())

    def test_undelete_leaves_individually_deleted_plans_deleted(self):
        season = Season.objects.create(
            project=self.project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        )
        kept = PlantingPlan.objects.create(
            crop=self.crop, bed=self.bed, project=self.project, season=season,
            planting_date=date(2026, 4, 1),
        )
        removed = PlantingPlan.objects.create(
            crop=self.crop, bed=self.bed, project=self.project, season=season,
            planting_date=date(2026, 5, 1),
        )
        self.client.delete(f'/openfarmplanner/api/planting-plans/{removed.pk}/')

        self.client.delete(f'/openfarmplanner/api/seasons/{season.pk}/')
        self.client.post(f'/openfarmplanner/api/seasons/{season.pk}/undelete/')

        self.assertEqual(
            list(PlantingPlan.objects.filter(season=season).values_list('pk', flat=True)),
            [kept.pk],
        )

    def test_copy_from_endpoint_is_additive(self):
        source = Season.objects.create(project=self.project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31))
        target = Season.objects.create(project=self.project, start_date=date(2027, 1, 1), end_date=date(2027, 12, 31))
        PlantingPlan.objects.create(
            crop=self.crop, bed=self.bed, project=self.project, season=source, planting_date=date(2026, 4, 1),
        )

        response = self.client.post(f'/openfarmplanner/api/seasons/{target.pk}/copy-from/', {
            'source_season_id': source.pk,
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['copied_count'], 1)
        self.assertEqual(response.data['target_planting_plan_count'], 1)

    def test_copy_from_returns_structured_error_for_missing_source(self):
        target = Season.objects.create(
            project=self.project, start_date=date(2027, 1, 1), end_date=date(2027, 12, 31),
        )

        response = self.client.post(
            f'/openfarmplanner/api/seasons/{target.pk}/copy-from/',
            {'source_season_id': 999999},
        )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data['code'], 'source_season_not_found')
        self.assertEqual(response.data['detail'], 'Source season not found.')

    def test_copy_from_returns_structured_error_for_same_season(self):
        season = Season.objects.create(
            project=self.project, start_date=date(2027, 1, 1), end_date=date(2027, 12, 31),
        )

        response = self.client.post(
            f'/openfarmplanner/api/seasons/{season.pk}/copy-from/',
            {'source_season_id': season.pk},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['code'], 'same_source_and_target_season')

    def test_create_resurrects_a_soft_deleted_season_for_the_same_period(self):
        season = Season.objects.create(
            project=self.project, start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
        )
        self.client.delete(f'/openfarmplanner/api/seasons/{season.pk}/')
        self.assertFalse(Season.objects.filter(pk=season.pk).exists())

        response = self.client.post('/openfarmplanner/api/seasons/', {
            'start_date': '2026-09-01', 'end_date': '2027-08-31',
        })

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['id'], season.pk)
        self.assertTrue(Season.objects.filter(pk=season.pk).exists())
        self.assertEqual(Season.all_objects.filter(project=self.project).count(), 1)

    def test_create_rejects_duplicate_or_overlapping_period(self):
        Season.objects.create(
            project=self.project,
            start_date=date(2025, 9, 1),
            end_date=date(2026, 8, 31),
        )

        duplicate_response = self.client.post('/openfarmplanner/api/seasons/', {
            'start_date': '2025-09-01', 'end_date': '2026-08-31',
        })
        overlap_response = self.client.post('/openfarmplanner/api/seasons/', {
            'start_date': '2026-08-01', 'end_date': '2027-07-31',
        })

        self.assertEqual(duplicate_response.status_code, 400)
        self.assertEqual(overlap_response.status_code, 400)
        self.assertEqual(Season.objects.filter(project=self.project).count(), 1)

    def test_planting_plans_can_be_filtered_by_season_header(self):
        season_a = Season.objects.create(project=self.project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31))
        season_b = Season.objects.create(project=self.project, start_date=date(2027, 1, 1), end_date=date(2027, 12, 31))
        plan_a = PlantingPlan.objects.create(
            crop=self.crop, bed=self.bed, project=self.project, season=season_a, planting_date=date(2026, 4, 1),
        )
        PlantingPlan.objects.create(
            crop=self.crop, bed=self.bed, project=self.project, season=season_b, planting_date=date(2027, 4, 1),
        )

        response = self.client.get('/openfarmplanner/api/planting-plans/', HTTP_X_SEASON_ID=str(season_a.pk))
        self.assertEqual(response.status_code, 200)
        ids = [row['id'] for row in response.data['results']]
        self.assertEqual(ids, [plan_a.pk])


class SeasonPeriodEditApiTest(ProjectApiTestCase):
    def _patch_period(self, season, start_date, end_date):
        return self.client.patch(
            f'/openfarmplanner/api/seasons/{season.pk}/',
            {'start_date': start_date, 'end_date': end_date},
        )

    def test_period_edit_succeeds_and_updates_dates(self):
        season = Season.objects.create(
            project=self.project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        )
        PlantingPlan.objects.create(
            crop=self.crop, bed=self.bed, project=self.project, season=season,
            planting_date=date(2026, 5, 1),
        )

        response = self._patch_period(season, '2026-03-01', '2026-12-31')

        self.assertEqual(response.status_code, 200, getattr(response, 'data', None))
        season.refresh_from_db()
        self.assertEqual(season.start_date, date(2026, 3, 1))

    def test_period_edit_blocked_by_planting_date_outside_new_period(self):
        season = Season.objects.create(
            project=self.project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        )
        plan = PlantingPlan.objects.create(
            crop=self.crop, bed=self.bed, project=self.project, season=season,
            planting_date=date(2026, 2, 10),
        )

        response = self._patch_period(season, '2026-06-01', '2026-12-31')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['code'][0], 'season_period_edit_conflict')
        conflict = response.data['planting_plan_conflicts'][0]
        self.assertEqual(str(conflict['id']), str(plan.pk))
        self.assertEqual(str(conflict['planting_date']), '2026-02-10')
        season.refresh_from_db()
        self.assertEqual(season.start_date, date(2026, 1, 1))

    def test_period_edit_allows_harvest_dates_outside_new_period(self):
        season = Season.objects.create(
            project=self.project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        )
        plan = PlantingPlan.objects.create(
            crop=self.crop, bed=self.bed, project=self.project, season=season,
            planting_date=date(2026, 11, 1),
        )
        PlantingPlan.objects.filter(pk=plan.pk).update(harvest_end_date=date(2027, 3, 1))

        response = self._patch_period(season, '2026-01-01', '2026-12-15')

        self.assertEqual(response.status_code, 200, getattr(response, 'data', None))

    def test_period_edit_blocked_by_overlap_with_neighbouring_season(self):
        Season.objects.create(
            project=self.project, start_date=date(2025, 1, 1), end_date=date(2025, 12, 31),
        )
        season = Season.objects.create(
            project=self.project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        )

        response = self._patch_period(season, '2025-11-01', '2026-12-31')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['code'][0], 'season_period_edit_conflict')
        overlap = response.data['overlap_conflicts'][0]
        self.assertEqual(str(overlap['overlap_start_date']), '2025-11-01')
        self.assertEqual(str(overlap['overlap_end_date']), '2025-12-31')


class SeasonSetupApiTest(ProjectApiTestCase):
    def test_status_reports_unassigned_plans(self):
        PlantingPlan.objects.create(
            crop=self.crop, bed=self.bed, project=self.project, planting_date=date(2026, 4, 1),
        )
        response = self.client.get('/openfarmplanner/api/season-setup/status/')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['needs_setup'])
        self.assertEqual(response.data['unassigned_planting_plan_count'], 1)

    def test_apply_assigns_existing_plans_without_touching_data(self):
        plan = PlantingPlan.objects.create(
            crop=self.crop, bed=self.bed, project=self.project, planting_date=date(2026, 4, 1), notes='keep me',
        )
        response = self.client.post('/openfarmplanner/api/season-setup/apply/', {
            'start_day': 1, 'start_month': 1,
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['assigned_planting_plan_count'], 1)
        plan.refresh_from_db()
        self.assertIsNotNone(plan.season_id)
        self.assertEqual(plan.notes, 'keep me')

        pattern = SeasonPattern.objects.get(project=self.project)
        self.assertEqual((pattern.start_day, pattern.start_month), (1, 1))

    def test_apply_anchors_on_the_plans_own_dates_not_on_today(self):
        """Legacy plans predating the feature must land in the season matching
        their own history, not whatever period contains "today" when a user
        happens to run the setup — see docs/seasons-architecture.md."""
        PlantingPlan.objects.create(
            crop=self.crop, bed=self.bed, project=self.project, planting_date=date(2023, 3, 1),
        )
        PlantingPlan.objects.create(
            crop=self.crop, bed=self.bed, project=self.project, planting_date=date(2023, 9, 1),
        )

        status_response = self.client.get('/openfarmplanner/api/season-setup/status/')
        self.assertEqual(status_response.data['computed_start_date'], '2023-01-01')
        self.assertEqual(status_response.data['computed_end_date'], '2023-12-31')

        response = self.client.post('/openfarmplanner/api/season-setup/apply/', {
            'start_day': 1, 'start_month': 1,
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['assigned_planting_plan_count'], 2)
        self.assertEqual(response.data['season']['start_date'], '2023-01-01')
        self.assertEqual(response.data['season']['label'], '2023')

    def test_status_preview_reflects_an_unsaved_pattern_selection(self):
        """The dialog recomputes its preview as the user changes day/month,
        before saving — the status endpoint must support that override."""
        PlantingPlan.objects.create(
            crop=self.crop, bed=self.bed, project=self.project, planting_date=date(2026, 4, 1),
        )
        default_response = self.client.get('/openfarmplanner/api/season-setup/status/')
        self.assertEqual(default_response.data['computed_start_date'], '2026-01-01')

        preview_response = self.client.get(
            '/openfarmplanner/api/season-setup/status/', {'start_day': 1, 'start_month': 9},
        )
        self.assertEqual(preview_response.status_code, 200)
        self.assertEqual(preview_response.data['computed_start_date'], '2025-09-01')
        self.assertEqual(preview_response.data['computed_end_date'], '2026-08-31')

        # The override is preview-only — the persisted pattern is untouched.
        pattern = SeasonPattern.objects.get(project=self.project)
        self.assertEqual((pattern.start_day, pattern.start_month), (1, 1))

    def test_due_suggestion_advances_once_season_exists(self):
        start_date, end_date = compute_due_season_period(self.project, today=date(2026, 6, 1))
        missing = find_due_but_missing_season(self.project, today=date(2026, 6, 1))
        self.assertEqual(missing, (start_date, end_date))

        Season.objects.create(project=self.project, start_date=start_date, end_date=end_date)
        self.assertEqual(
            find_due_but_missing_season(self.project, today=date(2026, 6, 1)),
            (date(2027, 1, 1), date(2027, 12, 31)),
        )


class SeededProjectSeasonTest(ProjectApiTestCase):
    """The first-run setup modal targets pre-season projects only — a project
    the app itself just seeded must come out already assigned to a season."""

    def _assert_no_setup_needed(self):
        response = self.client.get('/openfarmplanner/api/season-setup/status/')
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data['needs_setup'])
        self.assertEqual(response.data['unassigned_planting_plan_count'], 0)

    def test_demo_project_plans_are_assigned_to_the_season_of_their_dates(self):
        populate_demo_project(self.project, owner=self.user)

        plans = list(PlantingPlan.objects.filter(project=self.project))
        self.assertGreater(len(plans), 0)
        self.assertEqual({plan.season_id for plan in plans if plan.season_id is None}, set())

        seasons = {(season.start_date, season.end_date) for season in Season.objects.filter(project=self.project)}
        self.assertEqual(seasons, {
            (date(2025, 1, 1), date(2025, 12, 31)),
            (date(2026, 1, 1), date(2026, 12, 31)),
        })
        self._assert_no_setup_needed()

    def test_repopulating_the_demo_project_does_not_accumulate_seasons(self):
        populate_demo_project(self.project, owner=self.user)
        populate_demo_project(self.project, owner=self.user)

        self.assertEqual(Season.objects.filter(project=self.project).count(), 2)
        self._assert_no_setup_needed()

    def test_hint_test_project_plans_are_assigned_to_a_season(self):
        populate_hint_test_project(self.project, owner=self.user)

        self.assertFalse(
            PlantingPlan.objects.filter(project=self.project, season__isnull=True).exists(),
        )
        self._assert_no_setup_needed()

    def test_assignment_respects_a_non_calendar_season_pattern(self):
        SeasonPattern.objects.update_or_create(
            project=self.project, defaults={'start_day': 1, 'start_month': 9},
        )
        PlantingPlan.objects.create(
            crop=self.crop, bed=self.bed, project=self.project,
            planting_date=date(2026, 4, 1),
        )

        season = assign_unassigned_planting_plans(self.project)

        self.assertIsNotNone(season)
        self.assertEqual(season.start_date, date(2025, 9, 1))
        self.assertEqual(season.end_date, date(2026, 8, 31))
        self.assertEqual(season.label, '25/26')

    def test_assignment_is_a_no_op_without_planting_plans(self):
        self.assertIsNone(assign_unassigned_planting_plans(self.project))
        self.assertEqual(Season.objects.filter(project=self.project).count(), 0)


class PlantingPlanSeasonCreateGuardTest(ProjectApiTestCase):
    """New planting plans require an active season."""

    def _create_plan(self, planting_date='2026-04-01', **headers):
        payload = {
            'crop': self.crop.id,
            'bed': self.bed.id,
            'cultivation_type': 'pre_cultivation',
            'area_usage_sqm': '2.0',
        }
        if planting_date is not None:
            payload['planting_date'] = planting_date
        return self.client.post('/openfarmplanner/api/planting-plans/', payload, **headers)

    def test_create_without_season_header_is_rejected(self):
        response = self._create_plan()
        self.assertEqual(response.status_code, 400)
        self.assertIn('season', response.data)
        self.assertEqual(PlantingPlan.objects.filter(project=self.project).count(), 0)
        self.assertEqual(Season.objects.filter(project=self.project).count(), 0)

    def test_create_without_planting_date_is_rejected_without_active_season(self):
        response = self._create_plan(planting_date=None)
        self.assertEqual(response.status_code, 400)
        self.assertIn('season', response.data)

    def test_season_header_assigns_the_plan(self):
        season = Season.objects.create(
            project=self.project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        )
        response = self._create_plan(HTTP_X_SEASON_ID=str(season.id))

        self.assertEqual(response.status_code, 201)
        self.assertEqual(PlantingPlan.objects.get(pk=response.data['id']).season_id, season.id)
        self.assertEqual(Season.objects.filter(project=self.project).count(), 1)

    def test_repeated_creates_use_the_active_season(self):
        season = Season.objects.create(
            project=self.project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        )
        self._create_plan(planting_date='2026-04-01', HTTP_X_SEASON_ID=str(season.id))
        self._create_plan(planting_date='2026-09-15', HTTP_X_SEASON_ID=str(season.id))
        self.assertEqual(Season.objects.filter(project=self.project).count(), 1)
        self.assertEqual(PlantingPlan.objects.filter(project=self.project, season=season).count(), 2)
