from __future__ import annotations

import hashlib
import secrets
from typing import Any

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone

SUPPORTED_REGIONAL_NAME_KEYS = {'austria', 'switzerland'}


class CropSpecies(models.Model):
    """Official language-independent species used at the publishing boundary.

    ``name`` is the canonical *reference* label, not a UI label: it exists so
    the species has one stable, unique, human-readable identity (and so the
    unique ``name_normalized`` constraint keeps working). Everything the user
    sees comes from :class:`CropSpeciesTranslation` via
    :meth:`localized_name`, which falls back to ``name`` only as a last resort
    so the UI can never render an empty species.
    """

    STATUS_PUBLISHED = 'published'
    STATUS_PROPOSED = 'proposed'
    STATUS_REJECTED = 'rejected'
    STATUS_CHOICES = [
        (STATUS_PUBLISHED, 'Published'),
        (STATUS_PROPOSED, 'Proposed'),
        (STATUS_REJECTED, 'Rejected'),
    ]

    name = models.CharField(max_length=200)
    name_normalized = models.CharField(max_length=200, db_index=True, editable=False, unique=True)
    scientific_name = models.CharField(max_length=200, blank=True)
    family = models.CharField(max_length=200, blank=True)
    categories = models.JSONField(default=list, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PUBLISHED)
    proposed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='crop_species_proposals',
    )
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='reviewed_crop_species_proposals',
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_note = models.TextField(blank=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Crop species'
        verbose_name_plural = 'Crop species'
        permissions = [
            ('moderate_crop_species', 'Can moderate crop species proposals'),
        ]

    def save(self, *args: Any, **kwargs: Any) -> None:
        from farm.utils import normalize_text

        self.name_normalized = normalize_text(self.name) or ''
        self.scientific_name = ' '.join((self.scientific_name or '').split())
        self.family = ' '.join((self.family or '').split())
        self.categories = self._clean_categories(self.categories)
        update_fields = kwargs.get('update_fields')
        if update_fields is not None:
            kwargs['update_fields'] = set(update_fields) | {
                'categories',
                'family',
                'name_normalized',
                'scientific_name',
            }
        super().save(*args, **kwargs)

    @staticmethod
    def _clean_categories(value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        cleaned: list[str] = []
        seen: set[str] = set()
        for entry in value:
            if not isinstance(entry, str):
                continue
            category = ' '.join(entry.split()).lower()
            if category and category not in seen:
                cleaned.append(category)
                seen.add(category)
        return cleaned

    @property
    def is_pending(self) -> bool:
        """True while a moderator has not yet decided on this proposal.

        The single source of truth for "pending" callers that gate on this
        status (publish/import/discussion blocks, the frontend chip) so the
        rule can't drift between call sites.
        """
        return self.status == self.STATUS_PROPOSED

    def translations_by_language(self) -> dict[str, str]:
        """language code → common name, for every stored translation.

        Uses ``self.translations.all()`` so a ``prefetch_related`` on the
        queryset is reused instead of triggering one query per species.
        """
        return {
            translation.language_code: translation.common_name
            for translation in self.translations.all()
            if translation.common_name
        }

    def search_names(self) -> list[str]:
        """Every user-facing name that may resolve to this species.

        This is deliberately broader than ``translations_by_language``:
        regional names and synonyms are aliases for matching, not independent
        display translations, but autocomplete UIs still need to show which
        alias made a canonical species appear.
        """
        names = [self.name, self.scientific_name]
        for translation in self.translations.all():
            names.append(translation.common_name)
            names.extend(translation.synonyms)
            names.extend(
                value
                for value in translation.regional_names.values()
                if isinstance(value, str)
            )
        cleaned: list[str] = []
        seen: set[str] = set()
        for name in names:
            normalized = ' '.join((name or '').split())
            key = normalized.casefold()
            if normalized and key not in seen:
                cleaned.append(normalized)
                seen.add(key)
        return cleaned

    def localized_name(
        self, language_code: str | None, region: str | None = None,
    ) -> tuple[str, str]:
        """Best available common name plus the language it came from.

        Fallback order is the project-wide one (requested → English → any
        other translation → technical replacement); see
        ``config.languages.resolve_translation``. The returned language code
        is ``''`` only when the canonical ``name`` had to stand in, which is
        how callers know not to claim the text is a real translation.
        """
        from config.languages import resolve_translation

        translations = list(self.translations.all())
        values_by_language = {
            translation.language_code: translation.display_name_for_region(region)
            for translation in translations
            if translation.common_name
        }
        return resolve_translation(values_by_language, language_code, fallback=self.name)

    def __str__(self) -> str:
        return self.name


class CropSpeciesTranslation(models.Model):
    """The common name of one species in one language.

    "Tomate" and "Tomato" are two rows here pointing at the *same*
    ``CropSpecies`` — never two species. Only genuinely language-dependent
    text belongs here; growing data, spacings and variety names stay on the
    language-independent records.
    """

    species = models.ForeignKey(
        CropSpecies,
        on_delete=models.CASCADE,
        related_name='translations',
    )
    language_code = models.CharField(max_length=10, db_index=True)
    common_name = models.CharField(max_length=200)
    common_name_normalized = models.CharField(max_length=200, db_index=True, editable=False)
    synonyms = models.JSONField(default=list, blank=True)
    regional_names = models.JSONField(default=dict, blank=True)
    search_text_normalized = models.TextField(blank=True, db_index=True, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['language_code']
        constraints = [
            models.UniqueConstraint(
                fields=['species', 'language_code'],
                name='unique_crop_species_translation_per_language',
            ),
        ]
        verbose_name = 'Crop species translation'
        verbose_name_plural = 'Crop species translations'

    def save(self, *args: Any, **kwargs: Any) -> None:
        from farm.utils import normalize_text

        self.language_code = (self.language_code or '').strip().lower()
        self.common_name = ' '.join((self.common_name or '').split())
        self.common_name_normalized = normalize_text(self.common_name) or ''
        self.synonyms = self._clean_synonyms(self.synonyms)
        self.regional_names = self._clean_regional_names(self.regional_names)
        self.search_text_normalized = self._build_search_text_normalized()
        update_fields = kwargs.get('update_fields')
        if update_fields is not None:
            kwargs['update_fields'] = set(update_fields) | {
                'common_name',
                'common_name_normalized',
                'language_code',
                'regional_names',
                'search_text_normalized',
                'synonyms',
            }
        super().save(*args, **kwargs)

    @staticmethod
    def _clean_synonyms(value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        cleaned: list[str] = []
        seen: set[str] = set()
        for entry in value:
            if not isinstance(entry, str):
                continue
            synonym = ' '.join(entry.split())
            key = synonym.casefold()
            if synonym and key not in seen:
                cleaned.append(synonym)
                seen.add(key)
        return cleaned

    @staticmethod
    def _clean_regional_names(value: Any) -> dict[str, str]:
        if not isinstance(value, dict):
            return {}
        cleaned: dict[str, str] = {}
        for key, raw_name in value.items():
            region = str(key or '').strip().lower()
            if region not in SUPPORTED_REGIONAL_NAME_KEYS or not isinstance(raw_name, str):
                continue
            name = ' '.join(raw_name.split())
            if name:
                cleaned[region] = name
        return cleaned

    def display_name_for_region(self, region: str | None) -> str:
        """Return the region-specific display name, falling back to the canonical name."""
        region_key = (region or '').strip().lower()
        if region_key in SUPPORTED_REGIONAL_NAME_KEYS:
            regional_name = self.regional_names.get(region_key)
            if isinstance(regional_name, str) and regional_name:
                return regional_name
        return self.common_name

    def _build_search_text_normalized(self) -> str:
        from farm.utils import normalize_text

        terms = [
            self.common_name,
            *self.synonyms,
            *[
                value
                for value in self.regional_names.values()
                if isinstance(value, str)
            ],
        ]
        normalized_terms = []
        for term in terms:
            normalized = normalize_text(term)
            if normalized:
                normalized_terms.append(normalized)
        return '\n' + '\n'.join(dict.fromkeys(normalized_terms)) + '\n' if normalized_terms else ''

    def __str__(self) -> str:
        return f'{self.language_code}: {self.common_name}'


class PublicLibraryModeratorRequest(models.Model):
    """Request from a user who wants to help moderate the public crop library."""

    STATUS_PENDING = 'pending'
    STATUS_APPROVED = 'approved'
    STATUS_REJECTED = 'rejected'
    STATUS_CHOICES = [
        (STATUS_PENDING, 'Pending'),
        (STATUS_APPROVED, 'Approved'),
        (STATUS_REJECTED, 'Rejected'),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='public_library_moderator_requests',
    )
    motivation = models.TextField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='reviewed_public_library_moderator_requests',
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [
            models.UniqueConstraint(
                fields=['user'],
                condition=Q(status='pending'),
                name='unique_pending_public_library_moderator_request_per_user',
            ),
        ]
        verbose_name = 'Public library moderator request'
        verbose_name_plural = 'Public library moderator requests'

    def __str__(self) -> str:
        return f'{self.user_id}: {self.status}'


# Prefix on every issued crop-library token. Deliberately distinct from
# `farm.models.agent_api.API_TOKEN_PREFIX` (`ofp_pat_`) so the two credential
# types are never confused at a glance, in logs, or by the detection helpers
# that key off a literal prefix — see `crops.agent_api.authentication`.
CROP_LIBRARY_API_TOKEN_PREFIX = 'ofp_clt_'

# Same reasoning as `ProjectApiToken.API_TOKEN_ENTROPY_BYTES`: the input is
# uniformly random `secrets.token_urlsafe` output, so a plain SHA-256 digest
# needs no salt or stretching to be safe against brute force.
CROP_LIBRARY_API_TOKEN_ENTROPY_BYTES = 32

CROP_LIBRARY_API_TOKEN_DISPLAY_PREFIX_LENGTH = 8


class CropLibraryApiToken(models.Model):
    """A personal, platform-scoped bearer token for the crop taxonomy API.

    Unlike `farm.models.ProjectApiToken`, this token is bound to a user only,
    never to a project — `CropSpecies` is global library data, not project
    data. Authorization is not carried on the token at all: every request
    still goes through `is_public_library_moderator(request.user)` /
    `is_public_library_admin(request.user)` exactly as a session request
    would, so the token is only ever as powerful as the account it is bound
    to. See docs/rfc-crop-taxonomy-admin-api.md for the design rationale.

    `destroy`/`approve`/`reject` are deliberately never reachable with this
    token (see `crops.views.CropSpeciesViewSet.crop_library_token_actions`),
    so the token only ever needs a `read`/`write` scope — no `delete`.
    """

    SCOPE_READ = 'read'
    SCOPE_WRITE = 'write'
    SCOPE_CHOICES = [
        (SCOPE_READ, 'Read only'),
        (SCOPE_WRITE, 'Read and write'),
    ]
    SCOPE_VALUES = {SCOPE_READ, SCOPE_WRITE}

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='crop_library_api_tokens',
    )
    name = models.CharField(max_length=120, help_text='Human-readable label chosen by the owner')
    scope = models.CharField(max_length=20, choices=SCOPE_CHOICES, default=SCOPE_READ)
    token_hash = models.CharField(max_length=64, unique=True, db_index=True, editable=False)
    token_prefix = models.CharField(
        max_length=16,
        editable=False,
        help_text='Non-secret leading characters used to identify the token in listings',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(null=True, blank=True, db_index=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Crop library API token'
        verbose_name_plural = 'Crop library API tokens'

    def __str__(self) -> str:
        return f'{self.name} ({self.token_prefix}…)'

    @staticmethod
    def hash_token(raw_token: str) -> str:
        """Return the SHA-256 digest used as the stored token representation."""
        return hashlib.sha256(raw_token.encode('utf-8')).hexdigest()

    @classmethod
    def generate_raw_token(cls) -> str:
        """Return a fresh, prefixed, high-entropy plaintext token."""
        random_part = secrets.token_urlsafe(CROP_LIBRARY_API_TOKEN_ENTROPY_BYTES)
        return f'{CROP_LIBRARY_API_TOKEN_PREFIX}{random_part}'

    @classmethod
    def create_token(
        cls,
        *,
        user,
        name: str,
        scope: str = SCOPE_READ,
        expires_at=None,
    ) -> tuple[CropLibraryApiToken, str]:
        """Create a token and return it together with its one-time plaintext.

        :param user: Owner the token is bound to. The caller is responsible
            for having verified this user is a platform admin before calling.
        :param name: Human-readable label.
        :param scope: Either ``read`` or ``write``.
        :param expires_at: Optional expiry timestamp.
        :return: Tuple of persisted token and its plaintext value.
        """
        if scope not in cls.SCOPE_VALUES:
            raise ValueError(f'Unsupported crop library API token scope: {scope!r}')

        raw_token = cls.generate_raw_token()
        random_part = raw_token[len(CROP_LIBRARY_API_TOKEN_PREFIX):]
        token = cls.objects.create(
            user=user,
            name=name,
            scope=scope,
            token_hash=cls.hash_token(raw_token),
            token_prefix=random_part[:CROP_LIBRARY_API_TOKEN_DISPLAY_PREFIX_LENGTH],
            expires_at=expires_at,
        )
        return token, raw_token

    @property
    def is_expired(self) -> bool:
        return self.expires_at is not None and timezone.now() >= self.expires_at

    @property
    def is_revoked(self) -> bool:
        return self.revoked_at is not None

    @property
    def is_active(self) -> bool:
        return not self.is_revoked and not self.is_expired

    @property
    def status(self) -> str:
        if self.is_revoked:
            return 'revoked'
        if self.is_expired:
            return 'expired'
        return 'active'

    def can_write(self) -> bool:
        return self.scope == self.SCOPE_WRITE

    def revoke(self) -> None:
        if self.revoked_at is None:
            self.revoked_at = timezone.now()
            self.save(update_fields=['revoked_at'])

    def touch_last_used(self, *, now=None, min_interval_seconds: int = 60) -> None:
        """Record usage, coalesced to at most one write per minute — see
        `ProjectApiToken.touch_last_used` for the identical rationale.
        """
        moment = now or timezone.now()
        if (
            self.last_used_at is not None
            and (moment - self.last_used_at).total_seconds() < min_interval_seconds
        ):
            return
        self.last_used_at = moment
        type(self).objects.filter(pk=self.pk).update(last_used_at=moment)
