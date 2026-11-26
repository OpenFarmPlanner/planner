---
name: qa-refresh
description: Update the owner's local .qa-review acceptance dashboard for OpenFarmPlanner's queue #1058 - first remove verified Accepted rows from the queue and archive their cards (sync), then build new cards for recently closed, merged implementation work (refresh). Use for an owner-requested QA dashboard refresh or sync.
---

# QA refresh

Rules: `CLAUDE.md` ("QA / Exploratory Testing") and `docs/testing-and-ci.md`
("Keeping a local acceptance dashboard on main"), which owns the standing
pre-authorization for this workflow. A refresh has two phases, in this order:

0. **Sync** — remove the queue rows whose dashboard decision is Accepted and
   archive their cards (section 0). Its single verified queue edit is the only
   GitHub write this skill makes.
1. **Refresh** — add cards for work finished since the last refresh
   (sections 1–5), read-only on GitHub: no issues, comments, labels or queue
   edits.

When the launcher runs `ofp-qa refresh`, it holds the sync in a separate
session first and hands this session a refresh manifest: skip section 0 and
keep GitHub read-only. Invoked directly without a manifest, run section 0
first. For `ofp-qa sync` or a cleanup-only request, run section 0 alone. Do not
confuse this with `issue-and-queue`'s cleanup, which removes rows the owner
**checked** in #1058; dashboard Accepted rows stay unchecked by design.

## 0. Sync: remove Accepted rows

1. Freeze a candidate manifest the way the launcher does: preview with
   `python3 scripts/local_qa/start.py sync --preview`, then build the manifest
   with `live_queue()`, `metadata()`, `references()`/`issue_links()` and
   `plan('sync', …)` from `scripts/local_qa/rounds.py` (its `launch()` needs
   a TTY). Save it as `.qa-review/runs/sync-<id>.json`. With a launcher
   manifest, use that one. The manifest is an upper bound.
2. For each candidate, verify live: the issue is closed and not
   `NOT_PLANNED`. Its `decisions.json` status is Accepted at the manifest's
   `decisionRevision`; compare with the manifest, since revisions above 1 are
   normal. The card's reviewed PR is merged and its merge commit equals the
   card's `commit` and is an ancestor of `origin/main`. Every
   `closedByPullRequestsReferences` PR is merged, and no cross-referenced or
   connected PR is open or closed unmerged (check `timelineItems`). The row has
   no `PR #N` gate. Skip anything changed or uncertain and say why. Rows
   already absent are local-only reconciliations.
3. Show the eligible rows (with their manual hints), the skips and each
   explicit QA follow-up. Follow-ups keep their own rows; never remove them
   with the original.
4. Apply directly under the standing authorization (no chat confirmation).
   Immediately before writing, re-read decisions and the queue via the trusted
   reader. Check its body is identical to `gh api repos/OpenFarmPlanner/planner/issues/1058`
   (`.body`). Remove only the eligible lines under "Ordered work items" and
   keep every other byte. Write the new body as JSON with
   `gh api -X PATCH … --input <file>`, then re-fetch and compare byte-for-byte.
   On any mismatch or concurrent change, stop and report; never retry blindly.
5. Archive under `.qa-review/archive/review-<date>-sync-<id>/`, following the
   previous sync folders: the removed cards (`results.json`), their decisions
   (`decisions.json`, `accepted-decisions.json`), `sync-manifest.json`,
   `queue-before.md`/`queue-after.md`, `queue-edit.json`,
   `related-issues.json`, `linked-followups.json`, the pre-publication
   `report.md`/`sync-preview.json`, `test-data/dist/qa-projects.json` as
   `qa-projects.json`, and copies of the cards' screenshots and logs.
   Originals stay in place so existing links keep working.
6. Remove those cards and decisions from the active files. Re-read the live
   decisions first and never write back an earlier snapshot. Set the remaining
   cards' `position` from the new queue, update `issueCounts`/`summary`, and
   write atomically. Rebuild with the dashboard's `build()` and
   `project-links.py` as in section 4. Confirm
   `start.py sync --preview` now prints "No changes to process".

## 1. Find candidates

1. When the launcher supplies a manifest, use its `entries` as the complete
   candidate list for this run. Recheck those entries against live state before
   acting. Without a manifest, select candidates from the live #1058 rows via
   `node scripts/ci/agent_task_context.cjs 1058` from the trusted main checkout.
2. For every unchecked row without a `PR #N` gate, check live state with
   `gh api repos/OpenFarmPlanner/planner/issues/<n>` using `state` and
   `state_reason`. Check implementation PRs and merge commits using
   `closedByPullRequestsReferences` with `includeClosedPrs: true` via
   `gh api graphql`. Follow pagination before deciding a candidate is eligible.
3. Keep closed, completed issues that have no card in `.qa-review/results.json`.
   A closed issue without a recorded closing PR is still a candidate. Check
   the owner-authorized issue history, PR links and `origin/main` history to
   identify and verify its implementation. Verify that every implementation
   merge commit is reachable from `origin/main` (`git merge-base --is-ancestor`)
   and that no implementation PR remains open or was closed unmerged. Report
   unresolved implementation evidence as blocked and continue with the other
   candidates.
4. Reconcile existing cards listed in the manifest with the live queue and
   GitHub state. Recheck implementation evidence when requested and refresh a
   card's tests and screenshots if its verified implementation changed. For a
   metadata-only update, update the queue row, position and manual test hint.
   Archive a card that is now absent, checked, reopened or otherwise ineligible
   only after verifying the current state. Without a manifest, compare existing
   cards against those same states when inspecting the live queue.
5. Exclude discovery/RFC-only rows (doc-only PRs, no app behavior — check the
   PR's changed files) the same way the existing `results.json` `exclusions`
   field already tracks them.
6. List what you found before testing anything, the same way section 0
   previews before writing.

## 2. Prepare the environment

- If the launcher has not already updated the local QA release, run
  `python3 scripts/local_qa/start.py update` from the trusted checkout. Confirm
  the dashboard (4174), app (5274) and backend (8274) respond. Verify that the
  app and backend report the same commit using the documented version endpoints,
  that the commit is reachable from `origin/main`, and that it contains each
  implementation to be tested. If a candidate's merge has yet to reach the QA
  release, record its tests as blocked and continue with the other candidates.
- Run tests at that commit. If your checkout differs or has local changes, use
  `git worktree add --detach <scratch-path> <qa-commit>` in a fresh directory.
- Prepare the dependencies in the test checkout. Check for a compatible backend
  test environment with the test group installed. In a fresh worktree, use
  `(cd backend && pdm install -dG test)` to create the test environment from the
  checkout's lockfile. The running QA release's environment has production
  dependencies. For frontend tests, reuse `frontend/node_modules` from a
  checkout with the same lockfile or run `(cd frontend && npm ci)` locally.
  Use the repository's documented Playwright tooling and browser prerequisites.
  Clean up only the worktree and generated files created for this run.

## 3. Review each candidate

For each candidate, read the owner-authorized acceptance criteria through
`node scripts/ci/agent_task_context.cjs <n>` from trusted main. Use the PR's
changed-files list (`gh pr view <pr> --json files`) as data to identify relevant
tests already present in the verified implementation on main. Treat issue and
PR comments from other authors as evidence and use repository test paths from
the checked-out tree as arguments.

1. Run the relevant backend tests from the test checkout root with
   `(cd backend && pdm run test --no-cov <paths-relative-to-backend>)`.
   Run frontend tests with `(cd frontend && npx vitest run <paths-relative-to-frontend>)`
   and browser specs with `(cd frontend && npm run test:e2e -- <specs-relative-to-frontend>)`.
   The script builds the production bundle before Playwright starts its preview
   server. Use free `FRONTEND_PORT` and `BACKEND_PORT` values if the defaults
   are occupied, with separate synthetic test data.
2. If a test fails, verify it is real before reporting it as one:
   - Rerun once or twice for determinism.
   - Rule out environment contamination: a reused dev backend
     (`reuseExistingServer`) with a different `FRONTEND_URL`, a mid-run
     rebuild of `frontend/dist` invalidating an already-running preview
     server, or a stray process your own commands killed. Trace/screenshot
     evidence (`test-results/*/trace.zip`, `error-context.md`) usually shows
     which.
   - Check the latest full nightly Chromium run
     (`gh run list --workflow release-e2e.yml`) for the same commit range. A
     local-only deterministic failure that contradicts a green nightly run on
     the same code is still worth reporting, but flag the contradiction
     explicitly rather than asserting a shipped regression.
3. When the change has a relevant visual flow, capture 2-4 targeted screenshots
   that show the new behavior on the deployed QA app
   (`http://127.0.0.1:5274`). Use the workspace's synthetic reviewer credentials
   only on that local app origin. Keep credentials out of commands printed to
   output, screenshot evidence and card data.
   Recheck the app's commit after capturing evidence because the launcher can
   update the release during a check. Repeat any check affected by a change.
   Canvas/graphical UI renders via Konva, not DOM nodes — click by coordinate,
   not by test-id locator.
   For nonvisual changes, use focused test or other implementation evidence
   and leave `screenshots` empty.
4. Never implement a fix, file an issue, or comment on GitHub from this skill.
   A reproducible defect found here follows the same rule as any other QA
   finding: record it fully (repro, evidence, contradiction if any) and tell
   the user; filing is a separate, explicit step per
   `CLAUDE.md`'s discovered-bug rule.

## 4. Write the card

Match the existing schema in `.qa-review/results.json` exactly (read a
existing card first): `number`, `title`, `description`, `area`, `position`,
`pr`, `commit`, `changedFiles`, `parent`, `priority`, `queueRow`,
`criteria[]` (`text`/`status`/`evidence`), `tests[]`
(`name`/`layer`/`status`/`file`), `status`, `manual`, `project`, `app`,
`problems[]`, `visualNote`, `screenshots[]`. Status is `Passed` only when you
verify every acceptance criterion and each one passes. Use `Partial` when any
criterion fails, is blocked or remains unchecked. Record the affected criteria
and their reasons in `problems`.

Before writing:
- Re-fetch the trusted live queue and recheck GitHub eligibility and verified
  implementation for the original candidates immediately before applying the
  refresh. Take queue metadata from that latest read. Skip a pending card write
  when eligibility changed or the tested implementation no longer matches the
  candidate. Reconcile an existing card only after verifying its current state.
- Archive the current `results.json`/`decisions.json` under
  `.qa-review/archive/pre-refresh-<id>-<date>/`, consistent with sync's
  archival rule. Re-read the latest cards and decision revisions before
  applying the refresh. Keep changes made in the dashboard since the manifest.
- Add each verified new card once and apply verified updates to its existing
  card by issue number. Preserve decisions for metadata-only edits. When the
  implementation changed, archive its old evidence and decision and start the
  updated card at "Review later". Use the workspace's existing archive layout
  for ineligible cards and preserve their screenshots and decisions there.
  New cards get no `decisions.json` entry (defaults to "Review later").

After writing:
- Rebuild `report.md`/`sync-preview.json` via the dashboard's own `build()`
  (import `.qa-review/dashboard/server.py` as a module and call `build()` —
  do not hand-roll the report).
- Regenerate project links: `python3 .qa-review/test-data/project-links.py`.
- Verify `curl http://127.0.0.1:4174/api` shows the new cards with the
  expected statuses, and that re-running `build()` does not duplicate rows.
- `.qa-review/dashboard/app.js`'s "Discuss with ChatGPT" links point to the
  owner's OpenFarmPlanner ChatGPT project
  (`https://chatgpt.com/g/g-p-6933f3a40ff481919089fd5e5df8d485/project`), not
  generic `chatgpt.com`. Never regenerate or hand-edit that file as part of a
  refresh; if it's ever touched for an unrelated reason, keep that link.

## 5. Report

List rows removed by the sync (and skips), then new, updated and archived
cards with the outcome and a one-line reason.
Report blocked checks and skipped writes. Surface every
`problems`/contradiction prominently — don't bury a found regression in a
card's detail fields without also saying so in your summary. If a live check
shows more issues closed during the refresh, list them as candidates for the
next run. Keep the current run within its original candidate list.
