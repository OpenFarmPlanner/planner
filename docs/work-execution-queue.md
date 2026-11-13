# Work execution queue and native epic links

GitHub issue [#1058](https://github.com/OpenFarmPlanner/planner/issues/1058)
is the sole execution-order source for any coding agent or human. Move its
checkbox rows under **Ordered work items** to reorder work. Priority labels
indicate urgency, not order. Keep the queue issue open.

Use `- [ ] #123` for an implementation issue and `- [ ] PR #456` for a review
and merge gate. Completed checkboxes are advisory: live GitHub state decides
whether work remains. Open PR entries must be resolved before later work;
merged PRs are skipped. A PR closed without merging stops reconciliation until
a maintainer resolves or removes that entry. Missing entries, wrong types,
duplicates and malformed rows also fail before labels change.

Closed implementation issues and issues labeled `blocked` or `needs-decision`
are skipped. An open PR remains a gate even with those labels. Before starting
an issue, look for an existing implementation PR. Work on one item at a time
and finish independent review and merge before starting the next one. The owner
authorized the commissioned worker to implement, fix findings, merge after
required checks and verified independent review pass, and continue without
routine maintainer confirmation. Labels alone never start another agent. This
excludes production deploys, paid AI API calls and signing trust-policy changes.

## Subscription host worker

`scripts/ci/work_queue_worker.cjs` controls the authorized host. The sibling ops
repository's `scripts/install_work_queue.sh` installs its user service/timer and
a separate trusted checkout pinned to an explicitly reviewed, merged revision.
The installer requires `--revision REVIEWED_MERGED_SHA`; it never automatically
updates its privileged controller code from main. It uses the host's ChatGPT Codex
login, GitHub/SSH access and protected review key, without paid API jobs.

Each tick reloads the live ordered queue. Existing PRs linked through GitHub's
closing-issue references are adopted before starting an implementation. New
implementations run in separate clones with no signing-key, controller-state,
trusted-checkout or host-credential filesystem access. Shell networking uses an
active proxy allowing only npm/PyPI registries, with local/private services and
local binding forbidden. Unit/static checks run there; UI/E2E and database-service
checks run in isolated GitHub CI. The host publishes their
clean commits as draft PRs. The existing restricted launcher produces a fresh
independent signed review. Findings and branch/test failures return to bounded
implementation sessions. Verified exact-head/base/scope evidence allows the
controller to make the PR ready, refresh the review gate and wait for required
CI checks, resolved threads and mergeability before a SHA-bound squash merge.
The next timer tick continues with the live queue; routine human sign-off is
not needed. GitHub rules and the review verifier remain binding.

Cloud/manual implementers claim the issue with `queue:active` before coding and
open a same-repository PR containing `Fixes #<issue>`. The host waits for that PR,
then handles review and merge. This advisory claim is not a distributed atomic
lock: never commission multiple implementers for one item. Host ticks use flock
to prevent local overlap, including across restarts.

Config is the mode-0600 `~/.config/openfarmplanner/work-queue.json`:

```json
{
  "enabled": true,
  "state_directory": "/home/USER/.local/state/openfarmplanner/work-queue",
  "signing_key": "/home/USER/.config/openfarmplanner/codex-review-key.pem"
}
```

Keep config, logs and author clones outside repositories. Inspect selection
without writes or model calls with
`node scripts/ci/work_queue_worker.cjs CONFIG.json --dry-run`. Attempts are
persisted before model execution: one review per head/base, at most three author
attempts per queue item including repairs. A crash does not reset budgets.
Inspect `last-error.txt` and JSONL/stderr logs before deliberately resetting
an item's counters in state.json. Task text and review/CI output are untrusted
data. PR code runs only in the author sandbox, never on the signing host.

Inspect with `systemctl --user status ofp-work-queue.timer` and
`journalctl --user -u ofp-work-queue.service`. Stop future ticks with
`systemctl --user disable --now ofp-work-queue.timer`; stop an active tick with
`systemctl --user stop ofp-work-queue.service`.

The host and user manager must be running; sleep/offline pauses work.
Subscription exhaustion, missing credentials, incomplete review and unresolved
checks remain real blockers, never fabricated approvals. This worker does not
claim to start or resume hosted Cloud tasks. The marker workflow stays label-only.

## Advisory marker and triggers

`.github/workflows/work-queue.yml` reads the queue and puts `queue:next` on its
first eligible issue or PR, removing obsolete markers even from closed items.
It also retires the former `codex:next` markers. Marker changes do not trigger
another reconciliation.

The workflow runs for queue edits, changes to `blocked`/`needs-decision`,
trusted issue close/reopen events and trusted PR close/reopen events. A trusted
item is authored by an owner, member or collaborator. Merged fork PRs also
refresh the queue. Untrusted state events are filtered before runner allocation.
Refresh manually after closing/reopening an externally authored issue or
closing an unmerged externally authored PR in the queue:

```bash
gh workflow run work-queue.yml --ref main
```

The former `codex-queue.yml` manual dispatch remains as a deprecated wrapper
around the same implementation. It can be removed after existing commands and
bookmarks migrate. There is no second ordering source or marker implementation.

No PR code is checked out or executed. The workflow uses only GitHub's token
with issue-write and pull-request-read permissions. Eligible reconciliation
jobs share a concurrency group so marker updates do not overlap.

## Native epic hierarchy

`.github/workflows/issue-parent-link.yml` links trusted issues declaring
`Parent epic: #123` (also accepted in bold) to GitHub's native parent/sub-issue
hierarchy on issue creation or editing. The live child must be authored by an
owner, member or collaborator; PRs and untrusted children are skipped even on
manual dispatch. The parent must be a different issue titled `Epic: ...`.
An existing matching parent is a no-op; a different parent fails without
replacement. Calls explicitly refuse replacement if the parent changes during
execution. Jobs for the same child are serialized.

Backfill an existing declaration with:

```bash
gh workflow run issue-parent-link.yml --ref main -f issue_number=1063
```

The workflow uses GitHub's sub-issue REST API and the child's global issue ID.
It needs issue-write permission and never runs code from an issue body.
Changing an existing parent requires a deliberate manual hierarchy change.

## Cost controls

These workflows make no model requests and do not launch coding agents. They
work independently of Claude or Codex allowance. Use an approved signed-in
subscription workflow when starting agent work; do not introduce paid AI API
keys. GitHub Actions usage is governed separately by repository billing.

The former API-billed `codex-autofix.yml` remains disabled and its job has a
false condition. Re-enabling it requires an explicit owner decision.

## Validation

`node --test tests/test_codex_queue.cjs tests/test_work_queue_worker.cjs` checks ordering, PR gates, malformed
input, marker migration, trigger admission and safe/idempotent epic linking
without GitHub writes. The existing test filename is retained for CI callers.
After merging, dispatch the queue and confirm only its first eligible item has
`queue:next`. Dispatch the parent workflow for an existing declared child and
verify its native parent. A GitHub Project may visualize the queue but must not
introduce a competing order.
