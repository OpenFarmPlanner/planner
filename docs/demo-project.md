# Demo Project Template

OpenFarmPlanner defines its reusable demo project data in
`backend/farm/services/demo_project.py`.
Additional feature examples live in `backend/farm/services/demo_features.py`;
both are used by the same population transaction.

The service has two persistent-data entry points:

- `create_personal_demo_project(user=...)` creates one normal, editable
  project for the authenticated user and is used by first-project onboarding
  and the project switcher's explicit "load demo project" action.
- `create_or_reset_demo_project(...)` recreates the local demo fixture used by
  the `seed_demo_project` management command.

The template currently creates the `Solawi Sonnenacker` / `Sunny Acre CSA`
project with three locations, six fields, twenty beds, three suppliers, thirty-two
crop-library rows, seed package data for the planned varieties, and
sixty-nine planting plans across four seasons. The current season contains
twenty-four plans and the preceding season contains twenty-three, with
twenty-one two seasons back and one three seasons back. The following season
starts with no plans of its own and is available as a copy destination.
The season years are derived from today's date
(`demo_current_year()`), never hardcoded, so the history stays inside the
crop rotation check window in every year. `populate_demo_project` takes an
optional `current_year` for time-pinned specs; the E2E fixture endpoint
exposes it as `demo_year` (used by `e2e/germination.spec.ts`). The
cross-browser screenshot suite does not use the demo: it has its own fixed
dataset (see [testing-and-ci.md](./testing-and-ci.md), "Cross-browser
suite"), so enriching the demo never changes its baselines. Each plan's season is assigned during
fixture creation, so demo data never relies on the ordinary planting-plan API
accepting season-less creates. The crop rows deliberately include
selectable species entries plus varieties with different shared and own values
so the species → variety relationship can be reviewed in the UI. All personal
and guest demo records are project-scoped and owned by the receiving user
through a regular admin `ProjectMembership`.

### Graphical workspace walkthrough

Open Growing areas → Graphic in a personal or guest demo. The topbar location
selector exposes the same three locations as the list hierarchy: Acker am Bach,
Hofgarten and Pachtacker Lindenhof (translated in localized demos). One location
fills the available canvas. Select another, zoom/pan/rotate, then switch between
List and Graphic: the selected location and its camera stay intact. Edit graphic
in the same topbar applies to the selected location only; Add location remains
available through the existing add action/menu. Fullscreen stays optional.
All three locations carry outer dimensions (Hofgarten 24 × 42 m, Acker am Bach
20 × 50 m, Pachtacker Lindenhof 24 × 55 m), so the graphic draws each location's
dashed boundary with free space around the saved plot positions and the list
shows their gross area (#1190). Each boundary origin is seeded 1 m above and
left of the plots, so in Edit graphic every plot can be dragged within its site
but not past the dashed line.

For a parcel drag, choose Hofgarten and drag a parcel from its title strip.
Watch its beds follow while the pointer is still down. Drop it, switch to List
and back to Graphic, then reload to check that each bed kept its position
within its parcel. Escape during another drag restores the whole parcel.

The Spacing popover beside Edit graphic shows 30 cm between beds and 75 cm
between parcels in Hofgarten. Acker am Bach demonstrates 45 cm and 100 cm.
Move a bed or parcel near its neighbour and check the gap shown on the canvas.
Hold Shift while dragging to place it freely. Restore defaults and Apply
changes the selected location's settings for later drags.

For layout warnings, choose Hofgarten in the local demo. Its three early beds
start with two clear paths. In Edit graphic, hold Shift and move the middle
bed (Salat 2) towards a neighbour. Move a little to narrow the path and move
farther to overlap. The outline changes during the drag, and the Layout checks
button names the affected beds after the drop. To demonstrate a saved overflow,
increase that bed's width beyond the parcel width in List, then return to
Graphic. Reduce it again to restore a valid footprint.

In Spacing, turn on Show free areas and paths. Hofgarten shows shaded room
around its three early beds and space outside the parcels but inside the site
boundary. Open the free-area information control for the site figures. The
overlay is initially off. In the current demo year's early spring, Salat 1
has a planting scheduled from 18 February and Salat 2 has its first planting
scheduled for 22 March. Both measured footprints appear with the same styling
throughout that period.

Site conditions (#1075) are language-independent choices, so every demo
language shows the same values. Hofgarten is sunny, normal moisture, irrigation
available; Acker am Bach is sunny and moist without irrigation; Lindenhof
specifies nothing (shows "Not specified" in the filters). The polytunnel field
records its environment and overrides the soil moisture with dry, the
Frühbeete field is open field, the cabbage field overrides the soil type with
clay, and the herb bed overrides the inherited light with partial shade. Open
a bed's row menu → "Bed details" to see an inherited value and an override.
For the planting-plan retry, use a bed with plans in the active season. In local
browser developer tools, block the planting-plans list request and reload the
bed details. The rest of the details stay available. Unblock the request and
select Retry to see the plan links return.

The location selector and editing action are absent in List mode. At narrower
widths the shared topbar places graphical controls and the add action in a
wrapping row, and the canvas uses the remaining height. For manual review,
include phone landscape and a short desktop window, reach the final canvas
actions through their own scrolling control panel, and try Fit to contents
before and after resizing/fullscreen. No demo-data migration or new seed is
needed: the existing three-location fixture demonstrates the flow.

### Default bed dimensions

The demo proposes a length of 10 m and a width of 1.2 m when you add a bed or
open the bulk-create dialog. Project settings → General shows both editable
defaults. For example, Salat 1 in Hofgarten has its own dimensions. Open a
new-bed draft beside it to see the project values, then duplicate Salat 1 to
verify its dimensions are copied.

Open the Root Vegetables parcel at Creekside Field (Wurzelgemüse at Acker am
Bach in German) in the Growing Areas List and choose Add multiple beds. The
end of the parcel has room for multiple beds with the 10 × 1.2 m defaults and
the site's 0.45 m gap. Preview a group, save it, then switch to Graphic to see
its positions alongside the existing beds.

### Crop rotation story

The previous seasons rotate the plant families across the beds so the
[crop rotation check](./crop-rotation.md) has real history to read, and the
current season shows every rotation and bed-capacity case on purpose. The
full list, with culture, bed and expected status for a manual check, is the
"Demo cases" table in [crop-rotation.md](./crop-rotation.md#demo-cases).

The farm garden's North–South parcel rotation group connects North Early Beds
and South Polytunnel. Each parcel has three beds with distinct sizes across the
parcels. Open the following year's **Copy season data** action and use the
current season as the source. The preview shows both mappings, partial areas
scaled to the target beds and the plans that are already active in the target
season. The following season starts with no copied plans.

- **Hofgarten / Acker am Bach** keep the original story: most plans "passt",
  the spring and autumn lettuce on "Salat 1" flag each other (two plans of
  the same family in one year), tomato after tomato on "Tomatenreihe 1" is an
  accepted conflict (the plan note gives the justification), "Karotten 2" is
  newly established this season (see its bed note) and has no history, which
  checks as "passt", and
  "Gründüngung Reserve" carries Phacelia (a family without a break) and
  strawberries (no plant family recorded yet).
- **Pachtacker Lindenhof** (leased field, two plots of four beds) holds one
  teaching case per bed: potatoes against their own 4-year break, potatoes
  after zucchini (nutrient hint), broccoli after peas (no hint thanks to the
  legume), broccoli after mustard green manure, bush beans after peas (the
  peas' stricter break), leek after garlic planted last October, sweetcorn
  (no break; copied into next season it becomes the hint of the copy dialog)
  and zucchini back after the Cucurbitaceae break (the one plan three seasons
  back). The leek row's inline bed picker shows a partly occupied bed
  ("Zuckermais") and "Bohnen", where the leek starts on the first day after
  the bush beans' firm stage (harvest overlap, see
  [bed-occupancy.md](./bed-occupancy.md)); with "Folgekultur während der
  Erntephase erlauben" off, "Bohnen" is the bed without enough room.

### Bought-in young plants

Three current-season plans use the cultivation type "Pflanzung mit gekauften
Pflanzen" (`purchased_transplant`): the tomatoes on "Tomatenreihe 2" and the
broccoli on "Brokkoli" and "Kohlbeet" (Lindenhof). They have no Anzucht and
no seed demand and fill the [young-plant demand](./young-plant-demand.md)
list with computed plant counts (both crops have spacing). The cultivation
type does not affect the crop rotation check, so the rotation cases below
are unchanged. `test_demo_project_lists_bought_in_young_plants` pins them.

The new field crops are plain Kulturen without supplier data; potato and pea
carry their own, stricter `rotation_break_years`. The rotation facts come from
the crops' own families and the seeded family defaults. No bed is overbooked
in any season. `DemoRotationCasesTests` in
`backend/farm/tests/test_demo_project.py` pins every case, so a template
change that breaks one fails the build.

The demo data exists in German, English, French and Spanish. The authenticated
API and guest demo resolve the language from the request/UI language and create new demo
projects with matching project, location, field, bed (name and note), crop,
plan-note text, tags, companion notes, germination instructions, manual tasks
and task templates. Existing demo projects are user-entered project content after
creation and are not translated in place. Demo crops are linked to
`CropSpecies` when a matching species exists, so planning read views can show
localized crop names without rewriting the stored demo records. Catalog-owned
names retain the ordinary API fallback when the shared catalog lacks a translation;
demo creation never seeds or rewrites global species translations. Supplier brands,
cultivar names, botanical names, identifiers, enum codes and agronomic values
are not translated. Automatic task event titles use the existing UI translations.
The management command defaults to German for existing screenshot workflows and accepts
`--language en`, `--language fr` or `--language es` for localized fixtures.

Language resolution uses the shared request order (explicit query, account
preference, browser header), retaining German for missing or unsupported codes.
`resolve_demo_language` validates the full project and feature bundle against
the English shape, including all names and descriptions. A supported language
with missing/blank content falls back to the entire English dataset, rather than
mixing individual fallback strings. Add future content to `DEMO_TEXT`,
`FEATURE_TEXT` and the project name/description maps; population logic and command
choices are shared. A parity test requires a complete bundle for every supported
UI language. Loading an existing personal demo in that language is idempotent;
switching languages creates or returns the corresponding demo without rewriting
the other project's content or edits.

The public landing page also starts an isolated anonymous guest project from
this template. Guest workspaces are editable but session-bound, reset on the
next browser session, and removed after their short server-side retention
period by `cleanup_guest_demo_sessions`. This is separate from the persistent
personal demo project.

## Recent feature coverage

An audit of features added since the previous dataset update (#808) found that
tasks, companion planting, tags, botanical names, timing windows, germination
and supplier seed statuses lacked examples. The template now includes:

| Feature | Demo examples |
| --- | --- |
| Task dashboard and manual work | Seven manual tasks: all four statuses, overdue/today/upcoming dates, an undated unassigned task, crop work and field-only fence maintenance. Dated tasks are assigned to the owner. |
| Automatic plan events | The ordinary `generate_tasks_for_plans` service runs for all 65 plans, sharing the normal inheritance index. Past generated dates start completed; future dates stay pending. One completed current-season event has a manually adjusted date to demonstrate override preservation. |
| Independent task templates | A carrot fleece task two days before sowing; three weekly tomato-tying occurrences; monthly strawberry mulch checks through harvest end. Each occurrence has its own ID and completion state. |
| Botanical names and tags | General crops carry botanical names. Fruiting, storage, winter and green-manure tags demonstrate inherited variety values and the crop filters. |
| Companion planting | Good and bad crop pairs, a whole-family relation and a free-text flower strip. These are illustrative farm-entered relationships, not universal agronomic recommendations. |
| Timing windows | Tomato propagation/planting, two lettuce sowing windows, ISO-week planting windows, carrot sowing and a garlic window crossing the year boundary. Varieties inherit their general crop's windows. |
| Germination | Tomato, lettuce, carrot and cucumber carry temperatures, germination days, light/dark requirements and instructions. Their plans can display expected emergence. |
| Seed demand | Every sown crop of the current season has a computed amount: the varieties count with the seed rate inherited from their Kultur, bush beans and sweetcorn are sown by weight or per m², leek per m² of bed. Potatoes (tubers) and strawberries (planted) deliberately have no seed rate and show the "not calculable" reason. Bush beans, leek, sweetcorn and phacelia have no supplier and show the "Lieferant zuordnen" state; the planned varieties carry package sizes, so several rows show a package suggestion. `test_demo_project_shows_a_computed_seed_demand_for_every_sown_crop` pins it. |
| Supplier offers | Organic, in-conversion, conventional and unknown seed statuses; all exemption-note states; two offers with different prices for Roma tomatoes and Nantaise carrots. The existing preferred supplier and package data remain intact. |

The earlier bought-in-young-plant, crop-rotation, harvest-overlap and growing-area
layout stories remain unchanged and retain their existing regression tests.
Spreadsheet editing and import/export use the same populated crop rows; they do
not need separate seed records. Onboarding hints retain the user's preferences;
loading a demo does not reset previously dismissed hints.

Normal demos use today's date for manual task examples and the current season.
For time-pinned callers, `current_year` also fixes the task reference date to
May 15 of that year. This keeps fixture data independent of the day tests run.
Stored example text follows the selected German, English, French or Spanish
demo template.

Open Farm Garden in the graphical Growing areas view and enable **Show tasks**.
Lettuce 1 is overdue, Tomato Row 1 is due soon, Lettuce 2 is due later,
Herbs & Chard has open work without a date, and Cucumber Row is complete.
Tomato Row 2 has no applicable tasks. The fence task on the leased North Plot
stays on the task board. Open a bed's details to complete one of its tasks.

In Farm Garden, open **Individual plants** in the graphical view and select
the North Early Beds plot. Its three Topaz apple trees share one plan, with
an estimated canopy diameter of 3.8 m. Their stems retain their IDs as the
planting continues into the following season. Select a stem to inspect its
coordinates or edit them with the map or the keyboard. The nearby lettuce
beds retain their ordinary capacity.

The explicit command-line public-library fixture also copies botanical names,
germination fields and shareable general-crop companions. Project-only tags,
timing windows, supplier statuses and tasks stay private. Guest and personal
demo creation do not publish entries or fabricate global moderation/sync state;
visitors can explore the actual library through its existing guest permissions.

All examples are created before `demo_seeded_at` is written, so seeding does not
count as user activity. An explicit reset removes tasks (including legacy tasks
without a season), task templates and stale history only in the target project.
Population is atomic: a failure restores the previous dataset. Merely loading
an existing personal demo remains idempotent and preserves user edits.

Migration `0135` adds the seven standalone work examples to older seeded
German/English demos that have no manual tasks and no task revision history.
It uses migration-day dates and the latest non-deleted season (the overview's
default), even when that season's planting plans are already past. It preserves
all existing generated tasks, crops, plans and project metadata. Demos with
manual work or recorded task edits/deletions, inactive/deleted projects and
projects without a season are skipped. Rollback retains the examples because
users may have edited them. No demo is reset.

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
- Opening `/login` or `/register` during a guest demo ends the demo through
  the same `endGuestDemo` cleanup as "Demo beenden" (falling back to a plain
  logout) and shows the form, instead of the "already signed in → app"
  redirect. The check uses the backend's `is_guest_demo` flag; real accounts
  are still redirected (`useEndGuestDemoOnAuthPage` in `frontend/src/auth/`).
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
  publish to, edit, revert or unlink from the public crop library (pushing a
  crop's changes to its entry included), write public-library discussions or
  change proposals, create crop-species proposals, or request moderator access.
  The backend rejects these with `403` and code `guest_demo_restricted`
  (`accounts/demo_access.py`).
- The frontend explains these limits instead of surfacing a generic error.
  `useGuestDemoGuard` (`frontend/src/auth/`) is the single entry point:
  actions stay visible so the demo shows what the app can do, and triggering
  one shows an info snackbar (`blockInGuestDemo`). Pages that are mostly
  read-only for guests also show a `GuestDemoNotice` info box: the public crop
  library (edit/translate/revert disabled, discussion read-only), account
  settings, and the invitation card in project settings. Publishing, pushing
  to and unlinking from the library on the crops page, creating projects and
  uploading note photos are gated by the snackbar; importing from and pulling
  updates out of the library stay available. As a fallback,
  `extractApiErrorMessage` and the auth client map `guest_demo_restricted` to
  the same localized message (`common:guestDemo.restricted`). A new
  backend restriction should get a matching frontend gate.
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
focused backend tests in `backend/farm/tests/test_demo_project.py`. A template
change reaches only newly seeded projects; if the old values break a rule
(e.g. fractional seeds per plant, repaired by migration
`farm/0119_repair_demo_fractional_seeds_per_plant`), add a data migration that
matches the exact old values in projects with `demo_seeded_at` set, so nothing
a user typed is rewritten. The project
API behavior is covered in `backend/farm/tests/test_projects_api.py`; the
frontend onboarding choice is covered in
`frontend/src/__tests__/ProjectSelectionPage.test.tsx` and
`frontend/e2e/onboarding-demo-project.spec.ts`.

Local checks:

```bash
cd backend
pdm run test farm/tests/test_demo_project.py farm/tests/test_projects_api.py

cd ../frontend
npx vitest run src/__tests__/ProjectSelectionPage.test.tsx
npx playwright test e2e/onboarding-demo-project.spec.ts
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
