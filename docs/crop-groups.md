# Crop Groups (Gruppen)

A crop can carry the user's own **groups**, e.g. "Kräuter", "Blumen",
"Mehrjährig" or "Literatur", to filter the crop list by. They are the user's
labels, not a classification: some name a kind of plant, some a property,
some have nothing to do with the plant. Issue #859.

In code the concept is a **tag** (`Crop.tags`), because "crop group" already
means a Kultur together with its Sorten (`crops/cropGroupSearch.ts`). The UI
calls them "Gruppen"; see [i18n-glossary.md](./i18n-glossary.md).

## Data

`Crop.tags` is a JSON list of names on any crop row, Kultur or Sorte, several
allowed. The project's set of groups is whatever its crops use; there is no
separate table. The rules live in `backend/farm/services/crop_tags.py`
(frontend twin for the form: `frontend/src/crops/cropTags.ts`):

- Names are trimmed, inner whitespace collapsed, a leading list marker
  ("• Getreide", "- Kräuter") removed, at most 60 characters.
- Duplicates are dropped case-insensitively; the first spelling wins.
- A name the project already uses in another case or spacing takes that
  spelling (`canonical_tags`), so "kräuter" joins "Kräuter".
- At most 20 groups per crop.

**Kultur and Sorte.** `tags` is in `CROP_INHERITABLE_FIELDS`: a Sorte without
groups of its own uses its Kultur's (`effective_values.tags`); a Sorte with its
own uses only those. Sorten of one Kultur may sit in different groups (in the
user's list, Kamille is in "Kräuter" and in "Blumen").

## UI

- **Crop form:** "Gruppen" next to the Latin name; existing groups are offered,
  a new one is typed (Enter or leaving the field adds it). The library form has
  no such field.
- **Crop details:** the effective groups as chips.
- **Filter:** "Gruppe" in the crop filter, offering the project's groups; a crop
  matches when its effective groups contain the selected one. A Kultur stays
  visible when one of its Sorten matches, as with the other filters.

## Import and export

The spreadsheet column "Gruppen" (aliases "Gruppe", "Groups", "Tags", …) holds
several names separated by commas, semicolons or line breaks; the export
writes them comma-separated. The JSON export writes a list. The agent import
accepts `tags` (or `groups`, `gruppen`, `gruppe`) as a list or as one separated
text (`KIND_STRING_LIST` in `crop_import/field_specs.py`).

## Crop library

Groups are not published: `tags` is not a copy field, so publishing, library
import, the sync and the update diff never see it. Each farm keeps its own.

## Not included

- Renaming or merging a group across all crops at once; for now edit the crops
  or import again.
- Searching by group in the page search; the filter covers it, and
  [search.md](./search.md) is unchanged.
