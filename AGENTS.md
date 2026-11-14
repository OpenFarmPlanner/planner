# AGENTS.md

Use the repository root [`CLAUDE.md`](CLAUDE.md) as the primary source of project instructions.

Step-by-step procedures for recurring tasks (migrations, release and deploy,
public pages, UI text, QA sweeps, security reviews, visual review) live in
[`.claude/skills/*/SKILL.md`](.claude/skills/). They are plain Markdown: follow
the matching one even if your tool does not load skills automatically.

Codex clients can discover the canonical folders through tracked relative directory
symlinks under [`.agents/skills/`](.agents/skills/). Discovery depends on the
client and checkout; these procedures still apply when automatic discovery is
unavailable. Commands in skills run from the repository root unless specified
otherwise. See [`docs/agent-skills.md`](docs/agent-skills.md) for discovery,
environment requirements and validation. Issue/queue requests use the shared
[`issue-and-queue`](.claude/skills/issue-and-queue/SKILL.md) procedure.
