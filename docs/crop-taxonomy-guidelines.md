# Crop Taxonomy Guidelines

Scope: `backend/crops/seed_data.py` (the official crop-species suggestion
list), `CropSpecies` / `CropSpeciesTranslation`, and every moderation decision
on a user-proposed species.

This document answers one recurring question: **is this name a crop species of
its own, an alias of an existing one, or a variety?** Answer it the same way
every time, or the suggestion list slowly drifts into a mix of botanical
species, supplier categories, and regional spellings.

Terminology note: crop names in this document are given in German because that
is the canonical content language of the library (`de` is the required seed
translation, English is the second). The rules themselves are
language-independent.

## 1. Alias — the same crop species under a different name

Two labels mean **exactly the same product** and differ only regionally or
colloquially: same growing time, same growing method, same plant part, same
harvest method.

Examples: `Porree` = `Lauch`, `Blumenkohl` = `Karfiol`, `Erdapfel` =
`Kartoffel`.

An alias is never its own `CropSpecies` row. It is stored on the species'
translation for that language, in one of two fields:

| Field | Meaning | Displayed? | Seeded from |
| --- | --- | --- | --- |
| `CropSpeciesTranslation.regional_names` | region-specific term (`austria`, `switzerland`) | yes, to projects in that region | `CROP_SPECIES_REGIONAL_NAME_SEED_DATA` |
| `CropSpeciesTranslation.synonyms` | pure search alias | never | `CROP_SPECIES_SYNONYM_SEED_DATA` |

Both are indexed for search, so either spelling finds the canonical species, and
a term may legitimately be in both lists. See §4 for which of the two a regional
term belongs in.

## 2. Own crop species — a functionally different use form

A different **use form** is its own species, even when the plants are closely
related botanically or are literally the same botanical species: a different
plant part is used, or the growing or harvest characteristics differ.

Examples:

- `Pfefferoni` — its own growing characteristics, not identical to `Paprika`.
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

Example: `Cherrytomate`, `Fleischtomate` and `San Marzano` are all varieties of
`Tomate`, not crop species of their own.

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
   `CROP_SPECIES_REGIONAL_NAME_SEED_DATA`** under `austria` or `switzerland`, so
   projects in that region see their own term instead of the canonical one.
   Swiss terms such as `Nüsslisalat`, `Rande`, `Kabis`, `Zucchetti`,
   `Federkohl`, `Wirz`, `Rüebli`, `Krautstiel` and `Kefe` are standard in Swiss
   seed catalogues, horticultural literature and retail, not colloquialisms —
   they belong here.
3. **Everything else regional goes into `CROP_SPECIES_SYNONYM_SEED_DATA`**:
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
   them. `Fisole(n)` (AT) is handled the same way across the bean species.
5. A regional term for a crop species that does **not exist in the library
   yet** is a gap, not an alias. Add the species first (§2), then attach the
   regional term to it. `Kohlrübe` is the standing example: it names the swede,
   which the library does not seed, so it is deliberately not aliased onto
   `Kohlrabi`.

## Working on the suggestion list

- The list lives in `backend/crops/seed_data.py`: `CROP_SPECIES_SEED_DATA` for
  the species themselves (each with a stable `key`, a `de` and an `en`
  translation), plus the two alias maps keyed by that same `key`.
- Changing a seed list alone changes nothing in an existing database. Add a
  migration in `backend/crops/migrations/` that syncs it —
  `0014_crop_species_search_aliases.py` for synonyms and
  `0015_crop_species_regional_display_names.py` for regional names are the
  current patterns. Both merge into what is stored instead of overwriting it, so
  an alias curated outside the seed list survives.
- Renaming the canonical name of a species that is already published needs a
  migration that renames — or merges — the existing row, so published crops
  keep their species link.
- Never add supplier or shop categories (`Asiatisches Blattgemüse`,
  `Gründüngung`, a plain `Bohne` or `Kohl`) as a crop species: they mix several
  species with different growing and harvest logic. This is enforced by
  `backend/crops/tests/test_seed_data.py`.

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
