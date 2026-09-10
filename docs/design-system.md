# Design System

OpenFarmPlanner styles its UI through **one system: the MUI theme**. There is
no utility-class framework, no CSS modules, and no per-component stylesheet.
This page says where a given style belongs so the question does not have to be
re-decided per change.

| Where | What belongs there |
| --- | --- |
| **`frontend/src/theme.ts`** | decisions that apply to a component *type*: palette, radii, typography weights, and the `components` overrides for Button, Dialog, Alert, Tooltip, DataGrid, focus rings |
| **`sx` on a component** | one instance: spacing, layout, a local colour pulled from the theme |
| **a `*Styles.ts` module** | an `sx` object reused by more than one component |
| **`frontend/src/index.css`** | global element base styles only — currently 69 lines |

**Do not add a `.css` file for a component.** If a style feels like it needs
one, it almost always belongs in `theme.ts` (because it is a decision about a
component type) or in a `*Styles.ts` module (because it is shared).

---

## 1. Why a single system

The app renders essentially all of its UI through MUI components, and
`theme.ts` already carries the component-level design decisions. A second
styling system — utility classes, CSS modules, another framework — would not
remove any of that; it would sit next to it. Every styling change would then
start with a choice between two valid answers, and the answer would drift
depending on which file was read first.

This was evaluated explicitly, including a working Tailwind CSS v4
integration, and rejected for that reason. What the evaluation *did* surface
is what this page and the cleanup around it fix: the problem was never the
absence of a framework, it was **dead CSS and undocumented conventions**.

## 2. The shared style modules

`sx` objects that more than one component needs live in a `*Styles.ts` module
next to their owner, typed as `SxProps<Theme>`:

- `components/layout/pageContainerStyles.ts` — the page shells
- `navigation/navigationStyles.ts`, `navigation/topbarMenuStyles.ts`
- `notifications/notificationStyles.ts`
- `components/data-grid/styles.ts`
- `components/buttons/segmentedControlStyles.ts`
- `components/contextMenu/contextMenuIndicatorStyles.ts`
- `pages/fieldsBedsHierarchyStyles.ts`
- `pages/auth/authPageStyles.ts`

Reach for an existing one before adding another.

## 3. Values

**Spacing** is MUI's 8px unit. `sx={{ p: 2 }}` is 16px, `sx={{ p: 0.5 }}` is
4px. Do not write `sx={{ padding: '10px' }}` — pick the nearest step.

**Colours** come from the theme, never as literals:

```tsx
sx={{ bgcolor: 'surface.surfaceHoverBackground', color: 'primary.dark' }}
```

`theme.ts` defines, beyond MUI's own palette, a `surface` group (app, sidebar,
topbar, content and surface backgrounds, borders) and a `navigation` group
(inactive/hover/active text, icon, background and border for nav items). Read
it before introducing a colour — there is very likely already a token for what
you need.

**Breakpoints** are MUI's defaults: `sm` 600, `md` 900, `lg` 1200, `xl` 1536.
Use the responsive object form (`px: { xs: 0, sm: 2 }`) or
`theme.breakpoints.down('sm')`, not a hand-written media query.

**Radii** come from `shape.borderRadius` (4px). `sx={{ borderRadius: 2 }}` is
8px.

**Detail-page actions** (`components/layout/DetailPageActions.tsx`) show their
text label only from `ACTION_LABEL_BREAKPOINT` (`lg`, 1200px) up; below that
they stay icon-only and surface the label as a tooltip, the same way a disabled
button explains itself. That keeps the actions pinned to the top-right of a
detail header on tablet and small-desktop widths instead of letting a long page
title push them onto a row of their own — the header rows in `CropDetail`
and `PublicCropLibraryPage` therefore use `flexWrap: 'nowrap'` and let the
title column shrink and wrap instead. The switch is plain responsive `sx`, not
a measured width, so the header renders at its final size on the first paint;
the media query in the component only picks the tooltip text.

## 4. The two remaining stylesheets

Only two `.css` files are left in the app, and both are deliberate:

**`src/index.css`** — global element base styles: the root font stack and
colours, the body reset, the `overflow-x` clamp (whose comment explains a
non-obvious interaction with MUI's modal scroll lock — read it before touching
it), link colours and `h1`.

**`src/pages/GanttChart.css`** — overrides for the vendored Gantt library in
`src/gantt-chart/`. Every rule targets `.rmg-*` DOM that this app does not
render itself, so it cannot be expressed as `sx`; the wrapper's own box model
lives on `<Box>` in `GanttChart.tsx`. `.gantt-container-wrapper` survives
purely as the scoping hook for these rules and as the selector the Gantt e2e
specs use.

This file also sets the library's `--rmg-primary-color`, `--rmg-task-color`
and `--rmg-hover-color`. Those three are the only colour literals that are
*allowed to stay* outside `theme.ts` — the library consumes them as CSS custom
properties and plain CSS has no access to the MUI theme, so keep them in sync
by hand.

A third stylesheet exists but is not the app's: `src/gantt-chart/src/styles/gantt.css`
ships with the vendored Gantt library. Treat it as third-party code — changes
there are library patches, not app styling (see
[occupancy-tree-hierarchy.md](./occupancy-tree-hierarchy.md)).

**Enforcement status:** ESLint's local
`theme-tokens/no-hardcoded-style-values` rule rejects application-owned
colour literals and pixel spacing in style properties. The theme and vendored
Gantt package are deliberately excluded; user/domain colour data (for example
crop swatches) also remains valid outside the theme. The maintained UI has no
remaining rule findings, so new violations fail lint rather than accumulating
as warnings.

## 5. i18n and writing direction

The UI ships German and English (see [i18n.md](./i18n.md)), both
left-to-right. Nothing in the styling encodes a direction today, and a future
RTL locale should stay a layout concern rather than a styling one:

- **Prefer the logical properties** where a style follows the reading
  direction: `paddingInline`, `marginInline`, `insetInlineStart`,
  `textAlign: 'start'`. MUI's `px`/`mx` shorthands already compile to the
  logical `padding-inline`/`margin-inline`, so the common cases are
  direction-safe by default.
- **Use physical properties only for physically-defined values.** The page
  gutter in `pageContainerStyles.ts` applies `env(safe-area-inset-left)` with
  `paddingLeft`, not `paddingInlineStart`: the inset describes the physical
  left edge of the device, so a logical property would move it to the wrong
  side in RTL.

## 6. Verifying a visual change

`frontend/e2e/responsive-layouts.spec.ts` captures 32 screenshot baselines —
8 main routes × 4 viewports (375 / 768 / 1024 / 1440). They run on every pull
request and are the real check that a refactor did not move anything.

Per [`CLAUDE.md`](../CLAUDE.md), baselines are never updated automatically. If
one fails, first decide whether the change was intended.
