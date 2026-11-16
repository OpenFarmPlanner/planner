"""Catalogue identities, moderation, source provenance and independent token boundaries."""

from __future__ import annotations

from io import StringIO
from typing import Any
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from config.languages import SUPPORTED_LANGUAGE_CODES
from crops.models import CropLibraryApiToken, CropSpecies
from crops.plant_health_models import PlantHealthEntry, PlantHealthTranslation

ENTRIES = "/openfarmplanner/api/plant-health/entries/"
HOSTS = "/openfarmplanner/api/plant-health/hosts/"
SOURCE = {"url": "https://example.org/synthetic-study", "title": "Synthetic identity evidence"}


def translations(name: str = "Synthetic organism") -> list[dict[str, Any]]:
    return [
        {"language_code": code, "preferred_name": f"{name} {code}"}
        for code in SUPPORTED_LANGUAGE_CODES
    ]


class PlantHealthApiTests(TestCase):
    def setUp(self) -> None:
        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            username="plant-health-user", password="test-pass"
        )
        self.other = user_model.objects.create_user(username="other-plant-health-user")
        self.moderator = user_model.objects.create_user(
            username="plant-health-moderator", is_staff=True
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.species = CropSpecies.objects.create(
            name="Synthetic catalogue crop", status="published"
        )

    def proposal(self, **overrides: Any) -> dict[str, Any]:
        return {
            "name": "Synthetic pest",
            "kind": "pest",
            "scientific_name": "Syntheticus example",
            "sources": [SOURCE],
            "translations": translations(),
            **overrides,
        }

    def create_entry(self, **overrides: Any) -> int:
        response = self.client.post(ENTRIES, self.proposal(**overrides), format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return response.data["id"]

    def approve(self, entry_id: int, **payload: Any) -> Any:
        self.client.force_authenticate(self.moderator)
        return self.client.post(f"{ENTRIES}{entry_id}/approve/", payload, format="json")

    def published_entry(self, name: str = "Synthetic pest") -> int:
        entry_id = self.create_entry(name=name, scientific_name=f"Syntheticus {name}")
        response = self.approve(entry_id)
        self.assertEqual(response.status_code, 200, response.data)
        return entry_id

    def test_identity_lookup_preserves_visibility_and_rejects_unbounded_or_invalid_keys(self):
        published = self.published_entry()
        pending = PlantHealthEntry.objects.create(name='Hidden proposal', proposed_by=self.other)
        known = PlantHealthEntry.objects.get(pk=published)
        self.client.force_authenticate(self.user)
        response = self.client.get(ENTRIES, {
            'identities': f'{known.identity_key},{pending.identity_key}',
        })
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([item['id'] for item in response.data['results']], [published])
        for value in ['', 'not-a-uuid', ','.join([str(known.identity_key)] * 41)]:
            with self.subTest(value=value):
                self.assertEqual(self.client.get(ENTRIES, {'identities': value}).status_code, 400)

    def test_proposal_accepts_one_language_and_is_not_published_or_leaked(self) -> None:
        response = self.client.post(
            ENTRIES,
            {"name": "Privé voorstel", "kind": "group"},
            format="json",
            HTTP_ACCEPT_LANGUAGE="nl-BE",
        )
        self.assertEqual(response.status_code, 201, response.data)
        entry_id = response.data["id"]
        self.assertEqual(response.data["status"], "proposed")
        self.assertEqual(response.data["translations"][0]["language_code"], "nl")
        self.assertEqual(self.client.get(ENTRIES).data["count"], 0)
        self.assertEqual(self.client.get(f"{ENTRIES}{entry_id}/").status_code, 200)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(f"{ENTRIES}{entry_id}/").status_code, 404)
        self.assertEqual(self.client.get(ENTRIES, {"include_proposed": "true"}).data["count"], 0)

    def test_only_moderators_can_edit_review_archive_or_view_history(self) -> None:
        entry_id = self.create_entry()
        self.assertEqual(
            self.client.patch(f"{ENTRIES}{entry_id}/", {"name": "Altered"}).status_code, 403
        )
        for action in ["approve", "reject", "archive", "reopen"]:
            self.assertEqual(self.client.post(f"{ENTRIES}{entry_id}/{action}/").status_code, 403)
        self.assertEqual(self.client.get(f"{ENTRIES}{entry_id}/history/").status_code, 403)
        self.assertEqual(self.client.delete(f"{ENTRIES}{entry_id}/").status_code, 405)

    def test_approval_requires_every_current_language_and_identity_sources(self) -> None:
        entry_id = self.create_entry(
            translations=[{"language_code": "en", "preferred_name": "One language"}]
        )
        self.assertEqual(self.approve(entry_id).status_code, 400)
        self.assertEqual(PlantHealthEntry.objects.get(pk=entry_id).status, "proposed")
        self.assertEqual(
            self.approve(entry_id, translations=translations(), sources=[]).status_code, 400
        )
        response = self.approve(entry_id, translations=translations())
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], "published")
        self.assertEqual(len(response.data["translations"]), 7)
        self.assertEqual(PlantHealthEntry.objects.get(pk=entry_id).revisions.count(), 2)
        self.assertEqual(self.approve(entry_id).status_code, 400)

    def test_explicit_documented_scientific_fallback_is_allowed_but_never_invented(self) -> None:
        entry_id = self.create_entry(
            translations=[{"language_code": "en", "preferred_name": "Example pest"}]
        )
        rows = [
            {
                "language_code": code,
                "preferred_name": "Syntheticus example",
                "is_scientific_fallback": True,
                "fallback_reason": "Synthetic fixture has no vernacular name.",
            }
            for code in SUPPORTED_LANGUAGE_CODES
            if code != "en"
        ]
        self.assertEqual(self.approve(entry_id, translations=rows).status_code, 200)
        response = self.client.patch(
            f"{ENTRIES}{entry_id}/",
            {
                "translations": [
                    {
                        "language_code": "nl",
                        "preferred_name": "Invented label",
                        "is_scientific_fallback": True,
                    },
                ]
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            PlantHealthTranslation.objects.get(
                entry_id=entry_id, language_code="nl"
            ).preferred_name,
            "Syntheticus example",
        )

    def test_translation_updates_preserve_omitted_languages_and_alias_fields(self) -> None:
        entry_id = self.create_entry(
            translations=[
                {
                    "language_code": "nl",
                    "preferred_name": "Naam",
                    "synonyms": ["Alias"],
                    "regional_names": {"BE": "Vlaamse naam"},
                }
            ]
        )
        self.client.force_authenticate(self.moderator)
        response = self.client.patch(
            f"{ENTRIES}{entry_id}/",
            {
                "translations": [
                    {"language_code": "nl", "preferred_name": "Nieuwe naam"},
                    {"language_code": "en", "preferred_name": "English name"},
                ]
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        row = PlantHealthTranslation.objects.get(entry_id=entry_id, language_code="nl")
        self.assertEqual(row.synonyms, ["Alias"])
        self.assertEqual(row.regional_names, {"BE": "Vlaamse naam"})
        self.assertEqual(
            self.client.patch(
                f"{ENTRIES}{entry_id}/",
                {
                    "translations": [
                        {"language_code": "en", "synonyms": []},
                    ]
                },
                format="json",
            ).status_code,
            200,
        )
        self.assertTrue(
            PlantHealthTranslation.objects.filter(entry_id=entry_id, language_code="nl").exists()
        )

    def test_broad_labels_are_distinct_and_cannot_claim_confirmed_taxa(self) -> None:
        first = self.create_entry(name="Synthetic mildew", kind="group", scientific_name="")
        second = self.create_entry(name="Synthetic mildew", kind="disease", scientific_name="")
        self.assertNotEqual(first, second)
        response = self.client.post(
            ENTRIES, self.proposal(kind="group", eppo_code="SYNTH1"), format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.approve(first).status_code, 200)
        response = self.client.post(
            HOSTS,
            {"entry": first, "species": self.species.id, "sources": [SOURCE], "is_confirmed": True},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        response = self.client.post(
            HOSTS,
            {
                "entry": first,
                "species": self.species.id,
                "sources": [SOURCE],
                "is_confirmed": False,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertFalse(response.data["is_confirmed"])

    def test_eppo_codes_require_matching_evidence_and_stable_unique_identity(self) -> None:
        response = self.client.post(ENTRIES, self.proposal(eppo_code="SYNTH1"), format="json")
        self.assertEqual(response.status_code, 400)
        source = {
            "url": "https://gd.eppo.int/taxon/SYNTH1",
            "title": "Synthetic URL; not a real code claim",
        }
        entry_id = self.create_entry(eppo_code="synth1", sources=[source])
        self.assertEqual(PlantHealthEntry.objects.get(pk=entry_id).eppo_code, "SYNTH1")
        response = self.client.post(
            ENTRIES, self.proposal(eppo_code="SYNTH1", sources=[source]), format="json"
        )
        self.assertEqual(response.status_code, 400)
        response = self.client.post(
            ENTRIES,
            self.proposal(
                eppo_code="SYNTH2",
                sources=[
                    {"url": "https://gd.eppo.int/taxon/SYNTH2wrong"},
                ],
            ),
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_search_resolves_synonyms_and_regional_names_to_the_same_identity(self) -> None:
        entry_id = self.create_entry(
            translations=[
                *translations(),
            ]
        )
        self.client.force_authenticate(self.moderator)
        response = self.client.patch(
            f"{ENTRIES}{entry_id}/",
            {
                "translations": [
                    {
                        "language_code": "nl",
                        "synonyms": ["Nederlandse alias"],
                        "regional_names": {"BE": "Vlaamse alias"},
                    },
                ]
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.approve(entry_id).status_code, 200)
        for query in ["nederlandse alias", "VLAAMSE", "Syntheticus"]:
            response = self.client.get(ENTRIES, {"q": query}, HTTP_ACCEPT_LANGUAGE="fr")
            self.assertEqual([row["id"] for row in response.data["results"]], [entry_id])
            self.assertEqual(response.data["results"][0]["display_language_code"], "fr")

    def test_sources_are_data_only_and_credentials_or_non_http_urls_are_rejected(self) -> None:
        for url in [
            "file:///tmp/private",
            "ftp://example.org/data",
            "https://user:secret@example.org/",
        ]:
            with self.subTest(url=url):
                response = self.client.post(
                    ENTRIES, self.proposal(sources=[{"url": url}]), format="json"
                )
                self.assertEqual(response.status_code, 400)

    def test_host_sources_qualifications_and_history_are_retained(self) -> None:
        entry_id = self.published_entry()
        response = self.client.post(
            HOSTS,
            {
                "entry": entry_id,
                "species": self.species.id,
                "variety_name": "Example variety",
                "qualification": "Only the documented synthetic variety.",
                "sources": [SOURCE],
                "is_confirmed": True,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        host_id = response.data["id"]
        self.assertEqual(
            self.client.patch(f"{HOSTS}{host_id}/", {"sources": []}, format="json").status_code, 400
        )
        self.assertEqual(
            self.client.patch(
                f"{ENTRIES}{entry_id}/", {"kind": "group"}, format="json"
            ).status_code,
            400,
        )
        response = self.client.post(f"{HOSTS}{host_id}/archive/")
        self.assertEqual(response.status_code, 200, response.data)
        self.client.force_authenticate(self.user)
        self.assertEqual(self.client.get(HOSTS).data["count"], 0)
        self.client.force_authenticate(self.moderator)
        history = self.client.get(f"{ENTRIES}{entry_id}/history/").data
        self.assertEqual(history[0]["action"], "archive_host")
        self.assertEqual(
            history[0]["snapshot"]["hosts"][0]["qualification"],
            "Only the documented synthetic variety.",
        )
        self.assertFalse(history[0]["snapshot"]["hosts"][0]["is_active"])
        recreated = self.client.post(
            HOSTS,
            {
                "entry": entry_id,
                "species": self.species.pk,
                "variety_name": "Example variety",
                "sources": [SOURCE],
                "is_confirmed": True,
            },
            format="json",
        )
        self.assertEqual(recreated.status_code, 201, recreated.data)
        self.assertEqual(recreated.data["id"], host_id)
        self.assertTrue(recreated.data["is_active"])

    def test_search_folds_accents_ligatures_and_regional_names_without_rewriting_them(self) -> None:
        entry_id = self.create_entry(
            name="Référence Æ",
            scientific_name="Œdème synthetic",
            translations=[
                {
                    "language_code": "en",
                    "preferred_name": "Synthetic Cœur",
                    "synonyms": ["Æthusa"],
                    "regional_names": {"CH": "Straße"},
                },
                {"language_code": "de", "preferred_name": "Rübe"},
            ],
        )
        for query in [
            "reference ae",
            "coeur",
            "aethusa",
            "strasse",
            "rube",
            "oedeme",
            "rube coeur",
        ]:
            with self.subTest(query=query):
                response = self.client.get(ENTRIES, {"include_proposed": "true", "q": query})
                self.assertEqual(response.status_code, 200, response.data)
                self.assertEqual([row["id"] for row in response.data["results"]], [entry_id])
        entry = PlantHealthEntry.objects.get(pk=entry_id)
        self.assertEqual(entry.name, "Référence Æ")
        self.assertEqual(entry.scientific_name_normalized, "œdème synthetic")
        english = entry.translations.get(language_code="en")
        self.assertEqual(english.preferred_name, "Synthetic Cœur")
        self.assertEqual(english.synonyms, ["Æthusa"])
        self.assertEqual(english.regional_names, {"CH": "Straße"})
        entry.scientific_name = "Nouveau scientific name"
        entry.save(update_fields=["scientific_name"])
        response = self.client.get(ENTRIES, {"include_proposed": "true", "q": "nouveau"})
        self.assertEqual(response.data["count"], 1)
        response = self.client.get(ENTRIES, {"include_proposed": "true", "q": "oedeme"})
        self.assertEqual(response.data["count"], 0)

    def test_search_folding_does_not_merge_distinct_scientific_identity_keys(self) -> None:
        first = self.create_entry(scientific_name="Syntheticus cœur")
        self.assertEqual(self.approve(first).status_code, 200)
        second = self.create_entry(scientific_name="Syntheticus coeur")
        self.assertEqual(self.approve(second).status_code, 200)
        response = self.client.get(ENTRIES, {"q": "coeur"})
        self.assertEqual({row["id"] for row in response.data["results"]}, {first, second})
        self.assertNotEqual(
            PlantHealthEntry.objects.get(pk=first).identity_key,
            PlantHealthEntry.objects.get(pk=second).identity_key,
        )

    def test_search_handles_many_terms_and_matches_across_translated_names(self) -> None:
        import string

        terms = " ".join(string.ascii_lowercase + string.digits + string.punctuation)
        entry_id = self.create_entry(
            translations=[
                {"language_code": "en", "preferred_name": terms},
                {"language_code": "nl", "preferred_name": "Other translated alias"},
            ]
        )
        for query in [terms, "translated alias z"]:
            response = self.client.get(ENTRIES, {"include_proposed": "true", "q": query})
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual([row["id"] for row in response.data["results"]], [entry_id])

    def test_host_reactivation_uses_new_creation_defaults_after_identity_broadens(self) -> None:
        entry_id = self.published_entry()
        payload = {"entry": entry_id, "species": self.species.pk, "sources": [SOURCE]}
        host = self.client.post(
            HOSTS,
            {
                **payload,
                "is_confirmed": True,
                "qualification": "Previous source qualification",
            },
            format="json",
        ).data
        self.assertEqual(self.client.post(f"{HOSTS}{host['id']}/archive/").status_code, 200)
        self.assertEqual(
            self.client.patch(
                f"{ENTRIES}{entry_id}/",
                {"kind": "group"},
                format="json",
            ).status_code,
            200,
        )
        response = self.client.post(HOSTS, payload, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["id"], host["id"])
        self.assertFalse(response.data["is_confirmed"])
        self.assertEqual(response.data["qualification"], "")

    def test_host_update_cannot_collide_with_an_archived_scope(self) -> None:
        entry_id = self.published_entry()
        payload = {"entry": entry_id, "species": self.species.pk, "sources": [SOURCE]}
        archived = self.client.post(
            HOSTS,
            {
                **payload,
                "variety_name": "Archived scope",
            },
            format="json",
        ).data
        self.client.post(f"{HOSTS}{archived['id']}/archive/")
        active = self.client.post(
            HOSTS,
            {
                **payload,
                "variety_name": "Active scope",
            },
            format="json",
        ).data
        response = self.client.patch(
            f"{HOSTS}{active['id']}/",
            {
                "variety_name": "Archived scope",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.data)

    def test_history_actor_privacy_and_stable_entry_pseudonyms(
        self,
    ) -> None:
        import json

        from accounts.models import PublicProfile
        from crops.plant_health_models import PlantHealthRevision

        entry_id = self.published_entry()
        PublicProfile.objects.create(user=self.moderator, public_display_name="Public curator")
        anonymous = get_user_model().objects.create_user(
            username="private-token-curator",
            email="private-curator@example.org",
            is_staff=True,
        )
        client = self.token_client(anonymous)
        response = client.patch(f"{ENTRIES}{entry_id}/", {"name": "Audited update"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        history = self.client.get(f"{ENTRIES}{entry_id}/history/").data
        self.assertEqual(history[0]["actor_label"], "")
        self.assertEqual(history[0]["actor_anonymous_number"], 2)
        self.assertEqual(history[1]["actor_label"], "Public curator")
        self.assertIsNone(history[1]["actor_anonymous_number"])
        self.assertEqual(history[2]["actor_anonymous_number"], 1)
        self.assertNotIn(anonymous.username, json.dumps(history))
        self.assertNotIn(anonymous.email, json.dumps(history))
        PlantHealthRevision.objects.bulk_create(
            [
                PlantHealthRevision(
                    entry_id=entry_id, actor=anonymous, action="update", snapshot={}
                )
                for _ in range(101)
            ]
        )
        history = self.client.get(f"{ENTRIES}{entry_id}/history/").data
        self.assertEqual(len(history), 100)
        self.assertTrue(all(row["actor_anonymous_number"] == 2 for row in history))
        anonymous.delete()
        history = self.client.get(f"{ENTRIES}{entry_id}/history/").data
        self.assertTrue(
            all(
                row["actor_label"] == "" and row["actor_anonymous_number"] is None
                for row in history
            )
        )

    def test_host_can_be_archived_after_its_entry_is_archived(self) -> None:
        entry_id = self.published_entry()
        host_id = self.client.post(
            HOSTS,
            {"entry": entry_id, "species": self.species.id, "sources": [SOURCE]},
            format="json",
        ).data["id"]
        self.assertEqual(self.client.post(f"{ENTRIES}{entry_id}/archive/").status_code, 200)
        response = self.client.post(f"{HOSTS}{host_id}/archive/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data["is_active"])

    def test_regular_users_cannot_write_official_hosts_and_invalid_query_ids_are_400(self) -> None:
        self.assertEqual(self.client.post(HOSTS, {}, format="json").status_code, 403)
        self.assertEqual(self.client.get(HOSTS, {"entry": "invalid"}).status_code, 400)

    def token_client(self, user: Any, scope: str = "write") -> APIClient:
        _, raw = CropLibraryApiToken.create_token(
            user=user, name="Synthetic catalogue token", scope=scope
        )
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {raw}")
        return client

    def test_crop_library_tokens_can_maintain_data_but_cannot_finish_moderation(self) -> None:
        entry_id = self.published_entry()
        client = self.token_client(self.moderator)
        self.assertEqual(client.get(ENTRIES).status_code, 200)
        response = client.post(
            ENTRIES,
            self.proposal(name="Token proposal", scientific_name="Syntheticus token"),
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        proposed_id = response.data["id"]
        response = client.patch(
            f"{ENTRIES}{proposed_id}/",
            {
                "translations": [
                    {"language_code": "nl", "preferred_name": "Tokennaam"},
                ]
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        for action in ["approve", "reject", "archive", "reopen"]:
            self.assertEqual(client.post(f"{ENTRIES}{proposed_id}/{action}/").status_code, 403)
        self.assertEqual(client.delete(f"{ENTRIES}{entry_id}/").status_code, 403)
        response = client.post(
            HOSTS,
            {
                "entry": entry_id,
                "species": self.species.id,
                "sources": [SOURCE],
                "is_confirmed": True,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(client.post(f"{HOSTS}{response.data['id']}/archive/").status_code, 403)
        reader = self.token_client(self.moderator, "read")
        self.assertEqual(reader.get(ENTRIES).status_code, 200)
        self.assertEqual(reader.post(ENTRIES, self.proposal(), format="json").status_code, 403)
        plain = self.token_client(self.user)
        self.assertEqual(
            plain.patch(f"{ENTRIES}{entry_id}/", {"name": "Forbidden"}).status_code, 403
        )
        self.assertEqual(plain.post(HOSTS, {}, format="json").status_code, 403)

    def test_project_tokens_cannot_read_or_write_any_global_catalogue_surface(self) -> None:
        from farm.models import Project, ProjectApiToken, ProjectMembership

        project = Project.objects.create(
            name="Synthetic token project", slug="synthetic-token-project"
        )
        ProjectMembership.objects.create(project=project, user=self.moderator, role="admin")
        _, raw = ProjectApiToken.create_token(
            user=self.moderator, project=project, name="Project-only token", scope="write"
        )
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {raw}")
        for endpoint in [ENTRIES, HOSTS]:
            with self.subTest(endpoint=endpoint):
                self.assertEqual(client.get(endpoint).status_code, 403)
                self.assertEqual(
                    client.post(endpoint, self.proposal(), format="json").status_code, 403
                )

    def test_moderator_can_reopen_without_changing_catalogue_identity(self) -> None:
        entry_id = self.create_entry()
        self.client.force_authenticate(self.moderator)
        self.assertEqual(self.client.post(f"{ENTRIES}{entry_id}/reject/").status_code, 200)
        identity = PlantHealthEntry.objects.get(pk=entry_id).identity_key
        response = self.client.post(f"{ENTRIES}{entry_id}/reopen/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], "proposed")
        self.assertEqual(PlantHealthEntry.objects.get(pk=entry_id).identity_key, identity)
        self.assertEqual(self.approve(entry_id).status_code, 200)

    def test_scientific_duplicates_are_not_published_under_different_common_names(self) -> None:
        entry_id = self.create_entry()
        self.assertEqual(self.approve(entry_id).status_code, 200)
        second = self.create_entry(name="A different common label")
        self.assertEqual(self.approve(second).status_code, 400)

    def test_species_host_provenance_is_protected_without_a_server_error(self) -> None:
        entry_id = self.published_entry()
        self.client.post(
            HOSTS,
            {
                "entry": entry_id,
                "species": self.species.id,
                "sources": [SOURCE],
                "is_confirmed": True,
            },
            format="json",
        )
        response = self.client.delete(f"/openfarmplanner/api/crop-species/{self.species.id}/")
        self.assertEqual(response.status_code, 409, response.data)
        self.assertTrue(CropSpecies.objects.filter(pk=self.species.id).exists())


@override_settings(DJANGO_ENV="development")
class PlantHealthLocalSeedTests(TestCase):
    def setUp(self) -> None:
        self.user = get_user_model().objects.create_user(
            username="catalogue-fixture", is_staff=True
        )
        self.species = CropSpecies.objects.create(name="Synthetic fixture host", status="published")
        self.output = StringIO()
        self.options = {
            "username": self.user.username,
            "species_id": self.species.pk,
            "database_name": str(connection.settings_dict["NAME"]),
            "stdout": self.output,
        }
        environment = patch.dict("os.environ", {"OFP_LOCAL_TEST_DATA": "1"})
        environment.start()
        self.addCleanup(environment.stop)

    def seed(self, **options: Any) -> None:
        call_command("seed_plant_health_acceptance", **{**self.options, **options})

    def test_preview_apply_repeat_preserve_edits_and_do_not_grant_roles(self) -> None:
        from crops.plant_health_models import PlantHealthHost

        self.seed()
        self.assertEqual(PlantHealthEntry.objects.count(), 0)
        self.assertIn("Preview only", self.output.getvalue())
        self.seed(apply=True)
        self.assertEqual(PlantHealthEntry.objects.count(), 4)
        self.assertEqual(PlantHealthHost.objects.count(), 1)
        self.assertEqual(PlantHealthEntry.objects.filter(status="proposed").count(), 1)
        entry = PlantHealthEntry.objects.get(kind="pathogen")
        entry.name = "Manual local acceptance edit"
        entry.save()
        self.seed(apply=True)
        entry.refresh_from_db()
        self.assertEqual(entry.name, "Manual local acceptance edit")
        self.assertEqual(PlantHealthEntry.objects.count(), 4)
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_superuser)

    def test_guards_reject_remote_production_wrong_target_and_nonmoderator(self) -> None:
        for changes in [{"database_name": "wrong"}, {"username": "missing"}]:
            with self.assertRaises(CommandError):
                self.seed(apply=True, **changes)
        with patch.dict("os.environ", {"OFP_LOCAL_TEST_DATA": ""}), self.assertRaises(CommandError):
            self.seed(apply=True)
        with override_settings(DJANGO_ENV="production"), self.assertRaises(CommandError):
            self.seed(apply=True)
        with patch.dict(
            connection.settings_dict,
            {"ENGINE": "django.db.backends.postgresql", "HOST": "remote.example"},
        ):
            with self.assertRaises(CommandError):
                self.seed(apply=True)
        self.user.is_staff = False
        self.user.save()
        with self.assertRaises(CommandError):
            self.seed(apply=True)
        self.assertEqual(PlantHealthEntry.objects.count(), 0)

    def test_conflicting_identity_does_not_claim_or_modify_existing_data(self) -> None:
        from uuid import NAMESPACE_URL, uuid5

        entry = PlantHealthEntry.objects.create(
            identity_key=uuid5(NAMESPACE_URL, f"ofp-local-plant-health-{self.user.pk}-pending"),
            name="Existing local identity",
        )
        with self.assertRaises(CommandError):
            self.seed(apply=True)
        entry.refresh_from_db()
        self.assertEqual(entry.name, "Existing local identity")
        self.assertEqual(PlantHealthEntry.objects.count(), 1)
