# Architecture Overview

OpenFarmPlanner is a Django REST Framework backend plus a React/TypeScript
single-page frontend, in one repository. This doc gives a developer or AI
agent enough of a mental model to navigate the codebase and reason about
where a change belongs. For setup/commands see the root
[`README.md`](../README.md); for the data model see
[data-model.md](./data-model.md).

## Tech stack

**Backend** (`backend/`)
- Python 3.12+, Django 5.2, Django REST Framework
- SQLite by default in development, PostgreSQL supported via env config
- PDM for dependency/script management (no `pip`/`requirements.txt`)

**Frontend** (`frontend/`)
- React 19 + TypeScript, built with Vite (installable PWA — see [pwa.md](./pwa.md))
- Material UI (MUI + MUI X DataGrid)
- React Router (data router API, `createBrowserRouter`)
- Plain `async`/`await` + component-local `useState`/`useEffect` for data
  fetching — there is no React Query/SWR/RTK-Query layer
- Vitest + Testing Library (unit/integration), Playwright (E2E)

## Repository layout

```text
backend/
  accounts/     # User account lifecycle: activation, password reset, deletion, consent
  farm/         # The core domain app: locations/fields/beds, crops, planting plans, seed demand, history
  crops/        # Public Crop Library boundary: official species list, translations, moderation (see crop-library-architecture.md)
  notifications/ # Generic per-user in-app notifications (see notifications.md)
  config/       # Django settings, URL roots
frontend/
  src/
    pages/            # One file (or small cluster) per route/screen
    components/       # Shared UI, including the custom data-grid layer
    api/               # httpClient (axios) + per-domain API modules + shared types
    auth/              # Session/auth context, CSRF handling, ProtectedRoute
    focus/, commands/  # Keyboard focus regions and the command/shortcut system
    crops/, crop-library/  # Project crop UI vs. the (not yet public) Crop Library UI
    notifications/     # Topbar bell (full layout) / "Mehr"-menu entries (compact) + API client
    i18n/              # Translation resources + language resolution/switcher (German, English)
    gantt-chart/       # Vendored third-party Gantt component (MIT, see its own README)
  e2e/                 # Playwright end-to-end tests
docs/                  # This documentation
```

## Backend structure

- **`farm`** is the main domain app: nearly every model and viewset for
  locations, fields, beds, crops, suppliers, planting plans, tasks, seed
  demand, and history/versioning lives here. Models live in the
  `backend/farm/models/` package (one module per domain: `base.py`,
  `projects.py`, `structure.py`, `crops.py`, `planning.py`, `notes.py`,
  `history.py`, `feedback.py`, all re-exported from `models/__init__.py`); views and
  serializers are organized into matching domain packages inside the app:
  - `farm/common/` — shared API plumbing: `ProjectScopedMixin`/
    `ProjectRevisionMixin` (`mixins.py`), shared serializer fields
    (`serializer_fields.py`), and the version endpoint (`views.py`).
  - `farm/history/` — the entity-revision engine (`records.py`,
    `restore.py`) plus the project/global history API endpoints.
  - `farm/projects/` — projects, memberships, invitations, agent login,
    and invitation email delivery (`emails.py`).
  - `farm/structure/` — locations, fields, beds, and bed/field layouts.
  - `farm/crops/` — crops, suppliers, seed packages, seed demand,
    and the public crop library endpoints.
  - `farm/planning/` — planting plans, tasks, and the yield calendar.
  - `farm/notes/` — media uploads and note image attachments.
  - `farm/feedback/` — the in-app feedback endpoint (`POST /api/feedback/`):
    it stores one `Feedback` row and emails it to `SUPPORT_CONTACT_EMAIL`
    with an `[Feedback] <category> – <project>` subject. When the user allowed
    contact, the account email becomes the mail's `reply_to`; without that
    consent no email address is attached to the feedback at all. A failed
    delivery is reported as `email_delivered: false` and never loses the
    stored row.
- **`accounts`** owns the Django `User` lifecycle: registration/activation,
  password reset, per-user project settings (`UserProjectSettings`:
  default/last project), account deletion with a grace period, self-service
  personal data export, and document-consent tracking. There is no custom
  `AUTH_USER_MODEL`. Sign-in with Google/Microsoft is layered on top via
  django-allauth, which contributes only the provider handshake and the
  external-identity records — the session, the account state, and the
  account-linking rules stay in `accounts`; see
  [social-login.md](./social-login.md).
- **`crops`** is the public Crop Library boundary. It owns `CropSpecies`
  (the official, language-independent species list), `CropSpeciesTranslation`,
  and `PublicLibraryModeratorRequest`, and serves three mounts:
  `/api/crop-library/` (a read-only view over `farm.PublicCrop`),
  `/api/crop-species/` (species list, proposals, moderator approve/reject) and
  `/api/public-library/moderator-requests/`. `PublicCrop` itself
  deliberately stays in `farm.models`. The dependency direction is meant to be
  one-way (crops must not depend on farm planning) and mostly is, with two
  documented exceptions noted in
  [crop-library-architecture.md](./crop-library-architecture.md) §3.
  `/api/crop-library/` exists *alongside* the older `/api/public-crops/` endpoint,
  which is still the one the frontend actually uses.
- **`notifications`** is a small, domain-agnostic app: one `Notification`
  model plus `/api/notifications/`. It knows nothing about crops or projects —
  producers pass a type, a context payload and an optional target reference,
  and the frontend decides what to render and where to link. See
  [notifications.md](./notifications.md).
- Views follow a thin-view convention (CLAUDE.md): business logic goes into
  `backend/farm/services/*.py` (e.g. `services_area.py` for bed-area
  math, `services/seed_packages.py` for the seed-package optimizer,
  `services/public_crops.py` for the publish/import bridge) rather than
  living in view methods.
- Physical measurements (area, spacing, seed rates) are stored in SI units
  internally (m², m, g) and converted only at API/serializer boundaries —
  see [seed-demand-calculation.md](./seed-demand-calculation.md) for the
  seed-amount/package-unit conversion specifically.

## Frontend structure

- **Routing** (`App.tsx`) and the navigation shell
  (`navigation/RootLayout.tsx`, with the shared topbar-action types in
  `navigation/topbarTypes.ts`): a single data router. Public routes
  (`pages/public/` — landing/imprint/privacy, `pages/auth/` —
  login/register/activation/password reset) render outside any auth check.
  Everything under `/app/*` is nested inside a single `<ProtectedRoute />`
  element, which gates on auth-loading state, redirects unauthenticated
  users to `/login`, and — before rendering the app — forces acceptance of
  any pending legal consents via `<ConsentGate />`.
- **Pages** (`frontend/src/pages/`), one per main route:

  | Page | Route | Purpose |
  |---|---|---|
  | `Dashboard.tsx` | `/app/dashboard` | Landing page / setup checklist |
  | `Locations.tsx` | `/app/locations` | Manage farm locations (Standorte). **Not linked in the navbar** — route and component still exist, kept for potential future use, but there is currently no in-app way to reach this page. |
  | `FieldsBedsPage.tsx` / `FieldsBedsHierarchy.tsx` / `GraphicalFields.tsx` | `/app/fields-beds` | Fields & beds: hierarchy (tree) view and graphical (map) view |
  | `Crops.tsx` | `/app/crops` | Manage the project crop library; Public Crop Library import/export and version history |
  | `crop-library/pages/PublicCropLibraryPage.tsx` | `/app/crop-library` | Full public Crop Library workspace: browse, import, discuss, edit, version history |
  | `crop-library/pages/PublicLibraryModerationPage.tsx` | `/app/public-library-moderation` | Moderation queues: species proposals, moderator-access requests, removed entries |
  | `PlantingPlans.tsx` | `/app/anbauplaene` (alias `/app/planting-plans`) | Spreadsheet-like editable grid of planting schedules |
  | `GanttChart.tsx` | `/app/gantt-chart` | Bed-occupancy timeline / seedling calendar |
  | `YieldOverview.tsx` | `/app/yield-overview` | Aggregated harvest/yield overview |
  | `SeedDemand.tsx` | `/app/seed-demand` | Seed quantity/package requirement per crop |
  | `Suppliers.tsx` | `/app/suppliers` | Manage seed/plant suppliers |
  | `ProjectSelectionPage.tsx` | `/app/project-selection` | Pick/create/restore a project |
  | `ProjectSettingsPage.tsx` | `/app/project-settings` | Rename/delete project, manage members & invitations |
  | `AccountSettingsPage.tsx` | `/app/account-settings` | Account details, login methods, API tokens for external tools, language, data export, deletion |

  (`pages/InvitationPage.tsx`, an earlier, unrouted invitation-accept
  implementation superseded by `InvitationAcceptPage.tsx`, was confirmed
  dead — nothing in `App.tsx`'s router referenced it — and removed.)

- **Page sub-components**: the largest pages are being decomposed by
  extracting purely presentational blocks (dialogs, menus, filter bars)
  into per-domain component folders — `components/planting-plans/` for
  `PlantingPlans.tsx`, `components/gantt/` for `GanttChart.tsx`. The
  pattern is deliberate: all state and handlers stay in the page; the
  extracted components only render props. Stateful-hook extraction from
  these pages is avoided because it breaks React Compiler analysis.
- **API layer** (`frontend/src/api/`): `httpClient.ts` is the one shared
  axios instance; a single request interceptor attaches `X-Project-Id`
  (read fresh from `localStorage` per request) and `X-CSRFToken`.
  `api.ts` groups REST calls into per-domain objects (`cropAPI`,
  `plantingPlanAPI`, `seedDemandAPI`, ...) on top of that client.
  `auth/authApi.ts` is a **separate**, hand-rolled `fetch`-based client used
  only for auth endpoints (login/register/session), independent of the
  project-header interceptor. This means there are two independent
  error-message-normalization implementations (`api/errors.ts` for the
  axios client, `authApi.ts`'s own for the auth client) — a known
  duplication, not a bug, if you're looking for "the" error handler.
- **i18n**: one JSON namespace per feature area under
  `frontend/src/i18n/locales/{de,en}/` (17 namespaces today), with key parity
  between the two bundles enforced by a test. German and English are both
  live: users pick a language in the account menu, account settings, or the
  public-page switcher, the choice is stored per account (`ui_language`) and
  in `localStorage`, and the backend resolves content language from
  `Accept-Language`. The full rules — resolution order, the crop-library
  translation model, fallback labelling — are in [i18n.md](./i18n.md).
- **Keyboard navigation & commands**: a focus-region model plus a
  shortcut/command system — see
  [keyboard-architecture.md](./keyboard-architecture.md).
- **The custom DataGrid layer**: most editable tables use a shared
  `EditableDataGrid` wrapper around MUI X DataGrid with inline editing,
  autosave-on-blur, row actions, and notes — see
  [datagrid-architecture.md](./datagrid-architecture.md). Not every grid
  page uses it — `FieldsBedsHierarchy.tsx` renders a raw MUI `DataGrid`
  directly with its own, independently-implemented context-menu and
  keyboard-navigation logic; treat the two as parallel, not shared,
  implementations when changing either one.

## Project, user, and permission model

- A `Project` is the tenant boundary; a `User` gets access only via a
  `ProjectMembership` (role: `admin` or `member` — no finer-grained
  permission system exists).
- Every project-scoped API request must carry an `X-Project-Id` header.
  `ProjectScopedMixin` (`backend/farm/common/mixins.py`) resolves and validates it
  once per request, then auto-scopes the queryset and auto-injects the
  project on create — this is the actual multi-tenancy enforcement point,
  not something each view re-implements.
- On the frontend, the active project id is tracked in `AuthContext`
  (seeded from the server-resolved `resolved_project_id` on login/refresh),
  persisted to `localStorage['activeProjectId']`, and read fresh by the
  axios interceptor on every request. Switching projects
  (`switchActiveProject`) calls a dedicated endpoint, updates that storage
  key, and then does a full `window.location.reload()` — a deliberate
  choice to guarantee no page holds stale cross-project state, rather than
  relying on React state propagation alone.
- A rare **agent-mode** session type (`AgentLoginToken`, superuser-created)
  locks a session to one specific project regardless of the `X-Project-Id`
  header sent, and is explicitly never treated as admin even if the
  underlying user is one — used for automation/agent tooling access, not
  regular users.
- **Project-bound API tokens** (`ProjectApiToken`, created by any member from
  account settings) are the supported way for external tools to call the API.
  They authenticate a single request via `Authorization: Bearer …`, derive the
  project from the token row rather than from any header, carry a `read`,
  `write`, or `delete` scope, and can only reach views that explicitly declare
  `api_token_actions`. Session authentication is unaffected — see
  [agent-api.md](./agent-api.md).
- Full model relationships: [data-model.md](./data-model.md#1-projects-users-and-access).

## Account Settings UI

`/app/account-settings` uses the normal app topbar title (`Kontoeinstellungen`
in the German UI); the page body starts directly with the **Profile** card
rather than repeating a large content heading. The settings are grouped into
independent cards, all using the same card-collapse pattern:

- **Profile**, **Login & Security**, and **API tokens for external tools** are
  expanded by default.
- **Language**, **Privacy & data export**, and **Developer** are collapsed by
  default.
- **Account** stays visible and non-collapsible because it contains the
  destructive account-deletion action.

The **API tokens for external tools** card renders active tokens in a MUI
DataGrid table with columns for name, rights, project, creation time, expiry,
last use, and action. Expired and revoked tokens are grouped below the active
table behind the collapsed toggle **Abgelaufene und widerrufene Tokens anzeigen
(N)** and render in a separate table without the action column.

## Notable architecture & UX decisions worth knowing before changing things

These are decisions already made deliberately — see CLAUDE.md's
"Architecture Safety Rules": don't change established UX behavior without
an explicit request, and search for the existing pattern before introducing
a new one.

- **History is snapshot-based, not event-sourced.** `EntityRevision`
  stores full JSON snapshots per mutation, not deltas to replay. See
  [versioning-and-history.md](./versioning-and-history.md).
- **The Crop Library split already exists in the data model** (`Crop` is
  project-owned, `PublicCrop` is shared) and has a full authenticated
  workspace at `/app/crop-library`, but it is **not public yet** and the
  frontend still talks to the legacy `/api/public-crops/` rather than
  `/api/crop-library/` — see
  [crop-library-architecture.md](./crop-library-architecture.md) before
  assuming `/api/public-crops/` can be renamed or removed.
- **Large datasets use windowed rendering, not virtualization inside the
  vendored Gantt library** (which doesn't virtualize on its own) — see
  [large-dataset-rendering.md](./large-dataset-rendering.md).
- **Column visibility is now handled entirely by MUI's native columns
  panel**, not a custom show/hide menu — a custom implementation was
  deliberately removed in favor of it (see
  [datagrid-architecture.md](./datagrid-architecture.md#column-visibility)).
  Don't reintroduce a bespoke column-visibility UI on `EditableDataGrid`.
- **Deployment/infrastructure live in a separate repository**
  (`ops`) — this repo intentionally has no Dockerfile,
  deploy scripts, or cron config for production use.
- **`overflow-x: hidden` belongs on `<body>`/`#root`, never on `<html>`**
  (`frontend/src/index.css`). The viewport takes its overflow from the root
  element and only falls back to `<body>` when the root's own overflow is
  `visible`. Setting it on `<html>` makes `<html>` the scrolling box, which
  silently disables MUI's modal scroll lock — `Modal`/`Menu`/`Popover`/
  `Dialog` set `overflow: hidden` on `<body>` and add the scrollbar width as
  `padding-right` to compensate. With the compensation applied but the
  scrollbar still there, every menu shrank the page sideways. Guarded by
  `frontend/e2e/scrollbar-layout.spec.ts`.
- **A viewport-fixed backdrop and its overlay must share one containing
  block** (`components/HeroImage.tsx`'s `position` prop applies to the image
  *and* the dimming overlay). Pinning the image to the viewport while the
  overlay stays bound to a container lets the raw image show through
  wherever the two disagree in width.
- **A 401 mid-session logs the user out globally.** `httpClient`'s response
  interceptor turns an authentication-expired error into a window event
  (`openfarmplanner:authentication-expired`); `AuthContext` listens for it and
  clears the authenticated user, which drops the app back through
  `<ProtectedRoute />` to `/login`. The event carries the request's start
  timestamp so a slow request that started *before* a successful
  re-authentication cannot log the user back out — don't "simplify" that
  timestamp away.
- **Role gating on the frontend is one page, not a system.**
  `ProjectSettingsPage.tsx`'s `isProjectAdmin` (`activeMembership?.role ===
  'admin'`) is the only role conditional in the app; it hides project
  rename/delete and member management. Everything else relies on the backend's
  `require_project_admin()` check. Do not assume a frontend permission layer
  exists to extend — there is one flag on one page.

## Unclear / needs check

- Whether every admin-only backend action has a matching frontend affordance
  (or a sensible error path when a member triggers it anyway) — the two lists
  were not reconciled endpoint by endpoint while writing this doc.
