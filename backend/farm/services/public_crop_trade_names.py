"""Trade names of public-library varieties: identity lookups, edits and reports.

A trade name is a lookup key into a variety's identity, never part of it: the
identity stays the ``PublicCrop`` row (species plus original ``variety``).
These helpers let duplicate detection, search and identity conflict checks
treat ``Poire jaune`` as ``Gelbe Birne`` once that trade name is recorded.
See docs/rfc-variety-trade-names.md.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Iterable

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from farm.models import PublicCrop, PublicCropReport, PublicCropTradeName, PublicCropTradeNameEvent
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


class TradeNameError(Exception):
    """A trade-name edit, revert or report that cannot be applied as asked."""

    code = 'trade_name_invalid'

    def __init__(self, detail: str, *, code: str | None = None) -> None:
        super().__init__(detail)
        self.detail = detail
        if code is not None:
            self.code = code


class TradeNameConflictError(TradeNameError):
    """The name already identifies another entry of the same species."""

    code = 'trade_name_conflict'

    def __init__(self, *, language_code: str, conflicting_public_crop: PublicCrop) -> None:
        super().__init__(
            'This trade name already identifies another entry of the same crop species.',
        )
        self.language_code = language_code
        self.conflicting_public_crop = conflicting_public_crop


class TradeNameEditConflictError(TradeNameError):
    """Someone changed this language since the editor loaded it."""

    code = 'trade_name_edit_conflict'

    def __init__(self, *, language_code: str, current: PublicCropTradeName | None) -> None:
        super().__init__('This trade name has changed since it was loaded.')
        self.language_code = language_code
        self.current_name = current.name if current is not None else None


def _origin_api_flag(user: AbstractBaseUser | None, origin_api: bool) -> bool:
    return bool(origin_api and user is not None and user.is_authenticated)


def _apply_trade_name(
    *,
    public_crop: PublicCrop,
    language_code: str,
    current: PublicCropTradeName | None,
    value: dict[str, str] | None,
    user: AbstractBaseUser | None,
    action: str,
    origin_api: bool,
    reverted_event: PublicCropTradeNameEvent | None = None,
) -> PublicCropTradeNameEvent | None:
    """Set or remove one language's trade name; ``None`` when nothing changed."""
    name = ' '.join(((value or {}).get('name') or '').split())
    source_url = ((value or {}).get('source_url') or '').strip()
    if not name:
        if current is None:
            return None
        if action == PublicCropTradeNameEvent.ACTION_SET:
            action = PublicCropTradeNameEvent.ACTION_REMOVED
        event = record_trade_name_event(
            public_crop=public_crop, language_code=language_code, action=action,
            old=current, new=None, user=user, origin_api=origin_api, reverted_event=reverted_event,
        )
        current.delete()
        return event

    if normalize_search_text(name) == normalize_search_text(public_crop.variety):
        raise TradeNameError(
            'A trade name must differ from the original variety name.',
            code='trade_name_equals_original',
        )
    if current is not None and current.name == name and current.source_url == source_url:
        return None
    conflict = find_trade_name_conflict(public_crop, name)
    if conflict is not None:
        raise TradeNameConflictError(language_code=language_code, conflicting_public_crop=conflict)

    previous = (
        {'name': current.name, 'source_url': current.source_url} if current is not None else None
    )
    actor = user if user is not None and user.is_authenticated else None
    if current is None:
        current = PublicCropTradeName(
            public_crop=public_crop, language_code=language_code, created_by=actor,
        )
    current.name = name
    current.source_url = source_url
    current.updated_by = actor
    current.save()
    return record_trade_name_event(
        public_crop=public_crop, language_code=language_code, action=action,
        old=previous, new=current, user=user, origin_api=origin_api, reverted_event=reverted_event,
    )


def _lock_variety_entry(public_crop: PublicCrop) -> PublicCrop:
    locked = PublicCrop.objects.select_for_update().get(pk=public_crop.pk)
    if not (locked.variety or '').strip():
        raise TradeNameError(
            'Only variety entries carry trade names; name a crop species through its synonyms.',
            code='trade_name_general_entry',
        )
    return locked


def replace_trade_names(
    *,
    public_crop: PublicCrop,
    user: AbstractBaseUser | None,
    trade_names: dict[str, dict[str, str] | None],
    expected: dict[str, str | None] | None = None,
    origin_api: bool = False,
) -> list[PublicCropTradeNameEvent]:
    """Upsert or remove the trade names of the given languages.

    Languages left out are untouched, the same rule as description
    translations, so a sync job that only knows French never wipes Spanish. A
    blank or null value removes that language. ``expected`` maps a language
    to the name the editor last saw (``None`` for "none"); a mismatch raises
    :class:`TradeNameEditConflictError` instead of silently overwriting
    someone else's edit. All languages apply or none do.
    """
    origin_api = _origin_api_flag(user, origin_api)
    with transaction.atomic():
        locked = _lock_variety_entry(public_crop)
        current_by_language = {
            row.language_code: row
            for row in PublicCropTradeName.objects.filter(public_crop=locked)
        }
        for language_code, expected_name in (expected or {}).items():
            current = current_by_language.get(language_code)
            if (current.name if current is not None else None) != (expected_name or None):
                raise TradeNameEditConflictError(language_code=language_code, current=current)
        events = []
        for language_code, value in trade_names.items():
            event = _apply_trade_name(
                public_crop=locked,
                language_code=language_code,
                current=current_by_language.get(language_code),
                value=value,
                user=user,
                action=PublicCropTradeNameEvent.ACTION_SET,
                origin_api=origin_api,
            )
            if event is not None:
                events.append(event)
        return events


def revert_trade_name_event(
    *,
    public_crop: PublicCrop,
    event_id: int,
    user: AbstractBaseUser | None,
) -> PublicCropTradeNameEvent | None:
    """Restore the value a history event replaced, as a new ``reverted`` event.

    Returns ``None`` when that value is already current. The restored name
    passes the same checks as a fresh edit, so a revert can never reintroduce
    a duplicate that appeared since.
    """
    with transaction.atomic():
        locked = _lock_variety_entry(public_crop)
        event = PublicCropTradeNameEvent.objects.filter(public_crop=locked, pk=event_id).first()
        if event is None:
            raise TradeNameError(
                'This history entry does not exist.', code='trade_name_event_not_found',
            )
        current = PublicCropTradeName.objects.filter(
            public_crop=locked, language_code=event.language_code,
        ).first()
        return _apply_trade_name(
            public_crop=locked,
            language_code=event.language_code,
            current=current,
            value={'name': event.old_name, 'source_url': event.old_source_url},
            user=user,
            action=PublicCropTradeNameEvent.ACTION_REVERTED,
            origin_api=False,
            reverted_event=event,
        )


def report_trade_name(
    *,
    public_crop: PublicCrop,
    user: AbstractBaseUser,
    language_code: str,
    reason: str,
    note: str = '',
) -> tuple[PublicCropReport, bool]:
    """Record a report on one language's trade name; ``(report, created)``.

    A user has at most one open report per entry and language: reporting the
    same name again updates the note and reason instead of adding noise to the
    moderators' queue. The report never hides the name — moderators decide.
    """
    current = PublicCropTradeName.objects.filter(
        public_crop=public_crop, language_code=language_code,
    ).first()
    if current is None:
        raise TradeNameError(
            'There is no trade name in this language to report.',
            code='trade_name_not_found',
        )
    report, created = PublicCropReport.objects.update_or_create(
        public_crop=public_crop,
        subject=PublicCropReport.SUBJECT_TRADE_NAME,
        language_code=language_code,
        reported_by=user,
        status=PublicCropReport.STATUS_OPEN,
        defaults={'reason': reason, 'note': note, 'reported_name': current.name},
    )
    if created:
        notify_moderators_of_trade_name_report(report)
    return report, created


def resolve_public_crop_report(
    *,
    report: PublicCropReport,
    user: AbstractBaseUser,
    status: str,
    note: str = '',
) -> PublicCropReport:
    """Close an open report as ``resolved`` (acted on) or ``dismissed``."""
    if report.status != PublicCropReport.STATUS_OPEN:
        raise TradeNameError('Only open reports can be resolved.', code='report_not_open')
    if status not in {PublicCropReport.STATUS_RESOLVED, PublicCropReport.STATUS_DISMISSED}:
        raise TradeNameError('Unsupported report resolution.', code='report_status_invalid')
    report.status = status
    report.resolution_note = note
    report.resolved_by = user
    report.resolved_at = timezone.now()
    report.save(
        update_fields=['status', 'resolution_note', 'resolved_by', 'resolved_at', 'updated_at'],
    )
    return report


def notify_moderators_of_trade_name_report(report: PublicCropReport) -> None:
    """Tell every public library moderator that a trade name was reported."""
    from crops.permissions import public_library_moderator_users
    from notifications.models import Notification
    from notifications.services import create_notification

    public_crop = report.public_crop
    for recipient in public_library_moderator_users().exclude(pk=report.reported_by_id):
        create_notification(
            recipient=recipient,
            notification_type=Notification.TYPE_PUBLIC_CROP_TRADE_NAME_REPORTED,
            message=(
                f'The trade name "{report.reported_name}" of "{public_crop.variety}" was reported.'
            ),
            context={
                'name': report.reported_name,
                'variety': public_crop.variety,
                'language_code': report.language_code,
            },
            target_type=Notification.TARGET_PUBLIC_CROP,
            target_id=public_crop.id,
        )
