# Post-deploy smoke check

Loads every main navigation page as a real guest-demo visitor against a
**live** environment (staging/production) and fails on any failed API
response or console/page error. Run this after a deploy instead of clicking
through the app by hand.

## Run

```bash
cd frontend
SMOKE_BASE_URL=https://staging.openfarmplanner.org npm run smoke
```

For production:

```bash
SMOKE_BASE_URL=https://openfarmplanner.org npm run smoke
```

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
