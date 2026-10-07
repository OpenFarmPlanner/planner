# Post-deploy smoke check

Loads every main navigation page against a **live** environment
(staging/production) and fails on any failed API response or console/page
error. Run this after a deploy instead of clicking through the app by hand.
Two specs cover the two ways into the app:

- `post-deploy.spec.ts` — the guest-demo flow ("Demo ohne Registrierung
  ansehen"), no credentials needed, always runs.
- `login.spec.ts` — the normal login flow, needs a persistent test account
  (see below); skips itself with a clear message if `SMOKE_LOGIN_EMAIL`/
  `SMOKE_LOGIN_PASSWORD` aren't set.

## Run

```bash
cd frontend
SMOKE_BASE_URL=https://staging.openfarmplanner.org npm run smoke
```

To also run the login check:

```bash
SMOKE_BASE_URL=https://staging.openfarmplanner.org \
SMOKE_LOGIN_EMAIL=smoke-test@openfarmplanner.org \
SMOKE_LOGIN_PASSWORD=<test account password> \
npm run smoke
```

For production, swap `SMOKE_BASE_URL` for `https://openfarmplanner.org` (and
a production test account's credentials for the login check).

## Provisioning the login test account

The login check needs one persistent (non-guest) account per environment —
unlike the guest demo, a normal login can't be started without existing
credentials, and this repo never stores them. Create one once per
environment directly via `manage.py shell` (bypasses the email-activation
step a real registration would need):

```bash
scp create_smoke_user.py <deploy-user>@<host>:/tmp/create_smoke_user.py
ssh <deploy-user>@<host> "cd ~/openfarmplanner/backend/ && SMOKE_TEST_PASSWORD='<pick a password>' python3.12 -m pdm run python manage.py shell < /tmp/create_smoke_user.py; rm -f /tmp/create_smoke_user.py"
```

Where `create_smoke_user.py` is:

```python
import os
from django.contrib.auth import get_user_model
from accounts.consent import record_acceptance
from accounts.models import DocumentConsent
from farm.services.demo_project import create_personal_demo_project

User = get_user_model()
email = "smoke-test@openfarmplanner.org"
password = os.environ["SMOKE_TEST_PASSWORD"]

user, created = User.objects.get_or_create(
    email=email,
    defaults={"username": "smoke_test", "is_active": True, "first_name": "Smoke Test"},
)
user.is_active = True
user.set_password(password)
user.save()
if created:
    record_acceptance(user, DocumentConsent.DOCUMENT_TERMS)

result = create_personal_demo_project(user=user, project_name="Smoke Test Projekt")
print(f"RESULT user_id={user.id} email={user.email} created_user={created} project_id={result.project.id}")
```

Keep the password out of the repo and shell history — pass it via the
`SMOKE_TEST_PASSWORD` env var as shown, store it in a password manager, and
use the same pattern for `SMOKE_LOGIN_PASSWORD` when running the check. This
account accumulates real project history over time (no cleanup cron, unlike
the guest demo); periodically resetting its project via the project
switcher's "load demo project" action keeps it representative.

## Notes

- Separate from `frontend/e2e/`: that suite's `playwright.config.ts` always
  boots its own local backend+frontend `webServer` pair and relies on the
  `DEBUG`-only `E2E_TEST_TOKEN` fixture endpoint, neither of which exists
  against a deployed environment. This directory has its own
  `playwright.smoke.config.ts` (no `webServer`, `baseURL` from
  `SMOKE_BASE_URL`) so `npm run test:e2e` never picks it up by accident.
- Uses the real guest-demo flow (see `docs/demo-project.md`), the same one a
  visitor uses from the landing page — no credentials needed, and it leaves
  the demo at the end rather than waiting for the retention cleanup cron.
- Reuses `MAIN_ROUTES` and `waitForPageStable` from `../e2e/utils.ts` (the
  same route list the responsive-layout screenshot baselines iterate) instead
  of a separate hardcoded route list.
- Runs a single `chromium` project; this is a fast "does it load" check, not
  a cross-browser or visual regression suite.
