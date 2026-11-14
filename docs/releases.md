# Protected automatic releases

`.github/workflows/release.yml` releases through a checked version PR. It never
pushes version commits directly to `main`. Conventional Commits and the existing
python-semantic-release 10.5.3 configuration in `pyproject.toml` still calculate
the next version; `release:*` labels remain the existing classification hints.
No deployment to staging or production is part of this workflow.

## Flow and credentials

Each push to main, or manual dispatch on main, serializes through one workflow
concurrency group. Jobs check out trusted main, never execute a PR head, and do
not persist checkout credentials.

1. **Verify:** discover the latest merged `automation/release` PR, including
   after a missed/cancelled push event. Verify the authorized owner/last editor,
   generated plan, single-parent squash merge, exact main base and file hashes.
   Read live strict/app-bound required-check policy with `RELEASE_PAT`, which
   this job uses only for reads. Already-published matching tags/releases are
   no-ops; conflicting tags are errors and are never moved.
2. **Publish:** receive the candidate and policy snapshot as outputs from that
   trusted verification job, and check out its exact trusted main revision.
   Recheck candidate identity, file hashes and the latest check results. Only
   this job creates the tag at the exact release merge SHA and posts release
   notes. It has `contents: write`, `pull-requests: read` and `checks: read` on
   the short-lived `GITHUB_TOKEN`; it receives no PAT or admin permission.
3. **Prepare:** after successful publication (or no pending publication), run
   semantic release with `--no-commit --no-tag --no-push --no-vcs-release
   --skip-build`. Only the backend version declarations and, if generated,
   `CHANGELOG.md` are allowed to change. Commit to `automation/release`, push
   that reserved branch with an explicit lease, open/update one
   `chore(release): vX.Y.Z` PR and enable squash auto-merge with the expected
   head. This step uses the owner's `RELEASE_PAT` so the PR starts normal CI
   without a manual workflow-approval prompt. It never uses `--admin`.

The version PR goes through the existing required CI and review policy. A
small metadata-only change may receive the normal deterministic review
exemption; there is no release-specific exemption or weakened verifier.
New main changes regenerate the version PR from the latest main, invalidating
its previous head/checks rather than releasing stale metadata. A closed,
unmerged version PR stops new preparation until deliberately reopened. Keep
the reserved branch and generated plan under workflow ownership.

## Repository protection and rollout

Main requires a PR, strict up-to-date checks and the existing app-bound check
contexts. Enable **Do not allow bypassing the above settings** / classic
`enforce_admins` after the new workflow is installed and has prepared its first
version PR. Keep auto-merge enabled and the required contexts unchanged. Check
that no old direct-push release run is still running during the cutover.

The existing PAT can remain the PR-creation credential: enforcing main rules
also applies to its admin identity. This does not remove that credential's
ability to administer repository settings if it is an admin token. A separately
scoped GitHub App or fine-grained non-admin automation credential is a future
credential-hardening step, not a prerequisite for checked automatic merges.

Manual `make bump-version` prepares local version files only; it is not a
publication command and must not be pushed directly to main. Normal releases
use the generated version PR. Do not repair workflow failures by disabling
protection, forcing tags or manually stamping main.

## Verify and recover

Watch the **Release** run, its version PR and the published tag/release. After
the version PR merges, fetch main and tags. `git describe --tags --exact-match
HEAD` should identify the version commit when main has not advanced further;
otherwise check the release PR's exact merge SHA. An application PR merge can
remain untagged while its version PR is still passing CI; this is expected.

Rerun the Release workflow on main after an API outage or interrupted run.
Tag creation followed by failed notes publication is recoverable: a matching
tag is reused and the missing release notes are published. Different existing
tag targets, stale/tampered plans, unsupported merge shapes or failing checks
stop publication. Never move a published tag as a recovery shortcut.

Tests use temporary Git repositories, the real pinned semantic-release CLI
and mocked GitHub writes; they do not publish real tags or touch main remotely:

```bash
python3 -m pip install python-semantic-release==10.5.3
python3 -m unittest discover -s tests -p test_release_pr.py
```
