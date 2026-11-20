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

## Targeted localhost companion history acceptance — 2026-11-20

Verified #1202 / merged PR #1277 (`d93ab49f8`) on main
`f2c1a2d0b14befcbe9ea6b8850380c2628cfae0d`. This narrowly scoped acceptance
check does not advance the full-sweep baseline or resolve the backlog above.

- Used the existing development servers at `http://localhost:5173` and
  `http://localhost:8000`, with local loopback PostgreSQL. Previewed the exact
  database target, then applied the guarded `seed_companion_history_acceptance`
  command for an existing local account. Only the isolated synthetic
  **Companion history acceptance** project was exercised; no migrations,
  application changes, existing-project edits or server restarts were needed.
- Imported the documented JSON through the Crops file-import dialog, checked
  **Allow updates**, and started the import. The result reported one new crop,
  one updated crop and one imported neighbour. The completed operation appears
  as one **2 crops imported** history entry.
- Both companion records have a non-null `companion_crop` and empty
  `companion_text`, including the former free-text neighbour. The other record
  retains `notes.en = "Imported note"`. The English note is verified in the
  API payload; the German UI does not display an English-only note.
- Edited the owner's crop notes through the edit dialog and saved. Restored
  the completed import through Project History and its confirmation dialog:
  HTTP 200, the later crop note disappears, both linked neighbours retain their
  original relation IDs and crop targets, and the imported English note remains.
  Repeated the edit/restore successfully at 375×800 after the desktop
  1440×900 run; the JSON file import itself was performed at desktop size.
- Inspected the restored crop at 1440×900, 375×800 and 800×375 in Chrome,
  German UI. Both neighbour links remain visible. The known shared topbar
  overlap at 800×375 was reproduced twice and is tracked by #930; no duplicate
  issue or queue change. The portrait companion section fits the viewport.
- Throwaway Playwright script and screenshots are retained locally under
  `/tmp/ofp-1202-acceptance/`; they are not committed or public attachments.
  The synthetic fixture remains available locally for the owner's inspection.

Result: **PASS** for the requested import/relink/full-restore acceptance case.
No new functional defect was found in this scope. This run does not certify
other import formats, selective undo, concurrency or the rest of the app.
