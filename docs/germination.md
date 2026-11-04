# Germination

Project crops and library entries carry optional germination information:
optimal temperature endpoints (`germination_temperature_optimal_min_c`,
`germination_temperature_optimal_max_c`), minimum temperature
(`germination_temperature_min_c`), germination time endpoints
(`germination_days_min`, `germination_days_max`), `germination_types`
(`cold`, `frost`, `light`, `dark`, multiple selections), and free-text
`germination_pretreatment`. Temperatures use degrees Celsius, as named by
the API fields; times use whole, non-negative days. Temperatures must be
finite and at least −273.15 °C. When both endpoints exist, maximum must be
at least minimum. Empty endpoints are allowed.

All seven fields use ordinary Sorte → Kultur inheritance, with each own
value overriding its Kultur's value. They are not species-invariant. They
participate in library publication, import, edits/proposals, revisions,
update differences, explicit field sync and local pinning.

The shared crop form offers a Germination block next to timing, including
from–to inputs. Crop details and library details show the values. Spreadsheet
and JSON exchange preserve each field. Sheets additionally accept range
columns (`Keimtemperatur`, `Keim-temperatur (°C)`, `Keimdauer`,
`Keim-dauer (Tage)`), with `18-25` or `18–25` syntax; a single number sets
both endpoints. Individual requirement columns (`Kaltkeimer`, `Frostkeimer`,
`Lichtkeimer`, `Dunkelkeimer`) supplement the multiple-choice column.
These normalize before the preview difference and apply use the same values.

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
