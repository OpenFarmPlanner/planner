# Crop detail (read views)

Two read views show one crop: the read mode of the crops page
(`crops/CropDetail.tsx`) and an entry's "Details" tab in the crop library
(`crop-library/pages/PublicCropLibraryPage.tsx`). Editing happens in the crop
form (`CropForm.tsx`), the dedicated project companion editor and the
library's edit dialog.

The crop library, its import picker, and project Crops place filter and
selection controls beside the search field. The field takes the available
space. At very narrow widths, the buttons can move together to the next line.

## Selecting project crops for deletion

The project crop search toolbar uses the library's checklist control. Search,
the origin filter, and opening a crop's details preserve the selection. Select
visible uses the rows displayed with the current search, filters, and expanded
groups. Delete all in the crop actions menu includes every active project crop
and requires a separate acknowledgment.

The preview counts unique affected general crops and varieties, seed packages,
supplier offers, and referencing planting plans. A selection that would leave
varieties without their general crop, an ambiguous group, or a referenced crop
blocks the entire batch until the conflict is resolved. Seed records follow
their archived crop and shared library entries stay intact. The success message
offers Undo. An administrator can also recover a batch from project version
history. [Versioning and History](./versioning-and-history.md#bulk-crop-deletion)

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
5. Zeitplanung (cultivation type, growth duration, harvest duration, propagation duration)
6. Pflanzabstände
7. Ertrag
8. Saatgutbedarf (direct-sowing quantities, transplanting quantities, thousand-kernel weight)
9. Zeiträume (crops page only: timing windows are project data)
10. Keimung
11. Standort und Pflanzengesundheit
12. Mischkultur
13. Notizen
14. Aufgabenvorlagen (crops page only)
15. Lieferantendaten (crops page only; edited in its own form)
16. Bibliotheksdaten (library only: original language, publication dates)

Hiding empty sections never reorders the remaining ones. The shared
`CropTimingDetails` keeps cultivation type above harvest timing in both read
views, matching `TimingSection`. Method labels still identify seed-rate rows.
A cultivation method alone does not create an empty seed-demand section. Existing
seed quantities, project safety margins, legacy quantities and local pin/variety
markers remain in their respective groups.

In the editor, life cycle and the perennial standing time appear together before
time planning. Both read views show their effective values under General
information. Site and plant health groups light, water, winter hardiness,
pest/disease assignments and the existing prevention/general notes. Assignments
use a field label within that section, with the main heading also visible when
assignments are its only filled field. Identity, spacing, yield and germination retain their shared
form order; project tags, rotation breaks, timing windows, tasks and supplier data
and library metadata remain in their own contexts. Project crop details and
forms show the effective display colour. Varieties start with the colour of
their general crop and can save or reset an individual colour. Crop selection
also offers a confirmed reset for the selected variety overrides, with Undo
and a revision in each variety's history.

The assignment label and documented-host dialog title have contextual info
buttons. Existing help text opens on hover or keyboard focus; click/tap keeps it
open until another activation, Escape, blur or click-away. Escape dismisses help
before the enclosing dialog, retaining trigger focus. The larger targets and
viewport-bounded, scrollable help support narrow screens and enlarged text.
Catalogue chips show a document icon and open the documented relationships;
private-name chips are plain labels. Relationship evidence, source links and
variety qualifications stay directly visible. Loading, unavailable-reference and
error feedback remain inline.

## Empty values

Both views show filled-in values by default. The detail actions include
**Show all range fields** to reveal empty germination, applicable stratification
and sowing-depth ranges as a single dash per field. Other missing values are
visible in the edit form.

Read-only ranges use a single localized label and unit. Equal bounds display one
value and a single bound indicates the direction of the limit. Minimum
germination temperature keeps its own row. The edit form keeps separate inputs
for each range endpoint.

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
and Pflanzzeitraum labels as the edit form and spreadsheets. These windows
describe when to propagate, sow or plant. See [timing windows](timing-windows.md).

## Perennial harvest planning

Annual crops retain their day-based growth and harvest durations. A perennial
can declare one inclusive recurring harvest window, stored as `MM-DD/MM-DD`.
For example, `09-01/10-15` is September 1 through October 15 each year.
If the end precedes the start, it falls in the following calendar year.
Identical endpoints describe one day. February 29 is valid and uses February 28
in years without a leap day.

The optional `first_harvest_delay_years` is a nonnegative whole number of
calendar years after planting. A variety inherits a blank value from its
general culture when available. After inheritance, a blank delay and an
explicit `0` both mean eligibility starts on the planting date. A positive
delay starts on the corresponding planting anniversary, using February 28 if
that year has no February 29. The calculation uses recorded direct sowing or
transplanting when available and otherwise uses the original planned date.
For a crop planted on March 15, 2025 with a delay
of 2 years, eligibility begins March 15, 2027. In a September–October window,
the first eligible harvest falls in September 2027. If eligibility begins
inside a window, only dates on or after eligibility qualify.

The whole window is inherited together, independent of the delay. Standing
time continues to describe bed occupancy. Existing crops may leave the window
empty. Importing or editing either timing field stores crop data and preserves
existing plan dates and actual harvest records. Plans with a window show
projected dates for the selected season in the planting plans, crop calendar
and yield overview. Plans with an empty window still use their stored one-off
dates. See [season-scoped planting plans](seasons-architecture.md#season-scoping-of-planting-plans).
Publishing a perennial to the library requires an annual window or both
legacy day-based durations. The detail view shows saved durations when the
annual window is absent.

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
