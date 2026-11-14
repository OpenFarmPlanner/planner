# Shared repository skills

`AGENTS.md` points to `CLAUDE.md`, the shared project instructions. Procedures
remain mandatory when applicable even if a client has no automatic skill loader.
Canonical skill bodies and resources live under `.claude/skills/<name>/`.
Tracked relative directory symlinks at `.agents/skills/<name>` expose the same
folders to Codex; Claude Code retains its existing discovery location. Edit the
canonical files, not copied bodies or a user-scope installation.

The nine skills are `django-migration`, `public-page`, `qa-sweep`,
`release-deploy`, `security-review-protocol`, `test-coverage-campaign`,
`ui-text-i18n`, `visual-review` and `issue-and-queue`. The last one captures
explicitly requested issue/queue operations; the execution order and worker
handoff remain in [work-execution-queue.md](work-execution-queue.md).

## Discovery versus execution

Use a checkout that preserves Git symlinks (`core.symlinks=true` on a filesystem
supporting them). A checkout that materializes links as text files has not
installed the discovery layout. A fresh clone needs no absolute home-directory
path or sibling repository merely to discover skills.

Codex client behavior varies: verify the repository skill list in the actual
client, restarting/reloading when required. A running Cloud session may retain
its startup catalogue. Cloud needs the committed changes in its own checkout;
a local installation does not update Cloud or transfer GitHub credentials.
Filesystem checks prove links resolve, not that a Cloud client loaded them.
Report actual client discovery separately from filesystem validation.

Run skill commands from the repository root unless a step explicitly changes
directory. Resolve skill-local resources relative to the skill folder: both
`test-coverage-campaign/mutate.py` and its `test-environment-facts.md` resolve
through either location. Repository paths such as `docs/...` are root-relative.
Use available connected tools in place of client-specific names such as Read,
and open screenshots with the available image viewer.

| Procedure | Execution prerequisites (not supplied by discovery) |
|---|---|
| Issue/queue and review bookkeeping | Connected GitHub tools, or an authenticated `gh` account with the required repository permissions. |
| Django migrations/tests | Python/PDM dependencies and explicit settings for the intended database; use isolated test settings for synthetic verification. A fresh worktree does not inherit an ignored `.env`. |
| UI, public-page and mutation checks | Node/npm dependencies; Playwright and a browser for rendered checks. Mutation runs use a disposable worktree and its own dependency setup. |
| QA | A configured synthetic test backend/frontend and browser, per `qa-strategy.md`; no separate `run` skill is required. |
| Release/deploy | An authorized ops checkout and deployment access. The ops repository is an execution prerequisite, never a discovery dependency. Queue work alone does not authorize production deployment. |
| Independent signed review | A configured constrained review service (no author shell/key/checkout access), base-matching launcher, subscription CLI, protected signing key and GitHub access, per `security-automation.md`. The key is not made available to Cloud by these links. |

## Validation without live writes

In a fresh checkout, inspect `git ls-files -s .agents/skills`: every entry must
have mode `120000` and a relative target `../../.claude/skills/<name>`. Resolve
all nine `SKILL.md` files and supporting resources through both paths and compare
the canonical files. Validate frontmatter `name`/`description` and local links.
Run `python3 .agents/skills/test-coverage-campaign/mutate.py --help` to exercise
resource lookup without mutating application files.

Use the installed skill-creator validator when available. The canonical new
skill also has `agents/openai.yaml` UI metadata; it does not duplicate the
instruction body. Validate the issue/queue examples with synthetic queue bodies
and existing parser tests, never test issues or live queue edits. The existing
`node --test tests/test_codex_queue.cjs tests/test_work_queue_worker.cjs` uses
fixtures and performs no GitHub writes. Application suites are unnecessary for
instruction/symlink-only changes; normal required CI still applies to the PR.
