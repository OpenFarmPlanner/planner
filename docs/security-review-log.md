# Shared security review log

Claude and Codex alternate security reviews of this repository. This file is
the shared record between them: what was reviewed, by which tool, when, and
what came out of it. It exists so that neither tool re-reports a finding the
other already handled, and so that no scope is silently dropped because each
tool assumed the other had covered it.

The procedure both tools must follow before and after a review is in the
["Security Review Protocol" section of `CLAUDE.md`](../CLAUDE.md#security-review-protocol).
Read that section and this file in full before starting a review.

## How this file works

- **Append-only.** New entries go at the top, directly under this section.
  Never edit or delete an earlier entry's findings — the only permitted
  in-place change is the status of an existing finding, and even then the
  status line records who changed it and when.
- **Newest entry first**, so the most recent state of a scope is at the top.
- Every entry records **date**, **tool** (Claude or Codex), **scope** (a
  commit range, a pull request, or a named area of the codebase), and a list
  of **findings**.
- Every finding carries one status:

| Status | Meaning |
|---|---|
| `FIXED` | The finding was confirmed and remediated in the same change or a named follow-up. |
| `OPEN` | Confirmed and still present, or deliberately deferred to later work. |
| `WONTFIX` | Confirmed but intentionally not fixed. Always followed by a short reason. |
| `CROSS-CONFIRMED` | The *other* tool independently checked a prior finding of this one and verified that it still holds, or that it has been addressed. Records which tool confirmed it and when. |

`CROSS-CONFIRMED` is the point of this log: a finding that has only ever been
looked at by the tool that raised it has had one pair of eyes on it.

This log covers **manual and AI-assisted security review**. The always-on
automated checks (CodeQL, `pip-audit`, `npm audit`, Dependency Review,
Dependabot, Django deployment checks) are described in
[`security-automation.md`](./security-automation.md) and are not logged here
entry by entry; a review may of course cite their output.

---

## 2026-09-07 — Claude — Log bootstrap (not a review)

**Scope:** `docs/security-review-log.md`, `CLAUDE.md`, `docs/index.md`.

This entry exists only to state what the entries below are. No code was
reviewed for security as part of it.

The entries dated before today were **reconstructed on 2026-09-07 from git
history, merged pull request descriptions, and
[`security-review-2026-09-05.md`](./security-review-2026-09-05.md)** — they
are not transcripts of the original review sessions. Where an entry is
reconstructed, it says so and names the evidence it was rebuilt from. Dates
are the merge dates of the corresponding pull requests, which may trail the
date the review itself was performed. Scope lines for the reconstructed
entries describe the area the change touched; the true review scope may have
been wider, since a review that found nothing in an area leaves no trace in
the commit history.

**Findings:** none — no review was performed.

---

## 2026-09-05 — Codex — Full manual security baseline

**Scope:** Full-repository manual review at base commit `155568a`; remediation
merged as [PR #595](https://github.com/OpenFarmPlanner/planner/pull/595)
(commits `43f7748`, `57214c6`, `d8c8a71`, merged 2026-09-07). Covered Django
production settings/middleware/cookies/CORS/CSRF/OAuth, session and API-token
authentication, agent-mode sessions, project-scoped viewsets and direct object
lookups, WebSocket auth and group selection, image upload validation and
storage, spreadsheet preview/apply scoping, frontend raw-HTML sinks and
external links, locked Python/npm dependencies, and the security workflows.

*Not reconstructed:* this entry summarizes
[`security-review-2026-09-05.md`](./security-review-2026-09-05.md), which is
the original review record. Read that document for the full reasoning; the
statuses below are the log's view of it.

**Findings:**

1. **`FIXED` — Cross-project crop restore (high).** The crop restore action
   fetched from the unscoped soft-delete manager, so a member could restore
   another project's crop by ID. Lookup is now constrained to the request's
   active project, with a regression test asserting `404` cross-project.
2. **`FIXED` — Cross-project media references (high).** `MediaFile` had no
   owner and `CropSerializer.image_file_id` accepted the global media
   queryset, letting a member attach another project's upload and learn its
   storage path. Media now carries a project owner (migration
   `0104_mediafile_project`), uploads assign it, and crop validation rejects
   foreign media.
3. **`FIXED` — Dormant raw-HTML Gantt icon sink (medium, defense in depth).**
   The vendored Gantt task list had an unused `showIcon` option feeding
   `dangerouslySetInnerHTML`. No caller enabled it; the option and its string
   field were removed rather than sanitized.
4. **`FIXED` — Unbounded image decompression.** Pixel counts are now capped
   (`MAX_IMAGE_PIXELS = 25_000_000`) before Pillow verification and decode.
   Raised and fixed in the immediately preceding change; carried into this
   baseline.
5. **`FIXED` — Vulnerable backend dependencies.** Direct dependencies flagged
   by `pip-audit` (`django`, `djangorestframework`, `Pillow`, `requests`,
   `daphne`, others) were bumped and `pdm.lock` refreshed; `pip-audit` and
   `npm audit --audit-level=high` clean afterwards.
6. **`FIXED` — External base URL validation (medium, configuration
   hardening).** `PUBLIC_FRONTEND_URL` accepted any absolute URI scheme and
   the OAuth callback base had no equivalent check. Both now require an
   absolute HTTP(S) URL with no credentials, query, or fragment, and reject
   loopback hosts outside development/test.
7. **`WONTFIX` — Bandit medium findings (3).** Development LAN host discovery
   mentioning `0.0.0.0`, and two parameterized SQL sites whose placeholder
   count derives from an integer list length. Reason: reviewed as
   non-exploitable; no user input reaches either construct.
8. **`OPEN` — Deferred scope, explicitly not covered by this review.** Dynamic
   penetration testing against a production-like stack; the sibling `ops`
   repository (reverse-proxy limits, TLS, Redis, database exposure, media
   authorization/caching, backups, secret storage); GitHub repository settings
   not verifiable from workflow files (branch rules, secret scanning, push
   protection, alert access); OAuth against real Google/Microsoft tenants;
   load testing, malformed-image fuzzing, animated-image aggregate frame
   limits, project-wide storage quotas; a report-only Content Security Policy
   rollout; and spreadsheet formula-injection neutralization for any future
   server-generated CSV/XLSX export.

---

## 2026-08-30 — Codex — Automated security control coverage

**Scope:** CI and repository security automation —
`.github/workflows/{codeql,dependency-review,dependency-scan,ci}.yml`,
`.github/dependabot.yml`.
[PR #532](https://github.com/OpenFarmPlanner/planner/pull/532).

*Reconstructed from commit history and the PR description; no original review
record exists.* The PR implements recommendations from an earlier review whose
own write-up is not in the repository, so the finding below is stated as the
gap the change closed rather than as originally worded.

**Findings:**

1. **`FIXED` — No SAST, no PR-level dependency gate, no scheduled rescan, no
   deployment-setting check.** Added CodeQL (Python + JS/TS) on PRs, pushes to
   `main`, and weekly; Dependency Review blocking high-severity introductions;
   a weekly schedule and `workflow_dispatch` on the dependency scan so
   unchanged lockfiles are rescanned after new disclosures; and
   `manage.py check --deploy --fail-level WARNING` in the backend CI job.
   Dependabot extended to `github-actions`. Documented in
   [`security-automation.md`](./security-automation.md).
2. **`OPEN` — Repository-level GitHub settings cannot be asserted from
   workflow files.** Dependabot alerts and security updates, secret scanning
   and push protection, code scanning alerts, and branch protection requiring
   the security checks must be verified by a repository administrator. Still
   listed as unverified in the 2026-09-05 baseline.

---

## 2026-07-21 — Claude — Backend API access control and upload validation

**Scope:** Backend REST API — serializer writability and viewset project
pinning, media upload handling, invitation service logging. Branch
`claude/security-gaps-audit-fix-5wzd60`;
[PR #340](https://github.com/OpenFarmPlanner/planner/pull/340) (merged
2026-07-22) and its follow-up
[PR #345](https://github.com/OpenFarmPlanner/planner/pull/345) (merged
2026-07-22).

*Reconstructed from commit history and the two PR descriptions; no original
review record exists.*

**Findings:**

1. **`FIXED` — Cross-tenant record reassignment (broken access control).**
   The `Culture`, `Location`, `Field`, `Bed` and `Task` serializers exposed
   `project` as writable while the viewsets pinned it only on create, so a
   member could `PATCH` `project` to a sequential foreign project ID and move
   or inject records. `project` is now read-only on those serializers,
   matching `PlantingPlan` and `Supplier`. Regression tests per model.
2. **`FIXED` — Unvalidated media upload content (stored-XSS / unsafe file
   type).** `MediaFileUploadView` trusted the spoofable `Content-Type` header
   and derived the stored extension from the client filename, so HTML/SVG
   could be stored under an `image/*` header with a dangerous extension.
   Uploads are now decoded with Pillow and the extension derived from the real
   image format, matching the note-attachment pipeline.
3. **`FIXED` — Invitation tokens written verbatim to logs (CWE-532).** All
   seven `logger.*` calls in `farm/services/project_invitations.py` emitted
   raw bearer-style invitation tokens on success and failure paths. Tokens are
   now reduced by `_mask_token()` to a short non-reversible prefix, with a
   non-secret `invitation_id` logged for correlation; the token returned to
   the invite UI is deliberately unchanged. Regression test asserts the raw
   token never reaches log output.

---

## 2026-04-03 — Codex — Project isolation and production settings

**Scope:** Project snapshot/restore, serializer foreign-key ownership, Django
production security defaults. Branch
`codex/identify-and-fix-security-vulnerabilities`;
[PR #147](https://github.com/OpenFarmPlanner/planner/pull/147).

*Reconstructed from commit history and the PR description; no original review
record exists. Paths named below are pre-refactor
(`backend/farm/views.py`, `backend/farm/serializers.py`) and have since been
split into the domain packages.*

**Findings:**

1. **`FIXED` — Project snapshot and restore were not project-scoped.**
   `_serialize_project_state` / `_restore_project_state` could delete and
   recreate rows outside the active project, causing cross-project data loss.
   Both now take an explicit `project` and reassign `project_id` on restored
   rows. Regression test:
   `test_project_history_restore_does_not_delete_other_project_data`.
2. **`FIXED` — Serializers accepted foreign keys from other projects
   (IDOR).** Ownership validation (`_resolve_active_project_from_serializer`)
   now checks FK targets against the active project for `Field`, `Bed`,
   `SeedPackage`, `CultureSupplierData`, `Culture`, `PlantingPlan`, and
   `Task`. Regression tests for cross-project location and bed references.
3. **`FIXED` — Weak production defaults.** `DEBUG` now defaults to `False`;
   secure cookies, HSTS, `SECURE_SSL_REDIRECT`, referrer policy,
   `X_FRAME_OPTIONS`, and `SECURE_CONTENT_TYPE_NOSNIFF` enabled for
   production, with environment overrides preserved.

**Note on verification:** the PR description records that the added tests
could not be executed in the review environment (missing Django/pytest-django)
and were left to CI.

---

## 2026-04-02 — Codex — Project access controls and token handling

**Scope:** Agent login tokens, project scoping on direct-lookup endpoints,
restore authorization, invitation logging. Branch
`codex/analyze-and-fix-security-vulnerabilities`;
[PR #142](https://github.com/OpenFarmPlanner/planner/pull/142).

*Reconstructed from commit history and the PR description; no original review
record exists.*

**Findings:**

1. **`FIXED` — Agent login token replay.** `agent_login_consume_view` did not
   check `used_at`, so a consumed link could be replayed. Consumed tokens are
   now rejected.
2. **`FIXED` — Endpoints fetching objects without a project check.**
   `BedLayoutByLocationView`, `MediaFileUploadView`,
   `NoteAttachmentListCreateView`, `NoteAttachmentDeleteView`,
   `CultureUndeleteView`, and the project/global history and restore endpoints
   now enforce active-project scoping.
3. **`FIXED` — Restores did not require project-admin.** Project and global
   restore operations now require the project-admin role.
4. **`FIXED` — Cross-project probing via `remaining-area`.**
   `exclude_plan_id` and `bed_id` are now validated as belonging to the active
   project.
5. **`FIXED` — Raw invitation tokens in accept-endpoint logs.** Removed here;
   the remaining log sites in the invitation *service* were found and fixed
   independently by Claude on 2026-07-21 (see that entry, finding 3), which
   indicates this class of issue was not fully cleared by this review.
