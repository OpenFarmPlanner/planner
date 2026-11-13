---
name: security-review-protocol
description: Perform a security review of this repository the way Claude and Codex share it (full sweep, targeted boundary review, or the security part of a PR) and report the result where the other tool can find it. Use for any security review, audit or security-relevant PR check in this repo.
---

# Security review (shared with Codex)

The protocol is binding and lives in `CLAUDE.md` ("Security Review Protocol");
this skill is the order of work. The built-in `/security-review` command only
reviews a diff; it does not do the bookkeeping below.

## 1. Prior state

```bash
gh issue list --label security --state open
gh pr list --state all --search "security in:comments" --limit 20
ls docs/security-review-*.md
```

- Read "Security decisions" in `docs/security-automation.md` (accepted risks
  and deliberate exceptions are not findings).
- Read the frozen `docs/security-review-log.md` for older context: an OPEN
  finding there without an issue is still open. Never write to it.
- Find who last reviewed this scope. Codex → independent cross-review, derive
  findings from the code yourself. Claude with no change since → verify prior
  findings still hold. Never covered → review it and say so.

## 2. Review

If Claude's allowance is exhausted or cloud review is unavailable, follow
`docs/security-automation.md` ("Local review when Claude has no allowance"):
prepare a pinned bundle with `scripts/ci/local_security_review.py` and give it
to a fresh local reviewer session or an independent human. Validate and inspect
the result before posting it. A human maintainer must explicitly approve the
exact-head report; starting the review is not permission to approve it. This
is the manual review route, not a completed native cloud scan.

Note the exact commit: `git rev-parse HEAD`. Focus on tenancy (project
scoping, `X-Project-Id`), permissions on every view/viewset action, auth and
API tokens, trust levels and moderation, personal data, Channels consumers,
settings, workflows and Docker, and risky patterns (`.raw(`, `csrf_exempt`,
`dangerouslySetInnerHTML`). For every candidate, trace a concrete exploit
path before calling it a finding.

## 3. Close what is fixed

For each open `security` issue in scope that the code now fixes:
`gh issue close <n> --comment "Fixed in <commit or PR>"`.

## 4. Report (never a log file on the branch)

- **PR review**: one PR comment with the reviewed SHA, the scope (changed
  files) and the result, "No issues" included. Findings as inline comments,
  otherwise `path:line` in that comment.
- **Unfixed findings**: one GitHub issue each, label `security`.
- **Durable decisions** (accepted risk, deliberate exception): add to
  "Security decisions" in `docs/security-automation.md`.
- **Full sweep**: narrative in a new `docs/security-review-YYYY-MM-DD.md`.

Posting comments and issues is outward-facing: show the user the text first
unless they asked you to post it.
