# Crop Taxonomy Guidelines

Scope: the official crop-species suggestion list — `CropSpecies` /
`CropSpeciesTranslation` in the database, which is its only source — every
moderation decision on a user-proposed species or on a name, synonym or
regional name added through the API, and the variety trade names of the
public library (§5).

This document answers one recurring question: **is this name a crop species of
its own, an alias of an existing one, or a variety?** Answer it the same way
every time, or the suggestion list slowly drifts into a mix of botanical
species, supplier categories, and regional spellings.

Terminology note: crop names in this document are given in German because that
is the canonical content language of the library (`de` is the required
translation, English is the second). The rules themselves are
language-independent.

## 1. Alias — the same crop species under a different name

Two labels mean **exactly the same product** and differ only regionally or
colloquially: same growing time, same growing method, same plant part, same
harvest method.

Examples: `Porree` = `Lauch`, `Blumenkohl` = `Karfiol`, `Erdapfel` =
`Kartoffel`.

Whether a term may become an alias is a **naming question, not a botanical
one**: being the same botanical species is not enough (see §2), and only the
"same product" test above decides.

An alias is never its own `CropSpecies` row. It resolves to the canonical
species in autocomplete, search **and duplicate detection** — that is what keeps
`Erdapfel` from being proposed and published as a second `Kartoffel`. It is
stored on the species' translation for that language, in one of two fields:

| Field | Meaning | Displayed? |
| --- | --- | --- |
| `CropSpeciesTranslation.regional_names` | region-specific term; keys limited to `crops.models.SUPPORTED_REGIONAL_NAME_KEYS` (`austria`, `switzerland`) | yes, replaces the canonical name for projects whose `Project.region` matches |
| `CropSpeciesTranslation.synonyms` | pure search alias | never |

Both are indexed for search, so either spelling finds the canonical species, and
a term may legitimately be in both lists. See §4 for which of the two a regional
term belongs in.

## 2. Own crop species — a functionally different use form

A different **use form** is its own species, even when the plants are closely
related botanically or are literally the same botanical species: a different
plant part is used, or the growing or harvest characteristics differ.

Examples:

- `Pfefferoni` — its own growing time and spacing, not identical to
  `Paprika`, and users search for it deliberately.
- `Radicchio` — its own use form despite being related to the other chicory
  types.
- `Puntarelle` — stems instead of a head, so a different harvest logic than
  `Radicchio`.
- `Schnittkohl` — repeated leaf harvest instead of a head harvest, despite
  being related to `Grünkohl`.
- `Zuckererbse` — the pod is eaten, a different use than the shelling pea
  (stored as `Erbse`).

## 3. Variety — not the crop-species level

Differences in fruit size, colour, ripening time, or growth habit **within the
same use form and harvest logic** belong on the variety level, not the
crop-species level.

Examples:

- `Cherrytomate`, `Fleischtomate` and `San Marzano` are all varieties of
  `Tomate`, not crop species of their own.
- Smooth endive (`Eskariol`/`Escariol`) and curly endive (`Frisée`) are the
  same botanical species (*Cichorium endivia*) with the same plant part, a
  single head harvest, and very similar spacing, nutrient demand, and yield.
  They are one crop species, `Endivie`; `Eskariol`, `Escariol`, `Frisée` and
  `Endiviensalat` are search aliases of it, and smooth vs. curly is a variety
  attribute. `Chicorée` (forced *Cichorium intybus*) and `Radicchio` are *not*
  part of this group — different cultivation and harvest logic — and stay
  species of their own.

Whether two variety names are one variety or two is §5.

## Rule of thumb

A crop species is the **lowest sensible category that matters for growing
planning, scheduling, and harvest logic**. If two "varieties" differ
fundamentally in growing time, harvest method, or the plant part used, they are
in fact two crop species.

## 4. Regional language variants (AT / DE / CH)

The library is used across the whole German-speaking area, and the professional
term for one crop differs between countries. `Project.region` (default:
Germany) decides which term a project sees; see
[`i18n.md`](./i18n.md) for the display contract.

Rules:

1. **One canonical `de` translation per species.** Regional terms are aliases
   of it, not separate species. The canonical name is not re-picked per region;
   the region decides only what is *displayed* on top of it.
2. **A term that is professional standard in one country goes into
   `regional_names`** under `austria` or `switzerland`, so
   projects in that region see their own term instead of the canonical one.
   Swiss terms such as `Nüsslisalat`, `Rande`, `Kabis`, `Zucchetti`,
   `Federkohl`, `Wirz`, `Rüebli`, `Krautstiel` and `Kefe` are standard in Swiss
   seed catalogues, horticultural literature and retail, not colloquialisms —
   they belong here.
3. **Everything else regional goes into `synonyms`**:
   dialect spellings, plural forms, and second names that should be findable but
   never displayed (`Erdäpfel`, `Weisskohl`, `Grundbirne`, `Möhre`).
4. **Never resolve an ambiguous term silently.** When a term denotes *different*
   crops in different regions, research it and decide deliberately. Such a term
   may become a **search alias of every species it can mean**, so the UI offers
   all of them and the user picks — but it must **never** become a displayed
   regional name, because displaying it picks one reading for the user.

   The standing example is **`Peperoni`**: in Switzerland it means `Paprika`, in
   Germany and Austria it is understood as a hot pepper, and in everyday use it
   also names the `Pfefferoni`. It is therefore seeded as a synonym of `Chili`,
   `Paprika` *and* `Pfefferoni`, and as the regional display name of none of
   them. `Fisole(n)` (AT) is handled the same way: it covers every green bean,
   so it is a synonym of `Buschbohne`, `Stangenbohne` *and* `Grüne Bohne`,
   which stay separate species because their cultivation differs.
5. A regional term for a crop species that does **not exist in the library
   yet** is a gap, not an alias. Add the species first (§2), then attach the
   regional term to it. `Kohlrübe` is the standing example: it names the swede
   (*Brassica napus*), which the library does not contain yet, so it is
   deliberately not aliased onto `Kohlrabi` — that would merge two different
   crops.

## 5. Varieties: one variety, several names

Two names denote **the same variety** when the trade lists them as the same
variety: seed catalogues, seed banks or retailers sell the one under the
other's name, or name both as equivalents. Then one public entry exists, and
the second name is a **trade name** in its language
(`PublicCropTradeName`), not a second entry. Example: `Gelbe Birne` =
`Yellow Pear` = `Poire jaune`.

Strains, selections and populations sold under the same name are **not**
split into separate entries, unless sources clearly document different
properties (for example a different ripening time, fruit colour or growth
habit). If they do, they are separate varieties with distinguishable original
names.

A trade name is entered only when the variety is actually sold under it in
that language area, preferably with a source. It is never:

- the user's own translation of the original name;
- a supplier's article title (`Tomate Poire jaune – Bio, 20 Korn`);
- a type or group name the trade uses for several different varieties in that
  language. This is the variety-level analogue of the `Peperoni` rule in §4:
  such a name stays searchable through the varieties' own names and is not
  attached to any one of them.

If a trade name in one language collides with another entry's original name in
the same species, the two entries are duplicates. Resolve them by removing one
(reason `duplicate`), not by leaving both in place. The library refuses to
store a trade name that already identifies another entry of the same species.
Design: [rfc-variety-trade-names.md](./rfc-variety-trade-names.md).

## Working on the suggestion list

- **The database is the only source.** Species names, translations, synonyms
  and regional names live in `CropSpecies` / `CropSpeciesTranslation` and are
  maintained **only through the API**:
  - `POST /api/crop-species/` proposes a new species; a moderator publishes it
    with `POST /api/crop-species/{id}/approve/` (or rejects it).
  - `PATCH /api/crop-species/{id}/` edits a species and its nested
    `translations` — `common_name`, `synonyms`, `regional_names` — and is how a
    new language is added. Moderator only.
  - Automated syncs use a crop-library API token, see
    [`crop-library-api-tokens.md`](./crop-library-api-tokens.md).
- `de` is the canonical translation; add `en` as well whenever it is known.
  For every language it sends, a `PATCH` **replaces** that translation's
  `synonyms` and `regional_names` (an omitted field is cleared), while
  languages left out stay untouched. Read the species first and send the full
  lists, or an existing alias is lost.
- Renaming the canonical name of a published species is a `PATCH` on the
  existing row — never a delete and re-create — so published crops keep their
  species link.
- Never add supplier or shop categories (`Asiatisches Blattgemüse`,
  `Gründüngung`, a plain `Bohne` or `Kohl`) as a crop species: they mix several
  species with different growing and harvest logic. Reject such proposals in
  moderation.
- **No seed file, no data migration for names.** The former
  `backend/crops/seed_data.py` was retired; its content survives only as the
  frozen bootstrap snapshot `backend/crops/migrations/data/species_bootstrap_v1.json`,
  which the historical migrations `0002`–`0015` write into a *fresh* database.
  The snapshot is never edited (a hash test enforces it) and is not read by
  application code; see the README in that directory.

## Finding gaps

`python manage.py audit_crop_species_coverage` compares the crop names used in
projects against the official list and reports three groups: names that already
resolve to a species, names with no similar species at all, and names that look
like an alias or a use-form split of an existing species. The command is
read-only and deliberately does not create anything — the last group is exactly
the set of decisions this document is for.

```
pdm run python manage.py audit_crop_species_coverage --project 1
```

Two scoping rules matter when reading the output:

- Only live projects are audited. Crops in a deactivated or soft-deleted
  project are not names anyone still uses.
- "Resolves to a species" means the library *knows* the name, which is a wider
  question than which species a user may map onto. The discouraged umbrella
  names above (`Bohne`) are excluded as mapping targets but are still part of
  the library, so they count as covered rather than as gaps.
