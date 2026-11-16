# QA Coverage — 2026-11-16

Targeted culture-identity correctness audit of main
`fb7ac141907baf26e1537f9f0d23ef2302d29163`, following #1145 / PR #1150.
This is not a full application sweep, a security review, a PostgreSQL
concurrency run or production validation. Older broad UI coverage remains in
[the July coverage archive](qa-archive/qa-coverage-2026-07-27.md).

## Scope and environment

The owner asked whether other operations could fail like the library-sync
name conflict. Although many commits have landed since the previous broad
sweep, this session deliberately covers the requested identity paths and their
direct dependents: CRUD, sibling renaming, import/link/sync, undelete and
per-crop revision restore. Changes since the previous baseline include #1040,
#1078, #1107, #1119, #1150 and #1152. Other application areas were not retested.
Known exclusions were read before testing.

- Temporary synthetic users/projects; no production access or user-data copies.
- Python 3.14, Django test settings, isolated in-memory SQLite for API probes.
- Separate temporary file-backed SQLite database and servers at
  `127.0.0.1:8274` / `127.0.0.1:5274` for browser confirmation; existing user
  servers and their database were left running unchanged.
- Chrome via Playwright, German UI, desktop 1440x900, phone 375x800 and phone landscape 800x375.
- Test users/project created through the token-guarded E2E setup endpoint;
  browser fixture cultures and supplier created through normal API endpoints.

## Confirmed coverage

| Area | Evidence | Result |
| --- | --- | --- |
| General-crop conflict protection | Ten focused existing API tests, eight additional subtests | Pass: create/species guard, rename rollback, undelete, revision restore, initial-link atomicity, library sync and import constraint fallback |
| Variety undelete with same supplier | Two independent synthetic runs | HTTP 500 instead of conflict; deleted row remains deleted |
| Variety revision restore with same supplier | Two independent synthetic runs | HTTP 500 instead of conflict; current variety is retained |
| Sibling variety rename with same supplier | Two independent API runs and actual edit dialog at desktop/phone widths | HTTP 500, generic update error, dialog remains open; group names roll back |
| Library variety-name pull with same supplier | Two independent synthetic runs | HTTP 500; current variety is retained |
| Variety undelete without supplier | Two independent synthetic runs | HTTP 200 creates two active rows with the same normalized name/variety |

The five new probes deliberately assert HTTP 409: their assertion failures
are the observed defects, not failures in the ten existing control tests.
The 500 cases hit `unique_crop_normalized`; the null-supplier case demonstrates
why catching the database exception alone cannot enforce logical identity.

## Findings and follow-up

- [#1164](https://github.com/OpenFarmPlanner/planner/issues/1164), P1, epic
  #1013: reject conflicting variety identities consistently across restore,
  sibling rename and library sync. Includes synthetic reproduction steps and
  preservation requirements. Filed without adding it to the work queue.
- Existing [#1089](https://github.com/OpenFarmPlanner/planner/issues/1089)
  covers stale rename source identity under concurrency; its source trace was
  read, but no PostgreSQL interleaving was executed here.
- Existing [#1085](https://github.com/OpenFarmPlanner/planner/issues/1085)
  covers legacy snapshot normalization. Broader project/import history changes
  remain [#1061](https://github.com/OpenFarmPlanner/planner/issues/1061).
- The earlier general-name fix remains covered. None of the existing issues
  was reopened; no application fix or data repair was applied in this QA pass.

Detailed reproduction and commands are in
[the audit report](qa-archive/qa-report-2026-11-16.md).
