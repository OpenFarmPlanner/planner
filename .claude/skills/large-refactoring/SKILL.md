---
name: large-refactoring
description: Carry out a large structural change without changing behaviour and without an unreviewable diff - splitting a module or domain package, pulling logic into a service, extracting a shared component, or renaming something many call sites depend on. Use when asked to refactor, split, extract, move, rename or restructure code across more than a handful of files.
---

# Large refactoring

Rules: `CLAUDE.md` ("Engineering Safety Rules", including the shim exception,
plus "Git and PR Workflow", "Documentation Rules", "Testing Rules") and
`docs/architecture-overview.md` (which package owns what - those boundaries
are decisions already taken, not defaults).

A refactoring is done when the behaviour is provably unchanged and the diff is
reviewable. Every step below protects one of those two properties.

## 1. Settle the target shape first

- Name the one thing that gets easier. If no future change becomes cheaper,
  the refactoring is not worth its review cost.
- Extend the split that exists instead of inventing a second one. The backend
  keeps one package per domain (`farm/structure/`, `farm/planning/`,
  `farm/projects/`, `farm/history/`, `farm/notes/`, `farm/feedback/`,
  `farm/crops/`), each owning its views and serializers - as a module, or as a
  package of its own once it outgrew one file, the way `farm/crops/` did.
  Business logic belongs in `farm/services/`, code shared across domains in
  `farm/common/` (mixins, serializer fields), and the public crop library sits
  behind the `crops` app boundary.
- Inventory the call sites before planning anything, because the count decides
  whether this is one PR or four:

  ```bash
  grep -rn "<symbol>" backend frontend/src --include='*.py' --include='*.ts' --include='*.tsx' | wc -l
  grep -rln "from '.*<module>'" frontend/src | sort
  ```

- Write down what is explicitly out of scope. An unrelated cleanup you notice
  on the way gets flagged separately, never folded in.

## 2. Baseline the behaviour before moving it

- The existing tests are the contract being preserved. If the area is thin on
  them, cover it **first, in its own PR**, with the `test-coverage-campaign`
  skill. A refactoring of untested code cannot be verified, only hoped about.
- Record what green looks like now, so a later failure is attributable:
  the targeted suites, `npx tsc -b`, `npx eslint <files>`,
  `npx madge --circular --extensions ts,tsx src`, and for backend work
  `pdm run radon cc farm -s -a`.
- The rule that makes everything after this safe: **a pure refactoring changes
  no test assertion.** Import paths in test files may move with the code; the
  moment an expected value has to change, this is a behaviour change. Stop,
  say so, and treat it as one.

## 3. Move mechanically, in separate commits

- `git mv` so history follows. Verify a move really is one:
  `git diff -M --stat` should report renames, and `git log --follow <new path>`
  should still reach the old commits.
- Split the commits: one that **only** moves files, then one that adapts the
  call sites. A reviewer can trust a rename-only diff at a glance, and a
  bisect lands on the step that broke something.
- Inside the repo, update the call sites rather than leaving a re-export
  behind. Two live names for one thing is exactly the duplication the rules
  forbid - re-exports are for clients outside the repo (step 4).
- Run the gates between steps, not once at the end. Every step ends green.

## 4. Shims for what this repo does not own

Mandatory for anything outside the repo that already depends on the old
spelling - a deploy restarts the backend but does not reload open tabs, and
external integrations are not ours to update:

| what moved | what has to keep working |
| --- | --- |
| API path or query parameter | deprecated alias, plus a `CHANGELOG.md` entry (`docs/api.md`, "Versioning and deprecation") |
| an operation in the token surface | `EXPECTED_OPERATIONS` in `farm/tests/test_public_api_schema.py` pins it; update the pin in the same change |
| WebSocket route | keep the old path registered - `config/routing.py` already carries one such alias, commented, from the "culture" rename |
| frontend route reachable from a bookmark | a `<Navigate to=... replace />` for the old path (`App.tsx` has the pattern) |
| browser-storage key | read the old key once and migrate the value |
| persisted enum or DB value | a data migration, never a bare rename |

Each shim gets a test for the old spelling, a deprecation marker, and a
sentence in the commit stating what has to be gone before it can be removed.

## 5. The checks a structural change actually trips

- `madge --circular` (the `quality` job): moving a module between packages is
  the standard way to create an import cycle. Run it yourself, per step. The
  gate tolerates a non-zero exit and `main` already carries one cycle, so
  compare against the baseline from step 2 rather than expecting zero.
- `radon cc`: splitting a long function relocates complexity rather than
  removing it. Compare against the baseline instead of assuming an
  improvement.
- Moved models or fields need a migration (`makemigrations --check` tells you)
  and renumbering against open PRs - the `django-migration` skill owns that.
- Rendered UI touched at all, a moved shared component included: the
  `visual-review` skill, because a component's styling context moves with it.
- A moved i18n namespace moves in all four languages; a key is deleted only
  once nothing references it (`ui-text-i18n` skill).
- Documentation that describes the old structure is part of the change
  (`docs/architecture-overview.md` and the area's deep-dive doc).

## 6. Ship it in reviewable slices

- A refactoring that cannot be split is usually not understood yet. Prefer
  several PRs that are each independently mergeable and behaviour-neutral over
  one that has to be taken on trust.
- `refactor:` for structural work. If a behaviour change proves unavoidable,
  it gets its own `feat:`/`fix:` commit and a line in the PR body - never a
  silent passenger.
- Expect the automated review: 300+ lines or 15+ files triggers it, which a
  refactoring almost always does. Its fix commits land on the branch; read
  them rather than merging past them.
- The PR body states the target shape, what moved where, every shim and its
  removal condition, what is out of scope, and the evidence behaviour held -
  which suites ran **unchanged**.
