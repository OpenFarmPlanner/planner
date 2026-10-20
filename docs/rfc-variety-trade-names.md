# RFC: Language-specific trade names for varieties in the public crop library

**Status:** design decided (2026-10-20); phases 0 and 1 implemented
(2026-10-20), phases 2–5 not yet. §2 lists the decisions that were fixed
before analysis began, and §13 records the decisions made on review. §3
describes the state *before* this work and is kept as the baseline the design
was derived from. Implementation notes for the shipped phases are in §12.

## 1. Motivation

[`i18n.md`](./i18n.md) §3 says that a variety name is a proper name and is
**never translated**: `Tomate – Moneymaker` and `Tomato – Moneymaker` are the
same crop. That stays correct for most varieties: `Roma`, `Moneymaker`, every
F1 hybrid.

It does not hold for descriptive heirloom varieties, which are sold under a
name of their own in each language area:

| de | en | fr | es |
| --- | --- | --- | --- |
| Gelbe Birne | Yellow Pear | Poire jaune | — |
| Ochsenherz | — | Cœur de bœuf | Corazón de buey |
| Schwarze Krim | Black Krim | Noire de Crimée | — |

French and Spanish users search for and buy seed under these names. Today the
library shows them only the name the entry happened to be published under, a
search for `Poire jaune` finds nothing, and a French user who publishes
`Tomate + Poire jaune` creates a second entry for the same variety.

This RFC replaces the "never translated" rule **for this case only**. It adds
an optional, per-language **trade name** (Handelsname) beside the original
name. It is not a translation feature.

## 2. Decisions fixed before this RFC

1. A variety stays **one language-independent record with one original
   name**.
2. Each language **may** have one trade name. It is entered only when the
   variety is actually sold under that name in that language area. Nothing is
   machine-translated, not even as a suggestion.
3. Display:
   - If the UI language has a trade name, show the trade name followed by the
     original: `Poire jaune (Gelbe Birne)`.
   - If it does not, show the original name alone, with no fallback marker.
   - Never fall back to another language's trade name.
4. Search finds the original name and every trade name in every language.
5. Duplicate detection works on the variety's identity, never on a localized
   name. Someone who starts to publish `Poire jaune` is shown `Gelbe Birne` and
   can link to it.
6. Users maintain trade names without moderation:
   - Every signed-in user may add, change, and remove trade names.
   - Editing starts from an action in the library detail view, like "Add
     translation" for descriptions.
   - The field carries this hint: „Nur eintragen, wenn die Sorte in dieser
     Sprache tatsächlich so verkauft wird. Nicht selbst übersetzen.“
   - An optional source field takes a link to a catalogue or retailer.
   - Safeguards act after the fact rather than before: change history with
     revert, a report action, and simple rate limiting.
7. The starter set comes from the `crop-data` repository. This RFC describes
   which token and endpoint it could write through.
8. Variety names in private projects stay free text and are not changed.

## 3. Current state

### 3.1 What is implemented

**There is no variety entity.** A "Sorte" in the public library is a
`PublicCrop` row whose `variety` is not blank. A row with a blank `variety` is
the general entry of a crop species ("Kultur").

| Concern | Where | Behaviour today |
| --- | --- | --- |
| Storage | `backend/farm/models/crops.py` → `PublicCrop.variety` (`CharField(200)`), `variety_normalized` (trim, collapse whitespace, lower-case; set in `save()`) | One name, no language. |
| Language data on an entry | `PublicCropTranslation` (same file): `(public_crop, language_code)` unique, holds **only** `description` | The model docstring says explicitly that the variety name stays on `PublicCrop`. Empty descriptions produce no row (`i18n.md` §6). |
| Species names | `backend/crops/models.py` → `CropSpeciesTranslation`: `common_name`, `synonyms`, `regional_names`, `search_text_normalized` | Per-language translations of the species. Varieties have nothing equivalent. |
| Language codes | `language_code = CharField(max_length=10)` with **no DB choices**. They are validated in serializers against `config.languages.SUPPORTED_LANGUAGE_CODES` (`normalize_language_tag`) | This is the pattern to copy. |
| Display (backend) | `PublicCrop.display_name()` returns the species name only. Its docstring: "variety names are proper names and are never translated. Callers combine the two themselves." | |
| Display (frontend) | `frontend/src/crop-library/publicCropDisplay.ts` → `getPublicCropTitle()` builds `Species (variety)` and its file comment repeats the "never translated" rule. `frontend/src/crops/cropHierarchy.ts` → the variety row label is `crop.variety`. | Users: library list and hierarchy (`crops/PublicCropHierarchyList.tsx`), library detail header and the "Sorte" detail row (`crop-library/pages/PublicCropLibraryPage.tsx`), the library picker dialog (`crop-library/components/PublicCropLibraryDialog.tsx`), the mobile selector (`publicCropLibrary/PublicCropMobileSelectorDialog.tsx`), and the formatters (`publicCropLibrary/formatters.ts`). |
| Search (backend) | `backend/crops/services.py` → `build_public_crop_search_query()`: `variety__icontains` plus species names, translations and aliases. The `?variety=` filter in `PublicCropViewSet.get_queryset()` and `list_published_crops()` is `variety__icontains`, with the comment "matched verbatim, not translated". | |
| Search (frontend) | `frontend/src/crops/publicCropSearchMatch.ts` filters on the client: species names, aliases, and `crop.variety`. | |
| Duplicate detection | `backend/farm/services/public_crops.py` → `detect_public_crop_duplicates()` (publish wizard), `find_public_crop_identity_conflict()` (variety rename, species relink); `backend/crops/services.py` → `find_exact_crop_match()` (`/match`) | Identity = species (or, for legacy rows, the normalized name) + **`variety_normalized` equality**. Cross-language matching exists for the species only. |
| Variety rename | `update_public_crop_directly()` | `variety` is the entry's identity. Only the entry's publisher or a library admin may rename it, and never through the moderation queue. |
| Publish wizard | `frontend/src/pages/CropsPublishingWizardDialog.tsx`: the "existing variety" picker lists `option.variety` and pre-selects an entry whose normalized variety equals the local one | |
| Import into a project | `import_to_project` → `build_project_crop_payload()` copies `variety` verbatim into the private `Crop.variety`. `ImportConflictDialog.tsx` compares `existing_variety` and `public_variety` as strings. | |
| Sync with a linked entry | `_sync_compared_fields()` / `public_crop_pushable_sync_fields()` compare `variety` as a plain field against a variety entry. | A private crop named `Poire jaune` that is linked to `Gelbe Birne` would show the variety as a difference. |
| Project crop form | `frontend/src/crops/usePublicCropSuggestions.ts` → `dedupePublicCropVarieties()` offers the library's original variety names as autocomplete for the free-text `Crop.variety` | |
| History | `PublicCropRevision` snapshots `PUBLIC_CROP_EDITABLE_FIELDS` plus species and original language. Revert is `restore_public_crop_version()`. | **Description translations are not versioned.** `PUT /translations/` (`replace_public_crop_translations()`) writes in place with no revision. |
| Who may edit live | `farm/crops/moderation.py` → `requires_moderation_queue()` sends every API-token write and every session write from a `new`-trust account to `PublicCropChangeProposal` | The `translations` action does **not** call it: any signed-in user (except guest demo users) writes descriptions live. That is the precedent decision 6 follows. |
| Reporting | — | **No report function exists** anywhere in the codebase. `farm/models/feedback.py` is generic app feedback with no link to a record. |
| Rate limiting | `accounts.throttling.TrustAwareWriteRateThrottle` (default, `write_new_account` 100/h for new accounts only); `crops/agent_api/throttling.py` (`crop_library_token_write` 300/h) | Nothing is specific to library edits. |
| Tokens | `ProjectApiToken`: `PublicCropViewSet.api_token_actions = {'update', 'partial_update'}`, always queued. `CropLibraryApiToken` (`ofp_clt_`, superuser-minted, see [`crop-library-api-tokens.md`](./crop-library-api-tokens.md)): only `CropSpeciesViewSet` and `PlantFamilyViewSet`; `CropLibraryTokenSurfaceMiddleware` refuses it on `/api/public-crops/`. | |

### 3.2 What exists only in design documents

- [`public-crop-library-data-model.md`](./public-crop-library-data-model.md)
  §2 plans a separate **`CropVariety`** entity whose "`variety_name` is
  stored once and is not translated", plus a `CropTranslation` table for
  variety text. **Neither exists.**
  [`crop-library-architecture.md`](./crop-library-architecture.md) lists both
  as "not done". This RFC must not depend on them, but should be easy to move
  onto `CropVariety` later (§4).
- An unauthenticated public `/crops` route is "not done", so trade names have
  no SEO implications today.

### 3.3 A discrepancy noted in passing (not part of this RFC)

`i18n.md` §4 says duplicate detection uses "species plus a normalized variety
name **plus the supplier**". `PublicCrop` has no supplier field, and none of
the three detection functions in §3.1 considers one. The documentation is
inaccurate, not the code. This should be fixed separately.

The backend's `normalize_text()` also does not fold diacritics, although
[`search.md`](./search.md) requires an app-wide backend search to do so. §6.3
explains why this matters for trade names.

## 4. Data model

### Option A (recommended): a dedicated table `PublicCropTradeName`

```
PublicCrop (variety entry)              unchanged, original name in `variety`
  └─ PublicCropTradeName                (public_crop, language_code) unique
       ├─ language_code                 CharField(10), no choices; validated
       │                                against SUPPORTED_LANGUAGE_CODES
       ├─ name                          CharField(200), whitespace-collapsed
       ├─ name_normalized               search/identity form (§6.3), indexed
       ├─ source_url                    URLField(500), blank; http(s) only
       ├─ created_by / updated_by       FK user, SET_NULL
       └─ created_at / updated_at
PublicCropTradeNameEvent                append-only history (§8.2)
PublicCropReport                        post-hoc reports (§8.3)
```

Advantages:

- It says what the data is: a fact about the market in one language area, not
  a translation. It is separate from `PublicCropTranslation`, whose semantics
  are "editorial text".
- It has its own permission rule (any signed-in user), separate from the
  locked identity field `variety` (publisher or admin only).
- It has its own history, without bumping `PublicCrop.version` (see the
  disadvantages of option C).
- One indexed column (`name_normalized`) serves both search and duplicate
  detection. A join and a prefetch (`prefetch_related('trade_names')`) keep
  the list endpoint at a constant query count.
- When `CropVariety` arrives, the foreign key moves from `PublicCrop` to
  `CropVariety` in one data migration, and nothing else changes shape.

Disadvantages: one more table and prefetch, and one more set of
query-count tests.

### Option B: fields on `PublicCropTranslation` (`trade_name`, `trade_name_source_url`)

Advantages: no new table, already unique per language, already prefetched.

Disadvantages:

- A translation row currently means "a description exists in this
  language". `descriptions_by_language()` skips empty descriptions, the
  migrations deliberately create no row for an empty description (so that
  "has a translation" checks are not misleading), and the "at least one
  language must have a description" rule counts rows. A row that holds only a
  trade name would break all three.
- `PUT /translations/` deletes the row when a description is blank, which
  would silently delete the trade name too.
- Descriptions are unversioned prose. Trade names need history and revert.
  Two different lifecycles would share one row.
- It suggests that the trade name is a translation of the variety name, which
  is exactly the misunderstanding decision 2 rules out.

### Option C: a JSON field `PublicCrop.trade_names = {lang: {name, source_url}}`

Advantages: smallest change, and it lands in `PublicCropRevision` snapshots,
which gives history and revert for free.

Disadvantages:

- Every trade-name edit bumps `PublicCrop.version`. A user who has the full
  edit form open then gets a `409` edit conflict (`base_version`) because
  someone else added a French name.
  (`has_pending_public_crop_update()` already ignores bumps without compared
  changes, so linked projects would not see a false "update available", but
  the edit conflicts remain.)
- Revert happens at whole-entry level. Reverting a vandalised trade name
  would also roll back unrelated field edits made since.
- `icontains` on JSON cannot be indexed and is not portable across the
  SQLite test database and PostgreSQL. Uniqueness and conflict checks per
  language become application-only.
- No per-language attribution.

### Recommendation

**Option A.** Constraints and rules:

- A trade name only applies to **variety entries** (non-blank `variety`). The
  general species entry is named through `CropSpeciesTranslation`
  (`synonyms` / `regional_names`). The API rejects trade names on a general
  entry.
- `name_normalized` must differ from the entry's own `variety_normalized`.
  `Moneymaker (Moneymaker)` is never stored.
- No row is stored for an empty name. Removing a trade name deletes the row
  and leaves an event in the history.
- A trade name may be stored in the same language as the original name if the
  variety really is sold there under a second name. Rule 3 then still applies
  unchanged.
- Uniqueness of identity is covered in §7.2.
- Hard delete cascades. Withdrawal or removal of the entry hides its trade
  names with it.

## 5. API changes (additive)

All changes are additive. No existing field changes meaning, and `variety`
stays the original name everywhere.

### 5.1 Read

On `PublicCropSerializer` (`/api/public-crops/`) and the `crops` app's
`CropSerializer` (`/api/crop-library/`), the two usual shapes, as for
descriptions (`i18n.md` §5):

| Field | Meaning |
| --- | --- |
| `variety` | unchanged: the original name |
| `variety_trade_name` | trade name in the **request language**, or `null`. Never another language. |
| `variety_display` | `"Poire jaune (Gelbe Birne)"` or `"Gelbe Birne"`. Computed by the backend so every consumer formats it the same way. |
| `trade_names` | `{language_code: {name, source_url}}` for every language, for editing screens and client-side search |

No `*_language_code` field is added: decision 3 rules out fallback, so the
served language is always the request language or none.

`DuplicateCandidate` (publish-check response) and the `/match` responses gain
`matched_trade_name: {language_code, name} | null` (§7).

### 5.2 Write

A new action on `PublicCropViewSet`, modelled on `translations`:

- `GET /api/public-crops/{id}/trade-names/` returns every language plus the
  original name.
- `PUT /api/public-crops/{id}/trade-names/` takes
  `{language_code: {name, source_url} | null}`. Languages that are omitted are
  left untouched (the same rule as descriptions). `null` or a blank `name`
  removes that language. An optional `expected: {language_code: previous
  name | null}` returns `409 trade_name_edit_conflict` when another user
  changed that language in the meantime. This is per-language optimistic
  locking that does not touch `PublicCrop.version`.
- `GET /api/public-crops/{id}/trade-names/history/` returns events, newest
  first, with pseudonymised author labels like revisions
  (`farm/services/public_pseudonyms.py`).
- `POST /api/public-crops/{id}/trade-names/history/{event_id}/revert/`
  restores that event's previous value as a new event.
- `POST /api/public-crops/{id}/reports/` reports a trade name (§8.3).
- Moderator only: `GET /api/public-crops/reports/?status=open` and
  `POST /api/public-crops/reports/{id}/resolve/`.

Validation:

- Language code: `normalize_language_tag`, otherwise `400`. This is the same
  as `PublicCropTranslationsUpdateSerializer`.
- `name`: whitespace-collapsed, 1–200 characters, not equal to the original.
- `source_url`: `http`/`https` only, at most 500 characters. It is rendered
  with `rel="nofollow noopener ugc"` and `target="_blank"` and never as HTML.
- Identity conflicts (§7.2) return `409 trade_name_conflict` with
  `conflicting_public_crop_id`.

`?variety=` on both list endpoints also matches trade names. This widens the
results and does not change what a request means.

`farm/tests/test_public_api_schema.py` and the generated OpenAPI schemas are
updated in the same change.

## 6. Display and search rules

### 6.1 Display rule

One helper on each side, so no surface formats the name on its own:

- Backend: `PublicCrop.variety_display(language_code) -> (label, trade_name |
  None)` feeds `variety_display`.
- Frontend: `getPublicCropVarietyLabel(crop)` in `publicCropDisplay.ts`
  reads `variety_display`, falling back to `variety` for older payloads.
  `getPublicCropTitle()` uses it.

Rules:

1. A trade name in the UI language gives `«trade name» («original»)`.
2. Without one, the label is `«original»`, with no chip or "only available in
   …" hint. The original name is not a fallback, so `getFallbackNotice()` must
   not be applied to it.
3. A trade name from another language is never shown as the label. The
   detail view may list all trade names as data (§6.2), but the label never
   uses them.
4. The species part of the title keeps its existing localisation and regional
   override, unchanged.
5. Where species and variety are combined in one string, an entry with a
   displayed trade name reads `Tomate · Poire jaune (Gelbe Birne)`. Every
   other title keeps its current form, `Tomate (Moneymaker)` (decided in
   §13, D2).

### 6.2 Affected surfaces

| Surface | Change |
| --- | --- |
| Library list / hierarchy (`PublicCropHierarchyList.tsx`, `cropHierarchy.ts` variety label) | Variety row label = §6.1. Sort by the displayed label on the client. The server keeps `ordering = ['name', 'variety']`. |
| Library detail (`PublicCropLibraryPage.tsx`) | Header and "Sorte" row use §6.1. A new "Handelsnamen" block lists all languages with their sources, plus an action that opens the edit dialog (§8.1). |
| Library picker and mobile selector (`PublicCropLibraryDialog.tsx`, `PublicCropMobileSelectorDialog.tsx`, `formatters.ts`) | Label from §6.1. |
| Publish wizard (`CropsPublishingWizardDialog.tsx`) | The "existing variety" picker shows §6.1 labels. Pre-selection also matches the local variety against trade names. The duplicate step names the matched trade name (§7.1). |
| Import into project (`import_to_project`, `ImportConflictDialog.tsx`) | The import copies the **original** name into `Crop.variety`, unchanged (decision 8). The conflict dialog does not report a variety change when the local name equals one of the entry's trade names. |
| Sync with a linked entry (`_sync_compared_fields`, `public_crop_field_changes`) | A private variety that equals the original or **any** trade name of the entry counts as "in sync" for `variety`. Otherwise a French user's `Poire jaune` would be offered as a pull to `Gelbe Birne` or as an attempted rename. |
| Project crop form autocomplete (`usePublicCropSuggestions.ts`, `dedupePublicCropVarieties()`) | Options show §6.1 labels. Picking `Poire jaune (Gelbe Birne)` writes the trade name `Poire jaune` into the free-text field (§13, D3). |
| Anbaupläne, Saatgutbedarf, Jungpflanzenbedarf, every other project view | Unchanged in phases 1–4: they show the private `Crop.variety` (decision 8). Phase 5 adds a read-only trade-name display for linked crops (§13, D1). |
| Moderation page (`PublicLibraryModerationPage.tsx`) | New queue: open reports (§8.3). |

### 6.3 Search rules

- Backend: `build_public_crop_search_query()` gains
  `Q(trade_names__name_normalized__icontains=term)` over the existing terms,
  and `?variety=` additionally matches `trade_names__name_normalized`. The
  queries already call `.distinct()`.
- Frontend: `publicCropMatchesSearchQuery()` also checks every value in
  `trade_names`, in all languages (decision 4).
- Normalisation: `Cœur de bœuf` and `Corazón de buey` are typed as `coeur de
  boeuf` and `corazon de buey`. [`search.md`](./search.md) already requires
  diacritic folding (NFD, combining marks removed), but `œ`/`æ` are
  ligatures that NFD does **not** decompose. Proposal: add "`œ`→`oe`,
  `æ`→`ae`" to `search.md` §Normalization, implement it in
  `frontend/src/search/searchText.ts`, and compute `name_normalized` with a
  backend helper that implements the same rules. Bringing the backend's
  existing `variety__icontains` / species search up to `search.md` is
  pre-existing debt (§3.3) and is flagged separately.
- Hit reporting: when a query matches only a trade name in another language,
  the result reports it the way synonym hits do (`search.md` §Synonyms), for
  example "matches: Poire jaune (fr)". Otherwise a German user who searches
  `Noire de Crimée` sees `Schwarze Krim` without knowing why.

## 7. Duplicate detection and the publish flow

### 7.1 Identity stays the record

The identity of a variety is still the `PublicCrop` row: species (or legacy
name) plus its original `variety_normalized`. Trade names are **lookup keys
into that identity**, never part of it. Concretely, `detect_public_crop_duplicates()`,
`find_exact_crop_match()` and `find_public_crop_identity_conflict()` change
their variety filter from

```
variety_normalized = v
```

to

```
variety_normalized = v  OR  trade_names.name_normalized = v
```

with the same species scope as today and `.distinct()`. The returned
candidate is the original entry, with `matched_trade_name` set.

A French user who publishes `Tomate + Poire jaune` therefore sees
`Gelbe Birne`, where the duplicate step says "`Poire jaune` is the French trade
name of this variety". The existing "link to the existing entry" path applies
unchanged. The private crop keeps `Poire jaune` (decision 8), and §6.2's sync
rule keeps it from being flagged.

### 7.2 Conflicts when saving a trade name

Saving trade name `t` in language `L` on entry `E` (species `S`) is refused
with `409 trade_name_conflict` when, among **published** entries of `S` other
than `E`:

1. an entry has original name `t`, which means it is a duplicate of `E`, or
2. an entry has trade name `t` in any language, which would be ambiguous.

The response links to the conflicting entry. Resolving it is a human
decision. If it is a real duplicate, a moderator removes one entry with
reason `duplicate` (the existing removal flow). There is no merge tool (§13, D6).
The same checks run when a variety is renamed and when a species is relinked
("Kulturart korrigieren"), because both change the scope that trade names are
checked against.

A name that the trade uses for **several** different varieties in one
language is not a trade name for any of them (guideline addition, §10).

### 7.3 Publish flow otherwise

- Publishing does not ask for trade names in the first version. They are
  added afterwards in the detail view. Collecting them in the wizard could
  come later.
- A new publish where no trade name exists yet still creates a second entry
  (`Poire jaune` beside `Gelbe Birne`). That is unavoidable without the data.
  It becomes visible as a `409` as soon as someone adds the trade name to
  either entry, and is then resolved as described in §7.2.

## 8. Permissions and safeguards

### 8.1 Who may write

| Actor | Trade names: add, change, remove, revert | Report | Resolve reports |
| --- | --- | --- | --- |
| Signed-in session user (`established`) | yes, live | yes | — |
| Signed-in session user (`new` trust level) | yes, live, with the same rights as established accounts and no moderation queue (§13, D4). Only the throttle in §8.4 applies. | yes | — |
| Guest demo user | no (`_guest_demo_write_forbidden`, like `translations`) | no | — |
| Library moderator / admin | yes | yes | yes, from the moderation page |
| `ProjectApiToken` | **no**: not added to `api_token_actions` | no | no |
| `CropLibraryApiToken` (`ofp_clt_`) | yes, live, for the starter set (§9) | no | no |

Why `ProjectApiToken` is excluded: every crop-library write through that
token goes to the moderation queue today. The `PublicCropViewSet` comment and
`requires_moderation_queue()` describe this as "a token can never edit the
public library live". Trade names have no queue, so letting this token write
them would break that invariant. Read access is unchanged as well: this token
cannot reach `list`/`retrieve` on `/api/public-crops/` today, and that remains
deferred, as described in `agent-api.md`.

The edit UI is a dialog opened from the "Handelsnamen" block in the detail
view, built on the same pattern as `PublicCropTranslationDialog.tsx`: one row
per supported language with the original name read-only on top, a field for
the name with the fixed hint text from decision 6, and an optional source
field. All new UI text exists in de, en, fr, and es. The glossary gains
"Handelsname" (§11).

### 8.2 History and revert

`PublicCropTradeNameEvent` (append-only) records: `public_crop`,
`language_code`, `action` (`set` / `removed` / `reverted`), `old_name`,
`new_name`, `old_source_url`, `new_source_url`, `created_by`, `origin_api`
(set for `CropLibraryApiToken` writes), and `created_at`.

- Any signed-in user may revert an event. A revert writes a new event and
  never deletes history.
- History lives in the trade-name dialog, not in the "Versionen" panel, so
  `PublicCrop.version` and its edit-conflict and update semantics stay
  untouched (option C's problem). Decided in §13, D5.
- History authors are pseudonymised like revision authors.
- Data export (`accounts/data_export.py`) includes the user's own events.
  Account deletion sets `created_by` to null.

### 8.3 Reporting

There is nothing to reuse (§3.1), so this RFC adds a small, generic model so
that later report targets do not need a parallel implementation:

`PublicCropReport`: `public_crop`, `subject` (`trade_name` only in v1),
`language_code`, `reason` (`not_sold_under_this_name`, `self_translated`,
`wrong_variety`, `spam`, `other`), `note`, `reported_by`, `status`
(`open` / `resolved` / `dismissed`), `resolved_by`, `resolved_at`.

- Moderators are notified through the existing `Notification` path, the same
  way as `notify_moderators_of_change_proposal`.
- A report does not hide the trade name. Moderators resolve it by editing,
  reverting, or dismissing.
- One open report per user, entry, and language. A repeated report updates
  the note.
- Reason labels are localised. Raw enum values are never rendered.

### 8.4 Rate limiting

- A new scoped throttle, `public_crop_trade_name_write`, keyed per user and
  configurable by environment variable. Proposed default: `30/hour` for all
  session accounts. This is in addition to the global
  `TrustAwareWriteRateThrottle` (100/h for new accounts).
- `public_crop_report`, proposed default `20/hour`.
- `CropLibraryApiToken` writes keep their own `crop_library_token_write`
  scope (300/h), so the starter-set import is not slowed by the session
  limit.

## 9. Starter set from `crop-data`

The starter set is written with the existing **`CropLibraryApiToken`**
(`ofp_clt_`), not a new token type:

1. `PublicCropViewSet` declares
   `crop_library_token_actions = {'list', 'retrieve', 'match', 'trade_names'}`
   and **adds `CropLibraryTokenAccessPermission` to `permission_classes`**.
   This step is required. `CropLibraryTokenSurfaceMiddleware` only checks the
   class-level opt-in, so without the per-action permission every action of
   the viewset would become reachable. The existing comment on
   `ApiTokenAccessPermission` in the same viewset describes the identical
   trap.
2. The sync job resolves each variety with
   `GET /api/public-crops/match/?name=<species>&variety=<original>` (or `list`
   with `?crop_species=`), then calls `PUT /api/public-crops/{id}/trade-names/`
   with only the languages it has evidence for, each with a `source_url`.
   Because omitted languages are left untouched, user edits in other
   languages survive a re-sync.
3. Authorization rides on the bound (superuser) account, as for species
   edits. Events carry `origin_api = true`, so the history shows which
   entries came from the import.
4. Roll out on staging first. `crop-library-api-tokens.md` updates its
   "reachable" table in the same change. This is a widening of a token
   surface and goes through the security review path of
   `.github/workflows/claude-pr.yml`.

`crop-data` must apply the same rule as users: only names with a retail or
catalogue source, and no generated translations.

## 10. Addition to `crop-taxonomy-guidelines.md`

A new section **"§5 Varieties: one variety, several names"**, after §4:

> Two names denote **the same variety** when the trade lists them as the same
> variety: seed catalogues, seed banks or retailers sell the one under the
> other's name, or name both as equivalents. Then one public entry exists, and
> the second name is a **trade name** in its language, not a second entry.
> Example: `Gelbe Birne` = `Yellow Pear` = `Poire jaune`.
>
> Strains, selections and populations sold under the same name are **not**
> split into separate entries, unless sources clearly document different
> properties (for example a different ripening time, fruit colour or growth
> habit). If they do, they are separate varieties with distinguishable
> original names.
>
> A trade name is entered only when the variety is actually sold under it in
> that language area, preferably with a source. It is never the user's own
> translation of the original name, never a supplier's article title
> (`Tomate Poire jaune – Bio, 20 Korn`), and never a type or group name the
> trade uses for several different varieties in that language. That last case
> is the variety-level analogue of the `Peperoni` rule in §4. Such a name stays
> searchable through the varieties' own names and is not attached to any one
> of them.
>
> If a trade name in one language collides with another entry's original name
> in the same species, the two entries are duplicates. Resolve them by
> removing one (reason `duplicate`), not by leaving both in place.

The scope paragraph at the top also gains "variety trade names", and §3
("Variety — not the crop-species level") gets a cross-reference to the new
section.

## 11. Changes to `i18n.md` and neighbouring documents

| Place | Current statement | New statement |
| --- | --- | --- |
| `i18n.md` §3 Model (tree) | `variety  proper name, never translated` | `variety  original name, never translated` plus a child `PublicCropTradeName (public_crop, language_code) unique → name, source_url  optional per-language trade name, never a translation` |
| `i18n.md` §3 "Translatable vs. not" | "variety name (a proper name)" under *Not translatable* | Keep it, and add the sentence: "A variety may additionally carry one **trade name** per language, only where it is sold under that name. A trade name is a market fact, not a translation, and is never machine-generated." Keep the `Moneymaker` example and add `Gelbe Birne` / `Poire jaune`. |
| `i18n.md` §3 Fallback order | applies "for every translatable field" | Add: "Trade names have **no** fallback. Without a trade name in the requested language the original name is shown on its own, with no fallback indicator." |
| `i18n.md` §3 Editing | descriptions only | Add a paragraph on the "Handelsnamen" action, its history and reports. |
| `i18n.md` §4 Search | species names and aliases | Add "and every variety trade name in every language". |
| `i18n.md` §4 Duplicate detection | "species plus a normalized variety name plus the supplier" | "species plus a normalized variety name, where the variety is matched by its original name **or any of its trade names**". Drop the inaccurate "plus the supplier" (§3.3). |
| `i18n.md` §5 API | resolved and raw shapes | Add `variety_trade_name`, `variety_display`, `trade_names`, and the `/trade-names/` endpoints. |
| `i18n.md` §9 Tests | — | Add rows for the new backend and frontend tests. |
| `i18n-glossary.md` | `Sorte` only | Add `Handelsname | Trade name | Nom commercial | Nombre comercial`. |
| `search.md` | NFD folding | `œ`→`oe`, `æ`→`ae`; trade names as searched fields of library entries. |
| `crop-library-architecture.md` | status table | Add a row for trade names, plus a short section on what they are and where they live. |
| `crop-library-api-tokens.md` | reachable table | Add the `PublicCropViewSet` actions from §9. |
| `account-trust-levels.md` | queued contributions | Say that trade names are **not** queued and why. |
| `publicCropDisplay.ts` header comment | "never translated" | Name the trade-name exception. |

## 12. Implementation phases

Each phase is its own PR, with tests and documentation as `CLAUDE.md`
requires. Phases 1 and 3 change views, permissions and models, so they go
through the automated security review.

| Phase | Content | Exit criterion |
| --- | --- | --- |
| 0. Glossary | Add the `Handelsname` entry to `i18n-glossary.md` (§11). | Term available for all four languages. |
| 1. Backend model and read path | `PublicCropTradeName` and `PublicCropTradeNameEvent`, migration. Serializer fields (§5.1), search (§6.3), duplicate detection and conflict checks (§7). `assertNumQueries` for both list endpoints with several entries and trade names (`farm/tests/test_api_query_counts.py`). Tests for cross-language duplicates in `farm/tests/test_public_crop_language.py`. | Read side complete. No write UI yet. |
| 2. Write API with safeguards | `/trade-names/` PUT, history, revert, reports, moderator resolve, throttles, data export. Session users only. | **Editing never goes live without history, report and throttle.** That is why they ship together. |
| 3. Frontend | Display helper and every surface in §6.2. The dialog in the detail view. History in the dialog. The report action. The moderation queue. Sync and import comparison rules. Translations in all four languages. Visual review at 375/768/1024/1440 and in phone landscape for the detail view and the dialog. | Users can maintain trade names. |
| 4. Starter set | `CropLibraryApiToken` opt-in (§9) and token-surface tests. Staging first, then a `crop-data` sync job. | Starter set imported on production. |
| 5. Linked private crops | Read-only `variety_display_name` on the project crop API, shown in project views and found by page search (§13, D1). Query-count test for `GET /api/crops/`. | A linked crop shows the trade name in the UI language. |

**Shipped in phases 0–1:** the glossary entry; `PublicCropTradeName` and
`PublicCropTradeNameEvent` (`farm/models/crops.py`, migration
`farm.0115_public_crop_trade_names`); `PublicCrop.variety_trade_name()` /
`variety_display()` / `trade_names_by_language()`; the read fields of §5.1 on
`/api/public-crops/` and `/api/crop-library/`; `matched_trade_name` on
duplicate candidates and both `/match/` responses; trade-name search on `q`
and `variety` (`farm/services/public_crop_trade_names.py`); trade names in
duplicate detection and identity conflicts (rename, restore, relink); and the
`œ`/`æ` folding in `search.md`, `frontend/src/search/searchText.ts` and
`farm.utils.normalize_search_text`. A variety rename, restore or relink that
makes a trade name invalid (equal to the new original, or the entry became a
species-level entry) removes it and records a `removed` event. Phase 1 has no
write endpoint: trade names can only be created in the database until phase 2.

Suggested effort: **high** for phases 1–2 (identity, duplicate detection,
permission and token surface) and **medium** for phase 3.

## 13. Decisions (reviewed 2026-10-20)

**D1. A private crop linked to the library shows the trade name in the UI
language,** read-only and additive, in a separate phase after phase 3
(phase 5). The project crop API gains `variety_display_name` beside the
unchanged `variety`, following the existing `crop_display_name` pattern. It
is set only while the linked entry is published and only while
`Crop.variety` still equals the entry's original name or one of its trade
names. Editing, history and exports keep the stored name (decision 8). Page
search also finds the plan under the trade name (`search.md`). The accepted
consequence: in a shared project, a German and a French member see the same
plan under different variety names.

**D2. Combined titles use `Tomate · Poire jaune (Gelbe Birne)`.** Where the
variety label stands alone (hierarchy rows, the detail row, pickers), it
follows decision 3. In strings that combine species and variety, an entry
with a displayed trade name uses the `·` separator the publish wizard already
uses. Every other title keeps its current form, `Tomate (Moneymaker)`, so no
nested parentheses appear.

**D3. The variety autocomplete in the project crop form writes the trade
name.** A French user who picks `Poire jaune (Gelbe Birne)` gets `Poire jaune`
in the free-text field, because that is the name they buy under. §6.2 keeps
sync and duplicate detection working with either name.

**D4. No moderation for trade names, for any account.** `new`-trust accounts
add, change, remove and revert trade names live, with the same rights as
established accounts. There is no moderation queue and no "add only"
restriction. `requires_moderation_queue()` is not called on the trade-name
actions, and `account-trust-levels.md` records this exception. The
safeguards are the after-the-fact ones from decision 6: history with revert
(§8.2), reports (§8.3) and the throttle (§8.4).

**D5. Trade-name history stays separate from the "Versionen" panel.** It is
shown in the trade-name dialog (§8.2).

**D6. No merge tool in this work.** Duplicates found through trade names are
resolved by removing one entry with reason `duplicate` (§7.2). A merge tool
that moves linked private crops, discussions and history is left to its own
RFC.

**D7. The publish wizard does not collect trade names in the first
version** (§7.3). Trade names are added in the detail view afterwards.

**D8. Description translations stay without history** in this work. The
trade-name event table can serve as the pattern if that is taken up later.

**D9. Defaults and terms as proposed:** `public_crop_trade_name_write` is
`30/hour` and `public_crop_report` is `20/hour` (§8.4). The glossary term is
`Handelsname` / Trade name / Nom commercial / Nombre comercial (§11).

## 14. What this RFC deliberately does not cover

- Translating original variety names, and any machine assistance in finding
  trade names.
- Changing private project variety names (decision 8).
- The `CropVariety` entity from `public-crop-library-data-model.md`. §4 only
  keeps the path to it open.
- Bringing the backend's existing variety and species search up to
  `search.md` normalisation, and correcting the "plus the supplier" wording,
  except where this RFC's own changes touch them (§3.3).
- Any implementation: endpoints, migrations, permission classes, UI.
