# RFC: Admin-scoped API for crop taxonomy (species, synonyms, suggestion list)

**Status:** design decided (2026-10-02), not yet implemented. No code,
migrations, or permission changes have been made. This document was the
output of the "explore first, then plan" step requested before touching
auth/permissions or the DB schema; §6 records the decisions made on review.
Implementation still needs its own explicit go-ahead.

## 1. Motivation

The public `crop-data` research repository investigates crop knowledge and
syncs it into project crops via `ProjectApiToken`. Three things it cannot
push back today:

1. Official crop species (`CropSpecies`) and their per-language
   translations.
2. Synonyms and regional names (`austria`/`switzerland`) on a translation.
3. The link from a project's own `Crop` to the official `CropSpecies` it
   belongs to (`Crop.crop_species`).

Goal (long-term): everything steerable via API, DB as the single source of
truth, no data mirror in an external repo.

## 2. Correction to the starting assumption

The original framing was "these three areas are API-write-only-ever... no,
UI-only." That's not quite accurate for one of them:

**`CropSpecies` CRUD already exists as a session-authenticated API**, at
`/api/crop-species/` (`backend/crops/views.py::CropSpeciesViewSet`,
registered in `backend/crops/species_urls.py`, mounted in
`config/urls.py`). It already supports, for a user who passes
`is_public_library_moderator()` (`is_staff` or `is_superuser` or the
`crops.moderate_crop_species` permission):

- `PATCH`/`PUT` on a species, including its nested `translations` list
  (`common_name`, **`synonyms`**, **`regional_names`**) via
  `CropSpeciesSerializer._write_translations`.
- `DELETE` on a species.
- `POST /approve/`, `POST /reject/` on a pending proposal.
- `POST` to *propose* a new species (any authenticated user, not just
  moderators — becomes `status=proposed`).

So synonyms and regional names are *already* API-writable for a browser
session belonging to a moderator. The actual gap is narrower than the
original framing: **nothing here is reachable by a bearer token** (the
`ProjectApiToken` the crop-data repo already uses), and there is **no
endpoint for linking a project's private `Crop` to an official
`CropSpecies`** (that's set only through the publish-to-public-library
wizard — `frontend/src/pages/CropsPublishingWizardDialog.tsx` — not via a
standalone field on the `Crop` write endpoint).

There is also **no separate "suggestion list" entity.** The autocomplete is
just `services.search_crop_species()` ranking over published `CropSpecies`
+ their translations (name, synonyms, regional names, common names). The
seed file `backend/crops/seed_data.py` only matters for the initial data
migration and future `RunPython` migrations that merge into existing rows
(`docs/crop-taxonomy-guidelines.md`). Managing "the suggestion list" is
therefore not a fourth concern — it's the same `CropSpecies`/translation
CRUD described above, there is no separate list to expose.

## 3. Why a bearer token can't just be opted in today

`ProjectApiToken` (`backend/farm/models/agent_api.py`) is irreducibly bound
to a `(user, project)` pair — see `docs/agent-api.md`. `CropSpecies` is
global library data with no project at all. Opting `CropSpeciesViewSet`
into the existing `api_token_actions` allowlist would not work:

- `ApiTokenAccessPermission` and `ProjectScopedMixin`-style project
  filtering have nothing to scope by — there is no project on a species.
- Even if we skipped project scoping for this one view, the *authorization*
  question is different in kind: project tokens answer "is this user a
  member of this project," but species writes need "is this user a
  moderator of the whole public library," a platform-wide role that today
  is checked only via `is_public_library_moderator(request.user)` — which
  already works correctly for *any* authenticated `request.user`,
  regardless of how they authenticated.
- `docs/agent-api.md` lists "public crop-library moderation" explicitly
  under "not reachable with any token, in this version" — a deliberate
  exclusion, not an oversight. Changing that is a real architecture
  decision, not a one-line `api_token_actions` addition like the doc
  describes for ordinary cases.

There is also no existing "admin/platform token" concept to reuse.
`AgentLoginToken` is the only token-like thing that isn't project-bound,
but it mints a one-time **browser session** (CSRF-protected, not a bearer
credential, superuser-admin-created per use) — not ergonomic for a
recurring CI sync job, and explicitly scoped to "everything the session
user may do," which is broader than this use case needs.

## 4. Design options

### Option A (decided): new platform-scoped bearer token, reusing existing view logic unchanged

Add a new token type that authenticates a request as a specific user with
no project binding, then let the **existing** `is_public_library_moderator`/
`is_public_library_admin` checks in `CropSpeciesViewSet` do the authorization
exactly as they do today for session users. No view-logic changes needed —
only a new authentication path.

- **New model** `PlatformApiToken` (name mirrors `ProjectApiToken`'s shape
  minus the project FK): `user` FK, `token_hash`, `token_prefix` (distinct
  prefix, e.g. `ofp_plat_`, so it's never confused with `ofp_pat_` at a
  glance or in logs), `scope` (`read`/`write` only — no `delete` scope,
  since species deletion stays session-only per §6), `expires_at`,
  `revoked_at`. Created only by an
  existing platform admin (`is_public_library_admin`), from a new, small
  session-only self-service UI or Django admin — mirroring how
  `ProjectApiToken` creation itself is session-only and excluded from the
  token surface.
- **New authenticator** `PlatformApiTokenAuthentication`
  (`backend/farm/agent_api/authentication.py` or a new
  `backend/crops/agent_api/` module, naming TBD) — same hash-lookup and
  revoked/expired checks as `ProjectApiTokenAuthentication`, minus project
  membership. Returns `(user, token)`.
- **New deny-by-default allowlist**, mirroring `ApiTokenSurfaceMiddleware`'s
  role but keyed off the new token's own header prefix, so this stays
  independent of the existing `ProjectApiToken` surface and can't
  accidentally widen it. Views opt in explicitly (`platform_token_actions`
  or similar), scoped to exactly: `CropSpeciesViewSet` `list`, `retrieve`,
  `create`, `update`, `partial_update`. **`approve`, `reject`, and `destroy`
  stay session/moderator-only** — decided in §6, not token-reachable in the
  first version. A platform token can therefore propose and edit species
  (incl. synonyms/regional names), but publishing a proposal or deleting a
  species stays a human review step.
- **Permission check stays exactly `is_public_library_moderator`/
  `is_public_library_admin`.** The important property: a platform token only
  works as well as the user it's bound to — mint one for a non-moderator
  account and the existing view code still returns 403, with zero new
  authorization logic to get wrong.
- Rate limiting: reuse `farm.agent_api.throttling`'s pattern with a new
  scope key, so a compromised platform token can't be used to scrape or
  hammer the library endpoint unboundedly.

This keeps the two token concepts honestly separate (project-scoped vs.
platform-scoped) rather than overloading `ProjectApiToken` with an
unused/null project, which would make every existing "token is always bound
to exactly one project" invariant in `docs/agent-api.md` and its tests false
for this one row type.

### Option B: skip the new token type, use session auth via a dedicated service account

Create one dedicated, already-moderator Django user for the crop-data sync
job and have it authenticate the ordinary way (username/password →
session), hitting the *already-existing* `/api/crop-species/` endpoints
as-is. Zero new backend code.

- Pro: nothing to build, nothing new to secure-review.
- Con: session auth means CSRF handling, session/cookie lifecycle, and
  login-credential storage in CI instead of a revocable bearer token with
  an expiry — a materially weaker credential-hygiene story than the
  bearer-token model `docs/agent-api.md` chose deliberately for this exact
  kind of automation. Also no per-credential audit trail (`last_used_at`,
  named tokens, individual revocation) that `ProjectApiToken` already gives
  every other integration.

Mentioned for completeness; **Option A is the better fit** given the
project already solved this exact problem once for `ProjectApiToken` and
documented why bearer tokens beat session reuse for automation
(`docs/agent-api.md` §"Why a token and not agent-login").

## 5. `Crop.crop_species` linking endpoint (new, either option)

Independent of the token mechanism above, there's currently no endpoint at
all — session or token — to set `Crop.crop_species` outside the publishing
wizard flow. Needs its own small design pass:

- Who may set it: the project's own members (it's project data) — so this
  one *does* fit naturally into the existing `ProjectApiToken` surface
  (`api_token_actions` on `CropViewSet`, `write` scope), unlike species
  CRUD. Likely the simplest fix is exposing `crop_species` (write by ID) on
  the existing `CropSerializer`/`CropViewSet` rather than a new endpoint,
  with validation that the target `CropSpecies` is `published` (mirrors
  the publish-wizard's own constraint — needs confirming against
  `CropsPublishingWizardDialog.tsx`'s actual validation before reuse).
  This part does not need Option A/B at all.
  
## 6. Decisions (reviewed 2026-10-02)

1. **Role scope: reuse the existing moderator shape.** The platform token
   does not introduce a new admin-role concept. It authenticates a specific
   user with no project binding; authorization stays exactly
   `is_public_library_moderator()`/`is_public_library_admin()`, unchanged.
   A token only works as well as the moderator account it's bound to.
2. **`approve`/`reject` stay session-only.** A platform token can propose
   and edit species (incl. synonyms/regional names) but cannot publish a
   proposal or reject one — that review step stays human, even for
   automated syncs. Reflected in the allowlist in §4.
3. **`destroy` stays session-only.** Species deletion is not token-reachable
   in the first version, consistent with `docs/agent-api.md`'s existing
   stance that deletion is `ProjectApiToken`'s narrowest, most deliberately
   restricted scope. The new `PlatformApiToken` therefore only ever needs a
   `read`/`write` scope, no `delete`.
4. **`Crop.crop_species` linking (§5) is explicitly deferred**, reviewed
   separately from this token design. It already fits the existing
   `ProjectApiToken` surface (project-scoped, `write` scope) rather than the
   new platform token, so the two pieces of work don't block each other —
   but it still needs its own look at the publish-wizard's validation and
   `PublicCrop` relink logic
   (`crops.services.apply_public_crop_species_relinks_for_approved_species`)
   before implementation.
5. **Migration/rollout** (not yet written): a new `PlatformApiToken` model
   needs its own migration and a small session-only creation UI (mirroring
   `ProjectApiToken`'s account-settings card), to be scoped when
   implementation is greenlit.
6. **Backward compatibility confirmed additive.** None of this changes any
   existing `ProjectApiToken` behavior, endpoint, or schema. The generated
   `/api/agent/openapi.json` and `/api/schema/` references gain new
   operations once `CropSpeciesViewSet` opts the platform token in, same as
   any other surface addition; `farm/tests/test_public_api_schema.py` needs
   updating in the same change per `docs/agent-api.md`.

## 7. What this RFC deliberately does not cover

- Read-only SSH/DB access to the production server for `crop-data` research
  — out of scope, belongs in the `ops` repo per the original ask.
- Any actual implementation — endpoints, migrations, or permission classes.
  The design in §4/§6 is decided; implementation itself still needs its own
  go-ahead before any of it is written.
