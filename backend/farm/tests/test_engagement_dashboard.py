from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from farm.models import (
    Bed,
    BedLayout,
    Crop,
    Feedback,
    Field,
    FieldLayout,
    Location,
    NoteAttachment,
    PlantingPlan,
    Project,
    ProjectMembership,
    PublicCrop,
    PublicCropDiscussionComment,
    PublicCropDiscussionTopic,
    PublicCropRevision,
    Season,
    SeasonPattern,
    SeedPackage,
    Supplier,
    Task,
)
from farm.services.demo_project import DEMO_PROJECT_DESCRIPTION
from farm.services.engagement_dashboard import (
    ENGAGEMENT_MODELS,
    PROJECT_SORT_FIELDS,
    ProjectEngagement,
    Share,
    build_engagement_dashboard,
    sort_project_rows,
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

        with self.assertNumQueries(len(ENGAGEMENT_MODELS) + 15):
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

    def test_the_rendered_page_shows_every_metric_block(self) -> None:
        """The template reads the dashboard through many nested attributes, and
        Django templates swallow a wrong path silently — so pin the captions."""
        self.client.force_login(self.superuser)

        response = self.client.get(reverse('admin:farm_project_engagement'))

        for caption in (
            'Gesamtübersicht',
            'Datenreichtum je Projekt',
            'Aktive Projekte im Detail',
            'Feature-Nutzung',
            'Wachstum und Aktivierung',
            'Saisonen, Layouts und Kulturen',
            'Kulturen-Bibliothek',
        ):
            self.assertContains(response, caption)

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

    def test_the_projects_table_can_be_sorted_by_column(self) -> None:
        self.client.force_login(self.superuser)

        response = self.client.get(reverse('admin:farm_project_engagement'), {'o': 'name'})

        self.assertEqual(response.status_code, 200)
        content = response.content.decode()
        self.assertLess(content.index('Active'), content.index('Empty'))

    def test_sorting_is_reversed_with_a_leading_minus(self) -> None:
        self.client.force_login(self.superuser)

        response = self.client.get(reverse('admin:farm_project_engagement'), {'o': '-name'})

        content = response.content.decode()
        self.assertLess(content.index('Empty'), content.index('Active'))

    def test_an_unknown_sort_key_falls_back_to_the_default_order(self) -> None:
        self.client.force_login(self.superuser)

        response = self.client.get(reverse('admin:farm_project_engagement'), {'o': 'not-a-real-column'})

        self.assertEqual(response.status_code, 200)


class EngagementDashboardSortingTests(TestCase):
    """`sort_project_rows` backs the sortable headers on the "Projekte" table."""

    def _row(self, name: str, **kwargs) -> ProjectEngagement:
        project = Project.objects.create(name=name, slug=name.lower())
        return ProjectEngagement(project=project, **kwargs)

    def test_every_rendered_column_has_a_registered_sort_key(self) -> None:
        for key in (
            'name',
            'last_active',
            'created_last_7_days',
            'created_last_30_days',
            'member_count',
            'active_users_last_30_days',
            'status',
        ):
            self.assertIn(key, PROJECT_SORT_FIELDS)

    def test_sorting_by_name_is_case_insensitive(self) -> None:
        rows = [self._row('beta'), self._row('Alpha')]

        sorted_rows = sort_project_rows(rows, 'name', descending=False)

        self.assertEqual([row.project.name for row in sorted_rows], ['Alpha', 'beta'])

    def test_projects_that_were_never_active_sort_to_the_end_ascending(self) -> None:
        active = self._row('Active', last_active=timezone.now())
        never_active = self._row('Never', last_active=None)

        sorted_rows = sort_project_rows([never_active, active], 'last_active', descending=False)

        self.assertEqual([row.project.name for row in sorted_rows], ['Active', 'Never'])

    def test_an_unregistered_sort_key_leaves_the_order_unchanged(self) -> None:
        rows = [self._row('beta'), self._row('Alpha')]

        sorted_rows = sort_project_rows(rows, 'not-a-real-column', descending=False)

        self.assertEqual(sorted_rows, rows)


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


class EngagementSidebarReachabilityTests(TestCase):
    """The dashboard has to be reachable from anywhere in the admin, not only
    from the projects changelist it used to hang off."""

    def setUp(self) -> None:
        self.superuser = get_user_model().objects.create_superuser(
            username='sidebar-admin',
            email='sidebar-admin@example.com',
            password='test-password',
        )

    def test_the_farm_app_list_carries_the_dashboard_entry(self) -> None:
        self.client.force_login(self.superuser)

        response = self.client.get(reverse('admin:app_list', kwargs={'app_label': 'farm'}))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, reverse('admin:farm_project_engagement'))

    def test_an_unrelated_admin_page_still_links_the_dashboard(self) -> None:
        self.client.force_login(self.superuser)

        response = self.client.get(reverse('admin:index'))

        self.assertContains(response, reverse('admin:farm_project_engagement'))

    def test_staff_users_never_see_the_superuser_only_entry(self) -> None:
        staff_user = get_user_model().objects.create_user(
            username='sidebar-staff',
            password='test-password',
            is_staff=True,
            is_superuser=False,
        )
        staff_user.user_permissions.add(
            *Permission.objects.filter(content_type__app_label='farm'),
        )
        self.client.force_login(staff_user)

        response = self.client.get(reverse('admin:index'))

        self.assertNotContains(response, reverse('admin:farm_project_engagement'))


class ShareTests(TestCase):
    """`Share` is the only place a percentage is computed for the dashboard."""

    def test_an_empty_population_is_zero_percent_rather_than_a_crash(self):
        self.assertEqual(Share(count=0, total=0).percent, 0.0)

    def test_the_percentage_is_rounded_to_one_decimal(self):
        self.assertEqual(Share(count=1, total=3).percent, 33.3)
        self.assertEqual(Share(count=3, total=4).percent, 75.0)


class EngagementDataRichnessTests(TestCase):
    """Per-project object counts, their ranking, and the active-project averages."""

    def setUp(self) -> None:
        self.now = timezone.now()
        # A data migration seeds one project into every fresh database; the
        # shares and averages below are only readable with a known population.
        Project.objects.all().delete()
        self.rich = Project.objects.create(name='Rich', slug='rich')
        self.sparse = Project.objects.create(name='Sparse', slug='sparse')

    def _dashboard(self):
        return build_engagement_dashboard(now=self.now)

    def _fill(self, project: Project, *, beds: int = 1, crops: int = 1, plans: int = 1) -> None:
        location = Location.objects.create(name=f'{project.slug}-loc', project=project)
        field = Field.objects.create(
            name=f'{project.slug}-field', location=location, project=project,
        )
        bed = None
        for index in range(beds):
            bed = Bed.objects.create(
                name=f'{project.slug}-bed-{index}', field=field, project=project,
            )
        for index in range(crops):
            Crop.objects.create(name=f'{project.slug}-crop-{index}', project=project)
        for _ in range(plans):
            PlantingPlan.objects.create(project=project, bed=bed)

    def test_counts_are_reported_per_model_and_summed_into_one_total(self):
        self._fill(self.rich, beds=3, crops=2, plans=4)

        row = next(r for r in self._dashboard().projects if r.project.pk == self.rich.pk)

        self.assertEqual(row.location_count, 1)
        self.assertEqual(row.field_count, 1)
        self.assertEqual(row.bed_count, 3)
        self.assertEqual(row.crop_count, 2)
        self.assertEqual(row.planting_plan_count, 4)
        self.assertEqual(row.image_count, 0)
        self.assertEqual(row.data_total, 11)

    def test_note_photos_count_as_images(self):
        self._fill(self.rich)
        plan = PlantingPlan.objects.filter(project=self.rich).first()
        NoteAttachment.objects.create(planting_plan=plan, project=self.rich, image='notes/a.jpg')

        row = next(r for r in self._dashboard().projects if r.project.pk == self.rich.pk)

        self.assertEqual(row.image_count, 1)

    def test_the_ranking_puts_the_most_data_rich_project_first(self):
        self._fill(self.rich, beds=5, crops=5, plans=5)
        self._fill(self.sparse)

        slugs = [row.project.slug for row in self._dashboard().projects_by_data]

        self.assertLess(slugs.index('rich'), slugs.index('sparse'))

    def test_the_member_count_comes_from_the_project_memberships(self):
        for index in range(3):
            user = get_user_model().objects.create_user(
                username=f'member-{index}', password='pass12345',
            )
            ProjectMembership.objects.create(user=user, project=self.rich)

        row = next(r for r in self._dashboard().projects if r.project.pk == self.rich.pk)

        self.assertEqual(row.member_count, 3)
        self.assertEqual(row.active_users_last_30_days, 0)

    def test_only_active_projects_reach_the_detail_table_and_its_average(self):
        self._fill(self.rich, beds=3, crops=1, plans=1)
        self._fill(self.sparse, beds=1, crops=1, plans=1)
        for model in (Location, Field, Bed, Crop, PlantingPlan):
            model.objects.filter(project=self.sparse).update(
                created_at=self.now - timedelta(days=200),
                updated_at=self.now - timedelta(days=200),
            )

        dashboard = self._dashboard()

        slugs = [row.project.slug for row in dashboard.active_projects]
        self.assertEqual(slugs, ['rich'])
        self.assertEqual(dashboard.active_project_averages.beds, 3.0)
        self.assertEqual(dashboard.active_project_averages.data_total, 7.0)

    def test_the_average_row_is_the_mean_over_all_active_projects(self):
        self._fill(self.rich, beds=3, crops=1, plans=1)
        self._fill(self.sparse, beds=0, crops=1, plans=0)

        averages = self._dashboard().active_project_averages

        self.assertEqual(averages.locations, 1.0)
        self.assertEqual(averages.beds, 1.5)
        self.assertEqual(averages.crops, 1.0)

    def test_a_dashboard_without_active_projects_has_zeroed_averages(self):
        averages = self._dashboard().active_project_averages

        self.assertEqual(averages.data_total, 0.0)
        self.assertEqual(averages.members, 0.0)


class EngagementFeatureAdoptionTests(TestCase):
    """The adoption block answers "how many projects ever used X at all"."""

    def setUp(self) -> None:
        self.now = timezone.now()
        # A data migration seeds one project into every fresh database; the
        # shares and averages below are only readable with a known population.
        Project.objects.all().delete()
        self.project = Project.objects.create(name='Adopter', slug='adopter')
        self.other = Project.objects.create(name='Abstainer', slug='abstainer')

    def _adoption(self):
        return build_engagement_dashboard(now=self.now).adoption

    def test_a_single_location_is_not_yet_multi_location_usage(self):
        Location.objects.create(name='Eins', project=self.project)

        self.assertEqual(self._adoption().multiple_locations.count, 0)

    def test_a_second_location_counts_the_project_once(self):
        Location.objects.create(name='Eins', project=self.project)
        Location.objects.create(name='Zwei', project=self.project)

        adoption = self._adoption()

        self.assertEqual(adoption.multiple_locations.count, 1)
        self.assertEqual(adoption.multiple_locations.total, 2)
        self.assertEqual(adoption.multiple_locations.percent, 50.0)

    def test_suppliers_seed_packages_and_tasks_are_each_their_own_share(self):
        Supplier.objects.create(
            name='Lieferant', homepage_url='https://s.example', project=self.project,
        )
        crop = Crop.objects.create(name='Tomate', project=self.project)
        SeedPackage.objects.create(crop=crop, project=self.project, size_value=10)
        Task.objects.create(title='Gießen', project=self.project)

        adoption = self._adoption()

        self.assertEqual(adoption.suppliers.count, 1)
        self.assertEqual(adoption.seed_packages.count, 1)
        self.assertEqual(adoption.tasks.count, 1)

    def test_an_uploaded_note_photo_marks_the_project_as_a_photo_user(self):
        plan = PlantingPlan.objects.create(project=self.project)
        NoteAttachment.objects.create(planting_plan=plan, project=self.project, image='notes/a.jpg')

        self.assertEqual(self._adoption().planting_plan_photos.count, 1)

    def test_feedback_without_a_project_never_counts_towards_a_project(self):
        Feedback.objects.create(message='Mit Projekt', project=self.project)
        Feedback.objects.create(message='Ohne Projekt', project=None)

        adoption = self._adoption()

        self.assertEqual(adoption.feedback.count, 1)
        self.assertEqual(adoption.feedback.total, 2)


class EngagementGrowthTests(TestCase):
    """New projects per month, and how many of them got past an empty workspace."""

    def setUp(self) -> None:
        self.now = timezone.now()
        # A data migration seeds one project into every fresh database; the
        # shares and averages below are only readable with a known population.
        Project.objects.all().delete()

    def _project(self, slug: str, days_ago: float) -> Project:
        project = Project.objects.create(name=slug, slug=slug)
        Project.objects.filter(pk=project.pk).update(created_at=self.now - timedelta(days=days_ago))
        project.refresh_from_db()
        return project

    def _growth(self):
        return build_engagement_dashboard(now=self.now).monthly_growth

    def test_projects_are_grouped_into_the_month_they_were_created_in(self):
        self._project('growth-new', 1)
        self._project('growth-old', 400)

        months = self._growth()

        self.assertEqual(len(months), 2)
        self.assertEqual(sum(month.new_projects for month in months), 2)

    def test_months_are_listed_newest_first(self):
        self._project('growth-new', 1)
        self._project('growth-old', 400)

        months = self._growth()

        self.assertGreater(months[0].month, months[-1].month)

    def test_a_project_without_a_location_or_plan_is_not_activated(self):
        project = self._project('growth-empty', 1)
        Crop.objects.create(name='Nur Kultur', project=project)

        month = self._growth()[0]

        self.assertEqual(month.new_projects, 1)
        self.assertEqual(month.activated_projects, 0)
        self.assertIsNone(month.average_days_to_activation)

    def test_the_first_location_activates_a_project_and_times_it(self):
        project = self._project('growth-located', 10)
        location = Location.objects.create(name='Hof', project=project)
        Location.objects.filter(pk=location.pk).update(created_at=self.now - timedelta(days=7))

        month = self._growth()[0]

        self.assertEqual(month.activated_projects, 1)
        self.assertEqual(month.activation.percent, 100.0)
        self.assertEqual(month.average_days_to_activation, 3.0)

    def test_the_first_planting_plan_activates_a_project_too(self):
        project = self._project('growth-planned', 5)
        plan = PlantingPlan.objects.create(project=project)
        PlantingPlan.objects.filter(pk=plan.pk).update(created_at=self.now - timedelta(days=3))

        self.assertEqual(self._growth()[0].activated_projects, 1)

    def test_same_day_activation_is_zero_days_and_not_a_missing_value(self):
        """Zero and "never activated" render differently in the admin table, so
        the service has to keep them apart instead of collapsing both to falsy."""
        project = self._project('growth-instant', 2)
        location = Location.objects.create(name='Sofort', project=project)
        Location.objects.filter(pk=location.pk).update(created_at=project.created_at)

        month = self._growth()[0]

        self.assertEqual(month.average_days_to_activation, 0.0)
        self.assertIsNotNone(month.average_days_to_activation)

    def test_activation_time_uses_the_earlier_of_location_and_planting_plan(self):
        project = self._project('growth-both', 20)
        location = Location.objects.create(name='Hof', project=project)
        plan = PlantingPlan.objects.create(project=project)
        Location.objects.filter(pk=location.pk).update(created_at=self.now - timedelta(days=12))
        PlantingPlan.objects.filter(pk=plan.pk).update(created_at=self.now - timedelta(days=18))

        self.assertEqual(self._growth()[0].average_days_to_activation, 2.0)


class EngagementUsageDepthTests(TestCase):
    """Seasons, layouts, crop diversity, tasks, and where a project came from."""

    def setUp(self) -> None:
        self.now = timezone.now()
        # A data migration seeds one project into every fresh database; the
        # shares and averages below are only readable with a known population.
        Project.objects.all().delete()
        self.project = Project.objects.create(name='Tief', slug='tief')
        self.other = Project.objects.create(name='Flach', slug='flach')

    def _dashboard(self):
        return build_engagement_dashboard(now=self.now)

    def _season(self, project: Project, year: int) -> Season:
        return Season.objects.create(
            project=project,
            start_date=timezone.datetime(year, 1, 1).date(),
            end_date=timezone.datetime(year, 12, 31).date(),
        )

    def test_seasons_are_averaged_over_every_project_not_only_the_using_ones(self):
        self._season(self.project, 2025)
        self._season(self.project, 2026)

        self.assertEqual(self._dashboard().season_usage.average_seasons_per_project, 1.0)

    def test_the_season_pattern_share_counts_projects_that_configured_one(self):
        SeasonPattern.objects.create(project=self.project, start_day=1, start_month=3)

        usage = self._dashboard().season_usage

        self.assertEqual(usage.projects_with_pattern.count, 1)
        self.assertEqual(usage.projects_with_pattern.percent, 50.0)

    def test_bed_and_field_layouts_are_reported_separately_and_combined(self):
        location = Location.objects.create(name='Hof', project=self.project)
        field = Field.objects.create(name='Acker', location=location, project=self.project)
        bed = Bed.objects.create(name='Beet', field=field, project=self.project)
        BedLayout.objects.create(bed=bed, location=location, project=self.project)
        other_location = Location.objects.create(name='Hof 2', project=self.other)
        other_field = Field.objects.create(
            name='Acker 2', location=other_location, project=self.other,
        )
        FieldLayout.objects.create(field=other_field, location=other_location, project=self.other)

        usage = self._dashboard().layout_usage

        self.assertEqual(usage.projects_with_bed_layout.count, 1)
        self.assertEqual(usage.projects_with_field_layout.count, 1)
        self.assertEqual(usage.projects_with_any_layout.count, 2)

    def test_crop_diversity_counts_distinct_names_not_duplicate_rows(self):
        Crop.objects.create(name='Tomate', project=self.project)
        Crop.objects.create(name='Tomate', project=self.project, variety='Ochsenherz')
        Crop.objects.create(name='Möhre', project=self.project)

        self.assertEqual(self._dashboard().average_distinct_crops_per_project, 1.0)

    def test_tasks_are_reported_as_created_against_completed(self):
        Task.objects.create(title='Offen', project=self.project)
        Task.objects.create(title='Erledigt', project=self.project, status='completed')
        Task.objects.create(title='Abgebrochen', project=self.project, status='cancelled')

        usage = self._dashboard().task_usage

        self.assertEqual(usage.created, 3)
        self.assertEqual(usage.completed, 1)
        self.assertEqual(usage.completion.percent, 33.3)

    def test_projects_from_the_demo_template_are_told_apart_from_empty_ones(self):
        Project.objects.filter(pk=self.project.pk).update(
            description=DEMO_PROJECT_DESCRIPTION,
        )

        share = self._dashboard().projects_from_template

        self.assertEqual(share.count, 1)
        self.assertEqual(share.total, 2)
        self.assertEqual(share.percent, 50.0)


class EngagementCropLibraryTests(TestCase):
    """Contribution to, and consumption of, the shared public crop library."""

    def setUp(self) -> None:
        self.now = timezone.now()
        # A data migration seeds one project into every fresh database; the
        # shares and averages below are only readable with a known population.
        Project.objects.all().delete()
        self.project = Project.objects.create(name='Bibliothek', slug='bibliothek')
        self.published = PublicCrop.objects.create(
            name='Tomate',
            status=PublicCrop.STATUS_PUBLISHED,
            source_project=self.project,
            version=2,
        )

    def _library(self):
        return build_engagement_dashboard(now=self.now).crop_library

    def test_published_entries_are_counted_per_contributing_project(self):
        PublicCrop.objects.create(
            name='Möhre', status=PublicCrop.STATUS_PUBLISHED, source_project=self.project,
        )

        library = self._library()

        self.assertEqual(library.published_entries, 2)
        self.assertEqual(library.contributions[0].project_name, 'Bibliothek')
        self.assertEqual(library.contributions[0].published_count, 2)

    def test_unpublished_entries_never_count_as_a_contribution(self):
        PublicCrop.objects.create(name='Entwurf', status=PublicCrop.STATUS_DRAFT)

        self.assertEqual(self._library().published_entries, 1)

    def test_imported_and_self_entered_crops_are_told_apart(self):
        Crop.objects.create(
            name='Übernommen',
            project=self.project,
            source_public_crop=self.published,
            source_public_version=2,
        )
        Crop.objects.create(name='Selbst', project=self.project)

        library = self._library()

        self.assertEqual(library.imported_crops, 1)
        self.assertEqual(library.self_entered_crops, 1)

    def test_a_crop_on_the_current_library_version_has_no_pending_update(self):
        Crop.objects.create(
            name='Aktuell',
            project=self.project,
            source_public_crop=self.published,
            source_public_version=2,
        )

        self.assertEqual(self._library().crops_with_pending_update, 0)

    def test_a_crop_behind_the_library_version_is_a_pending_update(self):
        Crop.objects.create(
            name='Veraltet',
            project=self.project,
            source_public_crop=self.published,
            source_public_version=1,
        )

        self.assertEqual(self._library().crops_with_pending_update, 1)

    def test_discussion_comments_and_revisions_measure_collaboration(self):
        topic = PublicCropDiscussionTopic.objects.create(
            public_crop=self.published, title='Frage zur Sorte',
        )
        PublicCropDiscussionComment.objects.create(topic=topic, body='Antwort')
        deleted = PublicCropDiscussionComment.objects.create(topic=topic, body='Gelöscht')
        PublicCropDiscussionComment.objects.filter(pk=deleted.pk).update(deleted_at=self.now)
        PublicCropRevision.objects.create(public_crop=self.published, version=1)
        PublicCropRevision.objects.create(public_crop=self.published, version=2)

        library = self._library()

        self.assertEqual(library.discussion_comments, 1)
        self.assertEqual(library.revisions, 2)
