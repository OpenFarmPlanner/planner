---
name: test-coverage-campaign
description: Cover or harden a module with tests whose strength is measured instead of assumed - survey what is untested, break the code with a mutation battery to see what the suite really catches, close the gaps, ship it as one small PR. Use when asked to add test coverage, strengthen a weak suite, or work through many files in a coverage or refactoring campaign.
---

# Test coverage campaign

Rules: `CLAUDE.md` ("Testing Rules", "Engineering Safety Rules", "Git and PR
Workflow") and `docs/testing-and-ci.md` (which CI job a new file lands in and
what must not grow). This skill is the order of work and the measurement; it
replaces none of those rules.

A passing suite proves its assertions ran, not that they would fail if the code
were wrong. Everything below exists to tell those two apart. Environment facts
that otherwise have to be re-derived per suite are in
[`test-environment-facts.md`](test-environment-facts.md).

## 1. Pick a target

Survey **every** `__tests__` directory, not just `frontend/src/__tests__` -
there are a dozen of them, and a survey over one produces false "untested"
hits:

```bash
cd frontend
comm -13 \
  <(find src -path '*__tests__*' -name '*.test.ts*' -exec basename {} \; \
      | sed -E 's/\.test\.tsx?$//' | sort -u) \
  <(find src \( -name '*.ts' -o -name '*.tsx' \) -not -path '*__tests__*' \
      -exec basename {} \; | sed -E 's/\.tsx?$//' | sort -u)
```

That matches on filenames only, so confirm each candidate
(`grep -rl "from '.*/<name>'" src --include='*.test.ts*'`): a module is often
covered from a suite with another name. Prefer modules with branching logic,
and modules several callers depend on, over large but straight-line files.

## 2. Read before writing

Read the target and every caller. Write down the behaviour the callers rely on
and would not notice breaking - that, not the implementation's shape, is what
gets asserted. A test that mirrors the code line by line survives nothing.

## 3. Measure the existing suite first

Write the battery before writing a single test, so the gaps are known rather
than guessed. Suites that look thorough caught 8 of 51 breaks, 6 of 17, and 36
of 90 when first measured.

A mutation is one observable change: flip a comparison, drop a guard, change a
constant, swap a branch, drop an `await`, remove a key from a payload. Not
worth the run: anything only the types reject (vitest transpiles without
typechecking, so it is never caught - that is `tsc`'s job), and anything the
rendered result cannot reflect (a second `sx` spread the original trailing
spread still overrides is a no-op that reads as a survivor).

Run batteries in a throwaway worktree, so an interrupt cannot leave the main
checkout dirty and the dev servers keep running:

```bash
SP=<scratchpad>
git worktree add -f "$SP/battery-wt" HEAD
ln -s "$PWD/frontend/node_modules" "$SP/battery-wt/frontend/node_modules"
cd "$SP/battery-wt"
nohup python3 .claude/skills/test-coverage-campaign/mutate.py \
  --spec frontend/src/__tests__/Foo.test.tsx \
  --mutations "$SP/mutations-foo.json" > "$SP/foo.log" 2>&1 &
until grep -qE '=== summary ===|FAILED|Traceback' "$SP/foo.log"; do sleep 25; done
```

Never pipe a backgrounded battery into `tail` - the output buffers and progress
becomes invisible. `mutate.py --help` has the mutation format. It gates every
run on the unmutated suite passing first: without that gate a wrong flag or a
broken import makes every run exit non-zero, which reads as a perfect battery
while nothing was tested at all. Treat its `SKIPPED` lines as unfinished work,
not as noise: a snippet that did not apply never ran.

## 4. Triage every survivor

There are exactly two outcomes, and both are recorded:

- **The test is weak.** Strengthen the assertion. The recurring causes: a
  fixture that never puts a request genuinely in flight; an assertion taken at
  the wrong moment (after a timer fired, mid-transition, inside MUI's 100 ms
  tooltip enter delay) so it passes vacuously; a single-row fixture, which
  makes index arithmetic and an off-by-one indistinguishable; two values that
  format identically under either formatter; a style assertion jsdom resolves
  the same way in both branches; a `getByRole` query ambiguous enough to match
  a parent.
- **The line is genuinely unobservable** - two branches converge, a guard only
  avoids wasted work, a conversion emotion already performs. Record it in the
  suite's docblock as a standing survivor with the reason, rather than
  contriving a fixture that asserts nothing. Do not delete the production line
  as part of a test-only change.

Then re-run the battery. The second number is the one that counts.

## 5. Write the tests

- Extend an existing suite before adding a file. Extract a helper into
  `src/__tests__/helpers/` when the **second** suite needs it, not on first use.
- Assert the rendered German text (`setupTests.ts` pins the suite to `de`).
- Name each test after the behaviour a caller depends on; add a docblock only
  where the reason is not obvious from the name. A regex containing `*/` closes
  a block comment early - escape it.
- Gates for what you touched only, never the full suite:
  `npx vitest run <specs>`, `npx tsc -b`, `npx eslint <files>` (use
  `${PIPESTATUS[0]}` if you pipe them).

## 6. Findings that are not tests

A battery turns up production bugs: a dead prop, a palette token the theme
never defines, an unreachable branch, a rejected promise nobody catches. Fixing
them here would be an unrelated change (`CLAUDE.md`, "Engineering Safety
Rules"). Instead assert the current, wrong behaviour in a test named so it
reads as a finding, note it in the suite, and list it in the PR body. A fix
that changes rendered UI needs the `visual-review` skill first.

## 7. Ship one batch

- One PR per coherent batch of two to four suites. `test:` for test-only work,
  `refactor:` when production code moved; never `feat` or `fix`.
- Label the PR `release:patch` immediately after opening it.
  `auto-release-label.yml` matches whole words in title and body, so
  `breaking`, `new`, `add`, `feature` and `implement` would mislabel the
  release; it honours a label that is already there.
- Re-run a failing CI job only with a purpose you can name (sampling a flake
  that does not reproduce locally), and say so.
- Remove the worktree (`git worktree remove`) when the batch is done.
