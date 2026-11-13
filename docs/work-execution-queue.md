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
excludes production deploys and unreviewed signing trust-policy changes. The owner
authorized small, bounded API costs on 2026-11-13 and requested cloud-only operation.

## Cloud worker

`.github/workflows/cloud-work-queue.yml` runs on GitHub-hosted Ubuntu, every ten
minutes or by manual dispatch. It always checks out trusted `main`, never a PR
revision, and has one shared concurrency group with cancellation disabled.
Enable with repository variable `CLOUD_WORK_QUEUE_ENABLED=true`; set it to false
to pause future runs. Cancel an active run separately. No laptop or local daemon
is needed. GitHub schedules may be delayed; the queue is not a real-time service.

`scripts/ci/cloud_work_queue.cjs` starts a restricted API proxy and the existing
`scripts/ci/work_queue_worker.cjs` controller. Each run performs one transition:
implement/repair, independently review, refresh CI, wait, or merge. The next run
reloads the live queue. Cloud-authored PRs are adopted through closing-issue
references. An external implementation claims its issue with `queue:active`;
never commission two implementers for the same issue.

The controller authors changes in an isolated clone, with read-only Git metadata,
no inherited GitHub/API credentials and no filesystem grants to the key, state or
trusted checkout. Shell networking allows npm/PyPI registries only. The controller
validates and commits the edited tree with hooks disabled, pushes over HTTPS and
opens a draft PR. Findings and failed checks return to bounded author sessions.
A fresh independent read-only Codex session inspects the entire changed scope.
The existing trusted launcher signs its validated exact-head/base result after
that session exits. Existing signature verification remains binding; there are
no new signers, unsigned approvals, or author self-certification.

A clean receipt lets the controller mark the PR ready, refresh the security gate,
and wait for every app-bound required check and review thread. Merge requires
strict up-to-date branch protection and the exact reviewed head. Conflicts,
failed checks, unsupported discussions, incomplete scans and stale evidence block
merging. An outdated CodeQL-only thread is resolved only with exact current
scanner evidence, as enforced by the existing controller.

### Credentials and durable state

Repository secrets: `OPENAI_API_KEY`, `RELEASE_PAT` and
`CLOUD_QUEUE_SIGNING_KEY` (the existing trusted Ed25519 key, not a new identity).
The PAT must read/write planner contents, issues, PRs and Actions, and write
contents in private `OpenFarmPlanner/ops`. A PAT is required because writes with
`GITHUB_TOKEN` do not start ordinary PR CI. No credential is persisted in Git
checkout configuration. The API key exists only in the proxy process; the
signing key is a mode-0600 runner temporary file outside all model grants.
The trusted main workflow and runner become the signing-host trust boundary.
Never run untrusted scripts in that host process or upload its temporary files.

State lives on private ops branch `cloud-work-queue-state`, in
`.queue/state.json` (attempts/claims) and `.queue/budget.json` (spending ledger).
Initialize both to `{}` deliberately before first activation. The controller
loads these files on every run. Missing/corrupt state and failed persistence stop
work. Every attempt and cost reservation is remotely committed before starting
model work, so cancellation and runner replacement cannot reset limits.
There is no shared PR-writable Actions cache. GitHub API SHA preconditions reject
concurrent state replacement. The legacy local worker must remain disabled while
the cloud worker owns the queue.

### Cost limits

Only `gpt-5.4-mini` at standard tier is allowed through the proxy. Hosted billable
tools, hidden conversation state and other endpoints are refused. Each request
is counted with the input-token API, capped at 8,192 output tokens, and reserved
at uncached list prices ($0.75/$4.50 per million input/output tokens). Before the
next request, a complete provider usage report replaces that reservation with
the reported input/output cost, including cached inputs at $0.075/million.
Only validated standard-tier usage from the configured model can release unused
reservation. Failed/incomplete streams, missing or invalid usage, disconnected
clients and failed durable write-back keep the full reservation. A crash cannot
erase a charge. Requests wait for prior reconciliation before spending again.
The limits remain **$1 per run, $2 per UTC day and $10 per UTC month** in accounted
model-token costs plus pending reservations. These are internal queue counters,
not a readout of the API account balance or a final provider invoice. Historical
reservations without saved usage remain conservative. Price changes require
reviewing the proxy's rates; GitHub Actions billing is separate.
See [model pricing](https://developers.openai.com/api/docs/models/gpt-5.4-mini).

The existing three author attempts per issue and one review per head/base also
remain persistent. Exhaustion is a visible failure, never a reason to accept an
incomplete implementation or unreviewed PR. Inspect the workflow logs and private
state before deliberately resetting a counter. Local subscription CLI execution
remains available for manual recovery, but its ops timer is not installed or
required for this cloud workflow.

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

The advisory marker and epic-link workflows make no model requests. The separate
cloud worker uses the bounded API route above; it does not consume the ChatGPT
subscription allowance. GitHub Actions usage is billed separately.

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
