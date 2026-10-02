# Seasons Architecture

Seasons let a project split its planting plans into successive ~12-month
planning periods (e.g. "2026", or "25/26" for a season that doesn't align
with the calendar year). This doc covers the data model, the season-scoping
mechanism, the copy-data action, and the first-run migration for projects
that predate this feature.

## Data model

- **`SeasonPattern`** (`backend/farm/models/seasons.py`) — one row per
  project (`OneToOneField`), holding only `start_day`/`start_month`. Duration
  is deliberately not configurable: every season spans exactly 12 months from
  its start date (`farm/services/seasons.py:add_months`, which clamps the day
  when the target month is shorter, e.g. Feb 30 → Feb 28/29).
- **`Season`** — project-scoped (`project` FK), `start_date`/`end_date`,
  optional `custom_label` (set via "Umbenennen"), and soft-deleted via
  `deleted_at` — same convention as `Crop` (`ActiveSeasonManager` hides
  deleted rows from `objects`, `all_objects` doesn't). A season's `label`
  property is the custom label if set, otherwise `computed_label`: a
  four-digit year when start and end fall in the same calendar year (including
  a partial-year transition season such as Sep 1–Dec 31), otherwise a
  hemisphere-agnostic `"YY/YY"` span. The rule follows the season's actual
  range, not the project's pattern. The frontend mirrors this exact rule in
  `frontend/src/seasons/formatSeasonDate.ts`'s `computeSeasonLabel` for
  previews computed before a season exists server-side.
- **`PlantingPlan.season`** — nullable `ForeignKey(Season, on_delete=CASCADE)`,
  mirroring the `crop`/`bed` FK pattern (nullable + CASCADE, but the actual
  delete path is the soft-delete above, so the DB-level CASCADE never fires —
  see the application-level cascade below). Nullable specifically so
  pre-existing projects keep working until the first-run setup (below) assigns
  a season. Crop library and bed/field structure stay season-independent,
  per the feature's original scope.

## Deleting a season

`SeasonViewSet.destroy` soft-deletes the season and, in the same transaction,
**hard-deletes its planting plans** — a season "contains" its plans, so
removing it removes them. `PlantingPlan` has no soft-delete, so each plan is
deleted for real, but `_delete_planting_plans_with_season` records an
`EntityRevision` (`ACTION_DELETED`) per plan first, so:

- the deletions show up in the project version history grouped under one
  `BatchOperation` (`season_delete`) — one entry with a single "rückgängig
  machen" that recreates the season and its plans, not a dozen loose rows
  (see [versioning-and-history.md](./versioning-and-history.md#batch-operations-grouping-a-cascade)).
  `season_create`, `season_undelete` and `season_copy_data` batch the same way;
- `SeasonViewSet.undelete` (the 10s undo snackbar in the season switcher, and
  any later manual undelete) recreates them, through
  `farm/history/restore.py::restore_season_planting_plans`. That finds the
  season's most recent `ACTION_DELETED` revision and re-inserts every
  `planting_plan` whose latest revision at/after that timestamp is a deletion
  with `snapshot['season_id']` pointing at this season — keeping the original
  primary keys and skipping any plan a user had already deleted individually
  beforehand — and then the `task` rows that DB-cascaded away with those plans.
  Creating a season over a deleted one's period is the same undelete, so
  `POST /seasons/`, `POST /seasons/create-transition/` and `undelete` all go
  through `farm/services/seasons.py::resurrect_season` rather than repeating
  it.

On the client, `useActiveSeason.deleteSeason` treats deleting the **active**
season as an active-season change: it repoints the stored id at the newest
remaining season and does the same full reload as `switchSeason`, so no
mounted page keeps showing the deleted season's (or, with the header now
absent, *every* season's) planting plans. The pending deletion is stashed in
`sessionStorage` (`pendingSeasonDeletionStorage`) so the undo snackbar
survives that reload; undoing an active-season deletion restores the season
and switches back to it. Whenever the active season falls back (stored id
missing or stale), `useActiveSeason.reload` writes the resolved id back to
`localStorage` synchronously, as soon as the season list arrives, so the
`X-Season-Id` header is never dropped while the project has seasons.

## Season-scoping of planting plans

Planting plans are the only season-scoped entity. Everything downstream that
reads `PlantingPlan` scopes by the active season explicitly — there is no
free ride through a shared queryset, because the Gantt/occupancy calendar
goes through `/api/planting-plans/` (a `ModelViewSet`) while yield overview
and seed demand are plain `APIView`s that build their own querysets in
`farm/services/yield_calendar.py` and `farm/services/seed_demand.py`. Both
accept an optional `season_id` and both views resolve it from the request the
same way the planting-plans viewset does — via
`resolve_season_id_from_request()` — so all three surfaces stay consistent
even though they don't share a queryset.

Scoping works the same way project-scoping does (see
[architecture-overview.md](./architecture-overview.md)'s `X-Project-Id`
description), one level down:

- The frontend persists the active season id in `localStorage`, namespaced
  per project (`activeSeasonId:<projectId>`, see
  `frontend/src/seasons/activeSeasonStorage.ts`) so switching projects never
  leaks a stale season id from a previous one.
- `httpClient.ts`'s request interceptor reads it fresh per request and sets
  `X-Season-Id` alongside `X-Project-Id`.
- `resolve_season_id_from_request()` (`backend/farm/project_context.py`,
  alongside the project-header resolution) parses `X-Season-Id` into an int
  or `None`; every season-aware view calls this rather than parsing the
  header itself.
- `PlantingPlanViewSet.get_queryset()` (`backend/farm/planning/views.py`)
  filters by `season_id` when the header is present; `perform_create` injects
  it onto new plans the same way project injection works, unless the
  serializer payload already specifies a season explicitly. Without a usable
  active season the serializer rejects creation; `season IS NULL` stays
  reserved for rows that predate the feature — see the first-run setup below.
- `YieldCalendarListView`/`build_yield_calendar` and
  `SeedDemandListView`/`build_seed_demand_rows` take the same resolved
  `season_id` and filter their own `PlantingPlan` queries by it when present;
  omitting the header (or filtering by `None`) aggregates across every season
  of the project, unchanged from before seasons existed.
- Switching the active season reloads the page — the same deliberate choice
  `switchActiveProject` makes for projects, to guarantee no page holds stale
  cross-season state.
- The Anbaukalender's Gantt/occupancy timeline
  (`frontend/src/pages/GanttChart.tsx`) does **not** anchor its visible time
  axis to a calendar year. The axis follows the actual data range of the
  season's plans: `startDate` = the earliest `planting_date`, `endDate` = the
  latest relevant date (harvest end, falling back to the harvest date), even
  when that reaches past the season's end. The `planting_date` itself stays
  hard-clamped to the season boundary on the serializer side — only the *end*
  of the displayed axis may extend beyond the season. The range is computed
  globally across every Fläche/Standort/Parzelle so all rows share the same
  columns and stay comparable, and gaps in the middle of the range are never
  collapsed. The occupancy view and the seedling/Anzucht view each get their
  own range (`getOccupancyCalendarRange` / `getSeedlingCalendarRange` in
  `ganttChartUtils.ts`), because propagation starts before the planting date.
  The zoom levels (Tag/Woche/Monat/Quartal/Jahr) only change the column
  granularity, not the anchor. When a season has no plans at all, the axis
  falls back to the season's calendar year (`displayYear`, seeded once from
  `RootLayoutOutletContext.activeSeasonYear` — computed in `RootLayout.tsx`
  from `useActiveSeason()` and passed through the route `Outlet` context) and
  the existing empty state renders; no season-year-specific axis logic is
  needed beyond that fallback.
- The yield overview (`frontend/src/pages/YieldOverview.tsx`) used to carry a
  "Jahr" filter with the same season-start-year default. It was removed: the
  page is fully season-scoped through `X-Season-Id`, and for a
  non-calendar-aligned season the calendar-year filter was actively
  misleading. `YieldCalendarListView` now returns every ISO year the active
  season spans (`build_yield_calendar_for_season`) instead of a single year,
  so a Sep–Aug season is shown whole. `RootLayoutOutletContext.activeSeason`
  carries the full season down to the page, which uses it only to decide
  whether to draw the year-boundary marker on the chart (see below).

There is no server-persisted "last active season" (unlike
`UserProjectSettings.last_project`); it is a client-only, per-project
convenience that defaults to the newest season when unset or stale.

Because the header comes from `localStorage`, a browser that has no stored id
for the project yet (first visit, new device, cleared storage, a deep link)
cannot scope anything until the season list has loaded. A page mounted earlier
would fetch its planting plans unscoped, i.e. every season's, and keep them:
the planting-plans grid loads only once, on mount. `useActiveSeason` therefore
reports `isResolvingActiveSeason` (a project is active, no id is stored, and
the app's first season load has not settled yet), and `RootLayout` renders
nothing in place of the routed page while it is set. This applies on
project-scoped routes only, the same empty fallback the lazy route chunks use.
The flag clears once the load settles, including when it fails or the project
has no seasons, so the error and "no season" states still render. A visitor
with a stored id is never held back. Neither is the page during an in-place
project switch: that switch ends in a full reload anyway, and unmounting the
page first would drop its unsaved-changes guards. The id is written inside
`reload` rather than from an effect because the routed page's effects would
run before the hook's in the commit that mounts it.
`e2e/planting-plans-season-scope.spec.ts` pins this by delaying the season
endpoints on a first visit.

## Year-boundary marker on season-spanning axes

A season whose period crosses a calendar-year boundary
(`season.start_date.year != season.end_date.year`) makes any calendar-week or
month axis ambiguous — "KW01" can be either end of the range. The yield
overview chart marks this with a subtle dashed vertical line between the last
column of the old year and the first column of the new year, spanning the plot
area only (it stops above the axis-label row), with a hover/tap tooltip
"Jahreswechsel: `<year1>` → `<year2>`".

Implementation worth reusing for other season-spanning axes (e.g. the
Anbaukalender Gantt):

- The boundary index is derived from the rendered columns
  (`useYieldChartData` returns `yearBoundary`), not assumed — it is the first
  column whose calendar year differs from its predecessor. Works for both the
  week axis (calendar year of the week start) and the month axis.
- The marker is only drawn when the active season actually straddles a year
  (`YieldDistributionChart` gates on `activeSeason` from the outlet context) —
  a plain calendar-year season never needs it.
- `YieldYearBoundaryMarker` measures the boundary column's offset inside the
  `position: relative` plot container and re-measures via `ResizeObserver`.
  The tooltip uses `AppTooltip` with an explicit `open` boolean driven by
  `hovered || pinned`, where `pinned` toggles on click — the same
  hover-or-tap pattern the chart segments use, so it works on touch.
- The colour is a dedicated muted theme token (`palette.chart.yearBoundary`),
  deliberately outside the crop series palette.

## Copy-data action

"Daten übernehmen" (copy planting plans from one season into another) is a
single reusable action, not a per-entry-point special case:

- `farm/services/seasons.py::copy_planting_plans(source_season, target_season)`
  copies a fixed tuple of `PlantingPlan` fields (`PLANTING_PLAN_COPY_FIELDS` —
  excludes the PK, timestamps, and audit fields) and `bulk_create`s the
  copies against the target season. It is always additive: existing plans in
  the target season are never touched, matched, or replaced.
- `planting_date`, `harvest_date` and `harvest_end_date`
  (`PLANTING_PLAN_SHIFTED_DATE_FIELDS`) are shifted by a **whole number of
  years, chosen per plan** so the `planting_date` keeps its month and day but
  lands in the target season's period (`whole_year_offset_into_period`); all
  three dates of one plan move by that same offset, so its growth duration is
  preserved. Deriving the offset per plan — rather than from the two seasons'
  start years — is what makes a copy out of a season longer than 12 months
  work: a manual transition season spanning Sep 2026 – Dec 2027 holds plans in
  both calendar years, and "start year difference" would push the 2027 plans a
  year too far and drop them all. Feb 29 clamps to Feb 28 when the shifted year
  is not a leap year (`add_months`). Plans with no `planting_date` fall back to
  the whole-year gap between the two seasons' start dates. The shift is always
  whole years, so it works for any season pattern, calendar-year or not.
- `SeasonViewSet.copy_from` (`backend/farm/seasons/views.py`) is the API
  surface both entry points call: the "Daten aus Saison X übernehmen"
  checkbox when creating a suggested season, and "Daten übernehmen von…" on
  any existing season's row menu. Both go through
  `frontend/src/seasons/useActiveSeason.ts::copyDataInto`.
- `frontend/src/seasons/SeasonCopyDataDialog.tsx` is the shared dialog
  component for the second entry point; it shows a warning (not error)
  `Alert` when the target already has planting plans, since the copy adds to
  them rather than replacing them.

## First-run setup (migrating pre-existing projects)

Projects created before this feature have `PlantingPlan` rows with
`season IS NULL`. That state is reserved for them: ordinary API creation now
requires an active season up front, and the project seeders call
`farm/services/seasons.py::assign_unassigned_planting_plans` after building
their fixtures (`populate_demo_project`, `populate_hint_test_project`).
Without that, a freshly created demo project would greet its owner with the
migration modal below. `reset_project_demo_data` drops a project's seasons
along with the rest of its farm data so repopulating never accumulates them.

The planting-plans page also mirrors this rule in the UI: when a project has
no active season it shows a "Noch keine Saison angelegt" empty state whose
only action is a CTA into the shared suggested-season dialog. If direct season
creation would leave existing
unassigned plans outside the proposed period (planting date through harvest
end), the API rejects it with a structured
`season_unassigned_data_outside_period` error so the dialog can explain which
legacy plans conflict instead of silently retrying.

`SeasonSetupStatusView`/`SeasonSetupApplyView`
(`backend/farm/seasons/views.py`) drive a one-time modal
(`frontend/src/seasons/SeasonSetupDialog.tsx`, mounted from `RootLayout.tsx`
and gated on `seasonSetupAPI.status().needs_setup`):

1. Status reports the count of `season IS NULL` plans, plus the target
   period computed by `compute_setup_target_period()` — anchored on the
   *earliest unassigned plan's* `planting_date` (falling back to today only
   when every unassigned plan lacks one), not on today. Legacy data lands in
   the season matching its own history rather than whatever period happens
   to contain today when a user gets around to running setup. The endpoint
   also accepts `start_day`/`start_month` query params to preview the effect
   of a not-yet-saved pattern choice (mirroring
   `SeasonPatternPreviewView`) — `SeasonSetupDialog` re-fetches on every
   change to the day/month selects so the info box and summary line never
   show a stale period.
2. Applying the setup saves the chosen start day/month as the project's
   `SeasonPattern`, creates (or reuses, via `get_or_create`) the `Season` for
   that same earliest-plan-anchored period, and bulk-`update()`s every
   `season IS NULL` plan onto it in one query — no data is copied or
   duplicated, only the FK is set. `assign_unassigned_planting_plans()` (used
   by the seeders, see above) and the interactive setup endpoint now share
   the exact same `compute_setup_target_period()` anchor logic.
3. The dialog is gated off entirely on project-independent routes
   (`isProjectIndependentRoute()`, e.g. `/app/project-selection`) — it used
   to render as a global overlay there too, blocking the project list's own
   "Öffnen" buttons behind its modal backdrop.
4. Canceling the dialog hides it for the rest of the browser tab's session
   (`frontend/src/seasons/seasonSetupDismissal.ts`, backed by
   `sessionStorage` and keyed per project) — a plain in-app navigation *or* a
   full page reload both respect the dismissal now. It still reappears on a
   genuinely new visit (new tab, browser restart), since nothing about the
   underlying unassigned-plans state was actually decided. Before this fix,
   the dismissal lived only in in-memory React state and was lost on every
   reload, not just a new visit.

## Season pattern preview math

`backend/farm/services/seasons.py` is the single source of truth for period
math (`compute_season_period`, `compute_period_containing`,
`compute_preview_periods`, `compute_due_season_period`,
`find_due_but_missing_season`). For projects with existing seasons, the
switcher's suggestion is the configured pattern period immediately after the
chronologically latest season, regardless of today's date. Only a project with
no seasons uses the pattern period containing today as its initial suggestion.
The project settings "Saison-Muster" card
(`frontend/src/seasons/SeasonPatternCard.tsx`) and the season switcher's
due-season suggestion both call the same `/season-pattern/preview/` and
`/seasons/due-suggestion/` endpoints rather than re-deriving the math
client-side — the one exception is the label itself
(`computeSeasonLabel`), which is cheap and needed before a suggested
season exists as a row to read `label` off of.

## Gaps and overlaps between the last season and the next pattern period

Changing the season pattern computes the future-period preview independently of
the project's real seasons, so the pattern period that follows the latest
existing season can leave a **gap** (or, with unusual custom seasons, an
**overlap**). The design principle is *explicit, not silent*: nothing is
auto-corrected and no decision is persisted when the pattern changes — the user
decides once, at the point the concrete season is actually created.

- `farm/services/seasons.py` owns the math:
  `analyze_period_transition(previous_end, next_start)` classifies a join as
  `gap`/`overlap`/seamless; `compute_custom_season_period(pattern, start_date)`
  returns an individual period whose end is the day before the next pattern
  start on/after `start_date` (so a transition season snaps back onto the
  pattern grid rather than running a fixed 12 months) — used for option 2's
  short transition season; `compute_manual_season_period(pattern, start_date)`
  instead ends at the close of the *following full pattern period*, used for
  option 3 (see the create flow below);
  `compute_first_future_pattern_period(pattern, latest_season)` is the
  skip-ahead period `find_due_but_missing_season` already used, now shared.
- **Preview (project settings, `SeasonPatternCard`).**
  `GET /season-pattern/preview/` now returns
  `{periods, reference_season, transition}`. The card renders the latest real
  season as a greyed reference row and, when `transition` is set, a warn-styled
  row (orange, warning icon) with an inline "Optionen beim Anlegen wählbar"
  hint so it reads as a pending decision, not an error. Saving the pattern
  still has no confirmation dialog and persists nothing about the gap.
- **Create flow (`SeasonCreateSuggestionDialog`).**
  The whole response is assembled by
  `farm/services/seasons.py::build_season_creation_options(project,
  manual_start=…)`; the endpoint only parses the optional `manual_start_date`
  query param and returns what the service builds.
  `GET /seasons/creation-options/` returns `last_season`, `due_period`,
  `transition`, `seamless_period` (option 2), a per-option `copy_preview`
  (`{total, copied, skipped}` for `adopt`/`transition`/`transition_followup`,
  and `manual` when a `manual_start_date` query param is passed) and
  `manual_period` + `manual_residual` (option 3). When `transition` is null the
  dialog behaves exactly as before. Otherwise it shows a radio group (nothing
  preselected, "Anlegen" disabled until a choice is made):
  1. adopt the gap/overlap (create exactly `due_period`);
  2. **transition season** — creates *two* seasons in one call
     (`POST /seasons/create-transition/`): the gap-filling `seamless_period`
     plus the regular follow-up season (`due_period`) the pattern computes
     next. The dialog states this up front ("Es werden zwei Saisonen
     angelegt: …"). If either period matches a soft-deleted season it is
     resurrected and its hard-deleted planting plans are restored, same as the
     `POST /seasons/` resurrection path and the `undelete` action.
  3. manual start date — the field is prefilled with the seamless date
     (last season's `end_date` + 1 day, i.e. the date that closes the gap /
     avoids the overlap completely) and stays freely editable. The end is
     **not** the short transition end: `compute_manual_season_period` runs the
     season from the chosen start through the *end of the following full
     pattern period* (start 2026-09-01, pattern Jan 1 → end 2027-12-31), so it
     closes the gap and absorbs the next regular season into one period. That
     keeps the whole-year-shifted copy in range — the point of the option is to
     carry the last season's plans forward, which a Sep–Dec transition window
     cannot do. The end is shown read-only next to a live green "gap fully
     closed" / orange "remaining gap {period}" hint (the gap check is on the
     *start* date, unaffected by the longer end), computed client-side via
     `seasons/seasonPeriodMath.ts::computeManualSeasonEnd` (a tested mirror of
     the backend math, so option 3 needs no round-trip per keystroke). The
     copy preview for a manual start *is* re-fetched from the server.
  Options 2 and 3 create seasons with individual, non-12-month dates; every
  regular season created afterwards follows the pattern again. The suggested
  name comes from `computed_label` on the resulting range, so a
  within-one-year transition season is proposed as e.g. "2026", not "26/26"
  (still editable via "Umbenennen").
- **Copy filtering.** `copy_planting_plans(..., restrict_to_target_period=True)`
  shifts each source plan into the target period per plan (see the Copy-data
  section) and only drops one whose month the (possibly short) target period
  never covers — surfacing the `skipped` count in the dialog. For the
  transition pair, `distribute_planting_plans(source, transition, followup)`
  instead shifts each plan **once** (by the whole-year gap to the transition
  season) and routes it to whichever of the two new seasons its shifted
  `planting_date` lands in — never both, never silently dropped. Harvest dates
  are never range-checked (they legitimately run past a season's end).

## Editing a season's period

"Zeitraum bearbeiten" in a season row's ⋮ menu (`SeasonPeriodEditDialog`,
available for **every** season) opens start/end date fields. On save the
`SeasonSerializer.validate` update path (`_validate_period_edit`) blocks the
change — with a structured `season_period_edit_conflict` error the dialog
renders as lists — when:

- an assigned plan's `planting_date` would fall outside the new period (only
  `planting_date`, never harvest dates); the user must move those plans first,
  nothing is shifted silently;
- the new period overlaps another season (the error carries the exact overlap
  range per conflicting season).

The dialog follows the blocking-dialog convention: Enter does not save and
default focus is on "Abbrechen". A successful edit is a plain `PATCH` +
`reload()`, so the Gantt axis, the label suggestion, and every other
range-derived view pick up the new dates.

## Known simplifications

- There is no "due season available" indicator on the closed switcher pill.
  The `/seasons/due-suggestion/` result only surfaces inside the open dropdown
  menu (the "Saison … anlegen" call-to-action); there is no separate compact
  popover distinct from the full dropdown menu.
- There is no dedicated `assertNumQueries` regression test for
  `/api/seasons/` beyond the one in `test_api_query_counts.py`; the
  `planting_plan_count` annotation is page-wide, not per-row, so it does not
  grow with the row count.
- "Daten übernehmen" shifts `planting_date`/`harvest_date`/`harvest_end_date`
  per plan by whole years so the `planting_date` lands in the target period
  (see the "Copy-data action" section). A copied `planting_date` only falls
  outside the target when the target period is shorter than a year and does not
  cover that plan's month at all (a short transition season); those plans are
  reported as skipped, not copied out of range.
- `PlantingPlan.planting_date` otherwise has a **hard boundary**: on API
  create/update `PlantingPlanSerializer` rejects a `planting_date` outside the
  target season's `start_date`–`end_date` range
  (`_validate_planting_date_within_season`), and the frontend constrains the
  date picker (the `PlantingPlans` grid's inline edit via `DateEditCell`'s
  `minDate`/`maxDate`, the mobile create/edit form via a helper text plus a
  submit-time check). The copy flow keeps every copied `planting_date` in
  range by construction (it shifts per plan and skips a plan whose month the
  target never covers), so it does not rely on the editor to pull plans back.
  This boundary applies to `planting_date` only — harvest dates are still free
  (they are derived from crop timing and legitimately fall after a season's
  end).
- A season's `computed_label` is not guaranteed unique within a project:
  changing the season pattern repeatedly can produce two different date
  ranges that both compute to the same "YY/YY" label (e.g. two periods both
  reading "26/27"). The season list disambiguates via the date-range subtext
  shown under each label, and `custom_label` (rename) is the escape hatch,
  but there is no automatic collision detection.
