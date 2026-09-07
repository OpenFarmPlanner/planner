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

## 2026-09-07 — Codex — Full backend/frontend cross-review

**Scope:** Full-repository manual review at `e882508`. This review independently
cross-checked the two 2026-09-07 Claude entries, reviewed the release-only
changes since `22f25c9`, and re-walked the complete application rather than
sampling only changed files:

- every routed DRF view/viewset, `ProjectScopedMixin`, direct object lookup,
  project/season header resolver, relational serializer, service query, history
  restore, WebSocket consumer, API-token surface, and invitation/member flow;
- authentication/account/session/OAuth/data-export behavior, CORS/CSRF and
  production settings;
- public-library publish/import/direct-edit/translation/revision/proposal,
  species moderation, moderator grant, removal, and discussion flows;
- both image upload paths, feedback persistence/email, all outbound email
  templates, logging call sites, and frontend markdown, URL, browser-storage,
  cookie, and HTML-rendering sinks;
- locked Python and npm dependency graphs, using `pip-audit` and `npm audit`.

The most recent review of tenancy, authentication, the public library, uploads,
OAuth and frontend sinks was Claude's 2026-09-07 tenant-boundary entry; the
rendering/email/notification/layout/supplier/cleanup surfaces were last reviewed
by Claude's immediately newer entry. Both were therefore genuine cross-review
priority. The only code changed after those reviews is the version bump plus
Claude's markdown regression test and review-log entry; those changes introduced
no security-relevant behavior.

**Findings:**

1. **`OPEN` — Legacy change proposals bypass field-level serializer
   validation (medium; malformed stored data / moderator-triggered 500).**
   `PublicCropChangeProposalSerializer.validate_proposed_data()` only checks
   that the payload is a non-empty object whose *keys* are in an allowlist; it
   does not validate the values against `PublicCropUpdateSerializer`
   (`backend/farm/crops/serializers/public.py:526-536`). Approval then passes
   that stored JSON directly to `update_public_crop_directly()`
   (`backend/farm/crops/views/public.py:516-522`), whose loop assigns values
   directly to model attributes and saves them
   (`backend/farm/services/public_crops.py:397-420`). A contributor can
   therefore store invalid types/shapes (notably arbitrary `seed_packages`
   JSON, invalid choice values, or strings/objects for numeric fields). A
   moderator opening the queue is safe, but approving such a proposal can cause
   a 500 or persist data that the normal typed update serializer would reject;
   malformed `seed_packages` can also break later consumers/imports.
   **Suggested fix:** validate `proposed_data` with the same typed,
   partial-update serializer used by direct edits (then restrict to
   `PUBLIC_CROP_PROPOSABLE_FIELDS`) before storing it, and defensively
   revalidate under the row lock at approval time. Add regression cases for
   wrong scalar types, invalid choices, and malformed nested JSON. The legacy
   API is documented as reachable but has no UI, so deciding whether to harden
   or remove it is a product/API compatibility decision; no fix was applied.
2. **`OPEN` — The documented admin-only variety rename boundary is not
   enforced (medium; public identity overwrite).** The architecture says only
   an admin may correct a public entry's variety
   (`docs/crop-library-architecture.md:81-90`), but `variety` is in the
   general editable-field list
   (`backend/farm/services/public_crops.py:72-95`) and the only service-level
   authorization check is “authenticated”
   (`backend/farm/services/public_crops.py:343-345,385-399`). Consequently any
   authenticated non-moderator can `PATCH /api/public-crops/{id}/` and rename
   any contributor's variety; optimistic locking and collision detection limit
   races/duplicates but do not enforce the stated privilege boundary. This is
   broader than the intentional wiki-style rule allowing logged-in users to
   edit agronomic content. **Suggested fix:** decide whether the documentation
   or policy is authoritative. If admin/moderator-only is intended, reject
   `variety` in the service unless `is_public_library_moderator(user)` (or
   the narrower admin predicate), enforce it again in the serializer/view, and
   test a non-moderator editing another contributor's entry. If all users may
   rename identities, update the architecture and UI language explicitly.
   This requires a product decision, so no fix was applied.
3. **`OPEN` — Raw email addresses and usernames are copied into application
   logs (low; DSGVO/data-minimization and secondary disclosure).** Invitation
   mismatch logging writes both full addresses
   (`backend/farm/services/project_invitations.py:242-244`); account email
   delivery failures write the account/new address
   (`backend/accounts/views.py:139-142,353-359,559-562,584-589`); deletion
   lifecycle logs write usernames
   (`backend/accounts/views.py:453-463,504-511`). These values are unnecessary
   because stable user/invitation/request ids are already present and log
   retention/access may differ from the primary database. **Suggested fix:**
   define a log data-minimization policy and retention/access controls, remove
   raw addresses/usernames in favor of ids or a keyed non-reversible
   correlation hash, and add a caplog regression similar to invitation-token
   masking. Operational incident-response needs and the sibling ops repository's
   logging controls are not defined here, so this is left OPEN rather than
   silently changing observability.

4. **`CROSS-CONFIRMED` — 2026-09-07 Claude rendering entry, finding 1
   (markdown stored-XSS regression coverage).** Independently checked that
   `RichTextViewer` uses `react-markdown` without `rehype-raw`, its link
   override adds `noopener noreferrer`, and the new tests reject raw HTML and
   script schemes. Confirmed still holding by Codex on 2026-09-07.
5. **`CROSS-CONFIRMED` — 2026-09-07 Claude rendering entry, finding 2
   (email-subject header injection is not exploitable).** Re-derived the
   client-controlled subject inputs and Django mail path: CR/LF is rejected by
   Django header validation, non-ASCII is RFC 2047 encoded, delivery failure is
   contained, and no HTML template disables escaping. Confirmed by Codex on
   2026-09-07.
6. **`CROSS-CONFIRMED` — 2026-09-07 Claude tenant-boundary entry, findings 1
   and 2 (crop-import reference scoping and fail-closed serializer context).**
   Both import branches now pass the project context, media/supplier/seed-demand
   references are compared with the active project, and unresolved scope is
   rejected rather than skipped. Confirmed by Codex on 2026-09-07.
7. **`CROSS-CONFIRMED` — 2026-09-07 Claude tenant-boundary entry, reviewed
   public-library privilege and season claims.** Project import resolves a
   verified membership before writes; species and moderator-request review
   actions enforce moderator/admin roles; proposal approval/rejection is
   moderator-only; comment mutation is author-or-moderator; season filtering is
   applied after the project filter and foreign season relations are rejected.
   The two distinct issues found in the deeper 4-case re-review are findings 1
   and 2 above. Confirmed by Codex on 2026-09-07.

**Reviewed with no additional findings:** every tenant-owned model exposed
through the REST API is either filtered by `request.active_project` through
`ProjectScopedMixin` or uses an explicit member-scoped lookup; every writable
cross-model relation is checked against that project. `X-Season-Id` never
authorizes access and cannot widen the project queryset. Default DRF permissions
are authenticated and the deliberately anonymous endpoints are bootstrap,
token-confirmation, invitation-display, version, OAuth-provider, or public
discussion reads; state-changing session requests retain CSRF enforcement.
Agent tokens remain bound to one project and deny-by-default by API surface.
No raw SQL uses user-derived SQL structure, no unsafe deserializer/eval sink was
found, and the frontend has no production `dangerouslySetInnerHTML` or
`innerHTML` assignment. Uploaded files are byte-decoded, pixel/byte bounded,
format allowlisted, canonically named (and note images re-encoded); captions,
feedback, discussions, and markdown are rendered as React text/markdown rather
than HTML. Session identifiers remain HttpOnly cookies; no auth token is placed
in browser storage (the invitation token stored temporarily in localStorage is
a single-purpose, expiring invitation capability). Production defaults disable
DEBUG, require a non-default secret, restrict hosts/origins by explicit
configuration, enable secure cookies/HTTPS/HSTS/nosniff/referrer/frame controls,
and keep credentialed CORS on an allowlist. Personal export is self-scoped JSON
and excludes password hashes. `npm audit --audit-level=high` and the exported
locked Python graph via `pip-audit` reported no known vulnerabilities.

**Still deferred:** the previously OPEN production-like penetration testing,
sibling `ops` repository (including private-media authorization and logging
retention/access), GitHub repository settings, live OAuth tenants, load/fuzz
testing and storage/frame quotas, report-only CSP rollout, and future
spreadsheet-export formula neutralization remain outside this code-only review.

---

## 2026-09-07 — Claude — Rendering pipeline and remaining unreviewed surfaces

**Scope:** Reviewed at `22f25c9`, chosen because no prior entry covers it:

- the notes/rich-text pipeline end to end — the tiptap editor's markdown
  storage, `RichTextViewer`, `NotesCell`, `NotesDrawer`, and the shared
  `markdownComponents` link override;
- outbound email construction (activation, password reset, email change,
  feedback, registration notification) and the Django email templates;
- `notifications` REST views;
- bed/field layout endpoints and `save_location_layouts`;
- the supplier undo/restore service's bulk crop reassignment;
- the local-fixture cleanup service and its management command.

**Findings:** none exploitable.

1. **`FIXED` — no defect; regression tests added for a property that was
   unpinned.** Notes are written by one project member and rendered for the
   others, so the viewer is a stored-XSS sink. It is safe today, but only
   because of two `react-markdown` defaults: `defaultUrlTransform` (which
   neutralizes `javascript:` hrefs) and raw HTML being ignored without
   `rehype-raw`. Nothing in this repository asserted either, so adding
   `urlTransform` or `rehype-raw` later would silently reintroduce XSS.
   `frontend/src/__tests__/RichTextViewerSanitization.test.tsx` now pins both,
   plus the casing/whitespace variants and the ordinary-external-link case.
   Verified empirically, not by reading the library.
2. **`WONTFIX` — email subject headers interpolate user-controlled text.** The
   feedback subject carries the client-supplied project name and the
   registration-notification subject carries a username. Reason: not
   exploitable. Django's `forbid_multi_line_headers` rejects embedded CR/LF
   before the message is sent, non-ASCII subjects go through RFC 2047
   quoted-printable encoding which encodes any newline, and the feedback send is
   wrapped so a rejected header fails the delivery rather than the request.
   No template uses `|safe`, `mark_safe`, or `autoescape off`, so the one HTML
   email body is autoescaped.

**Reviewed with no findings:** the tiptap editor stores markdown with
`html: false` and never renders stored content as HTML; `notifications` views
are strictly self-scoped, including `mark_read`, which resolves against the
unfiltered recipient queryset so an `is_read` query parameter cannot widen it;
bed/field layouts reject any bed or field whose location is not the
already-project-scoped one, so a foreign id cannot be linked into a layout and
read back; the supplier restore path creates its supplier inside the active
project and scopes every crop update to it, and a cross-project primary-key
collision fails closed rather than overwriting; the local-fixture cleanup
refuses to run unless `DEBUG=True` **and** `DJANGO_ENV=development`, and is
reachable only as a management command.

**Verification:** full backend suite (1196 passed), full frontend suite
(2443 passed across 245 files), `npm run lint` (0 errors), and
`manage.py check --deploy --fail-level WARNING` clean apart from the short
throwaway `SECRET_KEY` used locally.

---

## 2026-09-07 — Claude — Tenant boundary cross-review (first cross-review under the protocol)

**Scope:** Cross-review of the 2026-09-05 Codex baseline's tenant-boundary
claims, plus areas that entry did not name. Reviewed at `c05a40b`:

- project resolution and the `ProjectScopedMixin` queryset/`initial()` contract;
- history: project restore, global/crop restore, batch revert, row recreation;
- project membership, invitation, and role endpoints;
- the crop import surfaces (crops-page spreadsheet import and the agent-API
  draft flow), media/upload handling, note attachments;
- project-bound API tokens (authenticator, surface middleware, scopes) and
  agent-mode sessions;
- WebSocket consumers and their group derivation;
- `accounts`: social-login account linking, activation/password-reset/email
  change, the personal data export, guest demo sessions;
- the public crop library (publish/import, species proposals, moderator
  requests, discussions) and seasons/`X-Season-Id`;
- frontend raw-HTML sinks, `href` sinks, and client-side storage.

Method: independent re-derivation from the code, not verification of the prior
write-up. Two of the three scope areas were reviewed by parallel subagents and
their findings re-verified here before any change. The one confirmed finding
was reproduced with a failing test first, and the fix is in this same change.

**Findings:**

1. **`FIXED` — Cross-project media and supplier references via the crops-page
   spreadsheet import (high).** The 2026-09-05 fix for cross-project media
   (that entry, finding 2) lives in `CropSerializer._validate_supplier_consistency`,
   and every check there was written as `if project is not None and …`. The
   project is resolved from the request context or a bound instance;
   `apply_crop_import` built `CropSerializer(data=crop_data)` with neither on
   its create branch, so `project` resolved to `None` and all three
   cross-project guards were skipped. `image_file_id`, `supplier_id`, and
   `selected_seed_demand_supplier` accept ids from the whole deployment, so any
   member of project A could `POST /api/crops/import/apply/` with project B's
   ids, then read back B's supplier record and — via the persisted
   `image_file.storage_path`, the only unguessable part of a `/media/` URL —
   B's uploaded images. Ids are sequential integers, so enumeration is trivial.
   `POST /api/crops/` rejected the identical payload; only the import route was
   affected, and the update branch was safe because its bound instance supplied
   the project.
   Fixed in three layers: the import service now passes
   `context={'project': project}` on both branches;
   `_resolve_active_project_from_serializer` and the serializer's own
   `_resolve_project` both honour that context key (they had diverged, which is
   what let one of them silently return `None`); and the cross-project check now
   **fails closed** — an unresolvable project rejects the relation with
   `project_scope_unresolved` instead of skipping the comparison, so a future
   caller that forgets the context fails loudly rather than unguarded.
   Regression tests: `CropImportProjectBoundaryTest` in
   `farm/tests/test_crop_imports_api.py` (foreign media, supplier, and
   seed-demand supplier all rejected; own-project references still accepted).
2. **`FIXED` — `supplier_name` import silently wrote into the legacy bootstrap
   project (medium).** Surfaced by finding 1's fix. When the project could not
   be resolved, `_resolve_supplier_from_name` called `get_or_create` on the
   pre-multi-tenancy bootstrap project (slug `gelawi-zwiebelzopf`, from
   migrations 0047/0051), created the supplier there, and attached it to the
   crop — manufacturing exactly the cross-tenant supplier reference the
   validators exist to prevent, and resurrecting that project if it had been
   removed. It now raises `project_scope_unresolved` instead. Predates this
   change; fixed here because it is the same unresolved-project root cause.
   Regression test: `test_crop_serializer_refuses_supplier_name_without_project`.
3. **`CROSS-CONFIRMED` — 2026-09-05 Codex, finding 1 (cross-project crop
   restore).** Independently re-derived: `GlobalHistoryRestoreView` constrains
   both the revision and the crop to `active_project`, `ProjectHistoryRestoreView`
   and `BatchOperationRevertView` do the same and additionally require project
   admin. Confirmed still holding by Claude on 2026-09-07.
4. **`CROSS-CONFIRMED` — 2026-09-05 Codex, finding 2 (cross-project media
   references).** The fix holds on the path it was written for
   (`POST`/`PATCH /api/crops/`), verified by test. It did **not** cover the
   import path — see finding 1 above, which is the same defect reached through a
   different caller. Confirmed by Claude on 2026-09-07.
5. **`CROSS-CONFIRMED` — 2026-09-05 Codex, finding 3 (raw-HTML Gantt sink).**
   The frontend now contains no `dangerouslySetInnerHTML` or `innerHTML`
   assignment at all. The two `href` sinks that do render stored user input
   (`CropDetail.tsx` supplier product URL, `Suppliers.tsx` homepage URL) are
   backed by server-side scheme validation, so no `javascript:` URL can be
   stored. Confirmed by Claude on 2026-09-07.
6. **`CROSS-CONFIRMED` — 2026-04-02 Codex, findings 1, 2 and 4 (agent login
   token replay, unscoped direct lookups, `remaining-area` probing).** The
   `used_at` replay check, the project filters on the named views, and the
   `bed_id`/`exclude_plan_id` ownership checks in `remaining_area` are all
   present. Confirmed by Claude on 2026-09-07.
7. **`CROSS-CONFIRMED` — 2026-04-03 Codex, finding 1 (project snapshot/restore
   scoping).** `_restore_project_state_at` filters deletes and updates by
   `project`, reassigns `project_id` on recreated rows, and its bulk insert uses
   plain `bulk_create` with conflicts skipped (no `update_conflicts`), so a
   stale snapshot cannot overwrite a row that now belongs elsewhere. Confirmed
   by Claude on 2026-09-07.
8. **`OPEN` — Deferred scope from the 2026-09-05 baseline (finding 8) and the
   2026-08-30 entry (finding 2).** Unchanged and still not covered: the `ops`
   repository, dynamic penetration testing, GitHub repository settings, real
   OAuth tenants, fuzzing/quotas, the report-only CSP rollout, and
   formula-injection neutralization for any future server-generated CSV/XLSX
   export. Re-checked that no server-generated spreadsheet export exists yet —
   the personal data export is JSON, so the formula-injection item remains
   forward-looking rather than a present defect.

**Reviewed with no findings:** API-token authentication and its deny-by-default
surface middleware (membership is re-checked per request; the middleware's
credential detection is deliberately broader than the authenticator's, so it
cannot be slipped past); WebSocket consumers (groups derived from the
authenticated user, payloads carry only invalidation ids); social-login linking
(auto-link requires provider-verified *and* locally verified email, so nOAuth-style
takeover is blocked, and unverified providers cannot pre-empt an address);
seasons and `X-Season-Id` (applied after the project filter, never as an
authorization token); the public crop library's publish/import/moderation
paths and discussions; the personal data export (hand-picked account fields, no
password hash; invitations filtered to the requester's own involvement); guest
demo sessions (unusable password, blocked from linking and from ~17 write
surfaces); and the crops-page href sinks noted in finding 5.

**Non-security observations, not tracked here:** several `get_image_file`
methods reference a field their model does not have (dead code), and
`restore_crop_from_revision` compares snapshot keys in `attname` form against
`field.name`, so FKs are never restored — a correctness bug that happens to
fail safe. Both are outside this change's scope and are reported separately.

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
