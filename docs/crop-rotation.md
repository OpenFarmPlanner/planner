# Crop Rotation (Fruchtfolge)

The rotation check warns when a planting plan puts a culture on a bed where
the same plant family grew too recently, says which beds fit better, and runs
the same check when planting plans are copied into a new season. Warnings
**never block saving** — the principle is *explizit statt still*: a conflict
is shown, can be consciously accepted, and stays visible afterwards.

All rules live in one backend service,
[`backend/farm/services/crop_rotation.py`](../backend/farm/services/crop_rotation.py).
Every surface (planting-plan responses, the dialog's live check, the bed
suggestions, the season copy) goes through it, so the frontend never
re-implements a rule. Which beds have room for a plan is decided by one
capacity service as well (see [Bed capacity](#bed-capacity)).

The data foundation — the curated plant-family list, `Crop.crop_family`,
`Crop.rotation_break_years` and the family defaults — is described in
[crop-library-architecture.md](./crop-library-architecture.md#plant-families-pflanzenfamilien).

## The rules

**Scope is the bed.** Only planting plans on the same `Bed` are compared,
across all seasons of the project. A plan without a bed, crop or planting date
cannot be checked yet (status `info`, finding `incomplete`); the table does
not flag it, since there is nothing to fix in the crop data.

**Year occupancy.** A plan occupies every calendar year from its planting date
to its last date: the harvest end, else the harvest start, else the effective
harvest dates from the crop's timing, else the planting date itself. Garlic
planted in October 2025 and harvested in July 2026 occupies 2025 *and* 2026.

**Definition of the break.** `rotation_break_years` is the number of calendar
years **without** the family on the bed in between. A family whose last year
on the bed is `Y` may come back from `Y + break + 1` ("every 4 years" is a
break of 3).

**Effective break.** The culture's own (effective, i.e. a Sorte inherits it
from its Kultur) `rotation_break_years`, otherwise the family's
`default_rotation_break_years`, otherwise none. Each finding says which of the
two applied (`break_source`: `crop` or `family_default`) and which crop row
holds the value (`settings_crop_id`, the general Kultur for a linked Sorte),
so the "Anbaupause … ändern/festlegen" link opens the right crop.

**Stricter break wins.** When two cultures of the same family meet, the
larger of their two effective breaks is used. Only if neither has one is the
pair not checked.

**Conflict.** Another plan on the bed with the same family is a conflict when
it starts no later than the checked plan ends, and the checked plan's first
year is before `(that plan's last year) + break + 1`. Consequences:

- Several plans of the same family in the same year conflict whenever the
  break is at least 1. A break of 0 never conflicts.
- The earlier of two plans is not blamed for a later one: a 2028 plan flags
  the 2026 plan before it, not the other way round. Plans that share a year
  (e.g. garlic into 2026 and onion in 2026) flag each other.
- Green manure cultures are cultures like any other and count with their
  family (Senf is a Kreuzblütler).

**Hint (not a conflict).** The culture has nutrient demand `high`, and walking
back over the previous plans on the bed (latest first) reaches another `high`
culture before any legume (`Fabaceae`) or green manure, and before any culture
with a lower known demand. Cultures without a demand value are stepped over.
A culture counts as green manure when its crop species carries the
`green_manure` category (`CropSpecies.categories`); the seeded species list
does not tag any yet, so today only legumes interrupt the sequence.

**Info — "not checkable".** Only when missing culture data actually blocks a
check, so "no warning" is never mistaken for "checked and fine" and a bed
without history never raises noise. Both have to hold:

1. The bed has at least one *relevant earlier plan*: a plan that started
   before the checked one and whose last year lies inside the culture's
   break window (`last year >= first year - break`). Without a known break
   every earlier plan on the bed counts.
2. At least one of these reasons applies; every one that applies becomes a
   finding of its own:
   - the culture has no plant family (`no_family`, with `crop_label`);
   - the culture has a family, but neither it, its family nor another
     culture of that family on the bed has a break (`no_break`, with
     `crop_label`);
   - a relevant earlier plan's culture has no plant family
     (`previous_no_family`, one finding per such plan, oldest first, with
     `previous_crop_label`, `previous_plan_id`, its last year as `year` and
     its `settings_crop_id`).

A bed without a relevant earlier plan is never "not checkable", whatever data
the culture lacks: it is ok with the kind `no_history` (see below). A
conflict or nutrient hint wins over missing data, as before. Findings carry
only reason codes and the names and years the copy needs; the frontend builds
every sentence through i18n.

**Ok.** Checked, no conflict, no hint. The finding still carries the last year
of the family on the bed and the previous culture ("Vorkultur"). A bed with no
planting plans in the years the check needs to look at (the break window
before the plan plus the plan's own years) is ok too: nothing recorded there
can conflict. Its finding has the kind `no_history` and reads "Fruchtfolge
passt: auf diesem Beet sind keine früheren Anbaupläne erfasst." A culture
without plant family whose bed has no relevant earlier plan gets the same
finding. In the
suggestions and bed options it ranks like any other ok bed.

Status priority: `conflict` (or `accepted`) > `hint` > `info` > `ok`.

## Bed capacity

Suggestions, the bed options of "Anbaufläche ändern" and the planting-plan
table's save check (which rejects an area larger than what is free on the
bed) all use
[`backend/farm/services/bed_capacity.py`](../backend/farm/services/bed_capacity.py),
so a bed that is suggested or selectable is never rejected on save:

- Another plan occupies its bed from its planting date to its harvest end,
  else its harvest start, else its planting date. Two periods overlap when
  they share at least one day.
- Only the *firm* stage of an occupancy counts: up to the minimum gap after
  harvest start (project setting, default 14 days). A follow-up crop may take
  over the bed during the rest of the harvest phase; that overlap is an info,
  not an error. The rules are in [bed-occupancy.md](./bed-occupancy.md).
- The plan being edited never counts against itself (`exclude_plan_id`).
- A plan without an area skips the check, and so does a bed without an area.

The save check asks `GET /planting-plans/remaining-area/` with the row's
bed, planting date, harvest start, period end (harvest end, else harvest
start, unless it lies before the planting date) and crop; without them the
backend derives them from the crop's timing, like the rotation endpoints. The
bed options send the same period to `bed-suggestions`, whose `blocking_plan`
names the last day of the blocker's firm stage. A failed check never blocks
a save.

## Statuses and findings in the API

`PlantingPlanSerializer` adds `rotation_status`
(`conflict | accepted | hint | info | ok`) and `rotation_findings`. Each
finding names the previous culture, its family, the year, the effective break,
the earliest allowed year, and where the break comes from. Families come as
botanical keys (`family_key`, `previous_family_key`, and `family_key` in the
bed history) next to a request-language name; the UI always renders the key
through the plant-family list in the UI language, never the stored name. The serializer
builds one `RotationService` per request: the plant-family list (with
translations) and the project's bed history are loaded once, so a list
response costs a constant number of extra queries (pinned in
`farm/tests/test_api_query_counts.py`).

Endpoints:

- `GET /planting-plans/rotation-check/?crop_id&bed_id&planting_date[&end_date][&exclude_plan_id]`
  — the live check of the planting-plan dialog, before saving. Also returns
  the bed's recorded history for "Belegung von … ansehen".
- `GET /planting-plans/bed-suggestions/?crop_id&planting_date[&end_date][&exclude_plan_id][&area_sqm]`
  — the batch behind the bed options and the suggestions: every bed of the
  project with its rotation status and findings, its category (`good` "Passt
  gut", `fits` "Passt", `hint`, `no_data` "Keine Daten", `conflict`) and its
  capacity in the period (`bed_area_sqm`, `free_area_sqm`,
  `is_partially_occupied`, `has_enough_area`, and the `blocking_plan` that
  frees its area last). Order: ok, hint, not checkable, conflict, and last the
  beds without enough free area for `area_sqm`; within a group the bed whose
  last same-family culture is longest ago comes first (never is best), then a
  legume/green manure as previous crop for a high-demand culture. Without
  `area_sqm` the area is not checked. The response also carries the checked
  period (`start_date`, `end_date`) and `available_count`. "Passt gut" means
  the family was never on the bed, was there more than twice the break ago,
  or the legume plus applies.
- `GET /seasons/{id}/copy-preview/?source_season_id` and the
  `rotation_conflicts` field of `POST /seasons/{id}/copy-from/` — see below.

Without `end_date`, both rotation endpoints derive the plan's end from the
crop's effective timing, like a saved plan would.

## Accepting a conflict

`PlantingPlan.rotation_conflict_accepted_by` / `_at` store who accepted a
conflict and when. The API takes a writable `rotation_conflict_accepted`
flag: `true` stamps the current user and time, `false` clears both. Writing
`true` again while nothing moved keeps the original stamp.

The acceptance is reset automatically by `PlantingPlan.save()` when the crop,
bed, planting date or harvest dates change — unless the same save grants a new
acceptance, so "change the bed and accept the new conflict" works in one
request. The plan is then simply checked again on the next read. An accepted
plan whose conflict disappears shows its real status; the stored acceptance is
harmless and is reset on the next move.

## UI

- **Table**: there is no rotation column. The rotation status sits as a small
  icon button at the right end of the "Standort | Parzelle | Beet" cell, only
  where the user still has something to do: `conflict` (warning triangle)
  and `info` (question circle, missing culture data that blocks a check, see
  the rules above; `incomplete` drafts are not flagged). Accepted conflicts
  and nutrient hints show no icon in the table; they stay visible in
  "Anbaufläche ändern", and accepted ones can be found through the filter.
  The button has an aria-label ("Fruchtfolge-Konflikt,
  Anbaufläche ändern") and a tooltip. For a conflict it shows the finding
  title; for "nicht prüfbar" it lists the reasons, one per line, between
  "Fruchtfolge nicht prüfbar:" and "Du kannst die fehlenden Angaben in der
  Kulturbibliothek ergänzen." (`getMissingDataLines`). A click
  opens the same "Anbaufläche ändern" dialog as a click on the cell. It stays
  out of the grid's tab order, since Enter on the cell opens the dialog too.
  The "Filter" menu has a "Fruchtfolge" filter (multi-select "Konflikt",
  "Akzeptiert", "Nicht prüfbar"); icon, cards and filter all read the status
  through `getTableRotationStatus`, so they never disagree. It is shown in
  the active filter chips like the
  others and kept in memory only ([search.md](./search.md#filters)). Mobile
  cards follow the table and show the icon for conflict and not checkable
  only.
- **"Anbaufläche ändern"** (`AreaAssignmentDialog`): the Standort → Parzelle →
  Beet cascade, then `RotationCheckPanel` for the selected bed, updated live
  when the bed changes: the warning Alert with the "Bewusst so planen
  (Konflikt akzeptieren)" checkbox for a conflict, the outlined Alert with
  "Akzeptieren zurücknehmen" for an accepted one, the hint and "nicht
  prüfbar" Alerts (one line and crop link per missing value), and the
  one-line "Fruchtfolge passt: …" note. An
  acceptance only holds for the bed it was given for and is sent with the
  bed on "Übernehmen" (`rotation_conflict_accepted`).
  - The Beet options come from one `bed-suggestions` batch (with the plan's
    period and area): a status icon, a secondary line with the reason, plus
    "{{free}} von {{total}} m² frei im Zeitraum" for a partly occupied bed;
    ordered as the batch is. A bed without enough room stays visible but
    disabled, with "Nur … m² frei im Zeitraum (Kultur bis Datum), benötigt …
    m²" naming the plan that frees its area last. Without an area on the plan
    only the rotation is checked.
  - "Passende Beete, frei von … bis …" (`AreaBedSuggestions`) is collapsible
    below the status; it starts expanded when the plan's bed has a conflict
    and is toggled by "Passende Beete anzeigen". It lists the top three beds
    of the whole project (all locations and parcels) with enough room and no
    conflict, each with its status icon, the full "Standort | Parzelle |
    Beet" path and one reason line, plus "Alle … passenden Beete anzeigen".
    Clicking one fills the cascade; nothing is saved until "Übernehmen". A new
    row without an area takes the bed's free area in the period.
- **Planting-plan dialog** (`MobilePlanFormDialog`, the mobile create/edit
  form): the same `RotationCheckPanel` below the date fields;
  `useRotationAcceptanceDraft` mirrors the backend reset rule in the form.
  `BedSuggestionsPanel` shows the top five beds with room beside the form on
  desktop and below it on mobile; "Übernehmen" sets the bed in the form.
- **Family names** are always rendered through the plant-family list in the
  UI language (`useFamilyNameResolver`), in alerts, tooltips, suggestions,
  bed options, the bed history and the season copy summary.

## Season copy

`SeasonCopyDataDialog` loads `copy-preview` once a source season is chosen.
The preview builds the shifted copies exactly like the copy itself
(`build_planting_plan_copies`) and checks them against the bed history *and*
each other, since they will all exist afterwards. The section only appears
when there is at least one conflict or hint. For conflicts the user chooses:

- **Ohne Beet übernehmen** (default in the dialog) — the conflicting copies are
  created without a bed (`without_bed`), as open assignments; the user then
  picks a bed with the suggestions.
- **Trotzdem auf dieselben Beete übernehmen** (`keep`) — conflicts stay
  marked in the table.
- **Nicht übernehmen** (`skip`) — only conflict-free plans are copied.

The API default stays `keep`, so existing callers (the "Daten aus Saison X
übernehmen" checkbox when creating a suggested season, external scripts) copy
exactly as before. That creation path does not show the rotation summary yet,
because the target season does not exist before the copy — a follow-up.

## Demo project

The demo project's seed data shows every rotation and capacity case on
purpose, right after it is created; the story behind it is in
[demo-project.md](./demo-project.md#crop-rotation-story).
`DemoRotationCasesTests` in `backend/farm/tests/test_demo_project.py` asserts
each row below, so a template change that breaks a case fails the build.

### Demo cases

All rows are in the current season (German demo names; the English demo has
the same cases).

| Case | Culture | Bed (Standort) | Expected |
| --- | --- | --- | --- |
| Conflict, break from the culture's own `rotation_break_years` | Kartoffel | Kartoffeln 1 (Pachtacker Lindenhof) | Konflikt: Kartoffel two seasons ago, "Bei Kartoffel sind 4 Jahre Anbaupause hinterlegt" |
| Conflict, break from the family default | Brokkoli | Kohlbeet (Pachtacker Lindenhof) | Konflikt: Kreuzblütler default of 4 years |
| Conflict, stricter break of the previous culture | Buschbohne | Bohnen (Pachtacker Lindenhof) | Konflikt: peas last season, the peas' own 5 years apply |
| Conflict, two plans of the same family in one year | Salat (spring and autumn) | Salat 1 (Hofgarten) | Konflikt on both rows |
| Conflict through a plan crossing the year boundary | Lauch | Knoblauch & Lauch (Pachtacker Lindenhof) | Konflikt: garlic planted last October, harvested this July |
| Conflict with a green manure of the same family | Brokkoli | Kohlbeet (Pachtacker Lindenhof) | Konflikt: Senf (green manure) last autumn |
| Accepted conflict | Tomate | Tomatenreihe 1 (Hofgarten) | Konflikt akzeptiert, with the accepting user, date and a note; no table icon, shown in the dialog and under "Fruchtfolge: Akzeptiert" |
| Hint: heavy feeder after heavy feeder | Kartoffel | Kartoffeln 2 (Pachtacker Lindenhof) | Hinweis: zucchini last season; no table icon, shown in the dialog |
| No hint because a legume came in between | Brokkoli | Brokkoli (Pachtacker Lindenhof) | Passt: peas between zucchini and broccoli |
| Info: culture without plant family | Erdbeere | Gründüngung Reserve (Acker am Bach) | Nicht prüfbar: no family; table icon |
| Info: family without any break | Phacelia; Zuckermais | Gründüngung Reserve; Zuckermais (Pachtacker Lindenhof) | Nicht prüfbar: no break; table icon |
| Bed without plans in the relevant years | Karotte | Karotten 2 (Acker am Bach) | Passt: "auf diesem Beet sind keine früheren Anbaupläne erfasst" |
| Ok with a different family as previous crop | Mangold | Kräuter & Mangold (Hofgarten) | Passt, Vorkultur Salat |
| Ok with the same family outside the break | Zucchini | Kürbisbeet (Pachtacker Lindenhof) | Passt: zucchini three seasons ago |
| Conflict whose suggestions include another location | Lauch | Knoblauch & Lauch | "Passende Beete" lists beds in Hofgarten / Acker am Bach |
| Partly occupied bed with enough room | (dialog of the Lauch row) | Zuckermais | Selectable, "12 von 24 m² frei im Zeitraum" |
| Bed without enough room | (dialog of the Lauch row) | Bohnen | Disabled, "Nur 4 m² frei im Zeitraum (Buschbohne bis 10.08.<Jahr>), benötigt 8 m²" |
| Season copy | copy the current season into the next | — | The copy dialog shows conflicts and a hint (Zuckermais after Zuckermais) |

The seed never overbooks a bed (`test_no_bed_is_overbooked`).

## Known limits / follow-ups

- No crop species is tagged `green_manure` yet; tagging species (or adding an
  explicit per-crop flag) is a crop-data follow-up.
- Rotation is checked per bed only, not at Parzelle (`Field`) level.
- The seeded family break defaults still need verification against
  LfL Bayern / Bio Austria (see the crop-library doc).
