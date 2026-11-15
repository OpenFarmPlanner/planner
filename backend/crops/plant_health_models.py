"""Moderated plant-health identities, translated names and sourced host relationships."""

from __future__ import annotations

import uuid
from typing import Any

from django.conf import settings
from django.db import models
from django.db.models import Q

from config.languages import resolve_translation


class PlantHealthEntry(models.Model):
    KIND_PEST = "pest"
    KIND_PATHOGEN = "pathogen"
    KIND_DISEASE = "disease"
    KIND_GROUP = "group"
    KIND_CHOICES = [
        (kind, kind.title())
        for kind in (
            KIND_PEST,
            KIND_PATHOGEN,
            KIND_DISEASE,
            KIND_GROUP,
        )
    ]
    STATUS_PROPOSED = "proposed"
    STATUS_PUBLISHED = "published"
    STATUS_REJECTED = "rejected"
    STATUS_ARCHIVED = "archived"
    STATUS_CHOICES = [
        (status, status.title())
        for status in (
            STATUS_PROPOSED,
            STATUS_PUBLISHED,
            STATUS_REJECTED,
            STATUS_ARCHIVED,
        )
    ]

    identity_key = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    name = models.CharField(max_length=200)
    name_normalized = models.CharField(max_length=400, db_index=True, editable=False)
    scientific_name = models.CharField(max_length=200, blank=True)
    scientific_name_normalized = models.CharField(
        max_length=400, db_index=True, editable=False, blank=True
    )
    search_text = models.TextField(blank=True, editable=False)
    kind = models.CharField(max_length=20, choices=KIND_CHOICES, default=KIND_GROUP)
    eppo_code = models.CharField(max_length=6, blank=True)
    sources = models.JSONField(default=list, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PROPOSED)
    proposed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="plant_health_proposals",
    )
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="reviewed_plant_health_entries",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name", "pk"]
        constraints = [
            models.UniqueConstraint(
                fields=["scientific_name_normalized"],
                condition=Q(status="published", kind__in=["pest", "pathogen"])
                & ~Q(scientific_name_normalized=""),
                name="unique_published_plant_health_taxon",
            ),
            models.UniqueConstraint(
                fields=["eppo_code"],
                condition=~Q(eppo_code=""),
                name="unique_plant_health_eppo_code",
            ),
        ]

    def save(self, *args: Any, **kwargs: Any) -> None:
        from farm.utils import normalize_search_text, normalize_text

        self.name = " ".join(self.name.split())
        self.name_normalized = normalize_text(self.name) or ""
        self.scientific_name = " ".join(self.scientific_name.split())
        self.scientific_name_normalized = normalize_text(self.scientific_name) or ""
        self.eppo_code = self.eppo_code.strip().upper()
        self.search_text = "\n".join(
            normalize_search_text(name)
            for name in [self.name, self.scientific_name, self.eppo_code]
        )
        if kwargs.get("update_fields") is not None:
            kwargs["update_fields"] = set(kwargs["update_fields"]) | {
                "name",
                "name_normalized",
                "scientific_name",
                "scientific_name_normalized",
                "search_text",
                "eppo_code",
                "updated_at",
            }
        super().save(*args, **kwargs)

    @property
    def has_specific_identity(self) -> bool:
        return self.kind in {self.KIND_PEST, self.KIND_PATHOGEN}

    def localized_name(self, language_code: str) -> tuple[str, str]:
        return resolve_translation(
            {row.language_code: row.preferred_name for row in self.translations.all()},
            language_code,
            fallback=self.name,
        )

    def __str__(self) -> str:
        return self.name


class PlantHealthTranslation(models.Model):
    entry = models.ForeignKey(
        PlantHealthEntry, on_delete=models.CASCADE, related_name="translations"
    )
    language_code = models.CharField(max_length=10)
    preferred_name = models.CharField(max_length=200)
    synonyms = models.JSONField(default=list, blank=True)
    regional_names = models.JSONField(default=dict, blank=True)
    is_scientific_fallback = models.BooleanField(default=False)
    fallback_reason = models.CharField(max_length=500, blank=True)
    search_text = models.TextField(blank=True, editable=False)

    class Meta:
        ordering = ["language_code"]
        constraints = [
            models.UniqueConstraint(
                fields=["entry", "language_code"],
                name="unique_plant_health_translation",
            )
        ]

    def save(self, *args: Any, **kwargs: Any) -> None:
        from farm.utils import normalize_search_text

        names = [self.preferred_name, *self.synonyms, *self.regional_names.values()]
        self.search_text = "\n".join(normalize_search_text(name) for name in names)
        if kwargs.get("update_fields") is not None:
            kwargs["update_fields"] = set(kwargs["update_fields"]) | {"search_text"}
        super().save(*args, **kwargs)


class PlantHealthHost(models.Model):
    entry = models.ForeignKey(PlantHealthEntry, on_delete=models.PROTECT, related_name="hosts")
    species = models.ForeignKey(
        "crops.CropSpecies", on_delete=models.PROTECT, related_name="plant_health_hosts"
    )
    variety_name = models.CharField(max_length=200, blank=True)
    qualification = models.TextField(blank=True)
    sources = models.JSONField(default=list)
    is_confirmed = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["species_id", "variety_name", "pk"]
        constraints = [
            models.UniqueConstraint(
                fields=["entry", "species", "variety_name"],
                name="unique_plant_health_host_scope",
            )
        ]


class PlantHealthRevision(models.Model):
    entry = models.ForeignKey(PlantHealthEntry, on_delete=models.PROTECT, related_name="revisions")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    action = models.CharField(max_length=30)
    snapshot = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-pk"]
