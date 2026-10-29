"""Per-user state of the contextual "how to edit a table cell" hint.

The hint is shared by every inline-editing table, so one flag and one counter
cover all of them, on every device of the user.
"""
from __future__ import annotations

from typing import Literal, TypedDict

from django.contrib.auth.models import AbstractBaseUser
from django.db import transaction

from .models import UserProjectSettings

TABLE_EDIT_HINT_MAX_SHOWN = 3

TableEditHintEvent = Literal['shown', 'edited', 'dismissed']
TABLE_EDIT_HINT_EVENTS: tuple[TableEditHintEvent, ...] = ('shown', 'edited', 'dismissed')


class TableEditHintState(TypedDict):
    done: bool
    shown_count: int


def serialize_table_edit_hint(settings_row: UserProjectSettings | None) -> TableEditHintState:
    """Return the hint state for the API; a user without settings has never seen it."""
    if settings_row is None:
        return {'done': False, 'shown_count': 0}
    return {
        'done': settings_row.table_edit_hint_done,
        'shown_count': settings_row.table_edit_hint_shown_count,
    }


def record_table_edit_hint_event(
    user: AbstractBaseUser,
    event: TableEditHintEvent,
) -> TableEditHintState:
    """Apply one hint event and return the new state.

    ``shown`` counts a display and retires the hint after the last allowed
    one; ``edited`` (the user started an edit the spreadsheet way) and
    ``dismissed`` (the close button) retire it at once. The row is locked so
    two tabs reporting at the same time cannot lose a count.
    """
    with transaction.atomic():
        settings_row, _created = (
            UserProjectSettings.objects.select_for_update().get_or_create(user=user)
        )
        if not settings_row.table_edit_hint_done:
            if event == 'shown':
                settings_row.table_edit_hint_shown_count = min(
                    settings_row.table_edit_hint_shown_count + 1,
                    TABLE_EDIT_HINT_MAX_SHOWN,
                )
                settings_row.table_edit_hint_done = (
                    settings_row.table_edit_hint_shown_count >= TABLE_EDIT_HINT_MAX_SHOWN
                )
            else:
                settings_row.table_edit_hint_done = True
            settings_row.save(
                update_fields=['table_edit_hint_done', 'table_edit_hint_shown_count', 'updated_at'],
            )
    return serialize_table_edit_hint(settings_row)
