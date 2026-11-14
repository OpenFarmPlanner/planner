---
name: security-review-protocol
description: Perform a security review of this repository the way Claude and Codex share it (full sweep, targeted boundary review, or the security part of a PR) and report the result where the other tool can find it. Use for any security review, audit or security-relevant PR check in this repo.
---

# Security review (shared with Codex)

The protocol is binding and lives in `CLAUDE.md` ("Security Review Protocol");
this skill is the order of work. Where a client provides a built-in
`/security-review` command, it does not replace the bookkeeping below. Prefer connected GitHub tools; use the `gh`
examples only with an available authenticated CLI.

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
`docs/security-automation.md` ("Verified local Codex completion without per-PR approval"):
run `node scripts/ci/run_codex_review.cjs PR_NUMBER /tmp/review-PR_NUMBER`
from a trusted checkout matching the PR base. It starts a fresh independent
Codex session and signs validated execution evidence outside the reviewer's
filesystem. Publish `signed-report.md` on that PR and rerun failed CI jobs
together. A valid clean signed result satisfies the gate automatically: do not
ask for per-PR human approval. Findings, missing coverage, failed execution,
expired signatures or mismatched head/base/scope remain blocked. This is a
verified local AI-assisted review, not a native cloud scan.

Follow the execution mode and independent review handoff in
`docs/work-execution-queue.md`. A commissioned subscription worker can use an
already configured constrained review service; the optional API controller
is a separate mode and must not be enabled merely to obtain a review. Missing
keys in Cloud do not require routine per-PR sign-off when that route works.
The service permits only the fixed review workflow, not author shell or
key/checkout access. Publish emitted signed incomplete reports as well as clean
ones and refresh the gate, so newer findings supersede stale approvals. Only
verified clean evidence
satisfies the gate. If providers and the constrained service are unavailable,
report the actual
infrastructure blocker. Skill files do not provision a host, key or credentials.
Never weaken trust policy or manufacture approval to keep the queue moving.

If the trusted launcher is unavailable or no model budget remains, prepare a
bundle with `scripts/ci/local_security_review.py` for an independent human.
Unsigned/manual reports still need explicit exact-head maintainer approval.
Installing or changing the trusted signing policy needs one deliberate human
approval under the existing base policy; agents must not self-certify it.

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

For a commissioned queue PR, publishing findings and completion evidence is
covered by the standing authorization in `CLAUDE.md`; do not ask for routine
per-PR confirmation. Otherwise post only within the user-authorized scope.
