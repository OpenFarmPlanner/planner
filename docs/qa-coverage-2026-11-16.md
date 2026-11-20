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

## Targeted follow-up — 2026-11-20: variety publication (#953)

Tested local main `b8b45bb615f5bb715029a17b22fdb676e04cd85f`, including
merged PR #1309, against the existing development frontend at
`http://localhost:5173` and backend on port 8000 in headless Chrome.
This owner-requested acceptance check does not advance the full-sweep baseline.

Ran a scratch copy of `frontend/e2e/variety-parent-publication.spec.ts` with
only import paths and the runner configuration adapted to the existing local
servers. All three tests passed (French, Portuguese and Dutch; 1.9 minutes).
Synthetic users/projects were created through the guarded E2E fixture and
reset in each test's cleanup. Test-specific approved species and public
entries were synthetic; existing library entries were not edited.

Confirmed the requested sequence:

- An unlinked parent's variety initially offers the editable species picker.
- Switching to a species without a public general entry explains creating
  that entry from the parent crop's values; switching back restores the
  existing-entry link notice and field comparison.
- Taking the library growth duration (77 days) while keeping project notes
  publishes successfully. API readback confirms the parent's public link,
  77-day duration, retained private notes and notes in `library_pinned_fields`.
  The variety receives its public link and retains its own 50-day duration.
- Publishing another variety shows the linked parent species read-only,
  removes the species combobox and leaves Publish enabled.

Checked the comparison dialog at 375×800, 768×900, 1024×900, 1440×900 and
800×375; Publish stays in the viewport and page overflow assertions pass.
Visually inspected the French screenshots for all five sizes and the
create-parent/read-only-parent states. The dialog content scrolls at compact
sizes and its footer remains reachable. Screenshots and the scratch runner
are local artifacts under `/tmp/ofp-953/`. No application code or UI changed.

Removed only #953's row from work queue #1058 after these checks, as explicitly
requested by the owner; no personal-acceptance checkbox was checked.
