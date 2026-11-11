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
| 2 | #1028 Germination enums and stratification | Shared project/library schema, migrations and exchange fields must settle before templates. | Implemented on `feat/1028-germination-requirements`; validation/review/merge in progress |
| 3 | #1032 Typed crop-specific variety properties | Registry/model/API/library/spreadsheet foundation; templates must include its dynamic columns. | Pending |
| 4 | #1031 Localized companion notes | Establish locale-preserving data/API and reversible spreadsheet grammar before the dedicated editor. Partially supersedes closed #1020. | Pending |
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

Current resume point: #1034 merged on 2026-11-11 at 16:12:35 UTC; fetched
main and verified commit `4b57c0e8f52ef4121b028a2a66f2d82b7e819bb8` and
issue #1030 closure. Duplicate WIP #1033 was closed at the user’s request.
Finish #1028 checks/reviews and merge verification before beginning #1032.

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
