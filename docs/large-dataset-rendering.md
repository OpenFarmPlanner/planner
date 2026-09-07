# Large-dataset rendering

## Reproduction

The Large Scale Performance Test project contains more than the Django REST
Framework default page size of 100 planting plans and enough occupied beds to
stress the calendar renderer.

The local fixture used during verification contained 2,400 beds and 5,000
planting plans.

Small projects did not expose either failure because their complete data fit in
the first API response and the Gantt DOM remained small.

## Root causes

### Planting plans

The backend correctly paginates list endpoints at 100 records. The shared
editable grid called only the first planting-plan URL and therefore never
received later API pages. Its `autoHeight` layout then made the first 100 rows
look like a rendering cutoff rather than an API truncation.

### Field planning

The calendar had two compounding limits:

1. Locations, fields, beds, crops, and planting plans were loaded from only
   the first API page.
2. `react-modern-gantt` does not virtualize rows. It performs collision
   detection several times per group and mounts every row and task item. Large
   complete datasets can therefore leave the timeline header visible while the
   body is still overwhelmed by synchronous React, layout, and paint work.

The chart uses DOM elements, so browser canvas-size limits were not involved.
No client-side filter or performance guard intentionally returned an empty
result.

## Fix

- Analysis pages use `fetchAllPaginated` (`frontend/src/api/api.ts`) to follow
  every backend `next` link.
- Bulk reads request up to 1,000 records per response through a bounded DRF
  page-size override; normal API lists still default to 100. Both numbers live
  in `backend/config/pagination.py`
  (`OpenFarmPlannerPageNumberPagination`: `page_size_query_param = "page_size"`,
  `max_page_size = 1000`) and `PAGE_SIZE` in `backend/config/settings.py`.
- The planting-plan grid loads the complete paginated API result up front, then
  uses the same scroll-driven internal DataGrid row window as the field/bed
  hierarchy. No pager UI is shown; persistent sorting and filtering remain
  active over the complete loaded dataset, not just the currently mounted
  internal row window.
- Adding or deep-linking to a plan moves the internal row window to the row
  containing the new or targeted record so it is visible and editable.
- Field planning uses a continuous scroll-driven render window. Only visible
  rows plus overscan, capped by timeline-item count, are passed to
  `react-modern-gantt`. The complete dataset remains in React state.
- Occupancy task construction indexes planting plans by bed once instead of
  scanning every planting plan again for every bed.
- The virtual viewport always renders at least one group when data exists and
  retains the existing error boundary if the dependency throws.

Development-only diagnostics report total planting plans, total beds, total
Gantt rows, visible Gantt rows, and rendered timeline items. Production builds
do not emit these diagnostics.

## Scroll cost in the loaded grid

Loading every page fixed *what* the grid shows; it did not make moving through
it cheap. Measured on the fixture above (5,000 planting plans, 2,400 beds,
1440x900, production build), 200 wheel steps through the planting-plan grid
took 86s of main-thread work — a median of 413ms per frame, i.e. a table that
visibly lurches rather than scrolls. Three causes, each independent of how
many rows are loaded:

- **A React render per scroll frame.** `useStableDataGridScrollbar` pushed the
  scroll container's `scrollTop` into component state on every animation
  frame, so the whole `EditableDataGrid` — rows, cells, editors, and a `sx`
  object emotion had to re-serialize — re-rendered dozens of times a second
  to move a 24px thumb. The thumb's position is now written straight to its
  DOM node; only values that change rarely (whether the scrollbar exists,
  how tall the thumb is) still go through state.
- **Per-cell derivation of shared data.** Every growing-area cell renders an
  `AreaAssignmentDialog`, and each one rebuilt the location/field/bed
  hierarchy from the same three arrays on mount — thousands of object
  allocations for every row scrolled into view. `getAreaHierarchyIndex`
  (`areaHierarchySelection.ts`) derives it once per array identity and hands
  the same index to every cell.
- **A fresh `Intl.NumberFormat` per formatted value.** Constructing one costs
  far more than formatting with it, and grid cells format on every render;
  this alone was ~18% of scroll time. `formatLocalizedNumber` now keeps one
  formatter per (locale, options) pair.

Grid props that were rebuilt on every render (`localeText`, `sx`, the
selection `Set`, and the footer *component itself*, which React remounted as a
new type each pass) are memoized for the same reason: MUI hands every grid
prop to its internal components as one root-props object, so one unstable
prop re-renders every mounted row.

The same 200-step scroll now takes 8.4s with a median frame of 28ms, and no
single function dominates the remaining profile.

## Scrollbar geometry at the end of the list

The custom thumb used to overflow past the bottom of its track once the last
internal page was reached — on a short last page it visibly hung below the
table. MUI renders the column headers inside `.MuiDataGrid-virtualScroller`,
so the container's `clientHeight` includes them, while the track is drawn
below the header; the thumb has to travel the rows-only height. See
[datagrid-architecture.md](./datagrid-architecture.md) for the rule both
callers follow.

The internal pages are also *balanced* (`getBalancedPageSize`) rather than
filled to 100 rows with a remainder on the last one: 209 rows page as
70/70/69, not 100/100/9. Both grids size themselves to the rows their current
page holds, so a nine-row final page collapsed the whole table to a fraction
of its height the moment the user scrolled to the end — it looked like the
table had half disappeared. Balanced pages stay far taller than the viewport,
so the table keeps its height from the first row to the last, and the end of
the list still ends with rows filling the viewport rather than dead space. A
dataset that fits on a single page keeps sizing to its content.
