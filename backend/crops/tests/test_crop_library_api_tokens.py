"""Tests for the platform-scoped crop-library API token.

Covers storage/lifecycle (mirrors `farm.tests.test_agent_api_tokens`), the
deny-by-default surface allowlist on `CropSpeciesViewSet`, and that
authorization still runs through `is_public_library_moderator`/
`is_public_library_admin` exactly as it does for a session request — a token
is only ever as powerful as the account it is bound to. See
docs/rfc-crop-taxonomy-admin-api.md.
"""

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from crops.models import (
    CROP_LIBRARY_TOKEN_PREFIX,
    CropLibraryApiToken,
    CropSpecies,
    PlantFamily,
    PlantFamilyTranslation,
)
from crops.permissions import grant_public_library_moderator_access

User = get_user_model()

CROP_SPECIES_URL = '/api/crop-species/'
TOKEN_URL = '/api/crop-library-tokens/'


class CropLibraryApiTokenTestBase(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username='library-admin', email='admin@example.com', password='pw',
            is_active=True, is_staff=True, is_superuser=True,
        )
        self.moderator = User.objects.create_user(
            username='library-moderator', email='moderator@example.com', password='pw',
            is_active=True,
        )
        grant_public_library_moderator_access(self.moderator)
        self.plain_user = User.objects.create_user(
            username='plain-user', email='plain@example.com', password='pw', is_active=True,
        )

    def issue_token(self, *, user=None, scope=CropLibraryApiToken.SCOPE_READ, **kwargs):
        return CropLibraryApiToken.create_token(
            user=user or self.admin,
            name=kwargs.pop('name', 'Test token'),
            scope=scope,
            expires_at=kwargs.pop('expires_at', None),
        )

    def bearer_client(self, raw_token: str) -> APIClient:
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {raw_token}')
        return client


class PlantFamilyTranslationApiTests(CropLibraryApiTokenTestBase):
    url = "/api/plant-families/Solanaceae/translations/"

    def test_admin_write_token_upserts_only_supplied_languages(self) -> None:
        _, raw = self.issue_token(scope=CropLibraryApiToken.SCOPE_WRITE)
        client = self.bearer_client(raw)
        family = PlantFamily.objects.get(pk="Solanaceae")
        original = dict(family.translations.values_list("language_code", "name"))
        data = {
            "translations": {"it": " Solanacee ", "pt": "Solanáceas", "nl": "Nachtschadefamilie"}
        }
        for _ in range(2):
            response = client.patch(self.url, data, format="json")
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(
                response.data["translations"],
                {
                    **original,
                    "it": "Solanacee",
                    "pt": "Solanáceas",
                    "nl": "Nachtschadefamilie",
                },
            )
        self.assertEqual(family.translations.count(), len(original) + 3)
        family.refresh_from_db()
        self.assertEqual(family.default_rotation_break_years, 3)
        self.assertEqual(family.localized_name("it"), ("Solanacee", "it"))

    def test_session_admin_can_update_existing_translation(self) -> None:
        self.client.force_authenticate(self.admin)
        response = self.client.patch(
            self.url, {"translations": {"fr": "Solanacées"}}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)
        response = self.client.patch(
            self.url, {"translations": {"fr": "Solanacées révisées"}}, format="json"
        )
        self.assertEqual(response.data["translations"]["fr"], "Solanacées révisées")

    def test_read_scope_is_denied(self) -> None:
        _, raw = self.issue_token(scope=CropLibraryApiToken.SCOPE_READ)
        client = self.bearer_client(raw)
        self.assertEqual(
            client.patch(
                self.url, {"translations": {"it": "Solanacee"}}, format="json"
            ).status_code,
            403,
        )
        self.assertEqual(client.get("/api/plant-families/").status_code, 200)

    def test_project_write_token_cannot_edit_global_family_translations(self) -> None:
        from farm.models import Project, ProjectApiToken, ProjectMembership

        project = Project.objects.create(name="Family token test", slug="family-token-test")
        ProjectMembership.objects.create(user=self.admin, project=project, role="admin")
        _, raw = ProjectApiToken.create_token(
            user=self.admin,
            project=project,
            name="Project write token",
            scope=ProjectApiToken.SCOPE_WRITE,
        )
        client = self.bearer_client(raw)
        self.assertEqual(client.get("/api/plant-families/").status_code, 200)
        response = client.patch(self.url, {"translations": {"it": "Solanacee"}}, format="json")
        self.assertEqual(response.status_code, 403, response.data)
        self.assertFalse(
            PlantFamilyTranslation.objects.filter(
                family_id="Solanaceae", language_code="it"
            ).exists()
        )

    def test_moderator_and_regular_sessions_cannot_edit_global_families(self) -> None:
        for user in (self.moderator, self.plain_user):
            self.client.force_authenticate(user)
            response = self.client.patch(
                self.url, {"translations": {"it": "Solanacee"}}, format="json"
            )
            self.assertEqual(response.status_code, 403, response.data)
        self.assertFalse(
            PlantFamilyTranslation.objects.filter(
                family_id="Solanaceae", language_code="it"
            ).exists()
        )

    def test_token_owner_losing_admin_rights_is_denied(self) -> None:
        _, raw = self.issue_token(scope=CropLibraryApiToken.SCOPE_WRITE)
        self.admin.is_staff = False
        self.admin.is_superuser = False
        self.admin.save(update_fields=["is_staff", "is_superuser"])
        response = self.bearer_client(raw).patch(
            self.url, {"translations": {"it": "Solanacee"}}, format="json"
        )
        self.assertEqual(response.status_code, 403, response.data)

    def test_invalid_payloads_are_atomic(self) -> None:
        self.client.force_authenticate(self.admin)
        for data in (
            {"translations": {"it": "Solanacee", "xx": "Unknown"}},
            {"translations": {"pt-BR": "Solanáceas"}},
            {"translations": {"it": "   "}},
            {"translations": {"it": "x" * 201}},
            {"translations": {}},
            {"translations": {"it": "Solanacee"}, "botanical_name": "Rosaceae"},
            {"translations": {"it": "Solanacee"}, "default_rotation_break_years": 0},
        ):
            with self.subTest(data=data):
                response = self.client.patch(self.url, data, format="json")
                self.assertEqual(response.status_code, 400, response.data)
                self.assertFalse(
                    PlantFamilyTranslation.objects.filter(
                        family_id="Solanaceae", language_code="it"
                    ).exists()
                )

    def test_unknown_family_is_not_created(self) -> None:
        self.client.force_authenticate(self.admin)
        response = self.client.patch(
            "/api/plant-families/Unknown/translations/",
            {"translations": {"it": "Unknown"}},
            format="json",
        )
        self.assertEqual(response.status_code, 404)
        self.assertFalse(PlantFamily.objects.filter(pk="Unknown").exists())

    def test_family_structure_remains_read_only(self) -> None:
        _, raw = self.issue_token(scope=CropLibraryApiToken.SCOPE_WRITE)
        client = self.bearer_client(raw)
        for method in ("put", "patch", "delete"):
            response = getattr(client, method)("/api/plant-families/Solanaceae/", {}, format="json")
            self.assertIn(response.status_code, (403, 405))


class CropLibraryApiTokenStorageTests(CropLibraryApiTokenTestBase):
    def test_token_is_stored_only_as_hash(self):
        token, raw_token = self.issue_token()

        self.assertTrue(raw_token.startswith(CROP_LIBRARY_TOKEN_PREFIX))
        self.assertNotEqual(token.token_hash, raw_token)
        self.assertEqual(token.token_hash, CropLibraryApiToken.hash_token(raw_token))

        stored = CropLibraryApiToken.objects.filter(pk=token.pk).values().first()
        self.assertNotIn(raw_token, str(stored))
        secret_part = raw_token[len(CROP_LIBRARY_TOKEN_PREFIX):]
        self.assertNotIn(secret_part, str(stored))

    def test_scope_is_restricted_to_read_and_write(self):
        with self.assertRaises(ValueError):
            CropLibraryApiToken.create_token(user=self.admin, name='x', scope='delete')


class CropLibraryApiTokenAuthenticationTests(CropLibraryApiTokenTestBase):
    def test_valid_token_authenticates_as_its_owner(self):
        _, raw_token = self.issue_token(user=self.moderator, scope=CropLibraryApiToken.SCOPE_WRITE)
        client = self.bearer_client(raw_token)

        response = client.get(CROP_SPECIES_URL)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_revoked_token_is_rejected(self):
        token, raw_token = self.issue_token()
        token.revoke()
        client = self.bearer_client(raw_token)

        response = client.get(CROP_SPECIES_URL)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_expired_token_is_rejected(self):
        token, raw_token = self.issue_token()
        CropLibraryApiToken.objects.filter(pk=token.pk).update(
            expires_at=timezone.now() - timezone.timedelta(days=1)
        )
        client = self.bearer_client(raw_token)

        response = client.get(CROP_SPECIES_URL)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_garbage_token_is_rejected(self):
        client = self.bearer_client(f'{CROP_LIBRARY_TOKEN_PREFIX}not-a-real-token')
        response = client.get(CROP_SPECIES_URL)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_project_api_token_prefixed_header_is_ignored_by_this_authenticator(self):
        """A `ProjectApiToken`-shaped bearer value must never match here."""
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION='Bearer ofp_pat_something')
        response = client.get(CROP_SPECIES_URL)
        # Unauthenticated (no session, no matching token of either kind) —
        # not authenticated as a crop-library token owner.
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class CropLibraryApiTokenSurfaceTests(CropLibraryApiTokenTestBase):
    """The deny-by-default allowlist on `CropSpeciesViewSet`."""

    def setUp(self):
        super().setUp()
        self.proposal = CropSpecies.objects.create(
            name='Library token proposal', status=CropSpecies.STATUS_PROPOSED,
        )

    def test_read_scope_can_list_and_retrieve(self):
        _, raw_token = self.issue_token(user=self.moderator, scope=CropLibraryApiToken.SCOPE_READ)
        client = self.bearer_client(raw_token)

        self.assertEqual(client.get(CROP_SPECIES_URL).status_code, status.HTTP_200_OK)
        # A pending proposal is only in a moderator's default queryset with
        # `include_proposed` — same as it would be for a session request.
        detail_response = client.get(
            f'{CROP_SPECIES_URL}{self.proposal.id}/', {'include_proposed': 'true'},
        )
        self.assertEqual(detail_response.status_code, status.HTTP_200_OK)

    def test_read_scope_cannot_write(self):
        _, raw_token = self.issue_token(user=self.moderator, scope=CropLibraryApiToken.SCOPE_READ)
        client = self.bearer_client(raw_token)

        response = client.post(CROP_SPECIES_URL, {'name': 'Should be refused'})
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_write_scope_bound_to_moderator_can_propose_and_edit(self):
        _, raw_token = self.issue_token(user=self.moderator, scope=CropLibraryApiToken.SCOPE_WRITE)
        client = self.bearer_client(raw_token)

        create_response = client.post(CROP_SPECIES_URL, {'name': 'Token-proposed species'})
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)

        update_response = client.patch(
            f'{CROP_SPECIES_URL}{self.proposal.id}/?include_proposed=true',
            {
                'translations': [
                    {
                        'language_code': 'de',
                        'common_name': 'Token-Edit',
                        'synonyms': ['Alias-Edit'],
                        'regional_names': {'austria': 'Regional-Edit'},
                    },
                ],
            },
            format='json',
        )
        self.assertEqual(update_response.status_code, status.HTTP_200_OK)
        self.proposal.refresh_from_db()
        translation = self.proposal.translations.get(language_code='de')
        self.assertEqual(translation.common_name, 'Token-Edit')
        self.assertIn('Alias-Edit', translation.synonyms)
        self.assertEqual(translation.regional_names.get('austria'), 'Regional-Edit')

    def test_write_scope_cannot_approve(self):
        _, raw_token = self.issue_token(user=self.moderator, scope=CropLibraryApiToken.SCOPE_WRITE)
        client = self.bearer_client(raw_token)

        response = client.post(
            f'{CROP_SPECIES_URL}{self.proposal.id}/approve/',
            {'translations': []},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_write_scope_cannot_reject(self):
        _, raw_token = self.issue_token(user=self.moderator, scope=CropLibraryApiToken.SCOPE_WRITE)
        client = self.bearer_client(raw_token)

        response = client.post(f'{CROP_SPECIES_URL}{self.proposal.id}/reject/', {}, format='json')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_write_scope_cannot_destroy(self):
        _, raw_token = self.issue_token(user=self.moderator, scope=CropLibraryApiToken.SCOPE_WRITE)
        client = self.bearer_client(raw_token)

        response = client.delete(f'{CROP_SPECIES_URL}{self.proposal.id}/')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(CropSpecies.objects.filter(pk=self.proposal.pk).exists())

    def test_token_bound_to_non_moderator_cannot_edit_published_species(self):
        """Authorization rides on the user, not the token: same check as a session request."""
        _, raw_token = self.issue_token(user=self.plain_user, scope=CropLibraryApiToken.SCOPE_WRITE)
        client = self.bearer_client(raw_token)

        response = client.patch(
            f'{CROP_SPECIES_URL}{self.proposal.id}/',
            {'translations': []},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_non_opted_in_view_rejects_the_token_outright(self):
        """The surface middleware blocks this token from the project-crop endpoint."""
        _, raw_token = self.issue_token(user=self.admin, scope=CropLibraryApiToken.SCOPE_WRITE)
        client = self.bearer_client(raw_token)

        response = client.get('/api/crops/')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class CropLibraryApiTokenSelfServiceTests(CropLibraryApiTokenTestBase):
    """Token management itself stays session-only and superuser-gated."""

    def test_creation_requires_superuser(self):
        self.client.force_authenticate(user=self.moderator)
        response = self.client.post(TOKEN_URL, {'name': 'Moderator token'})
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(CropLibraryApiToken.objects.exists())

    def test_creation_rejects_staff_without_superuser(self):
        """Deliberately stricter than `is_public_library_moderator`'s is_staff-or-superuser: this
        credential is platform-wide, not scoped to library moderation, so plain staff isn't enough.
        """
        staff_only = User.objects.create_user(
            username='staff-only', email='staff-only@example.com', password='pw',
            is_active=True, is_staff=True, is_superuser=False,
        )
        self.client.force_authenticate(user=staff_only)
        response = self.client.post(TOKEN_URL, {'name': 'Staff token'})
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['code'], 'superuser_required')
        self.assertFalse(CropLibraryApiToken.objects.exists())

    def test_admin_can_create_a_token_bound_to_themselves(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post(TOKEN_URL, {'name': 'Sync token', 'scope': 'write'})

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(response.data['token'].startswith(CROP_LIBRARY_TOKEN_PREFIX))
        token = CropLibraryApiToken.objects.get(pk=response.data['id'])
        self.assertEqual(token.user, self.admin)

    def test_list_only_returns_the_caller_s_own_tokens(self):
        self.issue_token(user=self.admin, name='Admin token')
        other_admin = User.objects.create_user(
            username='other-admin', email='other-admin@example.com', password='pw',
            is_active=True, is_staff=True,
        )
        self.issue_token(user=other_admin, name='Other admin token')

        self.client.force_authenticate(user=self.admin)
        response = self.client.get(TOKEN_URL)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        names = [row['name'] for row in response.data]
        self.assertEqual(names, ['Admin token'])

    def test_revoking_another_users_token_404s(self):
        token, _ = self.issue_token(user=self.admin, name='Admin token')
        other_admin = User.objects.create_user(
            username='other-admin-2', email='other-admin-2@example.com', password='pw',
            is_active=True, is_staff=True,
        )

        self.client.force_authenticate(user=other_admin)
        response = self.client.delete(f'{TOKEN_URL}{token.pk}/')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_token_management_is_not_reachable_with_a_crop_library_token(self):
        _, raw_token = self.issue_token(user=self.admin, scope=CropLibraryApiToken.SCOPE_WRITE)
        client = self.bearer_client(raw_token)

        response = client.get(TOKEN_URL)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
