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
re-implements a rule.

The data foundation — the curated plant-family list, `Crop.crop_family`,
`Crop.rotation_break_years` and the family defaults — is described in
[crop-library-architecture.md](./crop-library-architecture.md#plant-families-pflanzenfamilien).

## The rules

**Scope is the bed.** Only planting plans on the same `Bed` are compared,
across all seasons of the project. A plan without a bed, crop or planting date
cannot be checked (status `info`, finding `incomplete`).

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

**Info — "not checkable".** Deliberately distinct from "passt", so "no warning"
is never mistaken for "checked and fine":

- the culture has no plant family (`no_family`);
- neither the culture nor its family (nor the other culture) has a break
  (`no_break`);
- the bed has no planting plans in the years the check needs to look at —
  the break window before the plan plus the plan's own years (`no_history`).

**Ok.** Checked, no conflict, no hint. The finding still carries the last year
of the family on the bed and the previous culture ("Vorkultur").

Status priority: `conflict` (or `accepted`) > `hint` > `info` > `ok`.

## Statuses and findings in the API

`PlantingPlanSerializer` adds `rotation_status`
(`conflict | accepted | hint | info | ok`) and `rotation_findings`. Each
finding names the previous culture, its family, the year, the effective break,
the earliest allowed year, and where the break comes from. The serializer
builds one `RotationService` per request: the plant-family list (with
translations) and the project's bed history are loaded once, so a list
response costs a constant number of extra queries (pinned in
`farm/tests/test_api_query_counts.py`).

Endpoints:

- `GET /planting-plans/rotation-check/?crop_id&bed_id&planting_date[&end_date][&exclude_plan_id]`
  — the live check of the planting-plan dialog, before saving. Also returns
  the bed's recorded history for "Belegung von … ansehen".
- `GET /planting-plans/bed-suggestions/?crop_id&planting_date[&end_date][&exclude_plan_id]`
  — every bed that is free in the period (same remaining-area rule as
  `remaining-area`), grouped as `good` ("Passt gut"), `fits` ("Passt"),
  `hint`, `no_data` ("Keine Daten") and `conflict`. Ranking: no conflict, then
  no hint, then the most years since the same family was on the bed (never is
  best); a legume/green manure as previous crop is a plus for a high-demand
  culture. "Passt gut" means the family was never on the bed, was there more
  than twice the break ago, or the legume plus applies.
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

- **Planting-plan dialog** (`MobilePlanFormDialog`, used on mobile and opened
  on desktop from the rotation column): `RotationCheckPanel` below the date
  fields — warning Alert with links and the "Bewusst so planen" checkbox for a
  conflict, an outlined Alert for an accepted one, an info Alert for the
  nutrient hint, a neutral Alert for "nicht prüfbar", and a one-line success
  note when it fits. `useRotationAcceptanceDraft` mirrors the backend reset
  rule in the form, so an acceptance only holds for the crop/bed/date it was
  given for.
- **Bed suggestions** (`BedSuggestionsPanel`): beside the dialog form on
  desktop, below it on mobile; the top five, "Alle … Beete anzeigen", and
  "Übernehmen" sets the bed in the form.
- **"Anbaufläche ändern"** (`AreaAssignmentDialog`, the desktop bed-assignment
  flow) shows the same check below the selects once the row has a crop and a
  planting date. The dialog stays compact; "Passende Beete anzeigen" opens the
  suggestions beside the selects and only then widens it. It has no accept
  checkbox, because the dialog only writes the bed; accepting goes through the
  planting-plan dialog.
- **Table**: the narrow sortable "FF" column (tooltip "Fruchtfolge") shows one
  icon per status, different in shape and not only colour — warning triangle
  (conflict), triangle with check (accepted), info circle (hint), question
  circle (info), check circle (ok). The tooltip carries the finding; a click
  opens the planting-plan dialog. Quick filters "Alle / Konflikte / Akzeptiert
  / Nicht prüfbar" sit under the search toolbar (and on mobile under the list
  header); they are kept in memory only. Mobile cards show the icon for
  conflict, accepted and hint.

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

## Known limits / follow-ups

- No crop species is tagged `green_manure` yet; tagging species (or adding an
  explicit per-crop flag) is a crop-data follow-up.
- Rotation is checked per bed only, not at Parzelle (`Field`) level.
- The seeded family break defaults still need verification against
  LfL Bayern / Bio Austria (see the crop-library doc).
