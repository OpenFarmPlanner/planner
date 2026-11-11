# P0 epic progress

Open P0 issues inventoried on 2026-11-11. Work is sequential; each issue starts from the current default branch and is merged only after required checks and reviews.

1. **#1030** — Remove the screenshot comparison gate; preserve responsive and functional tests. In progress.
2. **#1028** — Germination model, migration, API and presentations. Establish the shared schema before template work.
3. **#1032** — Typed species-specific properties across project, library and spreadsheets. Establish the remaining schema and exchange fields.
4. **#1031** — Localized companion notes and spreadsheet grammar. Establish exchange semantics before templates and the dedicated editor.
5. **#1017** — Reconcile templates and labels against the completed import schema, avoiding duplicate template updates in earlier issues.
6. **#1008** — Life-cycle selectors and legacy values.
7. **#1007** — Shared crop display-name resolution, before the companion editor uses it.
8. **#1029** — Dedicated companion editor, building on localized notes and display-name handling.
9. **#1014** — Remove the unrelated culture detail empty state.
10. **#1021** — Localize demo content after schema and UI changes.
11. Final integration and UX review, with a separate PR for necessary consistency fixes.

The order may be revised if implementation reveals a dependency. Issues #1032 and #1031 require template compatibility themselves; #1017 completes the comprehensive examples and label audit without deferring their acceptance criteria.

## Current blocker

#1030 is incomplete and unmerged. The local cross-browser Docker run could not pull `mcr.microsoft.com/playwright:v1.65.0-noble`: the registry download returned `Forbidden`. The host Chrome E2E run could not launch because `/opt/google/chrome/chrome` is absent. The quality run was started but did not complete. No PR has been opened; the working tree contains unverified changes. Restore access to the pinned Docker image and Chrome, complete the implementation and quality/integration checks, then proceed with the PR and required checks before starting the next issue.
