# Security review baseline — 2026-09-05

This document records the manual security review performed on 2026-09-05 so a
future review can start from the remaining risks instead of repeating the same
inventory. The reviewed base was commit `155568a`; the fixes and this record
are in the commit containing this document.

## Reviewed surfaces

The review covered:

- Django production security settings, middleware, cookies, CORS, CSRF,
  password validators, OAuth configuration, and deployment checks;
- session authentication, project-bound API tokens, agent-mode sessions, and
  the central project membership boundary;
- project-scoped REST viewsets and direct object lookups, with particular
  attention to history restore and relational serializer fields;
- notification and public-crop discussion WebSocket authentication, origin
  validation, and group selection;
- image upload validation, storage ownership, and resource limits;
- crop spreadsheet preview/apply project scoping;
- frontend raw-HTML sinks and external-link handling;
- locked Python and npm dependencies; and
- the repository's CodeQL, dependency review, dependency audit, Dependabot,
  and Django deployment-check workflows.

Commands used for the review included targeted `rg` inventories of routes,
permissions, relational lookups, raw HTML, and external URLs; Bandit over the
backend; `pip-audit` over the PDM environment; `npm audit`; Django deployment
checks; and the relevant backend/frontend test and lint suites.

## Confirmed findings and remediation

### Cross-project crop restore (high)

The crop-specific restore action fetched a crop from the unscoped soft-delete
manager. A member who knew another project's crop and revision identifiers
could therefore restore that crop. The lookup is now constrained to the
request's already-validated active project, with a regression test asserting a
cross-project request receives `404`.

### Cross-project media references (high)

`MediaFile` records had no owner and `CropSerializer.image_file_id` accepted
the global media queryset. A project member who guessed another upload's ID
could attach it to their own crop and obtain its storage path. Media records
now carry a project owner, uploads assign that owner, and crop validation
rejects media from any other project. The data migration assigns each legacy
file to its first referencing project and clears any legacy references from
other projects; unreferenced legacy files remain ownerless for the existing
orphan cleanup process.

### Dormant raw-HTML Gantt icon sink (medium, defense in depth)

The vendored Gantt task list exposed an unused `showIcon` option that inserted
the caller's icon string with React's `dangerouslySetInnerHTML`. No application
caller enabled the option, so this was not currently reachable from stored
user data. The unused option and string field were removed rather than adding
a sanitizer or retaining a latent XSS sink.

### Image decompression and dependency findings

The immediately preceding security change capped image pixel counts before
Pillow verification/decoding and refreshed dependencies reported by the
advisory scanners. Those protections remain part of this baseline.

### External base URL validation (medium, configuration hardening)

`PUBLIC_FRONTEND_URL` previously accepted any absolute URI scheme, and the
separately configurable OAuth callback base did not receive equivalent
validation. Both settings now require an absolute HTTP(S) URL without embedded
credentials, a query string, or a fragment; both also reject loopback hosts
outside development and test environments. This prevents a malformed or
injected deployment value from generating unsafe account-email or OAuth URLs.

## CI follow-up

The CI-equivalent `compilemessages` command was reproduced with Python 3.12.
Because the PDM virtual environment lives below `backend/`, Django recursively
visited dependency locale trees in `.venv`, producing very large logs and
doing unnecessary work. The shared PDM command now ignores `.venv`, while
continuing to compile repository-owned translations before backend tests.

## Reviewed controls with no confirmed defect

- API tokens derive their project from the token row, re-check active user,
  project, and membership state, and are rejected by middleware on endpoints
  that did not explicitly opt in.
- Agent-mode sessions reject a mismatching project header and cannot perform
  project-administrator actions.
- WebSockets use `AllowedHostsOriginValidator` and session authentication.
  Notification groups are derived from the authenticated user; public-crop
  discussions expose only invalidation identifiers for published, visible
  entries.
- Spreadsheet supplier and crop matching is constrained to the active project;
  serializer validation rejects cross-project supplier relationships.
- Bandit reported no high-severity findings. Its three medium findings were
  reviewed as non-exploitable: development LAN host discovery mentioning
  `0.0.0.0`, parameterized SQL whose placeholder count is generated from an
  integer list length, and equivalent SQL in a migration test.

## Not covered or requiring a separate future review

The following work should not be considered completed by this review:

- dynamic penetration testing against a deployed production-like stack;
- the sibling `ops` repository, including reverse-proxy limits, TLS, Redis,
  database exposure, media authorization/caching, backups, and secret storage;
- GitHub repository settings that cannot be verified from workflow files:
  branch rules, secret scanning, push protection, and security-alert access;
- OAuth interaction with real Google and Microsoft tenants;
- load testing, malformed-image fuzzing, animated-image aggregate frame limits,
  and project-wide storage quotas;
- a report-only Content Security Policy rollout; and
- spreadsheet formula-injection protection for any future server-generated
  CSV/XLSX export. The current browser-side import does not execute formulas on
  the server, but exported user-controlled cells would need neutralization.

## When to repeat or extend the review

Do not repeat the entire inventory for an unrelated change. Start from this
baseline and review the affected boundary whenever a change adds or modifies:

- an endpoint, custom action, serializer relationship, restore flow, or bulk
  operation;
- authentication, OAuth, invitations, API tokens, agent sessions, or project
  selection;
- a WebSocket route, consumer, group, or event payload;
- an upload, import, export, markdown/HTML renderer, or external URL;
- security headers, cookies, CORS/CSRF, proxy trust, or deployment settings; or
- dependencies or CI workflow permissions.

Run the automated dependency and static checks on every such change. Perform a
new full review after a major authentication/tenancy redesign, before the first
production launch, after a significant incident, or at least annually. Create
a new dated document and replace this link in `docs/index.md`; move this file
to `docs/security-review-archive/` if that directory is introduced.
