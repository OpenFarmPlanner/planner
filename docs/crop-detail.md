# Crop detail (read view)

The read mode of the crops page (`crops/CropDetail.tsx`) shows a Kultur or
Sorte with its sections. Editing happens in the crop form (`CropForm.tsx`),
which is not affected by anything below.

## Section order

The crop form is the canonical order, and the detail follows it with the
form's headings:

1. Sorten (Kultur view only: navigation and "Sorte hinzufügen")
2. Allgemeine Informationen
3. Fruchtfolge-Eigenschaften
4. Zeitplanung
5. Pflanzabstände
6. Ertrag
7. Saatgutbedarf
8. Zeiträume
9. Keimung
10. Standort und Pflanzengesundheit
11. Mischkultur
12. Notizen
13. Aufgabenvorlagen (detail only)
14. Lieferantendaten (detail only; edited in its own form)

Hiding empty sections never reorders the remaining ones.

## Empty values

By default the detail shows only filled-in values, so the populated ones are
easy to scan:

- A value is missing when it is `null`, `undefined`, a blank string, or an
  empty list/object; `0` and `false` are values and are shown
  (`hasDetailValue` in `crops/cropDetailFieldVisibility.ts`).
- A section whose fields are all missing is left out entirely, separator
  included.
- Actionable sections stay even when empty, with their empty state and add
  button: Sorten, Aufgabenvorlagen, Lieferantendaten.

The switch **"Alle Angaben anzeigen"** at the top of the detail shows every
section and field again, missing ones with "Keine Angabe". The choice is a
per-browser preference in `localStorage` (`ofp.crops.detail.showAllFields`)
and applies to every crop until it is switched off.

A Sorte's blank value still falls back to its Kultur's value first; only a
value missing on both counts as missing.

The public crop library views keep their own layout and are not affected
(`CropSeedDetails` defaults to its `legacy` mode there).
