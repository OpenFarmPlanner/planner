"""Project-scoped variety color reset and recovery."""

from datetime import timedelta

from django.core import signing
from django.db import transaction

from farm.history.records import HISTORY_RETENTION_DAYS, revision_actor
from farm.models import Crop
from farm.services.crop_inheritance import lock_crop_project

_RESET_SALT = 'farm.crop-color-reset'


class CropColorResetConflict(Exception):
    """The intended selection or the saved undo state no longer matches."""


def _selected_varieties(project_id: int, crop_ids: set[int]) -> list[Crop]:
    crops = list(Crop.objects.select_for_update().filter(
        project_id=project_id, pk__in=crop_ids, variety_normalized__isnull=False,
    ).order_by('pk'))
    if len(crops) != len(crop_ids):
        raise CropColorResetConflict
    return crops


@transaction.atomic
def reset_variety_colors(project_id: int, crop_ids: set[int], user) -> dict:
    lock_crop_project(project_id)
    varieties = _selected_varieties(project_id, crop_ids)
    changes = []
    with revision_actor(user):
        for crop in varieties:
            if crop.display_color:
                previous = crop.display_color
                crop.display_color = ''
                crop.save(update_fields={'display_color', 'updated_at'})
                changes.append((crop.pk, previous, crop.updated_at.isoformat()))

    undo_token = signing.dumps(
        {'project': project_id, 'actor': user.pk, 'changes': changes},
        salt=_RESET_SALT, compress=True,
    ) if changes else None
    return {'updated_count': len(changes), 'undo_token': undo_token}


@transaction.atomic
def undo_variety_color_reset(project_id: int, undo_token: str, user) -> int:
    try:
        reset = signing.loads(
            undo_token, salt=_RESET_SALT, max_age=timedelta(days=HISTORY_RETENTION_DAYS),
        )
    except signing.BadSignature as error:
        raise CropColorResetConflict from error
    if reset['project'] != project_id or reset['actor'] != user.pk:
        raise CropColorResetConflict

    lock_crop_project(project_id)
    changes = {crop_id: (color, updated_at) for crop_id, color, updated_at in reset['changes']}
    varieties = _selected_varieties(project_id, set(changes))
    if any(
        crop.display_color or crop.updated_at.isoformat() != changes[crop.pk][1]
        for crop in varieties
    ):
        raise CropColorResetConflict

    with revision_actor(user):
        for crop in varieties:
            crop.display_color = changes[crop.pk][0]
            crop.save(update_fields={'display_color', 'updated_at'})
    return len(varieties)
