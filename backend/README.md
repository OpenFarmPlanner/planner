# OpenFarmPlanner Backend

Django REST backend for OpenFarmPlanner.

This README covers backend-specific development details. For the full project overview, start at the root [`README.md`](../README.md).

## Stack

- Python 3.12+
- Django 5.2
- Django REST Framework
- PDM

## Setup

```bash
cd backend
cp .env.example .env
pdm install
pdm run migrate
pdm run runserver
```

API base path: `http://localhost:8000/api/`
Admin path: `http://localhost:8000/admin/`

For local LAN testing from another device, prefer the repository-level script:

```bash
../scripts/dev-lan.sh
```

It starts Django on `0.0.0.0:8000` and exports development-only `ALLOWED_HOSTS`, CORS, and CSRF origins for the detected LAN IP. You can override detection with `LAN_IP=192.168.178.125 ../scripts/dev-lan.sh`.

## Useful Commands

```bash
pdm run makemigrations
pdm run migrate
pdm run test
pdm run createsuperuser
pdm run compilemessages
```

### Cleaning Local Test Data

Local E2E and demo runs can leave many projects and users in the development
database. Preview the cleanup first:

```bash
DEBUG=True DJANGO_ENV=development pdm run python manage.py cleanup_local_test_data
```

Then delete the selected local fixtures explicitly:

```bash
DEBUG=True DJANGO_ENV=development pdm run python manage.py cleanup_local_test_data --confirm
```

The command is intentionally limited to development settings and only targets
known local fixture markers such as E2E users, guest demo sessions, and
reproducible demo/hint projects. It is not production retention automation.

### Making Model Changes
1. Edit models in `farm/models/` (one module per domain)
2. Create migrations:
   ```bash
   pdm run makemigrations
   ```
3. Apply migrations:
   ```bash
   pdm run migrate
   ```

### Accessing Admin Interface
1. Create a superuser (if not already done):
   ```bash
   pdm run createsuperuser
   ```
2. Start the server:
   ```bash
   pdm run runserver
   ```
3. Visit `http://localhost:8000/admin/`

### Query profiling with django-debug-toolbar

django-debug-toolbar is a local-development-only dependency in the PDM `dev`
group. It is not part of the default install, so production and CI environments
never ship it:

```bash
pdm install -dG dev
DEBUG=True DJANGO_ENV=development pdm run runserver
```

The toolbar is wired up only when all three conditions hold — `DEBUG=True`,
`DJANGO_ENV=development`, and the package importable — via
`DEBUG_TOOLBAR_ENABLED` in `config/settings.py`. Because API responses are JSON,
the toolbar is never injected into a response body; open
`http://localhost:8000/__debug__/` and use the History panel to inspect the SQL
of the request you just made.

For the SQL count of an endpoint in an automated form, use the
`assertNumQueries` tests in `farm/tests/test_api_query_counts.py` and
`crops/tests/test_views.py` instead — every list endpoint with relational
fields is pinned there.

## Environment Variables

For production, configure these environment variables:
- `SECRET_KEY` - Django secret key
- `DEBUG` - Set to `False` in production
- `ALLOWED_HOSTS` - Comma-separated list of allowed hosts
- `SECURE_SSL_REDIRECT` - Enable HTTPS redirects only if the proxy chain is configured correctly
- `SECURE_PROXY_SSL_HEADER` - Proxy header tuple, for example `HTTP_X_FORWARDED_PROTO,https`
- `USE_X_FORWARDED_HOST` - Trust the forwarded host from the reverse proxy
- `SESSION_COOKIE_SECURE` - Secure session cookies in HTTPS deployments
- `CSRF_COOKIE_SECURE` - Secure CSRF cookies in HTTPS deployments
- `SECURE_HSTS_SECONDS` - HSTS max-age for production
- `EMAIL_HOST_PASSWORD` - SMTP password for `info@openfarmplanner.org`
- `PUBLIC_FRONTEND_URL` - Public frontend base URL used in activation, password reset, and invitation links
- `FRONTEND_URL` - Optional local/development fallback for frontend links
- `DEV_LAN_HOSTS` - Optional comma-separated LAN hosts/IPs added to `ALLOWED_HOSTS`, CORS, and CSRF only when `DEBUG=True` and `DJANGO_ENV=development`
- `GUEST_DEMO_THROTTLE_RATE` - Rate limit for `POST /api/auth/guest-demo/start/`. Defaults to `1000/minute` when `DJANGO_ENV=development`, otherwise `10/hour`. Invalid values fail startup instead of disabling protection.
- `URL_PREFIX` - Optional backend URL prefix (default: root). Example: `openfarmplanner` for legacy prefixed routing.
- `REGISTRATION_ALERT_EMAILS` - Comma-separated recipients of registration failure alerts (empty: only logged). Test delivery with `pdm run python manage.py send_test_registration_alert [--type <failure type>]`. See `docs/account-trust-levels.md`.
- `ADMINS` - Comma-separated recipients of Django's generic 500-error emails (sent only when `DEBUG=False`; empty disables them).
- `DEPLOYMENT_ENVIRONMENT` - Environment label shown in alerts (default: `staging` for a `staging.*` public frontend host, otherwise `DJANGO_ENV`).

The guest demo endpoint uses Django REST Framework `ScopedRateThrottle` with the
`guest_demo_start` scope. Anonymous public starts are limited per client IP, while
authenticated requests would be limited per user; it is not a single global
bucket. Throttled responses include the standard `Retry-After` header and a
machine-readable `retry_after` value in the JSON body. With the production
default of `10/hour`, a user who has exhausted the bucket may see a remaining
wait of roughly 40 minutes depending on the request history inside that hour.

To manually test the guest demo throttle locally, set a low value such as
`GUEST_DEMO_THROTTLE_RATE=1/minute`, restart Django, and submit repeated
`POST /api/auth/guest-demo/start/` requests. Remove the override or set a higher
value again for normal local testing.

### SMTP configuration for Uberspace (production)

Use these settings in your environment:

```env
EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
EMAIL_HOST=mail.uberspace.de
EMAIL_PORT=587
EMAIL_USE_TLS=True
EMAIL_HOST_USER=info@openfarmplanner.org
EMAIL_HOST_PASSWORD=<your-secret-password>
DEFAULT_FROM_EMAIL=OpenFarmPlanner <info@openfarmplanner.org>
PUBLIC_FRONTEND_URL=https://your-frontend-domain.tld
```

For local development you can keep email output in the terminal:

```env
EMAIL_BACKEND=django.core.mail.backends.console.EmailBackend
```

### Translation compilation

Compiled Django translation binaries (`*.mo`) are generated artifacts and are not committed.
Compile them during build/deploy (or locally after editing `.po` files):

```bash
pdm run compilemessages
```

The `compilemessages` script uses `config.settings_test` so it can run without production-only secrets.

### Authentication endpoints

Auth endpoints are available under `/api/auth/`:

- `GET csrf/`
- `POST register/`
- `POST activate/`
- `POST login/`
- `POST logout/`
- `GET me/`
- `POST resend-activation/`
- `POST password-reset/`
- `POST password-reset-confirm/`

### DNS recommendations for deliverability
## Authentication and API Notes

- Auth endpoints: `/api/auth/*`
- API endpoints: `/api/*`
- Legacy prefixed auth/API endpoints: `/openfarmplanner/api/*`
- Agent login consume endpoint: `/agent-login/<token>/` and legacy `/openfarmplanner/agent-login/<token>/`
- Session authentication with CSRF protection is enabled.
- Most API endpoints require authentication by default.
- Project-bound API tokens (`Authorization: Bearer ofp_pat_…`) let external
  coding agents call a deny-by-default subset of the same endpoints. They need
  no CSRF token, are bound to one project server-side, and can only delete or
  restore crops when created with the dedicated delete scope. Administrative
  endpoints remain unreachable. Machine-readable schema:
  `/api/agent/openapi.json`. Full documentation: [`docs/agent-api.md`](../docs/agent-api.md).

## Environment Notes

- Environment variables are loaded from `backend/.env`.
- SQLite is used by default in development.
- PostgreSQL can be enabled via `DB_ENGINE` and related DB settings.
- Email behavior is environment-driven (console backend in development by default).

See `.env.example` and `config/settings.py` for all available backend configuration options.


### Activation email deliverability notes

- Activation messages are sent as multipart emails (`text/plain` + `text/html`) so older and security-focused clients can reliably render them and mailbox providers do not classify them as HTML-only automation.
- The sender uses `OpenFarmPlanner <info@openfarmplanner.org>` and no `noreply` mailbox. This improves user trust and helps long-term sender reputation because recipients can reply when needed.
- The sender mailbox is a monitored `info@openfarmplanner.org` address so recipients can reply directly when needed.
- The HTML template intentionally stays simple (single button plus visible fallback URL, no tracking pixels, no image-heavy marketing layout).
