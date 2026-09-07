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
review. Those reviews are logged in
[`security-review-log.md`](./security-review-log.md); read it, and the
"Security Review Protocol" section of [`CLAUDE.md`](../CLAUDE.md#security-review-protocol),
before starting one. Conversely, an ordinary UI-only change normally needs no
additional backend-specific manual security procedure beyond the automated
required checks.
