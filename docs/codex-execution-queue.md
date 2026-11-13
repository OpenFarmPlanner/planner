# Work queue documentation moved

The queue is now agent-independent. See
[Work execution queue and native epic links](work-execution-queue.md) for the
`Ordered work items` schema, PR review gates, `queue:next` marker, epic links
and cost controls. Issue #1058 remains the sole execution-order source.

The old `codex-queue.yml` manual dispatch is a deprecated compatibility wrapper
around `work-queue.yml`; remove it after existing commands and bookmarks have
migrated. It does not launch Codex or call an AI API.
