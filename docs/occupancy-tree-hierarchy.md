# Standort → Parzelle → Beet tree in the occupancy calendar

## Where the code lives

| Piece | Location | Generic or OFP-specific |
|---|---|---|
| Tree flattening (`flattenTreeRows`, `collectVisibleIdsWithAncestors`) | `frontend/src/components/hierarchy/utils/treeRows.ts` | **Generic.** Only knows `{id, parentId}`. No farm vocabulary, no MUI, no Gantt import. |
| Expand/collapse state (`useExpandedState`) | `frontend/src/components/hierarchy/hooks/useExpandedState.ts` | **Generic.** Set-based, sessionStorage-backed. Already shared with `FieldsBedsHierarchy.tsx` (DataGrid tree) and `GraphicalFields.tsx` (canvas view) — this is the third consumer. |
| Chevron/indent/collapse rendering, `depth`/`isExpandable`/`isExpanded`/`emptyRowLabel` on `TaskGroup` | `frontend/src/gantt-chart/src/{types,components/task}` | **Generic.** The vendored Gantt component only renders whatever depth/expand hints it's given via props; it has no notion of Standort/Parzelle/Beet. See `TaskList.tsx`'s `isTreeRow` branch and `TaskRow/index.tsx`'s `emptyRowLabel` handling. |
| Building the Standort → Parzelle → Beet node list (`buildFieldOccupancyHierarchy`) | `frontend/src/pages/ganttChartUtils.ts` | **OFP-specific.** Knows about locations/fields/beds/planting plans. |
| Wiring state, filters, search, default expansion | `frontend/src/pages/GanttChart.tsx` | **OFP-specific** (the page). Consumes only the generic pieces above. |

The dependency direction is one-way: `GanttChart.tsx` (app) → `ganttChartUtils.ts` (app) → generic `treeRows.ts` / `useExpandedState` / gantt-chart rendering hints. Nothing generic imports anything domain-specific.

## Data model

`buildFieldOccupancyHierarchy` returns a **flat list** of `OccupancyHierarchyNode` (`type: 'location' | 'field' | 'bed'`, `id`, `parentId`), not a nested breadcrumb string. This replaced the old `hierarchyPath: string[]` convention (`buildFieldOccupancyTaskGroups`, still present and tested for backward compatibility, but no longer used by the page) where every bed row carried its own copy of "Standort / Parzelle / Beet" as a joined label. Now Standort and Parzelle are real rows with their own identity, instead of text duplicated across every bed.

Unlike the old function, `buildFieldOccupancyHierarchy` includes **beds without any planting plan** — the "Nur belegte Beete" filter is what hides them, rather than them never existing in the data at all.

An occupancy task requires a planting date and a calculable harvest start. A
missing harvest end does not remove the plan from the calendar: the harvest
start remains the growth task's endpoint, while no separate harvest-period bar
is rendered. This keeps partially configured crops visible without inventing
an end date for a missing harvest duration.

`GanttChart.tsx` turns this into the rows the Gantt library actually renders:

1. Apply the "Nur belegte Beete" structural filter (removes empty beds and any now-childless field/location ancestors) — independent of expand/collapse state.
2. If search text or a Standort/Parzelle filter is active, compute matched bed ids and expand that set to include all ancestors (`collectVisibleIdsWithAncestors`), so a matching bed's parent chain stays visible for context, bypassing collapse state.
3. `flattenTreeRows` turns the (pruned, possibly filtered) node list into ordered, depth-annotated visible rows, respecting `expandedRows` from `useExpandedState`.
4. Each visible row becomes a `GanttTaskGroup` with `depth`/`isExpandable`/`isExpanded` set and, for Standort/Parzelle rows, an `emptyRowLabel` summary string (bed/occupied/field counts) rendered in the row's timeline area.

The summary counts come from `occupancyStructureSummary.ts`, computed over the **filtered** node set from steps 1-2 — never from the nodes' own `bedCount`/`occupiedBedCount`, which always describe the full tree. Otherwise "Nur belegte Beete", a Standort/Parzelle filter, or a search would leave a Standort claiming more Beete than the view lists. Expand/collapse is deliberately excluded from that filtering: folding a row hides it, it does not remove its beds from the structure. The label text itself comes from the `ganttChart:structureSummary.*` i18n keys, using i18next plural forms (`_one`/`_other`) rather than hand-rolled German suffixes.

That flat `GanttTaskGroup[]` is exactly what feeds into the existing `getGanttRenderWindow` scroll-virtualization (`ganttRenderWindow.ts`), unchanged — the tree is flattened into a flat array *before* windowing runs, so windowing doesn't need to know anything about the tree.

## Default expansion

Locations are always expanded by default. Fields are also expanded by default **unless** the combined location+field+bed node count exceeds `OCCUPANCY_TREE_AUTO_EXPAND_ALL_THRESHOLD` (30, in `ganttChartState.ts`), in which case fields start collapsed. This only applies once per project, on first load with no persisted expand state (`hasPersistedState` + a `hasInitiallyExpandedHierarchyRef` latch, mirroring the identical pattern already used by `FieldsBedsHierarchy.tsx`). After that, the user's manual expand/collapse choices persist via `useExpandedState`'s sessionStorage backing and survive both a page reload and switching the timeline view mode (day/week/month/quarter/year) or the occupancy/seedling calendar mode, since none of those remount the hook.

Small farms (the common case) see a fully expanded tree by default; large ones get a scannable, collapsed-by-default starting point.

## Expanding and collapsing a row

A Standort or Parzelle row that has children is one expand/collapse target: clicking anywhere on it (name, padding, chevron) toggles it, exactly like the chevron alone used to. The chevron is now a decorative icon inside the row, not its own button. The row is `role="button"`, focusable (`tabIndex=0`), toggles on Enter/Space and carries `aria-expanded`. Only rows the host can toggle (`isExpandable` plus an `onToggleGroupExpand` handler) get this; leaf rows (beds) are neither focusable nor `cursor: pointer`, because clicking them does nothing (`data-clickable` marks the clickable ones, `TaskList.tsx`). The "⋮" indicator stops click propagation, so it opens the context menu without toggling. The −/+ level buttons in the column header and row clicks write the same `useExpandedState` set, so they stay in sync.

The hover background (`action.hover`) and keyboard focus ring (`primary.main`) come from the MUI theme via the `.gantt-container-wrapper` `<Box>`'s `sx` in `GanttChart.tsx`; `gantt.css` only carries a library-default focus ring. The "⋮" indicator appears on hover or on *keyboard* focus (`:focus-visible`, not `:focus-within`), so a tap or click on the now-focusable row doesn't leave it covering the name.

The Anbauflächen DataGrid tree deliberately keeps chevron-only toggling: a click on its name cell selects the row and starts inline editing, so its pointer cursor already has an action.

## What's aggregated vs. not

Standort/Parzelle rows currently show a **meta-text summary** in place of bars (`emptyRowLabel`, e.g. "3 Parzellen · 12 Beete · 8 belegt", rendered by `TaskRow` at the start of that row's timeline area — quiet, small, absolutely positioned, and explicitly *not* a bar bound to a month) rather than an aggregate bar rolling up their descendants' planting-plan date ranges. This was a deliberate scope cut — implementing a generic "aggregate child date ranges into a parent bar" concept in the Gantt base component, without leaking farm-specific meaning into it, is a larger piece of work (deciding what "aggregate" means when children have overlapping or gapped ranges, how it renders at different zoom levels, etc.).

**Next step, if this is picked up later:** add an optional `aggregateTasks?: Task[]` (or a `renderEmptyRow?: (group) => ReactNode` render-prop, consistent with the library's existing `renderTask`/`renderTooltip` pattern) to `TaskGroup`, computed by `buildFieldOccupancyHierarchy` per Standort/Parzelle node from its descendant beds' task date ranges, and rendered by `TaskRow` in the same code path that currently renders `emptyRowLabel`.

## Filters and search

The filter bar (`GanttChart.tsx`, occupancy mode only) has: free-text search, a Standort `<Select>`, a Parzelle `<Select>` (populated from the selected Standort's fields, disabled until one is chosen), and a "Nur belegte Beete" checkbox (defaults to checked, matching the old always-hide-empty-beds behavior). Search matches a bed's own name, its field's name, its location's name, or any of its planting plans' crop names, case-insensitively.

The seedling/Anzucht view has its own, much simpler filter bar: free-text search only (`seedlingSearchText`, matching a task group's crop name), no Standort/Parzelle `<Select>`s and no "Nur belegte Beete" checkbox, since that view is a flat, crop-grouped list with no bed/field/location hierarchy at all. Both search fields share one `searchInputRef`/`focusSearch()` pair — only one is ever mounted at a time (gated on `calendarMode`), so the ref always points at whichever field is currently visible. `/` (the `calendar.focusSearch` command) focuses and selects whichever search field is active — the app-wide "jump to search" key, see [keyboard-architecture.md](./keyboard-architecture.md).

## Tests

- `frontend/src/__tests__/treeRows.test.ts` — generic flatten/expand/collapse/filter mechanics, no OFP domain involved.
- `frontend/src/__tests__/gantt-chart/TaskList.hierarchy.test.tsx` (`describe('TaskList tree row expand toggle', ...)`) — row click, Enter/Space, `aria-expanded`, "⋮" not toggling, leaf rows inert; `frontend/e2e/gantt-layout.spec.ts` covers the same in the real page, including the header −/+ buttons.
- `frontend/src/__tests__/ganttChartUtils.test.ts` (`describe('buildFieldOccupancyHierarchy', ...)`) — node construction, parent/child wiring, count aggregation, empty-bed inclusion.
- `frontend/src/__tests__/GanttChart.test.tsx` (`describe('occupancy tree filters and search', ...)`) — end-to-end: search reveals a match with parent context and hides unrelated branches, Standort filter reduces the tree, "Nur belegte Beete" toggles empty-bed visibility. The existing windowing/large-dataset test was updated to expand a field before asserting on scroll virtualization, since large trees now start with fields collapsed by design.
- `frontend/src/__tests__/GanttChart.test.tsx` (`describe('structure summary in the timeline area', ...)`) — summary contents per level, singular/plural, English localization, filter/search/collapse effects on the counts, and that the string is handed to the group's `emptyRowLabel` (timeline) rather than a sidebar field.
- `frontend/src/__tests__/occupancyStructureSummary.test.ts` — the count aggregation and label formatting in isolation.
- `frontend/src/__tests__/gantt-chart/TaskRow.emptyRowLabel.test.tsx` — library-level placement: rendered once, inside the group's timeline row, absent from the left column, at every view mode, and with no effect on row height.
- `frontend/src/__tests__/GanttChart.test.tsx` (`describe('context navigation, double-click, and compact row heights', ...)`) — see "Context navigation" and "Row heights" below.

---

## Context navigation (right-click / long-press, double-click)

Added on top of the tree work above, as part of a broader calendar UX pass.

**Generic (gantt-chart library):**
- `TaskGroup.rowHeightOverride?: number` — lets a caller pin a specific row's height instead of the library's task-count-based computation. Honored by both `TaskList` (left column) and `TaskRow` (timeline row), so the two stay in sync. Unset = unchanged behavior.
- `GanttChartProps.onTaskDoubleClick?: (task, group) => void`, `onTaskContextMenu?: (event, task, group) => void`, `onGroupContextMenu?: (event, group) => void` — new event hooks on bars and tree rows. `onTaskDoubleClick` replaces the previously unused, dead `onTaskDoubleClick?: (task) => void` signature (it was destructured but never wired to anything). Right-click *and* a ~550ms long-press both fire the context-menu callbacks, matching the long-press pattern already used by `useHierarchyContextMenu.ts` in the Anbauflächen DataGrid tree.
- Hover-linking (`onGroupHoverChange`) is **not** part of the public API — it's wired entirely inside `GanttChart.tsx` (the library's core component): hovering a bar in `TaskRow` bubbles a `(groupId, isHovering)` change up, `GanttChart` holds `hoveredGroupId` state, and forwards it to `TaskList`, which sets `data-hover-linked="true"` on the matching row for a dezent CSS highlight (`gantt.css`). No app-level wiring needed.

**OFP-specific (`GanttChart.tsx`):**
- A single `CustomContextMenu` (same positioned-menu pattern as `FieldsBedsHierarchy.tsx`'s context menu: grouped `MenuItem`s with `Divider`s between groups) driven by `getContextMenuActions(target)`, where `target` is either `{type: 'task', task, group}` or `{type: 'group', group}`.
- Task (bar) menu: Anbauplan öffnen, Kultur öffnen (if the task has a crop), Beet/Parzelle/Standort öffnen (if the enclosing group carries that id), then Bearbeiten / Zeile kopieren / Löschen. "Anbauplan öffnen" (and double-click) navigate to `/app/planting-plans?planId=<id>` and just scroll to/select the row; "Bearbeiten" adds `&edit=true`, which additionally opens that row in inline edit mode straight away (`openPlantingPlanFromTask(task, { edit: true })` → `DataGrid`'s `openRowById(rowId, { startEdit: true })`). "Löschen" calls `plantingPlanAPI.delete` after a native `window.confirm`; this intentionally does **not** reuse the app's `DeleteUndoSnackbar` pattern to keep this change scoped — upgrading to it is a reasonable follow-up.
- Group (tree row) menu, based on which id the row's `GanttTaskGroup` carries (`bedId` → Beet actions incl. "Anbauplan hinzufügen"; `fieldId` only → Parzelle actions; `locationId` only → Standort actions).
- Double-click on a bar is a shortcut for "Anbauplan öffnen" — not edit, per the requirement that double-click should be a fast overview→detail jump, not an editing action.

**Deep links to the target row:** "Beet/Parzelle/Standort öffnen/bearbeiten" navigate to `/app/fields-beds?highlight=bed:<id>|field:<id>|location:<id>`. `FieldsBedsHierarchy.tsx` consumes that param: it expands the ancestor chain via the existing `ensureExpanded` (`useExpandedState`), scrolls the target row into view (`gridApiRef.getRowIndexRelativeToVisibleRows` + `scrollToIndexes`), and flashes it briefly (`ofp-hierarchy-row-highlighted`, a 2.5s CSS keyframe fade) so it's easy to spot in a long tree. "Anbauplan öffnen/bearbeiten" navigates to `/app/planting-plans?planId=<id>` (plus `&edit=true` for "bearbeiten") — `PlantingPlans.tsx` resolves that to the *existing* plan row (via the shared `EditableDataGridCommandApi.openRowById`, exposed generically off `DataGrid.tsx` for any page that needs to deep-link into an existing row, with an `{ startEdit }` option) and scrolls to/selects it — or opens it in edit mode straight away, for "bearbeiten" — instead of the earlier `bedId`/`cropId` params, which always prefilled a brand-new draft row via `initialRow`: clicking "öffnen" on an existing task used to silently create a duplicate-looking blank plan rather than opening the one you clicked.

## Row heights

Standort and Parzelle rows (no bars of their own) get a fixed compact height (`OCCUPANCY_COMPACT_ROW_HEIGHT = 32` in `ganttChartState.ts`) via `rowHeightOverride`. The timeline-side summary is absolutely positioned inside the row, so it contributes no height on that side either. Beet rows are left without an override, so they keep the library's normal, task-count-based height, computed from a `rowHeight={32}` prop (down from the library's default of 40) passed to `<GanttChartWithFocusMode>` plus reduced floors/padding in `hierarchyLabel.ts`'s `estimateLabelHeight` (60/+28 → 40/+20), `TaskList.getGroupHeight` (60/+20 → 40/+12), and `TaskRow`'s equivalent lane-height padding (+20 → +12) and bar vertical offset (+10 → +6). Together these noticeably shrink the sidebar/timeline row height for beds with only 1-2 stacked plans, without needing per-row overrides.

`TaskList` (sidebar) and `TaskRow` (timeline) are two independently-rendered sibling columns that both use CSS `minHeight` with the same numeric JS value — if their *content* differs enough that one side's minHeight gets exceeded and the other's doesn't, the two rows silently drift out of sync row-by-row. This bit us once already (see git history around `OCCUPANCY_COMPACT_ROW_HEIGHT`): watch for it whenever either side's row content changes.

## Sidebar visual polish

`gantt.css`: consistent 16px chevron hit-area at every depth (previously 18px, inconsistently applied), depth-based font-weight/color progression (a lighter-weight, file-tree-like visual hierarchy instead of relying on indentation alone). The Standort/Parzelle aggregate summary ("1 Parzelle · 8 Beete · 5 belegt") is **not** shown as a second visible sidebar line — the sidebar row holds only the chevron and the name, with the summary folded into the row name's `title` attribute (hover tooltip) via `TaskList.tsx`'s tree-row `<span>`, while the visible copy lives in the timeline area. This has now been tried the other way round twice, and reverted both times: a sidebar `.rmg-task-group-meta` line wastes vertical space and is exactly the kind of two-line-vs-one-line content mismatch described above (it was the original cause of the sidebar/timeline row-misalignment bug, and its 2026-07 re-introduction had to push `OCCUPANCY_COMPACT_ROW_HEIGHT` from 32 to 40 to accommodate it). Keep the summary on the timeline side.

Horizontal scrolling: the summary is `position: sticky` at `left: var(--rmg-left-column-width)` — a variable the library's core component publishes on `.rmg-gantt-chart` from the same `normalizeLeftColumnWidth(leftColumnWidth)` the sidebar sizes itself with. Left at its static position it would scroll under the left column, which is itself `position: sticky` with an opaque background and `z-index: 200`, and be silently clipped. Pinning it to the column's width keeps it just past the divider at every scroll offset and every zoom level, without ever being drawn over the Flächen column.

## Context menu vs. hover tooltip

Right-clicking a bar to open its context menu, while the mouse is still technically hovering it, used to leave the library's own hover tooltip visible underneath/overlapping the new menu. `TaskRow`'s `handleTaskContextMenu` now calls `setHoveredTask(null)` before forwarding the event, dismissing the tooltip immediately (mirrors what `handleTaskMouseLeave` already did).

## Drag-and-drop and optimistic updates

`GanttChart.tsx`'s `handleTaskUpdate` (the `onTaskUpdate` callback passed to the Gantt library) now updates local `plantingPlans` state optimistically, *before* `await`ing `plantingPlanAPI.update(...)`, then reconciles with the server response once it resolves (rolling back via `refreshPlantingPlans()` + a Gantt remount on failure, unchanged from before). Previously the state update only happened after the API call resolved: `TaskRow` clears its local drag/preview state as soon as the mouse is released, so for the ~50-300ms until the request resolved, the bar would re-render from the still-stale `plantingPlans` prop — visibly snapping back to its pre-drag position before jumping to the correct one once the response landed.

### A planting plan moves as one unit

The growth and harvest bars of a plan carry the same `linkGroupId` (`plan-<id>`, set by the occupancy builders in `ganttChartUtils.ts`). In "Zeitraum verschieben" mode, `TaskRow` treats all tasks of the dragged task's link group in the same row as one unit:

- **Live preview.** For a `move` drag, `buildMovePreviewTasks` (`gantt-chart/src/utils/linkedTasks.ts`) shifts the dragged task and every linked task by the same whole number of days. The dragged task keeps its duration (a move never derives the end date from the bar's pixel width), and the previewed tasks feed `CollisionService.getPreviewArrangement`, so only the dragged row re-renders per pointer move. Dragging the harvest bar moves the plan the same way as dragging the growth bar.
- **Preview equals drop.** Days are whole 24-hour steps on the stored UTC-midnight dates; `getDayDelta` rounds away the local-midnight offset of the drop position. On drop, `getMovedPlanDates` shifts `planting_date`, `harvest_date` and `harvest_end_date` by that same delta for the optimistic state, so no bar jumps when the drag state clears. The API call still sends only the new `planting_date`; the backend recalculates the harvest dates from the crop's timing, and its response is authoritative (it differs from the preview only if the crop's durations changed since the plan's dates were last calculated).
- **Drag state for the whole plan.** Every linked bar gets `isDragging` (elevation, `grabbing` cursor, no left/width transition, so it does not lag). The tooltip of the grabbed bar derives the harvest dates from the bar's own previewed offset (`buildOccupancyTooltipDetails`), so it shows the plan's dates as they will be after the drop.
- **Cancel and rollback.** Escape during a drag (a capture-phase `keydown` listener on `window`, removed with the other drag listeners) restores the grabbed bar and clears the preview, so all linked bars return to their stored dates and nothing is committed. A rejected update (e.g. season or area validation) rolls back through `refreshPlantingPlans()` as before, which restores all phases together.
- Drags stay within one bed row; the library has no vertical move to another bed.

## Performance

`TaskItem`, `TaskRow`, and `TaskList` are now wrapped in `React.memo`, and the three task-interaction handlers in `GanttChart.tsx` (`handleTaskUpdate`, `handleTaskClick`, `handleTaskSelect`) are wrapped in `useCallback`. This was a targeted fix, not a blanket pass: before it, hovering a single bar (to drive the row hover-link above) would set `hoveredGroupId` state in the top-level `GanttChart` component, which — with zero memoization anywhere in the render tree — re-rendered *every* `TaskRow` and `TaskItem` in the chart on every mouseenter/mouseleave, regardless of dataset size. That's now scoped to just the rows whose actual props changed. Re-renders still legitimately cascade on expand/collapse, filter, and search changes (the visible row set itself changes then), which is expected and not something this pass tried to eliminate.

**Not done:** a full memoization audit of the rest of `GanttChart.tsx`'s internals (e.g. `renderGanttHeader`, the seedling-mode render paths) — those weren't touched by this change and weren't shown to be measurably slow; per "no premature micro-optimization," they were left alone.
