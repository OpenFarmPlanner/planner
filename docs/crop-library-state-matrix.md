# Crop Library State Matrix

Scope: the lifecycle of a private crop (`Crop`) and its link to a public
library entry (`PublicCrop`). This is the checklist behind the tests: every
cell below exists once in `backend/farm/dev_fixtures/library_state_matrix.py`
and is used by the backend matrix tests
(`backend/farm/tests/test_crop_library_state_matrix.py`), the dev seed command
(`python manage.py seed_library_state_matrix`, `DEBUG=True` only, idempotent) and
the Playwright exploration (`frontend/e2e/library-matrix.explore.ts`, a dev
tool, not part of the CI suite). Behaviour itself is described in
[crop-library-architecture.md](./crop-library-architecture.md); trust levels in
[account-trust-levels.md](./account-trust-levels.md).

## Invariants every cell satisfies

1. **One source of truth.** Every offered action succeeds; every rejected
   action is not offered or is disabled with a tooltip. Visibility comes from
   serializer fields computed by the endpoint's own predicate
   (`can_unlink_public_crop` ↔ `unlink-public-crop`, `public_publish_blocked_reason`
   ↔ `publish-public` / `public-sync`), never from a frontend rule.
2. `resolveCropLibraryAction`, the sidebar status icon and the detail badge row
   resolve through the same function and cannot disagree.
3. The crop detail page needs no public endpoint to show its link:
   `source_public_crop_status` and `source_public_crop_title` ship with the crop.
4. A `PublicCrop` status change never changes private values or plans; private
   values change only through pull/sync.
5. Live inheritance is preserved by `_pull_public_crop_fields`.
6. Identity (species, normalized variety) stays unique among published
   entries; one general entry per species.
7. Provenance (`derived_from_public_crop`) survives unlink, removal and species
   relink.
8. Rejections use `api_error_response` with a stable code and show inline in
   their dialog.
9. Disabled controls carry a tooltip.

## Dimensions

| Dimension | Values |
|---|---|
| Private crop kind | general Kultur · Sorte with own values · Sorte inheriting from its Kultur |
| Link kind | not linked · own published entry (`origin_type` stays manual) · imported foreign entry · linked through "Mit diesem Eintrag verknüpfen" (foreign or own) |
| Entry state | published · withdrawn · removed · restored · reverted to an older version · species relinked (with/without variety change) · species rejected · parked relink request |
| Version state | aligned · library ahead · library ahead but rejected · local changes · local and library changed · local changes after a rejection |
| Actor | established account · `new` trust account · API token (queued proposal) · project member without edit rights |
| Actions | publish · link · sync (all pull / all push / mixed) · pull · reject update · unlink · re-link · relink species · remove · restore · revert · withdraw · rename variety · delete crop |

## Cells and expected outcome

`Seeded` cells are built by the fixture and asserted by the matrix test. The
columns are what the crop serializer must report.

| Cell (fixture key) | Entry | Version state | `public_publish_blocked_reason` | `can_unlink` | UI state (resolver) |
|---|---|---|---|---|---|
| `unlinked` | – | – | `null` | no | button "In Bibliothek teilen" |
| `own_published_aligned` | own, published | aligned | `no_local_changes` | no (`crop_link_owned`) | chip "Aktuell" |
| `own_published_local_changes` | own, published | local changes | `null` | no | button "Bibliothek aktualisieren" |
| `own_withdrawn` | own, withdrawn | aligned | `entry_withdrawn` | **yes** | chip "Eintrag zurückgezogen" |
| `own_removed` | own, removed | aligned | `entry_removed` | **yes** | chip "Eintrag entfernt" |
| `foreign_published_aligned` | foreign, published | aligned | `no_local_changes` | yes | chip "Aktuell" |
| `foreign_published_local_changes` | foreign, published | local changes | `null` | yes | button "Bibliothek aktualisieren" |
| `foreign_library_ahead` | foreign, published | library ahead | `null`, `public_update_available` | yes | button "Kultur aktualisieren" |
| `foreign_library_ahead_rejected` | foreign, published | ahead, declined | `null`, `public_update_rejected` | yes | chip "Update abgelehnt" |
| `foreign_withdrawn` | foreign, withdrawn | aligned | `entry_withdrawn` | yes | chip "Eintrag zurückgezogen" |
| `foreign_removed` | foreign, removed | aligned | `entry_removed` | yes | chip "Eintrag entfernt" |
| `foreign_restored` | foreign, published again | aligned | `no_local_changes` | yes | chip "Aktuell" (as if never removed) |
| `new_account_proposal_pending` | foreign, published | local changes + queued proposal | `null`, `public_change_proposal_pending` | yes | chip "Vorschlag in Prüfung" |

Rules that cut across cells:

- **Unpublished link** (`entry_withdrawn` / `entry_removed`) ranks before every
  push and pull state. `public-sync` (GET/POST) and `publish-public` answer 409
  `public_crop_link_unavailable` with `reason`. Unlink is always allowed here,
  including for the user's own entry.
- **Restore** puts a still-linked crop back to its normal state (values are
  untouched); a crop unlinked meanwhile stays unlinked.
- **Rejected proposal**: when a moderated edit proposal is rejected the
  `proposalPending` chip disappears and the crop, which still differs from the
  entry, resolves to "Bibliothek aktualisieren" again — it never reads as
  synced. A rejected species withdraws/removes the entries under it, which
  the unpublished-link state shows.

## Collapsed combinations

- **Kultur / Sorte with own values / Sorte inheriting**: the link, the entry
  status and the unlink predicate read only `source_public_crop` and the
  entry, never the crop kind. The kinds differ only in *which fields* the
  compare covers, which the sync and inheritance tests
  (`PublicCropFieldSyncApiTest`, `test_crop_inheritance`) already pin. One
  seeded Kultur per state therefore covers all three kinds.
- **Imported vs linked-via-"Mit diesem Eintrag verknüpfen"**: both write the
  same `source_public_crop`/`source_public_version`; only `origin_type`
  differs and no predicate reads it.
- **Restored** and **reverted to an older version**: after a restore the row
  is the published row it was; a revert is an ordinary new version, i.e.
  `library ahead`.
- **Species relinked / rejected / parked**: they change `crop_species`, not
  the link; covered by `PublicCropSpeciesRelinkApiTest`; the crop-side effect
  (notification, group species sync) is unchanged by this matrix.
- **Project member without edit rights**: `CropViewSet` permissions reject the
  write actions before any library logic runs (covered by the project
  permission tests); the read fields above are the same.
- **`new` trust account / API token**: differ only in the queue-vs-live push
  route. One seeded cell (`new_account_proposal_pending`, with an API token
  created for the same account) covers the queued state.

## Open questions

1. **Republishing a withdrawn own entry.** The docs (§8) say a contributor's
   withdrawal is "reversible by publishing the project crop again". The
   target behaviour here says withdrawn entries show only the chip. The
   backend keeps that documented republish through `publish-public`
   unchanged, but the UI no longer offers a button for it. Decide whether a
   "Wieder veröffentlichen" action belongs on the chip.
2. **Pull against an unpublished entry via the library page.**
   `public-crops/<id>/import/` still answers a plain 404 for anything not
   published; no crop-side control reaches it any more.
3. **API-token push into a removed entry** follows the same 409 as a session
   push; the token surface itself was not changed.
