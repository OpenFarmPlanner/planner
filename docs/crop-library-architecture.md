# Crop Library / Farm Planning Architecture

Date: 2026-07-03 (implementation status reviewed against the code 2026-08-12)
Scope: `backend/`, `frontend/src/`

## Implementation status at a glance

This document describes **shipped behaviour**; where it talks about future
work it says so explicitly (mainly §5, "Deliberately NOT done"). The separate
[public-crop-library-data-model.md](./public-crop-library-data-model.md) is the
opposite: apart from the parts it explicitly marks as shipped, it is a *target
model and migration plan*, not a description of the current schema. When the
two disagree about what exists, this file wins.

| Area | Status |
|---|---|
| `crops` Django app with `CropSpecies` (+ translations) and a moderator-request model | **implemented** |
| Publishing wizard (species mapping, original language, duplicate gate, species proposals) | **implemented** |
| Duplicate detection on `crop_species` + normalized `variety` (cross-language) | **implemented** |
| Direct wiki-style editing of public entries + immutable `PublicCropRevision` history + revert | **implemented** |
| Threaded discussions (`PublicCropDiscussionTopic` → `…Comment`, soft delete) | **implemented** |
| Non-destructive lifecycle (`draft`/`published`/`withdrawn`/`removed`) + status events + staff hard delete | **implemented** |
| Moderation surfaces: species proposals, moderator-access requests, restoring removed entries (`/app/public-library-moderation`) | **implemented** |
| Moderator crop-species correction of a published entry ("Kulturart korrigieren", §9) | **implemented** |
| Full library workspace at `/app/crop-library` (browse, import, discuss, edit, versions) | **implemented** |
| `PublicCropChangeProposal` review workflow | **implemented** — queues contributions from new accounts and API tokens, reviewed in the contributions queue on the moderation page (see [account-trust-levels.md](./account-trust-levels.md)) |
| `/api/crop-library/` as the *only* library surface; frontend switched off `/api/public-crops/` | **not done** — see §5 |
| Unauthenticated public `/crops` route | **not done** — see §5 |
| Separate `CropVariety` entity and species→variety attribute inheritance | **not done** — planned in public-crop-library-data-model.md §2 |

### Naming: code/domain term vs. UI label

Throughout this repository the *domain* term is "public Crop Library": it names
the `crops` Django app boundary, the `Public*` models, the `/api/crop-library/`
surface, and the `PublicCropLibraryPage` component. The *user-facing* label,
however, is plain **"Kulturbibliothek"** (German) / **"Crop library"**
(English) — the word "öffentlich"/"public" was dropped from the UI because the
library is the only crop library users navigate to. Legal texts in
`home.json` (privacy policy, terms of service) deliberately keep the explicit
"öffentliche Kulturbibliothek" / "public crop library" wording, because the
public nature of publishing is what those sections describe. Do not rename
code identifiers to match the UI label.

Goal: prepare and evolve the architecture for a public Crop Library
(`/crops`) without splitting the repository unnecessarily. The library is
now treated as a long-lived, community-built knowledge base for crop data.
Users can withdraw their own accidental publications through a non-destructive
status transition; moderation and cleanup use stronger staff-only states.
The collaborative editing model is now direct: public entries have discussion
comments and immutable version history, while the import picker stays optimized
for quickly copying a crop into the active project.

## 0. Product and legal model

The public Crop Library follows an open-data model:

- Published crop data becomes part of a shared knowledge base intended to
  persist beyond the contributing user's project or account.
- Contributors may take their own publications back out of the library when a
  publication was accidental or needs correction. Withdrawal is
  non-destructive: the entry disappears from discovery, but attribution,
  license evidence, import lineage, and already-imported project copies remain
  intact. The UI offers this as a single "Aus Bibliothek entfernen" action.
- Moderator removal is reserved for exceptional cases such as test data,
  duplicates, unlawful content, personal data in a published record, spam,
  obvious abuse, or another moderation decision. It is also non-destructive.
- Farm-specific planning decisions are not library data and are neither
  published nor served by the public API. The seed safety margin
  (`sowing_calculation_safety_percent` and its direct/pre-cultivation
  variants) is the concrete case: it depends on the farm's germination
  expectations, seeding technique and risk appetite, not on the crop, so
  publishing leaves it in the project crop and importing never overwrites
  it. The shared `CropForm`/`SeedingSection` and `CropSeedDetails` hide
  the field entirely in the public-library variant (`showSeedSafetyMargin`),
  and keep it for project crops. See "Private project data that remains
  private" in
  [`public-crop-library-data-model.md`](public-crop-library-data-model.md).
- Public entries can be edited directly by logged-in users. Each edit is
  immediately published as the current public version and records an immutable
  `PublicCropRevision` snapshot with author, timestamp, changed fields, and
  old/new values where they are displayable.
- The public entry identity is fixed after publication in one direction only:
  `name` (`Kulturart`) can never be changed through the wiki-style edit
  payload — the API rejects manipulated direct edit requests that try to
  change it, and the UI shows it as static, read-only context in the shared
  crop form. `variety` (`Sorte`) is the one exception: an admin editing a
  public entry may correct the variety name (typo fixes) through the same
  edit payload as any other editable field. The identity uniqueness invariant
  from publish time still applies — `update_public_crop_directly()`
  rejects a rename that would collide with another published entry for the
  same species/name (`find_public_crop_identity_conflict()`, 409
  `public_crop_variety_conflict`). Because imported project crops are
  linked by a stable `source_public_crop` foreign key rather than by name,
  a variety rename propagates through the existing re-import/update model
  (`import_public_crop_into_project()`) exactly like any other field edit:
  the linked project crop picks it up on its next explicit
  update/re-import, or the confirm-required conflict dialog if it has local
  edits (the 409 response there also flags `variety_changed` so the frontend
  can call the identity change out explicitly instead of blending it into a
  generic warning).
- Nothing about that model is automatic, but it is no longer invisible.
  `CropSerializer.public_update_available` is true when the linked entry's
  `version` moved past the copy's `source_public_version` **and**
  `public_crop_update_changes()` finds an actual compared-field difference — a
  translation-only bump, or a value the copy already matches, is not a pending
  update (nothing to review, nothing to disable the push over). The compared
  set is `CROP_COPY_FIELDS` minus `display_color` (a project-local colour: an
  imported crop always has an auto one, a public entry often none) and, on a
  species-linked Sorte, `crop_family` / `nutrient_demand` (they live on the
  species entry). An apply overwrites exactly that same set — `variety`
  included, so a rename can never be applied without appearing in the preview;
  `display_color` is popped from the apply too, matching the diff.
  `GET /api/crops/<id>/public-update/` returns that diff and is read-only:
  confirming in the dialog calls `public-crops/<id>/import/` with
  `mode=update`, so the private crop page and the library page share one
  import/update path.
- The library page's "Im Projekt aktualisieren" button is disabled when there
  is nothing to pull. `PublicCropSerializer.project_import_status` carries
  `is_up_to_date`, computed by `is_project_crop_up_to_date()` — the same
  predicate `import_public_crop_into_project()` uses to decide its `unchanged`
  outcome, so the button state and the endpoint can never disagree. A locally
  modified copy is deliberately *not* up to date: re-importing it raises the
  confirm-required conflict, which is a real choice to offer. The field
  comparison behind it runs against the general-crop index the serializer
  builds once per page, and only for copies that are actually behind their
  entry's `version` — `test_public_crops_list_query_count` pins that it stays
  one query per page rather than one per imported copy. The library page
  replaces its row from the response of an edit, a version revert or a
  status change, so `PublicCropViewSet._public_crop_response` re-attaches
  the project-import prefetch those write paths lose when the service
  returns a freshly locked row — otherwise the button would fall back to
  its "import" label until the next list reload.
- **Sync link vs. provenance.** `Crop.source_public_crop` (with
  `source_public_version` and `rejected_public_version`) is the *sync link*
  everything in this update model reads. `is_modified_from_source` belongs to
  both: `Crop.save()` sets it on the first tracked edit of a crop that is
  linked *or* derived from an entry, and an unlink keeps it, so provenance
  readers can still tell the library's values from the user's own. Where a
  crop came from is recorded separately in
  `Crop.derived_from_public_crop` (FK, `SET_NULL`, read-only in the API):
  `Crop.save()` fills it from the first sync link a row gets (import, link,
  form autofill), and migration `0109_crop_derived_from_public_crop`
  backfilled it for every crop linked at the time. Provenance readers use it —
  `CropSerializer.description_language_code` (an untouched copy's notes are the
  library's text) and the engagement dashboard's imported/self-entered split —
  so values taken from the library stay attributed as CC BY-SA data after an
  unlink. `origin_type` is independent of both and never reset.
- **Removing a library link ("Verknüpfung aufheben").** `POST
  /api/crops/<id>/unlink-public-crop/` (`unlink_crop_from_public_entry()`,
  same permission as editing the crop) clears only the sync link fields above
  (`is_modified_from_source` stays);
  no crop value, no provenance, no `origin_type` and nothing in the public
  library changes, and linked Sorten keep their own links (live inheritance
  runs over `crop_species`, not the link). It is a normal `Crop.save()`, so the
  project history records it and the existing restore puts the link back
  (`restore_crop_from_revision` restores the two library FKs from the
  snapshot's `_id` keys while the entry still exists). Errors:
  `crop_not_linked` (no sync link) and `crop_link_owned` (the linked entry is
  *published* by this user — withdrawing it is the path there, and an unlinked
  copy would collide with the user's own entry on its next publish; once that
  entry is withdrawn or removed the collision risk is gone and the unlink is
  allowed). One predicate, `resolve_public_crop_unlink_block()`, backs both the
  endpoint and the serializer fields `can_unlink_public_crop` /
  `unlink_public_crop_blocked_reason`; the UI offers "Verknüpfung aufheben" in
  the crop's ⋮ menu exactly when `can_unlink_public_crop` is true
  (`canUnlinkPublicCrop` reads only that flag), behind a
  confirmation that lists what stays ("Verknüpfte Sorten bleiben verknüpft."
  only when the Kultur has linked Sorten). The dialog names the entry from
  `source_public_crop_title`, and shows a backend rejection inline. Afterwards the crop resolves to
  case 1 ("In Bibliothek teilen"), the "Importiert" badge stays, and the
  wizard offers the duplicate's "Mit diesem Eintrag verknüpfen" again. This is
  also the way out for a farm that deliberately keeps its own values and does
  not want a standing "Bibliothek aktualisieren" action.
- This link is recorded on **publish**, not only on import.
  `publish_crop_to_public_library` calls `link_local_crop_to_owned_public_entry`
  for the published crop (and, on a variety publish, links the project's
  general Kultur to the auto-created species-level entry), setting
  `source_public_crop` / `source_public_version` without ever flipping
  `origin_type` to `imported` — the row stays the user's own and the
  "Importiert" chip must not appear. `_apply_public_crop_update` therefore
  also pops `origin_type` from the pull payload. Migration
  `0103_link_published_crops_to_owned_entries` backfills the link for
  entries published before this change (skipping rows already linked or
  imported), taking the entry's current `version` as the new baseline.
- **One control carries all of this.** The crop detail badge row has a single
  `CropLibraryActionButton` (next to the "Importiert" badge) whose label,
  colour, enabled state and target follow the context — it replaced the header
  overflow entry, a standalone "Update verfügbar" banner, a sync marker chip
  and the "Lokal" / "Veröffentlicht" / "Lokal geändert" badges.
  `resolveCropLibraryAction` decides, first match wins (every state carries a
  tooltip, on hover and on keyboard focus):
  1. **not linked** -> button "In Bibliothek teilen", up arrow, opens
     the publishing wizard.
  1b. **linked entry withdrawn or removed** (`public_publish_blocked_reason`
     `entry_withdrawn` / `entry_removed`, with `source_public_crop_status`) ->
     no push/pull button, only a neutral status chip "Eintrag zurückgezogen" /
     "Eintrag entfernt" (link-off icon) whose tooltip says the entry is no longer in the
     library and the link can be removed or the entry restored. The link is
     kept because withdrawal and removal are restorable; after a restore the
     crop resolves normally again, and a crop unlinked meanwhile stays
     unlinked. Ranked before every push and pull case. The one exception is a
     contributor's **own withdrawn** entry (`can_republish_public_crop`, the same
     `can_republish_withdrawn_entry()` predicate the publish guard uses): there
     the chip is replaced by the button "Wieder veröffentlichen", which asks for
     one confirmation and calls `publish-public` (the single push path), bringing
     the entry back as published. A removed entry is a moderation decision and
     is never republishable by its contributor. The backend backs this:
     `public-sync` (GET and POST) and `publish-public` answer 409
     `public_crop_link_unavailable` (with `reason`) for such a link — except
     `publish-public` for the contributor's own withdrawn entry (§8). Status
     changes of a `PublicCrop` never modify the private crop.
  2. **`public_update_available`** (an undecided pending version) -> button
     "Kultur aktualisieren", blue, down arrow (pull), opens the pull diff/apply
     dialog. Wins over any push offer.
  2b. **`public_update_rejected`** -> no button at all, only a neutral
     "Update abgelehnt" status chip (`crop-detail-library-status`, sync-disabled
     icon). Declining is a decision the UI has to respect, so the action
     disappears until the facts change: because the rejection is stored as the
     public *version* number, the pull button of case 2 comes back on its own
     the moment the entry changes into a version the user never decided on, and
     an identical re-publish (same version, or a bump with no compared-field
     change) does not bring it back. The chip stays clickable and reopens the
     same diff, so a change of mind never needs another public edit. It is
     ranked above the push cases deliberately: pushing a declined copy would
     silently undo the very change the user declined.
  2c. **own proposal under review** (`public_change_proposal_pending` while a
     push would otherwise be offered) -> no button, only a neutral
     "Vorschlag in Prüfung" status chip (clock icon), tooltip "Deine Änderungen
     an der Kulturbibliothek warten auf Freigabe." A contributor whose edits go
     to the `PublicCropChangeProposal` queue (see
     [account-trust-levels.md](./account-trust-levels.md)) still differs from
     the entry after a sync — the proposal is not a new version — so without
     this state the badge row would offer the same push again. The serializer
     flag is true when the requesting user has a pending `edit` proposal for
     the crop's linked or owned entry, resolved with one query per response
     (only when a row on the page is linked at all). Once a moderator applies
     the proposal the crop resolves to case 5 on its own (the values now
     match); a rejection brings the push back.
  3./4. **linked with local changes** (`public_publish_blocked_reason` is
     `null` — the `update_pending` reason always coincides with case 2 and
     `update_rejected` with case 2b, which also catches an imported foreign
     copy whose decline leaves the reason `null`) -> button "Bibliothek
     aktualisieren", green, up arrow (push),
     opens the wizard, which for any connected crop (own entry or a foreign
     one it was imported from or linked to) is the field-by-field sync
     "Mit Kulturbibliothek abgleichen" (§7, "Field-by-field sync"). Own entry
     vs a foreign one is the same direct-update path, so the label does not
     distinguish them.
  5. **linked, nothing pending, nothing to contribute** -> not a button but a
     plain "Aktuell" status chip (`crop-detail-library-status`), tooltip
     "Diese Kultur entspricht dem aktuellen Stand in der Kulturbibliothek."
     There is no action, so no dialog opens.

  A crop species still under moderation (`public_crop_species_pending`) freezes
  cases 2-4 as a disabled button with the existing "Vorschlag in Prüfung"
  tooltip (case 2b as an inert, non-clickable chip carrying the same tooltip);
  the `CropSpeciesPendingChip` stays in the row as the explanation.

  **The crop list shows the same state per row.** `CropLibraryStatusIcon` is
  the compact form of the button: an 18px circle in a fixed-width column
  after the name and before the "(N)" count of every row in the private crop
  list (`CropDetail` passes it through `CropHierarchyRow`'s `statusAdornment`;
  the public library list does not). It sits on the right rather than before
  the name so its position depends on neither tree depth nor name length, and
  the name stays the row's first scan point.
  It resolves through the same `resolveCropLibraryAction` — list rows have no
  `usePublicCropUpdate` controller, so the pull flags come from the crop
  itself via `readCropLibrarySyncFlags`, which the controller also uses — and
  `resolveCropLibraryStatusVisual` maps the result to a look: dashed circle
  (not linked), blue down arrow (pull), orange up arrow (push), grey
  sync-disabled (declined), a bare green check (in sync — no filled circle, so
  synced rows stay quiet) and a brown clock for any state frozen by a species
  under moderation. Tooltips are the button's tooltips. Clicking opens the
  same dialog as the button; both dialogs act on the selected crop, so the
  icon of another row selects that row first and opens the dialog once the
  selection has landed. The "Aktuell" and moderation states are inert, the
  latter still focusable so its tooltip is reachable by keyboard. The icon
  stops click propagation, so it never also triggers the row's selection. A
  Kultur header without its own entry keeps an empty slot of the same width,
  so the counts stay aligned. The list
  endpoint needs nothing extra for this: `CropViewSet` serves the list with
  the same `CropSerializer`, and
  `test_crops_list_carries_library_status_fields` pins that every row carries
  the library fields at the unchanged query count.
- Declining a public change is a third, explicit outcome next to applying and
  cancelling. `POST /api/crops/<id>/public-update/reject/` stores
  `Crop.rejected_public_version` and touches no library-sourced field, so the
  notice disappears for exactly that version while the local copy stays as it
  was. Because the decision is a *version number* rather than a flag, a later
  public edit produces a version the user never decided on and the notice comes
  back on its own; taking an update over (`build_project_crop_payload`)
  clears the rejection again. Cancelling remains the "no decision" path — the
  notice returns on the next visit.
- The diff stays reachable after a decision: `build_public_crop_update_status()`
  is still built for a rejected version, and case 2b's "Update abgelehnt" chip
  reopens the same dialog (with the "already declined" hint and a disabled
  "Ablehnen" button). Reachable, but no longer offered as an open action — that
  is the whole difference between "Ablehnen" and "Abbrechen" in the dialog:
  cancelling stores nothing and leaves the "Kultur aktualisieren" button
  standing, declining stores `rejected_public_version` and retires it.
- **Field-by-field sync resolves every difference in one step.** The push
  dialog does not push "all differences" any more: `GET
  /api/crops/<id>/public-sync/?public_crop_id=` lists every compared field that
  differs (the same set as the pull diff: `CROP_COPY_FIELDS` minus
  `display_color`, minus `crop_family` / `nutrient_demand` on a species-linked
  Sorte, `variety` and `name` included — except `variety` against a general
  (species-level) entry, where a linked Sorte, e.g. after a
  `publish_as_general` publish, differs by granularity, not by an edit
  (`_sync_compared_fields`); multilingual `notes` as one field)
  with a `pushable` flag, and `POST` applies the user's per-field choice via
  `sync_crop_with_public_entry()`: `pull_fields` take the entry's values
  locally, `push_fields` write the crop's effective values
  (`build_public_crop_payload`, restricted to exactly those fields) into the
  entry through `update_public_crop_directly()` — the wiki-style edit path,
  which records a revision naming only those fields. A moderated contributor's
  push becomes one `edit` `PublicCropChangeProposal` instead (case 2c). Pulling
  and pushing run in one transaction under a row lock on the entry, guarded by
  `base_version` (409 `stale_public_crop_version` if the entry moved since the
  preview). Afterwards the baseline is the entry's resulting version and
  `is_modified_from_source` is whatever difference is left, so a fully
  decided live sync resolves to case 5. Choosing "Aus Bibliothek" for every
  field pushes nothing and creates no public version. This also repairs crops
  linked before the sync existed, with no migration.
  `name` is never pushable (fixed after publication); `variety` only for the
  entry's publisher or a library admin and never through the queue
  (`public_crop_pushable_sync_fields`; `update_public_crop_directly` takes
  `allow_variety_rename` for the publisher). The endpoint is session-only, like
  `link-public-crop` (not in `CropViewSet.api_token_actions`).
- **Pulling never breaks live inheritance.** `_pull_public_crop_fields()` (used
  by the link's and the sync's pull) writes a raw value only when the entry's
  value differs from the crop's *effective* one. A Sorte that inherits a field
  from its general Kultur, and whose library value equals that inherited
  value, keeps inheriting instead of gaining a frozen local override.
- `CropSerializer.public_publish_blocked_reason` reports why a *push* is not on
  offer: `update_pending` / `update_rejected` (the library is ahead — the
  button shows case 2 instead) and `no_local_changes` (aligned copy with
  nothing to contribute — case 5). The lock is not only cosmetic:
  `publish_crop_to_public_library()` raises `PublicCropUpdateBlockedError`
  (409 `public_crop_update_blocked`) for the two divergence cases before the
  quality gate runs. A push becomes available again once the copy is aligned
  with the current public version *and* carries local edits made after that.
  The comparison behind `no_local_changes` runs over the Sorte's *effective*
  fields (`_resolved_copy_fields` / `public_crop_update_changes`), so a Sorte
  that only inherits e.g. `growth_duration_days` from its general Kultur is not
  mistaken for a copy with a local override to push — the published entry
  already carries that resolved value. The serializer threads the per-project
  general-Kultur index in, so the check adds no query per row.
- The publishing wizard's comparison covers `variety` too. Before the Sorte
  became editable it was left out as immutable, which meant publishing an
  update could rename the public entry without the change ever appearing in
  the "Änderungen vor der Veröffentlichung" table. It is skipped only for a
  species-level publish, where the backend forces an empty variety anyway.
- The comparison resolves inheritance before diffing: `buildPublicCropUpdatePayload`
  overlays `effective_values` for every field in `inherited_fields`, so a Sorte
  that only inherits e.g. `growth_duration_days` from its general Kultur is not
  shown as clearing the public value (`privateValue` "Nicht angegeben"). This
  mirrors `build_public_crop_payload` server-side, which resolves the same
  fields through `resolve_crop_field`.
- Reverting a public entry restores an older snapshot by creating another new
  version. It never deletes existing revisions.
- Public crop data is intended to be reusable through the app, future
  public APIs, future downloads/exports, and external open-source or
  commercial projects.
- Contributions are licensed under Creative Commons
  Attribution-ShareAlike 4.0 International (CC BY-SA 4.0). The license is
  suitable here because it allows copying, adaptation, redistribution, and
  commercial use while preserving attribution and share-alike conditions.
- A user's first publication must be a conscious act: the UI explains the
  persistence and license terms, and the backend records acceptance as
  `DocumentConsent.DOCUMENT_PUBLIC_LIBRARY`. This contribution consent is
  separate from the global Terms consent so it can be versioned and audited
  without blocking users who never publish.

Moderation uses non-destructive state transitions (`draft`, `published`,
`withdrawn`, `removed`) over hard deletes, so attribution, license evidence,
import lineage, and revision history remain auditable where legally
permissible. Hard delete is intentionally exceptional and only available to
administrators when no imports, source-project provenance, or other
dependencies remain.

Structured discussions use `PublicCropDiscussionTopic` as a crop-owned
container and `PublicCropDiscussionComment` for both top-level contributions
and replies. A nullable self-referencing `parent` preserves the exact reply
target while the frontend renders a real reply tree with capped visual
indentation, so deep discussions keep their logical parent chain without
shrinking the content column indefinitely.
The topic overview is activity-oriented: the API returns topics ordered by the
newest comment activity and includes the comment count, latest activity time,
latest comment preview, and optional revision reference needed for the compact
discussion list without per-topic comment fetches.
Topics may reference an immutable `PublicCropRevision`, so the version being
discussed remains stable when newer revisions are created. Comments use soft
deletion (`deleted_at`/`deleted_by`) and retain their row and replies, with the
body cleared and a neutral placeholder shown in the UI. Normal authors may
soft-delete their replies and may delete the root discussion post only while no
visible, non-deleted replies remain. Public-library moderators may remove any
comment, including root posts with visible replies. Discussion topics with no
visible comments are hidden from the normal topic overview so users do not see
threads made only of deletion placeholders. Edits keep the original author and
creation timestamp and record `edited_at`. Existing pre-topic comments are
grouped per crop by migration 0081 into an `Allgemeine Diskussion` topic
without changing their authors, timestamps, text, or chronological order.

Discussion records and public revisions (`PublicCropRevision`) do not
touch project-owned `Crop` rows. Editing or reverting a public entry changes
only the shared public-library row; projects that already imported an entry
continue using their private copied snapshot until a future explicit
update/merge flow is built.

The public crop-library page treats URL state as the source of truth for
navigable selections (`cropId`, `tab`, `discussionId`). When users return
through the main navigation to the bare library route, the last valid
crop-library view state is restored from local storage and written back into
the URL; explicit URLs always override that saved state. Temporary UI state
such as drafts, edit forms, and reply targets is intentionally not restored.

Official `CropSpecies` rows are global master data and remain moderated. Users
may propose missing species from the publishing wizard, but proposed species
stay out of the official list until a public-library moderator approves them.
Approving a proposal promotes that same `CropSpecies` row to `published`;
rejecting it keeps an auditable rejected proposal.

`CropSpecies` also carries optional reference metadata for the official
suggestion list: `scientific_name`, botanical `family`, and a list of broad
`categories` such as `vegetable`. These fields belong to the moderated species
identity. They are not copied into every variety row; project crop-family values
are filled from the species metadata only when a general project crop has no
user-entered `crop_family` yet.

Crop species display names are language- and region-aware at the API boundary.
The canonical German translation is standard Germany terminology; Austria and
Switzerland are explicit regional overrides on `CropSpeciesTranslation`, while
free synonyms are search/matching aliases only. Project-scoped requests resolve
the active `Project.region` from the normal project context (`X-Project-Id` /
`request.active_project`) and pass it through shared display helpers, so Gantt,
planning, crop detail, public-library and import surfaces render the same
name without frontend-specific region logic.

Those synonyms are the crop library's answer to regional naming: searching
`Erdapfel`, `Karfiol` or `Porree` resolves to the official `Kartoffel`,
`Blumenkohl`/`Karfiol` and `Lauch` species instead of offering to create a
second one. The initial German (AT/DE/CH) list lives in
`crops.seed_data.CROP_SPECIES_SYNONYM_SEED_DATA` and is applied by migration
`0014_crop_species_search_aliases`; moderators curate it further in the
"Kulturart-Synonyme" section of `/app/public-library-moderation`, which PATCHes
`translations[].synonyms` through the existing species endpoint.

Whether a name becomes an alias or its own species is a *use* question, not a
botanical one:

- **Alias** when it is the same product under a regional or colloquial name —
  same growing time, cultivation, plant part and harvest method
  (Erdapfel/Kartoffel, Karfiol/Blumenkohl, Porree/Lauch, Paradeiser/Tomate).
- **Own species** when the use form differs, even for the same botanical
  species: `Pfefferoni` (own growing time and spacing, searched deliberately),
  `Schnittkohl` (repeated cuts of young leaves instead of one whole-plant
  harvest), `Zuckererbse` (eaten pod and all), `Puntarelle` and `Radicchio`.
  `Kohlrübe` is therefore *not* an alias of `Kohlrabi` — it names the swede,
  a species the library does not seed yet.

Ambiguous terms are aliases of *every* candidate rather than being forced onto
one: `Peperoni` maps to Paprika, Chili and Pfefferoni, `Fisole(n)` to Busch-,
Stangen- and Grüne Bohne. The picker then offers all of them, and because an
alias hit counts as a strong identity match, the "als neue Kulturart
vorschlagen" entry disappears (`hasStrongCropSpeciesIdentityMatch`) and each
option is labelled with the alias that made it appear — "Kartoffel (Erdapfel)"
(`formatCropSpeciesMatchLabel`).

Private project crops are intentionally independent from that public master
data. `Crop.crop_species` stays nullable and the "Add crop" dialog never
requires linking to a public entry — free text remains valid at all times and
never creates or proposes a public entry.

The "Add crop" dialog's `Kulturart` ("Name") and `Sorte` ("Variety") fields
are two separate suggestion sources
(`frontend/src/crops/publicCropNameSuggestions.ts`,
wired up in `CropForm.tsx`/`BasicInfoSection.tsx`): the Name field
suggests deduplicated public crop species names only (one option per
`crop_species`, never a "Species · Variety" combination), and the variety
fields only offer suggestions — fetched via
`GET /api/public-crops/?crop_species=<id>` — once the typed name exactly
matches one of those species suggestions; otherwise they stay free text.
Both suggestion sources filter out entries whose name or variety looks like
manual-QA test data (`isLikelyTestPublicCropEntry`) — a display-only
filter; no public-library rows are deleted for this.

Selecting a Name suggestion links `crop_species` immediately and then copies
the species' general ("no variety") public entry into the draft — baseline
values plus `source_public_crop`/`source_public_version` and
`origin_type: 'imported'`, i.e. exactly the shape the "Import from library"
button produces, so the re-import/update model in
`import_public_crop_into_project()` applies to these crops unchanged.
The copy reuses the species rows the Variety field fetches anyway (guarded by
`loadedVarietySpeciesId`, since an empty list is otherwise ambiguous between
"still loading" and "no entries"), so no extra request is made. A species with
no general entry — mostly legacy data, since `ensure_general_public_crop()`
creates one on publish — stays linked by `crop_species` alone rather than
copying an arbitrary variety's values. Species-level prefill never overwrites
a variety the user already typed (`preserveVariety`).

Which variety field is shown depends on `formKind`. The Add-**variety** dialog
renders the real `variety` field, and selecting a suggestion there copies that
concrete `PublicCrop` row. The Add-**crop** dialog has no `variety` field at
all; its optional "Sorte (optional)" field names a *second* crop created
after the crop, so picking a suggestion there only records which library entry
it came from and the linked draft is built at save time
(`FirstVarietyDraft.draft`, applied in `Crops.tsx`'s `handleSave`). Leaving
it as free text keeps the pre-existing behavior of inheriting the crop's own
values. This split is why the Add-crop dialog must prefill from the Name field:
regression `#444`-era code put prefill exclusively on the `variety` field,
which that dialog never renders, leaving the public library unreachable from
"Kultur hinzufügen" while suggestions still appeared to work.

When the typed crop name already matches a private crop in the project, the
dialog shows a non-blocking info hint offering the existing "+ Add variety"
flow for that crop (`onSwitchToAddVariety`, resolved to the species-level row).
The match is computed against the already-loaded `crops` prop — the
`duplicate_check` endpoint cannot serve this, since it returns `exists: false`
whenever `variety` is empty. Creating a free-text duplicate stays possible.

Only the publishing wizard requires a public-library decision: users either
link the private crop to an existing published `PublicCrop`, or continue
the existing new-public-entry flow after choosing an official `CropSpecies`.
When the user owns the linked public entry, the publishing wizard loads that
entry before submission and shows a field-by-field comparison of changed
public values against the private crop. An unchanged private crop cannot
create a redundant public version; confirmation explicitly updates the linked
public entry rather than merely linking it again.

Publishing a general Kultur can take the project's Sorten along. The wizard
lists the Kultur group's Sorten below the species picker, all pre-checked, and
publishes the checked ones right after the Kultur itself — the Kultur
publication is what creates the species-level entry a Sorte hangs off. A Sorte
whose name matches a published entry for that species is linked to that entry
instead of being proposed as a duplicate, and says so in its row. That match is
the strict identity rule (`normalizeCropIdentityValue` — casing and whitespace
only, the same normalization the duplicate check uses), deliberately *not* the
species picker's fuzzy matcher: linking points the user's own Sorte at somebody
else's entry and flips `origin_type` to `imported` for good (the link itself
can be removed again, `origin_type` stays), so two
cultivars a letter apart ("Matina"/"Marina") must stay two Sorten. Sorten
already connected to the library (`owned_public_crop_id` or
`source_public_crop`) are not offered at all: re-linking would flip an owned
row's `origin_type` the same way. The section is hidden for a Sorte publish (a
Sorte has no Sorten of its own), for a Kultur without Sorten, and for the
owned-entry update flow, which keeps its existing scope — a Sorte added after
publication is published from its own page.

Because that match is only as good as the public entries the wizard has, the
publish button stays disabled while the species' entries are still loading, and
a failed lookup is stated in the section instead of silently offering every
Sorte as new. Publishing then still works: the backend's duplicate gate answers
409 for a Sorte that is public already, and the wizard counts that as "was
already in the library" rather than as a failure. The license acceptance is
collected on every path that publishes a Sorte — including the one that only
*links* the Kultur to an existing public entry, which needs no acceptance for
itself but whose Sorten would otherwise be rejected with
`public_library_terms_required`. The frontend owns this end to end
(`frontend/src/crops/publishVarieties.ts`): each Sorte goes through the same
`publish-public` / `link-public-crop` endpoints as a manual single publish, one
at a time, a failing Sorte does not abort the rest, and the outcome is folded
into the Kultur's own snackbar message rather than replacing it (the snackbar
holds one message at a time).

The project Crop Library and the full public Crop Library now render the same
species → variety hierarchy. A public or private row with a selected
`crop_species` and an empty `variety` is the current "general crop" entry for
that species. Rows with a variety are rendered below that species. The UI uses
plain user-facing wording and a subtle visual cue for variety-specific values;
it does not expose implementation terms from the target data model. Until the
future `CropVariety` entity and persisted nullable override chain exist,
value-source cues are resolved from the current row plus the matching
no-variety general crop row.

The project page's "Kultur suchen" field has no dropdown of its own. It is a
plain text field, and its results are the hierarchy list already sitting under
it in the same card (`CropDetail.tsx`, rows rendered by
`CropHierarchyRow.tsx`): one row per Kultur group header, its Sorten
underneath. The list keeps its own fixed, scrollable container, so typing
re-filters it in place instead of floating an overlay over the surrounding
content — and nothing around it reflows. An earlier `CropSearchSelect`
Autocomplete did exactly that and was removed: it duplicated the list beneath
it and covered it while typing.

That container also keeps its scroll offset across a refetch. Saving,
importing or publishing a crop reloads the crop list, and two things would
otherwise send the user back to the top of it: the page swapping itself for
its loading card (which unmounts the list), and the remounted list starting at
offset 0. So `Crops.tsx` shows the loading card only for the first load — later
refetches keep the current rows on screen — and the list itself is wired to
`usePreservedScrollPosition`, which restores the last offset (clamped to the
new content height) whenever the container remounts anyway.

The search filters live, from the first character typed:

- **Groups, not rows, are the unit of a hit.** A group matches when its Kultur
  name or any one of its Sorten does, and a hit is then shown with *all* of its
  Sorten (`withGroupSiblingCrops`) — searching a Sorte name is a way of
  finding its Kultur, so hiding that Kultur's other Sorten would answer a
  narrower question than the one asked. The widening runs on top of the other
  filters, never past them.
- **A hit opens once** (`useSearchExpandedGroups`). Closing it again is the
  user's call and sticks for as long as that group keeps matching; a group that
  drops out of the results is forgotten, so a later hit opens it again as a
  fresh one — and clearing the field closes everything the search opened. Only
  that: a group the user had already expanded before searching is theirs, and
  so is the group holding the current selection, whose row would otherwise
  vanish from the list while the detail view still shows it.
- **The matched substring is marked** in the Kultur and Sorte names
  (`HighlightedText`), and every group header carries its Sorten count,
  including `(0)` for a Kultur that has none.
- **Arrow keys walk exactly what is on screen**, group headers included: a
  header is a focus stop, Enter on one opens or closes the group and leaves the
  selection alone, and Enter on a Sorte selects it without collapsing the list.
  Clicking a header still selects the general Kultur, unchanged.

Filtering the page by a Sorte name keeps that Sorte's Kultur in the list
(`withGroupGeneralCrops`), in the tree and the search results alike. Without
it a group whose Kultur row was filtered away left a Kultur node with no data
of its own: clicking it selected the first matching Sorte instead of the
Kultur. The re-added Kultur is context for the matches and never a match
itself, so an otherwise empty result still shows the "no crops found"
state.

Public-library moderators are granted through the Django group
`Public Library Moderators`, which carries only the `crops.moderate_crop_species`
permission. Staff/superusers inherit moderation capability for operational
management, but ordinary moderators do not receive Django admin or staff
rights. Normal users can request moderator access from account settings; admins
review those requests through the public-library moderation queue and approval
grants only the moderator group.

Discoverability of pending items is deliberately reused, not duplicated: the
"Moderation" topbar button (`PublicCropLibraryPage.tsx`) shows an MUI `Badge`
with the same counts the moderation queue itself lists — proposed species
always, pending moderator-access requests only for admins, since only admins
can review those — fetched with `page_size: 1` against the existing
`/api/crop-species/` and `/api/public-library/moderator-requests/` list
endpoints rather than a separate count endpoint. Submitting either kind of
item also fans out an in-app notification (see `docs/notifications.md`) to
every moderator/admin, so the queue is discoverable even off the crop library
page — the button badge and the bell read the same underlying pending state,
just through two different existing surfaces.

Reviewed change proposals (`PublicCropChangeProposal`) were dormant for a
long stretch — retained for audit and transition safety, with no UI creating
or reviewing them. **They are in use again.** Rather than build a parallel
structure, the account-trust-level work revived this queue: a crop-library
contribution from an account still at the `new` trust level, or from any
`ProjectApiToken`-authenticated request, is now routed into it instead of
applying live. The model gained a `kind` field (`edit` vs. `new_publish`) and
the `origin_api`/`origin_declared_agent` provenance flags. A `new_publish`
proposal points at a `PublicCrop` created with `status=STATUS_DRAFT`, which
every listing filters out until a moderator approves it.

`farm/crops/moderation.py` holds the routing decision; see
[`account-trust-levels.md`](./account-trust-levels.md) for the full rules,
the approve/reject paths, and the draft lifecycle.

Moderators review them in the contributions queue at the top of
`/app/public-library-moderation`, which lists everything pending across
entries via `GET /public-crops/pending-change-proposals/` and opens a review
dialog per row. See
[`account-trust-levels.md`](./account-trust-levels.md#where-a-moderator-actually-reviews-them).

### Sorte → Kultur value inheritance

The species → variety pairing described above (a general "no variety" row plus
the rows that carry a variety) is also the **value** fallback for project
crops, not only a display cue.
`backend/farm/services/crop_inheritance.py` owns the rule so the API, the
planning calculations and the UI resolve it identically:

- A Sorte (`variety` set) with a `crop_species` inherits from the general
  Kultur — same project, same `crop_species`, empty `variety`, not soft-deleted.
  A free-text Sorte without a `crop_species` has nothing to fall back to and
  always resolves to its own values.
- `CROP_INHERITABLE_FIELDS` lists the planning fields that participate. It
  mirrors the frontend's `VARIETY_INHERITABLE_FIELDS`
  (`frontend/src/crops/varietyValueSource.ts`), which prefills a *new*
  Sorte from the same set, minus the legacy `seed_rate_value`/`seed_rate_unit`
  pair and the derived
  `seed_rate_by_cultivation` map (validated as a subset of the row's own
  `cultivation_types`, so inheriting it separately could produce a combination
  the model rejects).
- "Unset" means `None`, blank text, the legacy `'-'` unit placeholder, or an
  empty collection. `0` and `False` are real values and are never replaced.
- Nothing is copied onto the Sorte. Clearing a field removes the override, and
  the Sorte follows later edits of the general Kultur automatically.
- The three species-invariant fields (`CROP_SPECIES_INVARIANT_FIELDS`:
  `crop_family`, `nutrient_demand`, `rotation_break_years`) go further: on a
  linked Sorte they are **not overridable at all**. They describe the crop
  species, so `resolve_crop_field` / `build_effective_crop_values` return the
  general Kultur's value whenever that inheritance source exists and ignore any
  stale raw value the Sorte still carries. A linked orphan instead retains its
  raw value as the effective value so its only copy stays visible. The form
  renders the three fields read-only
  for a linked Sorte (`speciesInvariantFieldsReadOnly`, with an info icon next
  to the "Fruchtfolge-Eigenschaften" heading). On the write side
  `CropSerializer._validate_species_invariant_fields` routes a value sent for a
  linked Sorte to the general Kultur instead of storing it on the Sorte: it is
  accepted while it fills a gap on that Kultur (or repeats what the Kultur
  already says) and **rejected with a field error** when it would contradict
  the stored value, so the API neither drops the value silently nor overwrites
  the Kultur behind the other Sorten's back. `promote_species_invariant_values`
  (create routes through `ensure_general_crop_for_variety`, which may still have
  to create the Kultur) then moves the accepted value across and clears it from
  the Sorte — only for the fields the write actually sent, so an unrelated edit
  never relocates or clears a legacy raw column. A legacy linked orphan
  continues to use and edit its raw value until an explicit workflow creates
  its Kultur. Migration `0101_clear_variety_species_invariant_overrides`
  cleared the columns on existing linked Sorten only when a general Kultur
  already held the inheritance source. A free-text Sorte or a linked orphan
  without a general Kultur retains its raw values so no only copy is lost.
- The same rule reaches the **public** side. `PublicCrop` only has
  `crop_family` and `nutrient_demand` (not `rotation_break_years`), and only
  the species-level (general) public entry carries them:
  `build_public_crop_payload` omits them from a species-linked variety entry
  (a create defaults to blank, an update keeps whatever a moderator curated)
  and sources them for the general entry from the project's general Kultur,
  not from the Sorte being published. `build_public_crop_update_status` drops
  them from the pull diff for an imported linked Sorte, and
  `buildPublicCropComparison` drops them from the publish diff. The library
  detail view resolves a variety entry's blank value from its species entry
  (`getPublicFieldValue` in `PublicCropLibraryPage`). Migration
  `0102_clear_public_variety_species_invariant_fields` blanked existing
  variety entries whose species already has a general entry.
- Creating a linked Sorte ensures that its project has a general Kultur row for
  the same species; editing one leaves a linked orphan as it is, so an ordinary
  edit cannot conjure a Kultur the user never asked for. The species-invariant
  fields a write sent fill empty general values (from the payload, before they
  are cleared off the Sorte) because they describe the crop species, not a
  variety.
  Variety-variable timing, yield, spacing, and seed fields flow back only
  through the create API's optional `copy_values_to_crop` flag (default
  `false`), and then only into general fields that are still unset. Existing
  general values are never overwritten.
- Publishing a Sorte to the public library, or linking one to an existing
  public entry, records the chosen `crop_species` on the *whole* local Kultur
  group rather than on that Sorte alone
  (`sync_crop_species_across_crop_group`). A group whose rows are still
  grouped by name alone would otherwise split in two the moment one of its
  Sorten is published — the published Sorte under the species, the general
  Kultur and the remaining Sorten under the name — which shows as two Kulturen
  of the same name in the crop tree and cuts the published Sorte off from
  its general Kultur's values. Rows that already carry a different species are
  a separate group and stay untouched.

`CropSerializer` exposes the raw and the resolved value side by side, so a
client can tell them apart per field:

| Field | Meaning |
|---|---|
| the plain crop fields | always the row's **own** stored values (for the three species-invariant fields on a linked Sorte this is a dead column — read `effective_values` instead) |
| `general_crop` | id of the Kultur this Sorte inherits from, else `null` |
| `inherited_fields` | API field names whose effective value comes from that Kultur; the species-invariant fields are always listed for a linked Sorte when the Kultur has a value, whatever the Sorte's own column holds |
| `effective_values` | effective value per inheritable field, in the same API units as the plain fields (centimeters, normalized seed-rate units) |

`effective_values` and `inherited_fields` are empty whenever `general_crop`
is `null` — for a general Kultur or a free-text Sorte the plain fields already
*are* the effective values. Resolving a whole list page costs **one** extra
query: the serializer builds a per-request `crop_species → general Kultur` index
for the active project (`build_general_crop_index`) instead of looking up a
sibling per row.

Public crop storage and update payloads keep SI units for distances
(`*_m`) in the database. Read responses additionally expose read-only
centimeter aliases (`distance_within_row_cm`, `row_spacing_cm`,
`sowing_depth_cm`) plus the same seed-rate convenience fields as
`CropSerializer`, so frontend form/import code can consume public and
project crops through the same shape without changing stored units.

**Planning reads effective values.** `PlantingPlan.calculate_effective_harvest_dates()`
is the shared side-effect-free calculation behind
`recalculate_harvest_dates()` and `_get_active_period()`. The
`PlantingPlanSerializer` uses the same calculation as a read-time fallback when
the stored `harvest_date`/`harvest_end_date` snapshot is empty, so old plans
also show a computed Erntende once their Sorte can inherit the missing timing
from its Kultur. The `crop_*` timing/cultivation fields the Gantt calendar
plans from and the plant-count conversions also resolve through the service. On
the frontend the same is true of `ganttChartUtils.ts`,
`locationDerivedTasks.ts` and the "missing duration" tooltip in Anbaupläne, via
`getEffectiveCropValue`. The Anbauplan cultivation selector and the project
crop list's family, nutrient, cultivation, duration, and yield filters use the
same accessor; a Sorte is therefore filtered and constrained by the values it
currently inherits, not by blank raw override columns.

`Crop.plants_per_m2` is part of that: the model property still computes from
the row's own spacing, but the serializer publishes the **effective** value.
Both sides of the plants/area coupling have to agree — the Anbaupläne grid
decides whether the "Pflanzen" cell is editable from `crop.plants_per_m2`
while the row's `plants_count` comes from the plan serializer, so leaving the
crop field on own spacing makes an inheriting Sorte show a plant count the
grid then refuses to let the user edit (and Tab skips the cell).

Stored harvest dates remain a **write-time snapshot**, but reads can derive a
missing date from the current effective timing without writing it back. The
snapshot is recomputed when a plan is saved, when its own crop timing
changes, and when a general Kultur timing change affects Sorten that inherit
that exact field. Existing plans are not bulk-recalculated during deployment or
from GET endpoints just because a value became resolvable through inheritance.

**The edit dialog.** `CropForm` merges the resolved values into the form
(`buildInheritedValueBaseline`), so a field the Sorte does not override shows
the Kultur's value rather than an empty input. Those values equal the Kultur's,
so `getVarietyOwnValueSource` reports no override and the green highlight keeps
marking genuine per-Sorte values only. On save, anything still matching the
baseline is cleared again (`stripValuesMatchingBaseline`, the same mechanism the
add-variety prefill uses), so displaying an inherited value never freezes it as
an override, and clearing a field simply removes the override.

## 1. The current situation (before this pass)

The domain split the long-term vision asks for — a public Crop Library
vs. project-scoped Farm Planning — **already existed at the data model
level**, just not as a formalized service/app boundary:

- **`Crop`** (`backend/farm/models/crops.py`) is project-owned: it has a
  required `project` FK. Every project has its own private copy of every
  variety it grows, with growing parameters, supplier links, seed
  packages, and revision history (`CropRevision`). This is Farm
  Planning data.
- **`PublicCrop`** (same file) is the shared library: no `project` FK
  of its own, only nullable *provenance* links (`source_project_crop`,
  `source_project`) recording where a published entry came from. This is
  Crop Library data.
- A bridge, `backend/farm/services/public_crops.py`, copies data both
  ways: `publish_crop_to_public_library()` (a project's `Crop` →
  the library) and `import_public_crop_into_project()` (a library
  entry → a new project-owned `Crop`).
- `PublicCropViewSet` (`/api/public-crops/`) was already read-only
  and required only authentication — no project scoping at all, since a
  published crop isn't owned by any one project.
- The frontend already has an equivalent precedent for "routes outside
  the authenticated app": `frontend/src/pages/public/` (landing page,
  imprint, privacy policy) and `frontend/src/pages/auth/` (login,
  registration, ...) both render outside `/app`, gated only by
  `<ProtectedRoute />` wrapping the `/app` branch specifically. `/app` is
  already the prefix for the entire authenticated Farm Planning app; `/`
  is already the public root.

So the real work here was formalizing an existing, correct data split
into an explicit service/app boundary — not inventing the split from
scratch.

## 2. What this pass added

### Backend — a new `crops` Django app

`backend/crops/` is a real Django app (`INSTALLED_APPS`). It owns the official
language-independent species list used at the publishing boundary, plus the
moderator-access queue. `PublicCrop` stays in `farm.models` — moving that
existing model to a different app changes its migration state and (without
careful `SeparateDatabaseAndState` migrations) its `app_label`-derived
`db_table`. That's a real risk to existing data, and still isn't
justified until the crop library is actually extracted into its own
service.

```
backend/crops/
  apps.py          CropsConfig
  models.py        CropSpecies              official species list (published /
                                             proposed / rejected), used by the
                                             Publishing Wizard
                   CropSpeciesTranslation   (species, language_code) → common_name,
                                             regional_names, synonyms/search index
                   PublicLibraryModeratorRequest  moderator-access requests
  permissions.py   is_public_library_moderator() / is_public_library_admin(),
                    the `Public Library Moderators` group and the
                    `crops.moderate_crop_species` permission
  seed_data.py     CROP_SPECIES_SEED_DATA — the starter species catalogue with
                    stable keys and de/en names
  services.py      list_published_crops(), get_published_crop(),
                    find_exact_crop_match() — reads farm.models.PublicCrop,
                    nothing else
  serializers.py   CropSerializer (read-only; deliberately excludes
                    source_project/source_project_crop — see §3),
                    CropSpecies + moderator-request serializers
  views.py         CropViewSet (ReadOnlyModelViewSet, IsAuthenticated)
                    CropSpeciesViewSet (list/propose + moderator approve/reject)
                    PublicLibraryModeratorRequestViewSet (request/mine +
                     admin approve/reject)
  urls.py            router → /api/crop-library/
  species_urls.py    router → /api/crop-species/
  moderation_urls.py router → /api/public-library/moderator-requests/
  migrations/, tests/
```

Note that only `CropViewSet` is read-only. `CropSpeciesViewSet` and
`PublicLibraryModeratorRequestViewSet` are `ModelViewSet`s that accept writes
(species proposals, moderation decisions, access requests), so "the crops app
is a read-only surface" — true when this doc was first written — no longer
describes it.

The `/api/crop-library/` surface is **additive**: `/api/public-crops/` keeps working
exactly as before (still defined in `farm/crops/views/public.py` and mounted
through `farm/urls.py`, untouched) — the current frontend keeps using it.
`/api/crop-library/` and `/api/crop-library/<id>/` are parallel endpoints with the same
`IsAuthenticated` requirement as everything else — **not actually public yet**.
Making them public later is a one-line permission-class change, not a rewrite.

`config/settings.py` (`INSTALLED_APPS`) and `config/urls.py` register the app.
All three crops mounts exist twice in `config/urls.py`, plain and
legacy-prefixed, matching how `farm.urls` is already double-mounted.

### Frontend — `frontend/src/crop-library/`

```
frontend/src/crop-library/
  api/cropsApi.ts        client for /api/crop-library (list/get/match) —
                         still NOT wired into any page; only its own test
                         imports it
  components/
    PublicCropLibraryDialog.tsx     the quick import picker, moved from
                                        src/crops/ (see §3)
    PublicCropFiltersPopover.tsx    library filter UI
    MultilingualTextFieldSection.tsx   per-language text editing
    publicCropLibrary/                 detail/discussion/version building
                                        blocks (CommentForm, DiscussionComment,
                                        VersionCard, ImportConflictDialog,
                                        DetailPrimitives, the mobile selector,
                                        formatters)
  pages/
    PublicCropLibraryPage.tsx      /app/crop-library — the full workspace
    PublicLibraryModerationPage.tsx /app/public-library-moderation
  hooks/
    usePublicCropDiscussion.ts  one public crop's discussion topics,
                                comments and versions: the REST loads,
                                the socket refresh, and the reloads that
                                follow a comment or topic mutation
  publicCropDisplay.ts, publicCropFilters.ts,
  publicCropListMerge.ts, publicCropLibraryCommandSpecs.ts
  index.ts               barrel (mirrors src/crops/index.ts's convention
                         of exporting only the public-facing pieces)
```

`cropsApi.ts` exists so future code has somewhere to import from, but
`Crops.tsx` / `PublicCropLibraryDialog` still call the existing
`publicCropAPI` in `api/api.ts` — switching the data source is a
separate, deliberate future step (see §5), not bundled into this
architecture pass.

`App.tsx` exposes `/app/crop-library` as an authenticated full-page public
library workspace. The existing
`PublicCropLibraryDialog` remains the quick import picker from the project
Crop Library page and links to the full page for details, version history, and
discussion.

## 3. The domain rule, and where it bites

> "Die Crop Library darf keinerlei Wissen über Projekte besitzen. Die
> Projektlogik darf lediglich die Crop Library verwenden."

Applied concretely:

- `crops/services.py` imports only `farm.models.PublicCrop` and
  `farm.utils.normalize_text` — never farm's view/serializer packages,
  `Project`, or `Crop`. This is the one dependency direction that matters:
  if `crops` imports from farm's serializers, the arrow points the wrong way
  (crop library depending on farm planning).
- **The rule has two live exceptions today, and they are worth knowing
  about before you extract the app.** `crops/serializers.py` imports
  `get_public_user_label` from `farm.crops.serializers.public`, and
  `crops/views.py` imports `guest_demo_forbidden_response` /
  `is_active_guest_demo_user` from `accounts.demo_access`. Neither touches
  `Project` or `Crop`, so the *data* boundary still holds, but the import
  graph is no longer strictly one-directional. If `crops` is ever pulled out
  into its own service, these two are the concrete things that have to move
  (a shared display-label helper) or be re-expressed at the boundary (a guest
  check the crop library cannot make on its own).
- `crops/serializers.py`'s `CropSerializer` is **not** a re-export or
  subclass of `farm.crops.serializers.PublicCropSerializer`, even though
  they're currently near-identical — importing it would create exactly
  that backwards dependency. It's a small, deliberate duplication.
- `CropSerializer` also deliberately **excludes**
  `source_project_crop`/`source_project` (present in the legacy
  `PublicCropSerializer`) — those are project-provenance fields, and
  exposing them on the crop-library-facing surface would leak Farm
  Planning knowledge outward.
- The publish/import bridge itself (`farm/services/public_crops.py`)
  is **not** moved into `crops`. It inherently needs both `Crop` and
  `Project` — it's a bridge, not a pure citizen of either domain. It's
  called "farm's dependency on the crop library" already
  (`farm/crops/views/crops.py` imports it), which is the correct
  direction; deciding whether it should
  someday become a real network call (once crops is an actual separate
  service) is future work, documented in §5, not solved now.
- `frontend/src/pages/usePublicCropLibrary.ts` — the hook driving
  publish/import from the project Crop Library page — stays in `pages/` for the same
  reason: it's the Farm-Planning-side integration point, not
  crop-library-only logic (it reads/writes a project's `Crop` and
  needs a `selectedCrop`/`onImportSuccess` callback tied to that
  page's state).
- `frontend/src/crops/CropDetail.tsx` also stays where it is: it's
  reusable, prop-driven code, but the *data* it displays (a project's own
  crops) is Farm Planning data, not the library. Only
  `PublicCropLibraryDialog.tsx` — which genuinely only ever renders
  `PublicCrop[]` — moved to `crop-library/components/`.

## 4. Naming

The whole codebase now speaks "Crop". The domain concept used to be called
"Culture" — misleading in English, where it reads as microbiology or
anthropology — and was renamed end to end: models, serializers, viewsets,
services, URLs, query parameters, React components, hooks, API clients and
i18n keys. Highlights:

| Was | Is |
|---|---|
| `Culture`, `PublicCulture`, `CultureSupplierData`, … | `Crop`, `PublicCrop`, `CropSupplierData`, … |
| `/api/cultures/`, `/api/public-cultures/` | `/api/crops/`, `/api/public-crops/` |
| `cultureId`, `culture_id` | `cropId`, `crop_id` |
| `frontend/src/cultures/`, `Cultures.tsx`, `cultureAPI` | `frontend/src/crops/`, `Crops.tsx`, `cropAPI` |
| route `/app/cultures` | route `/app/crops` |

Tables, columns and the stored history/notification values moved with it
(`farm/migrations/0098`–`0100`, `notifications/migrations/0004`).

Two things shifted to make room, because the project-owned rows took over the
`crops` name: this app's read-only API moved from `/api/crops/` to
**`/api/crop-library/`**, and its frontend package from `src/crops/` to
**`src/crop-library/`**. `/api/crop-species/` and `/api/public-library/` are
unchanged. The `/app/crops` route alias for the library page is gone —
`/app/crop-library` is its only route, and `/app/crops` is the project crop
page.

German UI text (`"Kultur"`, `"Kulturbibliothek"`) is untouched, as required:
the rename covers i18n *keys* and interpolation placeholders only, never a
translated string.

### Deprecated aliases kept for the transition

A deploy restarts the backend but does not reload open browser tabs, and
external agent integrations are not ours to update, so every renamed public
name keeps a deprecated alias:

| Alias | Serves | Remove when |
|---|---|---|
| `/api/cultures/`, `/api/public-cultures/`, `/api/culture-supplier-data/` (`legacy_router` in `farm/urls.py`) | Browsers still on the pre-rename bundle | No pre-rename bundle can still be open |
| `/api/culture-imports/…` | External agents, plus drafts created before the rename — migration 0100 keeps their stored preview applicable, which only helps if the apply path still resolves | Agent integrations are updated |
| `ws/public-cultures/<id>/discussions/` (`config/routing.py`) | Open discussion sockets from a pre-rename bundle | As above |
| Route `/app/cultures` → `/app/crops`, query `?cultureId=` → `?cropId=` (`App.tsx`, `compat/legacyCropNames.ts`) | Bookmarks and pasted deep links | Judged not worth keeping |
| Storage keys `selectedCultureId`, `selectedPublicCultureId`, `culturesDetailFiltersV1` (`compat/legacyCropNames.ts`) | A returning user's selected crop and saved filters; read-through, so each browser migrates once | Long enough that returning users have all migrated |

The legacy API routes live on a `SimpleRouter`, so they stay out of the
browsable API index and only the current names are discoverable.

**One thing did change meaning rather than move:** `/api/crops/` used to be
this app's read-only library surface and now serves project-owned crops. A
client that predates the rename gets a 200 with different data instead of a
404. Live exposure is nil — `cropsApi` had no callers outside its own test —
but it is the one rename in this set that a stale client cannot detect.

## 5. Deliberately NOT done (and why)

| Not done | Why | Future path |
|---|---|---|
| Moving `PublicCrop` (or `Crop`) into `crops.models` | Changes migration state / `app_label`-derived `db_table`; real risk to existing data for zero current benefit | A dedicated migration using `SeparateDatabaseAndState` to move the model's Django state into `crops` while keeping (or explicitly renaming, in one controlled step) the actual table |
| Removing/renaming `/api/public-crops/` | Would break the current frontend (`publicCropAPI`) — a functional change the task forbids | Once `Crops.tsx`/`PublicCropLibraryDialog` are switched to `cropsApi`/`/api/crop-library`, deprecate and remove the legacy path |
| Switching the frontend to actually call `/api/crop-library` | Not required to "prepare" the architecture, and swapping a working data source is exactly the kind of change to do deliberately and separately, with its own testing pass | Point `Crops.tsx` at `cropsApi` instead of `publicCropAPI`, delete the old client, delete `/api/public-crops/` |
| A public, unauthenticated `/crops` route/page | The current collaboration and import workflow still needs an authenticated user and active project context | Split browsing from importing later: expose read-only public pages under `/crops`, keep project import under `/app` |
| Splitting `i18n/locales/*/crops.json` into a separate crop-library namespace | Namespace holds both library- and farm-planning-flavored strings today; splitting now is pure churn for zero user-visible benefit | Split when `crop-library/pages/` gets real UI text to hold |
| Moving `Crop`/`CropViewSet`/`CropSupplierData`/`SeedPackage` into `crops` | These are genuinely Farm Planning (project-owned, or only meaningful attached to a project-owned `Crop`) — moving them would be the large, risky refactor the task asks to avoid | Not planned; these belong in Farm Planning long-term too |
| Fixing `PublicCropLibraryDialog.tsx`'s cross-import of `stripCitationMarkers` from `components/data-grid/markdown`, or its two pre-existing `react-hooks/set-state-in-effect` lint errors | Both pre-date this move (confirmed by lint-checking the file at its old path before moving it) — fixing them isn't in scope for an architecture-only pass | A future cleanup could move the markdown helper to a shared, domain-neutral location |

## 6. Current user-facing surfaces

- The API paths are `/api/crops/...` (project-owned crops, formerly
  `/api/cultures/...`), `/api/public-crops/...` (formerly
  `/api/public-cultures/...`) and `/api/crop-library/...` (this app's
  read-only surface, formerly `/api/crops/...`). New collaboration actions are additive child endpoints on
  `/api/public-crops/<id>/`.
- The project Crop Library page still uses `PublicCropLibraryDialog` for quick
  import into the active project.
- `/app/crop-library` is the full authenticated library workspace for
  browsing, importing, discussing entries, editing public crop data directly,
  reviewing versions, and restoring older versions.

## 7. Publishing Wizard quality gate

Publishing a project-owned `Crop` is no longer a direct copy action from
the project Crop Library page. The frontend opens `CropsPublishingWizardDialog`,
which keeps the normal path intentionally small: the user selects the
official `CropSpecies`, confirms the original language, and clicks publish.
The wizard always publishes the crop's variety — there is no separate
"general crop or variety" choice in the UI. The dialog calls
`/api/crops/<id>/publish-public/preview/` only as a background validation
step when the user attempts publication, then shows only actionable problems:

- official `CropSpecies` selected;
- exactly one original language selected (defaulted from the UI language);
- public-library required fields complete (including `variety`, since a
  crop without a variety cannot be published from this dialog). Required
  fields are checked against the crop's *effective* value, so a Sorte that
  inherits e.g. `harvest_duration_days` from its general Kultur passes the
  gate and the published entry stores the resolved value
  (`get_public_required_field_gaps` / `build_public_crop_payload` resolve
  through `resolve_crop_field`); and
- no published public duplicate for the same `CropSpecies` + normalized
  variety.

The species `Autocomplete` offers the proposal inline in the dropdown instead
of as a separate always-visible link: a sentinel option
(`ProposeSpeciesOption` in `CropsPublishingWizardDialog.tsx`) is appended
by `filterOptions` as the **last** entry whenever the field holds text —
including when official species *do* match. Hiding it behind `noOptionsText`
(the earlier behaviour) meant a partial match such as "Kürbis" matching
"Kürbisgewächse" silently removed the escape hatch, leaving no way to propose
the name the user actually typed. The single exception is an exact
(case-insensitive) hit on an existing name — proposing that can only be
rejected server-side, so the entry disappears. Being a real option rather
than a button in the empty-state slot also makes it keyboard-reachable, and a
divider separates it from the regular hits above it. A failed proposal
surfaces as the field's `error`/`helperText`.

The proposal is **not** sent when that entry is picked. Picking it only puts
the wizard into "propose a new species" mode: the typed name stays in the
field, a hint explains what will happen, and the dialog's main button changes
to "Kulturart vorschlagen". Pressing it files the proposal *and* publishes the
variety under it in one action. Submitting on pick (the earlier behaviour)
meant a user who then closed the wizard left a stray proposal in the
moderation queue for a variety that was never published.

A user does not have to wait for moderation to publish once they've proposed
a species: `resolve_publishing_crop_species()` (`farm.services.public_crops`)
accepts a `CropSpecies` in either `PUBLISHED` or `PROPOSED` status as a
publish target (`PUBLISHABLE_CROP_SPECIES_STATUSES`) — `REJECTED` species
remain excluded. `PROPOSED` already is the "pending moderation" state
(`CropSpecies.STATUS_PROPOSED`); no separate status was introduced for this.
On the frontend, a successful proposal immediately appends the new species to
the wizard's local options and selects it, so publishing continues right away
instead of staying blocked; a dismissible success `Alert`
(`library.publishWizard.proposedSpeciesNotice`) explains that the variety
will appear provisionally under the not-yet-approved species name. This is
safe because `CropSpeciesViewSet.approve()`/`reject()`
(`backend/crops/views.py`) mutate the same `CropSpecies` row in place — the
id never changes — so once a moderator approves the species, everything
already published under it (including the general entry auto-created below)
keeps working with no relinking; nothing else in the publish path
(`detect_public_crop_duplicates()`, `ensure_general_public_crop()`,
`PublicCropViewSet`'s list queryset) filters on `crop_species.status` at
all, so this was already the only gate. `CropSpeciesViewSet.get_queryset()`
still hides non-`PUBLISHED` species from every other user/surface (including
the wizard's own initial species list) until a moderator approves or rejects
them, so a pending species is not otherwise discoverable/searchable in the
meantime.

Species proposals are language-aware at the review boundary. When the wizard
creates a proposal it stores the typed name as a `CropSpeciesTranslation` in
the currently selected original language, so an English publication pre-fills
the English name and a German publication pre-fills the German name. A
moderator cannot approve the proposal until all
`REQUIRED_PUBLIC_CROP_SPECIES_LANGUAGE_CODES` (`de`, `en` today) have
non-empty names; `CropSpeciesViewSet.approve()` writes those translations in
the same transaction as the status change and uses the English common name as
the canonical `CropSpecies.name`. That keeps approved species immediately
usable in every supported UI language instead of publishing a single-language
lookup row that has to be cleaned up later.

### While a species is `PROPOSED`

Publishing under an unreviewed species is allowed, but everything that treats
the species as *settled reference data* is not. The state is visible and the
three affected actions are blocked on both sides:

- **Visible.** `PublicCropSerializer.crop_species_status` and
  `CropSerializer.public_crop_species_pending` expose it. The frontend
  renders "Vorschlag in Prüfung" through one shared `CropSpeciesPendingChip`
  — as a labelled chip in the library detail header and on the proposer's own
  crop, and icon-only (tooltip + `aria-label` carry the text) on the crop
  list row, where the sidebar is 230px wide on `md` and a labelled chip would
  push the crop name out. There the icon takes the slot the "(N)" variety
  count normally occupies instead of trailing it, so pending and non-pending
  rows stay aligned; the count still shows alongside the icon once the
  species has more than one variety (`CropHierarchyRow`'s
  `isPendingSuggestion` prop), so that number isn't lost.
- **Blocked.** Import, the library update/sync, and starting or answering a
  discussion. The UI disables the controls with a tooltip; the backend rejects
  the same three with 409 `crop_species_pending`
  (`PublicCropViewSet._crop_species_pending_forbidden`), so the disabled
  button is a hint rather than the actual protection. Reading an existing
  discussion stays available.
- **Self-clearing on approve.** `approve()` moves the row out of `PROPOSED`,
  which lifts every block above without any per-object cleanup — the gate
  reads the species' current status, it does not cache a flag.
- **Cleaned up on reject.** `reject()` also moves the row out of `PROPOSED`,
  but a rejected species is never a valid thing to keep publishing under, so
  it goes further: `crops.services.remove_public_crops_for_rejected_species()`
  runs every `PublicCrop` still `published` under that species through the
  same path as a manual moderator removal
  (`farm.services.public_crops.remove_public_crop()`, reason
  `species_rejected`) — or, if the acting moderator happens to be the
  entry's own contributor, the self-service withdrawal path instead, since
  `remove_public_crop()` checks contributorship before moderator rights.
  Both are non-destructive and reversible from the moderation queue's
  "removed"/reinstatement flow. This exists because
  `PublicCrop.display_name()` always defers to the linked species' name
  (see below) — without this cleanup, an entry published while a proposal was
  still under review would keep showing the rejected species' name forever.

Either decision also notifies the proposer through
`crops.services.notify_species_proposal_reviewed()` — see
[notifications.md](./notifications.md).

When publishing a variety and the species has no species-level ("general",
empty-`variety`) published entry yet, the backend
(`ensure_general_public_crop()` in `farm.services.public_crops`)
creates one automatically from the crop's own current values, in the same
transaction as the variety publish. If a general entry already exists for
that species, it is left untouched — publishing a variety never overwrites
another contributor's general data.

The auto-created entry takes its **values** from the Sorte, but records the
project's own general Kultur (when the project has one) as its
`source_project_crop`. That link is what the crop list reads back as
`owned_public_crop_id`, so the Kultur the user sees as published is
recognized as published: its badge-row action shows a "Kulturbibliothek
aktualisieren" state instead of "In Bibliothek teilen", and a later
publish from that Kultur updates the existing entry instead of tripping the
duplicate check. Without a general Kultur in the project there is
no other row to own the entry, so it stays linked to the Sorte. Migration
`0093_relink_general_public_crops` re-points entries created before this.

`publish_as_general=True` remains supported by the backend (and by `publishPreview`/`publishPublic` in
`api/api.ts`) for backward compatibility, but the wizard no longer sends it.

`build_publishing_check_result()` also returns an optional
`general_crop_notice` (`public_crop_id`, `updated_at`, `is_stale`,
`is_incomplete`) whenever the species' general entry hasn't been updated in
over 24 months (`GENERAL_CROP_STALE_THRESHOLD_DAYS`) or is missing one of the
public-required fields. The wizard shows this as a dismissible info `Alert`
linking to `/app/crop-library?cropId=<id>` — it never blocks publishing.

Duplicate candidates (`DuplicateCandidate`/`PublicCropDuplicateCandidate`)
now carry an `is_mine` flag (`created_by_id == user.id`). Since a user's own
matching entry for the same source crop is already resolved as an update
target rather than surfaced as a duplicate, `is_mine: false` is the common
case in the blocking-duplicates list; the wizard renders each duplicate with
a "View entry" link to `/app/crop-library?cropId=<id>` so a name collision
with someone else's entry points at a concrete place to look, rather than
only naming it in text.

Each blocking duplicate also gets a "Mit diesem Eintrag verknüpfen" ("Link to
this entry") action, so a general Kultur that collides with someone else's
general public entry — the common case once `ensure_general_public_crop()`
has auto-created that entry from a Sorte someone else published first — is
never simply stuck behind the disabled submit button. Picking it fetches the
full `PublicCrop` and switches the dialog into a confirmation view instead of
opening a nested dialog: a heading, a sentence naming the local and public
entry ("Wähle für jeden abweichenden Wert, welcher gelten soll."), the
field-by-field sync component (below), and an info notice "Du kannst die
Verknüpfung später wieder aufheben. Bereits übernommene Werte bleiben dabei
erhalten." — the link can be removed again with "Verknüpfung aufheben" (§0,
"Removing a library link"), while `origin_type` flips to `imported` and stays
so. The "Sorten mitveröffentlichen" checklist stays
visible and keeps its selection; the CC BY-SA consent step is shown before the
final action only if at least one checked Sorte still needs to be newly
published — or at least one field is set to "Meinen Wert übernehmen", since
that contributes content too. The primary button reads "Verknüpfen" or
"Verknüpfen und Sorten veröffentlichen" depending on whether any Sorte is
selected, and "Zurück" returns to the (re-checked) warning view without
submitting anything.

**Field-by-field sync (`PublicCropSyncPanel`).** One shared component, used
here and in the "Mit Kulturbibliothek abgleichen" dialog below. It loads the
differences from `GET /api/crops/<id>/public-sync/` (which also answers for a
not-yet-linked candidate, comparing as if the link had set the entry's
species) and shows one row per differing field: label, "Bibliothek" value,
"Meine Kultur" value, and a two-way choice "Aus Bibliothek übernehmen" /
"Meinen Wert übernehmen". Preselection (`crops/publicCropSync.ts`): only the
library has a value -> library; only the local crop has one -> mine; both set
and different -> library; a field the user may not push (`name`, a foreign
`variety`) always starts on, and stays on, the library side with a tooltip on
the disabled option. "Alle aus Bibliothek" / "Alle meine Werte" set every row
at once, and a live summary below counts both directions with i18n plurals
("… werden in deine Kultur übernommen, … werden in der Kulturbibliothek
aktualisiert.", a part is dropped when its count is 0; for a moderated
contributor the push part reads "… werden zur Prüfung eingereicht"). Without
differences it shows "Keine Abweichungen zum öffentlichen Eintrag." and no
choice UI. There is deliberately no "keep only locally" option: the update
model has no "linked but intentionally different" state, so such a choice
would leave a permanent push action.

On confirm the link runs in three steps. (1) `link-public-crop` with
`pull_fields`: `link_project_crop_to_public_reference()` links the crop
(`crop_species`, `source_public_crop`, `origin_type=imported`) *and* applies
the "Aus Bibliothek" fields in one transaction, with the entry's current
version as the baseline, so the remaining differences — exactly the "Meinen
Wert" fields — read as local changes to contribute. (2) Those fields go
through `public-sync` with `push_fields` only (above), never a separate push
path. (3) The selected Sorten are published or linked as before. A failing
push does not roll the link back — it keeps link and pulled values: the
snackbar says the values could not be applied, and the crop shows the
ordinary "Bibliothek aktualisieren" action (case 3/4) to retry. The link
accepts a varietyless local crop and a public entry owned by a different user
without extra checks beyond the entry being `published`, and needs no CC BY-SA
consent of its own. If the candidate was withdrawn or removed between the
preview and the confirm click, the backend 404s; the parent shows the error as
a snackbar and the dialog (which awaits the link, unlike the ordinary publish
submit) drops back to the warning view with a freshly re-run duplicate check,
since the stale candidate should no longer be offered.

A link *without* `pull_fields` (the per-Sorte "existing variety" picker and
older clients) still copies no value: it only sets `source_public_version`
when the content already matches the entry exactly and otherwise leaves it
unset, so `public_update_available` (§0, "One control carries all of this")
offers the pull ("Kultur aktualisieren") direction for the divergence.

Missing translations remain optional and are not shown as a normal blocking
step. The existing CC BY-SA public-library contribution consent is also not
shown permanently; if it has not already been accepted, the dialog reveals it
immediately before the final publication action.

The backend enforces the same checks in
`farm.services.public_crops.publish_crop_to_public_library()`, so the
wizard is not only a UI affordance. Private project crops remain
flexible: `Crop.crop_species` is nullable, and incomplete project
crops can still be created and edited. The strictness lives at the
public-library boundary where durable shared data is created. The official
species dropdown is seeded from `crops.seed_data.CROP_SPECIES_SEED_DATA`, a
central starter catalogue for common DACH crop species. It is intentionally
aligned with the crop categories covered by established German, Austrian,
and Swiss organic seed suppliers such as ReinSaat, Bingenheimer, Samen Maier,
Austrosaat, Dreschflegel, Culinaris, and Sativa Rheinau. Entries already carry
stable keys and translation maps for the future multilingual species library.
The catalogue stores concrete crop species only: usage categories such as
`Gründüngung` / `Green manure` are represented by concrete species like
Buchweizen, Phacelia, Inkarnatklee, or Ölrettich instead of becoming upload
targets themselves.

Naming conventions for `CROP_SPECIES_SEED_DATA` entries:

- No slash collective names unless both terms are genuine synonyms for the
  same species. `Asiatisches Blattgemüse/Senfkohl` was not a synonym pair but
  a bundle, and is therefore replaced by `Blattsenf` / `Mustard greens`
  (*Brassica juncea*).
- No supplier or shop categories as a crop species when they mix several
  botanical species or clearly different growing and harvest logic. The
  Asia-greens shelf covers Blattsenf, Pak Choi, Tatsoi, Mizuna, Mibuna,
  Komatsuna and Chinakohl — species that are planned, spaced and harvested
  differently.
- No parent crop name when the catalogue represents all practical choices as
  complete, disjoint child entries. For fennel, use `Knollenfenchel` /
  `Florence fennel` for the bulb crop and `Gewürzfenchel` / `Common fennel`
  for the herb/seed crop; do not keep generic `Fenchel` / `Fennel` beside
  them.
- Add the concrete, user-recognizable species instead, one entry per species,
  and do not introduce an umbrella entry alongside them.

- Alias names (`Porree` for `Lauch`, `Blumenkohl` for `Karfiol`) are never
  their own entry. They live beside the entry, in one of two seed lists:
  `CROP_SPECIES_SYNONYM_SEED_DATA` for search-only aliases, and
  `CROP_SPECIES_REGIONAL_NAME_SEED_DATA` for terms that *replace* the canonical
  name for projects in that region (`austria` / `switzerland`). A term can be in
  both. When a term means different crops in different regions — `Peperoni` and
  `Fisolen` are the standing examples — it may be a search alias of several
  species, but never a displayed regional name.

[`crop-taxonomy-guidelines.md`](./crop-taxonomy-guidelines.md) is the full
decision rule behind these conventions: crop species vs. alias vs. variety, and
how AT/DE/CH terminology is stored. `crops/tests/test_seed_data.py` enforces the
first two rules plus the alias rules for the seed catalogue, and the
`0011_replace_asian_greens_collective_species` migration rejects such collective
species already stored in a database so they stop being public mapping targets.
`python manage.py audit_crop_species_coverage` reports crop names used in
projects that the catalogue does not know yet.

When a project crop is already connected to a public entry — its own
(`owned_public_crop_id`) or one it was imported from or linked to
(`source_public_crop`) — the wizard is not a mapping flow but the sync dialog
"Mit Kulturbibliothek abgleichen" with the field-by-field sync component above
and the primary button "Abgleichen" (disabled with an explanatory tooltip while
loading or when nothing differs). Confirming sends one `public-sync` request
with both `pull_fields` and `push_fields`; if the entry changed since the
preview (409) or the request fails, the dialog stays open and reloads the
differences. There is no species picker, variety selection or Sorten
co-publication in this dialog, which also rules out accidentally relinking to a
different public crop. Pushing own values asks for the CC BY-SA contribution
consent first when it has not been accepted yet.

## 8. Withdrawal, removal, and hard delete

`PublicCrop.status` models the public-library lifecycle:

- `draft`: reserved for future review workflows;
- `published`: visible and importable from the public library;
- `withdrawn`: hidden by the contributor who published it;
- `removed`: hidden by an administrator or moderator with a required reason.

The status-change API lives on `/api/public-crops/<id>/`:

- `remove/` is the single entry point for taking an entry out of the library,
  so the crop overflow menu only needs one "Aus Bibliothek entfernen"
  action. The actor decides the transition: the contributor of the entry
  withdraws it (`withdrawn`, no reason required, reversible by publishing the
  project crop again), while a moderator removing somebody else's entry
  must pass a structured reason (`accidental_publication`, `test_data`,
  `duplicate`, `wrong_mapping`, `unlawful_content`, `other`) and produces
  `removed`. Contributor intent wins for moderators acting on their own
  entries — a moderator who wants the stronger `removed` state for their own
  publication uses the admin surface.
  `CropSerializer.owned_public_crop_role` (`contributor` / `moderator` /
  `null`) tells the UI which of the two paths applies, so the confirmation
  dialog only asks for a moderation reason when one is actually required.
- `restore/` is the inverse of a moderator removal: it puts a `withdrawn` or
  `removed` entry back into `published`. It is the action behind the "removed
  entries" table on `/app/public-library-moderation`, so a wrong removal does
  not need a database fix.
- `hard-delete/` is staff-only and intentionally narrow. It is blocked when
  the public entry has imported project copies or source-project provenance;
  ordinary cleanup and moderation should use `removed` instead.
  Because it is exceptional, the normal crop overflow menu does not expose
  hard delete; it should live in a dedicated moderation/admin surface if a
  human-facing UI is needed later.

Every status transition writes `PublicCropStatusEvent`, establishing the
audit trail needed for later moderation queues, review steps, duplicate
merges, restore actions, or richer status history. Public lists, duplicate
checks, match endpoints, and imports only expose `published` rows. Project
imports remain protected because importing creates a private `Crop` copy
with its own fields; status changes on `PublicCrop` never mutate already
imported project data.

## 9. Correcting a wrong crop species mapping ("Kulturart korrigieren")

An entry can be published under a species that is plainly wrong or simply too
broad ("Bohne" where "Feuerbohne" was meant). The identity lock on `name` and
`variety` deliberately stops a contributor — and a moderator — from editing
their way out of that, but the *mapping* is not the identity, so it has its
own action:

- **Where.** `POST /api/public-crops/<id>/relink-species/`, behind
  `PublicCropViewSet.relink_species`, with
  `farm.services.public_crops.relink_public_crop_species()` doing the work.
  In the UI it is "Kulturart korrigieren" in the moderator context menu of the
  public library page, next to "Aus Bibliothek entfernen".
- **Moderator-gated, not admin-gated.** A relink invents nothing: it points
  the entry at the species it always belonged to, so a moderator is the right
  level. `name` is never part of the payload — that part of the identity stays
  admin-only. `variety` *is* an optional part of the payload: splitting a
  too-general species (e.g. "Gurke" into "Schlangengurke", "Gewürzgurke", …)
  usually means each Sorte's variety needs relabelling in the same step, not
  only moving it, so the dialog carries a variety field alongside the species
  picker rather than requiring a second trip through the ordinary edit form.
  Omitting `variety` from the payload leaves it untouched, matching the
  pre-existing behavior. The dialog's own variety field only renders for an
  entry that already has one — an entry with a *blank* variety is the
  species-level "general" entry (`find_general_public_crop()` keys off
  exactly `variety_normalized=''`), not a Sorte waiting to be named, and
  filling one in there would silently turn it into a named variety instead of
  correcting a mapping.
- **Same identity rule as publishing.** The relink runs
  `find_public_crop_identity_conflict()` against the *target* species plus the
  (possibly also corrected) variety — the same check publish and
  variety-rename already run — and is rejected with the same 409
  `public_crop_variety_conflict` shape, including `conflicting_public_crop_id`.
  The dialog shows that inline rather than closing.
- **"Unchanged" means both fields.** The request is rejected with
  `crop_species_unchanged` only when neither the species nor the variety would
  actually change — a variety-only correction (species left as-is) is a real,
  applicable relink, not a no-op. The dialog applies the same rule up front:
  "Kulturart ändern" stays disabled (tooltip "Wähle eine andere Kulturart oder
  Sorte aus.") while the picked species equals the entry's and the variety —
  which only counts when the user may edit it — is unchanged. The dialog
  preselects the entry's current species once the species list has *loaded*
  (`useCropSpeciesOptions().loaded`, not `!loading`, which is also true before
  the fetch starts).
- **Target species that does not exist yet, or is still pending.** The picker
  is the publishing wizard's own `CropSpeciesPicker`, propose affordance
  included, so a missing species is filed through the existing "Kulturart
  vorschlagen" flow (`CropSpecies.STATUS_PROPOSED`) instead of a second
  species-creation path — and (moderator-only, via `useCropSpeciesOptions`'s
  `includeProposed`) the picker also lists species someone already proposed,
  selectable the same way. Either way, the *frontend* self-approves it right
  there: a moderator who can open this dialog already has authority to
  approve a proposal through `CropSpeciesViewSet.approve()` (that action has
  no self-approval ban), so the dialog collects the same two required
  translations the moderation queue's own approval dialog asks for, calls
  `propose()` (only for a brand-new name) then `approve()`, and only then
  calls `relink-species` — three existing, unchanged endpoints chained by the
  client, no new backend surface for this. The relink therefore reports
  `relink_status='relinked'` immediately in the common case.
  `PublicCropSpeciesRelinkRequest`'s park-until-approved path (reported as
  `relink_status='pending_species_proposal'`, completed later by
  `crops.services.apply_public_crop_species_relinks_for_approved_species()`)
  still exists and still runs whenever a relink targets a species that is
  `proposed` and the approve step is skipped or itself fails — it is not
  dead code, just no longer the path this dialog takes on the happy path.
  Entry is *not* moved onto a species still `proposed` for that reason: it
  would block import, update and discussion for everyone (see "While a
  species is `PROPOSED`") and a rejection would sweep the entry out with
  `remove_public_crops_for_rejected_species()`, even though nothing was wrong
  with the entry. A rejection cancels a parked request; an entry holds at
  most one pending request, and a newer one supersedes the older.
- **A cancelled correction is announced.** The dialog promises the relink
  happens automatically on approval, so every way that promise can break — the
  species was rejected, the entry is no longer published, or another entry
  claimed the identity while the proposal was in review — notifies the
  requesting moderator (`public_crop_species_relink_cancelled`, see
  [notifications.md](./notifications.md)). A correction the same moderator
  deliberately superseded is not a broken promise and stays silent.
- **Audit.** The field-level move is written as a `PublicCropRevision` with
  action `species_relinked`, whose `changed_fields` already carry author,
  timestamp, and the old and new `crop_species`. No `PublicCropStatusEvent` is
  written: the entry's status does not change.
  `PublicCropSpeciesRelinkRequest` is written for *every* correction, not only
  the parked ones (an immediately applied one is created and resolved as
  `completed` in the same transaction). It is where the moderator's free-text
  `note` lives — `PublicCropRevision` has no such field — and it makes "which
  entries were remapped, by whom, from what, and why" one query instead of a
  scan through revision diffs. When a variety correction is parked alongside a
  species proposal, `PublicCropSpeciesRelinkRequest.to_variety` carries it
  through to `apply_public_crop_species_relinks_for_approved_species()`, so
  approval applies species and variety together instead of only the species.
- **The private crop group follows — and the project is told when that
  changes its values.** If the entry still has its `source_project_crop`, the
  relink runs the same `sync_crop_species_across_crop_group()` publishing uses,
  extended with the previous species id so the group's rows move off the old
  species with it instead of splitting the owner's Kultur in two. Because
  inheritance is live and resolved per `(project, crop_species)`, that move can
  land the group on a general Kultur the project already keeps for the
  corrected species (`get_general_crop()` breaks the tie by the lowest primary
  key), silently changing what its Sorten inherit. The effective values are
  therefore snapshotted before the move and compared after it; every member of
  the project is notified per affected crop when they really differ
  (`crop_species_reassigned`, see [notifications.md](./notifications.md)).
  Other projects are untouched: their rows keep the old species and their own
  general Kultur, so nothing they plan with moves.
- **The old species is left alone.** It stays published and usable by whatever
  else maps to it correctly. Taking it out of circulation is the separate
  species reject/lifecycle decision, not something this action triggers.
