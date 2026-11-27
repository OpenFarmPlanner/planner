# QA Coverage — 2026-11-26

Full exploratory sweep of main `bae8f26c5e82d6dcc0e398f07ea3c25acaeb9d08`
(v1.223.0). Findings and reproductions:
[QA report](qa-archive/qa-report-2026-11-26.md). Earlier coverage, including
the targeted acceptance runs of 16–24 November, is in
[the archive](qa-archive/qa-coverage-2026-11-16.md).

## Baseline for the next sweep

This sweep replaces the full-sweep anchor `a2caf390` (1,604 commits earlier)
that the previous coverage file kept open. It covered every app route and the
core user flows, with the limits listed under
[Not covered](#not-covered-in-this-sweep). Start the next pass with:

```bash
git log bae8f26c5e82d6dcc0e398f07ea3c25acaeb9d08..HEAD --stat
```

Commits that landed on main during the sweep and are **not** covered:
`df1a5057a` (qa-refresh skill, docs only) and `e0732c535` (crop phases and plan
tasks on individual plant markers, #1655).

## Scope and environment

- Isolated worktree build (production bundle via `vite preview`, daphne,
  fresh SQLite). Gettext catalogs were compiled partway through to match
  production. Synthetic E2E fixtures only. The owner's servers were not touched.
- Chrome via Playwright. German at 1440×900, 768×900, 375×800 (touch) and
  800×375 (touch). English, French, Spanish, Italian, Portuguese and Dutch at
  1440×900 and 375×800 for the route crawl and German-leak check.
- Known exclusions read first. Throwaway scripts and screenshots stayed local.

## Confirmed coverage

| Area | Viewports | Result |
| --- | --- | --- |
| All 19 app routes: crawl for page errors, failed API calls, overflow, raw i18n keys, screenshots | all four, 7 languages (non-German at 2) | Pass |
| German UI text leaking into en/fr/es/it/pt/nl | 1440, 375 | Pass (only German demo user data) |
| Localized public pages | 1440, 375 | All 35 registered variants passed a follow-up on the same baseline. The original sweep recorded 20 without listing them. |
| Login, register, forgot password, demo | 1440, 375 | Pass, each in its own language |
| Sign-in / reset / account messages per language | 1440 | **Fail**: [#1657](https://github.com/OpenFarmPlanner/planner/issues/1657) |
| New-user journey: dashboard checklist → parcel → bed → crop dialog → season → planting plan (keyboard entry) | 1440 | Pass |
| Invitation acceptance via login, reused link | 1440, 375 | Pass |
| Password change (wrong and correct current password, re-login) | 1440 | Pass functionally; message language → #1657 |
| Project create (first location named after project), delete, trash, restore | 1440 | Pass |
| Guest demo start, localized demo data (de, en) | 1440 | Pass |
| Graphical areas incl. individual plants, edit mode, compact toolbars | all four | Pass |
| Mobile fields list (expand, edit sheet), planting-plan menu and details, task status menu, harvest dialog | 375 | Pass |
| Planting-plan details page | 1440, 375 | Pass |
| Gantt week zoom, "Zeitraum verschieben" toggle | 1440 | Pass |
| Task create, harvest save, supplier add, crop edit cancel, library import dialog (empty library), project history menu, command palette | 1440 | Pass |
| Yield forecast calendar with real demo data | 1440, 375 | **Fail**: [#1658](https://github.com/OpenFarmPlanner/planner/issues/1658) |
| Yield season comparison | 1440, 375 | **Fail**: [#1659](https://github.com/OpenFarmPlanner/planner/issues/1659) |

## Not covered in this sweep

- Drag and drop: Gantt bars, graphical bed/plant moves, task board columns.
- Crop library publishing, moderation and sync (the fresh database has no
  public crops; last covered in the July archive).
- Spreadsheet import/export files, notes with photos, API tokens.
- Email change confirmation flow, account deletion, registration submit and
  activation email.
- Crop rotation and companion conflicts, perennial harvest overrides, season
  copy treatments, young-plant and seed demand editing.
- PostgreSQL-specific behavior (search ranking, locking); version restore was
  covered separately on 2026-11-24 (archived coverage).
- Firefox/WebKit (covered by the nightly cross-browser suite only).

## Known patterns that look like bugs but are by design

- Switching or creating the active season reloads the whole app.
- The command palette lists commands for the current page, not page navigation.
- Bed labels in the graphical view appear only when the bed is drawn tall
  enough (0.75 m beds stay unlabelled at default zoom).
- Tapping a location/bed in the mobile list opens its edit sheet; other
  actions sit in the sheet's ⋮ menu.
