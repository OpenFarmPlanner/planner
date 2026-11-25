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
- Harvest records belong to the project and use their picking date for
  seasonal reporting. Allocations can point to a planting from an earlier
  season if its bed occupancy overlaps the harvest date. Season copies
  leave the source harvests and allocations in place. See
  [planning and operations](./data-model.md#4-planning-and-operations).
- Crop-loss incidents contribute to the season containing their recorded date.
  A plan's detail view lists its incidents across seasons. The optional table
  count follows the currently selected season, including incidents recorded for
  carried-over plans. A copied plan starts with an empty incident log.
- A season copy records the direct source plan. The detail view reads the
  source's recorded activity dates and the harvest allocations and crop-loss
  incidents dated in its season. The source link opens the original plan in its
  season. Pattern transitions can distribute one copy operation across two new
  periods, retaining the original source for each resulting plan. Each later
  copy records its own direct source. The [actual-date copy option](#copy-data-action)
  controls how new planned dates are set.

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
  beforehand. The same operation restores their tasks and recorded crop-loss
  incidents. It restores a harvest's deleted allocations when the harvest still
  has the recorded crop, date and unit, and enough quantity for all those shares.
  Older deletion records without the harvest metadata require an untouched
  harvest. Recorded dates, restored allocations and losses become visible
  again in copies that reference the recovered plan.
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
reads `PlantingPlan` resolves the active season explicitly. The list and
occupancy calendar show plans for the active season and older plans that
still occupy a bed. Seed and young-plant demand use the planting season.
Yield uses the harvest dates within the selected season's period.

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
  scopes writes to `season_id` when the header is present. For reads in the
  selected season, it also includes a plan planted before the first day if
  it occupies an assigned bed on or after that day. The recorded perennial
  removal date takes precedence over the stored harvest end, harvest date,
  and planting date. For a configured perennial, an earlier recorded sowing
  or transplant can make the plan visible in a season preceding its planned
  start. That view uses the same plan ID, read-only status and origin action.
  A read returns `carried_over` and the originating season label. The plan's
  ID and season assignment stay the same. For a perennial with a configured
  annual window, `seasonal_harvest` gives the ordered, inclusive `periods`
  that intersect the selected season, the effective `occupancy_start_date`,
  a `planting_recorded` flag for an
  actual sowing or transplanting anchor, and nullable `actual_start_date`
  and `actual_end_date` from the primary harvest occurrence for that season. An
  empty list means the plan has no eligible harvest in that period. The
  property is null for legacy one-off plans or a request without a season.
  Planting-plan details use the active season for perennial and carried-over
  plans. The local chooser changes the date range of harvest forecasts, allocated
  harvest totals, crop losses and tasks without moving the source plan or
  changing the app's active season. Its `record_season` parameter resolves to
  a season in the active project. Date ranges are inclusive. Due dates place
  tasks in this view, with the assigned season used for undated tasks. The
  chooser also includes periods with records outside the bed's occupancy, such
  as pre-planting tasks. The first dated allocated harvest can be shown as an
  observation when an explicit start is
  absent. Only explicitly recorded dates supply an actual harvest end.
  Original planting information remains visible in every period. The table and
  detail editor use `harvest_actual_occurrences` for harvests visible in the
  selected season. If several occurrences are visible, the table prefers one
  starting in that season, and details show each occurrence separately. The same
  actual dates appear on both sides of a season boundary when the occurrence
  spans it. An actual one-off harvest can stay visible after the forecast ends.
  `PATCH /planting-plans/{id}/harvest-actual-dates/?record_season={season_id}`
  accepts `start_date` or `end_date`, including null to clear a value, and the
  occurrence `year` for a recurring harvest. The original plan retains its season
  assignment. These writes leave planned windows, occupancy, harvest quantities
  and task dates untouched. A current-season task
  may link to the original plan while the crop occupies an assigned bed.
  Plan details show the lifetime harvest occurrences in pages of up to 20 years.
  A recorded occurrence remains available in the table, details and yield
  activity history if a later change shortens the forecast or disables
  the recurring schedule. Its dates do not extend planned occupancy.
  In the originating
  season, open **Harvest windows by year** to replace the calculated dates for
  one occurrence or reset its saved dates. The occurrence key is the calendar
  year in which its default window starts, even when it spans two seasons.
  The API accepts ordered absolute dates for an eligible occurrence, within
  the first-bearing and removal dates and separate from neighbouring windows.
  If a later edit makes an override invalid, the details show the saved
  dates and a warning. The forecast uses the calculated dates when available.
  The table and calendar use the same projection as the yield forecast.
  Stored sowing, planting and harvest dates retain their meanings. Attachment
  writes use the same season boundary. `perform_create` assigns new plans to the active season
  when the payload has no explicit season. Legacy unassigned rows retain
  their existing assignment until season setup.
- `SeedDemandListView` and `YoungPlantDemandListView` use the owning season
  directly. Omitting the season header retains the existing project-wide
  API behavior.
- Switching the active season reloads the page — the same deliberate choice
  `switchActiveProject` makes for projects, to guarantee no page holds stale
  cross-season state. The originating-season action opens the same plan in
  its own season. The list keeps carried-over plans selectable and includes
  them in search and filters, with a separate count for newly planted plans.
  The Continued crops filter includes every carried-over planting. The
  optional Season status column describes which part of the occupancy period
  falls in the selected season.
- The Crop Calendar waits for a selected season before fetching plans. Its empty
  state opens season creation when the project has no seasons, or opens the
  season picker when seasons exist without a selection. A selected season
  with only carried-over plans still displays the calendar.
- The Anbaukalender's Gantt/occupancy timeline
  (`frontend/src/pages/GanttChart.tsx`) does **not** anchor its visible time
  axis to a calendar year. The axis follows the actual data range of the
  season's plans: `startDate` = the earliest `planting_date`, `endDate` = the
  latest relevant date (harvest end, falling back to the harvest date), even
  when that reaches past the season's end. Carried-over bars begin at the
  first visible day and label their source season. A far-off perennial removal
  date does not expand the axis on its own. Within the displayed columns, the
  perennial's single bar extends to its actual clearing date or the right
  edge of the calendar, whichever comes first. A configured perennial marks all
  eligible planned harvest intervals intersecting those columns, including
  periods outside the selected season. The accessible label and preview list
  the displayed harvest intervals, and the preview retains the original
  planting and clearing dates. When the axis goes outside the selected season,
  the calendar requests projections in bulk from the season-scoped
  `planting-plans/calendar-harvest-windows/` endpoint using the displayed date
  bounds. Each response covers up to ten calendar years. For wider axes, the
  client follows the continuation and joins any split harvest window.
  Yield and demand retain their season scope. An earlier recorded planting can let a crop
  bear before its original planned planting date. The bar includes that
  harvest interval, and the planned planting date remains in the tooltip.
  When a recorded date anchors recurring harvests, edit planned dates from
  the planting plan. The calendar keeps the bar fixed in move mode.
  Own-season edits keep
  the planting date within that season's period. The range is computed
  globally across every Fläche/Standort/Parzelle so all rows share the same
  columns and stay comparable, and gaps in the middle of the range are never
  collapsed. The occupancy view and the seedling/Anzucht view each get their
  own range (`getOccupancyCalendarRange` / `getSeedlingCalendarRange` in
  `ganttChartUtils.ts`), because propagation starts before the planting date.
  The seedling view includes only the active season's own plantings.
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
  misleading. `YieldCalendarListView` clips the weekly harvest contributions
  to the season's date range, including both its first and last day. An
  explicit ISO year further limits that range. A week crossing a season
  boundary contributes only its share on each side, including for plans
  still awaiting a bed assignment. The active season's dates also determine
  whether the chart draws a year-boundary marker.
- `farm.services.yield_calendar.compute_plan_expected_yield` calculates the
  plan's forecast in kilograms from the effective crop rate and unit. Use the
  plan's planted square metres for a per-m² rate and its canonical calculated
  plant count for a per-plant rate. Crop varieties inherit these inputs through
  the same resolver as the planting-plans API. The generic plan quantity can
  also represent seeds, so it does not participate. Missing or invalid inputs
  yield calculation blockers.
- The calendar distributes a one-off plan's forecast by days in its half-open
  stored harvest interval. For each configured perennial window it spreads
  the same plan-scaled forecast over the inclusive dates of the full annual
  window. A season receives only the share between the first-bearing
  anniversary and clearing, bounded by the season dates. A calendar-year
  boundary can split one window across seasons, or one season can contain
  parts of two windows. If the February 29 fallback would place adjacent
  windows on the same day, that day goes to the window starting on it.
  Each weekly contribution is the difference between cumulative values at
  its boundaries, rounded to 0.01 kg. The same weeks have the same values in separate ISO-year
  requests and in the season response. The optional `include_incomplete=true`
  response has `weeks` and `incomplete_plans`. It gives the yield overview the
  scoped plan IDs and their calculation blockers. An unscheduled perennial
  draft is incomplete in its planting season. A scheduled, nonbearing plan
  contributes neither a forecast nor a blocker for that season. The default
  response is the array of weeks.
- **Compare seasons** in Yield overview reads `/yield-calendar/comparison/`.
  It starts with all crops, all locations and the three most recent season
  records. The crop picker groups varieties by species, with a crop-name
  fallback for unlinked crops, and searches the varieties and crop aliases.
  Other filters include an individual variety,
  field, bed, and the latest five or all seasons. The forecast calendar keeps
  its own filters when changing views.
  Each crop's forecasts use the same projected periods and cumulative
  rounding as the calendar. Identical forecasts copied from the same source
  into the same target season contribute once. An edited bed, area or planned
  date can give a copy a separate forecast. Harvests and losses follow the
  recorded event date, including events attributed to an older planting plan.
  The plan's planting activity comparisons stay in its planting season.
  For recurring plans, the season with the harvest shows the corresponding
  harvest activity dates under the original plan ID.
- Comparison totals include each harvest record once, across all of its
  allocations and any unassigned remainder when no area filter is active.
  An area filter counts the allocated shares on matching plans. If a record
  has an unallocated remainder or a plan without an area, the season reports
  that record's incomplete assignment and the chart marks recorded values
  as partial. Gram and kilogram records share
  a mass total. Counts and weight estimates appear separately. Recorded
  yield per m² uses the full area of each plan with assigned harvest, counted
  once. Individual harvests with a recorded area show their own rate separately.
  The API marks pairs comparable when measured mass and complete forecasts
  cover the same plans. The chart can show either series on its own and hatches
  known values with incomplete coverage. The unit picker shows kilograms,
  pieces or bunches with data in the selected seasons. Forecasts use kilograms.
  The chart and table expose estimates separately from measured quantities.
  A season without a record in the selected unit has unknown yield, including
  when a loss was recorded. The chart marks a missing value with a dash and
  an explicit zero with a zero. The harvest-entry model accepts positive quantities.
- The comparison `summary` covers all seasons returned by the current filters.
  It adds the known areas of plans owned by or occupying a selected season.
  A carried plan contributes once across the window, and unchanged repeated
  copies use the forecast's deduplication rule. Separate plans using the same
  bed each contribute their planned area. Missing areas are counted alongside
  the partial total. If no area is known, the total is unavailable.
  Recorded amounts use the same allocations and event dates as the seasonal
  rows, with original piece and bunch quantities separate from measured mass.
  Crop coverage groups varieties by crop species and uses the normalized name
  for unlinked crops. The denominator includes those with either a plan or a
  record in scope. The numerator includes those with at least one harvest
  record in scope.
- The comparison `crop_yields` uses the same crop grouping and returns one
  rate per selected season. It divides plan-assigned weight by the known area
  of those same plans, counting each assigned plan once for that season.
  Unknown areas and incompatible records have no rate. Any contribution
  converted from a piece or bunch count makes the rate an estimate. A known
  rate is partial when a harvest has an unassigned portion or a plan in the
  crop's season forecast has no assigned harvest. A trend compares the
  first and last seasons with measured, nonpartial rates and needs a positive
  starting rate. The table names both seasons. Selecting a crop opens the
  existing forecast, actual harvest and date observations for that crop under
  the same filters.

There is no server-persisted "last active season" (unlike
`UserProjectSettings.last_project`); it is a client-only, per-project
convenience that defaults to the newest season when unset or stale.
The demo opens on its newest season with planting plans so its empty copy
destination remains available without hiding the sample plans on first visit.

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

### Local perennial harvest fixture

On the matching local checkout, check the database target using the
[local fixture handoff](work-execution-queue.md#local-test-data-handoff).
From `backend/`, preview using an existing local user and the exact configured
database name or SQLite path.

```bash
DJANGO_ENV=development OFP_LOCAL_TEST_DATA=1 pdm run python manage.py \
  seed_perennial_harvest_acceptance --username LOCAL_USER --database-name LOCAL_DATABASE
```

After checking the preview, repeat with `--apply`. In **Perennial harvest
acceptance**, open Apple in 2025, 2026, 2027 and Sep 2028–Aug 2029. Its planned
dates are empty in 2025 and 2026, September 1 through October 15 in 2027, and
September 1 through September 10 in the last season. The original actual
start is visible only in 2025. In 2027 compare the 40 kg forecast with the
separate 3 kg dated harvest. Winter apple shows how a December–January window
splits at a season boundary. Legacy rhubarb and Overwintering garlic retain
their one-off schedules. Reapplying the command preserves manual edits.

To check a yearly override, open Apple's details in 2027 and choose
**Open in originating season**. In **Harvest windows by year**, select 2027
and save September 10 through October 20. Switch to 2027 and compare the
planting-plans table, Crop Calendar and yield forecast. The planned window
moves and the 3 kg harvest record remains dated September 10. Check 2028,
then reset 2027 from the 2025 details and verify September 1 through October 15
returns.

For the extended calendar axis, add `--calendar-axis` to the same preview
and apply commands. This creates the separate **Perennial calendar acceptance**
project with a 2024 rhubarb and a winter leek that takes the 2026 axis into
October 2027. In 2026, open **Crop Calendar → Field occupancy**. Check that the
rhubarb reaches the right edge of both the month and week views and includes
March 12–April 9, 2027 in its planned harvest shading and preview. Its
September 2030 clearing date remains visible in the preview. Shorten the
clearing date from the origin plan to March 20, 2027 and verify that the
bar and second shading both end on that date. Apple first bears in 2027.
Check an override for that year and compare the season-scoped yield report.

For the seasonal detail page, preview and apply the same command using
`--season-details` in place of `--calendar-axis`. In **Perennial season details
acceptance**, open Calendar rhubarb's details in 2026. Check its 2024 planned
and recorded sowing dates and September 2030 clearing date. The 2026 section
shows the March–April plan, 3.5 kg allocated on April 22 and the first recorded
harvest as an observation. Switch the detail chooser to 2025 to find the frost
loss and completed spring harvest task. The application's season stays at 2026.
Return the detail chooser to 2026 and add or edit a task or a loss for that year.

To check actual harvest dates, use the same **Perennial season details acceptance**
project. In the 2026 table, enter an actual harvest start for Calendar rhubarb in
**Actual**. Open its details at phone width and record an end date. Select 2027
and enter a different actual start. Return to 2026 to verify both dates, the
March–April forecast, the 3.5 kg allocation and the task dates. In a fresh
German demo project, repeat on the 2025 Knoblauch carried into 2026.

For perennial harvest tasks, use `--harvest-tasks`. In **Perennial harvest
tasks acceptance**, check the dashboard in 2026 for Calendar rhubarb's open
March 12 harvest-start task. Its 2025 occurrence is completed. Open the plan's
details and switch between those years to compare their due dates and statuses.
Apple first gets a harvest-start task in 2027. Move the rhubarb's 2027 window
from the original plan to verify that its open task moves independently.

### Local yield comparison fixture

On the matching checkout, verify the local database with the
[local fixture handoff](work-execution-queue.md#local-test-data-handoff).
From `backend/`, preview with an existing local user and your exact
database name or SQLite path.

```bash
DJANGO_ENV=development OFP_LOCAL_TEST_DATA=1 pdm run python manage.py \
  seed_yield_comparison_acceptance --username LOCAL_USER --database-name LOCAL_DATABASE
```

After checking the preview, repeat with `--apply`. In **Yield comparison
acceptance**, open **Yield overview → Compare seasons**. The latest season
shows 31 kg across all crops. Choose **North orchard** and look for 12 kg
and two harvest records with incomplete area assignments. Select Leek and
Tomato together, then choose Roma under **More filters** to see that variety's
6 kg. Switch to **All seasons** to see the fourth season. Each season runs
from September through August, and a season without a harvest shows
**Not recorded**. Repeating the command preserves manual edits.

For a mixed-unit check, open a fresh German [demo project](demo-project.md).
In **Ertragsübersicht → Saisonen vergleichen**, select Tomate and Kohlrabi
with the default three seasons. The crop coverage reads **1 von 2** and the
recorded total is **15,8 kg + 8 Stück**. Choose **Hofgarten** and check
**12,8 kg + 8 Stück** and the disclosure for two harvest records with
unassigned portions. Switch to Kohlrabi alone and verify **Nicht erfasst**
with **0 von 1** coverage. Open the existing help to see how planned area
and crop coverage are calculated.

In the same demo, choose **Alle Kulturen** and the default three seasons to
check **Erntemengen nach Saison**. The kilogram chart has two slots per season.
Open the 2026 tooltip for the **107,8 kg** recorded weight and the separate
**0,88 kg** estimate. Switch to **Stück** for the eight pieces in 2026 and an
unknown value in 2025. Selecting **Kartoffel** returns to the kilogram chart.
The 2025 forecast remains visible with a dash for the unrecorded harvest.

In **Ertrag pro m² nach Kultur**, Kartoffel has **2,29375 kg/m²** for 2024
and **2,2125 kg/m²** for 2026. The 2025 cell has a dash, while **Entwicklung**
shows approximately **−3,5 %** from **2024 → 2026**. Sort by a season or by
change and open the Kartoffel row to see **Termine und Beobachtungen** and
the plan links. Select **Lindenhof** to keep the potato plans, then **Hofgarten**
to see crops from that site. The trend needs two usable seasons in the current
selection.

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

**Create season** and **Copy season data** both list active seasons in the
same project that end before the destination begins. The list uses persisted
periods, displays custom labels, and defaults to the newest eligible source.
An intervening season or a gap in the season history does not prevent copying.
If there is no eligible source, the creation dialog offers creation without
copying. [#1509](https://github.com/OpenFarmPlanner/planner/issues/1509)
supersedes the creation-only source restriction from
[#1404](https://github.com/OpenFarmPlanner/planner/issues/1404). Additive copy,
actual-date rules and plan history from
[#956](https://github.com/OpenFarmPlanner/planner/issues/956) apply to both flows.

- `farm/services/seasons.py::copy_planting_plans(source_season, target_season)`
  copies a fixed tuple of `PlantingPlan` fields (`PLANTING_PLAN_COPY_FIELDS` —
  excludes the PK, timestamps, and audit fields) and `bulk_create`s the
  copies against the target season. It is always additive: existing plans in
  the target season are never touched, matched, or replaced.
- Before shifting a source plan, preview and execution skip it if it is still
  growing on its bed or directly on a parcel on the first day of its
  destination. The response reports
  these plans in `continuing_count`, independent of date basis or rotation
  choices. The copy dialog and season creation suggestion explain the skip.
  Drafts without an assigned growing area remain eligible for copying.
  A perennial copy also needs a valid planting date and effective productive
  lifespan. A legacy perennial that cannot be copied is counted separately.
  A continuing individual planting retains its original plan and stem IDs.
  A copy of an ended planting creates new stem IDs at the same coordinates
  on the original parcel. Parcel rotation only remaps bed assignments.
  The crop calendar lists individual plantings under their own parcel row
  and shows their recurring harvest windows. Bed capacity uses bed plans.
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
- `GET /seasons/creation-options/` returns eligible sources for the proposed,
  transition and manual start periods. The dialog previews the chosen
  `source_season_id`, `copy_target` and `use_actual_dates` before submitting.
  `POST /seasons/create-and-copy/` validates the same source under the project
  lock and saves the new season and copied plans in one transaction. When
  creating a transition and follow-up together, `create-transition` checks
  the two confirmed periods and distributes each copied plan to one period.
  The creation form defaults to planned dates. **Use actual dates as planned
  dates** uses dates recorded in the selected season, with a planned-date
  fallback for each activity. The new plans' actual fields start empty.

  For local QA, preview the command below, then repeat with `--apply` after
  confirming the target. In **Season creation dates (actual)**, create the
  suggested next season, keep copying enabled and check the date-basis option.
  The lettuce's new planned sowing date is April 6. Repeat in **Season creation
  dates (planned)** with the option clear and verify April 1. In both projects,
  the new harvest start is May 3 and the new actual dates are empty. The prior
  season keeps April 1 planned, April 6 recorded, and May 3 planned harvest.

  ```bash
  DJANGO_ENV=development OFP_LOCAL_TEST_DATA=1 pdm run python manage.py seed_season_creation_dates_acceptance --username LOCAL_USER --database-name LOCAL_DATABASE
  ```
- `frontend/src/seasons/SeasonCopyDataDialog.tsx` is the shared dialog
  opened from an existing season's row menu. It names the source and target
  and warns when the target already has planting plans. The copies are added
  alongside any existing plans.
- The dialog loads `GET /seasons/{id}/copy-preview/?source_season_id=...`
  for the selected source and sends that same ID to `copy-from` only after
  the current preview succeeds. Both endpoints check source chronology and
  project membership. Execution revalidates under the project lock before
  writing. The old `resolve_source=true` preview still resolves only the
  immediate predecessor for clients that do not send a source ID.
  Preview and execution both accept `use_actual_dates`, which defaults to
  false. With it enabled, each recorded date supplies the corresponding new
  planned date, using the source's planned date for activities with no entry.
  Changing the source, target or date basis invalidates the previous preview.
  The selected direct sowing or transplanting date determines the whole-year
  shift for the plan, and the remaining dates receive that same shift.
  A crop-derived fallback stays calculated when the new plan yields the same
  shifted date. Otherwise the copy stores the shifted source date explicitly.
  Direct sowing uses sowing and harvest dates. Bought-in plants use
  transplant and harvest dates. Own propagation can use all five.
  Copies always start with their own actual dates unset.
  When a copy would break the rotation
  on its bed (or gets a nutrient hint), shows a summary and lets the user copy
  the conflicting plans without a bed, onto the same beds anyway, or not at
  all (`rotation_conflicts` on `copy-from`, API default `keep`). The copies
  are built once by `build_planting_plan_copies`, shared by the preview and
  the copy. Details: [crop-rotation.md](./crop-rotation.md#season-copy).
- For immediate predecessor copies, **Rotate plans to the next parcel** applies
  the project's parcel sequence and bed order to the copied plans. A valid group
  selects the option by default. The date-basis choice remains independent.
  Historical sources remain available for plain copying and crop-family checks.
  The preview reports the wraparound mappings, adjusted occupied area, plant
  counts, seed requirements and conflicts. An unequal bed count, unmeasured bed
  or insufficient capacity prevents rotation. Existing and continuing plans
  take up area in the target beds. Both copy flows confirm the proposed rotation
  with its preview fingerprint and revalidate before saving. Continuing annual
  and perennial plans remain on their original beds.
  Parcel-direct plant placements introduced by #1015 must stay outside this
  workflow. The current model represents bed assignments and occupied areas.

For local QA, preview the guarded fixture command, then repeat with `--apply`
after confirming the database target. In **Historical season copy**, open
**Create season** for 2027. The selector offers 2026, 2025 and **Historical
garden** (2024), with 2026 selected initially. Choose **Historical garden**
and enable **Use actual dates as planned dates**. Confirm that the copied
lettuce in 2027 has February 28 planned sowing and an empty actual date.
The original lettuce keeps February 26 planned and February 29 actual.
From 2027's three-dot menu, use **Copy season data** to add the carrot from
2026 alongside it.

```bash
DJANGO_ENV=development OFP_LOCAL_TEST_DATA=1 pdm run python manage.py seed_season_creation_dates_acceptance --historical-copy --username LOCAL_USER --database-name LOCAL_DATABASE
```

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
  `{periods, reference_season, transition}`. `reference_season` can share a
  year with one of the computed `periods`, so the card merges them in
  `seasons/seasonPreviewRows.ts::buildSeasonPreviewRows`, together with the
  project's existing seasons from `GET /seasons/`: one row per start year,
  sorted by start date. A year that already has a season shows that season's
  real period and label (a pattern change never moves it); any other year is
  marked "(Vorschau)". The latest real season keeps its grey background and
  "(zuletzt bestehende Saison)" hint on its own (possibly current) row. When
  `transition` is set, a warn-styled row (orange, warning icon) with an inline
  "Optionen beim Anlegen wählbar" hint is sorted in by its start date so it
  reads as a pending decision, not an error. Saving the pattern
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
  uses the same month-and-day alignment for each plan. It tries the transition
  period first and then the follow-up. Each plan is copied into the first
  period it fits. Preview and execution use the same placement rule. Harvest
  dates may run past a season's end.

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
