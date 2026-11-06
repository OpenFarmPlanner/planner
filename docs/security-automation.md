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

### Claude allowance fallback to the Codex subscription

When the Claude security review fails with a usage, rate-limit or insufficient
credit error in its execution report, the workflow requests native
[Codex Security Review](https://learn.chatgpt.com/docs/security/security-review)
by posting `@codex security review` on the PR. Other failures (credentials,
tooling, test failures, unreadable reports) still fail the Claude job; they
are not treated as allowance exhaustion. The code-review job has no fallback.
Existing triage, draft/fork/Dependabot exclusions, `skip-claude`, own-fix
exclusions and the workflow-change guard still apply.

The request uses the linked account's included Codex allowance or ChatGPT
credits, rather than the separately billed OpenAI API. Prerequisites:

- Connect `OpenFarmPlanner/planner` in Codex settings and enable Security
  Review access for the workspace. The native feature currently requires
  Pro, Business, Enterprise or Edu; Plus does not include Security Review.
- The workflow posts as a GitHub **user** linked to that Codex account. It
  prefers `CODEX_REVIEW_GITHUB_TOKEN`, a personal token with permission to
  read this repository's PRs and read/write their comments (Pull requests:
  read and write for a fine-grained token). If unset, it uses the existing
  `RELEASE_PAT`; that token's owner must be linked to the intended Codex
  account and have those permissions. `GITHUB_TOKEN` is not used for this
  request because its bot identity has no personal subscription.
- Automatic Codex Security Reviews can remain disabled if Codex should run
  only as the Claude fallback. The workflow requests the review explicitly.

The token is used only in a separate job which loads automation from the PR's
base SHA, with checkout credentials disabled. The request records the current
head SHA (including any pushed Claude code-review fixes) and the originating
workflow run. Rerunning the workflow does not post a second request for the
same SHA under the same user. The workflow change must first reach the default
branch; the existing self-change guard prevents exercising it on its own PR.

**Delivery is not completion.** The green `Request Codex security review
(subscription)` job confirms that the request comment exists. The actual
review runs asynchronously in Codex; inspect its task status and Security
Report before merging. No posted findings is not proof of a completed clean
review. Subscription entitlement, repository connection, and token-owner
linking cannot be verified by successfully posting a GitHub comment.

Native Codex Security Review reports findings and remediation guidance. It
does not execute Claude's automatic per-finding fix commits. Apply findings
in a follow-up change or explicitly request a Codex fix, and track unresolved
findings under the existing Security Review Protocol. Branch protection
requiring the Claude request job alone does not gate on Codex completion.

Local regression checks for this routing and request logic:

```bash
python3 -m unittest discover -s tests -p test_claude_review_fallback.py
node --test tests/test_codex_security_request.cjs
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
