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

## Targeted localhost acceptance — 2026-11-20, #1087 / #1283

Tested main `b8b45bb615f5bb715029a17b22fdb676e04cd85f`, which includes
#1283 (`b96657f53`). This is a requested legacy-companion import acceptance
check, not a full sweep or security review; the full-sweep backlog above is
unchanged.

- Used the running localhost frontend on port 5173 and backend on port 8000.
  Created a separate synthetic project through the guarded E2E endpoint;
  existing user projects and running servers were left unchanged.
- Uploaded a two-row CSV through the actual import dialog. Its neighbour cell
  used the supported spaced en-dash legacy format and a German note containing
  a comma: `QA1087 Basilikum – Schutz vor Schädlingen, Quelle 2026`.
- Preview returned two new crops and one resolved companion without warnings;
  reading the preview did not create crops. Apply returned two created crops,
  one created companion and no errors through crops/companions/finalize phases.
- Verified both stored crop IDs belong to the captured active project and the
  relation references those IDs, with no free-text companion. Clicking the
  neighbour navigated to the other crop, where the reciprocal link appeared.
- Verified exact storage as `notes.de` with `note_language_code: de`. Switching
  the browser UI to English did not display the German note as fallback;
  switching back restored its display unchanged.
- Repeated the actual CSV preview/apply at 375x800 with a second synthetic
  crop pair: two created crops, one created companion, no errors.
- Inspected companion details screenshots at 1440x900, 375x800 and 800x375:
  note and neighbour link remained readable without clipping or overlap.
  No UI code was changed.
- The five bounded synthetic examples in `test_legacy_companion_limits.py`
  passed using Django's test runner with `config.settings_test` (0.004 seconds).
  The initial pytest invocation failed before test execution because the
  session taxonomy fixture queried an absent `crops_cropspecies` table;
  this is recorded as a runner limitation, not a parser-test failure.

Local scripts, request receipts and screenshots are under `/tmp/qa1087/` on
the test machine. No load test, production test or cross-project authorization
adversarial test was performed. No import defect was observed in this scope.

## Targeted library restore acceptance — 2026-11-20

Tested #1099 / merged PR #1285 on main
`b8b45bb615f5bb715029a17b22fdb676e04cd85f` using real Chrome through
Playwright on localhost. This narrow acceptance test does not advance the full
sweep baseline or satisfy #1232; the outstanding backlog above remains.

- Isolated file-backed SQLite database, backend `127.0.0.1:8299`, Vite frontend
  `127.0.0.1:5299`; existing servers and user data were not changed.
- Created three synthetic accounts: established editor, new contributor and a
  separate moderator with the library moderator permission. Recorded Terms
  acceptance and explicit established trust for the editor/moderator only.
- Previewed the actual database target, then applied the guarded
  `seed_library_import_acceptance --include-variety-selection` command. Used
  its synthetic Nantaise 2 published variety and recorded its initial revision.
- **Pass:** established editor saved a Notes edit through the UI, producing
  version 2 (PATCH 200). The new contributor selected version 1 under Versions;
  the UI confirmed pending approval and POST revert returned 202. A fresh GET
  still showed version 2 and the editor's Notes.
- **Pass:** moderator opened the contribution review, which identified source
  version 1 and the proposed Notes. Approval returned 200. A fresh GET showed
  the original Notes and version 3; a browser reload showed
  “Aus Version 1 wiederhergestellt” on the current version.
- Inspected screenshots at 1440×900, 375×800 and 800×375. The restore history is
  visible at each size. Found clipped phone history actions and raw cultivation
  field names/enum values; reproduced both on two fresh page navigations and
  filed [#1346](https://github.com/OpenFarmPlanner/planner/issues/1346), P3.
  These presentation issues do not invalidate the restore acceptance result.
- Local evidence: `/tmp/ofp-1099-acceptance/` contains the throwaway Playwright
  scripts, result JSON, proposal response, screenshots and three role traces.
  Credentials and database contents are not committed. No application changes,
  deployment, full test suite or owner acceptance checkbox changes were made.

Durable findings for the library restore run: [QA report](qa-archive/qa-report-2026-11-20.md).

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

## Targeted follow-up — 2026-11-20: exact crop synonyms (#1159)

Tested `b8b45bb615f5bb715029a17b22fdb676e04cd85f`, which includes
PR #1305 (`c7bbbd786`). This check covers only the requested publishing picker;
the outstanding full-sweep baseline and backlog above remain unchanged.

- Ran `npm run test:e2e:headed -- e2e/crop-species-autocomplete.spec.ts`
  from `frontend/`: **2 passed** (Italian desktop and Portuguese touch).
- Production frontend at `http://127.0.0.1:15359`, disposable Daphne backend
  at `http://127.0.0.1:18359`, fresh SQLite database outside the checkout;
  existing local servers and their data were not used.
- Both cases create 21 partial-name matches and two exact synonym matches.
  Both exact matches remain visible under their localized official names in
  the capped list of 20, with the matching synonym explanation.
- Ambiguous matches require selection: publishing is disabled beforehand,
  the propose-new action is absent, and selecting with Italian keyboard
  navigation or Portuguese touch enables publishing with the selected name.
- Inspected screenshots at 1440x900 (Italian), 375x800 and 800x375
  (Portuguese): both exact options are visible; no horizontal overflow or
  picker layout defects observed. Fixture cleanup completed.
- No application changes or new defects from this targeted run. Local evidence:
  `/tmp/ofp-1159-Xep6lh/headed-test.log` and
  `/tmp/ofp-1159-Xep6lh/screenshots/` (temporary artifacts, not committed).

## Targeted follow-up — 2026-11-20: closed species picker popup (#1180)

Tested local main `b8b45bb615f5bb715029a17b22fdb676e04cd85f`, including
PR #1307 (`f2ca0124b`), against the existing development frontend on
localhost:5173 and backend on localhost:8000. This owner-requested acceptance
check does not advance the full-sweep baseline above.

- All three German Chrome browser checks passed: 375x800 portrait, 800x375
  short landscape and 1440x900 desktop (3 passed, 1.4 minutes).
- Used a scratch copy of `crop-species-popup.spec.ts`, with an additional
  assertion that variety text remains after selecting a species. Created
  isolated synthetic moderator/identity fixtures through the guarded E2E API;
  each scenario was reset after testing. Existing servers were not restarted.
- Verified Escape closes only the popup; reopening and Tab focuses variety;
  touch focus changes hide the popup; scrolling the reference out of view
  hides it; Enter on Save with blank species focuses the validation error.
  Both actual popup visibility and `aria-expanded=false` were asserted.
- Reopened live search, selected a visible species by touch, and confirmed
  the selected species and previously entered variety survived blur.
- Inspected error screenshots at all three viewports: no orphan popup, no
  horizontal page overflow, readable focused error and reachable Save/Cancel.
  No application code or responsive behavior changed.

Scratch script and screenshots: `/tmp/ofp-1180/` (local only).
No defect reproduced in the requested flow. No production testing performed.

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

## Targeted project restore verification — 2026-11-20 (#1335)

This owner-requested check covers full project restore before crop imports.
It does not advance the outstanding full-sweep baseline above. The public
production `/api/version/` endpoint returned `{"version":"1.183.1"}`;
this is newer than the full-restore introduction in v1.178.0. No production
project was accessed or modified.

Tested isolated localhost servers with disposable SQLite databases and
production frontend builds at:

- v1.183.1: `92db6a5f50f7b9d3b271306e7265f20fea8b9e41`.
- Current main: `30a806545` (includes merged regression PR #1341).

The throwaway Playwright probe reuses the merged #1341 regression: create a
selectable pre-import crop version, import a general crop and variety through
spreadsheet apply, import another general crop and variety from synthetic
public-library records, then use **Restore this version** in global project
history. It checks HTTP 200, exact active crop IDs, the refreshed visible crop
list and unchanged public-library IDs, names, varieties and versions.
Fixture users/projects and library records are reset after each run.

Desktop (1440×900), mobile portrait (375×900) and phone landscape
(800×375) passed on both versions: one original active crop became
five after the imports and returned to exactly the original ID after restore.
The four imported private rows disappeared from the active crop list.
The mobile probe opens the crop-picker dialog; its first run incorrectly used
the desktop listbox selector and stopped before restore. After adapting that
selector to the intentional mobile UI, the probe passed. Screenshots of the
restored desktop list and mobile picker were visually inspected; the retained
crop is visible without overlap or clipping. No mobile behavior changed.

Backend validation used the repository's pytest configuration
(`config.settings_test`) on SQLite:

```bash
python -m pytest farm/tests/test_crop_history.py farm/tests/test_history_invariants.py -n 0 --no-cov
```

The v1.183.1 run passed all 71 tests; current main passed all 87 tests.
These include the atomic HTTP 409 refusal
for incomplete legacy history. An initial `manage.py test` invocation used
runtime settings and exhausted request throttles; its failures were harness
configuration errors, and both runs were repeated with the prescribed pytest
settings.

The previously reported retention was investigated in merged PR #1341: the
selected legacy target lacked history for older geometry rows, so restore
returned HTTP 409 and preserved current data. Such a rejected restore must
not be described as a successful restore retaining later crops.

Scratch scripts, screenshots, build output and test logs are retained locally
under `/tmp/ofp1335-verify/`. No application code or UI text changed, no
production deployment was performed, and the user's running servers and
existing modified coverage file were left intact.

Per the owner's explicit request, removed only #1335's row from work queue
#1058 after the browser checks passed, re-fetching immediately before writing
and verifying the exact resulting body. The issue was already closed and
implementation PR #1341 was merged; no open PR matching #1335 was found.
No checkbox was changed. Evidence was also recorded on #1335.

## Targeted follow-up — 2026-11-20: media orphan markers (#1196)

Tested localhost frontend on port 5173 and backend on port 8000 with local
PostgreSQL and German Chrome. The completed run used main
`63faa46118ddc0a7d2a972fe483570f76ca5919b`, including merged PR #1315.
This owner-requested check does not advance the full-sweep baseline.

- Created disposable private project 3399 through the normal API under a
  synthetic QA account, uploaded a real PNG and attached it to crops 20686
  and 20687. Existing projects and running servers were preserved.
- Restored project versions through the rendered version-history confirmation
  dialog at 1440x900, 375x800 and 800x375. Before/after clearing the first
  reference, the second crop retained the same image ID and storage bytes;
  the media orphan marker stayed null.
- Clearing the final reference set the marker. Restoring that version after
  reattaching retained its historical detachment time at the documented
  millisecond precision. The automatic backup restored successfully on phone,
  reattached the image and cleared the marker. Repeating the detached restore
  set the marker consistently again.
- Read-only verification of the localhost cleanup predicate at +31 days
  confirmed this media would qualify for cleanup, including the retention
  record and live-reference checks. PIL verified that its stored PNG remained
  valid. No cleanup clock or global cleanup command was applied to the local
  development database.
- Ran the five existing `HistoryRestorePathConsistencyTests` using isolated
  SQLite test settings: 5 passed in 49.23 seconds. These execute cleanup past
  retention and cover referenced/other-project preservation, legacy batch
  revert, import undo, legacy snapshots and crop/project restore agreement.
- Inspected desktop, phone and landscape confirmation screenshots; actions
  remained readable and reachable. Image-reference setup and assertions were
  API/database driven; the crop detail screen does not display this upload.
  No application code or mobile behavior changed.

Scratch script, screenshots and results: `/tmp/ofp-1196/` (local only).
Removed only #1196 from queue #1058 after passing, as explicitly requested;
preserved its adjoining epic banner and checked no acceptance boxes.
No defect reproduced and no production testing was performed.
