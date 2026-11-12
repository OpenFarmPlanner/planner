# Automated security checks

OpenFarmPlanner uses several complementary automated checks. They are kept
separate because each check answers a different security question.

| Check | Trigger | Purpose |
|---|---|---|
| `pip-audit` and `npm audit` | Pull requests, pushes to `main`, weekly, manual | Find known vulnerabilities in the complete locked backend and frontend dependency sets. High and critical npm findings fail the workflow. |
| Dependency Review | Pull requests to `main` | Prevent a pull request from introducing a dependency with a known high or critical vulnerability. |
| CodeQL | Pull requests, pushes to `main`, weekly, manual | Scan Python and JavaScript/TypeScript source for security-relevant data-flow and coding defects. |
| Django deployment checks | The backend CI job | Fail CI when Django reports a deployment security warning for the production-like CI configuration. |
| Dependabot | Weekly | Propose updates for Python, npm, and GitHub Actions dependencies. |

The scheduled dependency and CodeQL scans are intentional: a vulnerability can
be disclosed after an unchanged commit has passed its pull-request checks.

### An unreachable advisory endpoint is not a finding

`npm audit` exits 1 both when it finds something and when it cannot reach
registry.npmjs.org, so the two have to be told apart by what it printed.
Until 2026-09-04 the workflow did not, and a 503 from the advisories
endpoint turned every push to `main` red under the headline "npm audit
found High/Critical vulnerabilities" — while `npm ci` in the same job had
just reported 0 vulnerabilities.

The step now retries up to three times on a transport error only (a real
finding still fails on the first attempt, without waiting), and if the
endpoint stays unreachable it emits a `::warning` and exits 0. That is
deliberately an inconclusive scan rather than a red build: no advisory data
came back, so there is nothing for a contributor to act on, and the weekly
`schedule` re-scans the unchanged lockfile. A High or Critical finding
still fails the workflow exactly as before.

`pip-audit` has the same shape of exit code and has not been given the same
treatment, because it has not been observed failing this way. If it starts
to, fix it the same way rather than pinning or skipping the scan.

## GitHub repository settings

Workflow files cannot enable repository-level GitHub security features. A
repository administrator should verify that these settings remain enabled:

- Dependabot alerts and Dependabot security updates;
- secret scanning and push protection;
- code scanning alerts; and
- branch protection or rulesets requiring the security checks used by the
  repository.

GitHub secret scanning is the primary automated secret detector. Do not put
real credentials in CI variables used only to validate configuration; the
Django deployment check deliberately uses an obvious, non-production value.

## Scope and review expectations

Routine checks are deterministic guardrails, not a replacement for review.
Authorization boundaries, project scoping, OAuth account linking, token flows,
and business-logic abuse cases require focused human or AI-assisted security
review. Read the "Security Review Protocol" section of
[`CLAUDE.md`](../CLAUDE.md#security-review-protocol) before starting one: each
review is documented in a PR comment with the reviewed commit SHA, unfixed
findings are tracked as `security` issues, and durable decisions go in
[Security decisions](#security-decisions) below. The former
[`security-review-log.md`](./security-review-log.md) is frozen history.
Conversely, an ordinary UI-only change normally needs no
additional backend-specific manual security procedure beyond the automated
required checks.

The `Claude PR Review` workflow (`.github/workflows/claude-pr.yml`) runs such
an AI-assisted security review automatically on pull requests whose paths or
added lines hit the security triage rules and fixes the findings on the PR
branch, one commit per finding. It writes no log file: a review without
findings commits nothing, so it neither changes the head SHA, re-triggers CI
nor conflicts with parallel PRs. Unfixed findings get an inline review
comment and a `security` issue, and the job ends with one PR comment stating
the reviewed commit SHA, the changed files and the result. Its trigger criteria and fix
rules are summarized in the "Automated Claude PR Review" section of
[`CLAUDE.md`](../CLAUDE.md#automated-claude-pr-review); the exact patterns
live in the workflow's triage step.

### Security review completion gate (#1045)

The isolated **security-review-completion** job evaluates review evidence on
PRs; the already-required **quality** job explicitly fails unless that job
passes. Quality uses `always()` so a failed dependency cannot merely skip the
required check. The evidence reader has no checkout and never runs PR code;
its runner and API-reading token are separate from PR-owned lint/tests. It loads `.github/scripts/security-review-completion.cjs` from the
immutable PR **base SHA**, with a read-only token. No new branch-protection
context replaces or weakens existing checks. Quality checkout does not persist
Git credentials, and its token has only contents-read permission.
Changes to workflow files still
need careful review: a named check is not a GitHub ruleset requiring an
immutable workflow. Repository administration remains an operator boundary.

Triage publishes a small JSON artifact containing the head, changed-file
scope, PR number, run/attempt, decision and execution guards. Triage reads code
but does not execute PR-owned tests. The tests run in quality instead. A
non-security decision is **triage_skipped**, never a clean security scan.
Draft/fork/Dependabot and deliberate `skip-claude` exemptions remain explicit.
The review-workflow self-change guard and own-fix/baseline guards still stop
provider execution loops; they do not certify a required review. In particular,
a PR editing `claude-pr.yml` requires explicit maintainer review even if its
edited triage says otherwise.

A successful Claude process alone is insufficient. Its terminal execution
record must be successful, contain no error, have performed at least one turn,
and return structured completion evidence with the **final** reviewed SHA,
exact sorted file scope, a completed result and no unresolved findings. After
fixes, Claude re-reviews the final diff. Validation uses the parser from the
immutable base, not its PR-modified copy. Normalized evidence (not raw execution
logs) is published as an artifact bound to the workflow run and attempt.
The gate checks the provider job actually succeeded too. Expired, missing,
malformed, wrong-PR, old-attempt and stale-head evidence never passes.

| State | Meaning and check behavior |
| --- | --- |
| `triage_skipped` | Deliberately exempt; quality may pass, with an explicit **not security reviewed** summary. |
| `claude_completed` | Validated successful execution and exact-head/scope evidence; quality may pass. |
| `claude_failed` / `claude_allowance_exhausted` | No completed review. Claude's security job fails; only a real allowance error routes to Codex. |
| Codex request delivered | Delivery job may succeed, explicitly named **not review completion**; this grants no completion. |
| `codex_rejected` | The trusted connector bot rejected the delivered current-head request; quality fails. |
| `codex_pending` / `review_pending` | No verified completion; quality waits up to 20 minutes, then fails as `timed_out`. |
| `stale_head` / `stale_review` | A new push or mismatched scope invalidates evidence; never transfer approval to the new head. |
| `manual_review_required` | Provider execution is guarded; an explicit exact-head review/approval is needed. |
| `codex_completed_attested` | A human maintainer verified the native task and Security Report; auditable attestation, **not automated verification**. |
| `manual_review_approved` | A human maintainer explicitly approved a completed manual review; **not an automated scan**. |

The GitHub summary records the SHA, state, reason and evidence link. A successful
**quality** job means the required policy was satisfied, possibly by an explicit
exemption or manual decision; it does not always mean an automated scan ran.
CodeQL, dependency gates, other required checks and all review threads remain
separate requirements. A later push always needs fresh checks and evidence.

### Codex delivery, provider rejection and remaining uncertainty

Confirmed evidence: [#1036 request/rejection](https://github.com/OpenFarmPlanner/planner/pull/1036#issuecomment-6817626358),
[#1039 final-head rejection](https://github.com/OpenFarmPlanner/planner/pull/1039#issuecomment-6823549958),
and [#1040 rejection](https://github.com/OpenFarmPlanner/planner/pull/1040#issuecomment-6824802763).
In [run 43226417060](https://github.com/OpenFarmPlanner/planner/actions/runs/43226417060),
`continue-on-error` let the allowance classifier succeed, and the next job
succeeded after posting a request. Nothing checked review completion, so the
workflow could be green despite the rejection. The classifier now reports
routing separately, Claude's incomplete job stays failed, and quality enforces
completion. #1042/#1044 intentionally had security triage false; their skips
are not completed security reviews.

The exact `@codex security review` command is supported by the current
[Security Review documentation](https://learn.chatgpt.com/docs/security/security-review).
Native reviews require eligible workspace access and a connected repository.
A clean native review can post no findings: reactions, silence, code-review
comments and delivery acknowledgements cannot establish security completion.
The full task and Security Report are the completion evidence. No documented
public exact-head completion API was established in this investigation, so
this gate does not invent a bot-comment format or treat ordinary Codex code
review as a completed Security Review.

The owner reports that GitHub is connected, the Connector app has all-repository
read/write access, a Codex Cloud environment exists, and automatic code/security
reviews are enabled. Requests were posted as `stipsitzm`; the connector rejected
them within seconds with an account-connection instruction and a legacy Cloud
settings URL. Current [GitHub review documentation](https://learn.chatgpt.com/docs/third-party/github)
distinguishes legacy setup and current review settings. These observations do
**not** establish a wrong installation, missing entitlement or identity mapping.
The provider-side rejection remains unresolved; reinstalling/reconnecting is
not a repository fix and is not recommended without provider diagnosis.

For upstream support, provide the PR/run/rejection links above, request actor,
request/head SHA, UTC timestamps, workspace entitlement and repository review
settings, plus whether the request is linked to a native task. Ask support to
trace the mention event through identity-to-workspace/repository authorization
and explain the legacy-connector rejection despite the verified settings.
Never include tokens. A minimal reproduction is one supported request on a
current eligible PR under the linked user; preserve its request and immediate
bot response. This repository cannot repair OpenAI's internal identity routing.

### Recovery and explicit human contingency

The fallback uses `CODEX_REVIEW_GITHUB_TOKEN`, otherwise `RELEASE_PAT`, from a
personal user linked to the intended Codex account. `GITHUB_TOKEN` is not a
subscription identity. The request job loads base-commit automation, disables
checkout credentials, records the current SHA/run and deduplicates per user/SHA.
Reruns do not spam the same rejected request. After an upstream fix, a maintainer
may manually request another native review with the supported command, then
verify its actual task/report. New heads get new requests and new reviews.

If native completion cannot be automatically verified, a **human admin or
maintainer**, after inspecting the completed task/report for the exact SHA,
can post:

```text
/security-review approve codex FULL_HEAD_SHA https://chatgpt.com/codex/tasks/TASK_ID
I verified the completed Codex Security Report for this exact commit.
Result: No unresolved findings
Reason: native completion verified in the task and Security Report
```

This is explicitly a maintainer attestation of Codex completion. The gate does
not claim to have fetched or independently verified that private report.

For an independent manual review, first post a PR comment containing
`<!-- manual-security-review:FULL_HEAD_SHA -->`, every changed path in backticks,
the actual review findings/resolution and `Result: No unresolved findings`.
Then a human admin/maintainer approves that report:

```text
/security-review approve manual FULL_HEAD_SHA https://github.com/OpenFarmPlanner/planner/pull/PR_NUMBER#issuecomment-REPORT_ID
I independently reviewed this exact commit and approve its security review.
Reason: automated providers unavailable; completed manual review linked above
```

The linked report must be on this PR, cover the exact SHA and all changed
files, and predate approval. Authoring-session/self-review reports are rejected.
Bots and users without admin/maintain permission cannot approve. Agents must
never manufacture these attestations or use a broad instruction to continue
as approval of a specific review. Approval is a deliberate human decision.

The first installation has no base policy yet. Its quality check therefore
fails until a human maintainer independently reviews the exact patch and posts:

```text
/security-review bootstrap FULL_HEAD_SHA
I independently reviewed this exact commit and approve installing the security review gate.
```

This auditable first-install decision is displayed as manual approval, not an
automated scan. No branch-protection bypass is used. Once the policy is on main,
normal base-policy loading applies; editing the head cannot edit that policy.

After completion/approval becomes available, rerun the failed quality job
intentionally to re-evaluate evidence. A comment itself does not launch more
provider jobs. Pending checks have a bounded wait; provider failures, rejection
and guarded execution fail clearly. If a new push occurs, repeat the review and
approval for its new SHA. Do not rerun tests repeatedly to mask a provider error.
Artifacts expire after 30 days; expired evidence requires a new review or
explicit human contingency, never silent reuse. No service repair or completed
native review is claimed merely because local regression tests pass.

Local policy regression checks:

```bash
python3 -m unittest discover -s tests -p test_claude_review_fallback.py
node --test tests/test_codex_security_request.cjs tests/test_security_review_completion.cjs
```

## Security decisions

Durable security decisions that outlive a single PR: accepted risks,
deliberate exceptions and recurring patterns reviewers should know about.
Per-PR review results do not belong here; they live in the PR's review
comment. Add an entry with the date, the decision, the reason and the
PR or issue that made it. Reviewers must not re-report an accepted risk or
deliberate exception listed here.

### 2026-11-05 — Verify forwarding chains before using client IPs (#880)

The operator selected chain validation for Cloudflare → Uberspace → Django.
Trust exact immediate peers separately from upstream proxy CIDRs, walk XFF
right-to-left, and stop at the first untrusted hop. All IP abuse controls use
the resulting REMOTE_ADDR; DRF does not independently trust XFF. Single-value
client-IP headers are not evidence of an upstream proxy. Missing or ambiguous
chains retain the peer. This permits direct-origin access with its real caller
identity; restricting origin access is separate infrastructure work. Trusted
ranges require operator maintenance and are empty by default. See
[account-trust-levels.md](account-trust-levels.md#client-ips-behind-reverse-proxies)
for the provider append contract, parser behavior and rollout checks.
