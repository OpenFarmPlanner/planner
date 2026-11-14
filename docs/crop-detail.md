# Crop detail (read views)

Two read views show one crop: the read mode of the crops page
(`crops/CropDetail.tsx`) and an entry's "Details" tab in the crop library
(`crop-library/pages/PublicCropLibraryPage.tsx`). Editing happens in the crop
form (`CropForm.tsx`), the dedicated project companion editor and the
library's edit dialog.

## Split-view scrolling

From `md` up, the project crop list and detail card scroll independently inside
the available viewport height. `CropDetail` measures its document position and
the trailing margins, padding and borders through `<main>`; the page wrapper's
bottom margin and the shell's responsive bottom padding both count. Ancestor
resize observation updates the measurement when the header or layout reflows.
Document scroll is excluded from the position so returning from a scrolled
mobile view does not enlarge the desktop panes.

Very short desktop windows retain a 280px minimum usable pane height and allow
document scrolling rather than clipping the search/actions. Phones and compact
phone landscape keep their existing document-scrolling detail layout. Cards use
`overflow-y: auto`, so a short detail has no scrollbar when its contents fit.
`e2e/scrollbar-layout.spec.ts` verifies document overflow, independent pane
scrolling with classic scrollbars, short windows, text scaling and the CSS
viewport corresponding to 200% zoom.

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
  button: Sorten, Aufgabenvorlagen, Lieferantendaten, and Mischkultur on
  editing-capable project views. The library's general section always names
  the crop species.
- Crop-specific property dictionaries are record-local and never inherit.
- A Sorte's blank value still falls back to its Kultur's value first (in the
  library: the species entry's); only a value missing on both counts as
  missing.

`CropSeedDetails` (the seed demand values) is shared by both views and shows
only what is set; a seed rate in the per-method table without a safety margin
shows "-" because a table cell cannot be left out.

The project timing section uses the same Anzuchtzeitraum, Direktsaatzeitraum
and Pflanzzeitraum labels as the edit form and spreadsheets (localized in
all four languages; see [timing-windows.md](timing-windows.md)). They are
windows, distinct from the cultivation-method labels. Harvest remains
calculated, not an imported or editable harvest window.

Project companion references use the same resolved crop-name helper as the
Name field and detail heading, including a variety's owner hint and reciprocal
neighbour links. Stored historical names remain identity data; see
[crop-companions.md](crop-companions.md#project-crop-reference-labels).


Editable project companion sections remain visible when empty to offer Add
neighbours. Their outlined action opens the shared crop-level companion editor,
including from a variety; read-only/public surfaces offer no project edits.
Reason and note appear below linked names. General information is distinct from
actual good/bad neighbours; see the companion documentation above.


## Planting prerequisites

Crop details and crop-list contexts do not show plot/bed setup callouts.
Planning prerequisites still disable the create-plan action and retain its
existing tooltip behavior. Crop values, notes, yield and supplier data are
independent of having a plot or bed. Legitimate setup guidance on planning
pages and crop onboarding/search empty states remain in their own contexts.
The removed callout-only titles/descriptions are no longer translated; shared
action and tooltip keys remain available in all four languages.
