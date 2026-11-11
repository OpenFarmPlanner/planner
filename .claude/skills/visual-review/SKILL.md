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

Open every screenshot (Read tool) and check: overlap, clipped or truncated
text, hidden or displaced actions, misalignment, touch targets on mobile,
unintended reflow of unrelated elements. Passing functional checks do not prove
the layout is right. Check the longest language (fr/es) where text grew.

## 4. Act

- Obvious, low-risk problem (spacing, alignment, truncation): fix it and
  capture again.
- Needs a design decision (which element yields, shared component, no clear
  layout): stop and report with the screenshot.

## 5. Summary

State the breakpoints checked, whether mobile stayed unchanged or changed on
purpose, how shared-component regressions were avoided, and which tests and
screenshots ran.
