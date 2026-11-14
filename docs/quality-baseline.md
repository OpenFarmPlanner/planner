# Ruff and Madge baseline

Issue #1116 replaces the blanket acceptance of scanner exit codes `0,1`
with an explicit finding comparison. This changes lint/cycle enforcement,
not application behavior, lint rules, required security evidence or test
coverage. ESLint, Radon and backend test commands retain their existing
behavior. Only the existing quality job scans repository sources.

## Reproduced evidence

The initial baseline was reproduced from main commit
`a7e25d786fb7ac969c62aa0d2d77364c9f2de9d9` (PR #1119), on 14 November 2026.
Ruff **0.8.6**, pinned by `backend/pyproject.toml`/`pdm.lock`, produced
**1,605 diagnostics in 149 files**, exit **1**, with empty stderr. Madge
**8.0.0**, resolved by `frontend/package-lock.json`, produced **one directed
cycle**, exit **1**, with empty stderr. These are findings, not crashes.

Equivalent machine-readable commands, from the repository root:

```bash
(cd backend && pdm run ruff --version && pdm run ruff check . --output-format=json)
frontend/node_modules/.bin/madge --version
frontend/node_modules/.bin/madge --circular --extensions ts,tsx --json frontend/src
```

The complete normalized Ruff output (path, rule, message, observed position
and exact affected source) and Madge cycle are committed in
[`scripts/ci/quality-baseline.json`](../scripts/ci/quality-baseline.json).
The normalized output removes checkout-specific absolute paths and Ruff's
automatic-fix suggestions, not findings. The baseline's `reasons` map applies
to every explicitly listed occurrence of that rule; it grants no file-wide
or rule-wide exemption. These are deferred findings, not claims that the
affected code is correct or harmless.

| Rule | Occurrences | Why tolerated for this rollout |
| --- | ---: | --- |
| E501 | 1,544 | Existing overlong lines; wrapping all of them would turn a gate change into a mass formatting change. Changed/new occurrences must be fixed. |
| I001 | 34 | Existing import ordering/formatting; defer unrelated import changes. Changed blocks must be fixed. |
| C901 | 11 | Existing complex functions need focused refactoring and regression coverage. Increasing the reported complexity fails. |
| F401 | 3 | Existing unused imports; remove in focused fixes that check initialization side effects. |
| UP038 | 3 | Existing tuple-style type checks; defer unrelated modernization. |
| B904 | 2 | Existing missing explicit exception chaining; defer traceback behavior changes. |
| F405 | 2 | Existing settings names provided by a star import; defer settings composition changes. |
| F841 | 2 | Existing unused local assignments; preserve potentially side-effecting expressions until focused cleanup. |
| UP035 | 2 | Existing deprecated typing imports; defer unrelated modernization. |
| UP017 | 2 | Existing timezone alias spelling; defer unrelated modernization. |

The single accepted cycle is:

```text
crops/cropLibraryAction.ts -> crops/usePublicCropUpdate.ts -> crops/cropLibraryAction.ts
```

Its existing hook/action coupling belongs to the focused crop-library audit
#1117; #1116 records it without performing that refactor.

The subsequent #1117 boundary refactor retires this cycle: the pure action
module owns the two-boolean status contract, and the React controller extends
it without a reverse type import. It also fixes the touched bridge import
block. The current baseline therefore contains **1,604 Ruff findings**
(33 I001 occurrences) and **zero cycles**; the table above remains the pinned
initial evidence. No new allowance was introduced during that pruning.

The issue's historical successful CI runs #43588107346 and #43583411084
demonstrate the old exit-code acceptance. Their archived scanner reports
could not be downloaded through this Cloud environment's permitted hosts.
The baseline above is independently reproduced pinned-source evidence,
not a claim to have verified those archived contents.

## Gate behavior and reports

The gate requires the exact supported versions above. Ruff and Madge both
use exit 0 for an empty JSON result and exit 1 for nonempty findings; Ruff
uses exit 2 for execution/configuration failures, while Madge can also use
exit 1 for crashes. Therefore the exit code alone cannot establish success.
The gate requires valid, structurally checked JSON, consistent exit status,
empty stderr and a supported version. Missing executables, timeouts, signals,
empty/truncated output, unexpected shapes and contradictory results are
inconclusive failures. It never substitutes an empty result after an error.

Ruff matching uses **path + rule + message + exact affected source**, with
occurrence counts. Line movement alone preserves an allowance; changed
source/messages, a new path or additional identical occurrences fail. The
initial positions remain in the baseline for review. Cycles are compared
by their directed sequence with rotation normalized; reversing edges or
adding a different cycle fails.

The wrapper returns 0 for clean or exactly allowed results, 1 for new
findings, and 2 for an inconclusive scan. The shell quality gate accepts
only wrapper exit 0 and retains its existing nonzero failure exit otherwise.
It prints the accepted/new/retired counts, actual cycles and up to twenty
actionable new diagnostic locations. Full evidence is retained in:

```text
reports/latest/backend-ruff.{json,stderr.txt,version.txt,status.json,comparison.json}
reports/latest/frontend-madge-circular.{json,stderr.txt,version.txt,status.json,comparison.json}
```

The corresponding `.txt` files contain the concise comparison. CI uploads
these files and timestamped copies in its existing `quality-reports` artifact.

Madge retains the original scan scope and resolver options. Its graph
includes type imports and tests; it is not a proof of runtime reachability
or complete TypeScript module resolution. On the pinned source, its API
reports skipped specifiers `react-router`, `react-router/dom` and
`@/test-utils/translations`; the CLI's JSON cycle format does not expose
these resolver warnings. This change does not silently expand or narrow
the resolver policy. A separate resolver change needs its own graph
comparison and tests. A structurally valid scanner result still depends
on that scanner's documented analysis limits.

## Fixing findings and deliberately updating the baseline

1. Run `SKIP_BACKEND_TESTS=1 make quality` for the CI-equivalent source
   checks, or `make quality` to include the existing local backend report.
   Inspect the failing location/cycle and the comparison JSON. Fix new
   findings in the current change; do not regenerate the baseline to make
   a red check green.
2. When an accepted finding is fixed, the scan passes and lists it as
   retired. Remove that precise occurrence from the baseline in the same
   PR. Do not transfer its allowance to different source. Keep other
   occurrences and rationales unchanged.
3. A newly accepted debt item requires an explicit, specific rationale and
   a reviewed PR. Copy only its normalized record from `comparison.json`
   into the baseline, add its rationale, and explain the changed counts
   and source commit in the PR. This is a deliberate policy change, not
   an automatic scanner recovery step. Never add broad directory/rule ignores.
4. A tool upgrade changes its pinned/resolved dependency, the wrapper's
   supported version and baseline version together. Reproduce the output
   on a named commit, review the entire finding delta and rerun the parser
   and real-fixture tests. Do not accept an unfamiliar report format by
   coercing it into an empty result.

## Runtime measurement

One warm local pair, using the same checkout/dependencies and
`SKIP_BACKEND_TESTS=1`, measured the complete quality script at **42.744 s
before** and **43.032 s after** (+0.288 s, about 0.7%). Both runs completed
successfully; the old run indiscriminately accepted both scanner exit codes
1, while the new run reported exactly 1,605 accepted Ruff diagnostics and
one accepted cycle, zero new/retired findings. The new scan status reports
recorded 0.389 s for PDM/Ruff and 4.738 s for Madge, excluding version probes.
This single local pair is not a CI speed benchmark; runner variance and
dependency installation remain separate. The temporary-fixture regression
suite took 2.8 s locally and does not rescan repository sources.
