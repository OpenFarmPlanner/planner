---
name: qa-refresh
description: Build new QA dashboard cards for recently closed, merged implementation work on OpenFarmPlanner's queue #1058, using the owner's local .qa-review dashboard. Use when asked to "run the refresh part", "refresh the QA dashboard", or after an `issue-and-queue` sync when newly merged queue rows need review cards.
---

# QA refresh

Rules: `CLAUDE.md` ("QA / Exploratory Testing") and `docs/testing-and-ci.md`
("Keeping a local acceptance dashboard on main"), which owns the standing
pre-authorization for this workflow. This skill is read-only on GitHub: no
issues, comments, labels or queue edits. Queue cleanup (removing Accepted
rows) is the separate `issue-and-queue` skill's `sync` half; this is the other
half — adding cards for work finished since the last refresh.

## 1. Find candidates

1. Fetch live queue #1058 rows via `node scripts/ci/agent_task_context.cjs 1058`.
2. For every unchecked row without a `PR #N` gate, check live state with
   `gh issue view <n> --json state` and, if closed,
   `closedByPullRequestsReferences` via `gh api graphql` for its merged PR(s)
   and merge commit(s).
3. A candidate is: closed, exactly one merged implementation PR (or all linked
   PRs merged), commit is an ancestor of `origin/main`
   (`git merge-base --is-ancestor`), and the issue number is not already in
   `.qa-review/results.json`'s `issues`.
4. Exclude discovery/RFC-only rows (doc-only PRs, no app behavior — check the
   PR's changed files) the same way the existing `results.json` `exclusions`
   field already tracks them.
5. List what you found before testing anything, the same way the sync skill
   previews before writing.

## 2. Prepare the environment

- Update the local QA release to current `origin/main`:
  `python3 scripts/local_qa/start.py update`. Confirm all three services
  (dashboard 4174, app 5274, backend 8274) respond after it finishes.
- If your own checkout is behind `origin/main` (common mid-session, since the
  queue can advance while you work), add a throwaway worktree at
  `origin/main` for running tests rather than switching your working branch:
  `git worktree add <scratch-path> origin/main`, symlink
  `frontend/node_modules` into it to avoid a second `npm install`, and
  `git worktree remove --force` it when done.

## 3. Review each candidate

For each candidate, using its issue body's acceptance criteria and its PR's
changed-files list (`gh pr view <pr> --json files`):

1. Run the PR's own existing backend/frontend unit tests
   (`pdm run test <paths> --no-cov`, `npx vitest run <paths>`) and its e2e
   specs (`npx playwright test <specs>`, which manages its own prod-preview
   webserver).
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
3. Capture 2-4 targeted screenshots (not a full responsive matrix) that show
   the issue's specific new behavior, against the deployed QA app
   (`http://127.0.0.1:5274`, credentials in `.qa-review/test-data/reviewer.json`).
   Canvas/graphical UI renders via Konva, not DOM nodes — click by coordinate,
   not by test-id locator.
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
`problems[]`, `visualNote`, `screenshots[]`. Status is `Passed` only when
every acceptance criterion you checked passed; otherwise `Partial`, with the
failing criterion and a `problems` entry explaining why.

Before writing:
- Archive the current `results.json`/`decisions.json` under
  `.qa-review/archive/pre-refresh-<id>-<date>/` (new cards only add rows; this
  preserves the pre-refresh snapshot, consistent with sync's archival rule).
- Append to the existing `issues` array; never overwrite other cards. New
  cards get no `decisions.json` entry (defaults to "Review later").

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

List each new card with its status and a one-line reason. Surface every
`problems`/contradiction prominently — don't bury a found regression in a
card's detail fields without also saying so in your summary. If the queue
advanced again while you were reviewing (check again before finishing), treat
the newly closed rows as more candidates in the same pass rather than a
separate run, and say so in the report.
