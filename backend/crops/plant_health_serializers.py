"""Validated catalogue payloads; editorial text never creates an inferred host relationship."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlsplit

from rest_framework import serializers

from accounts.public_identity import get_public_user_label
from config.languages import SUPPORTED_LANGUAGE_CODES, resolve_request_language
from crops.models import CropSpecies

from .plant_health_models import (
    PlantHealthEntry,
    PlantHealthHost,
    PlantHealthRevision,
    PlantHealthTranslation,
)


class PlantHealthSourceSerializer(serializers.Serializer):
    url = serializers.URLField(max_length=2048)
    title = serializers.CharField(max_length=300, required=False, allow_blank=True)
    evidence = serializers.CharField(max_length=2000, required=False, allow_blank=True)

    def validate_url(self, value: str) -> str:
        parsed = urlsplit(value)
        if parsed.scheme not in {"http", "https"} or parsed.username or parsed.password:
            raise serializers.ValidationError(
                "Use a public HTTP or HTTPS source URL without credentials."
            )
        return value


class PlantHealthTranslationSerializer(serializers.ModelSerializer):
    language_code = serializers.ChoiceField(choices=SUPPORTED_LANGUAGE_CODES)
    preferred_name = serializers.CharField(max_length=200, required=False, allow_blank=False)
    synonyms = serializers.ListField(
        child=serializers.CharField(max_length=200, allow_blank=False),
        max_length=30,
        required=False,
    )
    regional_names = serializers.DictField(
        child=serializers.CharField(max_length=200, allow_blank=False),
        required=False,
    )

    class Meta:
        model = PlantHealthTranslation
        fields = [
            "language_code",
            "preferred_name",
            "synonyms",
            "regional_names",
            "is_scientific_fallback",
            "fallback_reason",
        ]
        extra_kwargs = {
            "is_scientific_fallback": {"required": False},
            "fallback_reason": {"required": False},
        }

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        if "language_code" not in attrs:
            raise serializers.ValidationError({"language_code": "This field is required."})
        if "preferred_name" in attrs:
            attrs["preferred_name"] = " ".join(attrs["preferred_name"].split())
        return attrs

    def validate_synonyms(self, value: list[str]) -> list[str]:
        names: dict[str, str] = {}
        for name in value:
            normalized = " ".join(name.split())
            names.setdefault(normalized.casefold(), normalized)
        return list(names.values())

    def validate_regional_names(self, value: dict[str, str]) -> dict[str, str]:
        if len(value) > 50 or any(not re.fullmatch(r"[A-Z]{2}", key) for key in value):
            raise serializers.ValidationError(
                "Use at most 50 ISO country-code keys, such as AT or BE."
            )
        return {key: " ".join(name.split()) for key, name in value.items()}


class PlantHealthHostSerializer(serializers.ModelSerializer):
    sources = PlantHealthSourceSerializer(many=True, required=True, allow_empty=False)
    species_name = serializers.SerializerMethodField()

    class Meta:
        model = PlantHealthHost
        fields = [
            "id",
            "entry",
            "species",
            "species_name",
            "variety_name",
            "qualification",
            "sources",
            "is_confirmed",
            "is_active",
            "updated_at",
        ]
        read_only_fields = ["id", "species_name", "is_active", "updated_at"]
        extra_kwargs = {"qualification": {"max_length": 2000}}
        validators = []

    def get_species_name(self, obj: PlantHealthHost) -> str:
        request = self.context.get("request")
        language = resolve_request_language(request) if request is not None else "en"
        return obj.species.localized_name(language)[0]

    def validate_sources(self, value: list[dict[str, str]]) -> list[dict[str, str]]:
        if len(value) > 20:
            raise serializers.ValidationError("At most 20 sources are supported.")
        return value

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        entry = attrs.get("entry", getattr(self.instance, "entry", None))
        species = attrs.get("species", getattr(self.instance, "species", None))
        if entry is None or species is None:
            raise serializers.ValidationError("Entry and species are required.")
        if self.instance is not None and (
            entry.pk != self.instance.entry_id or species.pk != self.instance.species_id
        ):
            raise serializers.ValidationError(
                "Archive the old host link before creating a different relationship."
            )
        if entry.status != PlantHealthEntry.STATUS_PUBLISHED:
            raise serializers.ValidationError({"entry": "Choose an approved catalogue entry."})
        if species.status != CropSpecies.STATUS_PUBLISHED:
            raise serializers.ValidationError({"species": "Choose an approved crop species."})
        confirmed = attrs.get("is_confirmed", getattr(self.instance, "is_confirmed", False))
        if confirmed and not entry.has_specific_identity:
            raise serializers.ValidationError(
                {
                    "is_confirmed": "Disease concepts and broad groups cannot confirm "
                    "a shared pathogen.",
                }
            )
        variety = " ".join(
            attrs.get("variety_name", getattr(self.instance, "variety_name", "")).split()
        )
        duplicates = PlantHealthHost.objects.filter(
            entry=entry, species=species, variety_name=variety
        )
        if self.instance is None:
            duplicates = duplicates.filter(is_active=True)
        else:
            duplicates = duplicates.exclude(pk=self.instance.pk)
        if duplicates.exists():
            raise serializers.ValidationError(
                "This host relationship already exists; update it instead."
            )
        attrs["variety_name"] = variety
        return attrs


class PlantHealthEntrySerializer(serializers.ModelSerializer):
    sources = PlantHealthSourceSerializer(many=True, required=False)
    translations = PlantHealthTranslationSerializer(many=True, required=False)
    display_name = serializers.SerializerMethodField()
    display_language_code = serializers.SerializerMethodField()
    has_specific_identity = serializers.BooleanField(read_only=True)
    hosts = serializers.SerializerMethodField()

    class Meta:
        model = PlantHealthEntry
        fields = [
            "id",
            "identity_key",
            "name",
            "scientific_name",
            "kind",
            "eppo_code",
            "sources",
            "status",
            "reviewed_at",
            "review_note",
            "created_at",
            "updated_at",
            "translations",
            "display_name",
            "display_language_code",
            "has_specific_identity",
            "hosts",
        ]
        read_only_fields = [
            "id",
            "identity_key",
            "status",
            "reviewed_at",
            "review_note",
            "created_at",
            "updated_at",
        ]

    def _localized(self, obj: PlantHealthEntry) -> tuple[str, str]:
        request = self.context.get("request")
        return obj.localized_name(
            resolve_request_language(request) if request is not None else "en"
        )

    def get_display_name(self, obj: PlantHealthEntry) -> str:
        return self._localized(obj)[0]

    def get_display_language_code(self, obj: PlantHealthEntry) -> str:
        return self._localized(obj)[1]

    def get_hosts(self, obj: PlantHealthEntry) -> list[dict[str, Any]]:
        hosts = getattr(obj, "active_hosts", None)
        if hosts is None:
            hosts = (
                obj.hosts.filter(is_active=True)
                .select_related("species")
                .prefetch_related(
                    "species__translations",
                )
            )
        return PlantHealthHostSerializer(hosts, many=True, context=self.context).data

    def validate_sources(self, value: list[dict[str, str]]) -> list[dict[str, str]]:
        if len(value) > 20:
            raise serializers.ValidationError("At most 20 sources are supported.")
        return value

    def validate_eppo_code(self, value: str) -> str:
        value = value.strip().upper()
        if value and not re.fullmatch(r"[A-Z0-9]{6}", value):
            raise serializers.ValidationError("An EPPO code has six letters or digits.")
        return value

    def validate_translations(self, value: list[dict[str, Any]]) -> list[dict[str, Any]]:
        codes = [item["language_code"] for item in value]
        if len(codes) != len(set(codes)):
            raise serializers.ValidationError("A language may appear only once.")
        return value

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        from .plant_health_services import validate_entry_candidate

        if self.instance is None and not attrs.get("translations"):
            request = self.context.get("request")
            attrs["translations"] = [
                {
                    "language_code": resolve_request_language(request)
                    if request is not None
                    else "en",
                    "preferred_name": attrs["name"],
                }
            ]
        validate_entry_candidate(self.instance, attrs)
        return attrs


class PlantHealthRevisionSerializer(serializers.ModelSerializer):
    actor_label = serializers.SerializerMethodField()
    actor_anonymous_number = serializers.SerializerMethodField()

    def get_actor_label(self, obj: PlantHealthRevision) -> str:
        return get_public_user_label(obj.actor)

    def get_actor_anonymous_number(self, obj: PlantHealthRevision) -> int | None:
        return self.context.get("anonymous_numbers", {}).get(obj.actor_id)

    class Meta:
        model = PlantHealthRevision
        fields = ["id", "action", "snapshot", "created_at", "actor_label", "actor_anonymous_number"]
        read_only_fields = fields
