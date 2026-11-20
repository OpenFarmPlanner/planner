# QA Coverage — 2026-11-16

Targeted culture-identity correctness audit of main
`fb7ac141907baf26e1537f9f0d23ef2302d29163`, following #1145 / PR #1150.
This is not a full application sweep, a security review, a PostgreSQL
concurrency run or production validation. Older broad UI coverage remains in
[the July coverage archive](qa-archive/qa-coverage-2026-07-27.md).

## Outstanding full-sweep backlog

This targeted audit does **not** advance the baseline for a full sweep.
Retain `a2caf390195742d3c5934e68287179bf8aa9af61`, the latest commit
recorded before this audit in the archived coverage, as the conservative
change-review anchor. That older entry was itself targeted; it is not proof
that the whole application was covered at that commit. The archive's other
coverage limits and the open checks in `docs/qa-strategy.md` remain outstanding.

There are 1,307 commits from that anchor to this audit's `fb7ac141`.
The full-resweep triggers in `docs/qa-strategy.md` therefore remain active.
The next QA pass must begin with:

```bash
git log a2caf390195742d3c5934e68287179bf8aa9af61..HEAD --stat
```

Run the full application sweep required by that strategy, including changed
non-identity areas and shared components that this audit did not test. Do not
use `fb7ac141..HEAD` as the sole scope, or treat the identity probes below as
coverage of the intervening changes. Replace this outstanding baseline/backlog
only when an actual full sweep records its scope, limits and reviewed commit.

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

## Targeted localhost companion-note acceptance — 2026-11-20

Owner-requested acceptance of #1088 / merged PR #1288 at
`b8b45bb615f5bb715029a17b22fdb676e04cd85f`. This adds only the scoped
companion-note coverage below; the outstanding full-sweep baseline and backlog
above remain unchanged.

- Used the existing localhost servers (`localhost:5173`, backend port 8000)
  and local loopback PostgreSQL database. Previewed the guarded
  `seed_companion_history_acceptance` target before applying it for the
  existing local owner. The idempotent fixture retained the existing imported
  linked pair and the other neighbour. No migrations or application changes.
- Playwright drove two actual editor tabs in the German UI. Both loaded the
  same pair; the reciprocal tab saved a new French note. The older tab then
  selected French, confirmed its stale cached text, changed only the reason
  to `allelopathy`, and saved successfully.
- Inspected the actual `PUT /api/crop-companions/replace/` request: the pair
  included the changed reason and no `note`, `notes` or `note_language_code`.
  Reopening the editor from both crops displayed the newer French note.
  API assertions confirmed unchanged relation identity, retained German and
  English notes, the newer French note, and the changed reason.
- Reopened the French editor at 1440x900, 375x800 and 800x375. Assertions
  passed at each size; inspected screenshots of desktop and both phone
  orientations. Existing phone layout and scrollable landscape dialog retained;
  no UI implementation changes. No new defect confirmed in this scoped test.
- Left the private **Companion history acceptance** fixture available to the
  owner on localhost. Local evidence (script, screenshots, request payload and
  final assertions) lives outside version control in
  `/tmp/ofp-1088-acceptance/`; authentication material is not published.

This was the requested two-tab scenario, not a full rerun of the automated
companion suite, a broad QA sweep, or a production validation.
