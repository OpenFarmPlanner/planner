# Testing and CI Topology

How the automated suites are split across CI jobs, why they are split that
way, and what to check before adding to them. For what to test and which
gates to run locally, see the "Testing Rules" section of
[`CLAUDE.md`](../CLAUDE.md).

## The jobs

`.github/workflows/ci.yml` runs on every pull request and on pushes to
`main`:

| Job | What it runs | Test step | Whole job |
| --- | --- | --- | --- |
| `frontend-tests (1-3)` | `vitest run --shard=N/3` | 1m43s-2m36s | 1m58s-2m47s |
| `backend-tests` | `pytest` (xdist, with coverage) | 3m14s | 3m58s |
| `backend-postgres-tests` | `pytest -m postgres` against PostgreSQL 16 | — | — |
| `quality` | ruff, radon, ESLint, madge | 38s | 1m18s |

Frontend and `quality` from run 36112871261 (25 Sep 2026). `backend-tests`
from PR #703's first CI run (29 Sep 2026), which introduced the changes
described under "Backend" below; the same job took 10m12s / 10m52s on the
25 Sep run.

`.github/workflows/e2e.yml` runs the Playwright suite against a production
build on pull requests, split across three shards of its own. Failed tests
keep a Playwright trace (`trace: 'retain-on-failure'`); a failing shard
uploads it with its `playwright-report-shard-N` artifact. Open it with
`npx playwright show-trace <trace.zip>` to see every request, cookie and
response of the failed test before calling a failure flaky.

All jobs run concurrently, so the pipeline is as long as its slowest job.

**Distinguish the test step from the job.** The two time columns above
tell different stories, and only the first is about the tests. Four
consecutive runs, test step against whole job:

| run | `frontend-tests` | `backend-tests` | `quality` |
| --- | --- | --- | --- |
| PR, warm cache | 5m06s / 5m23s | 7m08s / 7m51s | 36s / 2m00s |
| main | 3m54s / **9m13s** | 7m12s / 7m48s | 36s / 5m51s |
| PR | 4m39s / **8m16s** | 4m41s / 5m48s | 36s / 6m11s |
| main | 5m00s / 7m03s | 7m29s / 8m04s | 36s / 6m07s |

`frontend-tests` is the longest *job* in half of these, while its *test
step* is the steadiest thing in the table. The gap is `npm ci` on a
node_modules cache miss — 5m03s and 3m22s in the two bad rows. A
`frontend-tests` job that looks like the pipeline's bottleneck is
therefore almost always an install problem, not a test problem: read the
step times before optimising the suite. What the pipeline actually waited
for was the backend test step: ~7 minutes in three runs out of four then,
10 minutes by late September 2026, until the changes under "Backend" below.

## Frontend: sharded, parallel within each shard

Since September 2026 this job is a three-shard matrix again (`ci.yml`, and
the entry in `refactoring-log.md`). The rest of this section records why it
was briefly merged back while `backend-tests` was the critical path, and
the measurements behind that; the sharding mechanics it describes still
apply.

What makes this suite fast is **`fileParallelism` in
`frontend/vite.config.ts`**. Vitest runs test files across a pool of
workers; this was previously switched off under CI
(`fileParallelism: !process.env.CI`), which put all ~240 files on a single
worker. Re-enabling it took a local run from 392s to 240s with an
identical 2405-test result.

It is deliberately **not** sharded across runners. It was, briefly, and
the measurement is the reason it is not any more: the two shards' test
steps were 2m10s and 2m41s, i.e. 4m51s of work split onto two runners —
but `backend-tests` in the same workflow runs 6-7.5 minutes, so the second
runner shortened a job that was never the critical path. Merged back the
job is ~5 minutes and still finishes first.

Sharding is close to free to reintroduce if that changes: add a
`strategy.matrix.shard` and a matching `--shard=N/<count>` (the two must
be kept in step), and verify with `npx vitest run --shard=N/<count>` that
the parts add up to the whole. Do that when the suite approaches the
backend job's runtime — currently about two minutes of headroom.

Re-measured on a 4-core box with `CI=1`, so the fork pool matches CI:

| | wall | tests |
| --- | --- | --- |
| unsharded | 276s | 2405 |
| `--shard=1/2` | 123s | 1186 (120 files) |
| `--shard=2/2` | **163s** | 1219 (120 files) |

The split is *not* additive: 123s + 163s is 286s against 276s, about 10s
of overhead, and the critical path drops 276s -> 163s (-41%). An earlier
note here claimed otherwise by comparing the wrong pair of numbers.

Sharding is still not worth doing, but for the other reason in this
section rather than that one: the backend test step is ~7 minutes, so
those 113 seconds come off a job that is not holding the pipeline up.
Revisit when the backend suite gets faster.

The uneven split is not chance — shard 2 draws both of the heavyweight
files below, 98s of its 163s. Any future 2-way shard is bounded by them.

### Where the frontend time actually goes

The suite is heavily concentrated. 240 files, 386s of summed file time,
276s of wall time:

| file | | share |
| --- | --- | --- |
| `PublicCropLibraryPage.test.tsx` | 66.0s | 17% |
| `CropFormLibraryAutocomplete.test.tsx` | 31.7s | 8% |
| `App.test.tsx` | 19.4s | 5% |
| `CropForm.test.tsx` | 17.5s | 5% |
| `FieldsBedsHierarchy.editCancel.test.tsx` | 16.0s | 4% |
| top 10 | 208s | 54% |
| top 20 | 269s | 70% |

They are the integration-style tests that render a real form or page
rather than anything accidentally slow — there are no real sleeps, no
skipped tests and no snapshot tests to reclaim.

`PublicCropLibraryPage.test.tsx` is the one file worth naming on its own:
2343 lines, 65 tests, 66s, and no single test in it above 7.4s. It is
long, not slow. Because a file never splits across workers it puts a hard
floor under every worker and every future shard — exactly the scheduling
problem the *Adding tests* section warns about. Splitting it along its
own `describe` seams (the list/edit tests against the discussion-thread
tests) is the one change that would make this suite genuinely faster
instead of redistributing it, and it deserves its own change and its own
before/after measurement.

Two things measured and rejected:

- **`pool: 'threads'` instead of the CI `'forks'`**: 262s against 276s,
  same 2405 passing tests. ~5%, inside run-to-run noise, in exchange for
  giving up process isolation. Left as `forks`.
- **Trimming tests elsewhere**: the 220 files outside the top 20 are 30%
  of the time between them. There is nothing there to win.

## Backend: one job, parallel workers

`backend/pytest.ini` runs the suite with `-n auto --dist loadscope`
(pytest-xdist). `settings_test` uses an in-memory SQLite database and
pytest-django gives each worker its own, so the workers do not share state.
Each worker runs its tests one after another; two tests never run on one
database at the same time.

Three settings make the suite fast, and all three have to stay in place.
Measured on a 4-core box (CI's `ubuntu-latest` also runs 4 workers), full
suite, 1741 passing tests every time:

| configuration | wall | summed test time |
| --- | --- | --- |
| before: `loadfile`, PBKDF2, C tracer | 508s | 1530s |
| + MD5 hasher in `settings_test` | 401s | 1010s |
| + `--dist loadscope` | 314s | — |
| + coverage `core = "sysmon"` | **198s-218s** | 671s |
| (`--dist worksteal` instead of `loadscope`) | 205s | — |

The same suite took 608s of pytest time (a 10m12s test step) on CI just
before these changes.

**Test password hasher.** Django's default PBKDF2 hasher runs 1,000,000
iterations per hash, and the suite hashes on every `create_user()`,
`set_password()` and password login. `settings_test` sets
`PASSWORD_HASHERS` to MD5, as Django's testing docs recommend. On its own
it took the five slowest API test files (`test_projects_api`,
`test_auth_api`, `test_public_crops_api`, `test_engagement_dashboard`,
`test_agent_api_tokens`) from 323s to 37s serially. Production keeps the
default hasher; `settings_test` is only used by pytest and by
`compilemessages`.

**`--dist loadscope`, not `loadfile`.** `loadfile` pinned every file to one
worker. `crops/tests/test_migrations_translations.py` holds six migration
test classes that together took 339s, so that one file set the length of
the whole run no matter how many workers there were. `loadscope` keeps each
class together (for plain test functions, each module) but lets the classes
of a file spread out. Keeping classes together matters for Django's
`setUpTestData` and for any class-level migration setup (see below).
`worksteal`, which splits classes up, measured no faster.

An earlier version of this section called `loadfile` *required*, arguing
that migration tests on one database would fight over the schema. They
cannot: each worker has its own database and runs its tests one after
another, and every migration test migrates forward to the leaf nodes again
in its teardown.

**Coverage on `sys.monitoring`.** `[tool.coverage.run] core = "sysmon"` in
`backend/pyproject.toml` replaces coverage's default C tracer. On Python
3.12 it measures line coverage only, which is all the suite collects (no
`--cov-branch`), and the per-file report came out identical: same
statements, same missing line numbers, 95% total. The migration tests,
which spend their time in Django's migration machinery, gain the most:
creating one worker's test database took 24.7s under the C tracer, 16.0s
under sysmon and 14.5s with no coverage at all. If sysmon ever becomes
unusable, for example because branch coverage is switched on before Python
3.14, coverage falls back to the default core with a warning instead of
failing.

Switching to `loadscope` changed which tests share a worker. A transaction
or migration test flushes its database, including the data migrations' crop
species and translations; later classes previously depended on which worker
received them. This caused missing-species failures in translation tests and
missing rotation statuses in the cross-browser dataset tests.

`backend/conftest.py` snapshots species and translations from each worker's
initially migrated test database, then restores that snapshot before a later
class only if a flush removed all species. It does not read a second seed file
or replace an existing catalogue. Tests that need an absent catalogue must
clear it explicitly in their own setup. Restoration is covered by rebuilding
the cross-browser dataset after deleting the taxonomy and checking its species
links and rotation statuses.

The plant-family list is also restored before a class when a flush removed it.
A transactional test that needs it between its own tests still calls
`ensure_seeded_plant_families()` itself (see
`test_migrations_crop_family_plant_family_reference.py`).

The backend job installs GNU gettext with `scripts/ci/install-gettext.sh`.
A working `msgfmt` avoids package-network access; otherwise the installer
preserves configured proxy variables across `sudo` without logging their
values, bounds each root apt process, and fails if installation fails.
If the default Ubuntu mirrors fail, it retries through the kernel.org
Ubuntu archive mirror (base, updates and security) using temporary per-command sources and the runner's
existing Ubuntu signing key. It never disables archive verification or
rewrites the runner's system sources. Other distributions do not use this
Ubuntu-specific fallback.
The installer regression tests run before installation. This does not skip
translation compilation or tests. Claude review jobs use the same installer
before installing their Python toolchain in `claude-pr.yml`.

The backend job compiles application translations before pytest. The shared
`pdm run compilemessages` command includes `--ignore=.venv` because PDM creates
its environment inside `backend/`; without that exclusion Django recursively
walks and recompiles dependency locale catalogs as well as the repository's
catalogs, creating very large CI logs and unnecessary work.

Pass `-n0` to run serially again — that is what `--pdb` and any debugging
that needs readable, non-interleaved output want.

### The migration tests are the expensive ones

`farm/tests/test_migrations_*.py`, `farm/tests/test_discussion_migration.py`
and `crops/tests/test_migrations_*.py` are 55 tests, 3% of the suite, and
557s of the 671s summed test time: 83%, now that the hasher no longer
hides them. Each test's `setup_method` migrates backwards from the leaf
nodes to `migrate_from` and forwards to `migrate_to`, and
`teardown_method` migrates forward to the leaf nodes again. A class with
seven test methods pays for seven full cycles. Most of that time is
Django re-rendering model states (`StateApps.render`), not SQL.

The largest classes, from the final run above:

| class | tests | summed |
| --- | --- | --- |
| `TestPublicCropTranslationBackfill` | 7 | 136s |
| `TestConsolidateSupplierTkgMigration` | 4 | 108s |
| `TestCropSpeciesTranslationBackfill` | 7 | 67s |
| `TestSupplierDataBackfillMigration` | 2 | 58s |
| `TestRelinkGeneralPublicCropsMigration` | 3 | 54s |

By November 2026 the suite had grown to 2507 tests and 85 migration test
methods in 28 files, and the CI test step to 10m12s (612s of pytest). The
growth compounds: every migration test migrates back from the *current*
leaf nodes, so each new migration makes every older migration test slower.

**One migration cycle per class** (`farm/tests/migration_base.py`).
`MigrationTestBase` migrates back to `migrate_from`, calls the class's
`seed_before_migration(cls, apps)`, migrates forward to `migrate_to` and
exposes `old_apps`/`new_apps`, once per class in a class-scoped fixture.
The classes are marked plain `django_db`, so each test's writes roll back
and the tests of a class still see the same seeded rows in any order. When
the class ends, the fixture migrates to the leaf nodes and flushes, which
is what each test's teardown did before. Every migration test class with
more than one test now uses it; a class with a single test gains nothing,
and the remaining ones keep their own `setup_method` until they are next
touched. New migration tests use the base.

- Tests that migrate *inside* the test body (`test_migration_is_reversible`
  and the `test_reverse_*` tests) cannot run inside the rolled-back
  transaction: SQLite's schema editor refuses to run in an atomic block
  while foreign-key checks are on. Each sits in a `...Reverse` class of its
  own, marked `django_db(transaction=True)`, that shares the seed through a
  `...Setup` base and calls `self.migrate_to_state(...)`.
- **A class leaves the database as it found it.** The flush at its end also
  removes the crop species and plant families the data migrations seed, and
  regular tests such as `test_e2e_views.py` rely on them. Ordering cannot
  keep those tests away from a flushed database: pytest-xdist's `loadscope`
  dispatches the largest scopes first, so a migration class can run on a
  worker before smaller regular classes. That was already true of the old
  per-test layout on `main` (one xdist worker running
  `TestPublicCropTranslationBackfill` and then `E2ECrossBrowserDatasetTest`
  fails two tests there). The fixture therefore serializes the database
  before migrating back and restores it after the flush, as Django's
  `serialized_rollback` does (flush without `post_migrate`, then
  `deserialize_db_from_string`). That a test must not rely on the seeded
  catalogue being either present or absent still holds; the old single-test
  classes that keep their own `setup_method` still flush without restoring.

Measured on a 4-core box (`pdm run test`, the CI command), full suite,
2507 passing tests both times:

| configuration | pytest | wall |
| --- | --- | --- |
| per-test migration cycle | 587s | 589s |
| **one cycle per class** | **272s** | **274s** |

Application coverage is unchanged except for one line: the early `return`
of `crops/migrations/0008`'s reverse function on a database without the
aubergine translation, which the old layout reached only by accident when a
later test of a class migrated back from an already flushed database.

### Why not split the backend into two CI jobs

A second runner is the obvious lever, and before the changes above it
would have bought little:

- **Every job pays the fixed costs again.** Setup, `pdm install`,
  gettext, the deploy check and `compilemessages` take ~40s per job. Each
  xdist worker then builds its test database by running all ~180
  migrations (~16s), before running a single test.
- **Coverage fragments.** Each job would report the coverage of only its
  own half. A true total needs both jobs to upload their `.coverage` data
  and a third job to combine them.
- **It did not address the actual bottleneck.** Under `loadfile` one
  339-second file bounded every worker. Two jobs would each have been
  bounded by whichever half that file landed in.

Both failure modes have shown up in this pipeline before: the `quality` job
ran the identical backend suite a second time (see the next section), and
the frontend shards were merged back because a second runner shortened a
job that was not the critical path. With the backend test step measured
at 3m14s on CI after these changes, below the ~5 minute E2E workflow, a
split would again shorten a job that no longer holds the pipeline up. By
November 2026 the step had grown back to 10m12s and was the critical path;
the class-scoped migration cycle above roughly halved it. Re-measure on CI
before revisiting a split.

### PostgreSQL-only regressions

Production runs PostgreSQL, the suite runs SQLite. SQLite ignores row locks
(`select_for_update()`), so a lock that PostgreSQL rejects passes every
SQLite test: `select_for_update()` combined with `select_related()` on a
nullable foreign key is an outer join, and PostgreSQL refuses `FOR UPDATE`
on its nullable side (#951; lock only the own row with
`select_for_update(of=('self',))`). Tests for such behavior carry the
`postgres` marker and also run in the separate `backend-postgres-tests`
job against a PostgreSQL 16 service; in `backend-tests` they only check the
functional result. `settings_test` switches to PostgreSQL when
`TEST_DB_ENGINE=postgres` is set and reads the connection from the same
`DB_*` variables as `settings.py`. Locally:

```bash
cd backend
TEST_DB_ENGINE=postgres pdm run test -m postgres -n0 --no-cov --create-db
```

The job runs only the marked tests, not the whole suite on PostgreSQL:
that is a separate decision (it would double the backend CI time and
surface unrelated backend differences).

### Retiring migration tests

A migration test guards a data migration until production has run it. After
that the migration's code is frozen (it is never edited again), the data it
transformed is gone, and a rollback that far back is not a real option, so
the test only costs time, and more with every newer migration, since each
migration test migrates back from the current leaf nodes. Fresh databases
(every test database, every new install) still run every migration, so a
migration that crashes on an empty database stays caught without its test.
The rule: **a migration test lives until its migration is in production.**

`.github/workflows/retire-migration-tests.yml` applies it on the 1st and 15th
of every month (GitHub's cron cannot express "every 14 days"), and on demand
through `workflow_dispatch` with an optional version:

- `scripts/ci/retire_deployed_migration_tests.py` reads the version
  production runs from its public `GET /api/version/` (`{"version": "x.y.z"}`)
  and fetches the matching `vx.y.z` release tag.
- A migration test file (a `backend/<app>/tests/test_*.py` that uses
  `MigrationExecutor` or `MigrationTestBase`) is retired when every migration
  it names, as `('app', '0123_name')` or `app.migrations.0123_name`, exists
  in that tag. A file naming no migration, or one this checkout lacks, is
  kept. Only test files are deleted, never migrations.
- The job opens one pull request from `chore/retire-deployed-migration-tests`
  (or updates the open one) listing the files and their migrations. A person
  reviews and merges it; nothing disappears unseen.

Retirement works per file, so give each migration its own
`test_migrations_<name>.py`: a file that also covers a migration not yet in
production stays until that one is deployed too.

The PR is created with the repository secret `RETIREMENT_PR_TOKEN`, a
fine-grained personal access token limited to this repository with
*Contents* and *Pull requests* read/write. `GITHUB_TOKEN` cannot be used:
pushes and pull requests it makes start no workflow runs, so the PR would
never get its CI. When the token expires, the scheduled run fails at checkout
until a new one is stored. If production's version endpoint cannot be reached
(the job runs from GitHub's runners, which Cloudflare could challenge), the
job fails rather than guessing.

## Why `quality` does not run the backend suite

`scripts/quality.sh` produces lint, complexity and coverage reports, and
running it locally still does all three. In CI the `quality` job sets
`SKIP_BACKEND_TESTS=1`, because `backend-tests` already runs the identical
pytest + coverage command: with it enabled in both, the backend suite ran
twice per pipeline and `quality` took as long as the job it duplicated.

If you add a backend gate, put it in `backend-tests` if it needs the test
run, and in `quality.sh` if it only needs the source.

Ruff and Madge run through `scripts/ci/quality_findings.cjs`. Exit code 1
means findings, not a successful clean scan. The comparator accepts only
the exact legacy findings in the reviewed
[`quality-baseline.json`](../scripts/ci/quality-baseline.json); new Ruff
diagnostics and new directed import cycles fail. Malformed/missing reports,
inconsistent exit codes, execution errors and unsupported versions fail as
inconclusive. Raw JSON, stderr, versions, exit status, timing and the
baseline comparison are retained under both `reports/latest/` and the
timestamped archive, included in CI's existing `quality-reports` artifact.
See [the baseline report](quality-baseline.md) for the pinned evidence,
allowance rationales, scanner limits and deliberate update procedure.

The quality job also runs `node --test tests/test_quality_findings.cjs`:
temporary fixtures exercise real Ruff violations and Madge cycles through
the gate, plus corrupt reports, missing binaries and version/exit failures.
It does not rerun repository-wide scans or backend tests in another job.

The job's *frontend* install was the other half of the same story. It was
the last CI consumer of `frontend/node_modules` with no wholesale cache,
and it installed with `npm install --force` rather than the `npm ci`
every other job uses — measured at 4m49s and 5m02s in front of a
36-second gate, so ~90% of the job was an install it need not repeat. It
now takes the same cache and the same key as `frontend-tests` and the
Playwright workflows, and skips the install outright on a hit. The
`--force` came in with the workflow's initial import rather than from a
resolution failure; `npm ci` installs the same lockfile cleanly.

## Required security review policy in quality

On PRs, an isolated `security-review-completion` job runs the security-review
policy from the immutable PR base with read-only API permissions. Its runner
has no checkout or PR code execution. The existing required `quality` job
uses `always()` and explicitly fails unless that dependency passes, so failure
cannot turn the required check into a harmless skip. PR-owned lint/tests run
on another runner with only contents-read permission and no Git credentials. It consumes
run/attempt-bound triage and completion artifacts; request delivery, bot
rejection, missing evidence and stale heads never count as a completed review.
Non-security exemptions are explicit skips, not clean scans. Provider guards
still prevent loops, while required guarded reviews need human approval.
A successful process without structured final-SHA/scope evidence is insufficient.

The reader waits at most 20 minutes within its 25-minute job limit; quality
has a separate 30-minute limit. After a provider finishes or a human approves
an exact-head contingency, rerun both failed jobs with
`gh run rerun RUN_ID --failed`, so the reader re-evaluates evidence before
quality checks its result. Rerunning quality alone does not refresh the reader. A new push needs new evidence.
The first installation requires explicit human bootstrap review because the
base has no policy yet. No existing required check name or protection is removed.
See [security-automation.md](security-automation.md#security-review-completion-gate-1045)
for states, actual completion evidence, manual commands and provider limitations.
Policy regression tests run in quality, not in the classifier before triage.
There is no application/backend behavior change or schema migration.

## E2E: sharded across runners, serial inside one

`frontend/playwright.config.ts` still pins `workers: 1` and
`fullyParallel: false`, and that stays: inside a single runner the specs
share one Django backend on one SQLite file, and concurrent workers there
would contend on that database (the WAL/`transaction_mode` comment in
`config/settings.py` is the scar tissue from exactly that).

Sharding across runners is a different axis and needs none of that. Each
matrix job is a fresh VM, and `playwright.config.ts` starts the backend
itself through its `webServer` block — so each shard gets its own Django
process, its own `db.sqlite3` and its own fixture users for free. Nothing
is shared to contend over.

The suite is additionally scenario-scoped: every spec passes a
`scenario_id` to the `/api/__e2e__/` fixture endpoint, and
`E2EInvitationFixtureView._reset` deletes only that scenario's project,
memberships, invitations and users. No spec depends on another spec having
run, which is why splitting them at any file boundary is safe.

### November 2026 baseline and measurement (#1108)

The suite now has **303 tests in 57 files and two Chromium projects**. The November 14
[PR #1107 run](https://github.com/OpenFarmPlanner/planner/actions/runs/43582327477)
and [release #1109 run](https://github.com/OpenFarmPlanner/planner/actions/runs/43583467079)
exercise the same frontend and E2E sources (the latter changes version files).
All three shards passed in both runs. Times below are seconds; runner queue
means run creation to job start, and the test step includes service startup.

| Run | Shard | Queue | Job | Production build | Test step |
| --- | --- | ---: | ---: | ---: | ---: |
| #1107 | 1 | 14 | 793 | 50 | 724 |
| #1107 | 2 | 10 | 574 | 40 | 494 |
| #1107 | 3 | 9 | 606 | 51 | 528 |
| #1109 | 1 | 36 | 761 | 49 | 688 |
| #1109 | 2 | 34 | 586 | 44 | 517 |
| #1109 | 3 | 2 | 525 | 45 | 453 |

The E2E critical paths including queue were **13:27 and 13:17**; aggregate
E2E runner time was **32.88 and 31.20 minutes**, excluding queue. Both used
warm npm and `node_modules` caches, skipped `npm ci`, and found Chrome on the
runner. The test counts were 102 / 100 / 101. Similar counts conceal the
persistent runtime imbalance: shard 1 dominates while setup and production
build take roughly a minute per runner. Sharing builds would save less than
balancing the long test block and would introduce an artifact dependency.

For the #1107 head, frontend test jobs finished in 2:01 / 2:17 / 2:49,
SQLite backend tests in 6:56 and PostgreSQL tests in 1:15. The standalone
production build finished in 0:58, and the six cross-browser jobs in
2:59–3:42. All required tests finished at 10:02:31 UTC, **13:27 after the
09:49:04 run creation**, with production-build shard 1 last. E2E therefore
sets the feedback time; improving the already shorter frontend/backend jobs
would not shorten that path. The backend test step accounts for 373 of its
416 seconds; the slowest frontend test step accounts for 152 of its
169 seconds. Their setup is already a small fraction, so additional dependency
caches would not address either test-execution cost or the PR critical path.
Aggregate runner time across the nine PR
workflows is 83.42 minutes (including review/gate waiting jobs;
excluding queue and the later advisory queue-marker run).

CI now keeps `e2e-timings-shard-N` JSON artifacts for seven days and emits
`E2E_TIMING_RUN`, `E2E_TIMING_SELECTED`, `E2E_TIMING_TEST` and
`E2E_TIMING_FILE` JSON records in successful as well as failing job logs.
These record the complete selected-test manifest, attempts/retries, file and
test durations, and fixture API action durations. Nested fixture steps count
once in the aggregate. Compare manifests and outcomes as well as durations;
retain the same production build, browser projects, serial worker and separate
VM/database per shard. Service startup is the interval before Playwright's
`Running ... tests` line; fixture time is part of test execution, not additional
wall time. The #1107 service/startup interval was 22–28 seconds per shard,
from test-step start to the `Running` line. For local profiling, set `E2E_TIMINGS=1`; reports go to
`frontend/test-results/e2e-timings.json`.

The measurement-only [draft #1111 baseline](https://github.com/OpenFarmPlanner/planner/actions/runs/43587034955)
ran the same 303 tests with zero Playwright retries: test steps were
**600 / 489 / 433 seconds**, job times **661 / 547 / 505 seconds**, and queue
**7 / 7 / 2 seconds**. Builds took 42 / 38 / 43 seconds with warm dependency
caches. E2E finished **11:08** after workflow creation and consumed **28.55
runner-minutes**. This draft also exposed a failing consent-tooltip test;
its pointer transition was corrected before the optimization was published.
The baseline E2E timings are complete passing measurements, not a claim that
that draft's whole CI passed.

File-level measurements explain the imbalance: `crop-import-batches` took
73.7s, `localized-companion-notes` 72.9s, `planting-plans-continuous-scroll`
69.2s, `library-link-lifecycle` 69.0s and `planting-plans-search` 68.2s.
Together, test execution was 1,449.995 seconds, of which fixture actions were
131.835 seconds (**9.1%**). Whole-file balancing addresses the larger uneven
execution block without changing authentication or fixture semantics. A fast
password hasher or shared login state is therefore deferred. The measured
file weights predict about 483 seconds per partition before startup and
worker overhead; actual CI results, including required-test finish time and
runner totals, are linked in [PR #1111](https://github.com/OpenFarmPlanner/planner/pull/1111).
Runner variance is visible between the historical and instrumented baselines;
compare cache conditions and retries, not estimates alone.

### Duration-aware file partitions

`.github/workflows/e2e.yml` keeps the same three required job names and calls
`node scripts/ci/run_e2e_shard.cjs INDEX/3` from the repository root. The runner
first discovers all tests with Playwright's normal configuration and JSON list
reporter, then assigns whole files longest-first to the currently lightest
partition. `scripts/ci/e2e_timings.json` records the measured source run, file
durations and test counts. A changed file's estimate scales with its current
test count; new files use the measured average cost per test. Deleted files
are ignored. Stale timing estimates can affect balance, but cannot omit tests.

The runner passes anchored, escaped file filters as argument arrays to the
same Playwright CLI. It keeps both Chromium projects, including the separate
scrollbar project, and the configured serial execution inside each file.
There is no shared server/database, extra worker, skipped test, reduced build
or shorter assertion timeout. `E2E_PARTITION` log records show the assignment;
timing reports identify the logical partition separately from Playwright's
native count-based `shard` configuration. Unit tests cover partition coverage,
new/changed files, project variants, literal filters and fail-closed inputs.

To refresh the profile, combine `E2E_TIMING_FILE` durations and counts from
all three successful, retry-free jobs of one comparable run. Use the selected
manifest to confirm every test appears exactly once before replacing weights;
record that run and head in `source`. Do not mix failed/retried attempts into
scheduling weights. Compare actual slowest-shard and total runner time after
refreshing; estimates are scheduling hints rather than performance guarantees.

### Earlier sharding and setup measurements (historical)

The following measurements predate the November 303-test suite; their test
counts and timings describe the earlier suite rather than today's baseline.

Verify a shard-count change with `npx playwright test --list --shard=N/<count>`
— it needs no browser and no backend, and the shards must add up to the
unsharded total: 88 tests in 28 files, currently split 33 / 26 / 29.

Playwright shards by test count, not runtime, and for this suite that
balances badly. Measured test-step times:

| shards | per shard | critical path |
| --- | --- | --- |
| 1 (none) | 7m10s-7m51s | ~7m30s |
| 2 | 4m45s / 3m32s | 4m45s |
| 3 | **4m11s** / 2m17s / 2m14s | **4m11s** |

The third shard bought 34 seconds for a whole extra runner, because the
expensive specs cluster: shard 1 holds the login-heavy `fields-beds-*`,
`gantt-*` and `invitation-flow` files and runs 1.8x as long as either of
the others. Note also which way this falls — the shard holding the
responsive layout spec (`responsive-layouts`) is among the *fast* ones.

Adding shards is therefore close to exhausted as a lever: a fourth would
split one of the already-fast shards and leave shard 1's 4m11s standing.
What is left is making the tests themselves cheaper.

**Measure the test step, not the job.** Job wall time is dominated by
`npm ci` variance (below); two consecutive runs of the same two shards
came out 10m27s/4m57s and then 7m27s/9m21s — a complete reversal — while
the test steps stayed at 4m45s and 3m32s. Tuning the balance against job
duration optimises noise.

### Where an e2e job's time actually goes

One shard, measured end to end:

| step | before | with a warm cache |
| --- | --- | --- |
| setup (checkout, node, python, uv) | 12s | 10s |
| `npm ci` / node_modules restore | 1m49s | **5s** (install skipped) |
| Chrome check | 9s | 6s |
| `npm run build` | 23s | 20s |
| **tests** (incl. backend boot) | **~5m** | **3m40s** |

Everything outside the tests now adds up to well under a minute, so the
job is ~85% test execution — which is where the remaining work is.

The tests are the majority, and inside them the per-test cost is roughly
4-8 seconds of which a UI sign-in is a large part — the log shows a
`GET /api/auth/me/` followed by a login before almost every test. Shard 1
spends 4m11s on 33 tests, i.e. 7.6s each.

Reusing an authenticated `storageState` across the specs in a scenario,
instead of signing in per test, is the next real lever — and, given the
table above, the only one left that shrinks the suite rather than
redistributing it. It is a refactor of `e2e/utils.ts` and every spec that
calls it, so it needs its own change and its own before/after
measurement.

A second, cheaper thing to try first: raising `workers` above 1 *within* a
shard. Each shard now has its own backend and its own SQLite file, and the
WAL + `transaction_mode=IMMEDIATE` settings that `config/settings.py`
documents were added specifically to survive concurrent e2e load. Whether
that is enough for two workers on one database is untested — try it on a
branch and watch for `database is locked`.

### `npm ci` variance, and why node_modules is cached

`npm ci` takes anywhere from ~18 seconds to ~5 minutes. This is **runner
variance, not a property of any one workflow**: the clearest evidence is a
single e2e matrix run where two shards — same commit, same workflow, same
lockfile, same restored `cache: npm` — took 18s and 5m03s respectively.
Sampling one job at a time makes it look like some workflows are "slow"
and others "fast"; they are not, they drew different runners.

`cache: npm` only restores the *download* cache (`~/.npm`); the slow runs
still link ~840 packages into `node_modules`. So `e2e.yml`,
`frontend-build.yml` and `ci.yml`'s frontend job additionally cache
`frontend/node_modules` itself and skip the install on a hit. The key
pins the lockfile hash and the resolved Node version, so a dependency
bump or a Node major misses and reinstalls instead of reusing an
incompatible tree. Nothing is lost by skipping the install: npm reports
core-js's postinstall as *not* run under this project's allow-scripts
policy, so no install script has a side effect to preserve.

Measured on the run right after the cache was populated: the restore takes
**5 seconds** and the install step is skipped outright, against `npm ci`
runs of 1m49s to 5m03s on the same branch. The e2e shard-1 job went from
7m55s to 4m24s on that change alone, and `frontend-build` from ~2-4
minutes to 43 seconds.

Expect no gain on the *first* run of a branch — Actions caches are scoped
to the branch and its base, so a new branch always misses and populates.
Judge the effect from the second run onward.

There used to be a `Cache Playwright browsers` step in the two Playwright
workflows. It was dead: the log shows `Cache not found for input keys` on
restore and `Path(s) specified in the action for caching do(es) not exist`
on save, because `~/.cache/ms-playwright` is never written — the Chrome
the config pins comes from the runner image, which is the fast path
`scripts/ci/install-playwright-chrome.sh` documents. Both steps are gone.

## Cross-browser suite (Chromium, Firefox, WebKit in Docker)

`frontend/playwright.cross-browser.config.ts` runs `frontend/e2e-cross-browser/`
in three engines on desktop and phones. Functional and layout assertions
cover overflow, dialog/action bounds, field widths, navigation, dates and
responsive variants. It remains separate from the Chrome-channel suite in
`playwright.config.ts`. Neither suite compares screenshot pixels.
**Chrome remains the manual reference browser.**

| Project | Engine | Device |
| --- | --- | --- |
| `desktop-chromium` | Chromium (bundled, not the Chrome channel) | Desktop Chrome, 1280x720 |
| `desktop-firefox` | Firefox | Desktop Firefox, 1280x720 |
| `desktop-webkit` | WebKit | Desktop Safari, 1280x720 |
| `mobile-chromium` | Chromium | Pixel 7, 412x839, touch, `isMobile` |
| `mobile-webkit` | WebKit | iPhone 15, 393x659, touch, `isMobile` |
| `mobile-firefox` | Firefox | approximated phone, 393x851 (see below) |

**mobile-firefox is an approximation.** Playwright cannot emulate mobile
Firefox: `isMobile` is supported only by Chromium and WebKit. The project
therefore uses desktop Firefox with a phone-sized viewport (393x851),
`hasTouch: true`, `deviceScaleFactor: 2` and a Firefox for Android user
agent. Unlike a real phone it ignores `<meta name="viewport">`, keeps
desktop media features (`pointer: fine`, `hover: hover`), shows desktop
scrollbars and number-input spinners, and has no font inflation. It catches
Gecko layout differences at phone width, not Firefox for Android itself.

### Determinism

- **Docker only.** Cross-browser assertions run inside the official
  `mcr.microsoft.com/playwright:v<version>-noble` image, where `<version>` is
  read from the installed `@playwright/test` in `package-lock.json`, so fonts
  and system libraries are identical locally and in CI.
- **Time:** an auto fixture (`e2e-cross-browser/fixtures.ts`) pins
  `Date.now()` to 15 May 2026 10:00 Vienna time with `page.clock.setFixedTime`.
  That is mid-season in the fixture's 2026 season. Timers keep running.
- **Locale and time zone:** `de-AT` and `Europe/Vienna` for every project.
- **Data:** every test seeds its own copy of a dedicated, fixed dataset
  through the E2E fixture endpoint (`setup_cross_browser`, scenario id per
  project and test; `loginToFixtureProject` in `fixtures.ts`). The data is
  defined in one place, `backend/farm/e2e_cross_browser_data.py`: project
  "Testgärtnerei Morgentau", seasons 2025 and 2026, eight Kulturen (Tomate
  with every crop-form section filled, its Sorte Roma, and the crops the
  plans use), and twelve current-season plans that show each rotation
  status once. Its dates are absolute and match the fixed clock, so nothing
  depends on the server date. It shares no code with the demo project
  ([demo-project.md](./demo-project.md)): **enriching the demo never changes
  this fixture.** Change it together with the names and counts the specs assert;
  `farm/tests/test_e2e_views.py` pins what the specs rely on.

### Running it

```bash
cd frontend
npm run test:e2e:cross-browser                    # all six projects
npm run test:e2e:cross-browser -- --project=mobile-firefox crop-form
npm run test:e2e:all                              # Chrome suite, then this one
```

All of these call `e2e-cross-browser/run-in-docker.sh`, which is equivalent to

```bash
docker run --rm --init --ipc=host \
  -v "$PWD/..:/work" \
  -v openfarmplanner-e2e-node-modules:/work/frontend/node_modules \
  -v openfarmplanner-e2e-cache:/cache \
  -w /work/frontend \
  mcr.microsoft.com/playwright:v1.63.0-noble \
  bash e2e-cross-browser/docker-entrypoint.sh [playwright args]
```

The entrypoint installs a pinned `uv` (the image has Python but no uv),
runs `npm ci` when the lockfile changed, builds the bundle with
`tsc -b && vite build`, and runs the suite. The build skips the `postbuild`
prerender, which needs the Google Chrome channel the image lacks. The backend
and the browsers run inside the container's own network, so a dev server on
the host's 8000/4173 is never reused. `E2E_SKIP_BUILD=1` reuses the last
`dist/`. `E2E_DOCKER_ARGS` adds `docker run` arguments, e.g. proxy variables
and a CA bundle behind a TLS-intercepting proxy. Results land in
`frontend/test-results/` and `frontend/playwright-report/`.

### Screenshots and layout coverage

Screenshot pixel comparisons, baseline PNGs, automatic re-recording and the
`accept-screenshots` label workflow were removed in #1030. Routine UI changes
require no screenshot-diff approval. Human visual review of rendered UI
changes remains part of development (see `CLAUDE.md`); artifacts have no
pixel-comparison pass/fail threshold.

The Chrome `responsive-layouts.spec.ts` visits eight routes at 375x800,
768x900, 1024x900 and 1440x900. It asserts page-heading visibility and no
horizontal page overflow and attaches each screenshot for visual review.
`fields-beds-mobile-landscape.spec.ts` guards mobile list/desktop grid
switching at portrait, landscape, tablet and desktop sizes.

Existing focused Chrome tests cover crop forms and badges, empty details,
field/bed dialogs, scrollbar compensation, Gantt layout and task controls.
The cross-browser suite already checks navigation, dialog overflow/action
bounds, crop field widths, crop selection/edit/cancel, mobile plan cards,
sticky table headers and Gantt geometry. Dialog action trial clicks also
check that controls are unobstructed. These tests cover concrete risks;
they are not a general detector of arbitrary visual overlaps.

### CI

`.github/workflows/e2e-cross-browser.yml` runs all six projects on pull
requests to `main`, via `run-in-docker.sh`. Chrome functional and responsive
tests continue in the three `e2e.yml` shards. Existing check names and branch
protection are unchanged. Both configs retain screenshots and traces on
failure; failing jobs upload `playwright-report/` and `test-results/` as
`playwright-cross-browser-<project>` or `playwright-report-shard-N`.
Use `npx playwright show-trace <trace.zip>` to inspect a failure.

### Cross-browser issues found and fixed

Issues the suite surfaced, each fixed in the app and guarded by a test.
A new engine-specific bug gets a failing test here first, not a workaround
in the fixtures.

| Issue | Engines | Fix | Guarded by |
| --- | --- | --- | --- |
| Form fields shrink-wrapped to the engine's intrinsic `<input>` width, so the Kultur form looked different in every browser (worst in Firefox on mobile). | all, visibly different per engine | The field-width roles no longer set `alignItems` (see [form-layout.md](./form-layout.md)). | `crop-form.spec.ts`, `formLayout.test.ts` |
| A full navigation (bookmark, typed URL) started while a lazy route chunk was still loading was cancelled: the page being left reloaded instead. Leaving the page makes these engines reject the in-flight `import()`, and the stale-deploy recovery treated that as a missing chunk. | Firefox, WebKit; never Chromium | `recoverUnlessPageIsUnloading` (`src/runtime/chunkLoadErrors.ts`) holds the recovery back after `beforeunload`; it still runs if the page stays (e.g. a cancelled leave prompt). | `navigation-during-chunk-load.spec.ts`, `chunkLoadErrors.test.ts`, `RouteErrorBoundary.test.tsx` |
| Decimal fields showed the engine's own number formatting: `0,5` in WebKit, `0.5` in Chromium/Firefox, while the rest of the UI uses a comma. | WebKit vs. Chromium/Firefox | Decimal fields use `LocalizedDecimalField` (see [form-layout.md](./form-layout.md)). | `crop-form.spec.ts`, `LocalizedDecimalField.test.tsx` |
| At phone width the "Fruchtfolge-Eigenschaften" info icon drifted to the right edge and the variety legend dropped its description onto a line of its own. | all, at about 393 px and below | The icon is tied to the heading's last word; the legend is one flowing sentence. | `crop-form.spec.ts` |

Not issues, but emulation limits that show up in the `mobile-firefox`
captures: native number spinners on integer fields and desktop scrollbars
(Firefox has no mobile emulation, see above).

## Adding tests

- Keep new frontend files under `src/**/*.{test,spec}.{ts,tsx}` — that is
  what the `include` glob and the coverage config match on.
- Watch each CI job's test step against the others'. A job only matters
  while it is the critical path; split or shard the one that is (see
  above), not the one that is merely long.
- Prefer extending an existing test file, but not past the point where it
  dominates a run. A frontend file never splits across workers or e2e
  shards, and a backend test class never splits across xdist workers, so
  a class or file that takes minutes is a scheduling problem for whichever
  worker it lands on.
- Backend tests that manipulate migrations belong in a `test_migrations_*`
  file, and must migrate forward to the leaf nodes again in their teardown,
  so the next test on that worker starts from the current schema. Keep
  state that several tests share inside one class: `--dist loadscope`
  keeps a class on one worker, but not a module.
- A backend test that needs the production password hasher, for example
  to check hash upgrades, overrides `PASSWORD_HASHERS` in that test only.
  Everything else runs on the fast test hasher (see above).
- The published OpenAPI reference is gated by
  `farm/tests/test_public_api_schema.py`, which runs in the normal backend
  job: it calls `manage.py spectacular --fail-on-warn --validate`, so any
  drf-spectacular warning (an unresolvable `SerializerMethodField`, an
  `APIView` without a serializer) fails CI for operations in the published
  (token-reachable) surface. It also pins that surface, so opting a view into
  `api_token_actions` means updating `EXPECTED_OPERATIONS` there. Reproduce
  locally with
  `DJANGO_SETTINGS_MODULE=config.settings_test pdm run python manage.py spectacular --fail-on-warn --validate --file /dev/null`.
