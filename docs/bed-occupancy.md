# Bed occupancy (Beetbelegung) and harvest overlaps

How much of a bed a planting plan occupies over time, when a plan no longer
fits on its bed, and when a follow-up crop (Folgekultur) may already take over
the bed during the harvest phase of the previous crop (Vorkultur). Farms often
harvest earlier, clear the bed and prepare it before the planned harvest end;
the check models that instead of rejecting such plans.

One service answers every capacity question:
[`backend/farm/services/bed_capacity.py`](../backend/farm/services/bed_capacity.py).
The planting-plan table's save check, the bed options and suggestions of
"Anbaufläche ändern" (see [crop-rotation.md](./crop-rotation.md#bed-capacity)),
the live info in the planting-plan dialog and the overlap infos on saved plans
all use it, so a bed that is offered is never rejected on save.

## Firm and soft occupancy

A plan occupies its bed from its planting date (the planting date for
transplants, the sowing date for direct sowing — both are stored as
`planting_date`) to its harvest end, else its harvest start, else its planting
date. Plans without a bed or planting date never count. Two periods overlap
when they share at least one day (inclusive bounds).

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

  The serializer builds one `HarvestOverlapIndex` per request: the project's
  bed occupancies (with species translations for the crop labels) are loaded
  with a constant number of queries, pinned in
  `farm/tests/test_api_query_counts.py`.
- `GET /planting-plans/remaining-area/?bed_id&start_date[&end_date][&harvest_start_date][&crop_id][&exclude_plan_id][&area_sqm]`
  is the save check. Without `end_date`/`harvest_start_date` the backend
  derives them from the crop's timing. It returns the free area in the plan's
  firm stage (`remaining_area_sqm`), the plan's `harvest_overlaps` (needs
  `area_sqm`) and `succession_limit` — the previous crop's label, harvest
  start, the minimum gap and the earliest follow-up date — for the error
  message; `succession_limit` is null when the project setting is off or the
  previous crop has no harvest start.
- `bed-suggestions` uses the same rule; its `blocking_plan.end_date` is the
  last day of the blocker's firm stage.

## UI

- **Planting-plan table:** a small info icon (theme `info` colour) with the
  overlap lines as tooltip in the "Ernteende" cell of every affected row, and
  in the secondary line of the mobile cards. No chips or badges above the
  table. The filter panel's "Belegung" group offers "Ernteüberlappung", which
  shows previous and follow-up crops of allowed overlaps (kept in memory only,
  like the rotation filter). After every write in the table the overlaps of
  all plans are refetched, because a write can add or remove overlaps on other
  plans of the bed.
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

Texts: "Ernte endet spätestens am {Datum} (Folgekultur {Kultur})." on the
previous crop, "Wird während der Erntephase von {Kultur} gesetzt (geplantes
Ernteende {Datum})." on the follow-up crop, one line per plan. Severity info,
not warning: the overlap is deliberate, allowed planning.

## Tests

`backend/farm/tests/test_bed_capacity.py` covers the rules (overlap only in the
soft stage → info, in the firm stage → error, harvest phase shorter than the
gap, switch off, gap 0, partial areas of several plans, several follow-ups on
one previous crop, the symmetric check, `remaining-area` and the list fields).
Frontend: `HarvestOverlapInfo.test.tsx`, `AreaValidationDialog.test.tsx`,
`plantingPlanSearch.test.ts`, `ganttChartUtils.test.ts` and
`ProjectSettingsPage.test.tsx`.
