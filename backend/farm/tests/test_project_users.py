"""Tests for the seeded-account helper shared by the demo and hint-test seeders."""

from django.contrib.auth import get_user_model
from django.test import TestCase

from farm.services.project_users import get_or_create_project_user

User = get_user_model()


class GetOrCreateProjectUserTest(TestCase):
    def _legacy_account_without_username(self, email: str):
        """`create_user` refuses a blank username, so clear it afterwards the way
        an account predating the username requirement would look in the table."""
        user = User.objects.create_user(username=f'legacy-{email}', email=email, password='OldPass123!')
        User.objects.filter(pk=user.pk).update(username='')
        user.refresh_from_db()
        return user

    def test_creates_an_active_account_with_the_given_credentials(self) -> None:
        user, created = get_or_create_project_user(
            email='seed@example.local', username='seed-user', password='SeedPass123!',
        )

        self.assertTrue(created)
        self.assertEqual(user.email, 'seed@example.local')
        self.assertEqual(user.username, 'seed-user')
        self.assertTrue(user.is_active)
        self.assertTrue(user.check_password('SeedPass123!'))

    def test_stores_the_password_hashed_rather_than_in_clear(self) -> None:
        user, _ = get_or_create_project_user(
            email='hash@example.local', username='hash-user', password='SeedPass123!',
        )
        user.refresh_from_db()

        self.assertNotEqual(user.password, 'SeedPass123!')
        self.assertTrue(user.check_password('SeedPass123!'))

    def test_matches_an_existing_account_by_email_instead_of_creating_a_second(self) -> None:
        User.objects.create_user(
            username='existing-user', email='existing@example.local', password='OldPass123!',
        )

        user, created = get_or_create_project_user(
            email='existing@example.local', username='different-username', password='NewPass123!',
        )

        self.assertFalse(created)
        self.assertEqual(User.objects.filter(email='existing@example.local').count(), 1)
        self.assertEqual(user.username, 'existing-user')

    def test_reapplies_the_password_so_a_reseed_restores_known_credentials(self) -> None:
        User.objects.create_user(
            username='reset-user', email='reset@example.local', password='OldPass123!',
        )

        user, _ = get_or_create_project_user(
            email='reset@example.local', username='reset-user', password='NewPass123!',
        )
        user.refresh_from_db()

        self.assertTrue(user.check_password('NewPass123!'))
        self.assertFalse(user.check_password('OldPass123!'))

    def test_leaves_the_password_alone_when_none_is_given(self) -> None:
        User.objects.create_user(
            username='keep-user', email='keep@example.local', password='OldPass123!',
        )

        user, created = get_or_create_project_user(
            email='keep@example.local', username='keep-user', password='',
        )
        user.refresh_from_db()

        self.assertFalse(created)
        self.assertTrue(user.check_password('OldPass123!'))

    def test_backfills_a_missing_username_on_a_legacy_account(self) -> None:
        legacy = self._legacy_account_without_username('legacy@example.local')

        user, created = get_or_create_project_user(
            email='legacy@example.local', username='backfilled-user', password='NewPass123!',
        )
        user.refresh_from_db()

        self.assertFalse(created)
        self.assertEqual(user.pk, legacy.pk)
        self.assertEqual(user.username, 'backfilled-user')
        self.assertTrue(user.check_password('NewPass123!'))

    def test_does_not_backfill_a_username_without_a_password(self) -> None:
        """The backfill rides along with the password save, so it needs one."""
        self._legacy_account_without_username('nopass@example.local')

        user, _ = get_or_create_project_user(
            email='nopass@example.local', username='would-be-user', password='',
        )
        user.refresh_from_db()

        self.assertEqual(user.username, '')

    def test_does_not_reactivate_a_deactivated_account(self) -> None:
        """`is_active` only applies on creation, so re-seeding never re-enables
        an account an administrator disabled."""
        User.objects.create_user(
            username='disabled-user', email='disabled@example.local',
            password='OldPass123!', is_active=False,
        )

        user, created = get_or_create_project_user(
            email='disabled@example.local', username='disabled-user', password='NewPass123!',
        )
        user.refresh_from_db()

        self.assertFalse(created)
        self.assertFalse(user.is_active)

    def test_is_idempotent_across_repeated_seeder_runs(self) -> None:
        first, first_created = get_or_create_project_user(
            email='repeat@example.local', username='repeat-user', password='SeedPass123!',
        )
        second, second_created = get_or_create_project_user(
            email='repeat@example.local', username='repeat-user', password='SeedPass123!',
        )

        self.assertTrue(first_created)
        self.assertFalse(second_created)
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(User.objects.filter(email='repeat@example.local').count(), 1)
