# Data Model Overview

This is a conceptual map of OpenFarmPlanner's core Django models
(`backend/farm/models/`, `backend/accounts/models.py`) and how they relate.
It is **not** a full field reference — see the model source for exact fields,
`help_text`, and validation. The goal here is to help you reason about which
objects exist, how they're connected, and which relationships matter for
typical features (a new column on the planting-plan grid, a new report, a
permission check, ...).

For the frontend/backend split and general architecture, start at
[architecture-overview.md](./architecture-overview.md).

## 1. Projects, users, and access

Every piece of farm data belongs to exactly one `Project` — projects are the
tenant boundary. A `User` (Django's built-in auth `User`, no custom user
model) gets access to a project only via a `ProjectMembership` row.

```mermaid
erDiagram
    User ||--o{ ProjectMembership : "has memberships"
    Project ||--o{ ProjectMembership : "has members"
    User ||--o{ ProjectInvitation : "invited_by / accepted_by / revoked_by"
    Project ||--o{ ProjectInvitation : "has invitations"
    User ||--o| UserProjectSettings : "1:1"
    Project ||--o{ UserProjectSettings : "default_project / last_project"
    User ||--o| PendingActivation : "1:1 (email activation)"
    User ||--o| AccountDeletionRequest : "1:1 (deletion grace period)"
    User ||--o{ AgentLoginToken : "created_by (superuser tooling)"
    Project ||--o{ AgentLoginToken : "scoped to"
    User ||--o{ ProjectApiToken : "owns (external tool tokens)"
    Project ||--o{ ProjectApiToken : "bound to exactly one"
    User ||--o{ CropImportDraft : "created_by"
    Project ||--o{ CropImportDraft : "scoped to"
```

- **`ProjectMembership.role`** is either `admin` or `member` — this is the
  *entire* permission model. There is no per-object or field-level
  permission system, no "read-only" role. Ordinary CRUD on farm data
  (locations, fields, beds, crops, planting plans, tasks, ...) only
  requires *any* membership; a short list of destructive/irreversible or
  membership-changing actions (delete/restore project, change a member's
  role, remove a member, send invitations, restore-from-history) requires
  the `admin` role — enforced in view code (`require_project_admin()` in
  `backend/farm/project_context.py`), not a DB constraint.
- Final account deletion removes the user's `ProjectMembership` rows. Any
  project that is left with zero memberships is hard-deleted together with
  its project-scoped data. If members remain but the deleted account was the
  last admin, one remaining member is promoted to admin so the project stays
  manageable. Shared `PublicCrop` entries are not owned by a project and
  use nullable provenance links (`on_delete=SET_NULL`), so they remain part
  of the public knowledge base even when the source project is deleted.
- **`ProjectApiToken`** is the credential external tools use for API access
  outside the browser session (for example coding agents, scripts, or CI jobs).
  It is bound to one user *and* one project at creation time and stores only a
  SHA-256 digest of the token plus a short display prefix; the plaintext is
  returned once and never again. Its `scope` (`read` / `write` / `delete`) is a
  second, narrower permission axis on top of `ProjectMembership.role` — it can
  only ever *reduce* what the owning member may do, never widen it, and it
  grants no administrative access at all. The `delete` scope is limited to
  crop soft-delete/restore. **`CropImportDraft`**
  stores a validated import awaiting confirmation, which is what makes the
  preview/apply split tamper-evident. See [agent-api.md](./agent-api.md).
- Every API request that touches project-scoped data must send an
  `X-Project-Id` header (token-authenticated requests are the exception —
  their project comes from the token row); `ProjectScopedMixin` (`backend/farm/common/mixins.py`)
  resolves and validates it once per request (`initial()`), then
  auto-filters `get_queryset()` by `project=request.active_project` for any
  model that has a `project` field, and auto-injects `project` on create.
  This is the actual multi-tenancy enforcement point — see
  [architecture-overview.md](./architecture-overview.md#project-user-and-permission-model)
  for the full request-time flow.
- **`Project.deleted_at`** is the project trash marker. Soft-deleted projects
  are hidden from normal project selection, can be restored by an admin while
  `deleted_at` is set, and are permanently deleted by the scheduled
  `cleanup_deleted_projects` command once they have been in the trash for
  more than 30 days. Manual permanent deletion uses the same database cascade
  as the cleanup command.
- **Unclear / needs check**: the invariant "a project always has at least
  one admin" is enforced only in `ProjectMembersView` view logic, not at the
  database level.

## 2. Farm structure: locations → fields → beds

```mermaid
erDiagram
    Project ||--o{ Location : has
    Location ||--o{ Field : "has (Parzelle)"
    Field ||--o{ Bed : "has (Beet)"
    Bed ||--o| BedLayout : "1:1 map position"
    Field ||--o| FieldLayout : "1:1 map position"
```

- `Location` → `Field` → `Bed` is a strict three-level physical hierarchy
  ("Standort" → "Parzelle" → "Beet" in the UI). Only *area* (`area_sqm`) is
  stored for fields/beds today, no polygon geometry — see
  [`archive/FIELD_BED_AREA_IMPLEMENTATION.md`](./archive/FIELD_BED_AREA_IMPLEMENTATION.md)
  for the historical rationale and the intended future geometry extension
  path.
- `BedLayout`/`FieldLayout` hold persisted x/y coordinates for the
  graphical/map layout view (`GraphicalFields.tsx`) — they're optional,
  separate rows from `Bed`/`Field` themselves, not embedded fields.
- `Field`, `Bed`, and most other project-scoped models below also carry a
  **direct, denormalized `project` FK** in addition to their natural parent
  (e.g. `Bed.project` in addition to `Bed.field`). This is deliberate — it's
  what lets `ProjectScopedMixin` filter *any* scoped model uniformly by
  `project`, without walking the parent chain. Don't treat it as redundant
  data to clean up.

## 3. Crop / crop domain and the seed supply chain

```mermaid
erDiagram
    Project ||--o{ Crop : owns
    Project ||--o{ Supplier : has
    Crop ||--o{ CropSupplierData : "per-supplier seed data"
    Supplier ||--o{ CropSupplierData : supplies
    Crop ||--o{ SeedPackage : "package sizes (supplier-agnostic)"
    Supplier ||--o{ Crop : "preferred supplier of (nullable)"
    Supplier ||--o{ Crop : "seed-demand supplier of (nullable)"
    PublicCrop ||--o{ Crop : "import lineage (optional, nullable)"
    Crop ||--o{ PublicCrop : "publish lineage (optional, nullable)"
```

- **`Crop`** is project-owned: every project has its own private copy of
  every variety it grows, including growing parameters and history. It's
  soft-deletable (`deleted_at`); the default manager (`objects`) hides
  soft-deleted rows, `all_objects` doesn't (used by restore flows).
- **`PublicCrop`** is the shared, cross-project "crop library" — it has
  no owning `Project`, only optional *provenance* links back to the project
  and crop it was published from. Published rows are intended to be
  durable open-data knowledge-base entries under the public-library
  contribution terms, not ordinary user-owned records with self-service
  deletion. Its own satellite records (translations, revisions, discussions,
  status events) are in [§5](#5-public-crop-library); see
  [crop-library-architecture.md](./crop-library-architecture.md) for the
  full story of how this split is formalized into the `crops` Django app.
- **`CropSupplierData`** is the join between one `Crop` and one
  `Supplier`: supplier-specific product data (price, packaging sizes,
  germination rate, thousand-kernel-weight). `SeedPackage` is a simpler,
  supplier-agnostic "this crop comes in these package sizes" record.
  `Crop.selected_seed_demand_supplier` is a *separate* nullable FK from
  `Crop.supplier` (the general "preferred supplier") — it specifically
  drives which supplier's data feeds the Seed Demand calculation. See
  [seed-demand-calculation.md](./seed-demand-calculation.md) for how these
  pieces combine into an actual quantity.

## 4. Planning and operations

```mermaid
erDiagram
    Crop ||--o{ PlantingPlan : "planted as"
    Bed ||--o{ PlantingPlan : "scheduled on"
    Season ||--o{ PlantingPlan : "scoped to (nullable)"
    Project ||--o| SeasonPattern : "1:1 start day/month"
    Project ||--o{ Season : has
    PlantingPlan ||--o{ Task : "optional related task"
    PlantingPlan ||--o{ NoteAttachment : "photo notes"
```

- **`PlantingPlan`** is the central operational record: one crop, on one
  bed, with a planting date and computed harvest date(s). It drives the
  Gantt/occupancy calendar, the seed demand view, and the yield overview.
- **`Season`**/**`SeasonPattern`** scope planting plans into successive
  ~12-month periods; the crop library and bed/field structure stay
  season-independent. `PlantingPlan.season` is nullable only until a
  project's first-run season setup assigns one to its pre-existing plans.
  See [seasons-architecture.md](./seasons-architecture.md) for the full
  model, the `X-Season-Id` scoping mechanism, and the copy-data/setup flows.
- There is no separate `Note` model. Free-text notes are plain `notes` text
  fields directly on `Location`, `Field`, `Bed`, `Crop`,
  `CropSupplierData`, `PublicCrop`, and `PlantingPlan`.
  `NoteAttachment` only stores *photo attachments*, and only for
  `PlantingPlan` — see
  [datagrid-architecture.md](./datagrid-architecture.md#notes--markdown-cells)
  for how these render as rich markdown+photo notes in the grid.

## 5. Public crop library

These are the shared, cross-project records behind the public Crop Library.
None of them has a `project` FK. `CropSpecies` and `CropSpeciesTranslation`
live in the `crops` app (`backend/crops/models.py`); everything else lives in
`backend/farm/models/crops.py` alongside `PublicCrop` itself.

```mermaid
erDiagram
    CropSpecies ||--o{ CropSpeciesTranslation : "localized common names"
    CropSpecies ||--o{ PublicCrop : "official species of (nullable)"
    CropSpecies ||--o{ Crop : "optional private species link (nullable)"
    PublicCrop ||--o{ PublicCropTranslation : "localized description"
    PublicCrop ||--o{ PublicCropRevision : "immutable version history"
    PublicCrop ||--o{ PublicCropStatusEvent : "lifecycle audit trail"
    PublicCrop ||--o{ PublicCropDiscussionTopic : "discussion threads"
    PublicCropDiscussionTopic ||--o{ PublicCropDiscussionComment : "posts and replies"
    PublicCropDiscussionComment ||--o{ PublicCropDiscussionComment : "parent / reply"
    PublicCropRevision ||--o{ PublicCropDiscussionTopic : "optionally discusses a version"
    PublicCrop ||--o{ PublicCropChangeProposal : "moderation queue for new/API-token writes"
    User ||--o{ PublicLibraryModeratorRequest : "requests moderator access"
```

- **`CropSpecies`** is the language-independent identity ("tomato" is one
  row, not one row per language). Its `status` is `published` / `proposed` /
  `rejected`: a user can propose a species from the publishing wizard and
  publish against it immediately, while it stays hidden from every other
  surface until a moderator approves or rejects it. It is **nullable** on
  private `Crop` rows — free-text project crops stay valid — but
  required at the publishing boundary.
- **Translations** are separate rows, never columns: `CropSpeciesTranslation`
  holds `(species, language_code) → common_name`, `PublicCropTranslation`
  holds `(entry, language_code) → description`. Varieties are proper names and
  are never translated. See [i18n.md](./i18n.md) for the fallback rules.
- **`PublicCropRevision`** is the library's own immutable version history —
  a *different* mechanism from `EntityRevision` in §6, which only covers
  project-scoped data. Editing a public entry always appends a revision;
  reverting appends another one rather than deleting any.
- **`PublicCropStatusEvent`** records every `draft`/`published`/
  `withdrawn`/`removed` transition, which is what makes contributor withdrawal
  and moderator removal auditable instead of destructive.
- **`PublicCropChangeProposal`** is the moderation queue for crop-library
  contributions that may not apply live: those from accounts still at the
  `new` trust level and those made with a `ProjectApiToken`. `kind`
  distinguishes an edit from a new publish, the latter pointing at a
  still-`draft` `PublicCrop`. See
  [account-trust-levels.md](./account-trust-levels.md). Moderators review
  them in the contributions queue on the moderation page.
- **`PublicLibraryModeratorRequest`** backs the "request moderator access"
  flow. Approval only adds the user to the `Public Library Moderators` group
  (permission `crops.moderate_crop_species`) — it never grants staff or Django
  admin rights.

Full behaviour, including the publishing wizard and the moderation surfaces:
[crop-library-architecture.md](./crop-library-architecture.md).

## 6. History and versioning

```mermaid
erDiagram
    Project ||--o{ EntityRevision : "generic audit trail"
```

`EntityRevision` is the current, generic history mechanism: one row per
mutation of *any* trackable entity (`entity_type` + `object_id`, a full
JSON `snapshot`, and a diff-style `changed_fields` list). It superseded two
now-deprecated, drain-only models, `CropRevision` and `ProjectRevision`
(crop-only and whole-project-JSON-blob designs that didn't scale). See
[versioning-and-history.md](./versioning-and-history.md) for how this
powers project history and restore.

## Unclear / needs check

- The exact session lifecycle of `AgentLoginToken` (how `agent_mode` /
  `agent_project_id` get set in the session on token consumption) wasn't
  traced end-to-end while writing this doc.
- Whether any code path other than `require_project_admin()` gates
  behavior by role — a full audit of every view wasn't performed.
