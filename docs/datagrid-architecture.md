# DataGrid Architecture

OpenFarmPlanner builds most editable tables on `EditableDataGrid`
(`frontend/src/components/data-grid/DataGrid.tsx`), a wrapper around MUI X
`<DataGrid>`. This doc covers what OpenFarmPlanner *added* on top of the
stock grid. It intentionally does not repeat:

- keyboard focus regions and the global shortcut system —
  [keyboard-architecture.md](./keyboard-architecture.md)
- the Standort/Parzelle/Beet tree view (a *different*, raw `<DataGrid>`
  page, not `EditableDataGrid`) — [occupancy-tree-hierarchy.md](./occupancy-tree-hierarchy.md)

Autosave-on-blur used to live in a separate root-level
`AUTOSAVE_IMPLEMENTATION.md`. **This document is now the single source for
it** — see "[Autosave on blur](#autosave-on-blur-useautosavedraft)" below.
The original file is kept unchanged for history at
[`archive/AUTOSAVE_IMPLEMENTATION.md`](./archive/AUTOSAVE_IMPLEMENTATION.md);
its "Applied To" section is outdated and must not be used as a reference.

**Not every table uses `EditableDataGrid`.** `FieldsBedsHierarchy.tsx`
renders a raw MUI `<DataGrid>` with its own row-data wiring and keyboard
navigation (`useHierarchyContextMenu.ts`). It shares the generic context
menu state/shell pieces with `EditableDataGrid`, but still has separate
trigger conditions and hierarchy-specific actions — when you change one,
check whether the other needs the same fix, but don't assume every layer is
shared.

New Parzelle and Beet rows in that hierarchy begin with temporary negative
IDs. The first blur save replaces the temporary row with the server row, so a
same-row cell click made while that save starts must migrate both the row edit
mode and `fieldToFocus` to the returned ID. The hierarchy captures the target
cell during the primary pointer-down capture phase, before the edited input can
blur, and its save handler reconciles that target with the returned ID.
Otherwise the replacement discards the click and touch users have to tap the
target cell twice. This does not delay or replay the pointer event.

## File map

```text
frontend/src/components/data-grid/
  DataGrid.tsx            EditableDataGrid<T> — the main wrapper component
  index.ts                Public barrel export
  hooks/
    useDataGridCommandApi.ts     builds the imperative EditableDataGridCommandApi
    useDataGridRowCommands.ts    addRow/editSelectedRow/openRowById/focusTable
    useDataGridDelete.ts         immediate delete + optional undo-snackbar flow
    useDataGridRowActionMenu.ts  right-click / long-press / keyboard row menu
  StableScrollbarTrack.tsx       shared track/thumb overlay for useStableDataGridScrollbar
  keyboardEditing.ts       "just start typing" / F2 spreadsheet-edit-start behavior
  keyboardNavigation.ts    Tab/Arrow cell navigation rules, grid-API-agnostic
  AreaM2EditCell.tsx, DateEditCell.tsx, PlantsCountEditCell.tsx,
  SearchableSelectEditCell.tsx                            custom edit cells
  SelectEditCellContext.tsx, selectEditMenuClose.ts        select dropdown open/close bridge
  FullCellTooltip.tsx     full-cell hover/focus target for unavailable values
  GermanDateEditCell.tsx   shared German date parse/format helpers only
                           (its edit-cell component was removed as dead code)
  NotesCell.tsx, NotesDrawer.tsx, NotesPreviewPopover.tsx,
  useNotesEditor.ts, useNotesPreview.ts, markdown.ts,
  noteAttachmentsCache.ts               rich markdown notes + photo attachments
  ../OverflowTooltip.tsx                overflow-only desktop tooltip wrapper
  ../AppTooltip.tsx                     the app's Tooltip (context-menu aware)
  tableClipboard.ts, TableCopyMenuItems.tsx   copy row/table as TSV
  columns.tsx, calculatedColumns.tsx    column builders (select, computed)
  dataGridUtils.tsx, handlers.ts, styles.ts, localeText.ts   shared helpers

frontend/src/components/contextMenu/
  CustomContextMenu.tsx          shared MUI Menu shell for app context menus
  contextMenuFocus.ts            Arrow/Home/End/Enter/Esc navigation *inside* an
                                 open menu, plus focus restoration on close
  useContextMenuPositionState.ts generic open/close/reposition state
  useRowContextMenuState.ts      row-menu state plus focus restoration
  useLongPressTimer.ts           touch long-press helper
  contextMenuOpenState.ts        global "a context menu is open" signal
```

## Imperative API (`EditableDataGridCommandApi`)

A page passes a `commandApiRef` into `EditableDataGrid`; the grid populates
it on mount (`hooks/useDataGridCommandApi.ts`):

```ts
interface EditableDataGridCommandApi {
  addRow, editSelectedRow, deleteSelectedRow, deleteRow(rowId),
  getSelectedRowId, setDraftValues(rowId, values), commitDraftValues(rowId, values),
  applyDialogEditValues(rowId, values),
  reload, focusTable, openRowById(rowId, { startEdit? }),
}
```

`openRowById(rowId, { startEdit })` is the deep-link entry point: it scrolls
to and selects a row, optionally opening edit mode. Today only
`PlantingPlans.tsx` uses it — the Gantt calendar's context menu
("Anbauplan öffnen" / "bearbeiten") navigates to
`/app/planting-plans?planId=<id>&edit=true`, and `PlantingPlans.tsx` resolves
that param to `openRowById(planId, { startEdit: true })`. This deliberately
replaced an earlier `initialRow`-based approach, which always prefilled a
**new draft row** — clicking "open" on an existing task used to silently
create a duplicate-looking blank plan instead of opening the one clicked.
If you add deep-linking into another grid page, this is the reference
pattern to follow, not a one-off to reinvent.

For large editable flat tables, `EditableDataGrid` also supports
`scrollMode="continuous"`. This keeps the free MUI DataGrid's internal page
size at 100 rows, hides the pager UI, and advances the internal row window
from wheel/touch scrolling so the table behaves like a continuous virtualized
scroll area. The full row array remains in component state, so sorting,
filtering, copy operations, and page-level mobile mirrors still operate on
the complete loaded dataset.

Continuous scroll uses `hooks/useScrollDrivenRowWindow.ts` for the internal
100-row window and `hooks/useStableDataGridScrollbar.ts` for the visible
thumb. The same stable-scrollbar hook is re-exported for the raw
Standort/Parzelle/Beet hierarchy so both large table styles keep matching
scrollbar behavior without parallel implementations; both also render the
track/thumb overlay itself through the shared `StableScrollbarTrack.tsx`
rather than each page hand-rolling the same absolutely-positioned Boxes.

Two rules keep that thumb where it belongs. Its vertical position is written
directly to the thumb element's inline style (via the `thumbRef` both callers
pass in) instead of being returned as a rendered value — it changes on every
scroll frame, and putting it through React state re-rendered the entire grid,
rows and cells included, once per frame. And the `headerHeight` argument must
match the track's own `top` offset: MUI renders the column headers *inside*
`.MuiDataGrid-virtualScroller`, so that container's `clientHeight` covers them
too, and a thumb travelling the full `clientHeight` inside a track that starts
below the header overflows past the track's bottom edge on the last internal
page. `EditableDataGrid` therefore passes the *measured* header height rather
than `CONTINUOUS_SCROLL_HEADER_HEIGHT_PX`: it renders at compact density,
which scales that requested height down (56px becomes ~39px), and the track
follows the same measurement. The hierarchy grid passes its own
`HEADER_ROW_HEIGHT`, which is likewise the offset its track is drawn at.

`StableScrollbarTrack` must be rendered as a sibling of whatever wrapper Box
scrolls the table horizontally, not nested inside it — its `right: 0` is
relative to the nearest positioned ancestor, so nesting it inside content
that can be wider than the visible viewport (e.g. `surfaceSizing="contentFit"`)
pins it to the *content's* right edge instead of the *viewport's*, letting it
scroll out of view as the user scrolls the table horizontally.

`setDraftValues`/`commitDraftValues` let external code push field values
into a row that's already mid-edit (e.g. a calculated side-effect from
another field), either staying in edit mode or committing immediately.
`applyDialogEditValues` is the entry point for cells that have no edit
session at all — see "Cells edited in a popover/dialog" below.

## Autosave on blur (`useAutosaveDraft`)

Editing anywhere in `EditableDataGrid` is draft-first: input is held in local
state, nothing is sent per keystroke, and a save is attempted when the user
leaves the row (click outside, Tab away, click another row). Invalid data is
never sent — the row stays in edit mode with its errors visible. In-flight
saves are superseded by newer drafts, so the latest draft always wins.

Who uses this today: `useAutosaveDraft` is consumed only from
`components/data-grid/DataGrid.tsx` (`EditableDataGrid`), whose current sole
page user is `PlantingPlans.tsx`. `CropForm.tsx` and `Locations.tsx` moved
to explicit dialog Save/Cancel forms, and `FieldsBedsHierarchy.tsx` renders a
raw `<DataGrid>` — none of them get this behavior. The hooks remain the right
building blocks if a *form* needs blur-based autosave again.

### The hooks

`frontend/src/hooks/autosave.ts` exports both hooks and `ValidationResult`:

```typescript
const {
  draft,              // Current draft state
  setField,           // Update single field
  updateDraft,        // Update multiple fields
  errors,             // Current validation errors
  isDirty,            // Has unsaved changes
  isValid,            // Current validation state
  isSaving,           // Save in progress
  saveIfValid,        // Manually trigger save, e.g. saveIfValid('blur')
  resetDraft,         // Reset to saved state
  commitSavedState,   // Update saved state after server response
} = useAutosaveDraft({
  initialData,
  validate,   // (draft) => ValidationResult
  save,       // async (draft) => savedDraft
  onSaveSuccess,
  onSaveError,
});

useNavigationBlocker(
  isDirty && !isValid,  // Block condition
  'You have unsaved changes. Are you sure you want to leave?',
  saveBeforeLeaving,    // optional callback run before navigation proceeds
  false,                // skip the confirm dialog for in-app navigation
);
```

Wiring a field is `onChange={(e) => setField('name', e.target.value)}` plus
`onBlur={() => saveIfValid('blur')}`, with `error`/`helperText` driven by
`errors.name`. A new validation rule goes into `src/hooks/validation.ts` as a
`Validator<unknown>` returning a message string or `null`.

### Validation utilities

`src/hooks/validation.ts` provides `required`, `min(n)`, `max(n)`,
`hexColor`, `isoDate`, `email`, `positive`, `nonNegative`, `oneOf(values)`,
`maxLength(n)`, `minLength(n)`, and `validateFields` — the latter runs a list
of `{ field, validators }` entries over an object and returns
`{ isValid, errors }`. Unit tests live in `src/__tests__/validation.test.ts`
and `src/__tests__/useAutosaveDraft.test.ts`.

### Navigation protection

Two layers, and they are deliberately different:

- **Browser navigation** (tab close, reload, typing a new URL) — both
  `useAutosaveDraft` and `useNavigationBlocker` register a `beforeunload`
  listener while there are unsaved changes. The browser shows its own native
  prompt; the message string cannot be customized.
- **In-app navigation** — `useNavigationBlocker` uses React Router's
  `useBlocker`, which requires the data router API (`createBrowserRouter`,
  as set up in `App.tsx`). When blocked it optionally confirms, then awaits
  `onProceed()` before calling `blocker.proceed()`. `EditableDataGrid` passes
  `confirmBeforeProceed: false` and uses the callback to save dirty/editing
  rows *silently* before the route change continues — a route change must not
  pop a confirmation dialog for data the grid can just persist.

### MUI DataGrid integration

Autosave on the grid works by *not* preventing MUI's default `rowFocusOut`
edit stop: `handlers.ts`'s `handleRowEditStop` only sets
`event.defaultMuiPrevented = true` for `escapeKeyDown`, so Escape reliably
means "cancel" while every other exit reason falls through to
`processRowUpdate` and saves. Save failures keep the row editable with its
inline errors intact. For planting plans specifically, incomplete rows may be
saved as drafts as long as either a crop or a bed is selected.

## Custom edit cells

MUI's stock edit cells didn't fit a few OpenFarmPlanner-specific needs:

- **`AreaM2EditCell` / `PlantsCountEditCell`** — both preserve the raw text
  the user is typing (including a mid-typed decimal separator or a
  temporarily invalid/partial value) instead of coercing on every
  keystroke like MUI's built-in number editor does; normalization happens
  at save time, not on each keypress.
- **`DateEditCell`** (the default for any `type: 'date'` column, applied
  automatically by `dataGridUtils.tsx`'s `applyDefaultDateEditCell`) — a
  from-scratch segmented `TT.MM.JJJJ` editor: per-segment cursor tracking,
  Up/Down arrows increment/decrement the active day/month/year segment
  (with correct month-length/rollover handling), Left/Right move between
  segments, plus a hidden native `<input type="date">` behind a calendar
  icon as a picker fallback.
- **`GermanDateEditCell.tsx`** no longer exports an edit-cell component —
  the component itself was confirmed unused as a `renderEditCell` anywhere
  and removed. The file now only holds the shared
  `parseGermanDateText`/`formatDateAsGerman` helpers that `DateEditCell`
  imports.
- **`SearchableSelectEditCell`** wraps an MUI Autocomplete for single-select
  columns with large option lists (crops, suppliers) that a plain
  `singleSelect` dropdown wouldn't make browsable; `columns.tsx` also
  exposes a `createSingleSelectColumn` builder (plain dropdown) for
  short option lists — pick whichever builder matches the option-list size,
  don't default to the searchable one everywhere. The plain editor renders
  through `StandardSingleSelectEditCell`, which reuses the shared closed
  Select typeahead hook from `components/inputs/selectTypeahead.ts` so typing
  on a focused closed editor selects by the localized visible label just like
  form-level Selects. A primary click on an inline `singleSelect` cell opens
  row edit mode and immediately requests the mounted select editor to open its
  dropdown via `SelectEditCellContext`; keyboard entry into the same cell only
  focuses the editor, so Tab/F2/type-to-edit behavior stays unchanged. When a
  controlled select menu closes from a pointer click outside the edited row,
  `selectEditMenuClose.ts` routes that close back through the grid's normal
  save-and-exit-row path. Escape closes reuse the row cancel path. If keyboard
  navigation moves from an inline select editor into a dialog-owned cell on an
  existing row, the grid commits the select draft into local row state and exits
  inline row edit mode before the dialog opens; new draft rows keep their row
  edit session so the final create save can still validate the full row.
  Closes caused by choosing an option stay inside the current row edit session.

## Keyboard editing/navigation inside the grid

`docs/keyboard-architecture.md` still lists "applying the region-shortcut
pattern to DataGrid" as future work for the *page-level* keyboard model —
that's still true. But cell-level Tab/Arrow/Enter/F2 navigation
(`keyboardEditing.ts` + `keyboardNavigation.ts`) is fully implemented:

- **`keyboardNavigation.ts`** — pure helpers (grid-API-agnostic, easy to
  unit test) for stepping Tab/Shift+Tab/Left/Right across visible, editable
  columns, and Up/Down across rows — falling back to the nearest navigable
  cell in the target row if the same column isn't editable there (so Enter
  after editing one column doesn't get stuck on a read-only next-row cell).
  When navigation lands inside a row that is already in edit mode, the shared
  focus helper focuses the target cell's actual editor input instead of only
  the DataGrid cell wrapper; otherwise the cell can look focused while
  printable keystrokes are ignored.
- Scrolling a navigation target into view goes through
  `keyboardNavigation.ts`'s `scrollCellIntoView` / `getVisibleColumnIndex`,
  never through MUI's `getColumnIndexRelativeToVisibleColumns`. That API is
  misnamed: it resolves the field against *all* columns, hidden ones
  included, while `scrollToIndexes` indexes into the visible column
  definitions. Mixing the two is off by however many columns are hidden to
  the left and throws (`visibleColumns[colIndex].computedWidth` on
  `undefined`) once the index passes the visible column count — and because
  the throw escapes the Tab handler, keyboard navigation stops dead. That was
  the planting plans bug below the `lg` breakpoint, where both harvest-date
  columns are hidden by default: Tab out of "Pflanzdatum" reached "Fläche"
  and never arrived at "Pflanzen".
- While a row is in edit mode, `EditableDataGrid` owns Tab/Shift+Tab
  navigation even when focus is inside a custom editor input. MUI's own
  native capture handlers can otherwise move to the next row before React
  editor handlers run, so the wrapper uses one grid-scoped capture listener
  that only handles Tab events originating inside the edited grid surface and
  then routes them through the same pure navigation helpers.
- **`keyboardEditing.ts`**'s `useSpreadsheetEditStarter` implements
  Excel-like "just start typing" (a printable keydown on a non-editing
  cell immediately opens edit mode and *replaces* the cell's value with the
  typed character, buffering rapid keystrokes typed before the edit-cell
  component has actually mounted) and F2 (opens edit mode *without*
  altering the value — the standard spreadsheet distinction between the
  two). The same starter also handles the row-edit edge case where Tab or
  Shift+Tab has visibly focused another editable cell but DOM focus is still
  on the cell container rather than the mounted editor input: the first
  printable key is still captured, buffered, and written into that target
  cell instead of being lost. If the editor input itself already owns DOM
  focus, its native input event is left untouched; restarting row edit mode
  there would discard other unsynchronized values in a newly created row. The
  hierarchy's name and dimension editors disable MUI's default input debounce
  because row-level validation across rapidly edited fields can otherwise
  complete out of order and restore an older value after a focus change.
- Notes cells and `dialogEditFields` cells (both below) are deliberately
  excluded from spreadsheet auto-edit-start, the F2 flow, and click-to-edit —
  Enter/Space opens their own editor instead. They remain Tab/arrow stops via
  the `isActionCell` hook, since `editable: false` alone would skip them.

## Hover actions / row actions / context menu

Triggers: right-click, the `ContextMenu` keyboard key / `Shift+F10`, and a
550ms touch long-press (with a `.ofp-row-long-press` visual affordance
during the hold). All three funnel into the same
`hooks/useDataGridRowActionMenu.ts` state machine, positioned either at the
mouse coordinates or the focused cell's bounding rect. Menu contents:
caller-supplied row actions (duplicate/delete by default) plus
"copy row"/"copy table" (see below). Closing the menu restores keyboard
focus to whatever opened it.

Use `components/contextMenu/CustomContextMenu.tsx` for the rendered menu
shell instead of repeating MUI's `hideBackdrop`, pointer-events, paper class,
`anchorReference`, and optional list-focus props in each page. Pass
`keyboardNavigation` on a menu that is reachable by keyboard: the shell then
focuses the list on open and wires `contextMenuFocus.ts`'s
Arrow/Home/End/Enter/Esc handling to its own `onClose`, so no page repeats it.
Use
`useContextMenuPositionState.ts` for positioned chart-style menus, and
`useRowContextMenuState.ts` when the menu should restore focus to the row or
cell that opened it.

`useContextMenuPositionState.ts` is also the app-wide exclusivity gate: when a
new app context menu opens, any previously open app context menu is closed
first. The shared DOM listeners in `utils/contextMenu.ts` guard the event
sequence around those menus. Secondary-button `pointerdown`/`mousedown`/
`pointerup`/`mouseup` events on custom-menu targets are stopped before MUI
DataGrid, chart bars, links, or buttons can treat the right-click as a normal
activation. While any custom context menu is open, the first primary-button
click/tap outside the menu is a dismiss-only gesture: it closes the menu and
suppresses the matching pointer/mouse/click sequence, so the element under the
cursor does not open a dialog, enter edit mode, navigate, or change selection.
`EditableDataGrid` also checks the same dismiss-gesture flag before accepting
a `rowFocusOut` edit stop, so a dismiss-only click cannot commit a row and
open save-time validation dialogs. The next separate click works normally.
Clicks inside the menu are excluded so menu items can run their actions.

### Tooltips never cover an open context menu

`components/contextMenu/contextMenuOpenState.ts` is a module-level store
holding "is any context menu open right now?". `useContextMenuPositionState`
registers there for as long as its menu is open, so *every* app context menu
— row menus, the hierarchy menu, the Gantt task/group menu, the yield
segment menu — reports the same signal without each page wiring anything up.

Tooltip surfaces subscribe to it and suppress themselves while it is set:

- `components/AppTooltip.tsx` is the app's tooltip and the only place allowed
  to import MUI's `Tooltip` (enforced by `no-restricted-imports` in
  `eslint.config.js`). `OverflowTooltip`, `FullCellTooltip`,
  `DropdownAwareTooltip` and `ContextMenuIndicator` all build on it.
- the Gantt task tooltip (`gantt-chart/src/components/ui/Tooltip.tsx`)
- the notes preview popover (`useNotesPreview.ts`)

Suppression is real, not a z-index fight: an open tooltip closes, MUI's
hover/focus/touch listeners are disabled, and a tooltip whose enter delay (or
the preview's 250ms hover delay) elapses while the menu is open never opens
at all. `AppTooltip` remembers the `openSequence` it was opened in, so a
tooltip opened *before* the menu is invalidated for good — closing the menu
leaves no stale tooltip behind, and the next hover/focus/long press works
normally. This covers mouse, keyboard (`ContextMenu`/`Shift+F10`) and touch
long-press alike, because all three go through the same open state.

Truly native browser context menus — the ones the app deliberately does not
intercept over inputs/`contenteditable` (`shouldOpenCustomContextMenu`) — are
out of this mechanism's reach by definition; there is no event that says when
the browser closed its own menu.

A first-run **discovery hint** (`ContextMenuHint.tsx` /
`useContextMenuHint.ts`) shows a small "right-click a row" banner once,
only on fine-pointer desktop viewports, persisted per-user in
`localStorage` and synced across tabs — this is UX polish, not
functionality; don't remove the dismissal persistence when touching it.

Separately, `renderInlineActionCell` overlays icon buttons directly inside
one cell on row hover — this is the "hover actions" surface distinct from
the right-click menu.

**`FieldsBedsHierarchy.tsx`'s `useHierarchyContextMenu.ts` is a separate
implementation of the same right-click/long-press pattern**, because that
page uses a raw `<DataGrid>`, not `EditableDataGrid`, and needs different
data shapes (three row types/APIs, whole-row-object state) that
`EditableDataGrid` has no concept of. It shares its open/close/reposition
state machine, focus restoration, menu shell, and long-press timer with
`useDataGridRowActionMenu.ts` via small, tree-agnostic helpers
(`components/contextMenu/useRowContextMenuState.ts`,
`CustomContextMenu.tsx`, `useLongPressTimer.ts`), but the trigger conditions
and row-data wiring around that shared core are deliberately separate —
treat a UX fix to
*when/how* the menu opens (or the row-type-specific actions inside it) as
*not* automatically fixing the other; only a fix to the shared
open/close/reposition/focus-restore mechanics itself applies to both.

The hierarchy grid also coordinates its notes drawer with row editing
directly: saving notes for a new or still-editing Standort/Parzelle/Beet row
first persists the current row draft with the note value, then closes the
drawer. Users should never need to click outside the grid to make a new row
exist before saving its notes.

## Delete with undo — app-wide semantics

Every "Löschen" flow that shows a `DeleteUndoSnackbar` follows the same
contract, and new ones must too:

1. **The delete hits the backend immediately.** The row disappears from the
   list optimistically, but the DELETE request is sent in the same user
   action — it is never deferred until the undo window has elapsed. A browser
   reload right after deleting must never bring the record back.
2. **"Rückgängig" restores, it never cancels.** By the time the snackbar is
   visible the record is already gone server-side, so undo means calling a
   restore/recreate endpoint.
3. **A failed DELETE rolls the row back** into the list and reports the error;
   no snackbar is shown, because there is nothing to undo.
4. **Dismissing the snackbar does nothing** but drop the pending entry — it is
   not a commit point.

Where this lives:

| Entity | Delete | Undo |
| --- | --- | --- |
| Anbaupläne (`useDataGridDelete.ts`, `deleteUndoOptions`) | `api.delete` | `api.create(mapToApiData(row))` + reload |
| Kulturen (`pages/useCropDelete.ts`) | `cropAPI.delete` (soft delete) | `cropAPI.undelete` |
| Standorte/Parzellen/Beete (`hooks/useHierarchyDelete.ts`) | `locationAPI`/`fieldAPI`/`bedAPI.delete` | recreate location → field → bed, remapping parent ids |
| Lieferanten (`pages/Suppliers.tsx`) | `supplierAPI.delete` (409 when still referenced) | `supplierAPI.restoreUnlinkedDelete` with the payload the delete/unlink response returned |
| Projekte (`projects/projectDeletionFeedback.ts`) | `projectAPI.delete` (soft delete) | `projectAPI.restore` |

Entities that are recreated rather than undeleted come back with a **new id**
— the grid reloads from the backend after a restore instead of re-inserting
the old row, so sorting decides the position, not the previous id.

The supplier delete endpoint returns the same `undo_payload` shape as
`unlink-and-delete` (instead of an empty `204`) so that both supplier delete
paths share one restore endpoint.

## Notes / markdown cells

Any column listed in `EditableDataGrid`'s `notes` prop renders through
`NotesCell.tsx` instead of a normal edit cell: an icon, a plain-text
excerpt, and (unless `compactIndicator`) a hover/focus/touch-triggered
preview popover (`NotesPreviewPopover.tsx` — one shared popover instance
per grid, not one per row, opened after a 250ms hover delay). Notes are
*not* edited inline — clicking opens `NotesDrawer.tsx`, a full markdown
editor (Edit/Preview tabs, a formatting toolbar) that additionally supports
photo attachments when the column has an `attachmentNoteIdField`: capture
or pick a photo, crop it with a hand-rolled pointer-drag crop tool, and
downscale/re-encode to WebP (falling back to JPEG) client-side before
upload. `noteAttachmentsCache.ts` caches attachment fetches per note id so
re-hovering a row doesn't refetch; the drawer explicitly invalidates that
cache after upload/delete.

## Cells edited in a popover/dialog (`dialogEditFields`)

Some values are never typed into a cell — they are picked in a dialog
(today: the Anbaupläne "Anbaufläche" column, a Standort → Parzelle → Beet
picker in `AreaAssignmentDialog.tsx`). Those columns are **`editable:
false`** and listed in `EditableDataGrid`'s `dialogEditFields` prop. The
grid then treats them exactly like notes cells:

- **one left click opens the real editor.** The column's `renderCell` —
  not `renderEditCell` — renders both the value and the dialog, so the
  click lands directly on the dialog trigger. There is deliberately no
  intermediate inline edit state and no pencil icon: an edit mode the user
  can only click *through* is a wasted click, not an affordance.
- **no inline edit mode is ever started for them**, from the click, from
  F2, or from "just start typing" (`onCellClick` returns early and
  `useSpreadsheetEditStarter` gets an `isCellEditable` that rejects them).
- **they stay keyboard stops.** `editable: false` would normally drop a
  cell out of Tab/arrow navigation, so `isCellKeyboardNavigable`'s
  `isActionCell` hook covers notes *and* dialog fields
  (`dedicatedEditorFieldNames` in `DataGrid.tsx`). Enter/Space is handled by
  the trigger element itself, which stops propagation so the grid does not
  also react; after the dialog closes, focus returns to that trigger and
  ordinary navigation continues.
- **Tab/Shift+Tab onto the cell opens the dialog** — that is what "entering
  edit mode" means for a cell whose dialog *is* its edit session. Arrow keys
  deliberately stay pure movement, so the cell can still be passed by without
  a modal opening.

That last point is what `DialogEditCellContext.tsx` exists for. The grid has
no inline edit session to hang the dialog off, so `EditableDataGrid` publishes
a *request* — `{ cellKey, token }` — every time keyboard navigation enters a
`dialogEditFields` cell, and the cell's renderer opens on it via
`useDialogEditCellOpenRequest(rowId, field, open)`. Two properties make
repeated entries work where a "did I already open?" flag would not:

- the token is bumped per entry, and a cell opens for a given token **exactly
  once**, so a focus event, a click and the request all landing on the same
  entry cannot stack up two dialogs (`AreaAssignmentDialog`'s `handleOpen` is
  additionally idempotent while open, so a duplicate impulse can't reset a
  draft the user is mid-way through);
- the cell **consumes** the request as it opens, so nothing is left behind for
  a later re-render or a re-mount (grid virtualization) to replay.

Requests are issued from the Tab paths only — `handleViewModeCellNavigation`
for a row in view mode, and `handleEditedCellTabNavigation` (via
`navigateFromEditedCell` / `saveEditedRowAndFocusTarget` /
`focusKeyboardNavigableCell`'s `requestDialogEdit` option) for a row in inline
edit mode. Don't reintroduce a "the dialog was already opened once" flag or a
timeout-based reopen: both are what made the cell open on the first Tab and
never again.

For this to hold, a cell renderer that focuses itself on `hasFocus` must
cancel that pending frame on cleanup (see `CompactAreaCell`) — otherwise the
frame scheduled by the focus that *caused* the request fires after the dialog
mounted and pulls focus straight back out of it.

The dialog writes its result back through the command API's
`applyDialogEditValues(rowId, values)`, **not** `setEditCellValue` (there is
no edit session to write into) and **not** a column `valueSetter` (which
only runs in edit mode — any side effects it had must move into the caller;
see `applyBedSelection` in `PlantingPlans.tsx`). It branches on the row's
current mode: a row already in inline edit mode — typically a new draft row
— only gets the values merged into its draft, so its own save cycle
persists everything at once; a row in view mode is saved immediately
through the normal `processRowUpdate` path, including the
`onBeforeSaveRow` gate.

`values` must carry **only the fields the dialog actually changed**, never a
whole row. On a row that is mid-edit those values are pushed into the open
edit session, so a whole-row write-back would both undo newer draft edits and
re-seed every cell from a render-time snapshot. Dates make that fatal rather
than merely wrong: row state keeps them as ISO strings, but MUI stores `Date`
objects in the edit state of a `type: 'date'` column and formats them
*without* going through `valueGetter`, so a string reaching the edit state
throws while the cell renders and the error boundary takes the page down.
`applyDraftValues` therefore runs every value for a date column through
`toGridDateValue` (`dateEditCellUtils.ts`) before handing it to
`setEditCellValue`, and the date columns use the same helper as their
`valueGetter` — it maps unparseable input to `null`, so a bad value renders as
an empty cell instead of an `Invalid Date` or a crash.

`FieldsBedsHierarchy.tsx` needs no equivalent: its only
non-inline-edited column is `notes`, whose cell already opens the drawer on
a single click.

## Text overflow tooltips

Plain text headers and cells should not use tooltips that simply repeat
visible content. Shared table code uses `OverflowTooltip` for this: it
measures the hovered/focused element only on fine-pointer desktop
interaction (and while the active element resizes) and shows the full text
only when the element actually overflows. This keeps desktop truncation
recoverable without adding hover-equivalent popovers or tap targets on
mobile/touch surfaces. Explanatory tooltips remain separate: icon labels,
calculated-column explanations, unavailable-value reasons, note previews,
and package/blocker diagnostics should still use their dedicated tooltip or
popover components — all of which render through `AppTooltip`, so they hide
themselves while a context menu is open (see "Tooltips never cover an open
context menu" above).

`markdown.ts`'s `stripCitationMarkers` strips AI-citation markers of the
form `【digits†identifier】` from note text. **Unclear/needs check**: trace
where such markers actually get inserted (an LLM-assisted import/enrichment
path elsewhere in the app, presumably) before documenting the "why" further
— it wasn't found in the files reviewed for this doc.

## Copy/paste

Copy-only today (no paste-in). `tableClipboard.ts` formats selected rows as
tab/newline-delimited text (dates localized `de-DE`, arrays joined with
`, `); `TableCopyMenuItems.tsx` adds "Copy row" (header + the right-clicked
row) and "Copy table" (header + every currently loaded/filtered/sorted row)
to the row-action menu — both paste directly into Excel/Sheets.

## Column visibility

Column show/hide is handled entirely by **MUI's native columns panel**
today. A custom show/hide menu and a separate ResizeObserver-driven
"autofit" responsive-hiding feature both existed earlier and were
deliberately removed in favor of it (see the git history around
`Replace custom column show/hide menu with MUI's native columns panel` and
`Fold responsive column hiding into the native visibility model`) — do not
reintroduce a bespoke visibility UI. `EditableDataGrid` only passes
`columnVisibilityModel`/`onColumnVisibilityModelChange` straight through to
the underlying MUI grid; the actual state lives in the page via
`useColumnVisibility(...)` (`frontend/src/hooks/useColumnVisibility.ts`),
which persists to `localStorage` under `tableColumns.<tableKey>` and
supports a `defaultHiddenFieldsOnSmallScreen` list that only applies until
the user makes their *first* explicit visibility choice — after that, the
user's choice always wins regardless of screen size.

`FieldsBedsHierarchy.tsx` (raw `<DataGrid>`) has **no column-visibility
feature at all** today — this was an explicit scope cut when the feature
was migrated to the native panel elsewhere, not an oversight to "fix" as a
drive-by change.

## Row history / versioning — not a grid feature

Crop version history (backed by the generic `EntityRevision` model, see
[versioning-and-history.md](./versioning-and-history.md)) is shown in a
**standalone MUI `Dialog`** on `Crops.tsx`, populated via
`cropAPI.history(...)`. It does not surface inside any grid cell,
row-action menu, or notes drawer — if you're asked to "show history in the
grid," that's new work, not exposing something that already half-exists.

## Cross-cutting utilities

- `dataGridUtils.tsx` — `isUnsavedDraftRow` (heuristic for local-only,
  not-yet-saved rows), `SaveBlockedError` (lets `onBeforeSaveRow` silently
  keep a row in edit mode without surfacing an error), `prepareDataGridColumn`
  (applies the default date edit cell and makes unsaved draft rows immune
  to active column filters), `getSortedRowIds`/`orderRowsByStableIds`
  (rows are kept in a stable client-side order rather than trusting the
  grid's own post-edit row order). `DataGrid.tsx`'s `stableRowOrder` state is
  only refreshed via `refreshStableRowOrder` on data fetch, an explicit sort
  change, or a filter change — never as a side effect of a row being
  created/saved — which is what stops a create/rename in a sorted table from
  immediately jumping the row to its freshly-sorted position.
  `FieldsBedsHierarchy.tsx` (see below) is not `EditableDataGrid` and doesn't
  share this state, but `hierarchyUtils.ts`'s `computeHierarchyOrderSnapshot`/
  `applyHierarchyOrderSnapshot` implement the same pattern independently for
  its raw `<DataGrid>`, refreshed via `useHierarchyData`'s `fetchGeneration`
  (foreground fetches only) and an explicit sort-model-change handler.
  Entities absent from the snapshot (new/unsaved rows) are placed *first*
  within their entity list rather than appended last — once grouped by
  parent, that puts a newly created Standort/Parzelle/Beet as the first
  child right next to the "add" action that created it, instead of
  potentially many screens below the bottom of a long group.
  `FieldsBedsPage.tsx`'s "Standort hinzufügen" flow follows the same
  principle: it merges the created location into state directly
  (`setLocations` prepend) instead of triggering a full `fetchData()`
  reload, which would otherwise immediately re-sort the table and could
  place the new location far from the topbar action that created it.
- `handlers.ts` — `handleRowEditStop` deliberately suppresses MUI's default
  Escape-triggers-save-attempt behavior so Escape reliably means "cancel";
  see "[Autosave on blur](#autosave-on-blur-useautosavedraft)" above for how
  the blur-triggered save itself works.
- `styles.ts` — the single `dataGridSx` object defining every `ofp-*` CSS
  class referenced above (`.ofp-row-editing`, `.ofp-cell-dirty`,
  `.ofp-cell-error`, `.ofp-row-long-press`, ...). Cells that render
  `FullCellTooltip` must also use `FULL_CELL_TOOLTIP_CELL_CLASS` so its
  absolute trigger covers the cell and follows the grid's keyboard focus.
  DataGrid renderers pass `cellHasFocus`; plain read-only table cells can use
  `focusable` when the tooltip trigger itself needs a keyboard stop. Do not
  use `focusable` inside DataGrid cells or around an already focusable link.

## What to check before changing this layer

- If you change *when/how* the row-action menu opens or keyboard-navigation
  behavior, check whether `FieldsBedsHierarchy.tsx`'s implementation needs
  the same change (see above) — only the shared
  `useRowContextMenuState`/`useLongPressTimer` mechanics are common; a fix
  to trigger conditions or row-type wiring in one does not apply to the
  other automatically.
- Keep new edit cells consistent with the "preserve raw input text, defer
  normalization to save time" pattern used by the existing custom edit
  cells, rather than coercing on every keystroke.
- Don't reintroduce a custom column-visibility UI; extend
  `useColumnVisibility`/the native panel instead.
- Notes columns must stay `editable: false` and excluded from the
  spreadsheet auto-edit-start/F2 flow — they have their own editor.
- A new column whose value is only ever picked in a popover/dialog belongs
  in `dialogEditFields`, not in a `renderEditCell`. Don't reintroduce a
  cell-level edit mode whose only purpose is to reveal a button that opens
  the real editor — that costs the user a click for nothing.
