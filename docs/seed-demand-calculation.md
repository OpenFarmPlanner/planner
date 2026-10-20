# Seed Demand Calculation (Saatgutbedarf)

The Seed Demand page (`/app/seed-demand`, `frontend/src/pages/SeedDemand.tsx`)
answers: *for each crop, across all its planting plans in the active
project, how much seed do we need, and how many packages (of which sizes)
should we buy?*

**The calculation happens entirely on the backend.** The frontend only
renders the result and lets the user pick a supplier per crop.

## Purpose and user interaction

One row per crop, aggregated across every planting plan of that crop
in the project — there's no per-plan or per-project drill-down UI. The only
interaction that changes the underlying data is choosing a supplier from a
per-row dropdown (only shown when a crop has more than one supplier with
seed data); everything else (amount, package suggestion) is read-only,
computed server-side. `frontend/src/pages/requirementFlow.ts`, despite the
name, is *not* part of the calculation — it only decides which "you're
missing setup step X" empty-state card to show when the project has no
fields/beds/crops/plans yet.

## Where the logic lives

| Piece | File |
|---|---|
| Per-plan requirement + aggregation + supplier/TKG/germination resolution | `backend/farm/services/seed_demand.py`, `build_seed_demand_rows()` |
| HTTP layer: request parsing, serialization, supplier-selection POST | `backend/farm/crops/views/seed_demand.py`, `SeedDemandListView` (`GET`/`POST /seed-demand/`) |
| Package-count optimizer | `backend/farm/services/seed_packages.py`, `compute_seed_package_suggestion()` |
| Unit constants + TKG conversion helpers | `backend/farm/seed_units.py` |
| Read-only response shape | `backend/farm/crops/serializers/seed_demand.py`, `SeedDemandSerializer` |
| Display + supplier selection UI | `frontend/src/pages/SeedDemand.tsx` |

## Calculation, step by step

Plans with the cultivation type `purchased_transplant` (bought-in young
plants) need no seed of their own and are excluded before any of the steps
below; they appear in the young-plant demand instead — see
[young-plant-demand.md](./young-plant-demand.md).

For each crop with at least one planting plan:

1. **Per-plan requirement.** Pick the seed rate for the plan's
   `cultivation_type` (direct sowing vs. pre-cultivation have separate rate
   fields; falls back to a generic `seed_rate_by_cultivation` map, then to a
   legacy single rate field). Convert to a quantity using whichever unit the
   rate is expressed in:
   - `g_per_m2` / `seeds_per_m2` → `plan.area_usage_sqm × rate`
   - `g_per_lfm` / `seeds_per_lfm` → `(area_usage_sqm / crop.row_spacing_m) × rate`
   - `seeds_per_plant` → `plan.quantity × rate`

   If the plan's `cultivation_type` is set but isn't (or is no longer) one of
   the crop's enabled `cultivation_types`, the plan is silently excluded
   from the rate lookup.

   External tool API writes should use the `seed_requirements` object on direct
   crop create/update endpoints instead of the flat `seed_rate_*` fields. It
   is a normalized write alias for these per-cultivation seed rates, not a
   total purchase requirement: `value` plus `unit` describes seed per square
   metre, row metre, or target plant. The total seed demand is derived here
   later from the planting plans' area or plant count.

2. **Safety margin.** A per-cultivation-type safety-margin percentage
   (`sowing_calculation_safety_percent_direct` / `_pre_cultivation`, or a
   generic fallback) is applied **per plan, before summing**:
   `required += requirement × (1 + margin_percent / 100)`.

3. **Sum across all of a crop's plans**, keeping grams and seed-count
   totals in separate buckets (a crop can have plans using either unit).
   If any single plan fails to compute a requirement (missing row spacing,
   missing quantity, etc.), the *entire crop's row* is marked as not
   calculable — one bad plan is never silently skipped to produce an
   understated partial total. Remaining plans are still inspected for
   diagnostics so `calculation_blockers` can report every distinct missing
   input.

4. **Supplier resolution**, in priority order: an explicit
   `?supplier_selection=cropId:supplierId` query param (read-only, used
   by the same GET that also displays the result) → the persisted
   `crop.selected_seed_demand_supplier` → if there's exactly one supplier
   option, auto-use it for display **without persisting it** (confirmed by
   a dedicated regression test — see below).

5. **Thousand-kernel-weight (TKG) resolution**: the *selected supplier's*
   `CropSupplierData.thousand_kernel_weight_g` takes priority over the
   *crop's own* `thousand_kernel_weight_g`. Changing the selected
   supplier can therefore change the effective TKG, and with it both the
   displayed gram total and the package suggestion — this is intentional,
   not a bug, if a value looks like it "changed for no reason" after a
   supplier switch.

6. **Germination-rate adjustment**: if the selected supplier has a
   `germination_rate` (0-100%), the margin-adjusted requirement (in whichever
   unit(s) it's currently in) is scaled up by `100 / germination_rate` —
   e.g. an 80% germination rate means 100 required plants need
   `100 / 0.8 = 125` sown seed-equivalents, not 100. This runs *after*
   summing all of a crop's plans and *after* the supplier is selected
   (germination rate is per-supplier data, like TKG), so switching the
   selected supplier can change both the TKG *and* the germination
   adjustment at once. A missing, zero, or out-of-range rate leaves the
   amount unadjusted (treated the same as "no germination data yet"), it
   does not block the calculation or add a warning.

7. **Display amount** is always normalized to grams via the TKG conversion
   above, using the germination-adjusted amount from step 6. If the native
   rate was in seeds and no TKG is available anywhere, the amount can't be
   computed: `required_amount_value = None`,
   `required_amount_warning = 'missing_tkg'` — the UI shows a specific
   "missing TKG" message instead of `0` or a dash.

8. **Package suggestion** (`compute_seed_package_suggestion`): only
   attempted if the selected supplier has `packaging_sizes`. Converts the
   required amount into whichever unit the packages use (grams preferred if
   any package is in grams), then searches combinations of pack counts for
   one that **always rounds up** to at least the required amount — no
   fractional packages are ever suggested. Among valid combinations, it
   prefers (in order): fewer total packages, fewer/no "excessive" small
   packages, fewer distinct sizes, and only then minimal overage — a
   scoring tradeoff, not a pure "minimize waste" search. If package sizing
   uses a *different* unit than the native seed-rate unit and no TKG is
   available for that conversion, `required_amount_value` can be `None`
   while a `package_suggestion` is still present (or vice versa) — this
   inconsistent-looking pairing is expected, see the "missing TKG" example
   below.

## Calculation diagnostics

The API preserves the legacy `warning` and `required_amount_warning` fields
for compatibility and additionally returns stable, non-localized diagnostics:

- `calculation_blockers`: all distinct inputs preventing `Gesamtbedarf`
  from being calculated, such as `missing_seed_rate`, `missing_area`,
  `missing_plant_quantity`, `missing_row_spacing`, or `missing_tkg`.
- `package_blocker`: the reason no package suggestion exists, such as
  `required_amount_unavailable`, `supplier_data_missing`,
  `supplier_not_selected`, `package_sizes_missing`,
  `unit_conversion_unavailable`, or `no_matching_package_sizes`.

The frontend only prioritizes and localizes these codes. Calculation and
package-availability rules remain in `farm/services/seed_demand.py`.

## Worked examples (from `backend/farm/tests/test_seed_demand.py`)

**A — safety margin, single package size ("Carrot").**
Seed rate `10 g/m²`, safety margin `10%` (direct sowing). Two planting
plans, 5 m² each → 10 m² total.
`10 m² × 10 g/m² = 100 g`, `× 1.10 = 110 g` → `required_amount_value = 110.0`.
Supplier package: 25 g each → `ceil(110 / 25) = 5` packages (125 g total,
15 g overage).

**B — cross-unit conversion via TKG ("Spinach").**
Seed rate `20 g/m²`, no margin, 5 m² → `100 g` required.
Crop's own TKG = 10 g/1000 seeds, but the **selected supplier's**
`thousand_kernel_weight_g = 2` — this overrides the crop's TKG.
Supplier packages are sized in **seeds** (5000/pack), so the 100 g
requirement is converted to seed count using the supplier's TKG:
`100 g / 2 g × 1000 = 50,000 seeds` → `ceil(50000 / 5000) = 10` packages.
This is the clearest example of "supplier TKG overrides crop TKG,"
because the same 100 g requirement would need a very different package
count with the crop's own TKG of 10.

**C — missing TKG ("Beetroot" / "Kresse").**
Seed rate is `seeds_per_m2`, but no TKG exists anywhere (neither crop nor
supplier). Result: `required_amount_value = None`,
`required_amount_unit = 'g'` (the display unit is fixed even though the
value couldn't be computed), `required_amount_warning = 'missing_tkg'`. A
package suggestion can *still* be produced if the supplier's packages are
sized directly in seeds (no conversion needed) — so it's normal to see a
package suggestion next to a "missing TKG" warning in the same row.

**D — germination-rate adjustment.**
Seed rate `10 g/m²`, no margin, 10 m² → `100 g` raw requirement. Selected
supplier's `germination_rate = 80`. Adjusted requirement:
`100 g / (80 / 100) = 125 g` → `required_amount_value = 125.0`. A supplier
with 25 g packages now needs `ceil(125 / 25) = 5` packages instead of the 4
that the unadjusted 100 g would have needed — the extra pack exists purely
to cover expected germination loss.

## Edge cases

- **No supplier data at all** → warning `"Keine Lieferantendaten
  vorhanden."`, no package suggestion; the UI links to editing the crop.
- **Multiple suppliers, none selected** → the frontend forces an explicit
  choice; nothing is auto-computed or persisted until the user picks one.
- **Exactly one supplier** → auto-used for the calculation but never
  written to the database (there's no interaction available to trigger a
  write in that state anyway).
- **`CropSupplierData.germination_rate` inflates the required amount**
  (see step 6 above and example D) using the *selected supplier's* rate —
  switching suppliers can change the displayed amount and package
  suggestion via germination rate as well as via TKG.
- **Historical package-size changes are not considered.** The calculation
  always reads the *current* `CropSupplierData.packaging_sizes` and
  current crop/supplier fields — `CropRevision` (deprecated, see
  [versioning-and-history.md](./versioning-and-history.md)) is not consulted,
  so there's no point-in-time "what would this have cost last season"
  calculation.

## Unit conversion implementation

`backend/farm/seed_units.py` defines the reusable TKG conversion helpers
(`seeds_to_grams`, `grams_to_seeds`, `are_units_convertible`), and
`farm/services/seed_demand.py`'s `convert_requirement_to_unit` calls them
directly rather than reimplementing the formula — there is one place to
change the conversion rule if it ever needs to change.

## Unclear / needs check

- Whether the seed-demand UI should surface *which* rates (TKG,
  germination) were applied to a given row, since both are now silently
  supplier-dependent and can make the displayed number change for reasons
  that aren't visible without opening the crop/supplier data.
