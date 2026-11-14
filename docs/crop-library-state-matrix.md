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
| Link kind | one-time import (provenance only, no sync) · not linked · own published entry (`origin_type` stays manual) · imported foreign entry · linked through "Mit diesem Eintrag verknüpfen" (foreign or own) |
| Entry state | published · withdrawn · removed · restored · reverted to an older version · species relinked (with/without variety change) · species rejected · parked relink request |
| Version state | aligned · linked without baseline · library ahead · library ahead but rejected · local changes · local and library changed · local changes after a rejection |
| Local pins (`library_pinned_fields`) | none · pinned and otherwise aligned · pinned, library ahead in another field · pinned, library changed only the pinned field · pinned plus a local change elsewhere · pinned Sorte inheriting from a pinned Kultur |
| Actor | established account · `new` trust account · API token (queued proposal) · project member without edit rights |
| Actions | publish · link · sync (all pull / all push / all local / mixed) · pull (with/without releasing a pin, with/without keeping a local change) · unpin a field · reject update · unlink · re-link · relink species · remove · restore · revert · withdraw · rename variety · delete crop |

## Cells and expected outcome

`Seeded` cells are built by the fixture and asserted by the matrix test. The
columns are what the crop serializer must report.

| Cell (fixture key) | Entry | Version state | `public_publish_blocked_reason` | `can_unlink` | UI state (resolver) |
|---|---|---|---|---|---|
| `unlinked` | – | – | `null` | no | button "In Bibliothek teilen" |
| `own_published_aligned` | own, published | aligned | `no_local_changes` | no (`crop_link_owned`) | chip "Aktuell" |
| `own_published_local_changes` | own, published | local changes | `null` | no | button "Bibliothek aktualisieren" |
| `own_published_baseline_withheld` | own, published | linked without baseline (general Kultur whose values differ from the entry its Sorte's publish created) | `update_pending`, `public_update_available` | no | button "Kultur aktualisieren" |
| `own_withdrawn` | own, withdrawn | aligned | `entry_withdrawn`, `can_republish_public_crop` | **yes** | button "Wieder veröffentlichen" |
| `own_removed` | own, removed | aligned | `entry_removed` | **yes** | chip "Eintrag entfernt" |
| `foreign_published_aligned` | foreign, published | aligned | `no_local_changes` | yes | chip "Aktuell" |
| `foreign_published_local_changes` | foreign, published | local changes | `null` | yes | button "Bibliothek aktualisieren" |
| `foreign_library_ahead` | foreign, published | library ahead | `null`, `public_update_available` | yes | button "Kultur aktualisieren" |
| `foreign_library_ahead_local_changes` | foreign, published | local change in one field, library ahead in another | `null`, `public_update_available` | yes | button "Kultur aktualisieren" (the pull wins; its dialog offers "Nur lokal behalten" for the local change) |
| `foreign_library_ahead_rejected` | foreign, published | ahead, declined | `null`, `public_update_rejected` | yes | chip "Update abgelehnt" |
| `foreign_withdrawn` | foreign, withdrawn | aligned | `entry_withdrawn` | yes | chip "Eintrag zurückgezogen" |
| `foreign_removed` | foreign, removed | aligned | `entry_removed` | yes | chip "Eintrag entfernt" |
| `foreign_restored` | foreign, published again | aligned | `no_local_changes` | yes | chip "Aktuell" (as if never removed) |
| `new_account_proposal_pending` | foreign, published | local changes + queued proposal | `null`, `public_change_proposal_pending` | yes | chip "Vorschlag in Prüfung" |
| `pinned_aligned` | foreign, published | harvest duration pinned and different, everything else aligned | `no_local_changes` | yes | chip "Aktuell" + chip "1 Feld lokal fixiert" |
| `pinned_library_ahead_other_field` | foreign, published | pinned; library ahead in an unpinned field | `null`, `public_update_available` | yes | button "Kultur aktualisieren" (the pinned field is not in the diff) |
| `pinned_library_changed_pinned_only` | foreign, published | pinned; library changed only the pinned field | `no_local_changes` | yes | chip "Aktuell" (no pull, no notice) |
| `pinned_local_changes` | foreign, published | pinned plus a local change in an unpinned field | `null` | yes | button "Bibliothek aktualisieren" (sync lists the pinned row preselected "Nur lokal") |
| `pinned_sorte_vs_pinned_kultur` | foreign variety entry, published | Sorte inherits its Kultur's pinned value and pins it against its own entry | `no_local_changes` | yes | chip "Aktuell" + chip "1 Feld lokal fixiert" |

Every cell also reports its `library_pinned_fields` (`[]` outside the pinned
cells). The pinned-Sorte cell's general Kultur is a helper row named
`Matrix-helper …`, so cell counts by name stay exact.

Rules that cut across cells:

- **Unpublished link** (`entry_withdrawn` / `entry_removed`) ranks before every
  push and pull state. `public-sync` (GET/POST) and `publish-public` answer 409
  `public_crop_link_unavailable` with `reason`. Unlink is always allowed here,
  including for the user's own entry.
- **Republish**: the contributor's own withdrawn entry gets a "Wieder veröffentlichen" button (one confirmation, `publish-public`; the confirmation requires "Offizielle Kulturart" when the crop's species is missing or rejected); foreign withdrawn and removed entries never do.
- **Restore** puts a still-linked crop back to its normal state (values are
  untouched); a crop unlinked meanwhile stays unlinked.
- **Pins** never change the case on their own: a difference only in pinned
  fields is "Aktuell", a library change of only a pinned field brings no pull,
  and a pull or push never touches a pinned field. They are released only
  explicitly — the sync's "Bibliothek"/"Meine Kultur" choice, the pull
  dialog's checkbox, "Fixierung lösen" in the form pin's popover, clearing
  the field — or by an unlink. They are set only in the sync ("Nur lokal")
  and in the pull dialog ("Nur lokal behalten" on a locally changed field).
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

1. **Pull against an unpublished entry via the library page.**
   `public-crops/<id>/import/` still answers a plain 404 for anything not
   published; no crop-side control reaches it any more.
2. **API-token push into a removed entry** follows the same 409 as a session
   push; the token surface itself was not changed.

### Linking an existing culture

| Case | Expected result |
|---|---|
| Unlinked crop, existing public entry | Select entry in publish wizard; compare fields; link without publishing local fields or varieties |
| General import, existing project species | Explain match, compare, explicitly choose one-time copy or link; direct import/new returns 409 rather than creating a second general row |
| One-time import into unlinked existing crop | Apply selected fields in place; retain/set provenance; no sync link, baseline or pins; later library changes produce no update action |
| No matching project crop | One click on Import and link creates a linked crop from library values, without another dialog; an implicit general parent is linked only when newly created |
| Single stable unlinked candidate | Display selected target clearly; no write until explicit confirmation |
| Name-only or multiple candidates | Require explicit target selection; name-only suggestions permit explicit new-copy choice |
| All candidates already linked | Preserve links; explain existing update path; never replace or remove a link through one-time copy |
| Unclassified crop matches a translated name/synonym | Suggest target; require explicit confirmation |
| Already-linked target | Retain re-import conflict/update behavior; reject another initial link |
| Multiple candidates | No preselected target; reject links retaining duplicate general rows of one species |
| Entry/local row changed after preview | Refuse stale confirmation; reload comparison; no partial mutation |
| General identity writers | CRUD, implicit general creation, species assignment and restore serialize on the project row and reject a conflicting active general identity. Busy projects return 409 rather than waiting in reverse library/project lock order. Legacy duplicates remain readable; no canonical row is selected. |
| Restore after replacement | Undelete and historical restore reject a conflicting general identity atomically, leaving deleted rows and their varieties unchanged. |
| Legacy duplicate generals | Display as general entries; reject rename/delete; expose full delete scope and block confirmation |

Synthetic regressions cover a general Tomato and twelve varieties, explicit
linking, repeated import, project-scoped alias suggestions, stale versions, and
legacy duplicate rename/deletion rollback.

The import browser selects **Import values and link** first for a matched
existing culture. Its comparison offers library values, explicitly shared project
values, and **Nur lokal** (persistently pinned). Default private values and choices
carried over from one-time import remain private; switching modes expires earlier
sharing intent. The comparison lists what will become public and requires the
current contribution consent. Only an account allowed to edit directly can share
here; other accounts can pull or pin without creating a moderation proposal.

Pulls, explicit shares, pins, the link and consent are atomic under the same
version and local snapshot guards. The final normalized values establish the
resulting public-version baseline. Germination pins exclude their compatibility
projection from divergence tracking, while the other unpinned axis still counts.
The browser stays open with its search and filters, shows the linked row and
disables an up-to-date import. Resizing an open comparison also preserves the
browser search, filters and selected entry. Later unpinned changes still enable the existing
update workflow.

For a new culture, the page and picker action explicitly say **Import and link**
before the click. They preview matches in the captured active project and import
directly only when none exist, with the displayed library version and expected
project ID. Repeated clicks share one pending operation. The server rechecks
general and variety matches under its existing project/source locks; a newly
matching unlinked row requires comparison rather than creating a duplicate.
Failures roll back crop creation and its related writes. The linked result is
shown immediately, with the browser's search and filters retained. Unlinking
through the existing action keeps the culture and its imported values.
Explicit one-time copy APIs and existing-culture comparison choices remain
available; a direct new import never publishes project values.

The publish wizard's separate initial-link confirmation retains its private
middle-column behavior. Older link clients that omit sharing fields also publish
nothing. Copy-only import never publishes or creates pins. Invalid selections,
empty shares and overlapping pull/share/pin fields reject the complete request;
valid pins survive later library updates until explicitly released.
