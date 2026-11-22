---
name: visual-review
description: Check a rendered UI change with Playwright screenshots at the project's breakpoints (375, 768, 1024, 1440 px and phone landscape) and inspect them for overlap, clipping and reflow. Use after any change to buttons, icons, layout, spacing, components or responsive behavior.
---

# Visual review

Rules: `CLAUDE.md` ("Playwright Layout Tests and Visual Review",
"Responsive UI and Mobile Regression Protection").

## 1. Decide what to capture

- Page covered by the responsive suite (the routes in `MAIN_ROUTES`,
  `frontend/e2e/utils.ts`): run the full responsive suite.
- Otherwise: a targeted screenshot of the affected view at 375x800, plus
  desktop 1440x900 when desktop changed, plus phone landscape (e.g. 800x375)
  when the view has a compact mobile variant.
- Open the state that shows the change (dialog open, menu expanded, long
  text, empty state), not just the page's initial render.

- For changes to persistent controls or layout, capture the same rendered
  state before and after at the affected viewports, using comparable data
  and locale.

## 2. Capture

Responsive capture suite:

```bash
cd frontend
npm run test:e2e -- e2e/responsive-layouts.spec.ts
```

Targeted: a throwaway Playwright script in the scratchpad (setup per
`docs/qa-strategy.md`), saving PNGs there. Use functional assertions for automated layout checks;
screenshots are visual-review artifacts, never pixel-comparison gates.

## 3. Inspect

Open every screenshot with the available image viewer and check: overlap, clipped or truncated
text, hidden or displaced actions, misalignment, touch targets on mobile,
unintended reflow of unrelated elements. Passing functional checks do not prove
the layout is right. Check the longest language (fr/es) where text grew.

For tooltip and help changes, apply the [tooltip roles](../../../docs/ux-principles.md#tooltip-roles).
Move the pointer across neighboring controls, then check keyboard focus and touch.
Look for repeated action labels and excessive help. Check tooltip placement,
overlap with nearby content and access to record previews. Check the explanatory
hover delay alongside the responsiveness of data previews.

For changes to persistent controls or layout, compare the rendered before and
after views using [Preserve space for primary content](../../../docs/ux-principles.md#preserve-space-for-primary-content).

- Check whether the header or toolbar grew and how many records are visible
  before scrolling. Identify what that extra space gives the user.
- Check whether a secondary control's size or prominence suits its frequency
  of use and whether an existing compact control could serve the same purpose.
- Verify that controls remain discoverable and usable with touch and keyboard,
  with readable long translations and enough room to wrap when needed.

## 4. Act

- Obvious, low-risk problem (spacing, alignment, truncation): fix it and
  capture again.
- If a more compact placement would change product behavior or conflict with
  an explicit requirement, report the trade-off for a decision.
- Needs a design decision (which element yields, shared component, no clear
  layout): stop and report with the screenshot.

## 5. Summary

State the breakpoints checked, whether mobile stayed unchanged or changed on
purpose, how shared-component regressions were avoided, and which tests and
screenshots ran.
