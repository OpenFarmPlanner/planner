# Full security review — 2026-09-07 (Codex follow-up)

This review covers the complete backend and frontend at commit `fec31e5` and
the changes since the preceding full review at `3d1c9bc`. It was performed
independently from the earlier review narrative: routed endpoints, queryset
boundaries, serializers, services, browser sinks, settings, and locked
dependencies were inventoried again from the code.

## Review lineage and changed code

The shared log shows that Codex performed the most recent full review. Its
entry already cross-confirmed all findings in Claude's two preceding
2026-09-07 reviews. There was therefore no remaining Claude finding awaiting
cross-confirmation. The only application code changed since that review is
Claude's DataGrid and field/bed hierarchy continuous-scroll sizing work. That
diff does not add a data source, HTML/URL sink, request, credential store, or
authorization decision and is cross-confirmed here as security-neutral.

## Confirmed open finding

### Note attachment captions bypass serializer validation (low)

**Location:** `backend/farm/notes/views.py:104,106-127` and
`backend/farm/models/notes.py:22`.

The multipart note-attachment create endpoint reads `caption` directly from
`request.data`, processes and re-encodes the image, and constructs and saves a
model instance without running `NoteAttachmentSerializer` validation. The
model limits the column to 255 characters, but the endpoint does not impose
that limit before the database write. On PostgreSQL, an authenticated project
member can therefore submit an overlong caption and trigger a database error
and HTTP 500 after the comparatively expensive image processing has already
run. The caption remains safe from stored XSS because React renders it as text;
the defect is incomplete boundary validation and a small avoidable
availability/resource-amplification issue, not a tenant escape.

**Suggested fix:** validate the upload metadata with a dedicated write
serializer (preferred), or at minimum run a `CharField(max_length=255,
allow_blank=True)` before image processing. Return a normal 400 for an
overlong/non-string caption and add a regression test. This review leaves the
finding OPEN because choosing the multipart write-serializer shape is an API
design decision rather than an unambiguous missing tenant filter.

## Multi-tenancy and season isolation

- `ProjectScopedMixin.initial()` resolves membership before actions execute,
  and its queryset filter applies the resolved project to every inheriting
  model viewset. Direct API views independently call the same resolver.
- Project API tokens and agent-mode sessions derive their project from a
  server-side binding and reject a mismatching `X-Project-Id`; ordinary
  sessions require active membership. A caller-controlled header is never the
  sole authorization fact.
- Every routed tenant-owned CRUD surface (locations, fields, beds, layouts,
  crops, suppliers, crop-supplier data, seed packages, planting plans, tasks,
  seasons, history, notes/media, imports, projects/memberships/invitations and
  tokens) was followed through its queryset and custom actions. Direct object
  lookups are project-filtered or first prove membership/admin access.
- `X-Season-Id` is parsed only as a numeric secondary filter. Planting-plan and
  yield-calendar queries apply it after project scope, while serializer
  validation prevents assigning a season, crop, bed, or task relation from a
  foreign project. An invalid or foreign season cannot widen a queryset.
- History and batch restores, soft-delete/undelete paths, spreadsheet import,
  agent import drafts, layout bulk writes, supplier undo, and public-library
  import/publish operations preserve the active project boundary.

No tenant-isolation bypass was found. The 2026-09-07 Claude import-context and
serializer fail-closed fixes remain effective, as previously cross-confirmed
by Codex.

## Authentication and authorization

All REST routes and three WebSocket routes were enumerated. DRF defaults to
authenticated session or project-token access plus deny-by-default token
surface permissions. Explicit anonymous routes are limited to CSRF bootstrap,
registration/login and single-purpose confirmation/reset/invitation
capabilities, public account bootstrap/provider metadata, version metadata,
and deliberately public discussion reads. State-changing session requests
remain under Django CSRF middleware.

Project membership mutations, invitations, destructive history actions, API
token management, and project deletion/restore require the corresponding
member/admin boundary. Public-library species moderation, moderator grants,
proposal decisions, removal, and revision controls enforce their moderator or
admin predicates at the backend. WebSocket notification groups derive from
the authenticated user; public discussion sockets disclose only invalidation
ids for visible published entries.

No endpoint with a missing permission or object-level authorization check was
identified.

## Input validation, ORM, and deserialization

Except for the note-caption finding above, writable serializers constrain
choices, scalar shapes, lengths, and tenant-owned relations. The crop import
paths pass explicit project context and re-use the normal crop serializer.
Public change proposals use the typed update serializer both when submitted
and when approved, including their nested seed-package payload.

The codebase contains no user-structured raw SQL, `eval`/`exec`, pickle load,
unsafe YAML load, or equivalent unsafe deserialization path. ORM filters use
typed/parameterized values. Browser-stored JSON is treated only as UI state
and is parsed into constrained application values rather than executed.

## Kulturbibliothek 4-case workflow

All four publish/update cases were re-walked from project-owned source lookup
through row locking and public write. Source crops are pinned to the active
project. Contributor edits are restricted to the public editable field set;
species lifecycle and proposal decisions are moderator-only; moderator access
grants and the public variety-identity mutation are admin-only. Proposal
values are typed on creation and revalidated before approval. Optimistic
version checks, uniqueness checks, and transactional row locks prevent stale
or colliding overwrites. Revision restore enforces the same admin-only variety
identity boundary as direct editing.

No way was found for a contributor or moderator to overwrite fields outside
their intended privilege boundary.

## Uploads, feedback, mail, and frontend rendering

Both upload pipelines enforce a 10 MB input cap, inspect decoded raster
formats, reject excessive pixel dimensions, and assign project ownership.
Note images are orientation-normalized, resized, and re-encoded; general crop
media receive a canonical extension. Animated-image aggregate frame limits
and project storage quotas remain deferred operational/design work.

Feedback fields are length/choice validated, stored with the authenticated
user, and only retain an email address when contact consent is set. Mail bodies
are plain text or autoescaped templates; Django rejects newline-bearing mail
headers. Logging uses ids instead of raw usernames, addresses, passwords,
tokens, or request bodies.

Production React contains no `dangerouslySetInnerHTML`, `innerHTML`, or raw
HTML markdown plugin. Rich text uses `react-markdown` defaults with regression
coverage for raw tags and unsafe protocols, and external links use safe rel
attributes. User-provided strings otherwise flow through React text nodes.

## Sessions, CORS, privacy, and settings

Authentication uses HttpOnly, SameSite session cookies; the readable CSRF
cookie is only the anti-CSRF value. Requests include credentials and the CSRF
header. Browser storage contains project/season ids and UI state, not session
or API credentials; the temporary invitation token is a narrowly scoped,
expiring capability and is cleared after use.

Production defaults disable `DEBUG`, reject the built-in development secret,
require non-loopback public/callback URLs, allowlist hosts and CORS/CSRF
origins, and enable secure cookies, HTTPS redirect, HSTS, nosniff, strict
referrer, and clickjacking controls. Credentialed CORS has no wildcard.
Account data export is self-scoped, omits password hashes, and includes shared
project data only for projects of which the requester is a member.

No additional DSGVO-relevant overexposure or sensitive logging was found.

## Dependencies and automated checks

- `npm audit --audit-level=high` reported zero vulnerabilities for the locked
  frontend graph.
- `uv export --project backend --no-dev --no-hashes --format requirements-txt`
  piped to `pip-audit` reported no known vulnerabilities for the locked
  production Python graph.
- Django's deployment check passed with explicit review-only production
  environment values.

The repository's CodeQL, dependency-review, scheduled audit, Dependabot, and
deployment-check automation remains present. Repository-level GitHub security
settings cannot be proven from this checkout.

## Deferred scope

The previous operational/dynamic items remain OPEN: production-like
penetration testing; the sibling `ops` repository (proxy/body limits, private
media serving, TLS, Redis/database exposure, secrets, backups, and log access
and retention); live OAuth tenants; GitHub branch/security settings;
malformed/animated-image fuzzing and aggregate-frame/resource limits; project
storage quotas; a report-only CSP rollout; and formula neutralization if a
server-generated spreadsheet export is introduced.
