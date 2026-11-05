# Tasks: model and API

Issue #890 extends the existing `Task` and `/api/tasks/` endpoint. IDs, status
values (`pending`, `in_progress`, `completed`, `cancelled`), pagination, revision
history and the legacy `/openfarmplanner/api/tasks/` mount remain compatible.
The dashboard added in #891 consumes these persisted tasks; automatic generation
remains deferred.

## Ownership and relations

Tasks belong to a project and season. New API tasks require a season: pass
`season`, send `X-Season-Id`, or inherit the linked planting plan's season.
Legacy standalone tasks may retain a null season and remain accessible without
a season filter. Linked legacy tasks inherit their plan's season and crop in
migration `0127`; titles, descriptions, dates, statuses and IDs are preserved.
A legacy plan without a season leaves its task unassigned too.

`planting_plan`, `crop`, `field` and `assigned_to` are optional. A direct
field supports tasks such as fence repairs without a crop or planting plan. All relations must belong
to the active project; the assignee must have a project membership. A linked
plan and task must have the same season and, when a task crop is set, the same
crop; an explicit field must match its bed’s field. Creating a linked task defaults its crop from the plan. Explicit nulls
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
`planting_plan`, `assigned_to`, `field` and inclusive `due_date__gte` / `due_date__lte`
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


## Task dashboard (#891)

`/app/dashboard` keeps the existing project setup checklist and replaces its
read-only derived event preview with a persisted-task board. The legacy
location-specific event preview is unchanged; automatic conversion is #893.

The board loads all task pages through `taskAPI.listAll()` and uses the existing
project and active-season request headers. Crops, fields, beds, planting plans
and project members supply filter labels and card context. It does not generate or synchronize tasks. Manual task forms are described below.

There are three columns: pending, in progress and completed. Cancelled tasks
remain stored and are omitted from this three-column work view. Cards show the
localized origin, due date (or no date), crop/field, optional assignee and manual
date override marker. Status PATCH requests send only `status`, leaving dates,
overrides and generator identity untouched. Moves are optimistic; a failed
request restores that task without reverting other tasks' concurrent changes.
An in-flight task cannot be moved again until its request settles.

Filters combine period, crop, field (direct field, otherwise resolved via plan → bed → field) and
assignee, including unassigned. Date periods use local calendar dates, inclusive
custom bounds and Monday–Sunday for this week. Undated work remains visible
under all dates. Metrics reflect the filtered subset and count only unfinished
work. All filtering uses the complete fetched collection, not just visible
cards. Each column initially renders 30 cards and exposes a show-more control.

From the MUI `md` breakpoint (900px), mouse/touch drag handles use dnd-kit and
empty columns are valid drop targets. Below that width, including phone
landscape, the view is a single-column compact list with collapsible filters.
Every card has a keyboard-accessible status menu at every breakpoint. Visible
and screen-reader text is translated in de/en/fr/es. Load failures hide the
board and retain the shared retry flow; filters survive retry.


## Manual tasks (#892)

An incomplete project without a season or tasks keeps the existing focused setup
checklist. Once a season exists, manual tasks are available even without crops
or planting plans. The board's add button opens a task form when a season is active; without one
it opens the shared season-creation flow. Tasks may be saved without a date,
crop, plan, field or assignee. The form captures title (required, up to 200
characters), description, due date, status and optional relations. Selecting a
plan fills its crop and field; those controls are fixed until the plan is
cleared. Standalone field tasks use the new nullable `Task.field` relation.
The API field filter includes both direct fields and inherited plan fields.
Migration `0129_add_task_field` is schema-only and reversible; rolling it back
removes field assignments while preserving tasks.

The card menu exposes edit and delete actions as well as status changes.
Successful creates appear on the board (filters reset so the new task is not
hidden); edits retain active filters. Save failures leave the draft open.
Editing a generated task sends `due_date` only when it changed, preserving an
existing override/baseline when merely editing its text. Deletion requires the
shared explicit confirmation dialog, initially focused on Cancel; a failed
delete preserves the task and dialog. The editor uses a fullscreen layout below
900px, including phone landscape, with scrollable content and visible actions.
