from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from farm.models import Crop, Location, Project, ProjectMembership, Supplier
from farm.services.engagement_dashboard import (
    ENGAGEMENT_MODELS,
    ProjectEngagement,
    build_engagement_dashboard,
)


class EngagementDashboardTests(TestCase):
    def setUp(self) -> None:
        self.superuser = get_user_model().objects.create_superuser(
            username='admin',
            email='admin@example.com',
            password='test-password',
        )
        self.member = get_user_model().objects.create_user(
            username='member',
            password='test-password',
            last_login=timezone.now(),
        )
        self.active_project = Project.objects.create(name='Active', slug='active')
        self.empty_project = Project.objects.create(name='Empty', slug='empty')
        ProjectMembership.objects.create(user=self.member, project=self.active_project)
        self.location = Location.objects.create(name='Farm', project=self.active_project)

    def test_service_aggregates_activity_without_project_query_growth(self) -> None:
        old_time = timezone.now() - timedelta(days=40)
        Location.objects.filter(pk=self.location.pk).update(created_at=old_time)
        recent_time = timezone.now() - timedelta(days=2)
        Location.objects.filter(pk=self.location.pk).update(updated_at=recent_time)

        with self.assertNumQueries(len(ENGAGEMENT_MODELS) + 4):
            dashboard = build_engagement_dashboard()

        projects_by_slug = {row.project.slug: row for row in dashboard.projects}
        active = projects_by_slug['active']
        empty = projects_by_slug['empty']
        self.assertEqual(active.project, self.active_project)
        self.assertEqual(active.last_active, recent_time)
        self.assertEqual(active.created_last_7_days, 0)
        self.assertEqual(active.created_last_30_days, 0)
        self.assertEqual(active.active_users_last_30_days, 1)
        self.assertEqual(active.status, 'Aktiv')
        self.assertEqual(empty.status, 'Nur registriert')
        self.assertEqual(dashboard.active_projects_7_days, 1)
        self.assertGreaterEqual(dashboard.total_projects, 2)
        self.assertEqual(dashboard.total_users, 2)

    def test_dashboard_is_available_to_superusers(self) -> None:
        self.client.force_login(self.superuser)

        response = self.client.get(reverse('admin:farm_project_engagement'))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Nutzungsübersicht')
        self.assertContains(response, self.active_project.name)

    def test_dashboard_link_is_on_project_list_for_superusers(self) -> None:
        self.client.force_login(self.superuser)

        response = self.client.get(reverse('admin:farm_project_changelist'))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, reverse('admin:farm_project_engagement'))
        self.assertContains(response, 'Nutzungsübersicht')

    def test_dashboard_rejects_non_superusers(self) -> None:
        staff_user = get_user_model().objects.create_user(
            username='staff',
            password='test-password',
            is_staff=True,
        )
        self.client.force_login(staff_user)

        response = self.client.get(reverse('admin:farm_project_engagement'))

        self.assertEqual(response.status_code, 403)


class EngagementStatusTests(TestCase):
    """`ProjectEngagement.status` is the label the admin table sorts attention by."""

    def _row(self, days_ago: float | None) -> ProjectEngagement:
        project = Project.objects.create(name=f'P{days_ago}', slug=f'status-{days_ago}')
        last_active = None if days_ago is None else timezone.now() - timedelta(days=days_ago)
        return ProjectEngagement(project=project, last_active=last_active)

    def test_a_project_with_no_activity_at_all_is_only_registered(self):
        self.assertEqual(self._row(None).status, 'Nur registriert')

    def test_activity_within_seven_days_is_active(self):
        self.assertEqual(self._row(0).status, 'Aktiv')
        self.assertEqual(self._row(6.9).status, 'Aktiv')

    def test_activity_between_seven_and_thirty_days_is_quiet(self):
        self.assertEqual(self._row(7.1).status, 'Ruhig')
        self.assertEqual(self._row(29.9).status, 'Ruhig')

    def test_activity_older_than_thirty_days_is_inactive(self):
        self.assertEqual(self._row(30.1).status, 'Inaktiv')
        self.assertEqual(self._row(365).status, 'Inaktiv')


class EngagementAggregationTests(TestCase):
    """The dashboard rolls a dozen models into four numbers per project.

    Each of those numbers spans every model in `ENGAGEMENT_MODELS`, so an
    aggregate that silently only counted the last model would still look
    plausible — these pin the summing and the recency across models.
    """

    def setUp(self) -> None:
        self.now = timezone.now()
        self.project = Project.objects.create(name='Aggregation', slug='aggregation')
        self.other = Project.objects.create(name='Other', slug='aggregation-other')

    def _dashboard(self):
        return build_engagement_dashboard(now=self.now)

    def _row_for(self, project: Project) -> ProjectEngagement:
        return next(
            row for row in self._dashboard().projects if row.project.pk == project.pk
        )

    def _age(self, model, pk: int, days: float) -> None:
        stamp = self.now - timedelta(days=days)
        model.objects.filter(pk=pk).update(created_at=stamp, updated_at=stamp)

    def test_creation_counts_sum_across_every_model(self):
        location = Location.objects.create(name='Feldrand', project=self.project)
        supplier = Supplier.objects.create(
            name='Lieferant', homepage_url='https://s.example', project=self.project,
        )
        crop = Crop.objects.create(name='Tomate', project=self.project)
        for model, pk in ((Location, location.pk), (Supplier, supplier.pk), (Crop, crop.pk)):
            self._age(model, pk, 1)

        row = self._row_for(self.project)

        self.assertEqual(row.created_last_7_days, 3)
        self.assertEqual(row.created_last_30_days, 3)

    def test_the_two_windows_are_nested_not_exclusive(self):
        recent = Location.objects.create(name='Neu', project=self.project)
        older = Location.objects.create(name='Alt', project=self.project)
        ancient = Location.objects.create(name='Uralt', project=self.project)
        self._age(Location, recent.pk, 1)
        self._age(Location, older.pk, 20)
        self._age(Location, ancient.pk, 200)

        row = self._row_for(self.project)

        self.assertEqual(row.created_last_7_days, 1)
        self.assertEqual(row.created_last_30_days, 2)

    def test_last_active_is_the_newest_timestamp_across_all_models(self):
        old_location = Location.objects.create(name='Alt', project=self.project)
        new_crop = Crop.objects.create(name='Tomate', project=self.project)
        self._age(Location, old_location.pk, 40)
        self._age(Crop, new_crop.pk, 3)

        row = self._row_for(self.project)

        self.assertEqual(row.last_active, self.now - timedelta(days=3))

    def test_an_edit_counts_as_activity_without_counting_as_a_creation(self):
        """`updated_at` feeds recency, `created_at` feeds the creation counts —
        so touching an old row moves the project back to active without
        inflating what it built this week."""
        location = Location.objects.create(name='Alt', project=self.project)
        Location.objects.filter(pk=location.pk).update(
            created_at=self.now - timedelta(days=200),
            updated_at=self.now - timedelta(days=2),
        )

        row = self._row_for(self.project)

        self.assertEqual(row.last_active, self.now - timedelta(days=2))
        self.assertEqual(row.created_last_30_days, 0)

    def test_rows_from_one_project_never_land_on_another(self):
        Location.objects.create(name='Meins', project=self.project)

        self.assertEqual(self._row_for(self.other).created_last_30_days, 0)
        self.assertIsNone(self._row_for(self.other).last_active)

    def test_projects_are_ordered_by_recency_with_the_untouched_ones_last(self):
        busy = Project.objects.create(name='Busy', slug='order-busy')
        stale = Project.objects.create(name='Stale', slug='order-stale')
        busy_location = Location.objects.create(name='B', project=busy)
        stale_location = Location.objects.create(name='S', project=stale)
        self._age(Location, busy_location.pk, 1)
        self._age(Location, stale_location.pk, 100)

        slugs = [row.project.slug for row in self._dashboard().projects]

        self.assertLess(slugs.index('order-busy'), slugs.index('order-stale'))
        self.assertLess(slugs.index('order-stale'), slugs.index('aggregation'))

    def test_active_users_counts_each_member_once_and_only_recent_logins(self):
        # Note: `ProjectMembership` is unique per (user, project), so the
        # `distinct=True` on the count can never change the result — dropping it
        # breaks nothing. The `last_login` filter is the load-bearing half.
        recent = get_user_model().objects.create_user(
            username='recent-login', password='pass12345',
            last_login=self.now - timedelta(days=3),
        )
        stale = get_user_model().objects.create_user(
            username='stale-login', password='pass12345',
            last_login=self.now - timedelta(days=90),
        )
        never = get_user_model().objects.create_user(username='never-login', password='pass12345')
        for user in (recent, stale, never):
            ProjectMembership.objects.create(user=user, project=self.project)

        self.assertEqual(self._row_for(self.project).active_users_last_30_days, 1)

    def test_the_totals_count_projects_by_window_and_users_by_login(self):
        recent = Project.objects.create(name='R', slug='totals-recent')
        quiet = Project.objects.create(name='Q', slug='totals-quiet')
        recent_location = Location.objects.create(name='R', project=recent)
        quiet_location = Location.objects.create(name='Q', project=quiet)
        self._age(Location, recent_location.pk, 2)
        self._age(Location, quiet_location.pk, 15)
        get_user_model().objects.create_user(
            username='totals-recent-user', password='pass12345',
            last_login=self.now - timedelta(days=1),
        )
        get_user_model().objects.create_user(username='totals-never-user', password='pass12345')

        dashboard = self._dashboard()

        self.assertEqual(dashboard.active_projects_7_days, 1)
        self.assertEqual(dashboard.active_projects_30_days, 2)
        self.assertEqual(dashboard.total_projects, len(dashboard.projects))
        self.assertEqual(dashboard.total_users, 2)
        self.assertEqual(dashboard.users_logged_in_30_days, 1)

    def test_the_injected_clock_moves_both_windows(self):
        location = Location.objects.create(name='Grenzfall', project=self.project)
        self._age(Location, location.pk, 3)

        as_of_now = build_engagement_dashboard(now=self.now)
        much_later = build_engagement_dashboard(now=self.now + timedelta(days=60))

        row_now = next(r for r in as_of_now.projects if r.project.pk == self.project.pk)
        row_later = next(r for r in much_later.projects if r.project.pk == self.project.pk)
        self.assertEqual(row_now.created_last_7_days, 1)
        self.assertEqual(row_later.created_last_7_days, 0)
        self.assertEqual(row_later.created_last_30_days, 0)
        self.assertEqual(as_of_now.active_projects_7_days, 1)
        self.assertEqual(much_later.active_projects_7_days, 0)
