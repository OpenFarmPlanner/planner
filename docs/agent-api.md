# External Tool API Tokens

How external tools (coding agents such as Codex or Claude Code, scripts, CI
jobs, and other automations) authenticate against OpenFarmPlanner and import
crop data safely.

There is **no separate agent API**. Agents call the same endpoints the browser
calls, backed by the same serializers, the same `Crop.clean()`, and the same
project scoping. What this feature adds is a second credential type for
external, non-browser clients, a set of rules that narrow what that credential
can reach, and a two-step import flow that refuses to guess.

## Contents

- [Why a token and not `agent-login`](#why-a-token-and-not-agent-login)
- [Security model](#security-model)
- [Permissions](#permissions)
- [Getting a token](#getting-a-token)
- [Using a token (curl)](#using-a-token-curl)
- [Machine-readable schema](#machine-readable-schema)
- [Crop fields, units, and bounds](#crop-fields-units-and-bounds)
- [Validation rules](#validation-rules)
- [The two-step import flow](#the-two-step-import-flow)
- [Idempotency and duplicates](#idempotency-and-duplicates)
- [Known limitations](#known-limitations)

## Why a token and not `agent-login`

`AgentLoginToken` (`/agent-login/<token>/`) already exists, but it solves a
different problem and is not a substitute:

| | `AgentLoginToken` | `ProjectApiToken` |
|---|---|---|
| Creator | superusers only, via Django admin | any project member, from account settings |
| Effect | logs in and starts a **browser session** | authenticates a **single request** |
| Reuse | one-time | reusable until expiry or revocation |
| CSRF | required (it is a session) | not required |
| Scopes | none | `read` / `write` / `delete` |
| Surface | everything the session user may do | an explicit allowlist |

`agent-login` remains what it was: a superuser convenience for opening the app
as an agent. Everything below concerns `ProjectApiToken` only.

## Security model

Five independent mechanisms, each of which would have to fail for a token to
exceed its remit.

**1. Storage.** `ProjectApiToken` keeps a SHA-256 digest and a short, non-secret
display prefix. The plaintext exists only in the HTTP response that created it.
A plain digest is appropriate here — unlike a password, the input is 256 bits of
`secrets.token_urlsafe` output, so there is no low-entropy candidate space to
enumerate and no benefit from stretching.

**2. Project binding.** `farm.project_context.get_active_project_or_400` reads
the project from the token row and never from the request when a token is
present. An `X-Project-Id` header naming a different project is *rejected* (403)
rather than ignored, so a misconfigured agent fails loudly instead of quietly
writing into the wrong place. Membership is re-checked on every request:
removing someone from a project immediately kills the tokens they made for it.

**3. Surface allowlist (middleware).** `ApiTokenSurfaceMiddleware` runs before
the view and refuses any token request whose resolved view does not declare
`api_token_actions`. It sits above DRF, so a view that sets its own
`permission_classes` — several account endpoints do — cannot accidentally opt
itself in, and neither can Django admin or any non-DRF view.

> The middleware sees the raw header, the authenticator sees it through DRF.
> Both therefore share one detection helper, `header_carries_api_token()`. This
> matters: HTTP auth schemes are case-insensitive and DRF splits on arbitrary
> whitespace, so `bearer …`, `BEARER …`, and `Bearer  …` all authenticate. A
> narrower check in the middleware would let those spellings authenticate while
> staying invisible to the gate — for views with their own `permission_classes`
> the gate is the only control, so that is a full bypass, not a cosmetic gap. A
> test asserts the invariant that detection is never narrower than
> authentication.

**4. Scope and action check (DRF permission).**
`ApiTokenAccessPermission` additionally verifies the specific action, refuses
`DELETE` unless the token carries the dedicated `delete` scope, and refuses
unsafe methods for `read` tokens.

**5. Queryset scoping.** `ProjectScopedMixin` filters every queryset by the
active project, so a guessed object id from another project returns 404 on read
and on write alike.

Session authentication is untouched by all of this. Both authenticators are
registered; the token authenticator returns `None` unless the request carries an
`Authorization: Bearer ofp_pat_…` header, and every rule above is gated on a
token actually being present.

### CSRF

DRF views are CSRF-exempt at the middleware level; only `SessionAuthentication`
re-introduces the check. `ProjectApiTokenAuthentication` does not, so token
clients need no CSRF token. That is correct rather than a shortcut: a bearer
token is not ambiently attached by the browser, so it is not subject to
cross-site request forgery. Browser sessions keep requiring `X-CSRFToken`
exactly as before.

## Permissions

Three scopes:

| Scope | HTTP methods | May do |
|---|---|---|
| `read` | `GET`, `HEAD`, `OPTIONS` | read the bound project's data |
| `write` | `read` + `POST`, `PUT`, `PATCH` | additionally create and update crops, and run imports |
| `delete` | `write` + allowlisted `DELETE` | additionally soft-delete and restore crops |

Reachable endpoints (everything else returns 403 for tokens):

| Endpoint | `read` | `write` | `delete` |
|---|---|---|---|
| `GET /api/crops/`, `GET /api/crops/{id}/` | ✅ | ✅ | ✅ |
| `POST /api/crops/`, `PATCH`/`PUT /api/crops/{id}/` | ❌ | ✅ | ✅ |
| `DELETE /api/crops/{id}/`, `POST /api/crops/{id}/undelete/` | ❌ | ❌ | ✅ |
| `GET /api/crops/duplicate-check/`, `GET /api/crops/{id}/history/` | ✅ | ✅ | ✅ |
| `POST /api/crop-imports/preview/` | ❌ | ✅ | ✅ |
| `GET /api/crop-imports/{draft_id}/` | ✅ | ✅ | ✅ |
| `POST /api/crop-imports/{draft_id}/apply/` | ❌ | ✅ | ✅ |
| `GET /api/agent/context/` | ✅ | ✅ | ✅ |
| `GET /api/suppliers/`, `/seed-packages/`, `/crop-supplier-data/` | ✅ | ✅ | ✅ |
| `GET /api/locations/`, `/fields/`, `/beds/`, `/planting-plans/`, `/tasks/` | ✅ | ✅ | ✅ |
| `GET /api/agent/openapi.json` | ✅ | ✅ | ✅ |

Explicitly **not** reachable with any token, in this version:

- every `DELETE` except crop soft-delete with a `delete` token
- project members, invitations, project switching, project create/delete
- account settings, `/api/auth/*`, data export, consent
- API-token management itself — a token cannot mint another token
- Django admin
- history restore endpoints
- public crop-library moderation

Opting a new endpoint in is a deliberate one-line change: add
`api_token_actions = {...}` to the view.

## Getting a token

In the app: **Account settings → API tokens for external tools**. Choose a name,
the project, `read`, `write`, or `delete`, and optionally an expiry date (at
most one year out). The plaintext is shown once, in a dialog, with an explicit
note that it cannot be retrieved again.

After creation, tokens are shown in a MUI DataGrid table inside the account
settings card. Active tokens are listed directly with these columns:

| Column | Meaning |
|---|---|
| Name | User-provided token name; hovering exposes the non-secret display prefix |
| Rights | `read`, `write`, or `delete` as a compact rights label |
| Project | The project the token is permanently bound to |
| Created | Creation timestamp |
| Expires | Expiry timestamp, or "no expiry date" |
| Last used | Last successful authentication timestamp, or "never" |
| Action | Revoke button for active tokens |

Expired and revoked tokens stay visible from the same account settings card,
but are grouped behind a collapsed section below the active tokens:
**Abgelaufene und widerrufene Tokens anzeigen (N)** in the German UI. Opening
that section renders the same table shape without the **Action** column,
because inactive tokens cannot be revoked again.

Revoking is immediate and permanent; a revoked token is never reactivated.

> **Never commit a token.** Not to this repository, not to any other, not into
> an agent's configuration file that is tracked by git. Keep it in your agent's
> secret storage or an untracked environment variable. No example in this
> repository contains a real token, and none ever should.

## Using a token (curl)

Put the token in an environment variable — never on the command line, where it
lands in your shell history:

```bash
read -rs OFP_TOKEN && export OFP_TOKEN
export OFP_API="https://your-openfarmplanner-host/api"
```

Read the crops of the bound project. No `X-Project-Id` is needed — the server
derives the project from the token:

```bash
curl -sS "$OFP_API/crops/" \
  -H "Authorization: Bearer $OFP_TOKEN"
```

Fetch the machine-readable schema:

```bash
curl -sS "$OFP_API/agent/openapi.json" \
  -H "Authorization: Bearer $OFP_TOKEN"
```

Check which project the token is bound to before writing:

```bash
curl -sS "$OFP_API/agent/context/" \
  -H "Authorization: Bearer $OFP_TOKEN"
```

The response contains only non-secret token context:

```json
{
  "project_id": 1,
  "project_name": "Market Garden",
  "token_scope": "write"
}
```

Update one crop (requires `write`):

```bash
curl -sS -X PATCH "$OFP_API/crops/42/" \
  -H "Authorization: Bearer $OFP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"growth_duration_days": 75}'
```

Preview an import — this writes no crop data:

```bash
curl -sS -X POST "$OFP_API/crop-imports/preview/" \
  -H "Authorization: Bearer $OFP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "source_label": "bestellung-2026.csv",
        "items": [
          {"name": "Brokkoli", "variety": "Calabrese", "row_spacing_cm": 50},
          {"name": "Karotte", "variety": "Nantaise", "row_spacing_m": 0.3}
        ]
      }'
```

The response carries `draft_id`, `checksum`, a `summary`, and the per-field
analysis. Review it, then execute exactly that draft:

```bash
curl -sS -X POST "$OFP_API/crop-imports/<draft_id>/apply/" \
  -H "Authorization: Bearer $OFP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"confirm": true, "checksum": "<checksum from the preview>", "acknowledge_warnings": true}'
```

If a token is wrong, expired, or revoked, the API answers `401` with
`WWW-Authenticate: Bearer realm="api"`. If the token is valid but the endpoint
or scope is not, it answers `403` with a `detail` explaining which rule applied.

## Machine-readable schema

`GET /api/agent/openapi.json` returns an OpenAPI 3.1 document covering exactly
the endpoints listed above. It is **generated** from
`farm/services/crop_import/field_specs.py`, the same module the validator
reads, so a documented bound and an enforced bound cannot drift apart. A test
asserts that equivalence.

Beyond standard JSON Schema, the crop schema uses five extensions:

| Extension | Meaning |
|---|---|
| `x-unit` | the canonical unit of the value (`m`, `days`, `g`, `percent`, `kg`) |
| `x-plausible-minimum` / `x-plausible-maximum` | the ordinary range; outside it the value is accepted but warned about |
| `x-requires` | the companion field that must be sent together with this one |
| `x-accepted-input-keys` | alternative input spellings, e.g. `row_spacing_cm` for `row_spacing_m` |
| `x-unit-value-constraints` | unit-dependent value constraints for seed rates, e.g. integer-only `seeds_per_plant` |

`minimum` / `maximum` / `exclusiveMinimum` carry the *hard* bounds — values
outside them are rejected.

## Crop fields, units, and bounds

Distances are stored in SI metres, and the canonical field names say so:
`row_spacing_m`, `distance_within_row_m`, `sowing_depth_m`. An agent never has
to guess a unit from a field name.

The import endpoints also accept `_cm` and `_mm` spellings and convert them. The
bare spelling (`row_spacing`) carries no unit and is only usable when the value
itself states one (`"50 cm"` or `{"value": 50, "unit": "cm"}`).

| Field | Unit | Hard range | Plausible range |
|---|---|---|---|
| `row_spacing_m` | m | > 0 … 3 | 0.05 … 1.5 |
| `distance_within_row_m` | m | > 0 … 3 | 0.01 … 1.5 |
| `sowing_depth_m` | m | 0 … 0.5 | 0.002 … 0.15 |
| `growth_duration_days` | days | 0 … 1095 | 5 … 400 |
| `harvest_duration_days` | days | 0 … 730 | … 240 |
| `propagation_duration_days` | days | 0 … 365 | … 120 |
| `expected_yield` | kg | 0 … 100000 | … 500 |
| `thousand_kernel_weight_g` | g | > 0 … 2000 | 0.05 … 500 |
| `sowing_calculation_safety_percent_direct` | percent | 0 … 100 | … 50 |
| `sowing_calculation_safety_percent_pre_cultivation` | percent | 0 … 100 | … 50 |
| `seed_rate_direct_value` | see its `_unit` | > 0 … 100000 | depends on the unit |
| `seed_rate_pre_cultivation_value` | see its `_unit` | > 0 … 100000 | depends on the unit |

For direct crop create/update, agents should prefer the `seed_requirements`
object over the flat `seed_rate_*` fields:

```json
{
  "cultivation_types": ["pre_cultivation"],
  "seed_requirements": {
    "pre_cultivation": {
      "value": 2,
      "unit": "seeds_per_plant",
      "safety_percent": 10
    }
  }
}
```

`seed_requirements` is a **rate**, not a shopping total. Its keys are cultivation
methods (`pre_cultivation`, `direct_sowing`), and its units say whether the rate
is per square metre, row metre, or target plant. The server stores this into the
existing method-specific fields (`seed_rate_pre_cultivation_*` or
`seed_rate_direct_*`) so browser workflows and seed-demand calculations keep
working. If an agent sends both `seed_requirements` and the flat fields, they
must agree.

Use examples:

```json
{
  "name": "Tomate",
  "variety": "San Marzano",
  "cultivation_types": ["pre_cultivation"],
  "seed_requirements": {
    "pre_cultivation": {"value": 2, "unit": "seeds_per_plant"}
  }
}
```

```json
{
  "name": "Karotte",
  "variety": "Nantaise",
  "cultivation_types": ["direct_sowing"],
  "seed_requirements": {
    "direct_sowing": {"value": 1.5, "unit": "g_per_m2", "safety_percent": 10}
  }
}
```

The older `seeding_requirement` / `seeding_requirement_type` pair is legacy
planning metadata. Do not use it for agent imports or researched variety seed
rates. Total seed demand is calculated later from planting area or plant count.

Seed-rate units are the project's existing vocabulary from `farm/seed_units.py`
and nothing else: `g_per_m2`, `g_per_lfm`, `seeds_per_m2`, `seeds_per_lfm`,
`seeds_per_plant`. Synonyms (`g/m²`, `Korn / Pflanze`, …) are normalized to
those five on the way in; a spelling that normalizes to nothing is rejected, so
no new unit string ever reaches the database.

Plausible seed-rate bands, applied once the unit is known:

| Unit | Plausible |
|---|---|
| `g_per_m2` | 0.01 … 100 |
| `g_per_lfm` | 0.01 … 50 |
| `seeds_per_m2` | 0.1 … 2000 |
| `seeds_per_lfm` | 0.1 … 500 |
| `seeds_per_plant` | 1 … 10 |

Seed-rate units can also impose value-shape constraints. These rules are
defined in `farm/services/crop_import/field_specs.py`, exposed through
`x-unit-value-constraints` in OpenAPI, and served to the browser form at
`GET /api/crops/seed-rate-constraints/`. The API enforces the same rules:
`seeds_per_plant` requires a whole-number value, so `1.1` is rejected rather
than rounded. Gram-based units remain decimal-capable.

Enums: `nutrient_demand` (`low`/`medium`/`high`), `harvest_method`
(`per_plant`/`per_sqm`), `cultivation_types`
(`pre_cultivation`/`direct_sowing`). German spellings (`hoch`, `Anzucht`,
`Direktsaat`) are normalized; anything else is rejected.

## Validation rules

`name` is the only required field. Everything else is optional, and an absent
field is left untouched rather than reset.

Species-level general data uses the same private `Crop` endpoint and fields
as variety-specific data. Send `variety` as an empty string or `null` (or omit
it when creating the row); the API stores all three forms as an empty string.
Duplicate detection treats the resulting `(name, empty variety)` identity like
any other crop identity. On update, omitting `variety` leaves it unchanged.

Rejected (the row becomes `blocked` and the draft cannot be applied):

- a number whose unit is stated nowhere — in the key, the value, or an explicit
  `unit` member. `{"row_spacing": 30}` is **not** read as 30 m.
- an unknown unit. No conversion is invented.
- a value outside the hard range. `{"row_spacing_m": 30}` is refused as a unit
  mistake, while `{"row_spacing_cm": 30}` is accepted as 0.3 m.
- a seed-rate value without its unit, or a unit without its value.
- a seed-rate unit outside the canonical five.
- an enum value that does not normalize to an allowed value.
- a fractional day count, an invalid `#RRGGBB` colour, or an over-long text
  (which is refused, not truncated).
- a missing name.
- two rows in one payload that resolve to the same crop.

Warned about (accepted, but shown in the preview and requiring
`acknowledge_warnings` before execution):

- a value inside the hard range but outside the plausible band — an unusually
  small or large spacing, an extreme seed rate, a very long harvest window.
- a seed rate given for a cultivation type the crop does not list.

Ignored and reported, never guessed:

- keys that are not part of the crop schema. An order export's
  `article_no`, `package_size`, `price_eur`, or `order_quantity` land under
  `ignored_fields` with `code: "unknown_field"`. A `product_name` is never
  folded into `variety`, and a package size is never read as a seed rate.
- two input keys mapping to the same API field; the second is reported as
  `duplicate_key` rather than silently overriding the first.

## The two-step import flow

```
POST /api/crop-imports/preview/      →  analysis + draft_id + checksum   (no writes)
                    ↓ human or agent reviews the table
POST /api/crop-imports/{id}/apply/   →  {"confirm": true, "checksum": …}  (writes)
```

**Preview** analyzes the payload against the field specs and the project's
existing crops, then stores the result as a `CropImportDraft` (TTL 2
hours). It touches no crop data at all.

Per row it reports `action` (`create` / `update` / `skip` / `blocked`),
`identity`, `matched_crop_id`, `ignored_fields`, and per field:

| Key | Meaning |
|---|---|
| `source_key` | the key exactly as sent |
| `source_value` | the value exactly as sent |
| `source_unit` | the unit detected in the source, or `null` |
| `api_value` | the normalized value that would be stored, or `null` |
| `api_unit` | the canonical unit |
| `confidence` | `exact` / `converted` / `needs_clarification` / `invalid` |
| `current_value` | what is stored today, when a crop matched |
| `changes_existing` | whether applying would change it |
| `warnings`, `errors` | machine codes plus human messages |

Rendered as a table, the two cases from the specification look like this:

| Crop | Field | Source value | API value | Status |
|---|---|---:|---:|---|
| Brokkoli | `row_spacing_m` | 50 cm | 0.5 m | `converted` |
| Karotte | `seed_rate_direct_value` | 5, no unit | – | `needs_clarification` |

**Apply** re-reads the stored draft — it never re-analyzes a payload sent with
the apply call — and refuses unless all of the following hold:

| Refusal `code` | Cause |
|---|---|
| `confirmation_required` | `confirm` was not `true` |
| `checksum_mismatch` | the confirmed checksum is not this draft's |
| `draft_expired` | the draft is older than its TTL |
| `draft_has_errors` | at least one row is `blocked` |
| `warnings_not_acknowledged` | the draft has warnings and `acknowledge_warnings` was not `true` |
| `match_disappeared` | a matched crop was deleted between preview and apply |
| `execution_failed` | a serializer rejected a row; everything was rolled back |

The checksum is what turns "the preview I reviewed" into something the server
can verify rather than assume: preview and apply are separate requests, and
without it a client could confirm one analysis while a different one gets
written.

Execution runs inside a single `transaction.atomic()`. A rejection on row 7
leaves rows 1-6 unwritten — the batch was reviewed as a whole, so it is applied
as a whole.

## Idempotency and duplicates

Two layers, both aligned with the existing data model.

**Row identity** is the normalized `(name, variety, supplier)` trio, which is
exactly the `unique_crop_normalized` database constraint. A row that resolves
to an existing crop is an update, not an insert. If nothing would change, the
action is `skip` — so re-previewing and re-applying the same file converges
instead of accumulating rows. Matching is project-scoped, so a row can never
resolve to a crop in someone else's project.

Note the deliberate asymmetry: a row without a supplier only matches a crop
without a supplier. An unspecified row never overwrites a supplier-specific one.

**Draft identity** covers retries. Applying an already-applied draft performs no
writes and returns the original result with `already_applied: true`, so a client
that retries after a dropped response never doubles an import.

Duplicates *within* one payload are caught at preview time: the second row
naming the same crop is blocked with `duplicate_in_payload`.

## Known limitations

- **Deletion is crop-only.** Only `delete` tokens may soft-delete or restore
  crops. Suppliers, locations, fields, beds, planting plans, tasks, projects,
  members, invitations, and account areas still cannot be deleted or restored
  with any token. Global history restore remains session-only.
- **Read-only supporting data.** Suppliers, locations, fields, beds, planting
  plans, and tasks can be read but not changed with a token. An import can
  create a supplier indirectly via `supplier_name`, but there is no supplier
  write endpoint.
- **Three coarse scopes only.** There is no separate per-field or per-resource
  grant beyond the dedicated crop delete/restore scope.
- **One project per token.** Working across two projects means two tokens. This
  is the point, not an oversight.
- **Drafts expire after two hours** and are not garbage-collected on a schedule;
  expired rows stay in the table until someone prunes them.
- **`seed_requirements`, seed packages, images, and supplier rows** are not part
  of the preview/apply import schema yet. `seed_requirements` is available on
  direct crop create/update endpoints; seed packages remain editable through
  the browser and crop endpoints.
- **`last_used_at` is coalesced** to at most one write per minute, so it is
  accurate to the minute rather than the request.
- **Rate limiting is per-token, not per-endpoint.** `farm.agent_api.throttling`
  applies read/write ceilings keyed on the token id (`api_token_read`,
  `api_token_write`, `api_token_write_declared_agent` scopes — see
  [`account-trust-levels.md`](./account-trust-levels.md)), independent of
  which endpoint a given request hits. There is still no per-endpoint budget
  within those ceilings.

## Where the code lives

| Path | Contents |
|---|---|
| `backend/farm/models/agent_api.py` | `ProjectApiToken`, `CropImportDraft` |
| `backend/farm/agent_api/authentication.py` | bearer authentication |
| `backend/farm/agent_api/permissions.py` | scope/action rules |
| `backend/farm/agent_api/middleware.py` | surface allowlist above DRF |
| `backend/farm/agent_api/views.py` | token self-service, import endpoints |
| `backend/farm/agent_api/openapi.py` | generated schema |
| `backend/farm/services/crop_import/field_specs.py` | units, bounds, enums — single source of truth |
| `backend/farm/services/crop_import/units.py` | value/unit parsing and conversion |
| `backend/farm/services/crop_import/analysis.py` | preview generation |
| `backend/farm/services/crop_import/apply.py` | transactional execution |
| `frontend/src/pages/accountSettingsApiTokensCard.tsx` | token management UI |

`backend/farm/services/crop_import/spreadsheet.py` sits in the same package but
is **not** part of this surface: it backs the crops page's own
`POST /api/crops/import/preview/` and `/import/apply/`, which take spreadsheet
rows directly instead of going through a `CropImportDraft`.
