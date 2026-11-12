# Germination

Project crops and library entries carry optional germination information:
optimal temperature endpoints (`germination_temperature_optimal_min_c`,
`germination_temperature_optimal_max_c`), minimum temperature
(`germination_temperature_min_c`), germination time endpoints
(`germination_days_min`, `germination_days_max`), two independent requirements,
optional stratification ranges, and free-text
`germination_pretreatment`. Temperatures use degrees Celsius, as named by
the API fields; times use whole, non-negative days. Temperatures must be
finite and at least −273.15 °C. When both endpoints exist, maximum must be
at least minimum. Empty endpoints are allowed.

The temperature requirement (`germination_temperature_requirement`) is blank
(unknown), `none`, `cold_stratification`, or `frost_treatment`. The light
requirement (`germination_light_requirement`) is blank (unknown), `none`
(light-independent), `light`, or `dark`. Optimal germination temperatures
remain separate from pretreatment temperatures. Stratification uses nullable
`stratification_days_min/max` and `stratification_temperature_min_c/max_c`.
Either endpoint may be absent; negative temperatures are valid above absolute
zero. The same finite-number, whole-day and ordered-range rules apply.

All fields use ordinary Sorte → Kultur inheritance, with each own
value overriding its Kultur's value. A blank requirement inherits; explicit
`none` overrides a parent's requirement. The two axes inherit independently.
They are not species-invariant. They
participate in library publication, import, edits/proposals, revisions,
update differences, explicit field sync and local pinning.

The shared crop form offers a Germination block after the time windows: the
optimal temperature and the germination time are one range field each
(`RangeField`, "Von"/"Bis" inside one outlined field), the minimum
temperature is a plain field beside them. Temperature pretreatment follows,
then its conditional stratification ranges, the light requirement, propagation
duration, and free-text pretreatment. Stratification ranges are shown only
for cold stratification or frost treatment; hiding them preserves saved values.
Crop details and library details use this same order. Spreadsheet
and JSON exchange preserve each field. Sheets additionally accept range
columns (`Keimtemperatur`, `Keim-temperatur (°C)`, `Keimdauer`,
`Keim-dauer (Tage)`), with `18-25` or `18–25` syntax; a single number sets
both endpoints. Any other text in a range cell ("fk") is reported in the
import preview (code `range_not_recognized`, in the same
per-row `timing_window_issues` list as rejected timing-window cells) and only
that cell is dropped; the rest of the row is imported. Individual requirement columns (`Kaltkeimer`, `Frostkeimer`,
`Lichtkeimer`, `Dunkelkeimer`) supplement the multiple-choice column.
These deprecated aliases normalize before the preview difference and apply
use the same values. New spreadsheets include both enum columns and all four
stratification endpoints; CSV, XLSX and ODS accept localized choice labels
in de/en/fr/es as well as canonical values. Endpoint columns preserve partial
ranges and negative decimal temperatures.

## Compatibility and migration

`germination_types` remains a deprecated API/list field for older clients.
Unambiguous `cold`/`frost` and `light`/`dark` flags map to the corresponding
independent enum. Conflicting flags on an axis leave its enum unknown and
retain the original list; the form warns until a user resolves the conflict.
An unchanged legacy list never erases an explicit `none`. Canonical writes
take precedence and project compatible legacy flags for old readers.

Migration `0139_germination_requirements` adds the six fields to both models
and backfills in batches using historical models. A linked variety's existing
nonempty list historically replaced its parent's entire list, so an absent
axis becomes explicit `none` in that case. Other empty axes stay unknown.
Reversing removes the new fields while retaining legacy flags and notes;
the old schema cannot distinguish explicit `none` from unknown. Immutable
history is interpreted on restore rather than rewritten.

Library sync and publishing protect enum pins from writes through the legacy
list. A pin on that legacy list protects both axes; an individual axis pin
also excludes the composite list while allowing the other axis to sync.

## Planning hints

`farm/services/germination_check.py` owns weather-independent checks.
It shares the request's general-crop and timing-window indexes with
`TimingWindowChecker`, so list serialization adds no per-plan queries.
Saved plans and the existing `GET /planting-plans/timing-window-check/`
live check expose `germination_findings` and `expected_emergence`.

- `cold_period_required`: cold/frost seeds sown from April 1 through August 31
  need a cold period. A matching effective sowing window suppresses this hint
  (`direct_sowing` for direct sowing, `pre_cultivation` for own propagation).
  A planting window does not replace the sowing rule.
- `propagation_shorter_than_germination`: own propagation duration is below
  the maximum germination time. The crop form also shows this hint.
- `expected_emergence`: `{min, max}` ISO dates computed from the sowing date
  plus the germination endpoints. With just one endpoint, both dates use it.
  Missing or unrepresentable dates yield null.

For direct sowing, planting date is sowing date. For own propagation, subtract
its effective propagation duration (zero is valid); without a duration no
sowing/emergence date can be computed. Bought-in plants have neither these
hints nor expected emergence. Hints never block saving. The plan dialog
shows hints and emergence, and table/card icons expose the same information.
No temperature suitability check is performed; that needs weather/location
data and belongs to #872.

Migration `0126_add_crop_germination` adds nullable numeric, blank text and
empty-list fields to `Crop` and `PublicCrop`. It is schema-only and reversible;
reversing it removes any entered germination data.
