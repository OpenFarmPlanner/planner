---
name: release-deploy
description: Release a version of OpenFarmPlanner and deploy it to staging and then production with the ops repo (tag check, bump-version, deploy_all.sh, rollback). Use when the user asks to release, tag, deploy, roll back or check what is deployed.
---

# Release and deploy

Binding rules: `CLAUDE.md` ("Release and Production Deploy Workflow").
Deploy scripts live in the sibling `ops` repo; its `README.md` describes every
step and override. Read it before using an override flag. Skill discovery does
not require ops, but deployment requires that authorized checkout and host
access. These are not automatically supplied in Codex Cloud. Queue authorization
alone does not authorize production deployment.

## 1. Find the release tag

Merges to `main` prepare a version PR through `.github/workflows/release.yml`.
It uses the existing Conventional Commit calculation, stamps version files on
`automation/release`, and enables squash auto-merge behind normal CI/review.
After that PR merges, the workflow tags its exact merge SHA and publishes release
notes. Never push version commits directly to main, move a release tag or use
an admin bypass. Read [`docs/releases.md`](../../../docs/releases.md) for the
credential split, protection settings and retry behavior. Use the skill-creator
guidance when changing this procedure.

```bash
cd planner
git fetch --tags origin
git checkout main && git pull --ff-only
git describe --tags --exact-match HEAD    # must print the intended vX.Y.Z
```

- `fatal: no tag exactly matches` after an app merge can mean its version PR
  is still passing CI. Check that PR and the Release workflow, then fetch again.
  If main has advanced beyond the release, check out the actual release tag.
- If a merge should have produced a tag but did not, inspect and fix
  `release.yml` (Actions run log); do not bypass the tag check.
- Manual release preparation only: `make bump-version TYPE={feat|fix|breaking}`.
  Never edit version files by hand.

To deploy an older tag: `git checkout vX.Y.Z` (detached HEAD), then verify
with `git describe` as above.

## 2. Deploy to staging

```bash
cd ../ops
./deploy/deploy_all.sh --env staging --dry-run   # preview every gate
./deploy/deploy_all.sh --env staging
```

`deploy_all.sh` runs backup → services → backend → frontend → cron → verify.
The backup is mandatory; a failed backup aborts with the server untouched.
Have the user test the change on `staging.openfarmplanner.org`.

## 3. Deploy to production

Only the same commit that passed staging. Production requires an exact tag, a
clean checkout, a successful staging deploy marker for that commit, and waits
until no app tabs are open (`./deploy/open_tabs.sh --env production`).

```bash
./deploy/deploy_all.sh --env production --dry-run
./deploy/deploy_all.sh --env production
```

Production is outward-facing: confirm with the user before running it. Use
`--allow-untagged`, `--skip-staging-check`, `--ignore-open-tabs` or
`--allow-dirty-tree` only when the user explicitly asks; the final summary
then names the exact commit and every override used.

## 4. When it fails

- The maintenance window stays open after an abort:
  `./deploy/maintenance.sh --env <env> off`.
- If migrations had already started, restore the step-1 dump with the
  command the deploy prints:
  `./deploy/rollback.sh <tag> --env <env> --restore-db <dump>`.
- Report what ran, what failed (with the output) and the current state of the
  environment; never claim a deploy succeeded without `verify.sh` passing.
