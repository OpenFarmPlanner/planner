# Crop detail (read views)

Two read views show one crop: the read mode of the crops page
(`crops/CropDetail.tsx`) and an entry's "Details" tab in the crop library
(`crop-library/pages/PublicCropLibraryPage.tsx`). Editing happens in the crop
form (`CropForm.tsx`) and the library's edit dialog, which are not affected by
anything below.

## Section order

The crop form is the canonical order, and both read views follow it with the
form's headings:

1. Sorten (a Kultur only: its varieties; "Sorte hinzufügen" on the crops page)
2. Allgemeine Informationen
3. Kulturspezifische Eigenschaften (only supported species, filled own values)
4. Fruchtfolge-Eigenschaften
5. Zeitplanung
6. Pflanzabstände
7. Ertrag
8. Saatgutbedarf (the cultivation type lives here, as in the form)
9. Zeiträume (crops page only: timing windows are project data)
10. Keimung
11. Standort und Pflanzengesundheit
12. Mischkultur
13. Notizen
14. Aufgabenvorlagen (crops page only)
15. Lieferantendaten (crops page only; edited in its own form)
16. Bibliotheksdaten (library only: original language, publication dates)

Hiding empty sections never reorders the remaining ones.

## Empty values

Both views show only filled-in values, so the populated ones are easy to
scan. There is no "show all" option: a missing value is visible in the edit
form.

- A value is missing when it is `null`, `undefined`, a blank string, or an
  empty list/object; `0` and `false` are values and are shown
  (`hasDetailValue` in `crops/cropDetailFieldVisibility.ts`).
- A section whose fields are all missing is left out entirely, separator
  included.
- Sections you act on stay even when empty, with their empty state and add
  button: Sorten, Aufgabenvorlagen, Lieferantendaten. The library's general
  section always names the crop species.
- Crop-specific property dictionaries are record-local and never inherit.
- A Sorte's blank value still falls back to its Kultur's value first (in the
  library: the species entry's); only a value missing on both counts as
  missing.

`CropSeedDetails` (the seed demand values) is shared by both views and shows
only what is set; a seed rate in the per-method table without a safety margin
shows "-" because a table cell cannot be left out.
