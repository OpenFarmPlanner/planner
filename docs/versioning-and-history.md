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
- **Explicitly** at the end of crop-library operations that write project
  fields through a queryset. Publish, link, copy, sync, import, decline and
  species correction capture the final link, baseline, divergence, rejection
  and species fields as applicable. The project's crop revision follows any
  internal revisions for sibling crops, seed packages and library companions.
  A moderator's library action establishes a baseline in the affected project
  when needed. Project history uses the moderator's public display name when
  available and a library moderation label otherwise.
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
  Stored species, supplier, seed-demand supplier and image references are
  restored using their IDs. Supplier and image records must belong to the
  crop's project and the image must still exist in storage. An unavailable
  reference or conflicting crop identity returns 409 before any crop or
  history changes. Restoring an image clears its orphan marker in the same
  transaction and marks the replaced image if no active crop uses it. Crop
  edits, deletion, undelete and orphan cleanup use the same project lock.
- Crop, project, and batch restores use the same legacy crop defaults for
  existing and recreated rows. Old germination flags map to the current
  requirement fields, missing ranges are unset, and snapshots from before seed
  type and species-specific properties restore a blank seed type and `{}`.
  Missing site requirements, life cycle and pest notes restore to their blank
  migration defaults. Fields explicitly recorded in a current snapshot retain
  their historical values. Selective import undo uses those defaults to check
  whether a crop has changed since its import.
- On the frontend this surfaces as the per-crop/global history **dialog**
  on `Crops.tsx` (see
  [datagrid-architecture.md](./datagrid-architecture.md#row-history--versioning--not-a-grid-feature))
  and as the project version-history dialog
  (`frontend/src/navigation/ProjectHistoryDialog.tsx`, opened from the global
  menu / command palette). Loading those entries and both undo paths —
  restoring one version and reverting a whole batch — live in
  `frontend/src/navigation/useProjectHistory.ts`; `RootLayout` only mounts the
  history and confirmation dialogs. Both undo paths reload the page afterwards, because a restore
  rewrites rows every open screen may already be showing.

## Grouped operations and imports

`BatchOperation` groups one logical action while retaining granular
`EntityRevision` rows. Season create/delete/undelete/copy operations still use
`start_batch_operation` and the backwards-compatible batch revert endpoint.

The crops page generates one random `import_operation_id` for the entire apply
attempt, including all crop, companion and finalize HTTP batches. It never
retries an uncertain write automatically. The server binds this UUID to the
active project and initiating user under the existing project write lock.
Closed/reverted, foreign-user/project and expired (24-hour) IDs cannot accept
more batches. Old requests without an ID keep the previous ungrouped behavior;
timestamps are never used to guess which old revisions belong together.
Both grouped and legacy imports record each companion creation, note merge,
free-text relink and redundant-text deletion. An ordinary crop create or
rename records those same relink/deletion revisions. Derived library divergence
flags are recorded before the relation revision, so the completed version
contains the relation and the affected crop states.

Before a project's first ordinary create/update/delete request,
`ensure_project_checkpoint` establishes a complete baseline once. Read-only and
import-preview requests do not create that baseline. Mutating custom actions
(including undelete, library import/link/sync, season transitions and layout or
attachment writes) establish it too. Lazy creation of a default
location gets its own creation revision. Every mutating request keeps the project
write lock until its request transaction finishes, including after a baseline
already exists, so it cannot enter an import capture window. Later ordinary mutations continue to
write per-entity revisions, without serializing the whole project again.

`history/import_operations.py` owns grouping and selective undo:

- A context-local `revision_batch` binds nested crop/model/service audit writes
  to the server-selected group. It is reset even on exceptions and never takes
  a client-supplied database batch ID.
- Each apply request captures its domain rows before and after executing, inside
  the transaction. The group privately retains the first before-image and latest
  after-image of each row the import actually changed, including supplier data,
  companions, timing windows and recalculated plan/task state. It does not absorb
  unrelated changes made between HTTP batches. Interleaved edits to an affected
  row block selective undo.
- The operation also writes complete domain checkpoints before and after each
  HTTP batch. These are exceptional writes per bounded batch, **not per crop or
  every ordinary mutation**. They establish untracked initial rows and make the
  applied state, interrupted-import state and undo result restorable.
- History displays one import group with unique created/updated crop counts,
  actor/time and expandable affected-record labels. Private before/after images
  and checkpoints are never included in list responses. The list defers revision
  snapshots and loads each batch context once, with a constant query count.

Bulk public-library imports use the same history group and selective undo. A
culture and its selected varieties use a savepoint, so a failed culture rolls
back its own writes while successful cultures share one before/after history
group. An all-skipped or all-failed request records a receipt without a timeline
entry. For one day, the same request UUID, project, actor, and fingerprint of
the confirmed decisions and note language can retrieve a completed receipt.
An undone group cannot replay its receipt. A separately confirmed retry of
failed cultures creates its own history group if it changes project data.
[Bulk library import contract](crop-library-architecture.md#bulk-import-across-cultures)

The primary **Restore this version** action selects the group's last revision,
just like a flat entry. The newest flat/grouped entry gets the current-version
badge. **Undo only this import** is an additional overflow-menu action, including
on the current import group; ordinary revisions do not expose it.

`POST /api/history/batch/{id}/undo-preview/` checks a project-admin's selected
import and returns created/updated counts and localized-by-code conflicts. The
execution endpoint `POST /api/history/batch/{id}/revert/` recomputes those checks
under project/row locks. It refuses changed after-images, interleaved same-row
edits and dependencies from other records, including nullable references that a
normal delete would silently clear. It never cascades away later plans/tasks or
silently overwrites newer work. An accepted inverse applies only recorded
before-images as one transaction, preserves independent later rows, and writes
a new `batch_reverted` entry with complete state checkpoints. A second undo is
refused. Older season batch revert behavior remains available through its existing
overflow action and API; import-specific checks do not change that contract.
Legacy batch reverts also save a separate selectable backup and finish their
group with a complete checkpoint. Reverting that group still composes using
its entity revisions; the checkpoint is not treated as another inverse entity.

## Full project restoration

The owner clarified in #1061 that **Restore this version means the complete
historical domain state, including removing later-created crops and beds**.
This deliberately replaces the old retain-later-created-rows behavior.

`ProjectHistoryRestoreView` and the timestamp compatibility helper delegate to
`history/project_restore.py`:

1. Lock the project and current domain rows. Resolve the selected revision by
   `(created_at, id)`, so equal timestamps cannot include a later revision.
2. Start with the latest complete checkpoint at or before that revision and overlay
   its subsequent entity revisions. A complete checkpoint establishes both
   presence and absence at its timestamp. A row recreated after that checkpoint
   can keep its original creation date. Replays to other revisions still require
   positive evidence. Snapshots establish presence, deletion revisions establish
   absence, and a creation time after the target establishes later creation.
   Unknown or pruned history, incompatible checkpoints and old restore markers
   without resulting state return `409 project_restore_conflict`.
3. Validate ownership, historical parents, external references and final general
   crop identities. Refuse untracked/external cascades. Missing optional global
   references retain the established nulling behavior; required missing parents
   cannot be silently skipped.
4. Save a complete current-state backup, remove absent rows in reverse dependency
   order and restore targets in forward order. Crops use soft deletion to retain
   identity, library provenance and the drain-only legacy crop audit rows. No
   uniqueness loser is silently skipped. Any failure rolls back all writes and
   backup entries.
5. Record the resulting state as a new complete checkpoint. Both this result and
   the preceding backup can be selected later; old historical entries remain.
   Full restores, legacy batch reverts and import undos mark their before-state
   entries as automatic backups. History displays the label in the list and in
   the confirmation dialog using that marker. Older import-undo groups expose
   their before-checkpoint when the group records that operation explicitly.

This versions farm domain data, not accounts, memberships, API tokens, shared
public-library records or project access/lifecycle settings. The ordered domain
registry covers the original restorable types plus private supplier rows, seed
packages, task templates, season patterns and media metadata. Crop timing windows
remain embedded in their parent snapshot. It does not recreate file bytes that
have already been removed from storage. An incomplete old version remains
readable but cannot be destructively reconstructed by guessing.

Crop timing edits record recalculated plan after-images inside the crop save's
transaction, followed by the crop revision as the completed version boundary.
When a linked variety fills species fields on its general crop, the general
crop's after-image is internal and the completed variety revision records its
final stored values. A variety update also lists the fields it changed on the
general crop. Restoring that entry from crop history restores those values on
the same general crop and refuses if the recorded parent is no longer linked.
Suppliers created by name are recorded before the crop
revision in the same transaction. Import preview, skipped rows and rejected
rows leave no new suppliers behind.
Nested supplier rows and seed packages also record their after-images/deletions
before a final crop revision. Neighbours taken from the crop library on import,
link, sync or a library update follow the same rule: each created, updated or
deleted `CropCompanion` gets an internal after-image, and the Kultur's crop
revision closes the action (after the relation writes when the crop save came
first; see [crop-companions.md](./crop-companions.md#crop-library), #1192). Intermediate crop and child revisions remain
internal, so selecting the completed action includes the entire committed nested
write. Those derived plan rows remain in the audit trail and reconstruction, but cannot
be selected as intermediate project versions. Ambiguous legacy season, template
and generated-task deletion snapshots without a soft-delete after-state conflict
instead of hard-deleting an archived row. Proof of later creation reads the live
database timestamp at full precision, including creation within the target's
millisecond.

Lazy season-pattern defaults and implicit season creation retain internal
creation evidence without advertising incomplete versions from a read. First-run
season setup records its new season and finishes with a complete checkpoint,
including assigned plans and generated tasks. Layout PUTs journal changed bed
and field after-images and one completed version boundary, without a full-project
snapshot on every move. Their existing partial-write-on-validation-error contract
is preserved and the committed partial result gets a truthful version boundary.
Automatic/template task creation, season backfill and date synchronization write
internal after-images before the initiating plan/template revision. Those visible
versions therefore include the committed task state. Both spreadsheet and
agent draft previews are excluded from baseline creation, including malformed
preview requests.

## Local acceptance fixtures

`seed_import_history_acceptance` uses the existing development-only database
guards: an existing active local account, `OFP_LOCAL_TEST_DATA=1`, exact database
confirmation, applied migrations, and local SQLite/loopback PostgreSQL. Preview
first, then repeat with `--apply` after checking the printed target:

```bash
OFP_LOCAL_TEST_DATA=1 pdm run python manage.py seed_import_history_acceptance \
  --username LOCAL_ACCOUNT --database-name EXACT_LOCAL_DATABASE
```

The command creates three isolated private projects, each with a two-batch
create/update import, a variety and unrelated later crop/bed data. It changes no
catalogue or existing projects; repeating preserves manual edits. In
**Import history acceptance: safe**, selectively undo the three-crop import:
the created culture/variety disappear, the existing crop regains its old notes,
and the later crop/bed remain. **conflict** adds a later planting-plan reference:
preview must explain the conflict and disable undo. In **full**, restore the
import version: later crop/bed data disappear; select the automatic backup to
bring them back. Repeat at phone/desktop sizes and in another language. Cloud
verification uses its own synthetic database and never seeds localhost.

`seed_crop_library_history_acceptance` prepares a private project for verifying
the project history of a linked import. Use an existing published entry in the
local database that lists at least one seed package. From `backend/`, preview
the exact database target, then repeat with `--apply` to create the project:

```bash
DJANGO_ENV=development OFP_LOCAL_TEST_DATA=1 pdm run python manage.py \
  seed_crop_library_history_acceptance --username LOCAL_ACCOUNT \
  --database-name EXACT_LOCAL_DATABASE --public-crop-id ENTRY_ID
```

In **Crop library history acceptance**, import that entry with linking. Delete
an imported seed package from the local crop and restore the import version
from Project history. The same crop is still linked and the deleted package is
back. The fixture command preserves edits on repeat and leaves the local
library entry untouched.

`seed_companion_history_acceptance` prepares two private crops and a free-text
neighbour for a third crop that has yet to be imported. From `backend/`,
preview the target and then repeat with `--apply`:

```bash
DJANGO_ENV=development OFP_LOCAL_TEST_DATA=1 pdm run python manage.py \
  seed_companion_history_acceptance --username LOCAL_ACCOUNT \
  --database-name EXACT_LOCAL_DATABASE
```

In **Companion history acceptance**, import the following JSON from the Crops
page and allow updates to the existing crop:

```json
[
  {
    "name": "Companion history owner",
    "good_companions": [{"name": "Companion history neighbour", "notes": {"en": "Imported note"}}]
  },
  {"name": "Companion history later"}
]
```

The owner's neighbours now include the imported note and the former free-text
entry links to the new crop. Edit the owner's crop notes and save. In Project
History, restore the completed import. Both neighbours remain linked and the
imported companion note remains. Repeating the fixture command preserves
manual changes in the fixture project.

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
- **Invariant:** after every completed API write, the latest selectable version
  reconstructs exactly the live project. Every completed version can be
  restored, and so can the automatic backup of each restore, import undo and
  batch revert. Any write to a restorable row (including queryset `update()`,
  derived writes and library or import side effects) needs a revision. The
  history-completeness guard enforces this for all farm API tests and names
  the uncovered row and field. See
  [testing-and-ci.md](./testing-and-ci.md#history-completeness-guard) for the
  normalization rules and the `history_guard_exempt`/`history_gap` markers.
- A new model in `PROJECT_STATE_MODELS` must also be created, updated and
  deleted by the round-trip scenario in
  `backend/farm/tests/test_history_invariants.py`
  (`HistoryRoundTripScenarioTests.build_scenario`). The registry check fails
  otherwise. The round trip compares both the restored version and its automatic
  backup against their captured domain states.

## What participates in whole-project restore

`_RESTORABLE_ENTITY_TYPES` (`backend/farm/history/records.py`) is an ordered
list — parents before children, because restore deletes in reverse order and
recreates in forward order:

`Location` → `Field` → `Bed` → `BedLayout` → `FieldLayout` → `Supplier` →
`Crop` → `CropCompanion` → `Season` → `PlantingPlan` → `Task` →
`NoteAttachment`.

`PROJECT_STATE_MODELS` in `history/project_restore.py` augments this dependency
order with `MediaFile`, `CropSupplierData`, `SeedPackage`, `CropTaskTemplate`
and `SeasonPattern` for complete checkpoints and guarded inverses. New entity
registrations require checkpoint compatibility and dependency tests as well as
an ordinary revision write path.

Public crop-library entries have their **own**, separate version history
(`PublicCropRevision`, see
[crop-library-architecture.md](./crop-library-architecture.md)). They are not
project-scoped and never take part in project restore.

## Retention anchors

`cleanup_history` retains all revisions inside 30 days, the newest revision
before the cutoff per entity, and the newest complete checkpoint before the
cutoff per project. These anchors are required to reconstruct a recent target
when an entity changes both before and after it. Timestamp ties use the ID.
Keeping only the newest revision overall would discard the pre-target state.

Explicit note-attachment deletion retains its bytes instead of deleting storage
immediately, allowing its pre-delete baseline to recover the original file.
New crop uploads start with an orphan timestamp. Crop writes clear the marker
when an image is attached and record a new timestamp when the last reference
is removed. These marker revisions are recorded before the completed crop
revision. Full restore, selective import undo and legacy batch revert reconcile
markers against live references after applying their restored rows. Existing
orphan timestamps remain available as historical evidence.

Restore operations check the storage paths for recreated and newly attached images and
retain paths they detach, including cascades and replacements. `RetainedUpload`
records the latest removal outside project versions and survives project
deletion. The 30-day window protects the pre-restore backup even when a
restored media row carries an older orphan timestamp. `cleanup_orphaned_media`
checks both live crop references and attachment paths across projects before
deleting expired files and their metadata.
Cleanup and restore use the same project-first lock order. History anchors do
not extend the file-byte retention window indefinitely.

## Derived fields and legacy entity labels

Crop timing changes record the recalculated planting-plan date snapshots in
addition to the crop revision. Season-pattern saves and first-run plan assignment
record their own revisions; task-template history retains its existing persisted
`croptasktemplate` label, accepted alongside the canonical checkpoint label.
Soft-deletion snapshots retain the post-delete flag so a full-state restore
preserves archived rows and their surviving references. Known hard-parent
deletions replay the schema's cascade/nullable-FK effects without inventing
absence for untracked rows. If deleting a newer parent cascades into a row that
belongs in the target, the restore recreates it with its original ID and stored
creation timestamp.

Crop revision restore and grouped undelete reject active normalized name/variety
conflicts with HTTP 409 (`crop_variety_conflict`), including crops without a
supplier. A rejected group restores no rows or history. Full project restoration
and selective import undo validate the final projected identities rather than
intermediate replay order; unchanged legacy duplicates remain permitted.
