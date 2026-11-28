# Bed occupancy (Beetbelegung) and harvest overlaps

How much of a bed a planting plan occupies over time, when a plan no longer
fits on its bed, and when a follow-up crop (Folgekultur) may already take over
the bed during the harvest phase of the previous crop (Vorkultur). Farms often
harvest earlier, clear the bed and prepare it before the planned harvest end;
the check models that instead of rejecting such plans.

One service answers every capacity question:
[`backend/farm/services/bed_capacity.py`](../backend/farm/services/bed_capacity.py).
The planting-plan table's save check, the bed options and suggestions of
the inline bed picker (see [crop-rotation.md](./crop-rotation.md#bed-capacity)),
the live info in the planting-plan dialog and the overlap infos on saved plans
all use it, so a bed that is offered is never rejected on save.

## Firm and soft occupancy

A plan occupies its bed from its planting date (the planting date for
transplants, the sowing date for direct sowing — both are stored as
`planting_date`) to its explicit perennial removal date if present. The
ordinary fallback is the harvest end, then the harvest start, then the
planting date. Plans without a bed or planting date never count. Two periods overlap
when they share at least one day (inclusive bounds).

A perennial with a recurring harvest window can occupy its bed from an
earlier recorded direct sowing or transplant. The calendar's area band, the
remaining-area check and bed suggestions use the same start. The same dates
count toward the bed's calendar-year crop rotation history. The planned
planting date continues to identify the original plan and its season.

That occupancy has two stages:

- **Firm (feste Belegung):** from the planting date to the day before
  harvest start + the project's minimum gap, at most to the harvest end.
- **Soft (weiche Belegung):** the rest of the harvest phase, up to the harvest
  end.

With a minimum gap of 14 days and a harvest from 1 May to 1 July, the plan is
firm until 14 May; a follow-up may start on 15 May ("frühestens 14 Tage nach
Erntebeginn"). If the harvest phase is shorter than the gap, the whole harvest
phase is firm. A gap of 0 makes the whole harvest phase soft. Without a
harvest start, or with the project setting off, everything is firm (the
behavior before this feature).

A perennial plan with an explicit removal date occupies its area firmly
through that day. Its first harvest does not release any of the bed's area
for a follow-up planting.

The gap covers harvesting, clearing and bed preparation; there is no separate
bed-preparation parameter.

## Errors and infos

- **Error (blocks saving):** on any day, the firm areas of the plans on the bed
  exceed the bed area. The check compares the plan's area with the bed area
  minus the *peak* firm area other plans use on any day of the plan's own firm
  stage (`used_area_sqm` / `overlapping_used_area_sqm`). Only firm stages
  count, the checked plan's own and the others', so the check is symmetric:
  moving or extending the previous crop until its firm stage reaches the
  follow-up is rejected just like planting the follow-up too early.
- **Info (never blocks):** a follow-up starts in the soft stage of a previous
  crop, and on that day the bed is over-full counting firm and soft areas. The
  previous crop then has to make room early. Partial plans that fit side by
  side are no overlap and show nothing.

A plan without an area skips the check, and so does a bed without an area.
The plan being edited never counts against itself (`exclude_plan_id`).

The bed area is dated ([growing-area geometry](./growing-area-geometry-history.md#implementation-status)).
When a checked period crosses a recorded size change, each slice is compared
with its own size and the slice with the least free room is reported; a slice
without a recorded size does not constrain the plan. Before a bed's first
legacy observation the check keeps using that observation, as it did before
dated geometry existed. Harvest-overlap infos use the size on the day the
follow-up arrives.

### The actual harvest end

The actual harvest end of the previous crop is the first day of the earliest
overlapping follow-up. It is calculated on every request, never stored, so it
follows every change of either plan and of the project setting at once.

## Project setting

Projekteinstellungen → "Anbauplanung" (`Project.allow_succession_during_harvest`,
default on, and `Project.succession_min_days_after_harvest_start`, default 14,
0–365 days; existing projects got the defaults by migration):

- "Folgekultur während der Erntephase erlauben" — off makes the whole harvest
  phase firm.
- "Mindestabstand ab Erntebeginn" in days, disabled with an explaining tooltip
  while the switch is off; the help text explains that the time covers
  harvest, clearing and bed preparation.

Only project admins can change it, like the other general project settings.

## API

- `PlantingPlanSerializer` adds two calculated, read-only fields:
  - `harvest_overlaps`: one entry per affected plan, sorted by date:
    `{role, other_plan_id, other_crop_label, date}`. As the `predecessor` the
    plan's harvest ends on `date` at the latest (the follow-up's first day);
    as the `successor` `date` is the previous crop's planned harvest end.
  - `actual_harvest_end_date`: the earliest follow-up's first day, or null.
    This calculated occupancy boundary retains its existing API name. The
    user-recorded harvest end is stored separately in `recorded_harvest_end_date`.

  The serializer builds one `HarvestOverlapIndex` per request: the project's
  bed occupancies (with species translations for the crop labels) are loaded
  with a constant number of queries, pinned in
  `farm/tests/test_api_query_counts.py`.
- `GET /planting-plans/remaining-area/?bed_id&start_date[&end_date][&clearing_date][&harvest_start_date][&crop_id][&exclude_plan_id][&area_sqm]`
  is the save check. Without `end_date`/`harvest_start_date` the backend
  derives them from the crop's timing. Perennials use `clearing_date` for a
  proposed removal date, then the matching plan's saved removal date or the
  date suggested by its lifespan. `end_date` remains the annual harvest
  boundary. The response includes the free area in the plan's
  firm stage (`remaining_area_sqm`), the plan's `harvest_overlaps` (needs
  `area_sqm`) and `succession_limit` — the previous crop's label, harvest
  start, the minimum gap and the earliest follow-up date — for the error
  message; `succession_limit` is null when the project setting is off or the
  previous crop has no harvest start.
- `bed-suggestions` uses the same interval and capacity rule; its
  `blocking_plan.end_date` is the last day of the blocker's firm stage.

## UI

- **Planting-plan table:** only previous crops are marked, because only their
  harvest has to end early: the "Ernteende" date gets a dotted underline in
  the theme `info` colour, and the whole cell shows the overlap lines as
  tooltip (`HarvestOverlapDateCell`, a `FullCellTooltip`). Follow-up crops
  stay unmarked in the table, so it stays calm; their line shows in the
  planting-plan dialog and the filter. The mobile cards keep a small info
  icon in the secondary line, for both roles. No chips or badges above the
  table. The filter panel's "Belegung" group offers "Ernteüberlappung", which
  shows previous and follow-up crops of allowed overlaps (kept in memory only,
  like the rotation filter). A table write that changes an occupied interval,
  area, or crop refreshes overlap information for plans on the affected beds.
  Moving a plan refreshes both beds. The refresh uses the current season's
  bed-filtered plan list, including visible carried-over plans, and discards
  responses superseded by another write or a project or season change.
- **Save check error:** the area dialog ("Die angegebene Fläche überschreitet
  die verfügbare Restfläche …") adds "Beetfläche überschritten. Auf {Kultur}
  kann frühestens {n} Tage nach Erntebeginn ({Datum}) eine Folgekultur folgen."
  when the project allows a follow-up during the harvest phase.
- **Planting-plan dialog** (`MobilePlanFormDialog`): an info Alert below the
  date and area fields, updated live when the dates, the area or the bed
  change (debounced `remaining-area` request).
- **Gantt (Anbaukalender):** the part of the previous crop's harvest bar after
  the actual harvest end is hatched (`Task.fadedTailFraction`, styled from the
  theme in `GanttChart.tsx`), and the tooltip adds "Ernte endet spätestens".
  After a drag the plans are refetched so other bars follow.
  **Show free areas** adds a capacity band to each visible bed. The band
  estimates free area within the selected season by counting each plan's
  stored area once through its inclusive occupancy end, including carried-over
  plans. An unfilled band means the whole bed is available, hatching indicates
  partial occupation, and solid grey means the bed is full. Band width shows
  how long the state lasts. Unknown area and planned overlaps beyond capacity
  have their own marks and explanations at the affected interval. The normal
  succession rule still governs whether a proposed planting can be saved.
  Hover for one interval, or select a band to inspect all its dated intervals.

Texts: "{Folgekultur} folgt ab {Datum} auf diesem Beet. Die Ernte muss bis
dahin abgeschlossen sein." on the previous crop, "Beginnt vor dem geplanten
Ernteende von {Vorkultur} ({Datum})." on the follow-up crop, one line per
plan. Severity info, not warning: the overlap is deliberate, allowed planning.

## Tests

`backend/farm/tests/test_bed_capacity.py` covers the rules (overlap only in the
soft stage → info, in the firm stage → error, harvest phase shorter than the
gap, switch off, gap 0, partial areas of several plans, several follow-ups on
one previous crop, the symmetric check, `remaining-area` and the list fields).
Frontend: `HarvestOverlapInfo.test.tsx`, `AreaValidationDialog.test.tsx`,
`plantingPlanSearch.test.ts`, `ganttChartUtils.test.ts` and
`ProjectSettingsPage.test.tsx`.

### Local date-edit benchmark

Use a local checkout, the [guarded fixture procedure](work-execution-queue.md#local-test-data-handoff)
and a production frontend build served with `npm run preview`. From
`backend/`, preview both fixture sizes against the confirmed local database
and repeat each command with `--apply`.

```sh
DJANGO_ENV=development OFP_LOCAL_TEST_DATA=1 pdm run python manage.py \
  seed_planting_plan_edit_benchmark --username LOCAL_USER --database-name LOCAL_DATABASE --plans 24
DJANGO_ENV=development OFP_LOCAL_TEST_DATA=1 pdm run python manage.py \
  seed_planting_plan_edit_benchmark --username LOCAL_USER --database-name LOCAL_DATABASE --plans 640
```

Open the fixture's **Planting Plans** table in season 2026 at a desktop
viewport. In Planned, Actual and Combined, alternate March 8 and March 9 on
the first annual plan's planting date. Use double-click and Enter to open
the editor. For the missing execution date, search for **Benchmark missing
actual** and record its suggested date. Search for **Benchmark perennial
apple** to exercise the occurrence endpoint for an August harvest on a
carried-over plan. Clear search for the regular cases so the full table is
visible.

Warm each path once, then measure at least 12 saves with the same browser,
viewport and network conditions on both revisions. Time edit entry from the
input event to a focused field and the following paint. Time saves from Enter
to pending feedback, the write response, the paint with the confirmed value
and the end of background requests. Browser Performance and Network capture
rendering work, request counts and response sizes. Measure server time and SQL
separately to isolate request latency. Compare p50/p95 without establishing
environment-dependent timing assertions in CI.

### Local Crop Calendar capacity fixture

From `backend/`, preview the private fixture with your confirmed local database
name and an existing local username. After inspecting the target, repeat with
`--apply`.

```sh
DJANGO_ENV=development OFP_LOCAL_TEST_DATA=1 pdm run python manage.py seed_bed_capacity_acceptance --legend --username martin --database-name LOCAL_DATABASE
```

Open **Crop Calendar capacity legend acceptance** and turn on **Show free areas**
in **Field occupancy**. Clear **Only occupied beds** to show the empty bed.
In April, check **Unused bed**, **Carrot and lettuce**, and **Full bed** for the
three legend states. The overlapping carrot and lettuce plans leave 2 m² free.
Select **Unmeasured planting** to see the missing-usage explanation. In May,
check **Succession during harvest**, where the plans sum to 12 m² on a 10 m² bed
during a permitted harvest overlap. Tab to a band and press Enter, or tap it on
a phone, to check the dates and amounts.
