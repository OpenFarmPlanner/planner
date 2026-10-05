# Demo Project Template

OpenFarmPlanner defines its reusable demo project data in
`backend/farm/services/demo_project.py`.

The service has two persistent-data entry points:

- `create_personal_demo_project(user=...)` creates one normal, editable
  project for the authenticated user and is used by first-project onboarding
  and the project switcher's explicit "load demo project" action.
- `create_or_reset_demo_project(...)` recreates the local screenshot/demo
  fixture used by the management command and landing-page screenshot workflow.

The template currently creates the `Solawi Sonnenacker` / `Sunny Acre CSA`
project with two locations, four fields, twelve beds, three suppliers, twenty
crop-library rows, seed package data for the planned varieties, and seventeen
planting plans split across two seasons — five in a previous, already-harvested
2025 season and twelve in the current 2026 season — so the season switcher has
more than one season to demonstrate. Each plan's season is assigned during
fixture creation, so demo data never relies on the ordinary planting-plan API
accepting season-less creates. The crop rows deliberately include
selectable species entries plus varieties with different shared and own values
so the species → variety relationship can be reviewed in the UI. All personal
and guest demo records are project-scoped and owned by the receiving user
through a regular admin `ProjectMembership`.

The demo data exists in German and English. The authenticated API and guest
demo resolve the language from the request/UI language and create new demo
projects with matching project, location, field, bed, crop, crop-family, and
plan-note text. Existing demo projects are user-entered project content after
creation and are not translated in place. Demo crops are linked to
`CropSpecies` when a matching species exists, so planning read views can show
localized crop names without rewriting the stored demo records. The management
command defaults to German for existing screenshot workflows and accepts
`--language en` for the English fixture.

The public landing page also starts an isolated anonymous guest project from
this template. Guest workspaces are editable but session-bound, reset on the
next browser session, and removed after their short server-side retention
period by `cleanup_guest_demo_sessions`. This is separate from the persistent
personal demo project.

## Public demo architecture

OpenFarmPlanner can provide a public demo with the current codebase. The
recommended and implemented architecture is an isolated anonymous guest
workspace per visitor:

- The landing page starts the demo through
  `/api/auth/guest-demo/start/` and routes the visitor directly into the app.
- The backend creates a random temporary user, a random temporary project, a
  normal project membership, and demo data from the same reusable template as
  onboarding and screenshots.
- The temporary project is editable so visitors can test real workflows, but
  all records remain separated from production user projects by the normal
  project tenant boundary.
- Guest sessions expire after 8 hours and are deleted, together with their
  user and project data, by the `cleanup_guest_demo_sessions` management
  command. Production cron should run this command regularly; the ops repo
  schedules it every 30 minutes.
- The frontend stores the guest session id in `sessionStorage`. A new browser
  session starts a fresh workspace instead of reusing old demo data.
- Because a guest workspace is deleted without a trace, every start and, on
  deletion, whether the guest changed anything is booked to
  `GuestDemoUsageDay`, an anonymous per-day counter read by the admin
  engagement dashboard (see the README section "Aggregated Usage Insight and
  Privacy"). All deletions go through `delete_guest_demo_session`, which books
  the counter before the project's revisions are gone.

Alternatives considered:

- **Public shared demo account:** Low implementation effort, but every visitor
  would see and edit the same data. This creates data-loss, vandalism, privacy,
  and credential-sharing problems.
- **Read-only demo mode:** Safe and cheap to maintain, but it does not let
  visitors try the spreadsheet editing, planning, and project-management flows
  that define the product.
- **Separate periodically reset demo database:** Strong isolation, but it adds
  deployment complexity, data synchronization, and another operational surface
  for a small project.
- **Anonymous per-session guest workspace:** Slightly more backend work, but it
  reuses the existing tenancy model and demo template, gives realistic editable
  behavior, and keeps operations simple through automatic cleanup.

Risk controls:

- Demo start is rate-limited through `GUEST_DEMO_THROTTLE_RATE`
  (`10/hour` by default outside development, `1000/minute` in development).
- Guest users cannot create additional projects, send project invitations,
  accept invitations into real projects, change account email/password,
  request account deletion/export, create public profiles, upload media,
  publish to the public crop library, write public-library discussions or
  change proposals, create crop-species proposals, or request moderator access.
- Demo-created users use `example.invalid` email addresses and unusable
  passwords.
- Data growth is bounded by the start throttle, the 8-hour retention window,
  and the scheduled cleanup command.

Expected implementation effort for this architecture is low to medium because
it reuses existing project scoping, authentication sessions, and demo seeding.
The main ongoing maintenance cost is keeping the demo template realistic and
ensuring the cleanup cron remains deployed.

`/demo` is the shareable public entry point for emails and software
directories. It deliberately does **not** auto-start a guest session on page
load: email clients, link scanners and preview bots may request the URL, and a
GET request must not create temporary projects or consume the guest-demo rate
limit. Visitors explicitly start the demo from the page, which then uses the
same guest-demo API flow as the landing-page button. The route is reachable but
non-indexable (`noindex` at runtime and disallowed in `robots.txt`) because its
purpose is direct sharing rather than search traffic.

The frontend opens the first-project onboarding automatically only while the
authenticated user's project membership list is empty. Loading the demo project
from the project switcher remains a separate action.
The onboarding screen itself stays focused on starting a project. Deleted
projects are restored or permanently deleted through the project switcher's
trash entry, which opens the existing project trash view.

`populate_demo_project` sets `Project.demo_seeded_at` when it has finished.
Seeding records a "created" revision per crop through `Crop.save()`; the
marker lets usage statistics tell those apart from later user changes.

To adjust the template, update the specs in `demo_project.py` and extend the
focused backend tests in `backend/farm/tests/test_demo_project.py`. The project
API behavior is covered in `backend/farm/tests/test_projects_api.py`; the
frontend onboarding choice is covered in
`frontend/src/__tests__/ProjectSelectionPage.test.tsx` and
`frontend/e2e/onboarding-demo-project.spec.ts`.

Landing-page screenshots are generated from this same template in German and
English. They currently cover areas, crop library, planting plans, calendar
planning, yield overview, and seed demand. The German assets keep the historic
`demo-*.webp` filenames; the English equivalents use `demo-*-en.webp`.

Local checks:

```bash
cd backend
pdm run test farm/tests/test_demo_project.py farm/tests/test_projects_api.py

cd ../frontend
npx vitest run src/__tests__/ProjectSelectionPage.test.tsx
npx playwright test e2e/onboarding-demo-project.spec.ts
GENERATE_LANDING_SCREENSHOTS=1 npx playwright test e2e/landing-screenshots.spec.ts
```

For the standalone local demo user/project used outside onboarding:

```bash
cd backend
pdm run python manage.py seed_demo_project
pdm run python manage.py seed_demo_project --project-slug sunny-acre-csa --language en
```

The standalone command also refreshes matching public crop-library demo rows
from the same project data by default, copying only public-safe agronomic
fields and leaving supplier/package data out of the public library. Use
`--skip-public-library` when you only want to reset the project-scoped demo
workspace.
