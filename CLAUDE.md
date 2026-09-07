# CLAUDE.md

## Language Rules
- All code must be written in English.
- All comments and docstrings must be in English.
- All variable names, function names, class names, and identifiers must be in English.
- All commit messages must be written in English.
- All API responses and application logs must be in English.
- All explanations, summaries, and code-related output from AI agents must be in English.
- UI text must remain in German and must be handled through i18n resources.
- Do not mix German and English within code.

## Engineering Safety Rules
- Follow the existing project structure, ownership boundaries, and established
  patterns.
- Prefer consistency and centralized solutions over new page-specific patterns.
- Prefer type safety, including TypeScript types and Python type hints.
- Keep functions small, focused, readable, and maintainable.
- Before introducing a new component, hook, utility, context, or abstraction,
  check whether a similar solution already exists.
- Reuse and extend existing components, helpers, and systems before creating
  alternatives.
- Avoid duplication and parallel implementations of the same concept. Refactor
  repeated patterns incrementally when it clearly improves maintainability.
- Preserve existing UX behavior, wording, confirmation flows, interaction
  patterns, and keyboard shortcuts unless the task explicitly asks for a
  change. If the scope is ambiguous, ask rather than assume.
- Do not fold unrelated refactors into a feature or fix. If you notice a large
  unrelated cleanup, flag it separately.
- Exception: fix what the change itself surfaces or breaks, in the same change.
  This is not "unrelated" work even when the underlying issue predates the
  change:
  - A scanner or review-bot finding reported against code the change touched or
    moved (e.g. a CodeQL alert that appears only because a file was renamed).
    Fix it and say in the commit that it predates the change; if the fix would
    be large or needs a design decision, that is when to flag it separately.
  - Backwards-compatibility shims for anything the change renames or moves that
    clients outside the repo already depend on: API paths and query parameters,
    WebSocket routes, persisted enum values, browser-storage keys, and frontend
    routes reachable from a bookmark. A deploy restarts the backend but does not
    reload open tabs, and external agent integrations are not ours to update, so
    the old spelling has to keep working. Mark each shim deprecated and say what
    has to be gone before it can be removed.

## Workflow: Before Making a Non-Trivial Change

A pre-flight checklist. Each point is a pointer — the full rule lives in
exactly one section below; don't restate rules here.

1. Read [`docs/index.md`](docs/index.md) and the deep-dive doc for the area
   you're touching. Those docs record *why* things work the way they do —
   re-deriving that from the code risks redoing a decision that was already
   made deliberately.
2. Preserve existing UX behavior unless the task explicitly asks to change
   it — see "Engineering Safety Rules" and "Frontend and UX Rules".
3. Update affected documentation in the same change — see "Documentation
   Rules".
4. Don't fold unrelated refactors into the change — see "Engineering Safety
   Rules".
5. Run the relevant tests/lint before considering the task done — see
   "Testing Rules".

## Testing Rules
- Write or update appropriate tests for functional changes.
- New features should include tests for expected behavior.
- Bug fixes should include regression tests where possible.
- Behavior changes must update affected frontend, backend, or end-to-end tests where the repository already has coverage patterns.
- New or changed API endpoints, ViewSets, or serializers with relational fields
  (FK/M2M, reverse relations, nested serializers, or a `SerializerMethodField`
  that reads a relation) must come with an `assertNumQueries` test for the
  affected list endpoint. Extend `backend/farm/tests/test_api_query_counts.py`
  (or the app's existing query-count test class) rather than starting a new
  structure. The fixture must create several rows so an N+1 changes the count,
  and the asserted number must stay constant when the row count grows — if it
  grows per row, fix the queryset with `select_related`/`prefetch_related`
  instead of raising the expected number.
- Prefer extending existing test files before creating new test structures.
- Follow existing test patterns used in the repository.
- Run targeted tests when appropriate unless the user explicitly says not to run tests.
- Typical commands:
  - Backend: `cd backend && pdm run test` (plus `pdm run makemigrations` / `pdm run migrate` if models changed).
  - Frontend: `cd frontend && npm run lint && npm run test` (add `npm run test:e2e` for user-facing flows with existing E2E coverage).
  - Or `./scripts/quality.sh` from the repo root to run the same gates CI uses.
- Re-running a CI job is allowed when it serves a purpose you can name — most
  often sampling an intermittent failure that does not reproduce locally.
  Prefer the local gates above for ordinary verification, and say why a re-run
  is needed rather than re-running until a check happens to pass.

## Playwright Screenshot Tests
- Screenshot baselines must never be updated or committed automatically.
- If a screenshot test fails, first determine whether the visual change is intentional or indicates a bug.
- Only update baselines when:
  - the UI change is explicitly intended, and
  - the new screenshots have been visually reviewed.
- Add new screenshot tests only for stable, important layouts (e.g. main pages, navigation, responsive layouts).
- Prefer standard Playwright assertions (`toBeVisible`, `toHaveText`, `toBeFocused`, `toHaveValue`, etc.) for functional tests.
- When creating or changing a screenshot test, document why a screenshot test is appropriate over functional assertions.

## Visual Review for UI Changes
Applies to any task that changes rendered UI: new buttons, icons,
layout/spacing changes, new components, responsive behavior. This applies
proactively — a new UI element without existing baseline coverage still needs
a manual screenshot check before the task is considered done, not only when an
existing screenshot test happens to fail.

1. Run the relevant screenshots at the existing breakpoints: the full
   responsive suite (`e2e/responsive-layouts.spec.ts`, covering
   375x800/768x900/1024x900/1440x900) if the change touches a page with
   baseline coverage, otherwise a targeted screenshot of the affected view at
   375px.
2. If an existing baseline fails, don't assume a false positive and don't
   auto-update it. Isolate the cause first (e.g. diff the change against a
   build without it) and confirm the affected region.
3. Visually inspect the resulting screenshot(s) for overlap, clipping or
   truncation, misalignment, and unintended reflow of unrelated elements —
   passing pixel-diff tolerance alone doesn't prove the layout is correct.
4. If a problem is obvious and low-risk to fix (spacing, alignment,
   truncation), fix it directly and re-screenshot to confirm. Only update
   baselines per the policy in "Playwright Screenshot Tests" above, after
   visually reviewing the new screenshots.
5. If the fix needs a design judgment call (which element should yield space,
   the change touches a shared component, or there's no clearly correct
   layout), stop and report the finding with the screenshot as evidence
   instead of guessing.

## Documentation Rules
- Update relevant documentation when behavior changes: if the change touches
  architecture, the data model, or a documented complex feature, update the
  corresponding file under `docs/` (or the relevant top-level
  `*_IMPLEMENTATION.md`/`*_GUIDE.md` doc) in the same change — don't leave
  documentation describing the old behavior.
- Keep code comments minimal and useful.
- Prefer self-explanatory code over comments.
- Do not add routine file header comments. Add a short top-level comment only
  when a file's purpose, constraints, or domain assumptions are not obvious
  from its name and surrounding code.
- Update CLAUDE.md only when project architecture or developer workflow changes significantly.
- Do not update CLAUDE.md for small implementation details.

## Project Structure
- `backend/` contains the Django backend. The main apps are `accounts/` and `farm/` (whose views/serializers are organized into domain packages: `common/`, `history/`, `projects/`, `structure/`, `crops/`, `planning/`, `notes/`, `feedback/`, plus `services/` for business logic), with project settings in `config/`, app-local tests under each app, backend helper scripts in `backend/scripts/`, and generated media under `backend/media/`.
- `frontend/` contains the React + TypeScript app. Application code lives in `frontend/src/`, with pages, components, hooks, API clients, i18n resources, and frontend tests following the existing folder layout. Playwright end-to-end tests live in `frontend/e2e/`.
- `tests/` contains repository-level Python tests that are not tied to a single Django app.
- `scripts/` contains repository-level helper and maintenance scripts.
- `docs/` contains project documentation.
- `prompts/` contains saved prompt material used by the project.
- `.github/` contains GitHub Actions workflows and GitHub instruction files.

Follow existing placement patterns before creating new directories.

Deploy scripts, cron/scheduling config, and infra are **not** in this repo — they live in the separate `ops` repo (sibling directory `ops/`). Before concluding that a management command is never scheduled, or that a deploy/retention step is missing, check `ops` (`cron.d/`, `deploy/`, `services.d/`) as well as this repo.

## Frontend and UX Rules

### Text, Types, and Components
- UI text must always use i18n resources. New or changed user-facing text must
  include German translations in the relevant namespace.
- Never hardcode user-visible strings directly in components, dialogs, tables,
  filters, tooltips, snackbars, form helpers, or similar UI surfaces.
- Never render raw enum values, backend field names, or technical API error
  payloads directly. Map them to localized, user-friendly labels or messages.
- Use TypeScript for frontend code; do not introduce plain JavaScript where
  TypeScript is possible.
- Use PascalCase for component names and `useSomething` names for hooks.
- Prefer strongly typed props and avoid `any`.
- Avoid deprecated MUI APIs; use current patterns such as
  `slotProps.htmlInput` instead of `inputProps`.

### OpenFarmPlanner UI Style
- Follow the existing OpenFarmPlanner design language for UI elements,
  especially info boxes, warning boxes, validation messages, confirmation
  dialogs, empty states, snackbars, undo messages, context menus, hover
  actions, buttons, tables, DataGrid behavior, forms, and helper texts.
- Search the codebase for existing implementations before creating a new UI
  pattern. Reuse shared components, established layout/topbar patterns, and the
  most consistent local implementation.
- Do not introduce new colors, spacing, icons, typography, border styles, or
  interaction patterns when an equivalent OpenFarmPlanner pattern exists.
- The MUI theme is the only styling system. Component-level decisions go in
  `frontend/src/theme.ts`, single instances in `sx`, and anything shared in a
  `*Styles.ts` module next to its owner. Never add a per-component `.css`
  file, and never hardcode a colour or an off-grid spacing value — use the
  theme palette and MUI's 8px spacing unit. Read
  [`docs/design-system.md`](docs/design-system.md) before styling anything.
- Keep wording, button order, severity levels, and interaction behavior
  consistent with comparable screens.
- Empty states should guide users toward the next action. Prefer contextual
  actions over disabled controls.
- Avoid layout shifts during state changes.
- Detail-page primary actions must be labeled buttons with consistent size,
  spacing, and icons; reserve overflow menus for secondary or rarely used
  actions.
- For routed UI state, use explicit target URLs/state transitions instead of
  `history.back()` when an in-app control has a deterministic destination;
  preserve browser back/forward semantics for user-driven navigation and direct
  links.

### Responsive UI and Mobile Regression Protection
- Treat desktop, tablet, and mobile layouts as separate UI states that must be
  considered deliberately.
- Do not interpret a desktop change as an intended mobile change unless the
  task explicitly says so or the mobile impact is functionally necessary.
- Preserve existing mobile behavior and layout by default when the task does
  not ask for mobile changes.
- Check changes to shared components, styles, buttons, action menus, headers,
  toolbars, breakpoints, or layout containers for mobile impact before treating
  them as safe.
- Avoid broad style or component changes that accidentally alter mobile
  variants. Use explicit responsive props, breakpoint-specific styles,
  separated layout branches, or scoped component variants when needed.
- Avoid technical duplication, but never at the cost of distinct desktop and
  mobile requirements.
- Preserve intentional differences between desktop and mobile. Do not align a
  working mobile view to desktop purely for consistency.
- When a change also affects mobile for product reasons, design the mobile
  interaction intentionally instead of deriving it mechanically from the
  desktop solution.
- Account for mobile constraints: narrow width, touch target size, absent hover
  states, long-press instead of right-click, browser Back behavior, fullscreen
  dialogs or drawers instead of popovers, text truncation, portrait and
  landscape orientation, and the position and priority of primary and secondary
  actions.
- Use width as the primary responsive signal, but verify short-height phone
  landscape separately. A compact portrait mobile UI must not silently switch
  to tablet or desktop controls only because the device is rotated.

### Required UI Change Review
For every UI component or style change, check:

1. Which views and breakpoints use the changed component or style?
2. Is the task intended for desktop, mobile, or both?
3. Does behavior on unaffected breakpoints remain unchanged?
4. Are there existing intentional desktop/mobile variants?
5. Do action buttons, menus, and title areas still work at narrow widths?
6. Are there overlaps, clipped text, hidden controls, or displaced actions?
7. Does the view work in mobile portrait and landscape orientation?
8. Are hover-based interactions excluded from mobile or replaced appropriately?
9. Were relevant automated tests, visual checks, or screenshots added or run
   where the project workflow calls for them?

Decision rule:
- If the task asks only for a desktop change, treat mobile as regression
  protection and keep it as unchanged as possible.
- If a mobile change is not clearly required, do not redesign mobile silently.
  Keep the existing mobile version, or explicitly call out the uncertainty in
  the final summary.
- Redesign mobile only when it is explicitly requested or functionally
  necessary.

Final summaries for UI changes must briefly state which breakpoints were
checked, whether mobile stayed unchanged or was intentionally changed, how
responsive regressions were avoided for shared components, and which relevant
tests, screenshots, or manual checks were performed.

## Backend Rules
- Backend packages are managed with PDM. Use `pdm` commands and do not introduce `pip install`, `requirements.txt`, or `setup.py`.
- For local query profiling, install the dev group (`pdm install -dG dev`) and
  run with `DEBUG=True DJANGO_ENV=development`; django-debug-toolbar is
  deliberately absent from production and CI installs, so never import it
  unconditionally in settings, URLs, or application code.
- Follow PEP 8.
- Use Python type hints everywhere.
- New or changed Python functions and methods should include complete parameter and return type hints.
- Keep views thin.
- Put business logic into services where appropriate.
- Avoid database writes inside GET endpoints.
- Keep API responses predictable and stable.
- Use SI units internally for physical measurements stored in the database, and convert units only at system boundaries such as serializers, forms, or API layers.
- Document physical units in model `help_text`, docstrings, or API/schema descriptions where units are not obvious.

## Git and PR Workflow
- This repository should use the SSH GitHub remote:
  `git@github.com:OpenFarmPlanner/planner.git`
- If origin uses HTTPS and a push is requested, switch to SSH.
- Assume SSH works unless push errors indicate otherwise.
- Never commit directly to `main`. Always work on a feature/fix branch and open a pull request, even for small changes.
- Use Conventional Commits only:
  `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `build`, `perf`.
- Use `feat` or `fix` only for user-visible changes.
- Use `refactor` for structural changes without behavior changes.
- Keep commit and PR titles concise.

## Release and Production Deploy Workflow
- Production deploys must use an exact release tag in the `planner`
  checkout. Before deploying production, run
  `git describe --tags --exact-match HEAD` from this repo and confirm it
  returns the intended `vX.Y.Z` tag.
- If `HEAD` is not exactly tagged, do not proceed as though the build is a
  release. Either deploy an existing tag intentionally, or create the release
  through the repository's existing version/release flow first.
- Use the existing version bump tooling for manual release preparation:
  `make bump-version TYPE={feat|fix|breaking}`. This updates the central
  backend version via `scripts/bump_version.py`; do not edit version files by
  hand when the script applies.
- The normal GitHub release flow is driven by Conventional Commits,
  `release:*` labels, and `.github/workflows/release.yml`, which creates tags
  using the `v{version}` format configured in `pyproject.toml`. If a merge to
  `main` should have produced a release tag but did not, inspect and fix the
  release workflow before production deploy instead of bypassing the tag check.
- Use `--allow-untagged` for production only when the user explicitly asks for
  an emergency untagged deploy and the final summary calls out the exact commit
  that was deployed.

## Agent Collaboration Preferences
- When discussing how to approach a non-trivial task (architecture redesign, risky refactor, planning work), proactively recommend a reasoning-effort/model level (e.g. low/medium/high/xhigh, or a specific model) with a short rationale, before being asked.
- User-workflow/collaboration preferences like this one should be recorded here in CLAUDE.md, not only in a tool-specific private memory, since CLAUDE.md is the shared, centrally-linked ruleset read by all coding agents (Claude, Codex, Copilot, etc.).
- When changing the privacy policy or related legal texts, decide case by case whether the change only requires informing users or whether it requires renewed active consent from existing users. If renewed consent is necessary, implement the corresponding consent/version bump flow in the same change; if it is not necessary, state that explicitly in the summary.

## QA / Exploratory Testing
When asked to search for bugs, run exploratory tests, or do a QA sweep:
1. Read `docs/qa-strategy.md` first — it defines when to do a full vs. targeted sweep and contains Playwright setup details.
2. Read `docs/qa-coverage-*.md` (most recent date) — it lists which areas were last tested, at which git commit, and known UI patterns that look like bugs but are by design. Only the most recent coverage file stays in `docs/`; older reports, fix logs, and coverage snapshots are archived under `docs/qa-archive/` and are historical only.
3. Read `docs/qa-excluded-issues.md` — do not re-report these won't-fix items.
4. After the session, update `docs/qa-coverage-*.md` with the new git commit reference and any newly confirmed areas. If you write a new dated coverage file instead, move the previous one to `docs/qa-archive/` and update the reference in `docs/index.md`.

## Security Review Protocol
Claude and Codex alternate security reviews of this repository, so each tool
has to be able to see what the other already covered. `docs/security-review-log.md`
is the shared, append-only record of that. It is the process record; the deep
narrative of the most recent full review stays in its own dated document
(`docs/security-review-*.md`), and the always-on automated checks are described
in `docs/security-automation.md`.

When you are about to perform a security review — a full sweep, a targeted
review of a boundary, or the security part of a larger change:

1. Read `docs/security-review-log.md` in full first. Not just the top entry:
   an OPEN finding several entries down is still open.
2. Find the most recent entry that covers the scope you are about to review,
   and let it decide what kind of review this is:
   - **Last reviewed by the other tool and not yet CROSS-CONFIRMED** — do a
     real cross-review of that scope. Independently re-derive the findings
     from the code rather than accepting them; this is the whole point of two
     tools alternating. Do not skip the scope because it "was just reviewed".
   - **Last reviewed by the same tool with nothing changed since** — verify
     that the prior findings still hold instead of re-flagging them as new
     discoveries. Spend the effort on scope that is stale or never covered.
   - **Never covered** — review it and say so in the entry, so the gap stops
     being invisible.
3. For every OPEN finding in your scope, check whether the code has since
   fixed it. If it has, record it as FIXED in your new entry, naming the
   commit or PR that fixed it; do not report it again as a new finding.
   Deferred scope listed as OPEN (e.g. `ops`-repo infrastructure) stays OPEN
   until it is actually reviewed.
4. After finishing the review, append a new entry at the top of
   `docs/security-review-log.md` — never edit or delete a prior entry — with
   the date, the tool (Claude or Codex), the scope (commit range, PR, or named
   area), and the findings. Each finding gets one of `FIXED`, `OPEN`,
   `WONTFIX` (plus a short reason), or `CROSS-CONFIRMED`. Mark findings from
   the other tool's prior entries as CROSS-CONFIRMED where you independently
   verified that they still hold or have been addressed, naming which entry
   and finding you confirmed.

A review that produced no findings still gets an entry. "Nothing found here on
this date, by this tool" is exactly the information the other tool needs.
