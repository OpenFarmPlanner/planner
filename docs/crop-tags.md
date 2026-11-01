# Crop Tags

A crop can carry the user's own **tags**, e.g. "Kräuter", "Blumen",
"Mehrjährig" or "Literatur", to filter the crop list by. They are the user's
labels, not a classification: some name a kind of plant, some a property,
some have nothing to do with the plant, and a crop may carry several. Issue
#859.

They are called tags in the UI as well ("Tags" in German and English,
"Étiquettes"/"Etiquetas" in French and Spanish; see
[i18n-glossary.md](./i18n-glossary.md)). An earlier version called them
"Gruppen"/"Groups"; that name was dropped because it suggests an exclusive
classification and collides with domain groupings such as the plant family.
"Crop group" in the code still means a Kultur together with its Sorten
(`crops/cropGroupSearch.ts`), which is unrelated.

## Data

`Crop.tags` is a JSON list of names on any crop row, Kultur or Sorte, several
allowed. The project's set of tags is whatever its crops use; there is no
separate table. The rules live in `backend/farm/services/crop_tags.py`
(frontend twin for the form: `frontend/src/crops/cropTags.ts`):

- Names are trimmed, inner whitespace collapsed, a leading list marker
  ("• Getreide", "- Kräuter") removed, at most 60 characters.
- Duplicates are dropped case-insensitively; the first spelling wins.
- A name the project already uses in another case or spacing takes that
  spelling (`canonical_tags`), so "kräuter" reuses "Kräuter" instead of
  creating a second tag. There is no database constraint; duplicates that
  already exist in another spelling are not merged.
- At most 20 tags per crop.

**Kultur and Sorte.** `tags` is in `CROP_INHERITABLE_FIELDS`: a Sorte without
tags of its own uses its Kultur's (`effective_values.tags`); a Sorte with its
own uses only those. Sorten of one Kultur may carry different tags (in the
user's list, Kamille is tagged "Kräuter" and "Blumen").

## UI

- **Crop form:** "Tags" next to the Latin name; existing tags are offered and
  match the input case-insensitively, a new one is typed (Enter or leaving the
  field adds it). The library form has no such field.
- **Crop details:** the effective tags as chips, with the Latin name in a
  "General information" section above the crop rotation properties (shown only
  when the crop has either).
- **Filter:** "Tags" in the crop filter, offering the project's tags; a crop
  matches when its effective tags contain the selected one (case-insensitive).
  A Kultur stays visible when one of its Sorten matches, as with the other
  filters.

## Import and export

The spreadsheet column "Tags" (in French and Spanish exports "Étiquettes" /
"Etiquetas"; alias "Tag") holds several names separated by commas, semicolons
or line breaks; the export writes them comma-separated. The JSON export writes
a list. The agent import accepts `tags` (or `tag`) as a list or as one
separated text (`KIND_STRING_LIST` in `crop_import/field_specs.py`).

The former column names and import keys (`groups`, `gruppen`, `gruppe`,
"Gruppe(n)", "Groupes", "Grupos") are no longer recognized; an import reports
them as unknown fields. See the CHANGELOG.

## Crop library

Tags are not published: `tags` is not a copy field, so publishing, library
import, the sync and the update diff never see it. Each farm keeps its own.

## Not included

- Renaming or merging a tag across all crops at once; for now edit the crops
  or import again.
- Searching by tag in the page search; the filter covers it, and
  [search.md](./search.md) is unchanged.
