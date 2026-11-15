"""Catalogue validation and atomic, auditable moderation writes."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit

from django.db import IntegrityError, transaction
from django.db.models import Prefetch, QuerySet
from django.forms.models import model_to_dict
from django.utils import timezone
from rest_framework import serializers

from config.languages import SUPPORTED_LANGUAGE_CODES

from .plant_health_models import (
    PlantHealthEntry,
    PlantHealthHost,
    PlantHealthRevision,
    PlantHealthTranslation,
)

TRANSLATION_FIELDS = (
    "language_code",
    "preferred_name",
    "synonyms",
    "regional_names",
    "is_scientific_fallback",
    "fallback_reason",
)
ENTRY_FIELDS = ("name", "scientific_name", "kind", "eppo_code", "sources")


def catalogue_queryset() -> QuerySet[PlantHealthEntry]:
    hosts = (
        PlantHealthHost.objects.filter(is_active=True)
        .select_related("species")
        .prefetch_related(
            "species__translations",
        )
    )
    return PlantHealthEntry.objects.prefetch_related(
        "translations",
        Prefetch("hosts", queryset=hosts, to_attr="active_hosts"),
    )


def merged_translations(
    entry: PlantHealthEntry | None,
    supplied: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    translations = (
        {
            row.language_code: model_to_dict(row, fields=TRANSLATION_FIELDS)
            for row in entry.translations.all()
        }
        if entry is not None
        else {}
    )
    for row in supplied:
        code = row["language_code"]
        translations[code] = {**translations.get(code, {}), **row}
    return translations


def _validate_eppo(
    entry: PlantHealthEntry | None, code: str, specific: bool, sources: list
) -> None:
    if not code:
        return
    if not specific:
        raise serializers.ValidationError(
            {"eppo_code": "Broad groups and disease concepts cannot carry a taxon EPPO code."}
        )
    if not any(
        urlsplit(source["url"]).hostname == "gd.eppo.int"
        and urlsplit(source["url"]).path.strip("/").split("/")[:2] == ["taxon", code]
        for source in sources
    ):
        raise serializers.ValidationError(
            {"eppo_code": "Include the matching EPPO taxon page as a source."}
        )
    duplicates = PlantHealthEntry.objects.filter(eppo_code=code)
    if entry is not None:
        duplicates = duplicates.exclude(pk=entry.pk)
    if duplicates.exists():
        raise serializers.ValidationError(
            {"eppo_code": "This EPPO identity already exists; use that entry."}
        )


def _validate_names(translations: dict, scientific_name: str) -> None:
    for language, row in translations.items():
        if not (row.get("preferred_name") or "").strip():
            raise serializers.ValidationError(
                {"translations": f"A preferred name is required for {language}."}
            )
        if row.get("is_scientific_fallback") and (
            not scientific_name
            or row["preferred_name"] != scientific_name
            or not (row.get("fallback_reason") or "").strip()
        ):
            raise serializers.ValidationError(
                {
                    "translations": "A scientific fallback must use the scientific name "
                    "and include its reason."
                }
            )


def _validate_publication(
    entry: PlantHealthEntry | None,
    translations: dict,
    sources: list,
    scientific_name: str,
    specific: bool,
) -> None:
    missing = [code for code in SUPPORTED_LANGUAGE_CODES if code not in translations]
    if missing:
        raise serializers.ValidationError(
            {"translations": "Required names are missing.", "missing_languages": missing}
        )
    if not sources:
        raise serializers.ValidationError({"sources": "Approval requires identity sources."})
    if not specific:
        return
    if not scientific_name:
        raise serializers.ValidationError(
            {"scientific_name": "A confirmed pest/pathogen identity requires a scientific name."}
        )
    duplicates = PlantHealthEntry.objects.filter(
        status=PlantHealthEntry.STATUS_PUBLISHED,
        kind__in=[PlantHealthEntry.KIND_PEST, PlantHealthEntry.KIND_PATHOGEN],
        scientific_name_normalized=" ".join(scientific_name.split()).casefold(),
    )
    if entry is not None:
        duplicates = duplicates.exclude(pk=entry.pk)
    if duplicates.exists():
        raise serializers.ValidationError(
            {"scientific_name": "This approved scientific identity already exists."}
        )


def validate_entry_candidate(
    entry: PlantHealthEntry | None,
    attrs: dict[str, Any],
    *,
    publishing: bool = False,
) -> None:
    def value(field: str, default: Any = "") -> Any:
        return attrs.get(field, getattr(entry, field, default))

    kind = value("kind", PlantHealthEntry.KIND_GROUP)
    scientific_name = value("scientific_name").strip()
    specific = kind in {PlantHealthEntry.KIND_PEST, PlantHealthEntry.KIND_PATHOGEN}
    sources = value("sources", [])
    _validate_eppo(entry, value("eppo_code").strip().upper(), specific, sources)
    translations = merged_translations(entry, attrs.get("translations", []))
    _validate_names(translations, scientific_name)
    if publishing or entry is not None and entry.status == PlantHealthEntry.STATUS_PUBLISHED:
        _validate_publication(entry, translations, sources, scientific_name, specific)
    if (
        entry is not None
        and not specific
        and entry.hosts.filter(is_active=True, is_confirmed=True).exists()
    ):
        raise serializers.ValidationError(
            {
                "kind": "Archive confirmed host links before changing this identity "
                "to a broad concept."
            }
        )


def record_revision(entry: PlantHealthEntry, actor: Any, action: str) -> None:
    snapshot = model_to_dict(entry, fields=[*ENTRY_FIELDS, "status", "review_note"])
    snapshot["translations"] = list(entry.translations.values(*TRANSLATION_FIELDS))
    snapshot["hosts"] = list(
        entry.hosts.values(
            "id",
            "species_id",
            "variety_name",
            "qualification",
            "sources",
            "is_confirmed",
            "is_active",
        )
    )
    PlantHealthRevision.objects.create(entry=entry, actor=actor, action=action, snapshot=snapshot)


def write_entry(
    entry: PlantHealthEntry | None,
    attrs: dict[str, Any],
    actor: Any,
    *,
    review_action: str | None = None,
    review_note: str = "",
) -> PlantHealthEntry:
    with transaction.atomic():
        if entry is not None:
            entry = PlantHealthEntry.objects.select_for_update().get(pk=entry.pk)
        candidate = dict(attrs)
        translations = candidate.pop("translations", [])
        validate_entry_candidate(
            entry,
            {**candidate, "translations": translations},
            publishing=review_action == "approve",
        )
        if review_action in {"approve", "reject"} and (
            entry is None or entry.status != PlantHealthEntry.STATUS_PROPOSED
        ):
            raise serializers.ValidationError("Only pending proposals may be approved or rejected.")
        if review_action == "reopen" and (
            entry is None
            or entry.status
            not in {PlantHealthEntry.STATUS_REJECTED, PlantHealthEntry.STATUS_ARCHIVED}
        ):
            raise serializers.ValidationError("Only rejected or archived entries may be reopened.")
        action = review_action or ("create" if entry is None else "update")
        if entry is None:
            entry = PlantHealthEntry(proposed_by=actor)
        for field, value in candidate.items():
            setattr(entry, field, value)
        if review_action:
            entry.status = {
                "approve": PlantHealthEntry.STATUS_PUBLISHED,
                "reject": PlantHealthEntry.STATUS_REJECTED,
                "archive": PlantHealthEntry.STATUS_ARCHIVED,
                "reopen": PlantHealthEntry.STATUS_PROPOSED,
            }[review_action]
            entry.reviewed_by = actor
            entry.reviewed_at = timezone.now()
            entry.review_note = review_note
        try:
            with transaction.atomic():
                entry.save()
        except IntegrityError as error:
            raise serializers.ValidationError(
                "An equivalent catalogue identity already exists."
            ) from error
        for row in translations:
            row = dict(row)
            language = row.pop("language_code")
            PlantHealthTranslation.objects.update_or_create(
                entry=entry, language_code=language, defaults=row
            )
        record_revision(entry, actor, action)
    return catalogue_queryset().get(pk=entry.pk)


def write_host(
    host: PlantHealthHost | None,
    attrs: dict[str, Any],
    actor: Any,
    *,
    archive: bool = False,
) -> PlantHealthHost:
    from .plant_health_serializers import PlantHealthHostSerializer

    with transaction.atomic():
        if host is not None:
            host = (
                PlantHealthHost.objects.select_for_update().select_related("entry").get(pk=host.pk)
            )
        entry = attrs.get("entry", getattr(host, "entry", None))
        if entry is None:
            raise serializers.ValidationError({"entry": "This field is required."})
        # Use the same entry lock as moderation, so identity changes and host writes cannot race.
        entry = PlantHealthEntry.objects.select_for_update().get(pk=entry.pk)
        attrs = {**attrs, "entry": entry}
        if not archive:
            PlantHealthHostSerializer(instance=host).validate(attrs)
        if host is None:
            # An archived link of the same scope is reactivated: the unique scope constraint
            # would otherwise make a once-archived relationship impossible to restore.
            host = PlantHealthHost.objects.filter(
                entry=entry,
                species=attrs["species"],
                variety_name=attrs["variety_name"],
                is_active=False,
            ).first()
            if host is not None:
                attrs = {
                    **attrs,
                    "is_active": True,
                    "is_confirmed": attrs.get("is_confirmed", False),
                    "qualification": attrs.get("qualification", ""),
                }
        if host is None:
            host = PlantHealthHost.objects.create(**attrs)
        else:
            for field, value in attrs.items():
                setattr(host, field, value)
            if archive:
                host.is_active = False
            host.save()
        record_revision(entry, actor, "archive_host" if archive else "update_host")
    return (
        PlantHealthHost.objects.select_related("entry", "species")
        .prefetch_related(
            "species__translations",
        )
        .get(pk=host.pk)
    )
