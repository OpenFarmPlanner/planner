# Versioning and History (`EntityRevision`)

OpenFarmPlanner keeps an audit trail and supports restoring crops and
whole projects to a past point in time. This is **snapshot-based**, not
event-sourced: each history row is a full point-in-time copy of one
entity's fields, not a delta to replay.

## The model

`EntityRevision` (`backend/farm/models/history.py`) is the current, generic
mechanism: one row per `(entity_type, object_id)` per mutation
(`created` / `updated` / `deleted` / `restored`), holding a full JSON
`snapshot` of the entity's fields at that moment plus a `changed_fields`
list for diff display. It replaced two now-deprecated models:

- `CropRevision` — the original crop-only history table.
- `ProjectRevision` — snapshotted the *entire project* as one JSON blob per
  mutation, which didn't scale as projects grew.

Both are retained only so existing rows can drain via the `cleanup_history`
management command — **no new rows are written to either**. If you're
adding history for a new entity type, extend `EntityRevision`, not the old
models.

Why per-entity instead of per-project: write cost now scales with the size
of the single changed entity, not with the size of the whole project, since
every mutation only writes one small `EntityRevision` row rather than
re-serializing everything the project contains.

## Writing revisions

`record_entity_revision(...)` (`backend/farm/history/records.py`) is the single
write path — it just creates an `EntityRevision` row. It's called:

- **Automatically** inside `Crop.save()` on every create/update, so
  crop history requires no explicit call from view code.
- **Explicitly** from view code for other mutation paths (soft-delete,
  restore, project-level restore) — look for `crop._history_action = ...`
  assignments before `.save()` calls in the farm domain view packages; this is
  how a save is tagged as a delete/restore action rather than a plain
  update for history purposes.
- **Through `ProjectRevisionMixin`** (`backend/farm/common/mixins.py`) for the
  project-scoped viewsets: its `record_revision` helper wraps
  `record_entity_revision` with the active project and actor, and its default
  `perform_update`/`perform_destroy` record the revision for a plain PATCH/PUT
  or DELETE. A viewset only overrides those hooks when it needs something extra
  (additional `save()` kwargs, `IntegrityError` mapping, a soft-delete
  `destroy`); `perform_create` is always per-viewset because `ProjectScopedMixin`
  precedes the revision mixin in the MRO and owns that hook.

## Reading history

- `GlobalHistoryListView` (`GET`, crop-only) and `ProjectHistoryListView`
  (`GET`, all entity types) return the last 30 days of revisions for the
  active project. `GlobalHistoryListView` additionally computes a
  human-readable diff (`_build_entity_revision_changes`) between each
  revision's snapshot and the *previous* revision for the same object,
  skipping internal/denormalized fields (`id`, timestamps, `project_id`,
  `*_normalized` fields, ...). That entry shape — including the diff — is
  built by `build_crop_history_payload` (`backend/farm/history/payloads.py`),
  shared with the per-crop `GET /api/crops/{id}/history/` endpoint; the global
  list passes `label_crop_in_summary=True` because its entries span crops.
- Both crop restore endpoints (`POST /api/crops/{id}/restore/` and
  `POST /api/history/global/restore/`) write a snapshot back through
  `restore_crop_from_revision` (`backend/farm/history/restore.py`), which
  skips `id`/`created_at`/`updated_at` and clears `deleted_at`, so restoring an
  old version keeps the row's identity and undeletes it in one step.
- On the frontend this surfaces as the per-crop/global history **dialog**
  on `Crops.tsx` (see
  [datagrid-architecture.md](./datagrid-architecture.md#row-history--versioning--not-a-grid-feature))
  and as the project version-history dialog
  (`frontend/src/navigation/ProjectHistoryDialog.tsx`, opened from the global
  menu / command palette). Loading those entries and both undo paths —
  restoring one version and reverting a whole batch — live in
  `frontend/src/navigation/useProjectHistory.ts`; `RootLayout` only mounts the
  two dialogs. Both undo paths reload the page afterwards, because a restore
  rewrites rows every open screen may already be showing.

## Batch operations (grouping a cascade)

A single user action can cascade into many entity mutations — deleting a
season also deletes every planting plan in it. `BatchOperation`
(`backend/farm/models/history.py`) groups the resulting revisions so the
history shows them as **one entry with a single "rückgängig machen"** instead
of a dozen unrelated "planting plan deleted" rows.

- `start_batch_operation(project=, operation_type=, context=, user_name=)`
  (`backend/farm/history/records.py`) creates the group; pass the returned
  instance as `batch_operation=` to every `record_entity_revision` /
  `record_revision` call the action makes. `context` is free-form JSON the
  frontend uses to phrase the summary (e.g. `{"season_label": "25/26"}`).
- `EntityRevision.batch_operation` is a nullable `SET_NULL` FK — ordinary
  single-entity edits leave it NULL and render flat with "Version
  wiederherstellen" (whole-project point-in-time restore).
- Wired in `SeasonViewSet`: `season_create`, `season_delete`,
  `season_undelete`, `season_copy_data`. Reuse the helper for any future
  cascade — no schema change, just a new `operation_type` constant + a
  frontend label in `BATCH_OPERATION_BASE_KEYS`.
- `ProjectHistoryListView` folds revisions sharing a `batch_operation` into
  one `is_batch` payload entry (still carrying the members in `children`, used
  only for the summary counts). `ProjectHistoryDialog` renders it as one row.
- **Revert:** every batch entry (including a `batch_reverted` one) shows the
  same "Version wiederherstellen" button. `BatchOperationRevertView` →
  `revert_batch_operation` (`restore.py`) undoes the whole batch — every entity
  goes back to its state *just before* the batch (`created` → deleted,
  `deleted` → recreated, `updated`/`restored` → rolled back to the prior
  revision), grouped under a new `batch_reverted` batch. It is idempotent and
  composes: reverting a `batch_reverted` batch re-applies the original action.
- `cleanup_history` drops `BatchOperation` rows older than the cutoff once
  all their revisions have been pruned.

## Restoring

Two restore paths, both admin-only (`require_project_admin`):

- **`GlobalHistoryRestoreView`** restores a *single crop* from one of its
  own past revisions: copies every allowed field from that revision's
  snapshot onto the (possibly soft-deleted — looked up via
  `Crop.all_objects`, not the default manager) crop row, clears
  `deleted_at`, and saves with `_history_action = ACTION_RESTORED`.
- **`ProjectHistoryRestoreView`** rolls the *whole project* back to the
  clicked revision's timestamp (`_restore_project_state_at`). It works purely
  through recorded revisions and **never mass-deletes**:
  - `_entity_states_at(project, entity_type, target_time)` gives, per
    `object_id`, the most recent revision at or before `target_time` — a
    snapshot, or `None` if it was deleted by then.
  - **Phase 1 (reverse dependency order):** delete only the rows whose state
    is `None` (history positively records them as deleted by then).
  - **Phase 2 (forward order):** every tracked row that existed at
    `target_time` is `UPDATE`d in place to its snapshot (bypassing
    `Model.save()`), or recreated with `bulk_create` if it had been deleted.
    A row whose restorable parent wasn't restored is skipped; a dangling
    nullable non-restorable FK is nulled; snapshot fields the model has since
    dropped are ignored.
  - **Left untouched:** rows with no revision at all — the auto
    `"Hauptstandort"` default
    (`ProjectScopedMixin.ensure_active_project_location`), demo-seeder rows
    (`demo_project.py` uses plain `Model.objects.create`), pre-history data —
    **and** entities merely *created after* `target_time`. Recovering old
    state is the goal, not perfectly un-creating everything newer; the
    alternative (deleting them) cascade-wiped untracked planting plans and
    once emptied a demo project.
  - `_bulk_create_skipping_conflicts` recreates newest-`object_id`-first and,
    if an insert hits a (possibly partial) unique constraint — two stale
    snapshots that both look "active" because one entity was hard-deleted
    without an `ACTION_DELETED` revision — falls back to per-row inserts that
    skip the losers.
  - Records one `EntityRevision` (`entity_type='project'`, `ACTION_RESTORED`).

## What to check before changing this

- A new project-scoped model that should take part in whole-project restore
  goes in `_RESTORABLE_ENTITY_TYPES` (`backend/farm/history/records.py`), in
  FK-dependency order, and needs something calling `record_entity_revision`
  for it — being project-scoped alone gives no history.
- Don't write new rows to `CropRevision`/`ProjectRevision` — they're
  drain-only.
- Remember `EntityRevision.object_id` is a plain integer, not a real FK —
  there's no DB-level referential-integrity guarantee tying a revision back
  to its live entity table; this is an intentional generic-relation-like
  pattern, not an oversight.

## What participates in whole-project restore

`_RESTORABLE_ENTITY_TYPES` (`backend/farm/history/records.py`) is an ordered
list — parents before children, because restore deletes in reverse order and
recreates in forward order:

`Location` → `Field` → `Bed` → `BedLayout` → `FieldLayout` → `Supplier` →
`Crop` → `Season` → `PlantingPlan` → `Task` → `NoteAttachment`.

Three more entity types get revision rows but are **not** part of
whole-project restore (they are in `_ENTITY_TYPE_LABELS` only):
`MediaFile`, `SeedPackage`, and `CropSupplierData`. Read the list in the
source before relying on it — this is the kind of thing a new model silently
misses.

Public crop-library entries have their **own**, separate version history
(`PublicCropRevision`, see
[crop-library-architecture.md](./crop-library-architecture.md)). They are not
project-scoped and never take part in project restore.
