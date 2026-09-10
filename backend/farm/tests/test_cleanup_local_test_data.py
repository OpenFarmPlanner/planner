from __future__ import annotations

from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone

from accounts.models import GuestDemoSession
from farm.models import Project, ProjectMembership, PublicCrop
from farm.services.demo_project import DEMO_PROJECT_DESCRIPTION, DEMO_PROJECT_SLUG, DEMO_USER_EMAIL
from farm.services.hint_test_project import HINT_TEST_PROJECT_SLUG, HINT_TEST_USER_EMAIL

User = get_user_model()


@override_settings(DEBUG=True, DJANGO_ENV='development')
class CleanupLocalTestDataCommandTests(TestCase):
    def test_dry_run_reports_selected_fixture_rows_without_deleting(self) -> None:
        e2e_project, e2e_users = self._create_e2e_fixture()
        regular_project, regular_user = self._create_regular_rows()

        output = StringIO()
        call_command('cleanup_local_test_data', stdout=output)

        self.assertIn('Would delete 1 projects, 3 users', output.getvalue())
        self.assertTrue(Project.objects.filter(id=e2e_project.id).exists())
        self.assertTrue(Project.objects.filter(id=regular_project.id).exists())
        self.assertEqual(User.objects.filter(id__in=[user.id for user in e2e_users]).count(), 3)
        self.assertTrue(User.objects.filter(id=regular_user.id).exists())

    def test_confirm_deletes_only_known_local_fixture_rows(self) -> None:
        self._create_e2e_fixture()
        self._create_demo_fixture()
        self._create_hint_fixture()
        self._create_guest_demo_fixture()
        regular_project, regular_user = self._create_regular_rows()

        output = StringIO()
        call_command('cleanup_local_test_data', '--confirm', stdout=output)

        self.assertIn('Deleted 3 projects, 6 users, 1 guest demo sessions, and 1 E2E public crops.', output.getvalue())
        self.assertTrue(Project.objects.filter(id=regular_project.id).exists())
        self.assertTrue(User.objects.filter(id=regular_user.id).exists())
        self.assertFalse(Project.objects.filter(name__startswith='E2E Project ').exists())
        self.assertFalse(Project.objects.filter(slug__in=[DEMO_PROJECT_SLUG, HINT_TEST_PROJECT_SLUG, 'guest-demo-cleanup']).exists())
        self.assertFalse(User.objects.filter(email__iendswith='@e2e.local').exists())
        self.assertFalse(User.objects.filter(email__in=[DEMO_USER_EMAIL, HINT_TEST_USER_EMAIL, 'demo-cleanup@example.invalid']).exists())
        self.assertFalse(PublicCrop.objects.exists())
        self.assertFalse(GuestDemoSession.objects.exists())

    def test_confirm_deletes_all_guest_demo_sessions_despite_cascading_deletes(self) -> None:
        # Regression test: cleanup_local_test_data() used to iterate
        # GuestDemoSession.objects.iterator() while the loop body cascade-deleted
        # rows from that same table, risking a skipped row under the open
        # cursor. Several sessions make that skip observable.
        sessions = [self._create_guest_demo_fixture(str(index)) for index in range(5)]

        output = StringIO()
        call_command('cleanup_local_test_data', '--confirm', stdout=output)

        self.assertFalse(GuestDemoSession.objects.filter(id__in=[session.id for session in sessions]).exists())

    @override_settings(DEBUG=True, DJANGO_ENV='test')
    def test_command_is_blocked_outside_development_settings(self) -> None:
        with self.assertRaisesMessage(RuntimeError, 'only allowed'):
            call_command('cleanup_local_test_data')

    def _create_e2e_fixture(self) -> tuple[Project, list]:
        project = Project.objects.create(name='E2E Project cleanup', slug='cleanup-e2e')
        users = [
            User.objects.create_user(
                username=f'cleanup-e2e-{role}',
                email=f'cleanup-e2e-{role}@e2e.local',
                password='pass12345',
            )
            for role in ('admin', 'invitee', 'outsider')
        ]
        ProjectMembership.objects.create(user=users[0], project=project, role=ProjectMembership.ROLE_ADMIN)
        PublicCrop.objects.create(
            created_by=users[0],
            source_project=project,
            name='E2E Test Crop',
            variety='E2E Kollaboration Cleanup',
        )
        return project, users

    def _create_demo_fixture(self) -> tuple[Project, object]:
        user = User.objects.create_user(
            username='openfarmplanner-demo',
            email=DEMO_USER_EMAIL,
            password='pass12345',
        )
        project = Project.objects.create(
            name='Solawi Sonnenacker',
            slug=DEMO_PROJECT_SLUG,
            description=DEMO_PROJECT_DESCRIPTION,
        )
        ProjectMembership.objects.create(user=user, project=project, role=ProjectMembership.ROLE_ADMIN)
        return project, user

    def _create_hint_fixture(self) -> tuple[Project, object]:
        user = User.objects.create_user(
            username='openfarmplanner-hint-test',
            email=HINT_TEST_USER_EMAIL,
            password='pass12345',
        )
        project = Project.objects.create(
            name='Hinweise & Sonderfaelle',
            slug=HINT_TEST_PROJECT_SLUG,
        )
        ProjectMembership.objects.create(user=user, project=project, role=ProjectMembership.ROLE_ADMIN)
        return project, user

    def _create_guest_demo_fixture(self, suffix: str = '') -> GuestDemoSession:
        user = User.objects.create_user(
            username=f'demo_cleanup{suffix}',
            email=f'demo-cleanup{suffix}@example.invalid',
            password=None,
        )
        project = Project.objects.create(name=f'Guest Demo{suffix}', slug=f'guest-demo-cleanup{suffix}')
        ProjectMembership.objects.create(user=user, project=project, role=ProjectMembership.ROLE_ADMIN)
        return GuestDemoSession.objects.create(
            user=user,
            project=project,
            expires_at=timezone.now(),
        )

    def _create_regular_rows(self) -> tuple[Project, object]:
        user = User.objects.create_user(
            username='real-user',
            email='real@example.com',
            password='pass12345',
        )
        project = Project.objects.create(name='Real Project', slug='real-project')
        ProjectMembership.objects.create(user=user, project=project, role=ProjectMembership.ROLE_ADMIN)
        return project, user


@override_settings(DEBUG=True, DJANGO_ENV='development')
class CleanupSelectorPrecisionTests(TestCase):
    """The selectors decide what a destructive command deletes.

    A false negative leaves a stale fixture behind; a false positive deletes
    somebody's real project. These pin the near-misses on each OR branch —
    the rows that look like fixtures but are not.
    """

    def _cleanup(self) -> None:
        call_command('cleanup_local_test_data', '--confirm', stdout=StringIO())

    def _project(self, name: str, slug: str, **kwargs) -> Project:
        return Project.objects.create(name=name, slug=slug, **kwargs)

    def _user(self, username: str, email: str):
        return User.objects.create_user(username=username, email=email, password='pass12345')

    def test_a_project_name_that_only_resembles_the_e2e_prefix_survives(self):
        """The branch is a `startswith`, not a substring match."""
        exact = self._project('E2E Project Alpha', 'precision-exact')
        german = self._project('E2E Projekt Alpha', 'precision-german')
        embedded = self._project('Meine E2E Project Kopie', 'precision-embedded')

        self._cleanup()

        self.assertFalse(Project.objects.filter(id=exact.id).exists())
        self.assertTrue(Project.objects.filter(id=german.id).exists())
        self.assertTrue(Project.objects.filter(id=embedded.id).exists())

    def test_a_description_that_merely_contains_a_demo_description_survives(self):
        """`description__in` is an exact match, so a user who pasted the demo
        text into their own project keeps that project."""
        quoted = self._project(
            'Eigenes Projekt', 'precision-quoted',
            description=f'Kopiert: {DEMO_PROJECT_DESCRIPTION}',
        )

        self._cleanup()

        self.assertTrue(Project.objects.filter(id=quoted.id).exists())

    def test_an_email_that_only_contains_the_e2e_domain_survives(self):
        """The branch is an `iendswith`; a lookalike domain is a different one."""
        real_suffix = self._user('precision-suffix', 'someone@e2e.local')
        lookalike = self._user('precision-lookalike', 'someone@e2e.local.example.com')
        prefixed = self._user('precision-prefixed', 'e2e.local@example.com')

        self._cleanup()

        self.assertFalse(User.objects.filter(id=real_suffix.id).exists())
        self.assertTrue(User.objects.filter(id=lookalike.id).exists())
        self.assertTrue(User.objects.filter(id=prefixed.id).exists())

    def test_the_e2e_domain_match_ignores_casing(self):
        shouty = self._user('precision-shouty', 'Someone@E2E.LOCAL')

        self._cleanup()

        self.assertFalse(User.objects.filter(id=shouty.id).exists())

    def test_a_guest_demo_account_needs_both_the_domain_and_the_username(self):
        """That branch is an AND. Widening it to an OR would delete every
        `@example.invalid` account, and every account merely named `demo_*`."""
        both = self._user('demo_precision', 'demo-precision@example.invalid')
        domain_only = self._user('precision-real', 'real-person@example.invalid')
        username_only = self._user('demo_precision_real', 'demo-precision@example.com')

        self._cleanup()

        self.assertFalse(User.objects.filter(id=both.id).exists())
        self.assertTrue(User.objects.filter(id=domain_only.id).exists())
        self.assertTrue(User.objects.filter(id=username_only.id).exists())

    def test_a_public_crop_needs_both_an_e2e_author_and_a_known_variety(self):
        """Also an AND: an E2E account's other crops, and a real account's crop
        that happens to carry the prefix, both stay."""
        e2e_user = self._user('precision-crop-e2e', 'crop@e2e.local')
        real_user = self._user('precision-crop-real', 'crop@example.com')
        matching = PublicCrop.objects.create(
            created_by=e2e_user, name='Tomate', variety='E2E Kollaboration Alpha',
        )
        other_variety = PublicCrop.objects.create(
            created_by=e2e_user, name='Tomate', variety='Moneymaker',
        )
        other_author = PublicCrop.objects.create(
            created_by=real_user, name='Tomate', variety='Visual Empty Beta',
        )

        self._cleanup()

        self.assertFalse(PublicCrop.objects.filter(id=matching.id).exists())
        self.assertTrue(PublicCrop.objects.filter(id=other_variety.id).exists())
        self.assertTrue(PublicCrop.objects.filter(id=other_author.id).exists())

    def test_a_public_crop_from_an_e2e_project_goes_regardless_of_its_variety(self):
        """The source-project branch stands on its own — no variety condition."""
        e2e_user = self._user('precision-source-e2e', 'source@e2e.local')
        e2e_project = self._project('Quelle', 'precision-source')
        ProjectMembership.objects.create(
            user=e2e_user, project=e2e_project, role=ProjectMembership.ROLE_ADMIN,
        )
        crop = PublicCrop.objects.create(
            created_by=e2e_user, source_project=e2e_project, name='Tomate', variety='Moneymaker',
        )

        self._cleanup()

        self.assertFalse(PublicCrop.objects.filter(id=crop.id).exists())

    def test_a_project_with_an_e2e_member_is_treated_as_a_fixture(self):
        """The surprising branch, pinned deliberately: membership alone is
        enough, so a project shared with an E2E account is swept up with it."""
        project = self._project('Ganz normales Projekt', 'precision-member')
        owner = self._user('precision-owner', 'owner@example.com')
        e2e_member = self._user('precision-member-e2e', 'member@e2e.local')
        ProjectMembership.objects.create(
            user=owner, project=project, role=ProjectMembership.ROLE_ADMIN,
        )
        ProjectMembership.objects.create(
            user=e2e_member, project=project, role=ProjectMembership.ROLE_MEMBER,
        )

        self._cleanup()

        self.assertFalse(Project.objects.filter(id=project.id).exists())
        self.assertTrue(User.objects.filter(id=owner.id).exists())

    def test_nothing_is_deleted_when_there_is_nothing_to_delete(self):
        project = self._project('Echtes Projekt', 'precision-none')
        user = self._user('precision-none-user', 'none@example.com')
        ProjectMembership.objects.create(
            user=user, project=project, role=ProjectMembership.ROLE_ADMIN,
        )

        output = StringIO()
        call_command('cleanup_local_test_data', '--confirm', stdout=output)

        self.assertIn('Deleted 0 projects, 0 users', output.getvalue())
        self.assertTrue(Project.objects.filter(id=project.id).exists())
        self.assertTrue(User.objects.filter(id=user.id).exists())

    @override_settings(DEBUG=False, DJANGO_ENV='development')
    def test_debug_must_be_on_as_well_as_the_development_environment(self):
        """Both halves of the guard matter: a production deploy can carry
        DJANGO_ENV=development by misconfiguration and must still be refused."""
        with self.assertRaisesMessage(RuntimeError, 'only allowed'):
            call_command('cleanup_local_test_data')
