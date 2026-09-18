# Account Trust Levels

How OpenFarmPlanner decides that an account is new enough — or automated
enough — that its writes should be rate-limited harder and its public
crop-library contributions reviewed before they go live.

This is anti-abuse plumbing, not a permission system. Trust level never
decides *whether* someone may do something; project membership and the
moderator/admin roles still do that. It only decides how fast a write may
happen and whether a crop-library contribution applies immediately or waits
in a queue.

## Contents

- [The two levels](#the-two-levels)
- [Promotion](#promotion)
- [What the "new" level restricts](#what-the-new-level-restricts)
- [Moderated crop-library contributions](#moderated-crop-library-contributions)
- [Provenance flags](#provenance-flags)
- [Registration hardening](#registration-hardening)
- [Settings reference](#settings-reference)
- [Known gaps](#known-gaps)

## The two levels

`accounts.models.AccountTrustProfile` holds one row per user, created lazily.

| Level | Constant | Meaning |
|---|---|---|
| `new` | `AccountTrustProfile.TRUST_NEW` | The default for every account. Narrowed write throughput; crop-library contributions are queued for review. |
| `established` | `AccountTrustProfile.TRUST_ESTABLISHED` | Pre-existing behavior: normal write throughput, direct edit/publish to the crop library. |

There is deliberately no third level and no manual "trusted" flag on the
model. If an account needs to skip the eligibility rule — a test fixture, or
future admin tooling grandfathering someone in — `accounts.trust.
grant_established_trust()` forces the promotion directly.

## Promotion

`accounts.trust.resolve_trust_level(user)` is the single place the rule
lives. It is **lazy**: promotion is decided the next time the function runs
for that user, not on a schedule, so this feature needs no cron entry and no
management command. (Worth knowing when reading `ops/cron.d/` and wondering
what runs this — nothing does.)

An account at `new` is promoted when **both** hold:

- the account is at least `TRUST_ESTABLISHED_MIN_AGE_DAYS` old (default 7),
  measured from `user.date_joined`; and
- `TRUST_ESTABLISHED_MIN_ACTIVITY` (default 3) or more crops and planting
  plans exist across the projects they belong to.

The activity count is a coarse "this looks like a real gardener, not a bulk
-write bot" signal. It is explicitly **not** an ownership check — it counts
rows in projects the user is a member of, not rows they personally created.
Don't reuse `_plausible_usage_count()` for anything that needs to be right
about authorship.

Promotion is one-way in practice: nothing demotes an account back to `new`.

## What the "new" level restricts

**1. Write throughput.** `accounts.throttling.TrustAwareWriteRateThrottle`
runs as a global default throttle class and caps writes from `new` accounts
at the `write_new_account` scope (default 100/hour). It is a no-op for safe
methods (`GET`/`HEAD`/`OPTIONS`), anonymous requests, and established
accounts — an established account is simply left to whatever other throttle
scopes the endpoint already declares.

Because it is a global default class, it is on for every endpoint. There is
no per-view opt-in for this one, by design: the point is a ceiling across the
whole write surface, not per-endpoint tuning.

**2. API-token read/write throughput, independent of trust level.**
`farm.agent_api.throttling.ApiTokenReadRateThrottle`,
`ApiTokenWriteRateThrottle`, and `ApiTokenWriteDeclaredAgentRateThrottle`
are global default throttle classes that key on the authenticating
`ProjectApiToken`'s id (not the user), at the `api_token_read`,
`api_token_write`, and `api_token_write_declared_agent` scopes respectively.
Unlike `TrustAwareWriteRateThrottle`, these apply to **every** token request
regardless of the token owner's trust level — closing the gap where an
established account's token had no dedicated write ceiling at all. Each
class is a no-op outside its own method/declaration combination (e.g. the
write throttle ignores `GET` and ignores a declared-agent request, leaving
that to the declared-agent class), so all three coexist without double
counting one request. A session-authenticated request is never seen by any
of them, since `get_request_api_token()` returns `None` for it.

**3. Crop-library contributions go through moderation.** See below.

**4. A cap on standing moderation backlog per account.**
`farm.crops.moderation.pending_queue_limit_exceeded()` rejects a new
`PublicCropChangeProposal` (edit or new-publish) with
`429 pending_proposal_limit_exceeded` once the submitting account already has
`PUBLIC_CROP_MAX_PENDING_PROPOSALS_PER_USER` (default 20) proposals sitting
at `STATUS_PENDING`. This is deliberately independent of the write-rate
throttles above: those bound requests per hour, so a slow drip that never
trips the hourly rate could still, given enough hours, pile up an unbounded
backlog for moderators to work through. The cap is checked per-request in
both `PublicCropViewSet._queue_edit_proposal` and `CropViewSet.publish_public`
rather than in `requires_moderation_queue()` itself, since only a request
already routed into the queue needs it.

## Moderated crop-library contributions

`farm.crops.moderation.requires_moderation_queue(request)` is the single
decision point. It returns true for:

- any request authenticated with a `ProjectApiToken` — **regardless of the
  token's scopes, and regardless of the account's trust level**. A token
  belonging to a long-established member still queues.
- any session-authenticated user still at the `new` trust level.

Established users on a normal session keep the pre-existing direct
edit/publish behavior.

| Caller | Crop-library write |
|---|---|
| Session, `established` | Applies live (unchanged behavior) |
| Session, `new` | Queued as a `PublicCropChangeProposal` |
| API token, any trust level | Queued as a `PublicCropChangeProposal` |
| Anonymous | Rejected earlier by authentication, never reaches this check |

### The two proposal kinds

The branch revived the legacy `PublicCropChangeProposal` queue rather than
building a parallel structure, and widened it with a `kind` field:

- **`KIND_EDIT`** — an edit to an entry that already exists. The live entry is
  untouched; the submitted fields are stored in `proposed_data`.
- **`KIND_NEW_PUBLISH`** — a brand-new publish. This one needs a row to point
  at, so `publish_crop_to_public_library(require_moderation=True)` creates the
  `PublicCrop` with `status=STATUS_DRAFT` and returns the operation
  `pending_moderation`. `PublicCropViewSet.queryset` filters to
  `STATUS_PUBLISHED`, so the draft is invisible on every listing until it is
  approved. No status event, revision, or project-crop link is created yet.

`STATUS_DRAFT` had been declared on `PublicCrop` for a long time without a
writer; this is its first real use.

### Approval and rejection

Both live on `PublicCropViewSet` as moderator-only actions
(`change-proposals/<id>/approve` and `.../reject`).

- **Approving a `KIND_NEW_PUBLISH`** calls `approve_new_publish_proposal()`,
  which does the tail of a normal publish that the draft skipped: status
  transition to published, original-language translation sync, an
  `ACTION_CREATED` revision, and the link back to the source project crop.
- **Rejecting a `KIND_NEW_PUBLISH`** calls `reject_new_publish_proposal()`,
  which moves the draft to `STATUS_REMOVED` with
  `REMOVAL_REASON_PROPOSAL_REJECTED` rather than deleting it. A hard delete
  would cascade to the `PublicCropChangeProposal` row and destroy the audit
  record of the decision.

Both actions widen `get_queryset()` to all statuses, because a pending
`KIND_NEW_PUBLISH` proposal points at a draft the class-level published-only
queryset would hide. Moderator privileges are already checked before that
queryset is reached.

Notifications reuse the existing `Notification`/`create_notification`
plumbing: `TYPE_PUBLIC_CROP_CHANGE_PROPOSAL_SUBMITTED` to every moderator on
submission, `TYPE_PUBLIC_CROP_CHANGE_PROPOSAL_REVIEWED` back to the proposer
on the decision.

### Why `PublicCropViewSet` lists `ApiTokenAccessPermission` explicitly

`PublicCropViewSet` overrides `permission_classes`, which drops the project
default — so `ApiTokenAccessPermission` has to be named there by hand.
`ApiTokenSurfaceMiddleware` only gates at the class level ("does this view
declare *any* `api_token_actions`"), never per action. Without the explicit
listing, the moment `api_token_actions` became non-empty **every** action on
the view — `list`, `retrieve`, `destroy` — would have been reachable by a
token, not just the opted-in `update`/`partial_update`. This was a latent
gap in the permission wiring, not something the moderation work introduced;
it only became reachable once the view opted into the token surface.

Opting `update`/`partial_update` into the token surface is safe *only*
because `requires_moderation_queue()` unconditionally queues token writes. A
token can never edit or publish the library live. If that invariant is ever
relaxed, this opt-in has to be revisited in the same change.

## Provenance flags

`describe_contribution_origin(request)` stamps two booleans onto each
proposal so a moderator can weigh the source:

- **`origin_api`** — the request carried a `ProjectApiToken`. Trustworthy;
  derived from the authenticated credential.
- **`origin_declared_agent`** — the request sent
  `X-Client-Declared-Type: agent`. This is a **self-declaration and nothing
  more.** It is honored for its own incentive (be honest, get treated
  predictably) and shown to moderators as context. It must never be used for
  anything security-relevant — any client can send or omit it at will.

## Registration hardening

Layered deliberately, so no single check is load-bearing:

- **Honeypot.** `RegisterSerializer` declares a `website` field that is hidden
  in the real form. If it arrives filled, `RegisterView` returns the normal
  success response without creating anything, so a bot cannot tell it was
  caught and adapt.
- **Disposable domains.** `accounts.disposable_domains` holds a curated
  frozenset of ~100 throwaway providers, rejected in `validate_email`. Not
  exhaustive by design — it raises the cost of casual mass registration, it
  does not claim to catch everything.
- **Per-IP successful-registration cap.**
  `accounts.registration_abuse` counts registrations that actually created an
  account (the `auth_register` DRF scope counts *attempts*, successful or
  not). It is a plain cache counter, not a DRF throttle — which matters,
  because `config/settings_test.py` clears `DEFAULT_THROTTLE_CLASSES` and so
  would not neutralize it. It carries its own environment-aware default
  instead (effectively unlimited in `development`/`test`, 3/hour otherwise).
- **Per-email-domain throttle.** `EmailDomainRateThrottle` bounds an attacker
  who rotates IPs but reuses one throwaway-domain family.

### The domain throttle is opt-in per view

`EmailDomainRateThrottle` is registered in `DEFAULT_THROTTLE_CLASSES`, so it
runs on **every** view. It therefore checks `view.throttle_email_domain`,
which only `RegisterView` sets.

That gate is load-bearing, and removing it is a production incident, not a
tuning change. Without it the throttle keys on "does the request body have an
`email`?", which is also true of login, password reset, and resend-activation
— so every user sharing an email domain (a company domain, `gmail.com`) would
share one 10/hour login bucket and lock each other out. This is not
hypothetical: it shipped that way briefly on this branch and took the E2E
suite down, whose fixture accounts all sit on one domain
(`test_per_email_domain_throttle_does_not_apply_to_login` is the regression
test).

The same applies to any future throttle added to `DEFAULT_THROTTLE_CLASSES`:
a global throttle class needs a per-view opt-in unless it genuinely belongs
on every endpoint.

## Settings reference

All are read from the environment in `backend/config/settings.py`.

| Setting | Default | Effect |
|---|---|---|
| `TRUST_ESTABLISHED_MIN_AGE_DAYS` | `7` | Minimum account age for promotion |
| `TRUST_ESTABLISHED_MIN_ACTIVITY` | `3` | Minimum crops + planting plans for promotion |
| `THROTTLE_WRITE_NEW_ACCOUNT` | `100/hour` | Write ceiling for `new` accounts |
| `THROTTLE_AUTH_REGISTER` | `5/minute` | Registration attempts per IP |
| `THROTTLE_AUTH_REGISTER_DOMAIN` | `10/hour` | Registration attempts per email domain |
| `THROTTLE_AUTH_REGISTER_SUCCESS_PER_IP` | `3/hour` (`100000/hour` in dev/test) | Successful registrations per IP |

The E2E backend raises the trust/registration rates in
`frontend/playwright.config.ts` alongside the auth rates already raised
there. Every fixture account is created moments before use, so the whole
suite runs at the `new` trust level against one shared email domain — the
production defaults would throttle it. See
[`testing-and-ci.md`](./testing-and-ci.md).

## Known gaps

Stated plainly so nobody re-derives them from the code:

- **There is no moderator UI for these proposals.** The backend queues them,
  notifies every moderator, and the notification links to
  `/app/public-library-moderation` — but that page only renders crop-species
  proposals and moderator requests. It has no `PublicCropChangeProposal`
  section, so the notification currently leads to a page that shows nothing
  about the thing it is announcing. The REST actions and the
  `publicCropAPI.changeProposals` / `createChangeProposal` /
  `approveChangeProposal` / `rejectChangeProposal` wrappers in
  `frontend/src/api/api.ts` all exist; only the UI is missing. **Until that
  page is built, a queued contribution has no in-app way to be approved.**
- **Existing accounts are not backfilled.** Migration
  `accounts/0012_accounttrustprofile` creates the table and nothing else, and
  `trust_level` defaults to `new`. On deploy, *every* pre-existing account
  therefore starts at `new`. Most promote on their first write, since they
  clear the age threshold trivially and the activity threshold is low — but a
  long-standing account with fewer than `TRUST_ESTABLISHED_MIN_ACTIVITY`
  crops and planting plans stays at `new` indefinitely, and will find its
  crop-library contributions moderated without anything having changed on its
  side. If that turns out to matter, a data migration promoting accounts
  older than the age threshold is the obvious fix.
- **`resolve_trust_level()` costs queries on the write path.** It runs
  `get_or_create` plus, for an account still at `new` that is old enough, two
  `COUNT` queries — on every write request from such an account, via the
  global throttle class. Acceptable at current volumes, but it is a
  per-request cost on a hot path, and the obvious fix (cache the resolved
  level) has not been done.

## Related documentation

- [`agent-api.md`](./agent-api.md) — the `ProjectApiToken` credential, its
  scopes, and the token surface these rules narrow.
- [`crop-library-architecture.md`](./crop-library-architecture.md) — the
  `Crop`/`PublicCrop` split and the change-proposal queue's history.
- [`notifications.md`](./notifications.md) — the `Notification` model the
  moderator/proposer messages reuse.
