# OpenFarmPlanner API

This guide explains the rules that apply across the OpenFarmPlanner REST API for
external clients: scripts, integrations and coding agents that authenticate with
a personal API token. Endpoints, fields and response shapes are not repeated
here. They are in the generated reference:

| What | Where |
|---|---|
| Reference (Redoc, this page) | [`/api/docs/`](/api/docs/) |
| Interactive reference (Swagger UI, "Try it out") | [`/api/docs/swagger/`](/api/docs/swagger/) |
| OpenAPI 3.1 document | [`/api/schema/`](/api/schema/) (YAML; `?format=json` for JSON) |
| Agent-specific crop schema | [`/api/agent/openapi.json`](/api/agent/openapi.json) (token required) |

All four are generated from the running server. The reference is public, but
every documented operation requires a token. The agent-specific schema is
generated from the same field specifications the crop validator enforces. It
adds units, plausible ranges and accepted input spellings (`x-unit`,
`x-plausible-minimum`, …) and is the better source when importing crop data.
See [External Tool API Tokens](https://github.com/OpenFarmPlanner/planner/blob/main/docs/agent-api.md)
for the full import workflow.

The reference lists **exactly the operations an API token can reach**. Other
endpoints of the web app (admin, moderation, account management and
frontend-only helpers) exist but are not part of the external API and may
change without notice.

## Authentication and token lifecycle

Send a project API token as a Bearer credential:

```http
Authorization: Bearer ofp_pat_…
```

- **Creating a token.** In the app go to *Account settings → API tokens for
  external tools* and choose a name, a project, a scope, and an optional expiry
  date (at most one year out). The token is shown **once**. Only a hash is
  stored, so a lost token cannot be recovered; create a new one instead.
- **One project per token.** A token is bound to the project it was created
  for. It cannot reach other projects, even ones its owner belongs to.
  Removing the owner from the project disables the token immediately.
- **Scopes.**

  | Scope | Allows |
  |---|---|
  | `read` | `GET` requests |
  | `write` | `read` plus `POST`, `PUT` and `PATCH` |
  | `delete` | `write` plus crop soft-delete (`DELETE`) and `undelete` |

- **Expiry and revocation.** Tokens stop working at their expiry date or when
  revoked in the account settings. Revocation is immediate and permanent.
- **Failures.** An unknown, expired or revoked token gets `401` with
  `WWW-Authenticate: Bearer realm="api"`. A request without any credentials
  gets `403` with `"Authentication credentials were not provided."`. A valid token outside its scope or
  allowlist gets `403` with a `detail` naming the rule. Tokens cannot manage
  tokens, accounts, members, invitations or other projects.
- **No CSRF.** Bearer requests need no CSRF token. Never commit a token to a
  repository or put it on a command line; keep it in a secret store or an
  untracked environment variable.

`GET /api/agent/context/` returns the project id, project name and scope of
the calling token. Call it first to confirm where writes will land.

## Project and season context headers

| Header | With an API token | Without a token (browser session) |
|---|---|---|
| `X-Project-Id` | Optional. The project always comes from the token; a header naming a *different* project is rejected with `403`. | Required on project-scoped endpoints: `400` when missing or not an integer, `403` when not a member. |
| `X-Season-Id` | Optional. | Optional. |

`X-Season-Id` never causes an error. A missing or non-integer value means "no
season context", and planting-plan lists then return all seasons. The
reference shows each header only on the operations that read it.

## Error format

Errors use JSON in one of these shapes:

- **Domain errors** carry a stable machine code plus an English explanation,
  and sometimes extra context fields:

  ```json
  {"code": "crop_name_conflict", "detail": "A general crop with this name already exists in this project."}
  ```

- **Validation errors** (`400`) map field names to lists of messages, e.g.
  `{"name": ["This field is required."]}`. Errors not tied to a field appear
  under `non_field_errors`.
- **Authentication, permission and not-found errors** use
  `{"detail": "…"}`. A `404` is also returned for objects in other projects,
  so their existence is not revealed.
- **Rate limits** (`429`) add `retry_after` (seconds) to the body; see
  [Rate limits](#rate-limits).

Branch on `code`, never on `detail`. Messages may be reworded; codes are stable
(see [Versioning and deprecation](#versioning-and-deprecation)).

### Error codes on the token surface

| Code | Status | Where | Meaning |
|---|---|---|---|
| `crop_name_conflict` | 409 | `POST`/`PUT`/`PATCH /api/crops/` | A general crop (empty Sorte) with this name already exists. See [Duplicate rule](#duplicate-rule). |
| `confirmation_required` | 400 | crop import apply | `confirm` was not `true`. |
| `checksum_mismatch` | 400 | crop import apply | The checksum does not belong to this draft. |
| `draft_expired` | 400 | crop import apply | Re-run the preview. |
| `draft_has_errors` | 400 | crop import apply | Blocked rows; the draft cannot be applied. |
| `warnings_not_acknowledged` | 400 | crop import apply | Send `acknowledge_warnings: true`. |
| `match_disappeared` | 400 | crop import apply | A matched crop was deleted after the preview. |
| `execution_failed` | 400 | crop import apply | A row failed to save; the whole import was rolled back. |
| `crop_name_required` | 400 | `publish-public` | The crop has no name. |
| `public_library_terms_required` | 400 | `publish-public` | Send `accepted_public_library_terms: true` once. |
| `public_crop_publishing_checks_failed` | 400 | `publish-public` | Data-quality checks failed; see `checks`. |
| `duplicate_public_crop` | 409 | `publish-public` | A similar library entry exists; see `duplicates`. |
| `public_crop_update_blocked` | 409 | `publish-public` | The library entry has a newer version this crop has not taken over. |
| `public_crop_link_unavailable` | 409 | `publish-public` | The linked entry was withdrawn or removed; see `reason`. |
| `crop_species_pending` | 409 | public crop update | The entry's species is awaiting moderation. |
| `pending_proposal_limit_exceeded` | 429 | library writes | Too many of your contributions are awaiting moderation. |
| `invalid_payload` | 400 | public crop update | The body must be a JSON object. |
| `api_token_required` | 403 | `/api/agent/context/` | Called without a token. |

## Pagination and filtering

List endpoints use page-number pagination:

```json
{"count": 240, "next": "https://…/api/crops/?page=2", "previous": null, "results": [ … ]}
```

- `?page=N` selects a page, and `?page_size=N` sets its size: 100 by default,
  at most 1000. Follow `next` until it is `null`.
- Filters are per endpoint and listed as query parameters in the reference,
  e.g. `include_deleted` on crops and `q` on suppliers (the supplier list is
  capped at 20 matches). There is no generic filter or ordering syntax.

## Multilingual fields

The UI languages are German (`de`) and English (`en`). Localized response
fields use the first match from:

1. the `?language=de|en` query parameter,
2. the token owner's stored language preference (unless "automatic"),
3. the `Accept-Language` header,
4. English.

Fields such as `crop_display_name` return the resolved text, and a matching
`*_language_code` field names the language actually used; it can differ when a
translation is missing. `crop_species_translations` returns every available
species name keyed by language code. User-entered text (names, varieties,
notes) is stored and returned as written, without translation.

## Crop values: Kultur, Sorte and inheritance

A crop row with an empty `variety` is the general **Kultur**. A row with a
`variety` is a **Sorte**. A Sorte linked to a `crop_species` inherits unset
planning fields (spacings, durations, seed rates, …) from its project's general
Kultur of the same species. Nothing is copied:

- Plain fields such as `row_spacing_cm` are the **raw** values stored on that
  row. A raw `null` on a Sorte means "inherited".
- `effective_values` carries the values actually in effect, and
  `inherited_fields` lists which of them came from the Kultur. Calculations
  in the app always use the effective values.
- Writing a value sets an override; clearing it restores inheritance.
- `crop_family`, `nutrient_demand` and `rotation_break_years` describe the
  species and cannot be overridden on a linked Sorte. A value sent for one is
  stored on the Kultur when it fills a gap there and rejected when it
  contradicts it.

Each affected field is marked accordingly in the reference.

## Duplicate rule

Crop identity is the normalized name plus normalized Sorte (`variety`) within a
project:

- **Empty Sorte:** creating or renaming a general crop to a name that already
  has a general crop returns **`409 crop_name_conflict`**, but only when the
  name is the only problem. If other fields also fail validation, you get a
  `400` listing all fields, including `name`.
- **Non-empty Sorte:** a duplicate name + Sorte pair is a plain `400`
  validation error on `name`. Several Sorten of the same Kultur are normal.
- `GET /api/crops/duplicate-check/?name=…&variety=…` checks both conditions
  without writing anything (`exists`, `name_exists`).
- Updating a row without changing its identity never trips the rule, so
  legacy duplicates stay editable.

## Public crop library write rules

The public crop library (Kulturbibliothek) is shared across all users and
licensed under CC BY-SA 4.0. Project crops relate to library entries in four
cases:

1. **Not linked:** `POST /api/crops/{id}/publish-public/` offers the crop
   to the library.
2. **Library has a newer version:** the project copy must take it over in the
   app first. A publish answers `409 public_crop_update_blocked` until then.
3. **Linked, with local changes:** `publish-public` proposes the changes as an
   update of the linked entry.
4. **Linked and in sync:** nothing to publish.

**Every library write made with an API token is moderated,** regardless of
the token's scope or the owner's trust level:

- `publish-public` answers `202` with `operation: "pending_moderation"` and a
  `change_proposal`; nothing goes live.
- `PUT`/`PATCH /api/public-crops/{id}/` answers `202` with the created change
  proposal instead of editing the entry.
- A moderator approves or rejects the proposal in the app. The number of
  pending proposals per account is capped (`429
  pending_proposal_limit_exceeded`).
- Send `X-Client-Declared-Type: agent` if your client is automated. It labels
  the proposal for moderators and moves your writes to the higher
  declared-agent rate limit. It is a self-declaration and grants no extra
  permissions.

Publishing requires accepting the library contribution terms once
(`accepted_public_library_terms: true`). Published data is licensed
irrevocably under CC BY-SA 4.0.

## Rate limits

Limits are counted per token and reset on a rolling window:

| Requests | Default limit |
|---|---|
| Reads (`GET`, `HEAD`, `OPTIONS`) | 2000 / hour |
| Writes | 300 / hour |
| Writes with `X-Client-Declared-Type: agent` | 600 / hour |

Operators can change these per deployment. When a limit is hit the API
answers `429` with a `Retry-After` header and `retry_after` in the body; wait
that many seconds. Moderated library contributions are additionally capped by
pending proposals, as above.

## Versioning and deprecation

- The API is currently unversioned and served under `/api/`. The schema's
  `info.version` is the OpenFarmPlanner release version, not an API version.
- **Additive changes** (new endpoints, new response fields, new optional
  parameters, new error codes) ship without notice. Ignore unknown fields.
- **Breaking changes** to documented operations (renamed paths or fields,
  removed fields, changed types or status codes) keep the old spelling working
  as a deprecated alias for a transition period. They are announced in
  [`CHANGELOG.md`](https://github.com/OpenFarmPlanner/planner/blob/main/CHANGELOG.md) before the alias is removed. Deprecated aliases
  are not listed in the reference.
- If a breaking change cannot be made compatible, it will be released under a
  new version prefix (`/api/v2/`) alongside the current API.
- Endpoints not in this reference carry no compatibility promise.

## Data licensing and privacy

- **Your project data** (crops, locations, beds, plans, tasks, suppliers) belongs
  to your project and is only reachable with that project's tokens. Using the
  API does not publish anything.
- **Public crop library contributions** are licensed under
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Reuse of
  library data requires attribution and share-alike.
- **Personal data.** Tokens act on behalf of the account that created them.
  Writes are recorded in the project history under that account's name.
  Responses can contain personal data of other
  project members (e.g. history actor names). Process it only as your use case
  requires, in line with the GDPR (DSGVO), and do not copy it into other
  systems unnecessarily. Your own account data can be exported and deleted in
  the app's account settings; these functions are not available with a token.
- The privacy policy and terms of use shown in the app apply to API use.

