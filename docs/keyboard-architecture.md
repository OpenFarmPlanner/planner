# Keyboard Navigation Architecture

Date: 2026-07-03
Scope: `frontend/src`

Goal: OpenFarmPlanner should be operable almost entirely without a mouse, the
way VS Code, Figma, or Excel are — via a small number of general rules
applied consistently, not a growing pile of page-specific shortcuts.

This doc describes the architecture that makes that possible: a **focus
model** (which area of the screen is "active") and a **shortcut model**
(what a keypress does while that area is active). Both already existed in
part before this pass (`commands/`); this pass adds the focus half and wires
the two together.

## 1. Focus model — `frontend/src/focus/FocusManager.tsx`

The screen is divided into **focus regions**: the sidebar, the topbar, a
page's main content, and (optionally) more specific regions nested inside
that — a chart, a table, a calendar. Each region is registered with a
`FocusManagerProvider` (mounted once, in `main.tsx`, above `CommandProvider`):

```tsx
const containerRef = useRef<HTMLElement | null>(null);
useFocusRegion('yield-chart', containerRef, { label: 'Ertragsverteilung', order: 3 });

return <Box ref={containerRef} sx={{ ... }}>...</Box>;
```

- **F6** moves to the next region, **Shift+F6** to the previous one, cycling
  by each region's `order`. Landing in a region focuses its first focusable
  element (or the region container itself, which `useFocusRegion` makes
  focusable automatically).
- **Tab / Shift+Tab only move within the currently active region.** Each
  region traps Tab at its boundary and wraps (last → first, first → last)
  instead of letting focus escape into the next region. Set `trapTab: false`
  for a region that already has its own trap (e.g. an MUI `Dialog`, which
  traps focus internally) to avoid two traps fighting each other.
- The **active region** is tracked automatically: a single `focusin`
  listener on `document` finds which registered region contains
  `event.target`, picking the most deeply nested match when regions are
  nested (e.g. a chart region inside the page's main-content region).
- Regions get a visible focus ring for free (`.ofp-focus-region:focus` in
  `theme.ts`'s `MuiCssBaseline` override) — the container is focusable even
  with no children, so F6 always lands somewhere visible.

Registered app-wide regions (`navigation/RootLayout.tsx`): `sidebar` (order 0),
`topbar` (order 1), `main-content` (order 2, wraps the routed page). Pages
add more specific regions nested inside `main-content` as needed — see §4.

## 2. Shortcut model — `frontend/src/commands/` + `frontend/src/hooks/useKeyboardShortcuts.ts`

This already existed and is the app's shortcut manager; this pass extended
it rather than building a second one (see CLAUDE.md: avoid parallel
implementations).

- `useKeyboardShortcuts(specs, enabled, { currentContexts })` is the single
  engine that matches `keydown` against a list of `{ keys, action, when }`
  specs. It always ignores keys while the user is typing in an editable
  field (`isTypingInEditableElement`), unless a spec opts in.
- **Global commands** (`commands/commands.ts`, `commands/CommandProvider.tsx`)
  are registered by scope (`useRegisterCommands('scope-name', specs)`) and
  gated by `contextTags` (`'crops' | 'calendar' | 'plans' | ...`), which a
  page activates for as long as it's mounted (`useCommandContextTag('crops')`).
  This is *page-level* scoping — "this shortcut only applies on this page."
- **Region shortcuts** (`frontend/src/focus/useRegionShortcuts.ts`) are the
  new, finer-grained layer: single-key shortcuts (`N`, `E`, `D`, `L`, `G`, …)
  that only fire while a specific *focus region* is active, reusing the same
  `useKeyboardShortcuts` engine underneath (no second listener, no second
  matching logic):

  ```tsx
  useRegionShortcuts('crops-table', [
    { key: 'n', label: 'Neu anlegen', action: createCrop },
    { key: 'e', label: 'Bearbeiten', action: editSelected },
  ]);
  ```

  Because these are single letters gated on "region is active AND not
  typing," they can't collide with anything — different regions (and
  different pages, via context tags) can reuse the same letter for a
  different, locally obvious action.
- A binding can list more than one key combination
  (`keys: [{ ctrl: true, key: 'k' }, { alt: true, key: 'k' }]`) — used for
  the command palette, which now opens on **Ctrl+K** (the convention used by
  VS Code, Slack, Linear, GitHub) as well as the app's original **Alt+K**.
- Punctuation keys (`?`, `/`) match regardless of the Shift key's actual
  state, since whether they need Shift depends on keyboard layout (e.g. `/`
  is Shift+7 on a German keyboard) — see `isShiftInsensitiveKey` in
  `useKeyboardShortcuts.ts`.

### Migrated/removed shortcuts

- **Alt+S is gone.** It was used inconsistently as a page-local "focus
  search" shortcut (the project Crop Library, the calendar). It's replaced by **`/`**
  (focus the page's filter/search field) — chosen over `F` because `F`
  already means "show Feldbelegung" in the calendar; picking a shortcut that
  collides with an existing one just to match a suggestion literally would
  have been worse than picking a different, equally standard key. `/` is
  also the more universally recognized "jump to search" key (GitHub, etc.).
- **`?`, Ctrl+B (sidebar toggle)** used to be raw `window.addEventListener('keydown', ...)`
  listeners in the root layout (now `navigation/RootLayout.tsx`), duplicated a second time for `?` in
  `pages/Crops.tsx` (which meant pressing `?` on the project Crop Library page could
  open two different dialogs at once). Both are now regular commands
  registered through the same system as everything else — one listener,
  one source of truth.

## 3. Shortcuts help (`?`)

`?` opens a single dialog (`CommandProvider`'s `helpOpen` state, previously
built but never wired to anything) showing:
1. The action search as the primary shortcut (`Ctrl+K` / `Alt+K`), because it
   lets users discover commands and page navigation without memorizing the
   rest of the shortcut inventory.
2. Universal keys (F6, Shift+F6, Tab/Shift+Tab, Esc) — always relevant.
3. The **current focus region's** single-key shortcuts (from
   `useRegionShortcuts`'s registry, filtered by `activeRegionId`).
4. All commands active for the current page (grouped by context tag, same
   list the command palette searches).
5. A compact all-pages reference for page-specific shortcuts, so users can
   discover e.g. the Crops page shortcuts even while they opened help from
   account settings or another page without local commands.

This replaced three separate, drifting implementations (a static, hand
maintained list in `App.tsx`, a near-duplicate in `pages/Crops.tsx`, and
dead code in `CommandProvider.tsx` that built the right data but was never
opened) with one dynamic one that can't go stale relative to what's actually
registered.

## 4. Component model for interactive widgets (tables, charts, calendars)

There's no single shared base class for "an interactive widget" — MUI
context menus (`<Menu>`) already give Arrow/Home/End/Enter/Esc for free, and
DataGrid has its own working cell-navigation layer
(`components/data-grid/keyboardNavigation.ts`). What's shared going forward
is the *pattern*, demonstrated end-to-end on the yield distribution chart
(`pages/YieldOverview.tsx`):

1. Register the widget's container as a focus region (`useFocusRegion`).
2. Track "the current item" in state (roving tabindex): every item gets
   `tabIndex={-1}` except the current one (`tabIndex={0}`), and moving
   focus calls `.focus()` on the new current item's DOM node directly
   (`focusSegment` in `YieldOverview.tsx`) rather than relying on the
   browser to figure out where Tab should go next.
3. Arrow keys move "current item" within the widget; **Enter** activates
   the item's primary action; **Space** toggles a secondary
   view (a tooltip, in the chart's case); the `ContextMenu` key and
   **Shift+F10** open the same context menu a right-click would, positioned
   from the focused element's bounding rect instead of a mouse event.
4. A tooltip or popover driven by keyboard state must be a *fully controlled*
   `AppTooltip` (`open` always a real boolean, never `undefined`) — MUI
   locks a `Tooltip` into "uncontrolled" mode forever if its first render has
   `open={undefined}`, so a later prop flip to `true` is silently ignored.
   Hiding it while the widget's context menu is open is not the caller's job:
   `AppTooltip` force-closes every tooltip for as long as any context menu is
   open (see [datagrid-architecture.md](./datagrid-architecture.md),
   "Tooltips never cover an open context menu").

Applying this same pattern to the Gantt calendar's bars (2D, collision-based
layout) is future work — the reference implementation and this write-up are
meant to make that a mechanical port rather than a fresh design exercise
each time.

### Continuous-scroll paging (Home/End/PageUp/PageDown)

`EditableDataGrid` and `FieldsBedsHierarchy` (see
[datagrid-architecture.md](./datagrid-architecture.md) and
[large-dataset-rendering.md](./large-dataset-rendering.md)) both load their
*complete* dataset up front but only mount one internal ~100-row page at a
time via `useScrollDrivenRowWindow`, advancing it as the user scrolls near an
edge. MUI's own keyboard handling for Ctrl/Shift+Home, Ctrl/Shift+End, and
PageUp/PageDown resolves against `getCurrentPageRows()` — the *mounted*
page only — so those keys used to jump to the edge of whatever page happened
to be loaded, not the actual start/end of the dataset. Tab and the arrow keys
were unaffected because OpenFarmPlanner already routes them through its own
navigation, resolved against the complete row array (`api.getAllRowIds()`,
which returns every id in the underlying `rows` prop regardless of
pagination) rather than MUI's page-scoped list.

`getDatasetEdgeKeyboardNavigationTarget` and
`getPagingKeyboardNavigationTarget` (`components/data-grid/keyboardNavigation.ts`)
extend the same approach to Ctrl/Shift+Home, Ctrl/Shift+End, and
PageUp/PageDown: both resolve their target against the complete dataset, then
the caller pages the row window into place (`ensureRowIndexVisible` /
`runAfterRowVisible` in `DataGrid.tsx`, `runAfterRowVisibleOnPage` in
`FieldsBedsHierarchy.tsx`) before focusing, using the same
"page-then-focus-after-the-next-paint" pattern the arrow-key navigation and
the deep-link/new-row focus flows already use. Bare Home/End are left to
MUI's default handling: they only move to the first/last column of the
*current* row, which is always already mounted, so there is nothing to fix
there.

Like the arrow keys, these are **view-mode keys**: a row that is in edit mode
keeps its own Tab/arrow/editor handling, so the paging handler bails out for
it. In `EditableDataGrid` a single click starts row edit mode, which is why
the e2e coverage clicks a cell and then presses Escape to get a view-mode
focused cell before pressing Ctrl+End or PageDown.

**PageUp/PageDown's step size is measured from the DOM, not from MUI's
`apiRef.getViewportPageSize()`.** That internal helper
(`@mui/x-virtualizer/features/keyboard.mjs`) returns `0` whenever its
dimensions state isn't marked "ready" yet, which is common here since these
grids' height is driven by `useContinuousScrollSizing`/hierarchy-specific
sizing rather than MUI's own resize observer. A `0` step size silently
collapsed to a 1-row jump once `Math.floor(0) || 1` was applied downstream —
PageUp/PageDown looked like they only moved a single row. `getViewportRowPageSize`
(`components/data-grid/keyboardNavigation.ts`) sidesteps that internal
readiness gate entirely by measuring the actual scroll container's
`clientHeight` against the grid's row height, the same
DOM-over-internal-state approach `useScrollDrivenRowWindow` already uses for
its own edge detection. Both `DataGrid.tsx` and `useHierarchyGridKeyboard.ts`
fall back to the row window's internal page size only if the container isn't
mounted yet (e.g. before first paint) — the hierarchy, whose rows vary in
height by type, deliberately measures against the *shortest* row height
(`BED_ROW_HEIGHT`) so the estimate undershoots rather than overshoots the
actually-visible row count.

Crop master-detail lists use the same local-widget approach through
`crops/useCropListKeyboardNavigation.ts`: the visible list rows are a
`listbox`/`option` set with roving tabindex, ArrowUp/ArrowDown/Home/End move
selection within the currently rendered rows, the selected row scrolls into
view, and focus stays in the list. The hook is shared by the project
project Crop Library page, the public Crop Library page, and the quick import dialog, so
filter/search state continues to define what "visible rows" means in each
surface without adding global arrow-key handlers.

### Closed Select typeahead

Plain MUI `<Select>` menus already provide text typeahead while their menu is
open, because the menu's listbox is mounted and owns the option focus. The
closed trigger, however, only exposes the current display value, so typing on
a focused but closed Select did not consistently search all options across
forms.

OpenFarmPlanner routes normal closed Select controls through
`components/inputs/TypeaheadSelect.tsx`, backed by
`useClosedSelectTypeahead`. The hook derives searchable text from the visible
MenuItem labels, uses a short multi-character buffer, ignores case, skips
disabled/hidden options, and only runs while the Select is closed. Navigation
keys, Enter, Space, Escape, Alt+ArrowDown, opened-menu typeahead, editable text
fields, and Autocomplete inputs remain owned by their native/MUI handlers.
Autocomplete-based `SearchableSelect` stays separate because it is an editable
combobox with its own input-value search behavior.

### Tab out of an open Select dropdown

MUI's `Menu` reacts to Tab by closing the dropdown and swallowing the browser's
default focus move. That is what keeps focus inside a surrounding `Dialog` or
`Popover`, but on its own it drops the highlighted option and parks focus back
on the trigger, so Tab reads as "nothing happened".

`components/inputs/selectDropdownTabNavigation.ts`
(`useOpenSelectTabNavigation`, wired into `TypeaheadSelect` for every Select in
the app) adds the two missing halves:

1. **Take over the highlighted option.** The focused `[role="option"]` carries
   MUI's `data-value`; it is matched back to the typed option list and applied
   through the same synthesized `SelectChangeEvent` the closed-Select typeahead
   uses. Multi-selects are skipped — their menu survives selections, and
   toggling an option on the way out would be surprising.
2. **Continue to the neighbouring field.** The focus scope is the Select's
   nearest modal surface (`[role="dialog"]`, `[role="alertdialog"]`,
   `.MuiPopover-paper`), where Tab wraps at the edges, or its `<form>`, where it
   does not — a page form must stay leavable. Outside both, focus is left alone.

The focus move deliberately runs from an effect: MUI restores focus to the
trigger while committing the close, so anything scheduled earlier is overwritten
again. Arrow keys, Enter, and Escape stay entirely with MUI.

**Modal dialogs must not add a second focus trap.** MUI's `Dialog` already
contains Tab, `aria-hidden`s the page behind it, and restores focus to the
element that opened it. `AreaAssignmentDialog` and `CropForm` used to run
their own `document`-level Tab traps on top of that; both had to opt out while a
dropdown was open — precisely the gap focus escaped through — and both fought
MUI's restore with `requestAnimationFrame(() => …focus())` calls. They are gone;
new dialogs should rely on MUI and, if a field needs special Tab handling, add
it at the input level the way `TypeaheadSelect` does.

## 5. Adding this to a new page

```tsx
// 1. Register the page's own region(s), nested under 'main-content'.
const tableRef = useRef<HTMLElement | null>(null);
useFocusRegion('my-page-table', tableRef, { label: 'Meine Tabelle', order: 10 });

// 2. Register single-key shortcuts, scoped to that region.
useRegionShortcuts('my-page-table', [
  { key: 'n', label: 'Neu anlegen', action: handleCreate },
  { key: 'e', label: 'Bearbeiten', action: handleEdit, when: () => Boolean(selectedRow) },
]);

// 3. If the widget has a list of items, use roving tabindex + arrow keys
//    (see YieldOverview.tsx's segments for the reference pattern).
```

No new provider, no new listener, no page-specific keydown plumbing — the
existing `FocusManagerProvider` and `CommandProvider` (already mounted once
in `main.tsx`) pick it up automatically, and it shows up in the `?` dialog
without any extra wiring.

## 6. Testing

- `frontend/src/__tests__/focus/FocusManager.test.tsx` — region
  registration/cycling/Tab-trap/active-region-tracking, and
  `useRegionShortcuts` scoping.
- `frontend/src/__tests__/commandProvider.test.tsx` — Ctrl+K/Alt+K palette
  alias, `?` shortcuts-help dialog, Ctrl+B sidebar toggle as a command.
- `frontend/src/__tests__/YieldOverview.test.tsx` — chart arrow-key/Enter/
  Space/ContextMenu-key navigation (`describe('keyboard navigation on the
  chart bars')`).
