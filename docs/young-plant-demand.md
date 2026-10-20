# Bought-in Young Plants and the Young-Plant Demand (Jungpflanzenbedarf)

Planting plans can be grown from bought-in young plants instead of the
farm's own propagation (Anzucht). The Young-Plant Demand page
(`/app/young-plant-demand`, `frontend/src/pages/YoungPlantDemand.tsx`)
answers: *how many young plants of which crop and variety do we have to
order for which planting week of the active season?* It is the counterpart
of the [Seed Demand](./seed-demand-calculation.md) page.

## The cultivation type `purchased_transplant`

`PlantingPlan.cultivation_type` has three values:

| Value | DE (long / short label) | Meaning |
|---|---|---|
| `direct_sowing` | Direktsaat / Direktsaat | Sown directly into the bed. |
| `pre_cultivation` | Pflanzung (eigene Anzucht) / Pflanzung | Raised on the farm, then planted out. |
| `purchased_transplant` | Pflanzung mit gekauften Pflanzen / Pfl. Zukauf | Planted out from bought-in young plants. |

`purchased_transplant` is **plan-only**: a crop's `cultivation_types` (and
its deprecated single `cultivation_type`) still only know `direct_sowing`
and `pre_cultivation`, and the crop form is unchanged. Bought-in plants are a
way of transplanting, so the option is selectable for a plan exactly when
the crop allows `pre_cultivation`
(`getAllowedCultivationTypesForCrop` in `frontend/src/pages/plantingPlansUtils.ts`).
Adding the value was a choices-only migration; existing plans keep their
values.

Consequences of `purchased_transplant`:

- **No Anzucht.** `getPlanSowingSchedule` (`frontend/src/pages/planSowingDate.ts`)
  reports `isPurchasedTransplant: true`, `isPreCultivation: false` and no
  sowing date. The coupled Aussaattermin column therefore stays empty with
  the tooltip "Keine eigene Anzucht, die Pflanzen werden zugekauft.", the
  plan does not appear in the Anzucht view of the calendar, and its
  occupancy bar starts at the planting date (as for every plan). The
  location task list shows a planting task, never a propagation start.
- **No seed demand.** `farm/services/seed_demand.py` excludes these plans.
- **Season boundary unchanged.** The planting date must still lie inside
  the season (`PlantingPlanSerializer._validate_planting_date_within_season`).

## Short and long labels

The cultivation-type column of the planting-plans table must not get wider
because of the third option. Every option therefore has a **short label**
(`plantingPlans:cultivationTypes.*`) and a **long label**
(`plantingPlans:cultivationTypesLong.*`):

- The table cell and the closed edit select show the short label. When it
  differs from the long label, the cell shows the long label as a tooltip.
- The open select menu, the mobile edit sheet, the filter options, the
  mobile card list and the copy/export values use the long label. The menu
  may be wider than the column.
- Search matches both labels.
- The column width is derived from the header and the longest **short**
  label of the active language
  (`estimateCultivationTypeColumnWidth` in `usePlantingPlanHierarchy.ts`);
  spaces and full stops count as half a character, so the abbreviated short
  labels do not widen the column. A unit test pins that no language got a
  wider column than before.

## Where the demand logic lives

| Piece | File |
|---|---|
| Plant count of one plan (area × plants per m² from the effective spacing) | `backend/farm/services/plant_count.py`, `compute_plan_plant_count()` |
| Grouping, sums, reserve | `backend/farm/services/young_plant_demand.py`, `build_young_plant_demand_rows()` |
| HTTP layer (`GET /young-plant-demand/?reserve_percent=…`) | `backend/farm/crops/views/young_plant_demand.py` |
| Response shape | `backend/farm/crops/serializers/young_plant_demand.py` |
| Page, formatting, reserve storage | `frontend/src/pages/YoungPlantDemand.tsx`, `youngPlantDemandFormat.ts`, `youngPlantDemandReserve.ts` |

`compute_plan_plant_count()` is the same function the planting-plans API
uses for its `plants_count` column, so the demand always matches the plant
count shown next to the plan. The plants are bought, not sown: germination
rate and seed safety margins do not apply.

## Calculation

1. Select the active season's plans (`X-Season-Id`, like every other
   season-scoped surface) with `cultivation_type = purchased_transplant`
   and a crop.
2. Per plan: `plant_count = round(area_usage_sqm × plants_per_m2)` with
   `plants_per_m2 = 10000 / (row spacing cm × in-row spacing cm)` from the
   crop's effective (inherited) spacing. Missing area or spacing yields a
   blocker (`missing_area`, `missing_plant_spacing`) instead of a number.
3. Group by crop (Kultur + Sorte are one crop row) and ISO planting week
   (Monday–Sunday). Plans without a planting date form one group per crop
   after all dated weeks.
4. Sum the per-plan counts. If any plan of a group has a blocker, the group
   total is `null` and the blockers are listed: the page shows
   "Stückzahl nicht berechenbar: Pflanzabstand fehlt" instead of a number —
   never a silent zero. The per-plan counts stay visible in the expanded
   row.
5. Reserve for losses: `plant_count_with_reserve = ceil(plant_count × (1 +
   reserve_percent / 100))`. The reserve is a visible field on the page
   ("Reserve für Ausfälle", 0–100 %, default 10 %), sent as the
   `reserve_percent` query parameter. It is a per-viewer convenience stored
   in the browser per project (`ofp.youngPlantDemand.reservePercent.<projectId>`),
   not project data; the server clamps invalid values to 0–100 and treats
   unparseable input as 0.

## Page

Same navigation and layout as the Seed Demand page: a sidebar entry after
Saatgutbedarf, the page help, a row context menu (open/edit crop, copy row,
copy table) and no file export (the Seed Demand page has none either).
Columns: Kultur, Sorte, Pflanzwoche (KW and date range), Stückzahl (with
reserve; the tooltip shows the breakdown) and Anbaupläne / Beete. Each row
expands into its planting plans (area, planting date, m², count). At 375 px
the Sorte column folds under the crop name and the m² detail column is
hidden.

Empty state: "In dieser Saison sind keine Pflanzungen mit gekauften Pflanzen
geplant." with a link to the planting plans.

## Tests

- `backend/farm/tests/test_young_plant_demand.py` — grouping, season scope,
  reserve rounding, blockers, the seed-demand exclusion and the shared plant
  count.
- `backend/farm/tests/test_api_query_counts.py` — constant query count of
  `GET /young-plant-demand/`.
- `frontend/src/__tests__/YoungPlantDemand.test.tsx`,
  `planSowingDate.test.ts`, `plantingPlansUtils.test.ts`,
  `usePlantingPlanHierarchy.test.ts` (column width), `ganttChartUtils.test.ts`.
