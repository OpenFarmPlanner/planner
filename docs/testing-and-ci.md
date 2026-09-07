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
| `frontend-tests` | `vitest run` | 3m54s-5m06s | 5m23s-9m13s |
| `backend-tests` | `pytest` (xdist, with coverage) | 4m41s-7m29s | 5m48s-8m04s |
| `quality` | ruff, radon, ESLint, madge | 36s | 2m00s-6m11s |

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
step times before optimising the suite. What the pipeline actually waits
for is the backend test step, ~7 minutes in three runs out of four.

## Frontend: one job, parallel within it

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

`backend/pytest.ini` runs the suite with `-n auto --dist loadfile`
(pytest-xdist), which took a local run from 701s to 233s with the same
1164 passing tests and the same combined coverage. `settings_test` uses an
in-memory SQLite database and pytest-django gives each worker its own, so
the workers do not share state.

`--dist loadfile` (rather than the default `load`) is required, not a
preference: it keeps every test in a file on the same worker. The
migration tests migrate the schema backwards to a specific node and
forwards again around each test, so two of them interleaving on one
database would fight over the schema.

The backend job compiles application translations before pytest. The shared
`pdm run compilemessages` command includes `--ignore=.venv` because PDM creates
its environment inside `backend/`; without that exclusion Django recursively
walks and recompiles dependency locale catalogs as well as the repository's
catalogs, creating very large CI logs and unnecessary work.

Pass `-n0` to run serially again — that is what `--pdb` and any debugging
that needs readable, non-interleaved output want.

### The migration tests are the expensive ones

`farm/tests/test_migrations_*.py` and
`crops/tests/test_migrations_translations.py` are 41 tests — 3.5% of the
suite — and took 261s of the 701s serial run, about 37%. Each test's
`setup_method` replays the migration graph down to `migrate_from` and back
up to `migrate_to`, and `teardown_method` migrates forward to the leaf
again, so a class with four test methods pays for four full cycles.

xdist absorbs most of that cost by spreading the files across workers. If
they become the bottleneck again, the fix is to make the setup class-scoped
so a class pays for one cycle instead of one per test — which requires
checking that the tests in each class do not depend on a freshly migrated
database.

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
- Watch the frontend job's runtime against the backend job's. It is a
  single job with about two minutes of headroom; past that, re-shard it
  (see above) rather than letting it become the critical path.
- Prefer extending an existing test file, but not past the point where it
  dominates a run. A file that is minutes long is a scheduling problem for
  whichever worker or e2e shard it lands on, since a file never splits.
- Backend tests that manipulate migrations belong in a `test_migrations_*`
  file, so `--dist loadfile` keeps them isolated on one worker.
