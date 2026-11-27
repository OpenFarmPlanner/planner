# Usage analytics

The superuser-only Django admin includes a **Nutzungsübersicht** (engagement
dashboard) for internal product-development decisions, reachable from the Farm
section of the admin navigation. It derives project activity from the existing
`created_at` and `updated_at` timestamps on farm data (suppliers, crops and
supplier data, seed packages, locations, fields, beds and layouts, planting
plans, tasks, and note attachments). The project table shows members,
planting plans, last activity and status. Its 7- and 30-day activity filters
affect only the table. Total parcel area adds each parcel’s stored
`Field.area_sqm` once. It displays a partial sum when only some parcels have
recorded areas, and an unknown value when none do. A recorded zero displays
as zero.

The project table and aggregate project metrics use the same population.
By default, this excludes temporary guest workspaces, demo/template projects,
and projects whose memberships are all superusers. Demo/template projects
are identified by the seeding timestamp or a known template description.
**Alle anzeigen** (`?show_all=1`) includes those projects and preserves the
table’s sort and activity filter. Registration and login totals exclude
temporary guest accounts in both views and include staff and superusers in
the expanded view. The template-origin figure and **Demo-Nutzung** have
their own populations.

A **Demo-Nutzung** block, placed between the Gesamtübersicht and the
"Projekte" table, reports how often the demo is used and whether it leads to
real usage, for the last 7 days, the last 30 days, and all-time. It separates
the two ways into the demo:

- **Gast-Demo gestartet (öffentlicher Link):** public guest demos started
  from the landing page or `/demo` without an account. Guest sessions are
  deleted together with their temporary user and project after 8 hours, so
  they are counted in `GuestDemoUsageDay`, a per-day counter without any
  reference to a user, project, IP address, or session. Guest demos deleted before
  this counter existed are not recoverable and are missing from the totals.
- **Gast-Demo genutzt:** of those, how many had at least one change by the
  guest. This is booked to the counter of the session's start day when the
  session is deleted; live sessions are read from their project's revisions.
- **Demo-Projekt im eigenen Konto angelegt:** demo projects loaded into a
  regular account (first-project onboarding or the project switcher), created
  in the window. Guest demo projects are not included.
- **Demo-Projekt im eigenen Konto genutzt:** of those, how many have at
  least one `EntityRevision` written after the demo template finished seeding
  (`Project.demo_seeded_at`). Seeding itself records a "created" revision per
  crop through `Crop.save()`, so "has any revision" would count every demo
  project as used.
- **Eigenes Projekt danach angelegt:** how many of the users who loaded a
  demo project into their account in the window later created or joined a
  project of their own (a `ProjectMembership` on a non-demo project, dated
  after the demo project was created), shown as a count and as a percentage
  of that window's distinct demo users. Guest demos cannot be linked to a
  later registration, so they are not part of this metric.

The account demo metrics apply a viewer-specific exclusion. A demo project where the logged-in superuser is the sole member is left out
of the account demo-project rows, and the superuser is never counted as a
demo user for the conversion metric, even when sharing a demo project with
someone else. Like the "Projekte" table and the Gesamtübersicht totals, the
`?show_all=1` toggle lifts this exclusion here too, so it also surfaces the
superuser's own demo activity.

Beyond that activity view it reads the following existing data, always as
per-project counts or aggregates over all projects, never as per-user
behavior:

- **Feature adoption:** the share of projects that have more than one location,
  at least one uploaded planting-plan photo, seed packages, suppliers, tasks, or
  submitted in-app feedback (feedback rows, counted per project; message texts
  are not shown).
- **Growth and activation:** new projects per calendar month derived from the
  project `created_at` timestamp, and how many of them later created their first
  location or planting plan, including the average number of days that took.
- **Seasons:** the average number of seasons per project and the share of
  projects with a configured Saison-Muster (`SeasonPattern`).
- **Layouts:** the share of projects with at least one bed layout or field
  layout.
- **Crop diversity:** the average number of distinct crop names per project.
- **Tasks:** created and completed task totals in aggregate.
- **Template origin:** the share of projects created from the demo template,
  identified by the seeding timestamp or template description.
- **Crop library:** published `PublicCrop` entries per contributing project,
  project crops imported from the library (`source_public_crop`) versus
  self-entered ones, crops whose linked library entry has a newer version than
  the imported copy, and the aggregate number of public-library discussion
  comments and revisions.

The crop-library operations table covers the current UTC day and the previous
29. A public-library batch receipt with committed changes counts once, including
a partially successful batch. An older receipt retained in project history can
contribute to this total. Multi-item selections without a batch receipt and
actual pulls of library values into linked crops increment daily project
counters. An undo counts from its own committed receipt, even when the original
import falls outside the window. Coverage for these additional outcomes starts
with the crop-library usage migration. The existing history cleanup command
expires daily counters outside the 30-day window.

The activity trends use the latest 7, 30 or 90 UTC calendar days, including
today. The chart groups those days into days, Monday-based weeks or calendar
months, respectively. A user or project counts at most once per bucket and
once for the period summary. A session-authenticated write contributes when
it commits a recorded creation, edit, deletion or restore in a listed
workflow. Direct deletions also count dependent rows that Django removes in
the same operation. Failed, unchanged or replayed writes and automated, staff, guest
and external-token actions contribute no platform activity. The project
population filter also applies to these trends. Registrations and project
creations come from the existing `date_joined` and `created_at` fields.

Platform activity collection starts with migration
`0165_platform_usage_activity`. Earlier activity is unknown. On the first
day of collection, activity totals cover the portion after rollout. The
dashboard stores only daily project/category totals and one account/project
key per active UTC day for distinct-user counts. Daily records expire through
`cleanup_history` after the 90-day window. Finalizing account deletion
removes its active-day keys. There are no page visit, click, navigation or
record-content analytics. The activity charts show aggregate totals. The
superuser project table shows the project-level details described above.

See also the [public privacy policy](https://openfarmplanner.org/en/privacy).
