"""Trade names of public-library varieties: identity lookups and invariants.

A trade name is a lookup key into a variety's identity, never part of it: the
identity stays the ``PublicCrop`` row (species plus original ``variety``).
These helpers let duplicate detection, search and identity conflict checks
treat ``Poire jaune`` as ``Gelbe Birne`` once that trade name is recorded.
See docs/rfc-variety-trade-names.md.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Iterable

from django.db.models import Q

from farm.models import PublicCrop, PublicCropTradeName, PublicCropTradeNameEvent
from farm.utils import normalize_search_text

if TYPE_CHECKING:
    from django.contrib.auth.models import AbstractBaseUser


def _normalize_identity_variety(value: str | None) -> str:
    """Same shallow form as ``PublicCrop.variety_normalized``."""
    return ' '.join((value or '').split()).lower()


def variety_identity_query(value: str | None) -> Q:
    """Entries whose variety *is* ``value``: by original name or by any trade name.

    The original is compared like ``variety_normalized`` always was; trade
    names are compared in their search-folded form, so ``Coeur de boeuf``
    finds the trade name ``Cœur de bœuf``. Callers must apply ``.distinct()``
    because the trade-name branch joins.
    """
    query = Q(variety_normalized=_normalize_identity_variety(value))
    folded = normalize_search_text(value)
    if folded:
        query |= Q(trade_names__name_normalized=folded)
    return query


def variety_search_query(value: str) -> Q:
    """Substring match on the original variety or any trade name, in every language."""
    query = Q(variety__icontains=value)
    folded = normalize_search_text(value)
    if folded:
        query |= Q(trade_names__name_normalized__icontains=folded)
    return query


def matched_trade_name(public_crop: PublicCrop, value: str | None) -> dict[str, str] | None:
    """The trade name through which ``value`` identifies ``public_crop``, if any.

    ``None`` when ``value`` is the entry's original name (or no trade name of
    it matches), so the caller can tell the user "*Poire jaune* is the French
    trade name of this variety" only when that is actually what happened.
    """
    if public_crop.variety_normalized == _normalize_identity_variety(value):
        return None
    folded = normalize_search_text(value)
    for trade_name in public_crop.trade_names.all():
        if trade_name.name_normalized == folded:
            return {'language_code': trade_name.language_code, 'name': trade_name.name}
    return None


def _species_scope_query(public_crop: PublicCrop, crop_species_id: int | None) -> Q:
    if crop_species_id:
        return Q(crop_species_id=crop_species_id) | Q(
            crop_species__isnull=True, name_normalized=public_crop.name_normalized,
        )
    return Q(name_normalized=public_crop.name_normalized)


def find_variety_identity_conflict(
    public_crop: PublicCrop,
    *,
    names: Iterable[str],
    crop_species_id: int | None,
) -> PublicCrop | None:
    """Another published entry of the same species that one of ``names`` identifies."""
    identity = Q(pk__in=[])
    for name in names:
        if (name or '').strip():
            identity |= variety_identity_query(name)
    return (
        PublicCrop.objects
        .filter(status=PublicCrop.STATUS_PUBLISHED)
        .filter(_species_scope_query(public_crop, crop_species_id))
        .filter(identity)
        .exclude(pk=public_crop.pk)
        .distinct()
        .order_by('-published_at', '-id')
        .first()
    )


def find_trade_name_conflict(public_crop: PublicCrop, name: str) -> PublicCrop | None:
    """The entry a new trade name ``name`` on ``public_crop`` would collide with.

    A collision with another entry's original name means the two are
    duplicates; with another entry's trade name it would make the name
    ambiguous. Either way a person has to decide, so the save is refused.
    """
    return find_variety_identity_conflict(
        public_crop, names=[name], crop_species_id=public_crop.crop_species_id,
    )


def prune_trade_names_for_variety(
    public_crop: PublicCrop,
    *,
    user: AbstractBaseUser | None,
    origin_api: bool = False,
) -> list[str]:
    """Drop trade names that the entry's current variety makes invalid.

    Called after a variety rename, restore or relink. A species-level entry
    (blank variety) carries no trade names at all, and a trade name equal to
    the (new) original name would only render as ``X (X)``. Every removal is
    recorded so the history explains where the name went. Returns the removed
    language codes.
    """
    removed: list[str] = []
    is_general_entry = not (public_crop.variety or '').strip()
    folded_original = normalize_search_text(public_crop.variety)
    for trade_name in list(PublicCropTradeName.objects.filter(public_crop=public_crop)):
        if not is_general_entry and trade_name.name_normalized != folded_original:
            continue
        record_trade_name_event(
            public_crop=public_crop,
            language_code=trade_name.language_code,
            action=PublicCropTradeNameEvent.ACTION_REMOVED,
            old=trade_name,
            new=None,
            user=user,
            origin_api=origin_api,
        )
        trade_name.delete()
        removed.append(trade_name.language_code)
    return removed


def record_trade_name_event(
    *,
    public_crop: PublicCrop,
    language_code: str,
    action: str,
    old: PublicCropTradeName | dict[str, Any] | None,
    new: PublicCropTradeName | dict[str, Any] | None,
    user: AbstractBaseUser | None,
    origin_api: bool = False,
    reverted_event: PublicCropTradeNameEvent | None = None,
) -> PublicCropTradeNameEvent:
    """Append one history row; ``old``/``new`` are a stored row, a dict, or None."""

    def _value(item: PublicCropTradeName | dict[str, Any] | None, field: str) -> str:
        if item is None:
            return ''
        if isinstance(item, dict):
            return item.get(field) or ''
        return getattr(item, field) or ''

    return PublicCropTradeNameEvent.objects.create(
        public_crop=public_crop,
        language_code=language_code,
        action=action,
        old_name=_value(old, 'name'),
        new_name=_value(new, 'name'),
        old_source_url=_value(old, 'source_url'),
        new_source_url=_value(new, 'source_url'),
        reverted_event=reverted_event,
        origin_api=origin_api,
        created_by=user if user is not None and user.is_authenticated else None,
    )
