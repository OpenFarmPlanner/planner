"""
Crop Library service layer — the single place `crops.views` (and, in the
future, any other consumer) reads published crop data from.

This module must never import anything project-scoped (`Project`,
`PlantingPlan`, `Bed`, ...) or anything from farm's domain view/serializer packages
— see docs/crop-library-architecture.md for the dependency rule this
enforces ("the crop library knows nothing about projects; farm planning
uses the crop library, never the other way round").

Publishing a project's `Crop` into the library, and importing a
published crop back into a project, are intentionally NOT in this module:
those are bridge operations that need `Crop`/`Project`, and stay in
`farm.services.public_crops` until a future step decides how that
bridge should work once the crop library is a genuinely separate service
(e.g. an HTTP call instead of a direct ORM write). See the architecture
doc's "deliberately deferred" section.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from django.db import connection
from django.db.models import (
    Case,
    Exists,
    F,
    FloatField,
    Func,
    IntegerField,
    OuterRef,
    Q,
    QuerySet,
    Subquery,
    Value,
    When,
)
from django.db.models.functions import Coalesce, Greatest

from farm.models import PublicCrop
from farm.utils import normalize_text

if TYPE_CHECKING:
    from django.contrib.auth.models import AbstractBaseUser

    from .models import CropSpecies, PublicLibraryModeratorRequest

SEARCH_ALIASES = {
    'paradeis': 'tomate',
    'paradeiser': 'tomate',
    'paradeisern': 'tomate',
    'paradeisers': 'tomate',
}

DISCOURAGED_PUBLIC_SPECIES_NORMALIZED_NAMES = {'bohne', 'bean'}

# Ranked search over official crop species — used by the "Offizielle
# Kulturart" field of the publishing wizard, and by the moderation page's
# synonym-alias search. See docs/crop-library-architecture.md.
SPECIES_SEARCH_RESULT_LIMIT = 20
# Longer queries are truncated: similarity scoring cost grows with query length.
MAX_SPECIES_SEARCH_QUERY_LENGTH = 100
# Results ranked purely on similarity (no exact/prefix hit) below this score
# are dropped as irrelevant noise rather than shown as weak suggestions. Kept
# fairly strict: a genuine typo of a longer name ("Fleichtomate" for
# "Fleischtomate") still scores well above it, while short queries stay
# gated by `MIN_SPECIES_SEARCH_FUZZY_QUERY_LENGTH` below instead of a lower
# threshold, since a 3-4 letter query can coincidentally resemble many
# unrelated names.
MIN_SPECIES_SEARCH_SIMILARITY = 0.5
# Below this normalized query length, only exact/prefix (alias-aware
# substring) matches are offered — pure similarity ranking is too noisy on
# a handful of characters (e.g. "tom" resembling "Topinambur").
MIN_SPECIES_SEARCH_FUZZY_QUERY_LENGTH = 4
SPECIES_SEARCH_RANK_EXACT = 2
SPECIES_SEARCH_RANK_PREFIX = 1


def build_crop_search_terms(value: str) -> set[str]:
    """Return normalized search variants for user-facing crop lookup."""
    normalized = normalize_text(value)
    if not normalized:
        return set()

    terms = {normalized}
    for token in normalized.split():
        terms.add(token)
        alias = SEARCH_ALIASES.get(token)
        if alias:
            terms.add(alias)
        # Naive plural stripping: German "-e" + "-n" plurals (Tomate ->
        # Tomaten) and English/German "-s" plurals both drop exactly one
        # trailing letter, so every matched suffix strips 1 char, not
        # len(suffix) - stripping "-en" as 2 chars would turn "Tomaten" into
        # the invalid "Tomat" instead of "Tomate". Guarded to a minimum
        # length so the truncated term stays specific enough for `icontains`.
        if any(token.endswith(suffix) for suffix in ('en', 'n', 's')) and len(token) > 4:
            terms.add(token[:-1])

    alias = SEARCH_ALIASES.get(normalized)
    if alias:
        terms.add(alias)
    return {term for term in terms if term}


def build_public_crop_search_query(value: str, *, include_variety: bool = True) -> Q:
    """Build a search query spanning crop names, species names, and translations."""
    query = Q()
    stripped_value = value.strip()
    if stripped_value and include_variety:
        query |= Q(variety__icontains=stripped_value)
    for term in build_crop_search_terms(value):
        query |= (
            Q(name_normalized__icontains=term)
            | Q(crop_species__name_normalized__icontains=term)
            | Q(crop_species__scientific_name__icontains=stripped_value)
            | Q(crop_species__translations__common_name_normalized__icontains=term)
            | Q(crop_species__translations__search_text_normalized__icontains=term)
        )
    return query


def build_exact_species_identity_query(normalized_name: str) -> Q:
    """Exact species identity match across canonical names, translations, and aliases."""
    return (
        Q(name_normalized=normalized_name)
        | Q(translations__common_name_normalized=normalized_name)
        | Q(translations__search_text_normalized__icontains=f'\n{normalized_name}\n')
    )


class _WordSimilarity(Func):
    """PostgreSQL ``word_similarity()`` (from the ``pg_trgm`` extension).

    Unlike plain trigram ``similarity()``, this scores a short query against
    the best-matching *substring* of a longer text — exactly what's needed
    here since a species' ``search_text_normalized`` concatenates several
    names (common name, synonyms, regional names) into one field. Requires
    the ``pg_trgm`` extension (enabled by migration ``0017``); the matching
    GIN indexes on ``name_normalized`` / ``search_text_normalized`` make it
    fast but are not required for correctness.
    """

    function = 'word_similarity'
    arity = 2
    output_field = FloatField()


def _score_crop_species(value: str, queryset: QuerySet[CropSpecies]) -> list[tuple[CropSpecies, int, float]]:
    """Rank ``queryset`` against ``value`` by name/translation/synonym match.

    Returns unsorted ``(species, rank, similarity)`` triples, ``rank`` being
    `SPECIES_SEARCH_RANK_EXACT` / `_PREFIX` / 0 (fuzzy-only). "Prefix" here
    also covers the existing alias/plural-aware substring match (regional
    names, "beans" -> "bean", "Paradeiser" -> "Tomate", ...) via
    `build_crop_search_terms` — unchanged from the previous plain-icontains
    search, so a real alias hit always outranks a merely similar-looking
    name. `search_crop_species` applies the minimum-similarity cutoff for
    the rank-0 rows.
    """
    normalized = normalize_text(value) or ''
    if not normalized:
        return []
    search_terms = build_crop_search_terms(value)
    base = queryset.prefetch_related('translations')
    if connection.vendor == 'postgresql':
        return _score_crop_species_postgres(base, normalized, search_terms)
    return _score_crop_species_fallback(base, normalized, search_terms)


def _score_crop_species_postgres(
    base: QuerySet[CropSpecies], normalized: str, search_terms: set[str],
) -> list[tuple[CropSpecies, int, float]]:
    from .models import CropSpeciesTranslation

    translation_similarity = Subquery(
        CropSpeciesTranslation.objects
        .filter(species=OuterRef('pk'))
        .annotate(sim=_WordSimilarity(Value(normalized), F('search_text_normalized')))
        .order_by('-sim')
        .values('sim')[:1],
        output_field=FloatField(),
    )
    # `Exists()` correlated subqueries, not a join on `translations__…` —
    # joining here would multiply a species row per translation, and
    # `.distinct()` cannot safely dedupe rows that carry a differing `rank`
    # annotation depending on which joined translation happened to match.
    translation_exact = Exists(
        CropSpeciesTranslation.objects.filter(
            species=OuterRef('pk'), search_text_normalized__icontains=f'\n{normalized}\n',
        ),
    )
    substring_query = Q(name_normalized__icontains=normalized) | Q(scientific_name__icontains=normalized)
    translation_substring_query = Q(search_text_normalized__icontains=normalized)
    for term in search_terms:
        substring_query |= Q(name_normalized__icontains=term)
        translation_substring_query |= Q(search_text_normalized__icontains=term)
    translation_substring = Exists(
        CropSpeciesTranslation.objects.filter(Q(species=OuterRef('pk')) & translation_substring_query),
    )
    annotated = base.annotate(
        name_similarity=_WordSimilarity(Value(normalized), F('name_normalized')),
        translation_similarity=Coalesce(translation_similarity, Value(0.0)),
        has_translation_exact=translation_exact,
        has_translation_substring=translation_substring,
    ).annotate(
        similarity=Greatest('name_similarity', 'translation_similarity'),
        rank=Case(
            When(Q(name_normalized=normalized) | Q(has_translation_exact=True), then=Value(SPECIES_SEARCH_RANK_EXACT)),
            When(
                substring_query | Q(has_translation_substring=True),
                then=Value(SPECIES_SEARCH_RANK_PREFIX),
            ),
            default=Value(0),
            output_field=IntegerField(),
        ),
    )
    return [(species, species.rank, float(species.similarity)) for species in annotated]


def _score_crop_species_fallback(
    base: QuerySet[CropSpecies], normalized: str, search_terms: set[str],
) -> list[tuple[CropSpecies, int, float]]:
    """Functionally equivalent scoring for backends without ``pg_trgm`` (SQLite in tests/dev).

    Same rank/similarity contract as the PostgreSQL path, computed in Python
    with :func:`difflib.SequenceMatcher` per candidate name instead of
    `word_similarity()`. The species list this runs over is bounded (the
    official species catalogue), so scoring it in Python per request is
    cheap enough that this never needs its own index.
    """
    from difflib import SequenceMatcher

    scored: list[tuple[CropSpecies, int, float]] = []
    for species in base:
        terms = [species.name_normalized]
        for translation in species.translations.all():
            terms.extend(term for term in translation.search_text_normalized.split('\n') if term)
        if not terms:
            continue
        exact = any(term == normalized for term in terms)
        substring = not exact and (
            any(
                needle in term
                for term in terms
                for needle in (normalized, *search_terms)
            )
            or normalized in (species.scientific_name or '').lower()
        )
        similarity = max(SequenceMatcher(None, normalized, term).ratio() for term in terms)
        rank = SPECIES_SEARCH_RANK_EXACT if exact else SPECIES_SEARCH_RANK_PREFIX if substring else 0
        scored.append((species, rank, similarity))
    return scored


def search_crop_species(
    value: str, *, queryset: QuerySet[CropSpecies] | None = None, limit: int = SPECIES_SEARCH_RESULT_LIMIT,
) -> list[CropSpecies]:
    """Typo-tolerant search over official species names, synonyms, and translations.

    Ranked exact matches first, then prefix matches, then by similarity;
    results with neither an exact/prefix hit nor at least
    `MIN_SPECIES_SEARCH_SIMILARITY` are dropped as irrelevant. Backs the
    publishing wizard's "Offizielle Kulturart" field and the moderation
    page's synonym-alias search (both via `CropSpeciesViewSet.list`'s ``q``
    param).
    """
    from .models import CropSpecies

    base = queryset if queryset is not None else CropSpecies.objects.filter(status=CropSpecies.STATUS_PUBLISHED)
    scored = _score_crop_species(value, base)
    normalized_length = len(normalize_text(value) or '')
    fuzzy_allowed = normalized_length >= MIN_SPECIES_SEARCH_FUZZY_QUERY_LENGTH
    filtered = [
        item for item in scored
        if item[1] > 0 or (fuzzy_allowed and item[2] >= MIN_SPECIES_SEARCH_SIMILARITY)
    ]
    filtered.sort(key=lambda item: (-item[1], -item[2], item[0].name))
    return [species for species, _rank, _similarity in filtered[:limit]]


def is_discouraged_public_species(species: CropSpecies) -> bool:
    """Return whether a species is too broad to use as a public mapping target."""
    names = [species.name]
    translations = getattr(species, 'translations', None)
    if translations is not None:
        names.extend(translation.common_name for translation in translations.all())
    return any(
        (normalize_text(name) or '') in DISCOURAGED_PUBLIC_SPECIES_NORMALIZED_NAMES
        for name in names
    )


def public_species_mapping_targets(queryset: QuerySet[CropSpecies]) -> QuerySet[CropSpecies]:
    """Species users may select as concrete public-library mapping targets."""
    from .models import CropSpecies

    return (
        queryset
        .filter(status=CropSpecies.STATUS_PUBLISHED)
        .exclude(name_normalized__in=DISCOURAGED_PUBLIC_SPECIES_NORMALIZED_NAMES)
        .exclude(translations__common_name_normalized__in=DISCOURAGED_PUBLIC_SPECIES_NORMALIZED_NAMES)
        .distinct()
    )


def visible_public_crop_species_query() -> Q:
    """Published public crops stay visible unless their species was rejected."""
    from .models import CropSpecies

    return (
        Q(crop_species__isnull=True)
        | Q(crop_species__status__in=[
            CropSpecies.STATUS_PUBLISHED,
            CropSpecies.STATUS_PROPOSED,
        ])
    )


def list_published_crops(
    *, query: str = '', name: str = '', variety: str = '',
) -> QuerySet[PublicCrop]:
    """Published crops, optionally filtered by a free-text query and/or exact-field substrings.

    Free-text and name search deliberately span **every** stored species
    translation, not just the caller's UI language: searching "Tomato" in a
    German UI must find the "Tomate / Tomato" species. The species
    translations are prefetched in the same round trip that the localized
    display name needs, so the wider search does not turn into an N+1.
    """
    queryset = (
        PublicCrop.objects
        .filter(status=PublicCrop.STATUS_PUBLISHED)
        .filter(visible_public_crop_species_query())
        # `created_by__public_profile` is joined because every serialized row
        # reads `created_by_label`; without it the attribution alone costs two
        # queries per result.
        .select_related('crop_species', 'created_by__public_profile')
        .prefetch_related('crop_species__translations', 'translations')
        .order_by('name', 'variety')
    )

    query = query.strip()
    name = name.strip()
    variety = variety.strip()

    if query:
        queryset = queryset.filter(build_public_crop_search_query(query)).distinct()
    if name:
        queryset = queryset.filter(
            build_public_crop_search_query(name, include_variety=False),
        ).distinct()
    if variety:
        # Variety names are proper names: never translated, matched verbatim.
        queryset = queryset.filter(variety__icontains=variety)
    return queryset


def get_published_crop(pk: int) -> PublicCrop:
    """A single published crop by id.

    Raises `PublicCrop.DoesNotExist` if not found or unpublished.
    """
    return (
        PublicCrop.objects
        .filter(visible_public_crop_species_query())
        .get(pk=pk, status=PublicCrop.STATUS_PUBLISHED)
    )


def _species_matching_name(normalized: str) -> QuerySet[CropSpecies]:
    """Every species reachable by ``normalized``, before any policy filter."""
    from .models import CropSpecies

    return CropSpecies.objects.filter(
        Q(name_normalized=normalized)
        | Q(translations__common_name_normalized=normalized)
        | Q(translations__search_text_normalized__icontains=f'\n{normalized}\n'),
    ).prefetch_related('translations').distinct()


def find_published_species_by_name(name: str | None) -> CropSpecies | None:
    """Any published species this name resolves to, ignoring mapping policy.

    Answers "does the library know this name at all?", which is a different
    question from "may a user map onto it": the discouraged umbrella names
    ("Bohne") are excluded as mapping targets but are part of the library, so
    a coverage audit must not report them as gaps.
    """
    from .models import CropSpecies

    normalized = normalize_text(name)
    if not normalized:
        return None
    return (
        _species_matching_name(normalized)
        .filter(status=CropSpecies.STATUS_PUBLISHED)
        .first()
    )


def find_species_by_common_name(name: str | None) -> CropSpecies | None:
    """The species whose canonical name or *any* translation matches ``name``.

    This is what makes "Tomate" and "Tomato" resolve to one species, so
    matching and duplicate detection can work on the language-independent
    record instead of on whichever name the user happened to type.

    Restricted to species a user may actually map onto — see
    `find_published_species_by_name` when the question is library coverage.
    """
    normalized = normalize_text(name)
    if not normalized:
        return None
    for species in public_species_mapping_targets(_species_matching_name(normalized)):
        if not is_discouraged_public_species(species):
            return species
    return None


def find_exact_crop_match(*, name: str | None, variety: str | None) -> PublicCrop | None:
    """The most recently published crop matching this crop identity, if any.

    Identity is (species, normalized variety) whenever the name resolves to a
    species, so a German and an English spelling of the same species find the
    same entry. Entries published before species links existed are still
    matched on their own normalized name.
    """
    normalized_name = normalize_text(name)
    normalized_variety = normalize_text(variety)
    if not normalized_name or not normalized_variety:
        return None

    queryset = PublicCrop.objects.filter(
        status=PublicCrop.STATUS_PUBLISHED,
        variety_normalized=normalized_variety,
    ).filter(visible_public_crop_species_query())
    species = find_species_by_common_name(name)
    if species is not None:
        queryset = queryset.filter(Q(crop_species=species) | Q(name_normalized=normalized_name))
    else:
        queryset = queryset.filter(name_normalized=normalized_name)

    return (
        queryset
        .only('id', 'name', 'variety', 'published_at')
        .order_by('-published_at', '-id')
        .first()
    )


def notify_species_proposal_reviewed(species: CropSpecies) -> None:
    """Tell the proposing user that a moderator accepted or rejected their species.

    Silently does nothing for species nobody proposed (seeded/admin-created
    rows) and for statuses that are not a review outcome, so callers can invoke
    this unconditionally after a moderation action.

    The notification links to the proposer's own public entry under that
    species when there is one — that variety is what the decision actually
    affects — and falls back to the species itself otherwise.
    """
    from notifications.models import Notification
    from notifications.services import create_notification

    from .models import CropSpecies

    notification_type = {
        CropSpecies.STATUS_PUBLISHED: Notification.TYPE_CROP_SPECIES_PROPOSAL_ACCEPTED,
        CropSpecies.STATUS_REJECTED: Notification.TYPE_CROP_SPECIES_PROPOSAL_REJECTED,
    }.get(species.status)
    if notification_type is None or species.proposed_by is None:
        return

    published_variety = (
        PublicCrop.objects
        .filter(crop_species=species, created_by=species.proposed_by)
        .order_by('-published_at', '-id')
        .values_list('id', flat=True)
        .first()
    )
    accepted = notification_type == Notification.TYPE_CROP_SPECIES_PROPOSAL_ACCEPTED
    try:
        preferred_language = getattr(species.proposed_by.project_settings, 'ui_language', '')
    except Exception:  # noqa: BLE001
        preferred_language = ''
    if preferred_language == 'auto':
        preferred_language = ''
    species_label = species.localized_name(preferred_language, None)[0]
    create_notification(
        recipient=species.proposed_by,
        notification_type=notification_type,
        message=(
            f'Your proposal for the crop species "{species_label}" was '
            f'{"accepted" if accepted else "rejected"}.'
        ),
        context={'name': species_label},
        target_type=(
            Notification.TARGET_PUBLIC_CROP if published_variety
            else Notification.TARGET_CROP_SPECIES
        ),
        target_id=published_variety or species.id,
    )


def remove_public_crops_for_rejected_species(
    species: CropSpecies, moderator: AbstractBaseUser,
) -> None:
    """Withdraw every published entry left under a species a moderator just rejected.

    `CropSpeciesViewSet.reject()` only flips the species' own status — nothing
    stops a variety published *while the species was still under review* from
    staying published afterwards, still carrying the rejected species' name
    (`PublicCrop.display_name()` always defers to the linked species). Left
    alone, a rejected proposal like "Karotsdasdas" keeps showing up in the
    library forever. This closes that gap by running every affected entry
    through the same moderator-removal path as a manual "remove from library"
    action (`farm.services.public_crops.remove_public_crop`), so it's
    non-destructive and shows up in the moderation queue's "removed" table
    with a reason a moderator can see and reverse.

    Imports the removal helper locally rather than at module level: it lives
    in `farm.services.public_crops`, a service module (not a project-scoped
    model or a view/serializer package), and only ever touches `PublicCrop`
    rows — the same model this file already reads/writes elsewhere — so it
    does not cross the "crop library knows nothing about projects" boundary
    documented at the top of this file.

    Also notifies every affected entry's contributor, except the species
    proposer themselves — they already get a species-level notification from
    `notify_species_proposal_reviewed`, so a second one about "their" entry
    would be redundant. A collaborator who published a variety under someone
    else's still-under-review species proposal would otherwise never learn
    their contribution was pulled.
    """
    from farm.services.public_crops import cancel_public_crop_species_relinks, remove_public_crop
    from notifications.models import Notification
    from notifications.services import create_notification

    # A parked "Kulturart korrigieren" correction pointing at this species can
    # never run now; drop it rather than leaving it pending forever.
    cancel_public_crop_species_relinks(crop_species=species)

    affected = PublicCrop.objects.filter(
        crop_species=species, status=PublicCrop.STATUS_PUBLISHED,
    )
    for public_crop in affected:
        remove_public_crop(
            public_crop=public_crop,
            user=moderator,
            reason=PublicCrop.REMOVAL_REASON_SPECIES_REJECTED,
            # A moderator rejecting a species may also be the contributor of
            # one of the affected entries (they proposed and self-published
            # under it) — this is still a moderation action, not a personal
            # withdrawal, so it must always carry the real removal reason.
            force_moderator_reason=True,
        )
        if public_crop.created_by_id and public_crop.created_by_id != species.proposed_by_id:
            create_notification(
                recipient=public_crop.created_by,
                notification_type=Notification.TYPE_PUBLIC_CROP_REMOVED,
                message=(
                    f'Your published crop "{public_crop.name}" was removed from the '
                    f'public library because its crop species "{species.name}" was rejected.'
                ),
                context={'name': public_crop.name, 'species_name': species.name},
                target_type=Notification.TARGET_PUBLIC_CROP,
                target_id=public_crop.id,
            )


def apply_public_crop_species_relinks_for_approved_species(
    species: CropSpecies, moderator: AbstractBaseUser,
) -> None:
    """Finish the crop species corrections that were waiting on this proposal.

    The counterpart of :func:`remove_public_crops_for_rejected_species`, called
    from `CropSpeciesViewSet.approve()`. A moderator correcting an entry's
    mapping onto a species that did not exist yet files the proposal and the
    correction in one action; approving the species has to complete it, or the
    moderator would have to remember to come back and repeat the correction by
    hand.

    Imports the relink service locally for the same reason the rejection
    cleanup does: it lives in `farm.services.public_crops` and only ever
    touches `PublicCrop` rows, so it does not cross the "crop library knows
    nothing about projects" boundary documented at the top of this file.
    """
    from farm.services.public_crops import complete_public_crop_species_relinks

    complete_public_crop_species_relinks(crop_species=species, user=moderator)


def notify_moderators_of_species_proposal(species: CropSpecies) -> None:
    """Tell every public library moderator that a new species proposal is waiting for review.

    Skips the proposer themselves: a moderator proposing their own species
    doesn't need to be told their own submission is waiting for review.
    """
    from notifications.models import Notification
    from notifications.services import create_notification

    from .permissions import public_library_moderator_users

    for recipient in public_library_moderator_users().exclude(pk=species.proposed_by_id):
        create_notification(
            recipient=recipient,
            notification_type=Notification.TYPE_CROP_SPECIES_PROPOSAL_SUBMITTED,
            message=f'A new crop species proposal "{species.name}" is waiting for review.',
            context={'name': species.name},
            target_type=Notification.TARGET_PUBLIC_LIBRARY_MODERATION,
            target_id=species.id,
        )


def notify_admins_of_moderator_request(moderator_request: PublicLibraryModeratorRequest) -> None:
    """Tell every public library admin that a new moderator access request is waiting for review."""
    from notifications.models import Notification
    from notifications.services import create_notification

    from .permissions import public_library_admin_users

    requester = moderator_request.user
    requester_label = (
        (requester.get_full_name() or '').strip()
        or requester.email
        or requester.username
    )
    for recipient in public_library_admin_users():
        create_notification(
            recipient=recipient,
            notification_type=Notification.TYPE_MODERATOR_REQUEST_SUBMITTED,
            message=f'{requester_label} requested public library moderator access.',
            context={'name': requester_label},
            target_type=Notification.TARGET_PUBLIC_LIBRARY_MODERATION,
            target_id=moderator_request.id,
        )
