---
name: qa-sweep
description: Run an exploratory QA sweep or bug hunt of the running app with Playwright, scoped to what changed since the last sweep, and record coverage afterwards. Use when the user asks to search for bugs, test the app exploratively or do a QA run.
---

# QA sweep

Rules: `CLAUDE.md` ("QA / Exploratory Testing") and `docs/qa-strategy.md`
(setup details, Playwright notes, what is still open).

## 1. Scope

1. Read the newest `docs/qa-coverage-*.md`: last tested areas, the commit,
   and UI patterns that look like bugs but are by design.
2. Read `docs/qa-excluded-issues.md`; never re-report those items.
3. `git log <commit from the coverage file>..HEAD --stat` to see what changed.
4. Decide full vs. targeted sweep with the triggers in `docs/qa-strategy.md`
   (≥ 20 commits, cross-cutting components, before a release, major
   dependency updates). Otherwise test the changed areas and their direct
   dependents. Tell the user which scope you chose and why.

## 2. Run

- Start the app (the `run` skill, or the running dev servers if the user has
  them up; do not restart theirs).
- Write a throwaway Playwright script in the scratchpad, not in
  `frontend/e2e/`. Set up users and a project through
  `POST /api/__e2e__/invite-flow/` (action `setup`, header from
  `docs/qa-strategy.md`).
- Test desktop and 375px mobile, including long-press instead of right-click
  and portrait/landscape where the area has a mobile variant.
- For every suspected bug: reproduce it twice, note exact steps, viewport,
  language and a screenshot. Separate confirmed bugs from "looks odd".

## 3. Record

- New bugs: `docs/qa-archive/qa-report-YYYY-MM-DD.md`.
- Won't-fix decisions by the user: `docs/qa-excluded-issues.md`.
- Coverage: update the newest `docs/qa-coverage-*.md` with the commit and the
  newly confirmed areas, or write a new dated file, move the previous one to
  `docs/qa-archive/` and update the link in `docs/index.md`.
- Commit the doc updates on a `docs/qa-…` branch and open a PR; fixes for the
  bugs go in separate `fix/…` PRs with regression tests.
