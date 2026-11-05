# Tasks: model and API

Issue #890 extends the existing `Task` and `/api/tasks/` endpoint. IDs, status
values (`pending`, `in_progress`, `completed`, `cancelled`), pagination, revision
history and the legacy `/openfarmplanner/api/tasks/` mount remain compatible.
No dashboard or task generation is introduced here.

## Ownership and relations

Tasks belong to a project and season. New API tasks require a season: pass
`season`, send `X-Season-Id`, or inherit the linked planting plan's season.
Legacy standalone tasks may retain a null season and remain accessible without
a season filter. Linked legacy tasks inherit their plan's season and crop in
migration `0127`; titles, descriptions, dates, statuses and IDs are preserved.
A legacy plan without a season leaves its task unassigned too.

`planting_plan`, `crop` and `assigned_to` are optional. All relations must belong
to the active project; the assignee must have a project membership. A linked
plan and task must have the same season and, when a task crop is set, the same
crop. Creating a linked task defaults its crop from the plan. Explicit nulls
clear optional relations on updates. A removed user clears the assignee FK.
Tasks in soft-deleted seasons are hidden from list and detail reads, including
standalone tasks; restoring the season makes retained tasks visible again.
The existing cascade on hard deletion of a planting plan is preserved; season
soft-deletion still records and restores its plan/task deletions through the
existing history workflow. Future synchronization/deletion policy is #894.

Any project member can perform CRUD through a session. Project comes from the
validated request context and cannot be reassigned by clients. Project-bound
API tokens retain their existing read-only task surface. Listing and detail
lookups are project-scoped; `X-Season-Id` additionally scopes both when present.

## Dates and future generation

- `due_date` is the effective date exposed to existing clients.
- `calculated_due_date` stores the generator's baseline independently.
- `due_date_overridden` records whether a generated task's effective date was
  manually overridden. It distinguishes an explicitly cleared date from an
  absent override. Sending `due_date` on a generated task sets this flag, even
  when the date equals the baseline. Sending `due_date_overridden: false`
  without `due_date` restores the baseline. Editing status leaves both dates
  and the override unchanged. Manual tasks have no calculated baseline.
- `origin` is `manual`, `automatic` or `template`. API creation is manual;
  origin, calculated date and generator identity are server-owned read-only
  fields. The future generator will create the other origins internally.
- `(project, source_key, occurrence_index)` is unique when `source_key` is
  nonempty. A generator must include the plan and event/template identity in
  `source_key`; a repetition uses an index independent of its date. This keeps
  identity stable when dates move and gives each occurrence its own task ID
  and status. Empty source keys permit unrelated manual/legacy tasks.

The future synchronizer (#894) must update only open, non-overridden effective
dates and preserve completed tasks. Generation (#893), template relations and
rules (#895), recurrence expansion and limits (#896) are deliberately deferred.
The metadata and unique constraint prepare those paths; there are no signals,
GET writes, automatic task creation or synchronization in this change.

## Filters

`GET /api/tasks/` accepts exact `status`, `origin`, `season`, `crop`,
`planting_plan`, `assigned_to` and inclusive `due_date__gte` / `due_date__lte`
(ISO dates). Filters combine with AND and with the project/season context.
Invalid known filters and reversed date ranges return HTTP 400. Null dates do
not match date bounds. Without date bounds, undated tasks remain visible.

## Migration and rollback

`0127_extend_task_metadata` adds nullable relations and metadata, then backfills
only the new season/crop columns from same-project plans in batches. It does
not reinterpret existing tasks as generated or recreate records. Reversing the
migration removes the added fields, index and constraint while preserving the
original task rows and original columns; new metadata is lost on rollback.
The data reverse is a no-op because its columns are removed by the schema
reverse. Migration tests cover forward and backward preservation.
