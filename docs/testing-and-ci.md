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
| `quality` | ruff, radon, ESLint, madge | 38s | 1m18s |

Frontend and `quality` from run 36112871261 (25 Sep 2026). `backend-tests`
from PR #703's first CI run (29 Sep 2026), which introduced the changes
described under "Backend" below; the same job took 10m12s / 10m52s on the
25 Sep run.

`.github/workflows/e2e.yml` runs the Playwright suite against a production
build on pull requests, split across three shards of its own.

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

Switching to `loadscope` changed which tests share a worker, and the
coverage report moved by eight lines: `find_demo_crop_species()`'s
fallback in `farm/services/demo_project.py` only runs when the seeded crop
species are missing. They go missing when an earlier `transaction=True`
test on the same worker flushes the database, since the flush also removes
the data migrations' seed rows. That order dependence predates this change:
a test must not rely on the seeded catalogue being either present or
absent.

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

**The next lever, not yet done:** one migration cycle per class instead of
one per test. That means a class-scoped fixture that migrates, seeds and
migrates forward once, tests marked plain `django_db` so each one's writes
roll back, and a flush once the class is done, as `transaction=True` does
today after every test. By the table above it would take the summed
migration time from ~557s to roughly 200s, and the local wall time from
~200s to an estimated 110-120s. Two constraints shape it:

- Tests that migrate *inside* the test body
  (`test_migration_is_reversible`, and the two `test_reverse_*` tests)
  cannot run inside the rolled-back transaction: SQLite's schema editor
  refuses to run in an atomic block while foreign-key checks are on. They
  keep a per-test cycle in a class of their own.
- The migrate/seed/migrate boilerplate is currently copied into all 14
  files. A shared helper should replace it, rather than a fifteenth copy.

It touches every migration test file and deserves its own change, with
its own before/after measurement.

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
at 3m14s on CI after these changes, below the ~5 minute E2E workflow, a split would again shorten a job that no longer holds the
pipeline up. Re-measure on CI before revisiting it. If it comes back, the
class-scoped migration setup above is the cheaper win.

## Why `quality` does not run the backend suite

`scripts/quality.sh` produces lint, complexity and coverage reports, and
running it locally still does all three. In CI the `quality` job sets
`SKIP_BACKEND_TESTS=1`, because `backend-tests` already runs the identical
pytest + coverage command: with it enabled in both, the backend suite ran
twice per pipeline and `quality` took as long as the job it duplicated.

If you add a backend gate, put it in `backend-tests` if it needs the test
run, and in `quality.sh` if it only needs the source.

The job's *frontend* install was the other half of the same story. It was
the last CI consumer of `frontend/node_modules` with no wholesale cache,
and it installed with `npm install --force` rather than the `npm ci`
every other job uses — measured at 4m49s and 5m02s in front of a
36-second gate, so ~90% of the job was an install it need not repeat. It
now takes the same cache and the same key as `frontend-tests` and the
Playwright workflows, and skips the install outright on a hit. The
`--force` came in with the workflow's initial import rather than from a
resolution failure; `npm ci` installs the same lockfile cleanly.

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
the others. Note also which way this falls — the shard holding both
screenshot specs (`landing-screenshots`, `responsive-layouts`) is among
the *fast* ones.

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
4-8 seconds of which a UI sign-in is a large part — the log shows an
`Unauthorized: /api/auth/me/` followed by a login before almost every
test. Shard 1 spends 4m11s on 33 tests, i.e. 7.6s each.

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
