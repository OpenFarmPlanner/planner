# Crop Library API Tokens

A second, independent bearer-token type for the crop-taxonomy API
(`CropSpecies`, its translations, synonyms, and regional names). Implements
the design decided in
[`rfc-crop-taxonomy-admin-api.md`](./rfc-crop-taxonomy-admin-api.md); read
that first for the "why" and the alternatives considered.

## Why a second token type

[`agent-api.md`](./agent-api.md)'s `ProjectApiToken` is irreducibly bound to
a `(user, project)` pair — `CropSpecies` is global library data with no
project at all, so that token can never reach it, and the crop-library
moderation surface is explicitly excluded from it on purpose. This token
exists instead:

| | `ProjectApiToken` | `CropLibraryApiToken` |
|---|---|---|
| Bound to | one user, one project | one user only |
| Reaches | project data (`/api/crops/`, …) | `/api/crop-species/` only |
| Scopes | `read` / `write` / `delete` | `read` / `write` |
| Created by | any project member, for themselves | a platform admin, for themselves |
| Header prefix | `ofp_pat_` | `ofp_clt_` |

The two are deliberately kept independent end to end — separate models,
separate authenticators, separate deny-by-default surface middleware,
separate throttle scopes — rather than adding an optional project FK to
`ProjectApiToken`, which would have made every "a token is always bound to
exactly one project" invariant in `agent-api.md` false for this one row
type.

## Authorization rides on the user, not the token

The token carries no role of its own. Every request it authenticates still
goes through exactly the same checks a browser session would:
`is_public_library_moderator(request.user)` for editing a species,
`is_public_library_admin(request.user)` for granting moderator access. A
token is therefore only ever as powerful as the account it is bound to —
revoking someone's moderator status also revokes what their token can do,
with no separate step.

## What is and isn't reachable

Reachable (`write` scope required for anything but GET):

| Endpoint | Notes |
|---|---|
| `GET /api/crop-species/`, `GET /api/crop-species/{id}/` | Same visibility rules as a session request — a non-moderator only sees published, mapping-eligible species; pass `?include_proposed=true` to see pending proposals as a moderator. |
| `POST /api/crop-species/` | Propose a new species. Any authenticated user may propose; not moderator-gated. |
| `PATCH`/`PUT /api/crop-species/{id}/` | Edit a species, including its nested `translations` — `common_name`, **`synonyms`**, and **`regional_names`**. Requires the bound user to be a moderator. |

Explicitly **not** reachable with this token, in this version (decided in
the RFC's §6, not an oversight):

- `POST /api/crop-species/{id}/approve/`, `POST /api/crop-species/{id}/reject/`
  — publishing or rejecting a proposal stays a human review step, even for
  automated syncs.
- `DELETE /api/crop-species/{id}/` — species deletion stays
  session/moderator-only, consistent with how `ProjectApiToken` treats
  deletion as its narrowest, most deliberately restricted scope.
- Everything else in the API. `CropLibraryTokenSurfaceMiddleware` refuses
  this token outright for any view that doesn't declare
  `crop_library_token_actions` — including `/api/crops/`,
  `/api/public-crops/`, and token self-service itself (a crop-library token
  cannot mint another token, same rule as `ProjectApiToken`).

The `Crop.crop_species` link (a project's own crop pointing at an official
species) is a separate piece of work, deferred in the RFC — it isn't part of
this token's surface, and doesn't need to be: it fits the existing
`ProjectApiToken` surface instead, since it's project data.

## Getting a token

Session-authenticated only, and restricted to platform admins
(`is_staff`/`is_superuser`): there is no dedicated frontend page yet (see
"Known limitations" below). An admin creates one from their own
authenticated session, e.g. with the browser dev tools or `curl` carrying
the session cookie and CSRF token:

```bash
curl -sS -X POST "$OFP_API/crop-library-tokens/" \
  -H "Content-Type: application/json" \
  -H "X-CSRFToken: $CSRF_TOKEN" \
  -b "$SESSION_COOKIE" \
  -d '{"name": "crop-data sync", "scope": "write"}'
```

The plaintext token is returned exactly once, in the response body — it is
not stored and cannot be retrieved again. Tokens are always bound to the
creating admin; there is no "create for another user" option.

```bash
curl -sS "$OFP_API/crop-library-tokens/" -b "$SESSION_COOKIE"
curl -sS -X DELETE "$OFP_API/crop-library-tokens/<id>/" \
  -H "X-CSRFToken: $CSRF_TOKEN" -b "$SESSION_COOKIE"
```

## Using a token (curl)

```bash
read -rs OFP_CROP_LIBRARY_TOKEN && export OFP_CROP_LIBRARY_TOKEN
curl -sS "$OFP_API/crop-species/?include_proposed=true" \
  -H "Authorization: Bearer $OFP_CROP_LIBRARY_TOKEN"

curl -sS -X PATCH "$OFP_API/crop-species/42/" \
  -H "Authorization: Bearer $OFP_CROP_LIBRARY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "translations": [
          {
            "language_code": "de",
            "common_name": "Tomate",
            "synonyms": ["Paradeiser"],
            "regional_names": {"austria": "Paradeiser"}
          }
        ]
      }'
```

If a token is wrong, expired, or revoked, the API answers `401` with
`WWW-Authenticate: Bearer realm="api"` (same contract as `ProjectApiToken`).
If the token is valid but the endpoint, action, or scope is not, it answers
`403`.

## Known limitations

- **No dedicated frontend UI yet.** Token self-service exists only as the
  DRF endpoint at `/api/crop-library-tokens/`; there is no account-settings
  card for it (unlike `ProjectApiToken`). Follow-up work, not blocking the
  API itself.
- **Not published in the general `/api/schema/` reference.** That schema is
  filtered to the `ProjectApiToken` allowlist (`api_token_actions`) by
  construction — see `farm/agent_api/schema.py`. This token uses its own,
  separately-named allowlist (`crop_library_token_actions`), so it does not
  appear there. Nothing prevents adding a dedicated schema extension later
  if this token grows a wider audience.
- **One scope split, no delete.** Only `read`/`write` — there was no
  decided use case for token-driven species deletion; see the RFC if that
  changes.
- **`Crop.crop_species` linking is not part of this surface** — deferred
  separately, see above.

## Where the code lives

| Path | Contents |
|---|---|
| `backend/crops/models.py` | `CropLibraryApiToken` |
| `backend/crops/agent_api/authentication.py` | bearer authentication |
| `backend/crops/agent_api/permissions.py` | scope/action allowlist rules |
| `backend/crops/agent_api/middleware.py` | surface allowlist above DRF |
| `backend/crops/agent_api/throttling.py` | per-token read/write rate limits |
| `backend/crops/agent_api/views.py`, `backend/crops/agent_api/serializers.py` | token self-service |
| `backend/crops/token_urls.py` | mounts the self-service viewset |
| `backend/crops/views.py::CropSpeciesViewSet` | the one opted-in view (`crop_library_token_actions`) |
