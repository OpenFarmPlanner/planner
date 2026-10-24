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
- [Registration hardening](#registration-hardening) (incl. activation email resend)
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
`PublicCropViewSet._queue_edit_proposal`, `CropViewSet.publish_public` and the
push part of `CropViewSet.public_sync` rather than in
`requires_moderation_queue()` itself, since only a request
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

**Exception: variety trade names are never queued.** Adding, changing,
removing or reverting a trade name
(`/api/public-crops/{id}/trade-names/`) applies live for every signed-in
session user, `new` accounts included, and never consults
`requires_moderation_queue()`. That is a deliberate product decision
([rfc-variety-trade-names.md](./rfc-variety-trade-names.md), D4). The
safeguards act afterwards instead: an append-only history with revert, a
report action that notifies moderators, and the per-user
`public_crop_trade_name_write` / `public_crop_report` throttles (on top of
`TrustAwareWriteRateThrottle`). `ProjectApiToken` cannot reach these
actions at all, so "a token never writes the public library live" still
holds.

**Owning the entry is not a way around this.** `publish_crop_to_public_library`
resolves `find_owned_public_crop_for_update` before it publishes, and that
branch used to return `'updated'` without ever consulting `require_moderation`
— so a contributor who had already published an entry could overwrite the live
row on the next publish, token included. The gate now runs before any
mutation in that branch and the publish is queued as a `KIND_EDIT` proposal
carrying the crop's proposable fields.

The field-by-field sync of a linked crop (`public-sync`, see
crop-library-architecture.md §0 and §7) follows the same rule: for a moderated
caller its "Meinen Wert" fields become one `KIND_EDIT` proposal instead of a new
version (the "Aus Bibliothek" fields still apply locally right away), and the
crop's `public_change_proposal_pending` flag replaces the push action with a
"Vorschlag in Prüfung" chip until a moderator decides.

For the same reason, a queued **variety** publish no longer runs
`ensure_general_public_crop`. That helper creates the species-level entry
*published*, from the contributing crop's own values, so running it on the
queued path put untrusted values live under the species name while the
variety they arrived with was still a draft. It is deferred to
`approve_new_publish_proposal`.

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

### Where a moderator actually reviews them

`/app/public-library-moderation` opens with the contributions queue
(`crop-library/components/ChangeProposalQueue.tsx`), above the crop-species
and moderator-request queues, because that is where the submission
notification links. Each row names the entry, its kind and provenance, and
opens a review dialog; approve/reject post to the per-entry actions above,
with an optional note that reaches the proposer through the reviewed
notification. The library page's moderation badge counts this queue too.

The list behind it is `GET /public-crops/pending-change-proposals/`, a
moderator-only action added for this screen: the per-entry
`change-proposals` endpoint needs an entry id, which a queue asking "what is
waiting?" does not have. It is queried off `PublicCropChangeProposal`
directly rather than through `get_queryset()`, since a pending
`new_publish` proposal points at a `draft` entry the published-only queryset
hides — without that, exactly the proposals that most need review would be
the ones missing from the queue.

The dialog renders `proposed_data` through `formatHistoryChangeValue`, the
same formatter the crop history uses. That is not only about consistency:
the proposable fields store SI units, so a raw render shows `row_spacing_m:
0.5` under a label reading "Reihenabstand (cm)" — 50 cm presented as 0.5 cm,
to the one person whose job is to judge whether the value is right. Keys
prefixed `_` are approval plumbing (`_source_crop_id`,
`_publish_as_general`) and are filtered out of the diff.

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
- **Cloudflare Turnstile.** See [below](#cloudflare-turnstile).

### Cloudflare Turnstile

An invisible, behavior-based bot check on the registration form only (not
login, password reset, or any other form). It adds a layer on top of the
checks above; it does not replace the throttles.

- **Frontend.** `components/auth/TurnstileWidget.tsx` loads Cloudflare's
  script on demand (`auth/turnstile.ts`) and renders the widget in
  `interaction-only` mode just above the submit button, so nothing is visible
  unless Cloudflare asks for an interaction. The token goes out as
  `turnstile_token` with the other registration fields. Turnstile itself
  retries failed checks and refreshes expired tokens; the widget additionally
  retries a failed script load (3 attempts, 10 s apart), shows a warning while
  a check is failing, and `RegisterPage` resets the widget after every submit
  attempt because the backend consumes each token once. A widget error code
  that means the widget itself is misconfigured (see
  [registration failure alerts](#registration-failure-alerts)) is not retried
  silently: the widget shows an error that the operators were informed, reports
  the code to `POST /api/client-errors/turnstile/` once per page view, and
  `RegisterPage` disables the submit button with a tooltip explaining why.
- **Backend.** `RegisterView` calls `accounts.turnstile.verify_turnstile_token`
  after the honeypot and per-IP cap and *before* the serializer, so a bot
  cannot use the form to probe for existing email addresses without passing
  the check. It posts the secret, the token, and the client IP (`REMOTE_ADDR`,
  after `TrustedProxyRemoteAddrMiddleware`) to Cloudflare's `siteverify` API.
  - missing, oversized, or rejected token (`invalid-input-response`,
    `timeout-or-duplicate`, `missing-input-response`, or no/unknown code) →
    `400` with code `turnstile_failed`;
  - Cloudflare unreachable, timeout, non-JSON answer, or a server-side error
    code (`internal-error`, `invalid-input-secret`, `missing-input-secret`,
    `bad-request`) → `503` with code `turnstile_unavailable`. Both are mapped
    to German/English messages in the frontend; neither creates an account.
    `bad-request` means *our* siteverify request was malformed, so it counts
    as server-side, not as the visitor's failure.
  - Every rejection logs one `WARNING` on the `accounts.turnstile` logger
    (`Rejected registration: Turnstile verification failed (reason=…,
    error_codes=…)`), with no token, IP, or email in it, so the rejection
    rate can be counted from the logs. Unavailability logs at `ERROR`.
- **Enabled per deployment.** The backend enforces the check only when
  `TURNSTILE_SECRET_KEY` is set, and the frontend renders the widget only when
  it was built with `VITE_TURNSTILE_SITE_KEY`. Local development, the test
  suite (`settings_test.py` forces both keys empty), and E2E run without it.
  Staging and production each have their own Turnstile widget (one per
  hostname) and therefore their own key pair: the backend `.env` of each gets
  that widget's `TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY`, and the frontend
  build for the same deployment gets the matching `VITE_TURNSTILE_SITE_KEY`.
  A secret without a site key (or the reverse) raises the Django system-check
  warning `accounts.W001`/`accounts.W002`. Outside `DJANGO_ENV=development`/
  `test`, a deployment with neither key reports the informational check
  `accounts.I001` (not a warning, so `check --deploy --fail-level WARNING`
  still passes), and one using a Cloudflare test key (`1x…`/`2x…`/`3x…`
  dummy site keys or secrets) raises the warning `accounts.W004`.
- **Cloudflare dashboard, per deployment.** The widget's *Hostname
  Management* list must contain every domain the registration form is served
  from — production **and** `staging.openfarmplanner.org`; a missing hostname
  makes the widget fail with error `110200` for every visitor. Each
  environment needs its own matching site key (frontend build) and secret
  (backend `.env`); a site key from one widget with the secret of another
  makes every token fail verification. Roll out on staging first: a
  backend that enforces the check while its frontend was built without the
  site key rejects every registration with `turnstile_failed`.
- **Privacy.** Covered by the "Bot-Schutz bei der Registrierung (Cloudflare
  Turnstile)" section of the privacy policy.

### Registration failure alerts

`accounts/registration_alerts.py` emails the operators when registration
fails for a reason that is **not the visitor's fault**, so a broken signup is
noticed within minutes instead of through complaints. The motivating incident
was a wrong Turnstile site key that silently blocked every registration.

| Failure type | Raised when |
|---|---|
| `server_error` | An unhandled exception or a 5xx response in `RegisterView`, `ActivateView` or `ResendActivationView` (via `RegistrationAlertMixin`), unless a more specific alert below already covered the request |
| `verification_email` | Sending the activation email fails on registration or on resend (SMTP error, timeout, misconfiguration) |
| `turnstile_client_config` | The browser reports a widget configuration error (below) |
| `turnstile_server_config` | `siteverify` answers `missing-input-secret`, `invalid-input-secret` or `bad-request` |
| `turnstile_unreachable` | `siteverify` times out, cannot be reached, answers non-JSON/non-2xx, or answers `internal-error` |
| `turnstile_missing_token` | More than 5 registration attempts **without any** Turnstile token within 15 minutes (a broken widget, not a single visitor) |

Never alerted, because they are the visitor's own failures: validation errors
(weak password, email already registered, invalid input), throttled requests,
and the user-side `siteverify` codes `invalid-input-response`,
`timeout-or-duplicate` and `missing-input-response`.

The Turnstile codes follow Cloudflare's docs ("Server-side validation → Error
codes reference" and "Client-side errors → Error codes"). The client-side
configuration codes are `110100`/`110110`/`400020` (invalid or unknown site
key), `110200` (domain not authorized), `400021` (site key/domain region
mismatch) and `400070` (site key disabled). Everything else the widget can
report (`110600`/`110620` timeouts, `200100` clock, `200500` iframe load,
`300*`/`600*` challenge failures) is transient or about the visitor and is
neither reported nor alerted. The list exists twice and must stay in sync:
`TURNSTILE_CLIENT_CONFIG_ERROR_CODES` in `accounts/turnstile.py` and
`TURNSTILE_CONFIG_ERROR_CODES` in `frontend/src/auth/turnstile.ts`.

**Client reports.** `POST /api/client-errors/turnstile/` takes
`{error_code, page_path, hostname, site_key}`. It is unauthenticated,
throttled per IP (`client_error_report`, `10/hour`) and globally
(`client_error_report_global`, `60/hour`), and answers `400` without an alert
for any code outside the allowlist. `page_path` is cut at `?`/`#` (a query
string could carry an activation token) and rejected if it contains
whitespace or control characters, so a newline cannot forge lines in the
alert email or log; `hostname` and `site_key` are character-restricted. A valid report answers `204` and goes through the same
pipeline as every other alert.

**Delivery.**

- Subject `[OpenFarmPlanner] Registrierung fehlgeschlagen: <failure type>`;
  the body lists timestamp (UTC), environment (`DEPLOYMENT_ENVIRONMENT`),
  failure type, exception class, message and traceback where available,
  request method and path. Turnstile alerts add the site key the backend
  expects (`TURNSTILE_SITE_KEY`) next to the one the browser reported and its
  hostname, so a mismatch is visible at a glance.
- Never included: passwords, request bodies, tokens, IP addresses. Email
  addresses are masked (`ma***@gmx.at`), also inside exception messages and
  tracebacks; IPv4/IPv6 addresses there are replaced with `[IP removed]`.
- Recipients come from `REGISTRATION_ALERT_EMAILS` (comma-separated). Empty —
  the default, and forced in `settings_test.py` — sends no email.
- At most one email per failure type per 15 minutes. Failures during the
  cooldown are counted, and the next email of that type carries the count.
  The cooldown and counters live in Django's default cache, which is
  per-process (`LocMemCache`), so each worker process throttles on its own.
- Sending runs on a background thread with a 10 s SMTP timeout, and any
  failure is caught and logged: an alert never breaks or slows down the
  visitor's request.
- Every reported failure is also logged at `ERROR` on the
  `accounts.registration_alerts` logger with the same masked fields, so there
  is a record even when outgoing mail is what is broken.

**Generic 500 emails (`ADMINS`).** Django's `AdminEmailHandler` emails every
unhandled exception anywhere in the app to `ADMINS` (comma-separated
addresses, empty by default) when `DEBUG=False`. `settings.LOGGING` redeclares
it with the `config.logging_filters.SkipRegistrationAlertedRequests` filter:
`report_registration_failure` marks the request, and the handler skips
records for a marked request, so one exception never produces both emails.

**Checks and verification.** Outside `development`/`test`, an empty
`REGISTRATION_ALERT_EMAILS` reports the informational system check
`accounts.I002` (deliberately not a warning, so deploy checks with
`--fail-level WARNING` pass before the variable is set).
To verify delivery on a server, run:

```bash
pdm run python manage.py send_test_registration_alert --type turnstile_client_config
```

It sends one alert marked `(TEST)` synchronously through the configured email
backend, ignoring the cooldown, and fails loudly if delivery fails or no
recipient is configured. `--type` accepts every failure type above (default
`server_error`).

### Activation email resend

`POST /api/auth/resend-activation/` is what the post-registration confirmation
view and the login page's "account not activated" state call through the shared
`components/auth/ActivationEmailResendPanel.tsx`. On top of the IP-scoped
`auth_resend_activation` DRF throttle, `accounts.activation_resend` enforces two
per-address limits in the cache (keyed on a SHA-256 of the normalized address,
so no plaintext email lands in the cache):

- a cooldown of `ACTIVATION_RESEND_COOLDOWN_SECONDS` (60) after each accepted
  request → `429` with code `activation_resend_cooldown`;
- at most `ACTIVATION_RESEND_MAX_PER_HOUR` (5) accepted requests in a rolling
  hour → `429` with code `activation_resend_limit_reached`.

Both carry `retry_after` in the body and a `Retry-After` header. A `200`
carries `sender_email` and `cooldown_seconds`. The limits are checked and
recorded **before** the account lookup, so an unknown, an already active and a
pending address get byte-identical responses and share the same limits — the
endpoint cannot be used to enumerate accounts. Only a pending account actually
receives an email. The one remaining difference is the pre-existing `503
email_send_failed` answer when SMTP fails for a pending account.

`sender_email` is the bare address from `DEFAULT_FROM_EMAIL`; the register
response and the login `account_not_activated` error carry it too, so the
spam-folder hint names the real sender without a hardcoded address in the
frontend. Like the per-IP registration cap, these limits live in the default
cache, which is per-process with the default local-memory backend.

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

### All of the above breaks silently behind a reverse proxy/CDN

Every check in this section keys on `REMOTE_ADDR`: the per-IP registration
cap reads it directly (`accounts/views.py`), and DRF's default
`SimpleRateThrottle.get_ident()` (used by every IP-scoped throttle, e.g.
`auth_login`, `auth_register`) falls back to it. A CDN or reverse proxy in
front of the app (Cloudflare being the motivating case) terminates the
client's connection itself, so `REMOTE_ADDR` becomes the proxy's own edge IP
for every request — collapsing every visitor into one shared bucket instead
of one each.

`config.middleware.TrustedProxyRemoteAddrMiddleware` fixes this by rewriting
`REMOTE_ADDR` from a client-IP header (`CF-Connecting-IP` by default), but
only when the immediate TCP peer is itself inside `TRUSTED_PROXY_NETWORKS`
(from the `TRUSTED_PROXY_CIDRS` env var — see
["Settings reference"](#settings-reference)). That network-layer check is
what stops a direct client from setting the header itself to claim an
arbitrary IP and evade every check above. It is a no-op — and therefore safe
to leave in place unconditionally — until `TRUSTED_PROXY_CIDRS` is set.

That setting is a Django runtime value, not a deploy-script one: it belongs
in the remote backend `.env` (see the commented-out template and current
Cloudflare ranges in `backend/.env.example`), the same way `SECRET_KEY` or
`ALLOWED_HOSTS` do. The `ops` repo deliberately does not provision the
backend `.env` at all (see its
`docs/environment-variables.md`, "Supervisor-rendered runtime values") —
only the actual CDN/DNS switch (nameservers, proxy status, TLS mode) is an
`ops`-side/dashboard action, not this setting.

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
| `ACTIVATION_RESEND_COOLDOWN_SECONDS` | `60` | Wait between activation-email resends per address |
| `ACTIVATION_RESEND_MAX_PER_HOUR` | `5` | Activation-email resends per address in a rolling hour |
| `THROTTLE_API_TOKEN_READ` | `2000/hour` | Read ceiling per `ProjectApiToken` |
| `THROTTLE_API_TOKEN_WRITE` | `300/hour` | Write ceiling per `ProjectApiToken` (not declared as an agent) |
| `THROTTLE_API_TOKEN_WRITE_DECLARED_AGENT` | `600/hour` | Write ceiling per `ProjectApiToken` declared as an agent |
| `PUBLIC_CROP_MAX_PENDING_PROPOSALS_PER_USER` | `20` | Cap on one account's standing moderation-queue backlog |
| `THROTTLE_PUBLIC_CROP_TRADE_NAME_WRITE` | `30/hour` | Trade-name edits and reverts per user (every trust level) |
| `THROTTLE_PUBLIC_CROP_REPORT` | `20/hour` | Library reports per user |
| `TRUSTED_PROXY_CIDRS` | *(empty)* | CIDR ranges of reverse proxies allowed to report the real client IP |
| `TRUSTED_PROXY_IP_HEADER` | `HTTP_CF_CONNECTING_IP` | Header read for the real client IP, once the peer is trusted |
| `TURNSTILE_SITE_KEY` | *(empty)* | This deployment's Turnstile widget key; must match the frontend's `VITE_TURNSTILE_SITE_KEY` |
| `TURNSTILE_SECRET_KEY` | *(empty)* | Turnstile secret; when set, registration requires a verified token |
| `TURNSTILE_VERIFY_TIMEOUT_SECONDS` | `5` | Timeout for the `siteverify` call before answering `turnstile_unavailable` |
| `REGISTRATION_ALERT_EMAILS` | *(empty)* | Comma-separated recipients of [registration failure alerts](#registration-failure-alerts); empty only logs |
| `ADMINS` | *(empty)* | Comma-separated recipients of Django's generic 500-error emails (`DEBUG=False` only) |
| `DEPLOYMENT_ENVIRONMENT` | `staging` if the `PUBLIC_FRONTEND_URL` host starts with `staging.`, else `DJANGO_ENV` | Environment label in alerts |
| `THROTTLE_CLIENT_ERROR_REPORT` | `10/hour` | Turnstile client error reports per IP |
| `THROTTLE_CLIENT_ERROR_REPORT_GLOBAL` | `60/hour` | Turnstile client error reports across all clients |

The E2E backend raises the trust/registration rates in
`frontend/playwright.config.ts` alongside the auth rates already raised
there. Every fixture account is created moments before use, so the whole
suite runs at the `new` trust level against one shared email domain — the
production defaults would throttle it. See
[`testing-and-ci.md`](./testing-and-ci.md).

## Known gaps

Stated plainly so nobody re-derives them from the code:

- **Pagination in the queue is not surfaced.** The moderation page renders
  the first page of `pending-change-proposals` and nothing else. At the
  default page size that is 100 waiting contributions before the 101st
  becomes unreachable from the UI, so a backlog that deep needs a "load more"
  control (or a filter) before it can be worked through.
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
