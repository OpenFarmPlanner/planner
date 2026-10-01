"""Repair general Kultur links written implicitly by a Sorte publish.

Publishing a Sorte used to link the project's general Kultur to the newest
published species-level entry, whoever had created it, and always with the
entry's version as baseline (``link_local_crop_to_owned_public_entry``).
Migration ``0103_link_published_crops_to_owned_entries`` set the same
unconditional baseline for every crop an entry names as its
``source_project_crop``. Both left two kinds of broken rows:

1. **A general Kultur linked to a general entry it does not own** — the
   entry's ``source_project_crop`` is another row (another contributor's
   entry, or the user's own entry from another project). The link is removed
   with exactly the fields ``unlink_crop_from_public_entry`` clears
   (``source_public_crop``, ``source_public_version``,
   ``rejected_public_version``); values, ``origin_type`` and
   ``is_modified_from_source`` stay, and provenance is kept (or recorded) in
   ``derived_from_public_crop`` the same way the unlink does it. Only rows
   with ``origin_type != 'imported'`` qualify: every explicit link ("Mit
   diesem Eintrag verknüpfen", ``link_project_crop_to_public_reference``) and
   every import sets ``origin_type='imported'``, so that is the stored record
   of an explicit link, and such rows stay untouched.

   Conservative choice: the entry's ``created_by`` cannot be compared with
   "the user who published the Sorte", because no row records which user
   triggered the link. An entry whose ``source_project_crop`` *is* this
   general Kultur was necessarily published from this project, so it is
   treated as owned and the link is kept (case 2 may still apply).

2. **A general Kultur linked to its own general entry whose values never
   matched it since the link** — typically the entry
   ``ensure_general_public_crop`` created from the Sorte's values. Its
   ``source_public_version`` is cleared so the pull ("Kultur aktualisieren")
   is offered with the library values preselected instead of a push of values
   nobody edited. The link itself stays.

   "Never matched since the link" is only decided where stored data proves
   it: the baseline is the entry's current version (the entry did not move
   since), the row's compared values differ from the entry now, and the row
   has not changed since that version was created — its ``updated_at`` is
   older than the version's ``PublicCropRevision`` and no project-history
   revision of the row was recorded after it. Then the row's values at link
   time are its current values, which differ from the entry. A row edited
   after the link (a legitimate local change) or a version without a stored
   revision is left unchanged.

The compared fields are frozen here (``CROP_COPY_FIELDS`` minus
``display_color``, and minus ``variety`` against a species-level entry, as of
this migration) so later field changes cannot alter what this repair did.

Counts per case are logged. Reverse is a no-op: the removed links and
baselines were wrong, and rebuilding them would reintroduce the defect.
"""

import logging
from typing import Any

from django.db import migrations

logger = logging.getLogger(__name__)

GENERAL_KULTUR_COMPARED_FIELDS = (
    'name',
    'notes',
    'crop_family',
    'nutrient_demand',
    'cultivation_types',
    'cultivation_type',
    'growth_duration_days',
    'harvest_duration_days',
    'propagation_duration_days',
    'harvest_method',
    'expected_yield',
    'distance_within_row_m',
    'row_spacing_m',
    'sowing_depth_m',
    'seed_rate_value',
    'seed_rate_unit',
    'seed_rate_by_cultivation',
    'thousand_kernel_weight_g',
    'seeding_requirement',
    'seeding_requirement_type',
)


def _compared_value(instance: Any, field: str) -> Any:
    value = getattr(instance, field)
    if field == 'cultivation_types':
        return list(value or [])
    if field == 'seed_rate_by_cultivation':
        return value or None
    return value


def _differs_from_entry(crop: Any, entry: Any) -> bool:
    return any(
        _compared_value(crop, field) != _compared_value(entry, field)
        for field in GENERAL_KULTUR_COMPARED_FIELDS
    )


def _current_version_created_at(public_crop_revision_model: Any, entry: Any) -> Any:
    revision = (
        public_crop_revision_model.objects
        .filter(public_crop_id=entry.pk, version=entry.version)
        .order_by('-created_at', '-id')
        .first()
    )
    return revision.created_at if revision is not None else None


def _unchanged_since(entity_revision_model: Any, crop: Any, moment: Any) -> bool:
    if crop.updated_at is None or crop.updated_at >= moment:
        return False
    return not entity_revision_model.objects.filter(
        entity_type='crop',
        object_id=crop.pk,
        created_at__gte=moment,
    ).exists()


def repair_general_kultur_links(apps, schema_editor):
    Crop = apps.get_model('farm', 'Crop')
    PublicCropRevision = apps.get_model('farm', 'PublicCropRevision')
    EntityRevision = apps.get_model('farm', 'EntityRevision')

    linked_general_kulturen = (
        Crop._base_manager
        .filter(
            variety_normalized__isnull=True,
            source_public_crop__isnull=False,
            source_public_crop__variety_normalized='',
        )
        .exclude(origin_type='imported')
        .select_related('source_public_crop')
        .order_by('pk')
    )
    unlinked = 0
    baselines_cleared = 0
    for crop in linked_general_kulturen.iterator():
        entry = crop.source_public_crop
        if entry.source_project_crop_id != crop.pk:
            Crop._base_manager.filter(pk=crop.pk).update(
                source_public_crop=None,
                source_public_version=None,
                rejected_public_version=None,
                derived_from_public_crop_id=crop.derived_from_public_crop_id or entry.pk,
            )
            unlinked += 1
            continue
        if (
            entry.status != 'published'
            or crop.source_public_version != entry.version
            or not _differs_from_entry(crop, entry)
        ):
            continue
        version_created_at = _current_version_created_at(PublicCropRevision, entry)
        if version_created_at is None:
            continue
        if not _unchanged_since(EntityRevision, crop, version_created_at):
            continue
        Crop._base_manager.filter(pk=crop.pk).update(source_public_version=None)
        baselines_cleared += 1

    logger.info(
        'Repaired general Kultur library links: %d foreign links removed, %d baselines cleared.',
        unlinked,
        baselines_cleared,
    )


class Migration(migrations.Migration):

    dependencies = [
        ('farm', '0109_crop_derived_from_public_crop'),
    ]

    operations = [
        migrations.RunPython(repair_general_kultur_links, migrations.RunPython.noop),
    ]
