# P0 implementation progress

## Scope and workflow

Requested 2026-11-11: implement every currently open P0 sequentially using
the current model (as subsequently requested); #1030 must merge first. Issue bodies and comments were fetched
from GitHub, including related #1020, #851, #838 and #1009. There are ten
open P0 issues in the initial inventory. No issue comments add dependencies.

Each issue starts from fetched `origin/main` on its own branch. Implement its
acceptance criteria, update tests/docs, run `make quality` and relevant
integration tests, commit/push, open a linked PR, wait for CI and reviews,
merge without bypasses, and verify the merge before starting another issue.
Repair fixable blockers and continue autonomously. Respect required external
checks/reviews; do not implement multiple issues simultaneously.

## Dependency-aware order

| Order | Issue | Reason / overlaps | Status |
| --- | --- | --- | --- |
| 1 | #1030 Remove screenshot pixel-diff CI gate | Mandatory first; retain functional/layout tests and failure artifacts. | PR [#1034](https://github.com/OpenFarmPlanner/planner/pull/1034) merged and verified at `4b57c0e8` |
| 2 | #1028 Germination enums and stratification | Shared project/library schema, migrations and exchange fields must settle before templates. | PR [#1035](https://github.com/OpenFarmPlanner/planner/pull/1035) merged and verified at `b96f46b7` |
| 3 | #1032 Typed crop-specific variety properties | Registry/model/API/library/spreadsheet foundation; templates must include its dynamic columns. | PR [#1036](https://github.com/OpenFarmPlanner/planner/pull/1036) merged and verified at `8317a536` |
| 4 | #1031 Localized companion notes | Establish locale-preserving data/API and reversible spreadsheet grammar before the dedicated editor. Partially supersedes closed #1020. | PR #1039; CI/reviews in progress |
| 4a | #1037 Return 409 on variety/general-crop rename conflict | User explicitly inserted this after #1031 merges (2026-11-12). | Pending; before #1008 |
| 5 | #1008 Life-cycle selectors | Preserve legacy biennial data while settling selectable values before template examples. #1009 is P2 and explicitly excluded. | Pending |
| 6 | #1017 Complete spreadsheet templates | Finalize examples and canonical labels against the preceding schemas; preceding issues update their own necessary template fields, this issue audits every column. | Pending |
| 7 | #1007 Resolved crop display names | Establish shared label behavior before companion editor refactoring. | Pending |
| 8 | #1029 Dedicated companion editor | Build on #1031 locale handling and #1007 labels; preserve reciprocal species-level ownership. | Pending |
| 9 | #1014 Remove crop-context plot empty state | Independent detail cleanup after editor changes. | Pending |
| 10 | #1021 Localize demo content | Align samples with settled fields; keep demo localization separate from cross-browser fixtures. | Pending |
| 11 | Final integration PR | Comprehensive field/order/UX/i18n and end-to-end review after all ten merge; consistency fixes only. | Pending |

## #1030 coverage audit

- Chrome `responsive-layouts.spec.ts`: eight routes at 375x800, 768x900,
  1024x900 and 1440x900 originally compared screenshots with no explicit
  overflow assertions. Replace comparisons with route-wide overflow and
  heading assertions; retain captured images as visual-review artifacts.
- `fields-beds-mobile-landscape.spec.ts`: already asserts mobile list vs grid
  at 375x800, 800x375, 768x900 and 1440x900. Remove only pixel comparisons.
- Cross-browser `app-shell.spec.ts`: navigation actually clicks links;
  project/season menus, dialog/content overflow and action viewport bounds
  are already checked on desktop/mobile Chromium, Firefox and WebKit.
  Add trial clicks to existing dialog action checks to catch occlusion.
- Cross-browser `crop-form.spec.ts`: field widths, dialog overflow, decimals,
  heading/icon and legend alignment, save/cancel bounds and cancel behavior
  already covered for species and varieties. Remove screenshot-only cases.
- Cross-browser crop-library, planting-plans and Gantt specs: existing
  selection/edit/cancel flows, overflow, mobile cards vs desktop grid, sticky
  headers, bars inside timeline and date positioning remain intact.
- Chrome crop-form-responsive, crop-detail-badge-row, crop-detail-empty-fields,
  fields-beds-bed-dialogs, scrollbar-layout, gantt-layout and task-dashboard
  specs cover focused wrapping, overflow, dialogs, sticky controls and
  responsive behavior. Do not duplicate those checks or add generic brittle
  position assertions. The suite is not a general visual overlap detector;
  screenshots still support human visual review of rendered UI changes.
- Remove obsolete PNG baselines, acceptance workflow, collection/application
  script/tests and automatic re-recording steps. Both Playwright configs
  explicitly retain failure screenshots and traces, uploaded by existing CI.

## Resume / cloud handoff

This file is the durable handoff; update it in each issue PR. Cloud work must
fetch the repository, read AGENTS.md/CLAUDE.md and this file, inspect the active
PR's latest head/checks/reviews, and finish/verify its merge before creating
any next issue branch from refreshed `origin/main`. Do not assume a pushed
branch has merged. GitHub write/merge access and supported test tooling are
required; respect current branch protection and required reviews.

Current resume point: user resumed the campaign on 2026-11-12 after #1036
was merged and verified at `8317a536` (#1032 closed). Implement #1031 on
`feat/1031-localized-companion-notes`, then finish CI/reviews, merge normally
and verify. User steering during #1031: insert #1037 immediately after that
merge, before #1008; then return to the dependency-aware order above. Do not
start the next issue before the preceding merge is verified. The earlier
stop-after-#1032 instruction was fulfilled and is now superseded by resume.

Final review must cover crop table/graphical list, create/edit/details,
public library species/varieties, publish/import, XLSX/ODS/CSV, all four
languages, desktop/mobile/landscape, empty-value handling, complete logical
field order, species changes and schema compatibility. Run the ten scenarios
in the original request (potato create/edit/publish/import/spreadsheet
round-trip, multilingual companions, germination/stratification, ordinary
species, responsive presentation) and record evidence and limitations here.

## Earlier pause (resumed)

User explicitly requested pause on 2026-11-11. Work is uncommitted on
`ci/1030-remove-pixel-diff`, based on fetched `origin/main`; no PR, push or
merge has occurred. No other issue implementation has begun. Running checks
were stopped at the pause request.

Validation so far: production frontend build passed; targeted ESLint passed;
Playwright discovery found 8 targeted Chrome cases and 96 cross-browser
functional/layout cases. Four fields/beds breakpoint tests and the mobile
responsive route test passed before pause. Remaining route tests, separate
TypeScript run, cross-browser execution and `make quality` require completion.
The first quality attempt had a stale Radon shebang and excessive test workers;
PDM lockfile reinstall repaired the environment, and the bounded rerun
(`PYTEST_ADDOPTS='-n 2' make quality`) passed Radon before pause. Read logs
under `/tmp/p0-1030-*.log` locally; these are not portable to cloud.

Before committing: finish the targeted tests, inspect the diff, and update
these results. The existing Claude review workflow remains untouched so its
self-change restriction does not skip review of this PR. Its historical
baseline-only review optimization is inert after PNG removal. Do not use
screenshot acceptance or bypass checks. Resume only on user instruction.

## Resumed and preparing cloud handoff

User resumed on 2026-11-11, then asked to hand the remaining sequence to
cloud as soon as possible. Finish local #1030 validation, commit and push its
branch and this plan, open a PR, and hand over before starting #1028 locally.
Cloud must first inspect and finish #1030 CI/review/merge, verify the merge,
then implement the remaining issues in the recorded order. Repository access
alone does not establish merge capability: verify available GitHub merge
functions or authenticated `gh` plus applicable repository permissions first.

### Current validation evidence

- Production frontend build including TypeScript/prerender: passed.
- Targeted ESLint and separate TypeScript build: passed.
- Changed workflow YAML parse and shell syntax checks: passed.
- Chrome integration: **8 passed (2.7m)**, covering eight routes at
  375x800/768x900/1024x900/1440x900 plus fields/beds at 800x375 landscape.
  Application rendering/mobile behavior was not changed.
- Cross-browser discovery: 96 remaining functional/layout cases. Execution
  attempted for desktop Chromium and mobile WebKit app-shell/crop-form;
  Docker image download has been retrying and has not reached test execution.
- `PYTEST_ADDOPTS='-n 2' make quality`: still running; backend suite has
  passed 97% with no failures reported so far, Radon passed, Ruff exited 1
  (the quality script explicitly accepts existing lint findings). Do not
  describe this unfinished run as a pass. GitHub CI remains authoritative.

Cloud handoff instruction: verify GitHub merge/read/write access first;
finish #1030 validation and required CI/reviews, merge and verify it, then
continue #1028 and the remaining issues sequentially. Do not create or
implement the next issue while this PR remains unmerged. The complete final
integration/UX review is still pending; none of the other P0s is complete.

## Cloud handoff ready

PR: https://github.com/OpenFarmPlanner/planner/pull/1034
Branch: `ci/1030-remove-pixel-diff` (pushed; base `main`).
Implementation commit: `d2de2a69e7fb17b1e53afdff43f68af553bf1446`.
No issue or PR has merged in this campaign yet.

At the user's request to hand work to cloud promptly, local long-running
checks were stopped for handoff: the full backend quality run remained past
97% with no reported failures but **did not complete**; cross-browser tests
**did not execute** because the image download repeatedly retried. These are
unfinished checks, not passes. CI must complete the required checks, and the
cloud should rerun appropriate checks where necessary. Production build,
targeted lint/typecheck/syntax checks and all eight targeted Chrome tests did
complete successfully. No application UI changed; mobile/desktop variants
are preserved. The comprehensive final UX review remains pending.

### First cloud actions

1. Read AGENTS.md, CLAUDE.md and this file; select Codex High as requested.
2. Verify connected tools or authenticated GitHub CLI can read issues/checks,
   push branches, create PRs and merge on this repository. Environment access
   does not itself prove those permissions; report a concrete blocker if any
   needed capability is unavailable. Never expose credentials in output.
3. Fetch and check out `ci/1030-remove-pixel-diff`; inspect PR #1034's current
   head, reviews and checks, including any automatic reviewer fixes. Fix
   failures on this branch. Do not bypass CI/protection/review requirements.
4. Merge #1034 only once required checks/reviews pass; verify its merged SHA
   is on refreshed `origin/main` and issue #1030 is closed.
5. Start #1028 from that refreshed default branch on a dedicated branch.
   Continue the recorded issue order, one complete PR cycle at a time.
6. After all ten merge, create and test the separate final integration PR,
   complete every consistency/scenario review above, and report limitations.

## Cloud continuation, 2026-11-11

The user requested autonomous continuation through all P0 merges, retaining
the current model. Superseded WIP #1033 was closed at the user's request;
it is a parallel implementation of #1030, not a dependency of #1034.
GitHub reports admin/push permissions, a normal merge tool is available,
and authenticated HTTPS push dry-run succeeded. SSH is unusable in this
executor, so HTTPS is the verified fallback. Classic branch protection
cannot be read by this integration (403); required checks can be queried.

At head `aec6c70772f2c4f38ba52e54aeb7e7f87b94140b`, all three Chrome E2E
shards, six cross-browser jobs, frontend shards, build, PostgreSQL tests,
quality, CodeQL and dependency checks passed. Local `make quality` completed:
2508 backend tests passed, 96% coverage; separate TypeScript and syntax
checks passed. Backend CI and both Claude reviews failed before execution
while apt could not resolve Ubuntu mirrors. A backend retry reproduced the
failure. Failed jobs were started on fresh runners after a later user
request to continue. No gate has been bypassed and no later P0 started.

The current CI repair introduces a bounded gettext installer preserving
configured proxy variables through sudo, with regression tests. Backend
CI exercises it first; the Claude workflow remains unchanged for now so
its self-change guard does not suppress review of this PR. Proxy loss is
a hypothesis to test, not an established cause. Finish CI/reviews, merge
and verify #1034 before beginning #1028, then continue the order above.

The first installer run confirmed no proxy is configured on these runners;
proxy preservation alone did not restore DNS. The installer therefore adds
a temporary, signed Ubuntu archive fallback through the kernel.org mirror.
The mirror publishes the runner's resolute archive; actual runner access
must still be verified in CI. No archive signature or test gate is disabled.

The shared installer is now also called by the Claude toolchain setup.
Changing `claude-pr.yml` activates its existing self-change protection;
that guard is unchanged. Request independent native Codex code and security
reviews on the final head and inspect completed results before merging.
Do not treat a delivered review request or the self-skipped Claude jobs as
a completed clean review. All required CI checks still have to pass.

The fallback successfully passed gettext installation on GitHub runners
at `2d7bc529` and `d39b0e0a`; backend tests then started. The fallback
includes base, updates and security suites to preserve security updates.
The native bot rejected both review requests with an account-connection
message. The user has been asked asynchronously to connect GitHub in Codex;
continue independent CI work while that external prerequisite is resolved.

## #1030 completion and review clarification

All required checks passed on head `060ff6f9704dcb1d50deb475bf15922e612c738d`.
The signed archive fallback worked in backend CI and Claude toolchain setup.
Changing the Claude workflow intentionally triggered its existing self-change
guard. Native Codex requests were declined because the account was not
connected; no native or independent review was claimed. The repository's
manual code/security review route was completed and documented against the
exact head. GitHub reported CLEAN with no outstanding required review; normal
squash merge used the expected SHA with no bypass. The earlier request for
account connection is optional, not a campaign prerequisite. Subsequent PRs
leave the Claude workflow unchanged, allowing its ordinary review jobs.

## #1028 implementation

Two independent enums distinguish unknown/inherited values from explicit
none. Four nullable stratification endpoints support partial ranges, whole
nonnegative days and negative decimal Celsius. Shared forms/details use the
same logical order, with conditional stratification fields and propagation
duration in the germination group. All four locales are updated.

Legacy list/API and spreadsheet flags remain compatible, conflicts remain
portable rather than guessed, and linked varieties preserve historical
whole-list overrides. New axes inherit independently. Migration 0139 uses
batched historical models; old immutable revisions are upgraded on restore.
Library sync/publishing closes indirect pin bypasses through the legacy list.

Validation in progress: targeted backend/migration/API query-count tests,
frontend unit/i18n/type checks, Chrome end-to-end flows at all five viewports
and French/Spanish mobile, plus the full quality and responsive suites.
Record final results and the PR link here before committing.

### #1028 PR validation updates

PR #1035 opened at head `e035e45c`. The final focused backend run passed
18 tests and 14 subtests; the new pin regression passed separately. The
CSV/XLSX/ODS and localized-choice suite passed 76 tests after adding all six
new fields to the existing every-column fixture. CI caught that omitted
fixture and old detail-view expectations; propagation duration now retains
its day unit in its new group, and tests expect that group consistently.

All 14 responsive route/crop-form cases passed initially, but inspection
exposed loading-frame screenshots. The route suite now waits for visible
content and no loading indicator before captures; its corrected rerun is
pending. The eight germination E2E cases passed; all five germination form
viewports plus French/Spanish mobile screenshots were inspected. The French
minimum-temperature label was shortened after inspection.

Claude code and security executions stopped immediately; security fallback
identified exhausted Claude allowance. The workflow requested native Codex
security review, but its bot again required an account connection. Neither
is a completed review. Use the repository's documented manual review route
with exact SHA/scope/results, and leave all actual required GitHub checks in
force. Account connection remains optional unless a current branch rule
explicitly requires that external reviewer.

### #1028 completed local validation / CI recovery

Local `make quality` completed successfully: 2,519 backend tests passed with
96% coverage; Ruff/Madge kept their existing allowed report codes, Radon
and ESLint passed. A later focused run passed 18 tests and 14 subtests,
including the extra conflict-inheritance regression; the pin regression
passed separately. TypeScript and the Vite production bundle passed.
Frontend/i18n targeted runs passed 133 tests; CSV/XLSX/ODS and localized
choice tests passed 76 tests; both corrected detail assertions passed.
All three full frontend CI shards passed on `009b083b`.

Eight germination browser scenarios passed at 375/768/1024/1440 px and
800x375 landscape, with French/Spanish mobile and library/plan behavior.
All 14 responsive route/crop-form cases initially passed; visual inspection
then revealed loading-frame captures. The strengthened route suite passed
all four sizes; the tablet retry used a 120-second local CLI deadline for
eight navigations after the initial run exceeded its 60-second total. The
repository's CI deadline was unchanged. All 32 loaded route screenshots and
the germination form/library/plan screenshots were inspected. The shortened
French minimum-temperature label passed recapture and inspection.

The initial broad local detail/library test run had stale group expectations
and discussion timing failures under load. Expectations and the propagation
unit regression were fixed; the current full frontend CI shards and focused
assertions passed. A redundant stale local rerun was stopped after that CI
verification; no claim is made that the stopped run passed.

Manual code/security review of `009b083b` is documented in PR #1035 comment
6806322797, transparently as the authoring Codex session's manual review.
No native or independent completed review is claimed. Claude allowance was
exhausted, and the native fallback requested account connection. The actual
GitHub required review state has no outstanding review request.

Required backend/E2E check statuses became inconsistent with their completed
job steps: backend's final step finished at 20:19:55 UTC and E2E shard 1 at
20:22:04 UTC, but required status reads remained pending. GitHub rejected
reruns as already running and cancellations as already finished, including
direct REST requests. This documentation commit creates a fresh head for a
normal CI retry. Do not merge until the new head's required checks succeed;
do not override or manually mark a required check green.

### Final integration observations to revisit

The shared header, unchanged in #1035, has overlapping actions/title on the
crop page at 768px and an add-plot control overlapping the representation
toggle on the fields page at 1024px. Inspect its responsive action-collapse
and flex sizing during the separately authorized final UX integration PR,
including trial clicks for every visible action. On empty/no-season planting
plans at 1024/1440px, the sticky empty table header appears below the alert
and overlaps the empty-row message. Confirm intended behavior and QA
exclusions before fixing. These observations mean the complete existing app
is not claimed visually clean just because germination/overflow tests pass.

## #1035 merge verification and current resume point

Resumed 2026-11-12. The documentation-only head's workflows were still queued
without jobs after the overnight wait. Closing/reopening the unchanged PR
retriggered normal workflows successfully. All current checks passed, with
no outstanding required review. Normal squash auto-merge completed at
06:19:34 UTC as `b96f46b72eed2267901c8c7bc9be8881318526bb`; fetched main,
verified ancestry and issue #1028 closure. No check or review was bypassed.

Current resume point: #1032 implementation on a fresh branch from verified
main. Finish its validation, CI/reviews, merge and verification before #1031.

## #1032 implementation and validation in progress

The shared versioned registry defines typed, localized cooking/maturity fields.
Species profiles are curated database metadata; model JSON values are local to
each crop/library record, without implicit variety inheritance. API and both
import pipelines validate applicability. Spreadsheet columns are localized and
filtered by exported profiles; blanks merge without erasing existing values.
The form retains incompatible values across species changes until explicit
clearing, and supports official species without public entries. Pins and old
revision restoration include the dictionary.

Initial targeted checks passed: backend 49 tests + 7 subtests including list
query budgets, library/history 13 tests + 7 subtests, frontend/i18n/exchange
155 tests, and form regressions 96 tests. TypeScript/build, full make quality,
actual browser scenarios and final ownership/security review remain in progress.
No PR has been opened yet.

### #1032 local verification and migration correction (2026-11-12)

- Core/backend query-budget run: 49 passed and 7 subtests; existing list
  query budgets remain unchanged. Library/history regressions: 13 passed and
  7 subtests. Final typed-property/write-path run after adding library-link
  validation: 13 passed.
- Targeted frontend runs: 155 core/spreadsheet/i18n tests, 96 form/adapter
  regressions, then 71 updated suggestion/import tests and 18 property tests
  passed. The latter exercise all enum options through CSV/XLSX/ODS in all
  four locales. TypeScript and ESLint passed; production bundle built.
- `make quality` completed and generated reports. Its initial full backend
  run had 2515 passes, 13 failures and 6 errors: the new profile migration
  lacked a dependency on farm.0139, leaving its column behind during the
  historical germination rollback; subsequent tests then inherited an
  incomplete schema. Added that dependency. Both migration classes and the
  new profile migration now pass together (5 tests). Full backend CI must
  confirm the complete suite before merge; the script's accepted pytest
  exit code alone is not evidence of success.
- Fresh-database browser testing also exposed blank botanical metadata on the
  existing canonical potato. The migration now assigns its profile without
  creating species or changing names. Historical botanical candidates and
  the canonical blank-metadata record both have regression coverage.
- Browser create/save/reopen passed at 375x800, 768x900, 1024x900, 1440x900
  and 800x375 without a variety or public-library entry. Explicit species
  switching/clear passed. French and Spanish mobile controls and warning
  actions passed; screenshots were inspected at all five sizes and in both
  longer locales. Shared shell findings already listed above remain for the
  final integration PR. Library publication/edit/import and main-route
  responsive checks are being completed before merge.
- Actual Vite dev-server checks: shared registry JSON returns 200; unrelated
  backend manage.py returns 403. The allowlist exposes only the exact registry.
- User steering: stop after merging and verifying #1032. Do not begin #1031.

- Follow-up library browser case passed (23.5 seconds): create first variety,
  publish, edit public properties, preserve the private copy, then import the
  edited values into another project in a separate browser context. Required
  planning durations are supplied independently of maturity group. The test
  session correction changes no product behavior.
- Final local schema check reports no changes detected. Full `make quality`
  completed: ESLint 0, Madge 1 (accepted existing circular report), Ruff 1
  (repository report), with the backend failure/correction detailed above.
  Complete-suite CI and automated review remain mandatory before merge.


## #1031 localized companion notes — implementation and validation

Resumed after the verified #1036 merge. The implementation adds four-language
companion note maps, explicit editing/import/export language selection, strict
missing-language display, and reversible grouped CSV/XLSX/ODS cells. Migration
0141 preserves private legacy prose in German and public prose in its declared
original language; old history snapshots remain restorable. Update/import and
publication paths merge language patches without replacing other versions.
Legacy dash/colon parsing requires exact known-name resolution and warns when
ambiguous. Existing relations and structured reasons survive additive import.

Validation so far: TypeScript and Vite builds pass; all 20 public pages were
prerendered using the installed Chrome binary through a temporary local runner.
Focused frontend runs pass (148 core tests and 121 UI/locale tests). Focused
backend regression runs cover library/history flows and query budgets; the
latest localized/migration run passed 18 tests. A final API-map regression is
being checked after review. Browser editing passed at 375, 768, 1024, 1440 px
and 800x375, with French/Spanish phone forms and library missing-language
behavior; the explicit French CSV import/export flow passes. Responsive route
captures, final dialog captures, full make quality, CI and exact-head reviews
remain pending. Shared shell findings remain assigned to final integration.

User steering: immediately after #1031 merges and is verified, implement #1037
(rename conflicts return 409 with atomic rollback), then continue with #1008
and the remaining ordered campaign. #1037 is an issue awaiting its own PR.

Final local validation before CI follow-up: `make quality` completed with
2,550 backend tests passing, ESLint zero errors, and the repository's reported
Ruff/Madge findings (accepted report exits, not a clean-lint claim). The last
API-map regression exposed and now verifies a merge-helper correction: keep
the explicit locale marker until its text patch has been merged. That focused
regression passes. The API-client test now verifies the new French parameter
and all 66 tests in its file pass. All four responsive runs passed; all 32
route captures were visually inspected, alongside note forms and import/export
dialogs at 375/768/1024/1440 and phone landscape as applicable. Spanish capture
now waits for the loaded notes. The final four browser cases pass, including
CSV import/export at 375, 800x375 and 1440. Existing shell overlaps remain
recorded for final integration; shared shell layout is unchanged here.

PR #1039 is open. Initial CI identified the API-client expectation above; the
follow-up head must pass fresh CI. Automated Claude code review failed without
a completed review result; this is not an approval. Exact-head manual review
and GitHub-required checks/reviews remain mandatory before normal merge.

CI on `449fc6bf` passed 2,555 backend tests, all frontend shards, quality,
CodeQL and all six cross-browser configurations. Two production E2E shards
passed; the third exposed shared-fixture interference: an earlier test had
already published the first species, so the new general-entry publication
correctly returned 409. The browser fixture now selects an official species
without an existing public general entry. Its focused rerun passes against
an already populated test database. This changes test setup only. Fresh CI
on the follow-up head is required before merge; #1037 has not been started.

All 10 required checks passed on `93876960`, including all production E2E
shards, but normal merge was rejected by branch policy. No override or
alternate merge API was used. Inspection found an unresolved CodeQL review
thread on `_import_notes_map`: it converted a nested exception to public
validation text. The wrapper now returns a fixed message while keeping the
localized machine code. Its invalid-note tests and the new regression for
nested-diagnostic suppression in preview/apply pass (three tests total).
This review conversation was missed in the earlier readiness check; all
review threads must now be checked explicitly, addressed, and resolved with
fix evidence before normal merge. Fresh CI and CodeQL on the fix head remain
required. #1037 still follows the verified #1031 merge.

Follow-up input review tightened the legacy marker to literal boolean `true`
for the name-length exception, matching the parser's existing activation
rule. A truthy non-boolean marker could otherwise bypass the 200-character
limit. The existing preview/apply no-partial-write regression now includes
that malformed payload and passes. This guard/test follow-up also requires
fresh exact-head CI before merge.
