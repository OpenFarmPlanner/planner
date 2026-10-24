# RFC: Variety trade names and cross-language variety recognition

**Status (2026-10-24):**

- **Part A (trade names):** the design was decided on 2026-10-20 (§15,
  D1–D9). Its backend is implemented on the branch of
  OpenFarmPlanner/planner#806, which is not merged yet (§3.2). The frontend
  is not built.
- **Parts B (recognising a variety across languages) and C (taxonomy
  rule):** new proposal, not implemented. No code, migrations or permission
  changes have been made for them. This document is the "analyse and plan"
  step for B and C.

§2 lists the decisions fixed before analysis began, and §16 the questions
still open. Parts B and C need their own go-ahead before implementation.

## 1. Motivation

[`i18n.md`](./i18n.md) §3 says that a variety name is a proper name and is
never translated: `Tomate – Moneymaker` and `Tomato – Moneymaker` are the
same crop. That stays correct for most varieties, such as `Roma`,
`Moneymaker` and every F1 hybrid.

It does not hold for descriptive heirloom varieties, which are sold under a
name of their own in each language area:

| de | en | fr | es |
| --- | --- | --- | --- |
| Gelbe Birne | Yellow Pear | Poire jaune | — |
| Ochsenherz | — | Cœur de bœuf | Corazón de buey |
| Schwarze Krim | Black Krim | Noire de Crimée | — |

French and Spanish users search for and buy seed under these names.

There is deliberately **no curated variety list** (unlike crop species).
Varieties come into existence when users publish them, so duplicates are
expected. This RFC has two jobs:

- **Avoid duplicates up front.** A trade name lets a name search find the
  variety (part A). Where no name links two entries yet, the user recognises
  the variety by its properties when publishing or linking (part B, §9–§10).
- **Clean up duplicates afterwards.** Two entries for the same variety can
  be merged into one (part B, §11).

## 2. Decisions fixed before this RFC

### A) Trade names

1. A variety stays **one language-independent record with one original
   name**.
2. Each language **may** have one trade name. It is entered only when the
   variety is actually sold under that name in that language area. Nothing
   is machine-translated, not even as a suggestion.
3. Display:
   - With a trade name in the UI language: the trade name, then the
     original name, `Poire jaune (Gelbe Birne)`.
   - Without one: the original name alone, with no fallback marker.
   - Never another language's trade name.
4. Search finds the original name and every trade name in every language.
5. Duplicate detection works on the variety's identity, never on a localized
   name.
6. Users maintain trade names without moderation:
   - Every signed-in user may add, change and remove trade names.
   - Editing starts from an action in the library detail view, like "Add
     translation" for descriptions.
   - The field carries this hint: „Nur eintragen, wenn die Sorte in dieser
     Sprache tatsächlich so verkauft wird. Nicht selbst übersetzen."
   - An optional source field takes a link to a catalogue or retailer.
   - Safeguards act afterwards rather than before: change history with
     revert, a report action, and simple rate limiting.
7. The starter set comes from the `crop-data` repository, through a token
   and endpoint this RFC names (§12).
8. Variety names in private projects stay free text and are never changed.

### B) Recognising a variety across languages

9. **Variety list per crop species with language-independent traits.** The
   library lists every variety of a species and can filter them by
   structured traits (for a tomato: fruit colour, shape, size class, growth
   habit), optionally with a photo. The description shows in the UI language
   or through the existing fallback, with its language label.
10. **Suggestion when publishing (the main path).** On publishing a variety,
    the system compares it with the existing varieties of the same species.
    It uses name similarity across all languages (robust normalisation for
    the comparison only) plus agreement of the traits from point 9.
    - The dialog asks "Is this the same variety as Gelbe Birne (yellow,
      pear-shaped, cocktail)?".
    - On "Yes", the entered name becomes a trade name in the user's
      language, and the private crop is linked to the existing variety
      through the existing link and sync flow, with per-field choice.
    - On "No", the variety is published as its own entry.
    - Nothing happens silently: every match needs the user's explicit
      confirmation.
    - Linking a private crop to the library behaves the same way.
11. **Merging afterwards.** A user marks two existing varieties of the same
    species as "the same variety".
    - The merged-away variety's name becomes a trade name of the surviving
      one, or a search alias if it is in the same language.
    - Links from private projects are moved to the surviving entry.
    - A wrong merge does more harm than a wrong name, because it moves other
      people's links. §11 compares (a) a second confirmation before the merge
      takes effect with (b) an immediate merge that can be fully reverted.
    - Conflicts are never resolved silently.

### C) Taxonomy rule

12. Two names denote **the same variety** when the trade lists them as the
    same variety. Strains or populations with the same or a translated name
    are not separated, unless sources clearly document different properties.

## 3. Current state

### 3.1 On `main` (implemented)

**There is no variety entity.** A "Sorte" in the public library is a
`PublicCrop` row whose `variety` is not blank. A row with a blank `variety`
is the general entry of a crop species ("Kultur").

| Concern | Where | Behaviour |
| --- | --- | --- |
| Storage | `backend/farm/models/crops.py` → `PublicCrop.variety` (`CharField(200)`), `variety_normalized` (trim, collapse whitespace, lower-case) | One name, no language. |
| Language data on an entry | `PublicCropTranslation` (same file): `(public_crop, language_code)` unique, holds only `description` | The variety name stays on `PublicCrop` by design. |
| Language codes | `CharField(max_length=10)` with **no DB choices**. Serializers validate against `config.languages.SUPPORTED_LANGUAGE_CODES` (`normalize_language_tag`). | The pattern every new table copies. |
| **Structured variety traits** | — | **None.** `PublicCrop` carries only cultivation data: durations, spacings, seed rates, `harvest_method`, `cultivation_types`, `expected_yield`, `nutrient_demand`, `crop_family`. `display_color` is a UI colour for the planning views, not a fruit colour. `CropSpecies.categories` is species-level. |
| **Photos** | private `Crop.image_file` → `MediaFile` (`farm/models/projects.py`, **project-scoped**); upload pipelines in `farm/image_processing.py` (note images re-encoded, size and pixel caps) | **No image on `PublicCrop`.** |
| Display | `PublicCrop.display_name()` (species name only); frontend `crop-library/publicCropDisplay.ts` → `getPublicCropTitle()` builds `Species (variety)`; `crops/cropHierarchy.ts` uses `crop.variety` as the variety row label | |
| Search | `crops/services.py` → `build_public_crop_search_query()` (`variety__icontains` plus species names and aliases); `?variety=` in `PublicCropViewSet.get_queryset()` / `list_published_crops()`; frontend `crops/publicCropSearchMatch.ts` | No diacritic folding in the backend. |
| Duplicate detection | `farm/services/public_crops.py` → `detect_public_crop_duplicates()` (publish check, at most 5 candidates), `find_public_crop_identity_conflict()` (rename, relink); `crops/services.py` → `find_exact_crop_match()` (`/match/`) | Identity = species (or legacy name) + **exact** `variety_normalized`. Nothing fuzzy for varieties. Species have trigram search (`pg_trgm`, `crops.0017`). |
| How the wizard finds an existing variety | `pages/CropsPublishingWizardDialog.tsx`: loads the species' entries with `publicCropAPI.list({q: species})` and preselects the one whose normalized variety equals the local one. A blocking duplicate offers "Mit diesem Eintrag verknüpfen". | Exact spelling only. `Poire jaune` never finds `Gelbe Birne`. |
| Linking and sync | `POST /api/crops/{id}/link-public-crop/` → `link_project_crop_to_public_reference(pull_fields=…)`; `GET/POST …/public-sync/` → `sync_crop_with_public_entry()`; shared per-field `PublicCropSyncPanel`; `CropForm.tsx` `linkLibraryEntry()` / `crops/libraryLink.ts` (see [crop-library-architecture.md](./crop-library-architecture.md) §7 "Field-by-field sync") | `variety` is a compared field. A foreign `variety` is never pushable and is forced to the library side, so linking a private `Poire jaune` to `Gelbe Birne` would rename the private variety. That conflicts with decision 8. |
| The 4-case update model | `resolveCropLibraryAction` and `public_publish_blocked_reason` (crop-library-architecture.md §0): case 1 not linked → share; case 2 library ahead → pull ("Kultur aktualisieren"), 2b rejected update, 2c own proposal pending; case 3/4 local changes → push ("Bibliothek aktualisieren"); case 5 aligned → "Aktuell" | Baseline = `source_public_version`. `has_pending_public_crop_update()` ignores version bumps that change no compared field. |
| History and revert | `PublicCropRevision` snapshots of `PUBLIC_CROP_EDITABLE_FIELDS`; `restore_public_crop_version()`; `POST …/revert/` | Renaming or restoring `variety` is admin- or publisher-only. **Description translations are unversioned.** |
| Report | — | **No report function** on `main`. |
| Merge | — | **None.** A duplicate can only be *removed* (`REMOVAL_REASON_DUPLICATE`); its linked private crops, discussions and history stay on the removed entry. The closest precedent is the moderator species relink (`relink_public_crop_species()`, `PublicCropSpeciesRelinkRequest`), which notifies the members of every affected project (`TYPE_CROP_SPECIES_REASSIGNED`). |
| Moderation routing | `farm/crops/moderation.py` → `requires_moderation_queue()`: API tokens and `new`-trust session users are queued as `PublicCropChangeProposal` | The description `translations` action does not route through it. |
| Tokens | `ProjectApiToken` may call `publish_public` on `CropViewSet` (always queued); `link-public-crop` and `public-sync` are session-only. `CropLibraryApiToken` (`ofp_clt_`) reaches only `CropSpeciesViewSet` / `PlantFamilyViewSet`. | |

### 3.2 On the branch of OpenFarmPlanner/planner#806 (implemented, not merged)

Part A, backend only:

- **Model:** `PublicCropTradeName` (one per entry and language,
  `name_normalized` folded per [search.md](./search.md) including `œ`/`æ`,
  optional `source_url`) and the append-only `PublicCropTradeNameEvent`
  (migration `farm.0115`); `PublicCropReport` (`farm.0116`); notification
  `public_crop_trade_name_reported` (`notifications.0007`).
- **Read API:** `variety_trade_name`, `variety_display` and `trade_names` on
  `/api/public-crops/` and `/api/crop-library/`.
- **Search and identity:**
  - Search matches trade names in every language.
  - Duplicate detection, `/match/` and identity conflicts (rename, restore,
    relink) match a variety by its original name or any trade name, and
    candidates report `matched_trade_name`.
  - A rename that invalidates a trade name removes it.
- **Write API:** `GET`/`PUT …/trade-names/`, `…/trade-names/history/`,
  `…/history/{event}/revert/`, `POST …/reports/`, and the moderator-only
  `GET /api/public-crops/reports/` and `…/reports/{id}/resolve/`.
  - Live for every signed-in session user, `new` accounts included (D4).
  - Guest demo users and API tokens are refused.
  - Throttles: `public_crop_trade_name_write` (30/h) and
    `public_crop_report` (20/h).
- **Shared code:** `farm/services/public_crop_trade_names.py`,
  `farm.utils.normalize_search_text`.

**Not on the branch yet:**

- the frontend;
- the sync rule that keeps a private variety matching a trade name from
  being renamed (§9.4);
- search aliases in the same language (§4.1.2);
- any part of B.

### 3.3 Only in design documents

[`public-crop-library-data-model.md`](./public-crop-library-data-model.md)
§2 plans a `CropVariety` entity ("`variety_name` stored once, not
translated") and a `CropTranslation` table. Neither exists, and this RFC
does not depend on them. Every new table here hangs off `PublicCrop`, so it
moves to `CropVariety` in one foreign-key migration if that entity ever
comes. An unauthenticated public `/crops` route is also "not done", so there
is no SEO impact.

### 3.4 Discrepancies noted in passing

- `i18n.md` §4 used to claim that duplicate detection includes "the
  supplier". The code never did. Corrected on the branch.
- The backend's `variety__icontains` and species search do not fold
  diacritics, which `search.md` requires. Trade names fold; bringing the
  original-name search up to the same rules is pre-existing debt.

## 4. Data model

### 4.1 Trade names

#### 4.1.1 Options (decided: A)

- **A. Dedicated table `PublicCropTradeName`** (chosen and built).
  - Pros:
    - It is a market fact, not a translation, and the model says so.
    - It has its own permission rule and its own history, without bumping
      `PublicCrop.version`.
    - One indexed `name_normalized` serves both search and identity.
    - It moves to `CropVariety` with one foreign-key change.
  - Cons: one more table and one more prefetch.
- **B. Fields on `PublicCropTranslation`.**
  - Pros: no new table.
  - Cons:
    - A row would no longer mean "a description exists", which breaks
      `descriptions_by_language()`, the "at least one description" rule and
      the "no empty rows" migration rule.
    - A blank description PUT would delete the trade name.
    - It suggests the trade name is a translation.
- **C. A JSON field on `PublicCrop`.**
  - Pros: gives `PublicCropRevision` history for free.
  - Cons:
    - Every edit bumps `version`, so anyone editing the entry gets
      `base_version` conflicts.
    - A revert rolls back unrelated edits made since.
    - The JSON cannot be indexed portably, and there is no per-language
      attribution.

#### 4.1.2 Extension needed for B: search aliases

Decision 11 turns a merged-away name in the same language as an existing
trade name into a **search alias**. Spelling variants (`Yellow Pear Tomato`,
`Black-Krim`) need the same thing. Today there is exactly one name per
language, so there is nowhere to store an alias.

| Option | Pros | Cons |
| --- | --- | --- |
| **A. `kind` column on `PublicCropTradeName`** (`trade_name` / `alias`); one `trade_name` per language through a partial unique constraint, any number of aliases (recommended) | One table, one index, one history, one search and identity path; the existing services take a `kind` argument | The table name says "trade name" for aliases too; since #806 is unmerged, it can still be renamed to `PublicCropVarietyName` at no cost |
| B. Separate `PublicCropVarietyAlias` table | Clear separation | A second identity source to keep in step in every lookup in §3.2 |
| C. `aliases` JSON list on the trade-name row | Small | Ties an alias to an existing trade name in that language; not indexable |

**Recommendation: A**, folded into the not-yet-merged migration `farm.0115`
if #806 has not shipped by then. Aliases are never displayed, search and
identify like trade names, and are edited in the same dialog under
"Weitere Namen (nur für die Suche)".

### 4.2 The match key (comparison only)

Decision 10 asks for a normalisation that is robust but used **only for
comparison**. Proposal: a function `variety_match_key(name, species)` and an
indexed, non-editable column `match_key` on `PublicCrop` (for the original
name) and on `PublicCropTradeName` (trade names and aliases).

1. Fold as in `search.md`: lower case, `ß`→`ss`, `œ`/`æ`→`oe`/`ae`,
   diacritics removed.
2. Remove punctuation, hyphens, apostrophes and all whitespace:
   `Black-Krim` → `blackkrim`.
3. Drop marker tokens before joining:
   - `f1`, `f2`, `hybrid`, `hybride`, `híbrido`;
   - `bio`, `organic`;
   - generic words: `sorte`, `variety`, `variété`, `variedad`;
   - **every name of the entry's species** in any language (its common
     names, synonyms and regional names): `Tomate Gelbe Birne` → `gelbebirne`.
4. Never shown and never written back to a display name.

A key that becomes empty after step 3 (a variety called `F1`) falls back to
the folded name without step 3.

### 4.3 Traits (decision 9)

Traits differ by species: fruit colour means something for tomatoes and
squash, but nothing for lettuce. We still do not want a schema per species.

| Option | Pros | Cons |
| --- | --- | --- |
| A. Columns per trait on `PublicCrop` | Simple queries | One migration per new trait, empty columns for every other species. Rejected. |
| B. Free-text tags | No catalogue | Language-dependent and unmatchable, which defeats the purpose. Rejected. |
| C. A `traits` JSON field on `PublicCrop`, validated against a catalogue | One field, revisions include it for free | No referential integrity; filtering needs JSON operators that differ between SQLite (tests) and PostgreSQL; renaming a value key means rewriting JSON |
| **D. A curated catalogue plus one row per assigned value** (recommended) | Values are foreign keys (integrity, `PROTECT`); filtering is an indexed join; labels are translated once; one catalogue serves several species | Three small tables; the revision snapshot has to serialise the assignment explicitly |

Recommended model (D):

```
VarietyTrait                     curated, language-independent
  ├─ key                         "fruit_color" (stable, never rendered)
  ├─ selection                   single | multiple
  ├─ is_key_trait                bool: used for "defining" checks (§8)
  ├─ sort_order
  ├─ species                     M2M → CropSpecies (one trait, several species)
  └─ VarietyTraitTranslation     (trait, language_code) unique → label

VarietyTraitValue
  ├─ trait → VarietyTrait
  ├─ key                         "yellow"
  ├─ sort_order
  └─ VarietyTraitValueTranslation (value, language_code) unique → label

PublicCropTraitValue             one row per assigned value
  ├─ public_crop → PublicCrop (variety entries only)
  ├─ trait → VarietyTrait        (denormalised for the unique check)
  └─ value → VarietyTraitValue   PROTECT
     unique (public_crop, value); a single-selection trait allows one row
```

- Language codes are `CharField(10)` without choices, validated like every
  other translation.
- Labels use the existing fallback chain (§6.1). A label that is missing in
  the UI language shows the English one with no chip, because labels are UI
  vocabulary, not content.
- **Maintenance:** like `PlantFamily`. The catalogue is seeded once by a
  migration (structural reference data, not crop names) and edited in the
  Django admin. Later edits can come through the `CropLibraryApiToken`
  surface. Users never create traits or values; a missing value is reported
  through feedback.
- Traits are **entry content**, like spacings: they belong in the revision
  snapshot and follow the normal edit rules (§10), not the unmoderated
  trade-name rule.

### 4.4 Initial traits

The catalogue attaches to the species that exist in the library (the frozen
starter set has `Tomate`, `Salat`, `Kürbis`, `Grüne Bohne`; live data adds
`Buschbohne` and `Stangenbohne`). Key traits (`is_key_trait`) are in bold.

| Species | Traits (values) |
| --- | --- |
| Tomate | **Fruchtfarbe** (rot, rosa, gelb, orange, grün reif, braun/schwarz, weiß/creme, mehrfarbig/gestreift; multiple) · **Fruchtform** (rund, flachrund/gerippt, oval/Pflaume, birnenförmig, herzförmig, länglich/spitz) · **Größenklasse** (Cocktail < 30 g, Salat 30–150 g, Fleisch > 150 g) · Wuchsform (unbegrenzt/Stab, halbbegrenzt, Busch, hängend/Ampel) |
| Grüne Bohne, Buschbohne, Stangenbohne (shared) | **Hülsenfarbe** (grün, gelb/Wachs, violett, gesprenkelt) · **Hülsenform** (rund/Filet, flach/breit) · Samenfarbe (weiß, schwarz, braun, gesprenkelt, mehrfarbig) · Fädigkeit (fadenlos, fädig). The growth habit is a species distinction here (`crop-taxonomy-guidelines.md` §2), not a trait. |
| Salat | **Typ** (Kopf/Butterhead, Batavia, Eisberg, Romana/Lattich, Eichblatt, Lollo, Pflück/Schnitt) · **Blattfarbe** (grün, rot, rot gesprenkelt/zweifarbig) · Blattrand (glatt, gewellt, gekraust/gelappt) · Anbausaison (Frühjahr/Herbst, Sommer/schossfest, Winter; multiple) |
| Kürbis | **Botanische Art** (C. pepo, C. maxima, C. moschata) · **Schalenfarbe** (orange, rot, grün, grau/blau, weiß/creme, gelb, mehrfarbig) · **Fruchtform** (rund, flachrund, birnenförmig, länglich/Flasche, Turban) · Größenklasse (Portion < 1 kg, mittel 1–5 kg, groß > 5 kg) · Wuchs (rankend, kompakt/Busch) · Schale essbar (ja, nein) |

The numeric fields that already exist (`growth_duration_days`,
`harvest_method`) are used as weak signals in §8 and need no trait.

### 4.5 Photos: later, not in this RFC's phases

Photos would help recognition, but none of the following is in place:

- **Licence:** library content is CC BY-SA. A photo needs the uploader's own
  licence grant and attribution, and it may only be someone else's catalogue
  image.
- **Storage:** `MediaFile` is project-scoped and covered by project quotas.
  Public media needs a different owner, quota and deletion lifecycle, for
  example when an account is deleted.
- **Moderation:** image abuse is harder to spot than text, and personal
  data can sit in the image itself. The note pipeline re-encodes and strips
  metadata, but cannot judge content. That argues for pre-moderation of
  images, which decision 6 deliberately avoids for text.

**Recommendation:** traits and descriptions are enough for v1 recognition.
Photos get their own RFC once the merge and moderation flows exist.

## 5. API changes (all additive)

### 5.1 Read

- **Entries** (`/api/public-crops/`, `/api/crop-library/`): besides the
  fields shipped in §3.2, add:
  - `variety_aliases`: `{language_code: [name, …]}`;
  - `traits`: `[{trait, value, trait_label, value_label}]`, labels in the
    request language;
  - `merged_into`: id or `null`, for removed entries only (§11).
- **Trait catalogue:** `GET /api/crop-library/variety-traits/?crop_species=<id>`
  returns traits and values with resolved labels and all translations.
  Unpaginated (small), like plant families.
- **Variety list filter:** `GET /api/public-crops/?crop_species=<id>&trait=fruit_color:yellow&trait=fruit_shape:pear`.
  - Several `trait` parameters combine with AND.
  - Several values of one trait combine with OR, which matches the
    filter rules of `search.md`.
- **Variety candidates** (used by the wizard and by linking):
  `POST /api/crops/{id}/variety-candidates/` with `{crop_species,
  variety_name, traits?}`.
  - Returns at most 5 candidates (§8). Each has the entry, `score`,
    `reasons` (`name_exact` / `name_similar` / `trait_match`,
    `matched_name` with its language, matching and conflicting traits) and
    its description resolved like the library.
  - Read-only, so a POST only to carry the trait list.
  - Reachable for session users and for `ProjectApiToken` with read scope,
    because tokens already publish (queued) and should avoid duplicates too.

### 5.2 Write

- **Trade names:** shipped (§3.2). They gain `kind` once §4.1.2 is
  accepted: `PUT …/trade-names/` additionally takes
  `aliases: {language_code: [name, …]}`, which replaces the aliases of the
  languages it names.
- **Traits:** `PUT /api/public-crops/{id}/traits/` with `{traits: [value_key,
  …], base_version}`.
  - Validated against the species' catalogue.
  - Goes through the same direct-edit and queue routing as other entry
    fields, records a `PublicCropRevision`, and bumps `version`.
  - The publish payload (`publish-public`) takes `traits` too, so a new
    variety can be published with them.
- **Confirmed match** (decision 10): `POST /api/crops/{id}/link-public-crop/`
  gains an optional `confirmed_variety_name: {language_code, name}`. In the
  same transaction as the link it:
  1. stores the name as a trade name in that language, or as an alias if
     the language already has a different trade name or the name equals one
     already stored (§9.2);
  2. records the event with `origin = "variety_match"`;
  3. leaves `Crop.variety` unchanged.

  The existing body (`pull_fields`) keeps its meaning. Without the new field
  nothing changes.
- **Negative decision** ("Nein, eigene Sorte"):
  `POST /api/crops/{id}/variety-candidates/dismiss/` with
  `{public_crop_ids}`. The crop stops offering those candidates, and the
  pair is remembered for merge warnings (§11.4).
- **Merge** (§11):
  - `POST /api/public-crops/{id}/merge/` with `{into, resolutions}` creates
    a `PublicCropMerge`;
  - `GET /api/public-crop-merges/?status=pending` lists them;
  - `POST /api/public-crop-merges/{id}/confirm/` and `…/reject/` decide
    one;
  - `POST /api/public-crop-merges/{id}/revert/` undoes one.

`farm/tests/test_public_api_schema.py` and the OpenAPI references are
updated with each phase. Existing fields keep their meaning: `variety` is
always the original name, and the identity rule stays (§9.1).

## 6. Display and search rules

### 6.1 Display

1. With a trade name in the UI language: `«trade name» («original»)`.
   Without one: the original alone, with no chip. Never another language's
   trade name. Aliases are never displayed.
2. In combined strings (D2): `Tomate · Poire jaune (Gelbe Birne)` for an
   entry with a displayed trade name; every other title keeps
   `Tomate (Moneymaker)`.
3. Trait values are shown as their translated labels, never as keys. The
   description keeps its existing fallback with the "Nur auf … verfügbar"
   chip (i18n.md §3).
4. One helper on each side (backend `variety_display()`, frontend
   `getPublicCropVarietyLabel()`), so no surface formats names on its own.

### 6.2 Surfaces

| Surface | Change |
| --- | --- |
| Library list and hierarchy (`PublicCropHierarchyList.tsx`, `cropHierarchy.ts`) | Variety rows use §6.1, sorted by the displayed label on the client; trait chips under the label (key traits only). |
| Library: species view → variety list (new, §7.1) | Trait filters, result count, compare cards. |
| Library detail (`PublicCropLibraryPage.tsx`) | Header and "Sorte" row use §6.1. New blocks: "Handelsnamen" (edit dialog, history, report; phase 1), "Merkmale" (phase 3), "Ist das dieselbe Sorte wie …?" (merge start; phase 4). |
| Library picker and mobile selector (`PublicCropLibraryDialog.tsx`, `PublicCropMobileSelectorDialog.tsx`) | Labels per §6.1. Search covers trade names and aliases. |
| Publish wizard (`CropsPublishingWizardDialog.tsx`) | The "existing variety" picker uses §6.1. A new suggestion step (§7.2) sits between choosing the species and the duplicate gate. An optional "Merkmale" step comes from phase 3. |
| Linking (`CropForm.tsx` `linkLibraryEntry()`, the wizard's "Mit diesem Eintrag verknüpfen", `ImportConflictDialog.tsx`) | The same suggestion dialog when the typed variety does not match exactly; the sync rule of §9.4. |
| Import into a project (`import_to_project`) | Copies the original name into `Crop.variety` (decision 8). |
| Project crop form autocomplete (`usePublicCropSuggestions.ts`) | Options per §6.1. Picking one writes the trade name (D3). |
| Anbaupläne, Saatgutbedarf and other project views | Show `Crop.variety` verbatim. The read-only trade-name display for linked crops (D1) is a later phase (§13). |
| Moderation page (`PublicLibraryModerationPage.tsx`) | Report queue (phase 1), merge queue and history (phase 4). |
| Notifications | Trade-name report (shipped), merge pending, confirmed and reverted (phase 4). |

### 6.3 Search

- Text search (`q`, `variety`, client-side `publicCropMatchesSearchQuery()`)
  covers original names, trade names and aliases in every language, folded
  per `search.md`.
- A hit that came only through a trade name or alias of another language is
  reported like a synonym hit, for example "Treffer: Poire jaune (fr)".
- Trait filters are not text search. They live in the variety list (§7.1)
  and as `trait=` parameters.

## 7. Flows and wireframes (text)

### 7.1 Variety list with trait filter

Entry point: in the library, a species node ("Tomate") has a new
"Sorten vergleichen" action, which links to
`/app/crop-library?cropSpecies=<id>&view=varieties`.

```
┌ Tomate – Sorten (128) ───────────────────────────── [Suche in Sorten …] ┐
│ Fruchtfarbe:  [rot] [gelb ✓] [orange] [schwarz] … (+3)                  │
│ Fruchtform:   [rund] [birnenförmig ✓] [herzförmig] …                    │
│ Größe:        [Cocktail] [Salat] [Fleisch]         [Filter zurücksetzen]│
├─────────────────────────────────────────────────────────────────────────┤
│ Poire jaune (Gelbe Birne)          gelb · birnenförmig · Cocktail       │
│   Unbegrenzt · 75 Tage · „Kleine birnenförmige …"  [Nur auf Deutsch]    │
│   In 14 Projekten verwendet                     [Ansehen] [Übernehmen]  │
│ Yellow Pear Tomato                 gelb · birnenförmig · –              │
│   …                                                                     │
├─────────────────────────────────────────────────────────────────────────┤
│ 2 Sorten · Sorten ohne Angabe zu einem Filter werden mit angezeigt [an] │
└─────────────────────────────────────────────────────────────────────────┘
```

- Varieties with no value for a filtered trait are hidden by default. A
  toggle shows them, because unknown is not the same as different.
- The empty state suggests clearing a filter, and as a last step "Neue
  Sorte veröffentlichen".
- Mobile: the filters open in a bottom sheet; the cards stack; the actions
  sit in a card menu (no hover).

### 7.2 Suggestion dialog when publishing or linking

Trigger: the wizard has a species and a variety name. Neither the name nor
any trade name or alias matches exactly, and the candidates endpoint returns
at least one candidate. An exact identity match still goes to the existing
duplicate gate.

```
┌ Gibt es diese Sorte schon? ─────────────────────────────────────────────┐
│ Du veröffentlichst „Poire jaune" (Tomate). Diese Sorten sind ähnlich:   │
│                                                                         │
│ ○ Gelbe Birne                                    sehr ähnlich           │
│   gelb ✓ · birnenförmig ✓ · Cocktail ✓ · Wuchs: unbegrenzt (bei dir –)  │
│   „Kleine birnenförmige Früchte …"  [Nur auf Deutsch]   [Eintrag öffnen]│
│ ○ Yellow Pear Tomato                             ähnlicher Name         │
│   gelb ✓ · birnenförmig ✓ · Größe: Salat ✗ (bei dir Cocktail)           │
│                                                                         │
│ ℹ Wenn du eine Sorte wählst, wird „Poire jaune" dort als französischer  │
│   Handelsname eingetragen und deine Kultur damit verknüpft. Dein        │
│   Sortenname in deinem Projekt bleibt „Poire jaune".                    │
│                                                                         │
│            [Nein, das ist eine eigene Sorte]   [Ja, dieselbe Sorte →]   │
└─────────────────────────────────────────────────────────────────────────┘
```

- **"Ja"** requires a selected candidate. The dialog then switches to the
  existing link confirmation with the per-field `PublicCropSyncPanel` (link
  mode) and the existing "Verknüpfen" button.
  - Only that final confirm writes anything: the link, the pulled fields
    and the trade name or alias, in one transaction (§5.2).
  - The pushed fields follow in the existing second step.
- **"Nein"** dismisses the shown candidates for this crop and continues to
  the normal publish.
- Closing the dialog changes nothing.
- The reason line names what matched: "ähnlicher Name", "gleiche Merkmale",
  or both.
- Mobile: full-screen dialog; one candidate per card; buttons stacked, with
  the primary action last.
- In the link flows the text reads "Du verknüpfst …" and the "Nein" branch
  leaves the crop unlinked.

### 7.3 Merge

Entry point: the library detail of entry X → overflow "Ist dieselbe Sorte wie
…" → a picker limited to the same species, using the candidates logic with X
as the source. The flow has three steps.

**Step 1 — "Welche Sorte bleibt?"** The default survivor is the entry with
more linked projects. The user can swap. The dialog shows what moves:
"14 + 3 Projekte werden auf Gelbe Birne verknüpft."

**Step 2 — conflicts, which must all be decided.**

```
│ Unterschiedliche Werte              Gelbe Birne   Yellow Pear Tomato │
│ Kulturdauer (Tage)                  ● 75          ○ 80               │
│ Größenklasse                        ● Cocktail    ○ Salat            │
│ Beschreibung (Englisch)             ○ „…"         ● „…"              │
│ Beschreibung (Deutsch)              ● „…"         (keine)            │
```

- Every differing entry field, trait and same-language description is one
  row with radio choices and no preselection. "Weiter" stays disabled until
  every row is decided.
- Values only one side has are listed as "wird übernommen", with no choice
  needed.

**Step 3 — names and effect.** "„Yellow Pear Tomato" wird englischer
Handelsname von Gelbe Birne" (or an alias, if English already has a trade
name). Then the safeguard of §11.2, for example: "Wird wirksam, sobald ein
zweites Konto bestätigt. Betroffene Projekte werden benachrichtigt."

## 8. Similarity logic

### 8.1 Signals and weights

Candidates come only from **published variety entries of the same species**
(identity is per species).

| Signal | How | Weight |
| --- | --- | --- |
| Name exact | The match key (§4.2) of the input equals the key of a candidate's original name, any trade name or any alias | sets name similarity = 1.0 |
| Name similar | PostgreSQL `word_similarity()` (pg_trgm, already enabled) of the folded input against each name of the candidate; the best value counts | `N` ∈ [0, 1] |
| Traits | For each trait both sides have: agree = +1, disagree = −1, a key trait counts double; `T` = sum ÷ maximum possible, mapped to [0, 1]; traits unknown on either side do not count | `T` |
| Numeric | `growth_duration_days` within 15 % → 1, otherwise 0; same `harvest_method` → 1 | `M` ∈ [0, 1] |

`score = 0.55·N + 0.35·T + 0.10·M`. When the input has no traits (phase 2,
or traits skipped), the formula is `score = 0.85·N + 0.15·M`.

Veto: a **conflict on a key trait** caps the score at 0.4, unless the name
is exact. This keeps `Yellow Pear` from being proposed for a red pear tomato
of a similar name.

Trait-only candidates (no name similarity at all, the core cross-language
case) qualify only with **at least 3 matching traits, 2 of them key traits,
and no key-trait conflict**.

### 8.2 Threshold and count

- Shown when `score ≥ 0.6`, labelled "sehr ähnlich" from 0.8.
- Between 0.45 and 0.6, shown only while fewer than 3 candidates are above
  0.6, labelled "möglicherweise".
- **At most 5 candidates**, the same cap as `detect_public_crop_duplicates()`.
  Ties are ordered by the number of linked projects, then by the latest
  publication.
- The thresholds are starting values. Every suggestion outcome (shown,
  accepted, dismissed, with the score) is logged without personal data, so
  the thresholds can be recalibrated after a few months.

### 8.3 Performance

Tomato will be the largest species, with possibly thousands of varieties.
The query runs in two stages:

1. **SQL pre-filter**, limited to `crop_species_id` and `status=published`
   (indexed):
   - `match_key = input key` on `PublicCrop` or `PublicCropTradeName`
     (B-tree index);
   - **or** the trigram `%` operator on the folded names (GIN `gin_trgm_ops`
     index on `PublicCropTradeName.name_normalized` and on a folded
     original-name column, the same migration pattern as `crops.0017`);
   - **or**, with traits given, at least 3 matching `PublicCropTraitValue`
     rows (a `GROUP BY` on the indexed `(value_id, public_crop_id)` pair).
   - At most 200 rows.
2. **Scoring in Python** over those rows, with their names, traits and
   descriptions prefetched in a constant number of queries.

Target: under 150 ms at p95 for 5000 varieties of one species. The query
count is pinned by a test that does not grow with the candidate count. The
SQLite test database falls back to the folded-substring prefilter, like
`_score_crop_species_fallback`.

## 9. Effect on duplicate detection, the publish flow and the 4-case model

### 9.1 Identity stays the record

The identity is still `PublicCrop`: species plus original
`variety_normalized`. Trade names and aliases are lookup keys into it
(§3.2). The **blocking** duplicate gate stays exact: original name, trade
name or alias, by the shallow or the folded form.

The suggestion of §8 is a **non-blocking** layer in front of it. It never
prevents a publish; it only asks.

### 9.2 Publish flow

1. Species and variety name are known.
2. If the name identifies an entry exactly, the existing blocking duplicate
   gate offers "Mit diesem Eintrag verknüpfen" (today's behaviour, now also
   through trade names and aliases).
3. Otherwise the candidates endpoint is called.
   - With candidates: the dialog of §7.2.
   - "Ja": the link flow with `confirmed_variety_name`.
   - "Nein": dismiss, then publish.
4. Publish as before, from phase 3 with the optional traits step.

**Where the confirmed name goes** (`confirmed_variety_name`):

- the language has no trade name → it becomes the trade name;
- the language has a different trade name → it becomes an alias (the
  existing trade name is not overwritten, because that would be a silent
  edit of someone else's name);
- the name is already there → nothing is stored.

The language is the user's UI language, shown in the dialog text, and can
be changed in the dialog. A user may type a German variety name in a French
UI.

The name never becomes a trade name of the entry's original language when it
only differs from the original by its match key. In that case it is an
alias.

### 9.3 Duplicate cleanup

The publish flow can no longer dead-end on a trade-name conflict. Today
`PUT …/trade-names/` answers `409 trade_name_conflict` when the name already
identifies another entry. From phase 4, the dialog offers "Diese beiden
Einträge zusammenführen?" there.

### 9.4 The 4-case update model

- **Linking via a confirmed match** uses `link_project_crop_to_public_reference`
  with `pull_fields`. The baseline is the entry's current version, so the
  crop lands in case 3/4 or case 5 exactly as today.
- **Sync of `variety`.** When the private `variety` matches the entry's
  original, a trade name or an alias (by match key), `variety` is **not a
  compared field**. The sync then neither pulls `Gelbe Birne` into a private
  `Poire jaune` nor offers a rename push.
  - Implemented in `_sync_compared_fields()` /
    `public_crop_field_changes()`, next to the existing general-entry
    exemption.
  - Needed for decision 8 from phase 1 on, and missing on the branch (§3.2).
  - Without it, every confirmed match would leave a permanent "Bibliothek
    aktualisieren" or a forced rename.
- **Trade names, aliases and dismissals** do not bump `PublicCrop.version`,
  so they never trigger case 2 anywhere.
- **Traits** are entry content and bump the version. Private crops have no
  traits, so traits are not a compared field and
  `has_pending_public_crop_update()` stays false for a traits-only edit.
- **Merge:** every private crop linked to the merged-away entry gets
  `source_public_crop = survivor` and keeps its own values (§11.3). Its
  baseline is withheld (`source_public_version = None`, the existing "link
  without baseline" state), so it lands in **case 2** ("Kultur
  aktualisieren"). The project sees the difference and decides per field;
  nothing is overwritten.
  `derived_from_public_crop` keeps pointing at the original source
  (provenance invariant 7 of the state matrix).

## 10. Permissions and safeguards

| Action | Established session | `new` session | Guest demo | `ProjectApiToken` | `CropLibraryApiToken` |
| --- | --- | --- | --- | --- | --- |
| Trade names and aliases: edit, revert (decision 6, D4) | live | live | ✗ | ✗ | live (phase 1b, §12) |
| Report a trade name | ✓ | ✓ | ✗ | ✗ | ✗ |
| Edit traits | live (revision) | queued as `PublicCropChangeProposal` | ✗ | queued | ✗ in v1 |
| Variety candidates (read) | ✓ | ✓ | ✓ | ✓ (read) | ✗ |
| Confirm match (`confirmed_variety_name`) | ✓ | ✓ (only adds a trade name or alias, D4) | ✗ | ✗ (`link-public-crop` stays session-only) | ✗ |
| Propose a merge | ✓ | ✓ (needs confirmation in any case) | ✗ | ✗ | ✗ |
| Confirm a merge | ✓, if not the proposer and not a member of the same projects | ✗ | ✗ | ✗ | ✗ |
| Revert a merge | proposer, confirmer, moderators | proposer | ✗ | ✗ | ✗ |
| Reject a pending merge | moderators, and the publishers of either entry | ✗ | ✗ | ✗ | ✗ |

Throttles:

- the existing `public_crop_trade_name_write` (30/h) and
  `public_crop_report` (20/h);
- new: `public_crop_merge_propose` (5 per day per user);
- `public_crop_merge_confirm` (20 per day per user).

Merges also respect the standing-backlog cap (at most 20 pending merges per
proposer, like `PUBLIC_CROP_MAX_PENDING_PROPOSALS_PER_USER`).

## 11. Merging afterwards

### 11.1 What a merge does

1. **Survivor S and merged-away entry M**, same species, both published,
   both variety entries.
2. **Conflicts** (§7.3) are decided field by field. Values only M has are
   copied to S. Descriptions in languages S lacks are added. Traits only M
   has are added. A trait both sides have with different values is a
   conflict to decide.
3. **Names:**
   - M's original name becomes a trade name of S in M's
     `original_language_code`, or an alias if that language has a trade name
     or the name equals S's original by match key.
   - M's trade names and aliases join S the same way.
4. **Links:** every `Crop` with `source_public_crop = M` moves to S, as in
   §9.4.
5. **M** becomes `status = removed`, `removal_reason = duplicate`,
   `merged_into = S`. A request for M points to S.
6. **Discussions** move to S, and the topic shows "aus Yellow Pear Tomato
   übernommen". M's revision history stays on M, readable through the merge
   record.
7. A **`PublicCropMerge`** record keeps everything needed to undo the merge:
   - S's snapshot before the merge;
   - the ids of the moved crops, topics and created names;
   - the conflict choices;
   - proposer, confirmer, status (`pending` / `applied` / `reverted` /
     `rejected`) and timestamps.
8. **Notifications** go to the members of every project with a moved link
   (as `TYPE_CROP_SPECIES_REASSIGNED` does for relinks), and to both
   publishers.

### 11.2 Safeguard: comparing (a) and (b)

| | (a) Second confirmation | (b) Immediate, fully reversible |
| --- | --- | --- |
| A wrong merge reaches other projects | Only after a second person agrees | At once; the projects see case 2 and a notification |
| Cost of a mistake | Low: nothing moved | Medium: notifications already sent, and a project may already have pulled values from S in the meantime; a revert then has to explain why its link moves back |
| Waiting time | Until someone confirms; with low merge volume, a queue on the moderation page plus a notification to the publishers is enough | None |
| Abuse resistance | Sock puppets need two established accounts that share no project | One `new` account can move many links before anyone notices (the throttle limits, but does not prevent) |
| Complexity | A pending state, a queue, and expiry (proposals expire after 30 days) | A full revert including links, names, descriptions and moved topics, with conflicts if S changed since |
| Revert needed anyway? | Yes, a confirmed merge can still be wrong | Yes |

**Recommendation: (a), with (b)'s revert as a second line, and one
exception.**

- **When it applies at once:** if neither entry has links from projects the
  proposer is not a member of, nobody else is affected and the merge applies
  immediately (still revertible).
- **When it waits:** in every other case a second, established account that
  is neither the proposer nor a member of the proposer's projects has to
  confirm. Moderators may always confirm.
- **Why (a):** decision 11 itself notes that a wrong merge moves other
  people's links. The volume will be small, and (a) keeps the expensive
  failure (a broadcast to projects followed by a revert) rare.
- **Revert** is available to the proposer, the confirmer and moderators for
  as long as the merge is the last structural change on S. Otherwise the
  later merges are undone first, or a moderator resolves it by hand.
  - Moved links go back to M, unless the project has unlinked or relinked
    the crop since. Those stay as they are, and the revert reports them.
  - Names created by the merge are removed.
  - Values S gained from M are rolled back from the snapshot, unless they
    were edited since. Those are listed and left.
  - M is set back to published.

### 11.3 Conflicts are never resolved silently

- Every differing entry field and trait, and every description in a
  language both entries have, is a required choice in step 2. There is no
  default selection.
- Different `crop_species` makes a merge impossible: the picker shows only
  the same species, and the backend checks again.
- Private crops are never changed by a merge. Only their link moves, and
  case 2 lets each project decide.

### 11.4 Warnings from earlier decisions

- If users dismissed the pair in the suggestion dialog ("Nein, eigene
  Sorte", §5.2), the merge dialog warns: "3 Personen haben angegeben, dass
  das verschiedene Sorten sind." A confirmer sees the same warning.
- Different values of a key trait show a warning banner too.

## 12. Starter set from `crop-data`

The starter set is written with the existing **`CropLibraryApiToken`**
(`ofp_clt_`), unchanged from the decided design:

- `PublicCropViewSet` declares
  `crop_library_token_actions = {'list', 'retrieve', 'match', 'trade_names'}`
  and adds `CropLibraryTokenAccessPermission` to its permission classes. The
  surface middleware only checks the class-level opt-in.
- The sync job resolves each variety through `/match/` and calls
  `PUT …/trade-names/` with only the languages it has a source for.
  Aliases come along once §4.1.2 exists.
- The trait catalogue can be maintained the same way once its endpoint
  exists.
- Trait *assignments* to entries are not token-writable in v1. The editorial
  trait data in `crop-data` has to be reviewed before it is pushed into
  other people's entries.

## 13. Phase plan

Each phase is useful on its own and is its own PR. Phases 1b, 2 and 4
change permission surfaces and go through the security review.

| Phase | Content | Useful on its own because … |
| --- | --- | --- |
| **1. Trade names and search** | Backend: done on the #806 branch. Remaining: aliases (`kind`, §4.1.2); the variety sync exemption (§9.4); the frontend (display, search, edit dialog with hint and source field, history, report, moderation queue) | French and Spanish users find a variety as soon as one person has entered its name. |
| 1b. Starter set | `CropLibraryApiToken` opt-in and the `crop-data` sync (§12), staging first | Many well-known names exist from day one. |
| **2. Suggestion at publish and link, names only** | Match key and index (§4.2); candidates endpoint without traits; the dialog of §7.2; `confirmed_variety_name`; dismissals; outcome logging | Catches spelling variants and every name some earlier user entered. Each confirmation adds a trade name, so the data grows from normal use. |
| **3. Traits** | Catalogue (§4.3/§4.4) and admin; trait editing on entries and in the wizard; variety list with filters (§7.1); trait scoring and trait-only candidates (§8) | Recognition without any shared name, which is the core cross-language case; browsing by properties is useful on its own. |
| **4. Merge** | `PublicCropMerge`, the dialogs of §7.3, safeguard (§11.2), revert, notifications, merge queue on the moderation page | Cleans up the duplicates that phases 1–3 could not prevent. |
| 5. Later | Read-only trade-name display on linked private crops (D1); photos (own RFC, §4.5) | |

Suggested effort: **high** for phases 2 and 4 (identity, permission
surfaces, the transactional revert), **medium** for phases 1 (frontend) and
3.

## 14. Additions to `crop-taxonomy-guidelines.md` and `i18n.md`

### 14.1 `crop-taxonomy-guidelines.md`

§5 "Varieties: one variety, several names" was added on the branch (rule of
decision 12, trade name vs. second entry, no self-translations, no type names
used for several varieties). Additions:

- **Translated names:** "Strains or populations sold under a *translated*
  name (`Cœur de bœuf` for `Ochsenherz`) are the same variety as the
  original, under the same rule: separate only when sources document
  different properties."
- **Two entries for one variety** are merged (§11 of this RFC), not
  removed. Removal with reason `duplicate` stays for test or junk entries
  that nobody links to.
- **Aliases:** spelling variants and catalogue spellings in a language that
  already has a trade name are stored as aliases, never as a second trade
  name.
- **Traits:** "Fill in only what you know from a source or from growing it.
  Leave a trait empty rather than guess. Empty does not count against a
  match, a wrong value does."
- **"Not the same variety":** when sources show different properties, say
  so in the dialog ("Nein, eigene Sorte"). The decision is recorded and
  warns later merges.

### 14.2 `i18n.md`

Already changed on the branch: the model tree, "Translatable vs. not" (trade
name as a market fact), "no fallback for trade names", the editing paragraph,
search, duplicate detection without the inaccurate "plus the supplier", API
fields, and tests. Still to change with B:

| Place | Change |
| --- | --- |
| §3 Model tree | `kind` on the trade-name row (trade name or alias); `PublicCropTraitValue` → `VarietyTrait`/`VarietyTraitValue` with translation rows |
| §3 Translatable vs. not | Trait *labels* translatable (catalogue rows); trait *assignments* language-independent |
| §3 Fallback order | Trait labels follow the standard chain without a chip (UI vocabulary); trade names still have no fallback |
| §4 Search and duplicate detection | Aliases in search and identity; the non-blocking candidate layer and its match key, explicitly not used for identity |
| §5 API | `variety_aliases`, `traits`, the candidates endpoint, `confirmed_variety_name`, merge endpoints |
| §6 Data migration | Trait catalogue seed migration |

## 15. Decisions recorded earlier (reviewed 2026-10-20) and how B affects them

| | Decision | Effect of B |
| --- | --- | --- |
| D1 | Linked private crops show the trade name of the UI language, read-only, in a later phase | Unchanged (phase 5). Open question Q1 asks whether it still holds. |
| D2 | `Tomate · Poire jaune (Gelbe Birne)` in combined titles | Unchanged |
| D3 | The project-form autocomplete writes the trade name | Unchanged; the suggestion dialog keeps the user's typed name in the same way |
| D4 | No moderation for trade names, for any account | Unchanged; also covers names created by a confirmed match. Merges are not covered (§11.2). |
| D5 | Trade-name history separate from "Versionen" | Unchanged; the merge history is a third, separate view on the moderation page and on S |
| D6 | No merge tool in this work | **Superseded by decision 11** (phase 4) |
| D7 | The publish wizard does not collect trade names | **Superseded by decision 10**: a confirmed match writes one; free entry of trade names in the wizard stays out |
| D8 | Description translations stay without history | Unchanged |
| D9 | Throttles 30/h and 20/h; glossary term `Handelsname` | Unchanged; merge throttles added (§10) |

## 16. Open questions

**Q1. Should a private crop linked to the library show the trade name of the
UI language?**

- Already decided as D1 (yes, read-only, in phase 5), with the consequence
  that two members of the same project see different names.
- Please confirm it still holds now that confirmed matches link many more
  crops whose stored name differs from the entry's original.
- *Recommendation:* keep D1, but show the label only when the stored
  `Crop.variety` is the original or a trade name, never an alias.

**Q2. Which merge safeguard: (a) or (b)?** *Recommendation:* (a) a second
confirmation, with immediate effect when no other project is affected, and a
full revert in both cases (§11.2).

**Q3. Are traits required when publishing a new variety?**

- Options:
  - optional;
  - the key traits of the species are required (two or three values);
  - all traits are required.
- *Recommendation:* **key traits required, the rest optional**, only for
  species that have a catalogue, and only for new publishes. Without key
  traits, trait-only recognition (§8.1) cannot work. More than that is a
  barrier for users who do not know, and invites guesses that are worse
  than gaps. Existing entries get a "Merkmale ergänzen" prompt, not a block.

**Q4. Aliases as a `kind` column on the trade-name table (§4.1.2)?** This
includes renaming the table to `PublicCropVarietyName` while #806 is
unmerged.

**Q5. How is the trait catalogue maintained?** *Recommendation:* seeded by
migration plus the Django admin, like `PlantFamily`. Alternatively through
the API from `crop-data`, like crop species.

**Q6. Who may confirm a merge?** *Recommendation:* any established account
outside the proposer's projects, or a moderator. Alternatively moderators
only (safer, slower).

**Q7. Should "Nein, eigene Sorte" dismissals be stored and shown to later
merges (§11.4)?** *Recommendation:* yes, counted without names.

**Q8. Is deferring photos to their own RFC (§4.5) acceptable?**

**Q9. Should trait edits by `new` accounts go through the existing queue
(recommended, because traits are entry content), or apply live like trade
names?**

## 17. What this RFC deliberately does not cover

- Translating original variety names, and any machine assistance in finding
  trade names or trait values.
- Changing private project variety names (decision 8).
- Traits on private crops. Private crops may get traits later; v1 compares
  the user's typed traits in the wizard only.
- The `CropVariety` entity; photos (§4.5).
- Bringing the backend's original-name search up to `search.md` folding,
  except where the match key needs a folded column anyway.
- Any implementation: endpoints, migrations, permission classes, UI.
