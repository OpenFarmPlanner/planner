# OpenFarmPlanner Technical Documentation

This is the technical documentation for OpenFarmPlanner, aimed at
developers and AI coding agents working in this repository. For setup
instructions and quick start, see the root [`README.md`](../README.md).
For contribution/commit conventions, see [`CONTRIBUTING.md`](../CONTRIBUTING.md).
For rules AI agents must follow when changing code, see [`CLAUDE.md`](../CLAUDE.md).

## Start here

- **[Architecture Overview](./architecture-overview.md)** — tech stack,
  backend/frontend structure, the project/user/permission model, and the
  main architecture/UX decisions worth knowing before changing things.
- **[Data Model](./data-model.md)** — the core domain objects and how they
  relate, with Mermaid diagrams. Not a full field reference.

## Complex features

- **[DataGrid Architecture](./datagrid-architecture.md)** — the custom
  layer OpenFarmPlanner built on top of MUI X DataGrid: inline editing,
  autosave-on-blur (`useAutosaveDraft`, `useNavigationBlocker`), row
  actions, notes/markdown cells, copy/paste, column visibility.
- **[Demo Project Template](./demo-project.md)** — the reusable realistic
  demo dataset used by first-project onboarding and landing screenshots.
- **[Hint Test Project](./hint-test-project.md)** — reproducible developer
  fixture for hints, warnings, empty states, incomplete calculations, and
  related manual QA paths.
- **[Keyboard Navigation Architecture](./keyboard-architecture.md)** — the
  focus-region model and the shortcut/command system.
- **[Design System](./design-system.md)** — where a style belongs (theme vs.
  `sx` vs. shared style module), the spacing/colour/breakpoint conventions,
  the two remaining stylesheets, and the RTL rules.
- **[Form Layout](./form-layout.md)** — responsive field-width roles and the
  exceptions for grid editors, narrow popovers, and search controls.
- **[Occupancy Tree / Gantt Hierarchy](./occupancy-tree-hierarchy.md)** —
  the Standort → Parzelle → Beet tree in the bed-occupancy calendar, plus
  the Gantt calendar's context menu, drag-and-drop, and row-height model.
- **[Social Login](./social-login.md)** — Google/Microsoft sign-in via
  django-allauth: the OAuth flow, the account-linking rules, and the
  Google/Microsoft setup steps.
- **[External Tool API Tokens](./agent-api.md)** — project-bound API tokens for
  external tools, scripts, and coding agents: the security model, the available
  permissions, the crop validation and plausibility rules, and the two-step
  preview/apply import flow.
- **[Crop Library Architecture](./crop-library-architecture.md)** — the
  project-owned `Crop` vs. shared `PublicCrop` split, and the `crops`
  Django app that prepares (but doesn't yet expose) a public Crop Library.
- **[In-App Notifications](./notifications.md)** — the generic
  `Notification` model and topbar bell: why the stored text is English while
  the UI is German, how a new notification kind is added, and the two
  behaviours (no mark-read on open, platform-formatted relative times) that
  are load-bearing.
- **[Real-time Updates](./realtime-updates.md)** — Channels/WebSocket
  invalidations, discussion authorization, resilient frontend connections,
  local configuration, and the infrastructure work deferred to Part B.
- **[Internationalization (i18n)](./i18n.md)** — supported languages, how the
  UI language is resolved and stored, the crop-library translation model and
  its fallback rules, cross-language search and duplicate detection, and the
  data-migration assumptions.
- **[International Public Crop Library Data Model](./public-crop-library-data-model.md)** — the
  language-independent species/variety architecture, translation
  strategy, attribute inheritance, and incremental migration plan.
- **[Seed Demand Calculation](./seed-demand-calculation.md)** — how
  required seed amounts and package suggestions are computed, with worked
  examples.
- **[Versioning and History](./versioning-and-history.md)** — the
  `EntityRevision` audit trail and how crop/project restore works.
- **[Large-Dataset Rendering](./large-dataset-rendering.md)** — pagination,
  bulk-read limits, and scroll-driven windowing for large projects.
- **[Seasons](./seasons-architecture.md)** — the project-scoped `Season` and
  `SeasonPattern` models, the season switcher and its "copy data" action, the
  first-run setup that migrates a project's pre-existing planting plans, and
  how `PlantingPlan` list requests get season-scoped via `X-Season-Id`.

## Geplant / in Arbeit — noch nicht implementiert

Everything linked above describes code that exists. This section is the
opposite: features that are **planned only** and have **no counterpart in the
codebase**. There is deliberately no deep-dive doc for them — writing one
before the design exists would produce exactly the confusion this section is
here to prevent. If you are advising on architecture or scoping work, treat
these as green field.

| Planned feature | Current state in the code |
|---|---|
| **Fruchtfolge / crop rotation** — rotation planning and rotation rules at Parzelle (`Field`) level | Nothing. The only related data is `Crop.crop_family` (`help_text`: "Crop family for rotation planning"), `Crop.nutrient_demand`, and `Crop.rotation_break_years` (recommended years before growing the same crop family again). All three are plain informational fields today, grouped under a "Fruchtfolge-Eigenschaften"/"Crop Rotation Properties" section on the crop detail page: no rotation model, no history-of-use per field, no validation, no UI beyond that display/edit. |

One consequence worth stating explicitly, because it is easy to mis-assume:

- **`crop_family` being present is not rotation support.** It is a label on a
  crop; nothing reads it to check or suggest a rotation.

Seasons were in this table until they were implemented — see
[seasons-architecture.md](./seasons-architecture.md) now instead.

Partially built features live with their own docs instead of here — the public
Crop Library is the main one, and
[crop-library-architecture.md](./crop-library-architecture.md) opens with a
table of what is and isn't implemented.

## Process / QA

- [`testing-and-ci.md`](./testing-and-ci.md) — how the frontend, backend and
  E2E suites are split across CI jobs, why the frontend is sharded and the
  backend runs under xdist, and where the runtime actually goes.
- [`security-automation.md`](./security-automation.md) — automated dependency,
  SAST, Django deployment, and GitHub-native security coverage and triggers.
- [`security-review-2026-09-05.md`](./security-review-2026-09-05.md) — latest
  manual security-review baseline, confirmed findings, reviewed surfaces, and
  the areas that still require a future dedicated assessment.
- [`qa-strategy.md`](./qa-strategy.md) — when to do a full vs. targeted
  exploratory QA sweep.
- [`qa-coverage-2026-07-27.md`](./qa-coverage-2026-07-27.md) (or a later
  `qa-coverage-*.md`, if one exists — use the most recent date; older ones are
  in [`qa-archive/`](./qa-archive/)) — what was last tested, at which commit.
- [`qa-excluded-issues.md`](./qa-excluded-issues.md) — known, intentional
  behavior that looks like a bug but isn't; don't re-report these.
- [`keyboard-shortcuts-audit.md`](./keyboard-shortcuts-audit.md) — shortcut
  inventory audit.

## Archives

Nothing in these folders is maintained — they exist so the original reasoning
stays retrievable:

- [`archive/`](./archive/) — completed implementation notes and point-in-time
  reports that were superseded by the docs above.
- [`qa-archive/`](./qa-archive/) — dated QA reports, fix logs, and superseded
  coverage snapshots.

## Conventions used across these docs

- Mermaid diagrams for relationships/flows where they help; plain prose
  otherwise.
- A point marked **"unclear / needs check"** means the author could not
  verify it from the code alone — treat it as a question, not a fact.
- These docs describe *why* things are the way they are, not just *what*
  the code does — the code itself, plus inline comments at the specific
  non-obvious spots, is the source of truth for exact behavior.
