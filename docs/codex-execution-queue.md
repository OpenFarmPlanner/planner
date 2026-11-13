# Codex issue execution queue (no paid AI API)

The editable queue is GitHub issue [#1058](https://github.com/OpenFarmPlanner/planner/issues/1058).
The order of the checkbox list under **Ordered implementation issues** determines which implementation issue comes next. Move items up or down to reorder work. Priority labels P0-P3 indicate urgency, not execution order.

## Automatic next-issue marker

The GitHub workflow at .github/workflows/codex-queue.yml uses GitHub Actions and GitHub's own GITHUB_TOKEN only (no external AI API). It reads #1058 and adds the codex:next label to the first open, unblocked issue in that list, removing the label from the previous one.

The action runs when an issue closes/reopens, #1058 is edited, or the `blocked`
or `needs-decision` label is added or removed. Changes to `codex:next` do not
trigger another marker job. It can also be triggered manually via Actions >
Mark next Codex issue (no AI API) > Run workflow.

Issues labeled blocked or needs-decision are skipped, as are already closed issues. Unlisted issues are never selected automatically. Keep #1058 open.

## Starting and continuing Codex

The label **does not launch Codex Cloud**. Start a Codex Cloud task signed into ChatGPT (not via an API key), and tell it to read #1058, implement the first eligible issue, run relevant checks, and open a PR with "Fixes #<issue number>" so the linked issue closes when merged. Wait for review/merge before beginning the next issue.

Suggested prompt:

    Use GitHub issue #1058 as the authoritative execution queue.
    Work on the first open, unblocked implementation issue in the ordered list.
    Before starting, check for an existing implementation PR.
    Follow AGENTS.md and CLAUDE.md, implement and test the change, then commit,
    push, and open a PR containing "Fixes #<issue number>".
    Work on one implementation issue at a time; wait for the PR to merge before
    selecting another issue. Report blockers rather than guessing decisions.
    Use ChatGPT/Codex signed-in plan allowances. Do not use an AI API key.

## Cost controls

The separate codex-autofix.yml workflow previously invoked openai/codex-action with OPENAI_API_KEY after CI failures. It is intentionally disabled, because API-key model usage can be billed separately. Re-enabling it requires an explicit owner decision.

The queue marker makes no model requests and therefore creates no AI model API
charges. GitHub Actions runner usage is governed separately by the repository's
billing settings and plan.

## Validation

Run `node --test tests/test_codex_queue.cjs` to check ordering, skipped entries,
duplicate rejection, label updates and trigger filtering without GitHub writes.
After merging, manually dispatch the marker once and verify that only the first
eligible issue in #1058 has the `codex:next` label.

## GitHub Projects (optional visual view)

A GitHub Project can be added as a visual dashboard. Do not create a second, competing ordering source unless the queue marker is migrated to read the project field. For now, issue #1058 is the sole execution-order source.
