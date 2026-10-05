# Search and Filter Rules

This page is the **binding specification** for how OpenFarmPlanner searches
and filters records. It is implemented today by the page search on
**Anbaupläne** (planting plans). Any later search — in particular an
**app-wide search served by the backend** — must implement exactly these
rules, so that the same query finds the same records wherever it is typed.
Change this page first, then every implementation, in the same change.

## Where the code lives

| Piece | File |
| --- | --- |
| Normalization, tokenizing, hit ranges | `frontend/src/search/searchText.ts` |
| Planting-plan match, filters, sort, filter options | `frontend/src/pages/plantingPlanSearch.ts` |
| The one state hook both views use | `frontend/src/pages/usePlantingPlanSearch.ts` |
| Highlighting (`<mark>`) | `frontend/src/search/SearchHighlightedText.tsx` |
| Search field (clear button, Esc, `/` hint) | `frontend/src/search/PageSearchField.tsx` |
| Toolbar, filter popover/sheet, chips, empty state | `frontend/src/components/planting-plans/search/` |
| Crop synonyms for search | `crop_species_search_names` on `GET /api/crops/` |
| Tests | `frontend/src/__tests__/searchText.test.ts`, `plantingPlanSearch.test.ts`, `PlantingPlans.search.test.tsx`, `frontend/e2e/planting-plans-search.spec.ts` |

## Normalization

Query and record text are compared in a normalized form:

1. Lower case.
2. `ß` (and `ẞ`) becomes `ss`: "Straße" matches "strasse".
3. Unicode NFD decomposition, then every combining mark is removed, so
   diacritics do not matter: "rube" finds "Rübe", "creme" finds "Crème".
   Umlauts fold to their base letter (`ü` → `u`), **not** to `ue`.

## Terms and AND

The query is split on whitespace into terms (empty and duplicate terms are
dropped). **Every term must occur somewhere in the record** (AND). A term may
occur anywhere inside a word ("rott" finds "Karotte"). A single term never
spans two fields.

## Searched fields

For a planting plan, the searched texts are:

- Kultur and Sorte (the visible crop label "Kultur (Sorte)")
- Anbauart (the localized label, e.g. "Direktsaat")
- Standort, Parzelle, Beet (names)
- Notizen (markdown stripped to plain text)
- Pflanztermin, Aussaattermin, Erntebeginn and Ernteende, each in three
  forms: the displayed `d.M.yyyy` ("18.2.2026"), zero-padded `dd.MM.yyyy`
  ("18.02.2026") and ISO `yyyy-MM-dd` ("2026-02-18"). Any part matches like
  any other text, so "18.2.", "18.02." and "2026-02" all find 18 February
  2026, and "2026" finds every dated plan of that year. Aussaattermin is
  derived (Pflanztermin minus the crop's propagation duration), so it isn't
  searched for a plan where it isn't computable (direct sowing re-uses
  Pflanztermin itself; see [DataGrid Architecture](./datagrid-architecture.md#coupled-field-pairs)).

**Not searched:** other numbers (area, plant count), including the area shown
in the Beet label.

## Synonyms

A crop is also found under every name of its linked **crop species** in the
crop library: the canonical and scientific name, the common names in all
languages, the structured `synonyms`, and the regional names
(`CropSpecies.search_names()`). "Paradeiser" (the Austrian regional name)
finds Tomate. The frontend receives these names as
`crop_species_search_names` with the crop list it already loads — there is no
request per row.

A term that matches no visible text and no note, but a synonym, still counts
as a hit; the record then reports the synonym that matched. A name equal to
the visible crop name is not reported as a synonym hit.

## Filters

- Filters: **Standort, Parzelle, Anbauart, Kultur** (each multi-select) and
  **Pflanzzeitraum, Erntebeginn, Ernteende** (each month from / month to).
- Values selected **within** one filter combine with **OR**; different
  filters combine with **AND**; search and filters combine with **AND**.
- The **Kultur** filter groups by the Kultur name, so it covers every Sorte
  of that Kultur.
- **Pflanzzeitraum, Erntebeginn, Ernteende** match the month of the planting
  date, harvest start and harvest end respectively. Only "from" means that
  month or later, only "to" means that month or earlier; a range whose "from"
  is after its "to" wraps across the year end (Nov–Feb). A plan without that
  date (e.g. no harvest start because the crop has no growth duration) never
  matches an active range on it. The three ranges combine with AND like all
  filters.
- Options are **derived from the records being searched** (the plans of the
  active season), so a filter never offers a value that matches nothing.
- **Parzelle depends on Standort:** with Standorte selected, only their
  Parzellen are offered, and deselecting a Standort drops its Parzellen from
  the selection. With no Standort selected, every Parzelle is offered; names
  that repeat across Standorte get the Standort in brackets.

## Scope and state

- Search and filters apply **within the active season** — the rows they run
  over are the season-scoped planting-plan list.
- The state is session UI state only: no `localStorage`, no URL parameters.
  A project switch resets it. A season switch keeps it; because switching
  seasons reloads the app, the state is handed over through a one-shot
  `sessionStorage` entry keyed by project (`seasons/seasonSwitchState.ts`) that
  is written only by the season switch and removed as soon as the page reads
  it — a manual reload or returning to the page later starts empty.
- There is exactly **one** filter state. On the planting-plan grid, MUI's
  built-in filter model is not used (and a stored one is ignored); the column
  menu's "Filter" entry opens the page's filter panel
  (`EditableDataGrid`'s `externalFilter`, see
  [datagrid-architecture.md](./datagrid-architecture.md#page-owned-filtering-externalfilter)).
- The desktop grid and the mobile card list read the same hook, so the same
  input yields the same hits. Sorting differs by design: the grid sorts by
  column header (default planting date ascending), the card list by the sort
  option in the filter sheet (same default).

## Presentation rules

- Live filtering while typing, debounced by about 150 ms; clearing is instant.
- Hits are marked in the visible texts with a yellow `<mark>`
  (`palette.searchHighlight`), also mid-word. Screen readers get the text in
  one piece from a visually hidden copy.
- A synonym hit underlines the crop name with a dotted yellow line and shows a
  small "Synonym: …" chip.
- A notes hit gives the desktop notes icon a yellow background (the hover
  preview shows the note); on mobile, the card shows a line with the notes
  icon and the marked note excerpt.
- The hit count sits in an `aria-live="polite"` region.
- On mobile the search row sticks under the app bar. The app bar only sticks
  because the page sets the `sticky-app-bar` body class (see
  [design-system.md](./design-system.md#5-the-two-remaining-stylesheets)); by
  default the app-wide `overflow-x` clamp disables `position: sticky`.

## Why page search is not in the topbar

The topbar is **reserved for a future app-wide search** across all record
types, which will run on the backend and has to follow the rules above. Page
search therefore lives on the page itself — directly above the grid on
desktop, under the app bar on mobile — so the two never compete for the same
place or get confused with each other.
