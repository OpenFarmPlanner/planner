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
and wait for review and merge before starting the next one. The queue and its
labels do not authorize implementation by themselves.

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

`node --test tests/test_codex_queue.cjs` checks ordering, PR gates, malformed
input, marker migration, trigger admission and safe/idempotent epic linking
without GitHub writes. The existing test filename is retained for CI callers.
After merging, dispatch the queue and confirm only its first eligible item has
`queue:next`. Dispatch the parent workflow for an existing declared child and
verify its native parent. A GitHub Project may visualize the queue but must not
introduce a competing order.
