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
## Targeted follow-up — 2026-11-20: import reload recovery (#1093)

Tested local main `b8b45bb615f5bb715029a17b22fdb676e04cd85f`, which includes
PR #1299 (`76fdede3e`), using the production frontend bundle, headed Chrome,
and a disposable SQLite backend on `127.0.0.1:8275` with preview on port 4275.
Existing development servers on ports 8000 and 5173 were left running.
This focused owner-requested check does not advance the full-sweep baseline.

Ran `npm run test:e2e:headed -- e2e/crop-import-batches.spec.ts -g
'refresh failure after saved import|unknown first apply'` from `frontend/`,
with temporary settings isolating the database, cache, channels and email.

- Reload failure: passed at 1440x900 and 1024x900 (English), 768x900
  (German), 375x800 (French), and 800x375 landscape (Spanish).
- Confirmed the injected crop-list 503 reaches the focused reload warning,
  preserves the two-created summary and saved rows 2–3, and offers Close
  without replay. Closing and reloading reveals the saved crop.
- Unknown first apply: passed at 375x800 (English); focused error, unknown
  outcome detail, Close only, no saved summary and exactly one apply request.
- Inspected all six dialog screenshots; warning, saved-row text and Close
  remain readable and reachable. No application code or mobile behavior changed.
- Initial run: five passed; the 1440px browser closed before login
  (`page.goto: Target page, context or browser has been closed`). The targeted
  1440px rerun passed (12.0 seconds). This was not an import assertion failure.
- First-run screenshots and failure trace were preserved locally under
  `/tmp/ofp-import-recovery-nwPWHz/first-run-results/`; the successful desktop
  rerun screenshot is under `frontend/test-results/`.

No import recovery defect reproduced. No production testing was performed.

## Targeted follow-up — 2026-11-20: crop reference restore (#1195)

Tested local main `b8b45bb615f5bb715029a17b22fdb676e04cd85f`, including
PR #1295 (`9248651d9`), against the existing localhost servers at ports 5173
and 8000 with local PostgreSQL. This owner-requested acceptance check does
not advance the full-sweep baseline above.

- Previewed the exact database target and applied the documented guarded
  `seed_import_history_acceptance` fixture under an existing synthetic QA
  account. Used private project 3383 and crop 20659. Existing projects and
  owner fixture edits were preserved.
- Prepared two saved states through normal API endpoints with different
  species, actual uploaded PNGs and synthetic suppliers. Restored through
  the rendered crop **More actions → Versions** menu in German Chrome.
- At 1440x900 and 375x800, successful restore returned HTTP 200 and brought
  the original species, image and supplier IDs back together, plus the
  original notes.
- After changing the crop again and deleting the original synthetic supplier,
  restoring the original version returned HTTP 409 with
  `crop_restore_reference_unavailable` / `supplier_id`. The dialog displayed
  the localized supplier-specific error. Deep comparisons confirmed that the
  complete crop API response and crop history were unchanged.
- Repeated rejected restore at 800x375 phone landscape: same result and
  preservation assertions. Inspected the desktop, phone portrait and
  landscape dialog screenshots; the error and Close control remained visible.
- No application code or responsive behavior changed. Setup saves were API
  driven; the edit/upload form itself was not exercised. Synthetic fixtures
  remain locally for inspection, with the original test supplier intentionally
  deleted for the negative scenario.

Scripts, screenshots and detailed evidence: `/tmp/ofp-1195/` (local only).
No defect reproduced in the requested restore behavior. No production test.

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

## Targeted localhost acceptance — 2026-11-20: automatic restore backups (#1194)

Tested main `1856b7dc237b2d7740b519008b5072ca32c1126d`, including the
backup fix in PR #1350 and subsequent restore-impact preview in PR #1355.
Used the existing development frontend at `http://localhost:5173`, backend
on port 8000 and loopback PostgreSQL. This owner-requested acceptance check
does not advance the full-sweep baseline.

A scratch Playwright scenario created disposable E2E projects through the
guarded fixture endpoint and domain records through the normal API. At
375x800, 800x375 landscape and 1440x900, it:

- Created a location, field and bed, a crop with supplier offer and seed
  package, a companion relationship, a season, a task template and a
  planting plan with generated/manual tasks.
- Saved the completed version, deleted the plan and companion, removed the
  offer/package, deleted the supplier and finally deleted the location.
- Restored the saved version through project history, then selected the
  clearly labeled **Automatische Sicherung** and confirmed using Enter.
  Both restores returned HTTP 200. Location, field and bed disappeared again.
- Compared all registered restorable domain models with their captured
  states after both restores, using the invariant harness normalization
  (active records, millisecond timestamps, excluding refreshed timestamps
  and derived normalized names). Both complete domain comparisons matched.
- Created two subsequent crop edits and restored the earlier new version
  through the UI; its complete domain state also matched.

All three browser cases passed. Inspected history-list and confirmation
screenshots at all three sizes: the backup label and actions remain readable
and reachable, including phone landscape. Application code and mobile behavior
were unchanged. The scratch test explicitly waits for the newly introduced
impact preview before keyboard confirmation. Initial scratch-run failures
were setup/selector/timing problems, corrected before the passing run.

Focused backend verification: five tests and 40 subtests passed in
`test_history_invariants.py`, covering every-version/backup round trips,
import-undo and legacy-season-revert backups, untracked-row refusal and atomic
failure. Those tests used isolated test SQLite; the browser scenarios exercised
the existing local PostgreSQL database, without a new concurrency test.
Synthetic fixture cleanup ran after each successful browser case. Local scripts,
screenshots and results are under `/tmp/ofp-1194/` (temporary artifacts).

Removed only #1194 from work queue #1058 after passing, as explicitly requested
by the owner. No personal-acceptance checkbox was checked.

## Targeted localhost structure and supplier history acceptance — 2026-11-21

Verified #1204 / merged PR #1372 (`58f4f8e3e9491886f78867174c39e1d91df629d2`)
on checkout `2d7f4d1eb` (a concurrent documentation-only merge advanced it to
`f12a00f5f` during the run). This requested acceptance test does not advance the
full-sweep baseline or resolve its backlog above.

- Used the existing localhost servers at ports 5173/8000 and loopback
  PostgreSQL `farmplanner_db`. Previewed the exact target before applying
  `seed_structure_supplier_history_acceptance` for the local owner's account.
  Only its synthetic **Structure and supplier history acceptance** project was
  edited. No server restart, migration or application change was needed.
- Through the Growing Areas context menu and duplication dialog, copied
  **North field** as **South field**, replacing `North` with `South` in both
  bed names. Made a later bed-note edit, restored the checkpoint before the
  copy through the actual project-history confirmation, then restored the
  completed duplication version. The pre-copy state contains one field and
  two beds; the duplication version contains two fields and four beds.
- Verified the restored copy's 24 × 10 m, `shade` and `greenhouse`, South 1's
  12 × 1.5 m, South 2's 8 m² and `available` irrigation, and inherited shade
  on both beds. The later note is absent after restore. Bed after-images do
  not appear as independently selectable completed versions.
- Through Suppliers, deleted **Seed nursery** using the unlink confirmation
  and clicked the snackbar's Undo action. After another crop-note edit,
  restored the completed supplier-undo version through Project History.
  Lettuce retains its direct supplier, `selected_seed_demand_supplier`, one
  **Lettuce seeds** offer, `conventional` seed status, `approved` exemption
  and price `4.25`. Repeated the edit/full-restore check at 375 × 800.
- Opened the actual offer editor and confirmed **Konventionell** and
  **Genehmigung vorhanden**. The crop detail shows the offer and **Preis: 4,25**.
  API assertions also verify the selected seed-demand supplier; this fixture
  has no season or planting plan, so it does not create a calculated demand row.
- Inspected restored Growing Areas and crop screens at 1440 × 900,
  375 × 800 and 800 × 375. Portrait content and offer actions remain reachable.
  The known Cultures topbar overlap at 800 × 375 remains tracked by
  [#930](https://github.com/OpenFarmPlanner/planner/issues/930); no duplicate
  issue or queue edit. No mobile behavior or application code changed.

Result: **PASS** for the requested duplication and supplier Undo/full-version
restore paths. Duplication and supplier deletion/Undo were exercised on desktop;
mobile verification covered full restore and the resulting screens. This does
not certify concurrency, selective undo or the rest of the app.

Local scripts, API receipts and screenshots are retained in `/tmp/ofp-1204/`;
session credentials are local only and are not committed. The synthetic project
remains available for the owner's manual inspection.

## Project version restoration — 2026-11-24

Tested release `v1.209.5` at `a2760428a9967980a3d0c2f6a19080501ef7e181`
using synthetic projects, a disposable PostgreSQL 18 cluster and in-memory
SQLite. The scope was project and crop version history. The full-sweep
backlog above remains open.

| Check | Evidence |
| --- | --- |
| Every historical step and its automatic backup | Extended the existing round-trip scenario locally with a final marker so all 41 earlier writes were selectable. Confirmed that each revision ID appeared in the project timeline. On PostgreSQL, fetched a fresh preview and submitted its token for each of the 41 restores and 41 backup restores. All 82 results matched the corresponding captured project state across all 20 registered data types using the repository's field and timestamp normalization. |
| Deleted, edited and initially absent harvest data | Used the German project-history dialog to switch between versions of a harvest, its allocation and a crop loss. After each restore, reloaded the page and fetched the data again. Checked record and plan IDs, quantities, notes, loss extent and the set of active crop IDs against the values captured at each step. The automatic backup returned to the state after deletion. |
| Imports and linked data | Chrome exercised selective import undo, preservation of later independent work, refusal on a later conflicting edit, full restore before spreadsheet and library imports, and recovery of a deleted location with its field and bed. The bulk-delete recovery, per-crop reference restore and separate public-library version restore were also exercised through their dialogs. |
| Guarded failures | Incomplete history, missing stored media and stale previews were covered by the API tests. In Chrome, confirming a stale preview preserved a newer crop and required a refresh. An individual crop restore with a missing supplier preserved the current values and identified the missing reference. |

The SQLite history/restore selection passed 127 tests and 88 subtests. The
PostgreSQL crop-history and history-invariant suites passed 100 tests and
88 subtests. These selections overlap. Five frontend unit-test files passed
149 tests. The application bundle was built from the reviewed commit using
the installed frontend dependencies. The browser runs used German Chrome
and dedicated local servers. All 11 selected repository browser cases passed.
The additional harvest/loss probe passed at 1440×900, 375×800 and 800×375.
Its initial fixture needed a season for the planting plan. After that was
corrected, the interrupted landscape run was repeated on a fresh project.

The project timeline shows the last 30 days. Accounts, project memberships
and the shared library have a separate lifecycle. A version that requires
missing file content or lacks sufficient historical evidence can be refused.
The run used synthetic histories and did not inspect any existing user
project. Local probes, screenshots and run logs are in
`/tmp/ofp-version-qa-dfFN6nQp/` on the test machine.
