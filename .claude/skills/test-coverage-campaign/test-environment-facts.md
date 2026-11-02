# Test environment facts

What jsdom, MUI, emotion and Testing Library actually do in this repository's
vitest setup. Each line below cost a wrong assertion or a false survivor at
least once. Treat them as the environment's behaviour to assert around, not as
something to work around.

## jsdom

- `ResizeObserver` and `IntersectionObserver` are undefined, and
  `setupTests.ts` does not mock them: a component that constructs one needs a
  per-suite mock or it bails out before rendering.
- Every `getBoundingClientRect()` returns zeros. Behaviour derived from
  measured geometry cannot be asserted here - a responsive test that depends on
  a measured width proves nothing.
- Media queries never resolve. Mock `matchMedia` keyed on the exact query text
  MUI generates, or `useMediaQuery` is permanently `false`.
- `env(safe-area-inset-*)` resolves to its fallback, so safe-area padding and
  no padding are indistinguishable.
- `2rem` computes to `32px`. `transform` with no transform computes as
  `'none'`, not `''`. A transparent background computes as `rgba(0, 0, 0, 0)`,
  never `'transparent'`.
- Vendor pseudo-element styles are not computed.
- Form submission is not implemented: `preventDefault` on submit is observable
  only as `fireEvent.submit(form) === false`.

## MUI

- An open Popover or Menu sets `aria-hidden` on the rest of the document, so
  queries for anything outside it fail while it is open.
- `Tooltip` opens after a 100 ms enter delay and closes after a leave delay. An
  immediate `expect(el).not.toHaveAttribute('aria-describedby')` passes
  vacuously; wait past the delay, and assert the no-tooltip control *before*
  the one that has a tooltip. `src/__tests__/helpers/disabledActionTooltip.ts`
  does both.
- `AppTooltip` without `describeChild` copies its title onto a child that has
  no `aria-label`, so `getByRole('button', { name })` can match the tooltip
  text instead of the label.
- `Drawer` already sets `role="dialog"` and `aria-modal` on its paper. Neither
  is the component's own work to add or to be credited with.
- `ListItemButton` renders `div[role="button"]`: it carries `aria-disabled`,
  never `disabled`.
- A `Badge` with zero content is invisible by itself.
- A numeric `value` matches its string option; no `onChange` fires when the
  option already selected is clicked.
- `selected` renders `Mui-selected`; `aria-selected` is not supported on role
  `menuitem`.
- A Drawer's `anchor` is folded into the generated emotion class - there is no
  stable `paperAnchorBottom` to query.
- The shape unit is 4px (`theme.ts`), so `borderRadius: 5` is `20px`;
  `theme.spacing(2)` is `16px`.
- `openOnFocus` opens the list, so a test about the closed state must render
  with `hasFocus: false`.
- Always render inside `<ThemeProvider theme={theme}>`. Without it MUI's
  default palette can coincide with the project's and the colour assertion
  proves nothing.

## emotion

- It appends `px` to a bare number for every property off its unitless list, so
  a hand-written ``typeof x === 'number' ? `${x}px` : x`` is redundant and a
  battery leaves it standing. The value is still worth asserting - that it
  reaches CSS at all is the point.

## Testing Library

- `userEvent` refuses to click an element with `pointer-events: none`, and
  `pointerEventsCheck` is a `setup()` option, not a per-click one. Use
  `fireEvent` to prove that a click which does reach the element does nothing.
- When order is the behaviour, assert it by index in `getAllBy*` or with
  `compareDocumentPosition`; mere presence of both nodes is not order.
- `setupTests.ts` pins the language to German and raises the async timeout to
  5000 ms; it also restores mocks and timers after each test.

## Local tooling

- `pdm` is not always on PATH:
  `cd backend && .venv/bin/python -m pytest -o addopts="" <path>`.
- `tsc` and `eslint` exit codes need `${PIPESTATUS[0]}` when piped.
- `playwright.config.ts` pins `channel: 'chrome'`, which a cloud container does
  not have - screenshot work needs an environment with real Chrome.
