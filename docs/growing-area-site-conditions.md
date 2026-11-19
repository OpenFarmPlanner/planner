# Growing areas: site conditions, list toolbar and details

Issue #1075 (epic #912). This page records how site conditions of locations
(Standorte), fields (Parzellen) and beds (Beete) are stored and inherited, how
the Growing Areas list searches and filters them, and how the entity detail
pages work.

## Site-condition data

All values are optional. Legacy rows without them stay valid and unchanged.

| Property | Stored on | Values | Inherited |
| --- | --- | --- | --- |
| `light_condition` | location, field, bed | `sunny`, `partial_shade`, `shade` | yes |
| `soil_moisture` | location, field, bed | `dry`, `normal`, `moist` | yes |
| `irrigation` | location, field, bed | `available`, `unavailable` | yes |
| `soil_type` | location (existing field), field, bed | `sand`, `loam`, `clay` | yes |
| `soil_description` | location, field, bed | free text | no |
| `wind_exposure` | location, field, bed | free text | no |
| `water_supply` | location, field, bed | free text | no |
| `cultivation_environment` | field only | `open_field`, `polytunnel`, `greenhouse` | no |
| `exposure` (slope orientation) | location only (existing field) | `north`, `south`, `east`, `west`, `flat` | no |

`soil_moisture` is the soil's **typical long-term** moisture, not a measured
current value. Its UI label is just "Feuchtigkeit" / "Moisture" (the site
context already says it is about the soil), with the values Trocken / Frisch /
Feucht (en: Dry / Moderately moist / Moist); the stored values stay `dry`,
`normal`, `moist`. Wherever the label appears (column header, filter, detail
form and page) an info tooltip states the long-term meaning
(`hierarchy:siteConditions.help.soil_moisture`).

Decisions:

- **Empty means "not specified here", never a value.** `irrigation = null`
  is unknown; `unavailable` is an explicit statement. Filters and the UI keep
  the two apart ("Not specified" vs "Not available"). Irrigation availability
  is not proof that a bed is watered and says nothing about soil moisture.
- **`Location.exposure` is slope orientation**, not light. It is shown as
  "Slope orientation" and stays separate from the light conditions and from the
  graphical view's rotation. It is not inherited.
- **Soil type reuses `Location.soil_type`** as the location default; fields and
  beds got their own nullable override column with the same choices. There is
  no second soil-type model.
- Descriptive texts and notes belong to the entity they were entered on and
  are never copied down the hierarchy. Dimensions (#1190) are geometry, not
  inherited environment.
- The cultivation environment is recorded only; no climate or frost
  adjustment is derived from it (#872).

## Inheritance

For each inherited property the **effective value** is the nearest explicitly
set value along bed → field → location, otherwise unknown. Changing a parent
never touches explicit child values. "Reset to inherited" clears the child's
own value (`null`).

The rule lives in exactly one backend service,
`backend/farm/services/site_conditions.py`. Every structure serializer exposes
the read-only `effective_site_conditions` (value, source level, source id and
name per property); the list endpoints read the parent chain from their
existing `select_related`, so the query count is flat
(`test_api_query_counts.py`). Crop-to-bed hints read the same effective
conditions from this service.

The frontend recomputes the same values locally in
`frontend/src/components/hierarchy/utils/siteConditions.ts`, so a changed
location default shows on its fields and beds at once. Both implementations
are pinned to the same cases by `tests/fixtures/site_conditions.json`.

Duplicating a field or a bed copies the structured conditions (like the
dimensions) but not the texts or notes.

## Site suitability in planning

The planting plan's site hints use `check_site_suitability` for both saved plans
and the rotation-check preview. A known effective light value outside the
crop's suitable choices produces an advisory hint. `sunny` on the bed maps to
`full_sun` on the crop. The water hint requires high crop water needs, dry soil
and explicit unavailability of irrigation. A missing required input suppresses
its hint. The explanation shows inherited sources, and plans remain saveable.

For a local check, preview this fixture from `backend/`, then repeat with
`--apply` after confirming the printed database target.

```bash
DJANGO_ENV=development OFP_LOCAL_TEST_DATA=1 pdm run python manage.py \
  seed_crop_site_acceptance --username LOCAL_ACCOUNT --database-name EXACT_LOCAL_DATABASE
```

In **Crop site suitability acceptance**, edit **Site suitability crop** and
confirm that Full sun and Partial shade are selected. In Planting Plans, open
the saved plan's area assignment. **Inherited bed** shows light and water hints
with their sources. Selecting **Sunny override bed** removes both hints and
the plan can still be saved. Re-running the fixture preserves manual edits.

## Growing Areas list: Search / Filter / Columns

The toolbar above the grid is the shared
`components/data-grid/DataGridSearchToolbar.tsx`, also used by the planting
plans (`PlantingPlanSearchToolbar` is a thin wrapper). The filter chip groups
(`components/filters/FilterChipGroup.tsx`) and the active-filter chips
(`components/filters/ActiveFilterChips.tsx`) are shared as well; the domain
logic stays separate: `components/hierarchy/utils/growingAreaSearch.ts` here,
`pages/plantingPlanSearch.ts` for plans.

- Search and filters follow [search.md](./search.md#growing-areas): AND across
  terms and filters, OR within a filter. Filters: location, field, light, soil
  moisture, irrigation; the three condition filters match the **effective**
  value, also while their columns are hidden, and offer "Not specified".
- Every match keeps its parent rows, which are expanded once when the matches
  change (a parent collapsed afterwards stays collapsed). Unsaved draft rows
  are never filtered out.
- The filters apply only to the list (desktop grid and mobile list), never to
  the graphical view.
- Light, Moisture and Irrigation available are optional grid columns,
  hidden by default (`useColumnVisibility`'s `defaultHiddenFields`, persisted
  under `tableColumns.fieldsBedsHierarchy`). They show the effective value;
  an inherited value is grey with an "Inherited from …" tooltip. They edit
  inline like the other cells; the first option, "Inherit (…)", is the inline
  reset. New, unsaved rows get their conditions after the first save. Soil type
  and the texts are edited on the detail page only.

## Detail pages

Routes (`components/hierarchy/details/hierarchyDetailRoutes.ts`):
`/app/fields-beds/locations/:id`, `/app/fields-beds/fields/:id`,
`/app/fields-beds/beds/:id`. They are shareable and open from the top entry of
each row's three-dot/context menu ("Location details" …), separated from the
other actions; the mobile list's sheet shows the same entry. A normal cell
click, double click or keyboard action in the grid does not navigate.

- Back and the first breadcrumb return to `/app/fields-beds?highlight=<type>:<id>`,
  which focuses and flashes the row; search and filters come back from the
  session (see search.md). There is no separate Locations menu entry; the
  single location of a project keeps its row and its Details action.
- Read mode shows sections only when they have content: general (parent,
  description, address), dimensions (#1190's location dimensions included),
  site conditions with their source, soil and site texts, the direct children,
  the planting plans of the active season on the covered beds (linking to
  `/app/planting-plans?planId=`, to be pointed at the #1043 detail page once
  it exists), and notes. There is no "show all fields" toggle.
- Edit mode shows every optional field, including empty ones, with "Reset to
  inherited" next to an own value of a field or bed. Leaving with unsaved
  changes is guarded by `useNavigationBlocker`.
- Unknown or foreign ids show a not-found state with a way back (the API is
  project-scoped, so another project's entity is never loaded).
- The section primitives (`components/layout/DetailPrimitives.tsx`) are shared
  with the crop library; there is no universal detail-page abstraction.

Kept extensible for later: pH measurements with date, photos and soil-analysis
attachments are new sections, not new inheritance rules.
