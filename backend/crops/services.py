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

from django.db.models import Q, QuerySet

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


def build_species_search_query(value: str) -> Q:
    """Build a search query for official crop species and translations."""
    query = Q()
    stripped_value = value.strip()
    if stripped_value:
        query |= (
            Q(name__icontains=stripped_value)
            | Q(scientific_name__icontains=stripped_value)
            | Q(translations__common_name__icontains=stripped_value)
        )
    for term in build_crop_search_terms(value):
        query |= (
            Q(name_normalized__icontains=term)
            | Q(translations__common_name_normalized__icontains=term)
            | Q(translations__search_text_normalized__icontains=term)
        )
    return query


def build_exact_species_identity_query(normalized_name: str) -> Q:
    """Exact species identity match across canonical names, translations, and aliases."""
    return (
        Q(name_normalized=normalized_name)
        | Q(translations__common_name_normalized=normalized_name)
        | Q(translations__search_text_normalized__icontains=f'\n{normalized_name}\n')
    )


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
    from farm.services.public_crops import remove_public_crop
    from notifications.models import Notification
    from notifications.services import create_notification

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
