# Companion Planting (Mischkultur)

A crop can list **good and bad neighbours**: crops that grow well next to it
and crops that should not share its bed. The list is the user's own
knowledge, not an authoritative rule set; much traditional companion-planting
lore has little research behind it. Planning therefore only **warns** and
never blocks saving, as with crop rotation ([crop-rotation.md](./crop-rotation.md)).

All rules live in one backend service,
[`backend/farm/services/crop_companions.py`](../backend/farm/services/crop_companions.py).
The API, the spreadsheet import, the planning check and the crop-library bridge
go through it.

## The data

`CropCompanion` (`farm/models/crops.py`) is one relation:

| Field | Meaning |
| --- | --- |
| `crop` | The general crop (Kultur, empty variety) the relation belongs to. |
| `companion_crop` | Another Kultur of the same project, **or** |
| `companion_family` | a plant family (`crops.PlantFamily`, e.g. "Kreuzblütler" for all cabbages), **or** |
| `companion_text` | free text: an imported name that matched no crop or family (e.g. "Kräuter (Dill, Basilikum)"). |
| `kind` | `good` or `bad`. |
| `reason` | `competition`, `allelopathy`, `pest_control`, `soil`, `shared_pests_diseases`, `other`. |
| `notes` | Optional note/source text by language (`de`, `en`, `fr`, `es`), at most 500 characters per version. |
| `note` | Compatibility storage copy; APIs return the selected language, without fallback. |

Exactly one of the three targets is set (database check constraint).

**Kultur level.** Neighbours describe the crop, not a variety. A Sorte uses its
Kultur's list: the general crop of its crop species, else the general crop
with the same name. A Sorte without such a Kultur has no neighbours; the crop
details say so. The import creates the missing Kultur when a row names
neighbours.

**One shared pair.** Between two Kulturen a relation is stored once, with the
lower crop id in `crop` (check constraint), and reads the same from both sides:
"Tomate – Kartoffel bad" is listed on both crops. A family or free-text
relation belongs to its Kultur only. The same pair, family or text cannot be
listed twice for a Kultur.

**Why shared diseases are not derived.** Only some reasons are about
diseases. In real user data most were competition, inhibition, pest control,
soil improvement or timing, so the list is entered, not computed. Shared pests
and diseases mostly follow the plant family, which is why a relation can name a
family.

## API

`/api/crop-companions/` (project-scoped, unpaginated; `?crop=<id>` limits the
list to one Kultur, from either side of a pair). Writes are validated by
`CropCompanionSerializer`: both crops must be active Kulturen of the project, a
pair may be sent in either order and is stored canonically, a duplicate is
rejected with `{"companion": [...]}`. Project API tokens can read the list
(see [agent-api.md](./agent-api.md)). `PUT /api/crop-companions/replace/` with
`{crop, relations}` saves one Kultur's whole list, as the crop form does: each
item names the neighbour from the Kultur's side; a listed neighbour updates its
relation, a new one is created, and every relation the list leaves out is
deleted, a shared pair included. It validates the whole list first (errors under
`relations.<position>`) and records only rows that change. Every write flags a
Kultur linked to the crop library as changed locally (`is_modified_from_source`),
since `Crop.save` never sees neighbour rows. Creates, updates and deletes are recorded
in the project history and take part in whole-project restore
([versioning-and-history.md](./versioning-and-history.md)); the personal data
export lists them under `crop_companions`.

## Free text becomes a link later

The crops page's [batched import](./crop-spreadsheet-import.md) first saves all
crop batches, then adds neighbours in original file order and finally links
older free-text entries. This avoids premature linking between batches and
preserves explicit companion rows' first-kind-wins precedence.

A neighbour entered before its crop existed is stored as free text. Once a
Kultur with exactly that name (case and spacing aside) exists, the entry turns
into a pair with it (`link_free_text_companions`): when a Kultur is created or
renamed through the API, when the crop library import creates one, and once at
the end of a spreadsheet or agent import for the whole project (two queries per
file, not one per row). If that pair already exists, the free-text entry is
removed instead. Only names are matched, not crop species, and a Sorte never
takes over a free-text neighbour, since neighbours belong to the Kultur. A linked
Kultur affected by the change is flagged as changed locally for the library sync.

## Planning check

Two planting plans are neighbours when they are on the **same bed** and their
occupied periods share at least one day. A plan occupies its bed from its
planting date to its harvest end, else its harvest start, else its planting
date, as in [bed-occupancy.md](./bed-occupancy.md). Beds have no position, so
"the bed next to it" is not checked.

A finding is reported when the two plans' Kulturen form a listed pair, or when
one Kultur lists the other's plant family (the Kultur's family, else the
crop's own). `PlantingPlanSerializer.companion_findings` carries them, bad ones
first, with the other plan, its crop, its period, the reason, the note and,
for a family relation, `via_family_key`. `GET /planting-plans/rotation-check/`
returns the same findings for an unsaved plan. One `CompanionService` per
request loads the relations, the Kultur index and the bed occupancies once, so
a list costs a constant number of queries (pinned in
`farm/tests/test_api_query_counts.py`); without any relation in the project it
stops after one query.

UI: "Anbaufläche ändern" and the mobile plan form show bad neighbours as a
warning below the rotation result and good ones as a one-line note
(`CompanionCheckAlert`); the table's area cell and the mobile cards mark bad
neighbours with a leaf icon whose tooltip names them.

## Crop form

Project crop and variety forms show a read-only companion summary with an
Edit/Add neighbours action. They open the same crop-level editor as details;
there is no inline project row editor and saving a crop never replaces its
neighbours. A new crop must exist before neighbours can be edited. Library
entry/proposal forms retain their own staged companion data and save contract.

## Dedicated companion editor

`CropCompanionEditor` uses `useCompanionFormRows` and the existing row controls
in `sections/CompanionsSection`. The title identifies the editor, the resolved
crop name and “Applies to all varieties” identify its scope. A variety opens its
Kultur, not a separate variety relation list. Only an editing-capable project
caller supplies the action; read-only and public library detail surfaces do
not acquire project editing controls.

Good and bad groups each retain their own add action, including when empty.
Neighbours start as compact name/reason/note rows. Edit expands one row at a time; adding expands the new row. Crop/family/free-text resolution,
reason categories, duplicate detection and moving between kinds reuse the
existing controls. Deleting changes the draft. Save atomically calls
`PUT /crop-companions/replace/` on the Kultur and refreshes displayed relations;
it never saves the crop itself. Linked pairs remain reciprocal. Cancelling a
dirty editor asks before discarding. Load failures disable all writes and offer
retry; save failures retain drafts and allow retry. The note-language selector
retains untouched language versions as before. The dialog scrolls within its
content and keeps actions outside that scroll area; below the tablet breakpoint
it is fullscreen, including phone landscape.

The neighbour field's options are grouped by plant family
(`buildCompanionFormOptions`): one group per family under its name in the UI
language, alphabetically, with "Ohne Pflanzenfamilie" last for crops without a
family. Each group starts with the family itself, "{family} (ganze Familie)",
followed by its crops alphabetically; a crop counts under its effective family.
A family without crops stays as a group with just that option, and the crop's
own family stays pickable (potato: bad neighbour Solanaceae). Typing still
filters on the crop and family names, and a matching crop appears under its
family's heading. A chosen family shows its plain name in the field; the
"(ganze Familie)" suffix belongs to the list only.

The library's edit form uses the same section on a species-level entry. Its
neighbours are library crop species (the entries' species, each once, without
the entry's own) or families, never free text, grouped the same way by the
`crop_family` of the species' entry, and are saved with the entry's other
fields (direct edit or change proposal).

## Crop details

`CropCompanionsSection` presents good/bad neighbours using the shared
`CompanionKindColumns`: linked names remain clickable, with reason and note
on discreet secondary lines below the name. Public library display uses the
same presentation. An editing-capable project view has a green outlined
pencil Edit action, or Add neighbours with a plus when empty, consistent with
the existing secondary section buttons. An empty section stays hidden on
read-only surfaces. A variety shows its Kultur's scope and opens that Kultur's
editor. A load error offers retry and cannot enable writing an unknown list.

Recognizable absence statements such as “No specific bad neighbors known —
all-rounder” are shown as general information outside positive/negative
neighbour lists. This is narrowly scoped presentation of existing free text,
including German, English, French and Spanish absence statements. Linked crop
and family targets and ordinary unresolved crop names keep their existing
semantics. Text is never converted, split, linked, deleted or migrated
implicitly; the original stored row survives unrelated saves. Multi-neighbour
spreadsheet parsing and extracting trailing commentary remain outside this
issue. Library data remains species/family references only.

## Project crop reference labels

The form's Name field, companion owner hints, neighbour options/selected rows
and detail links all use `getCropDisplayName` (`crop_display_name`, falling
back to stored `name`). A species rename or translated catalog name can differ
from the project's historical text; the displayed name is used consistently
on both sides of a shared relation. A missing display name retains the stored
name. Family and free-text labels retain their own semantics.

When crop metadata refreshes, loaded crop-target labels refresh without
refetching the relation list, discarding unsaved note drafts or marking the
form dirty. IDs and edited note languages determine the saved relation; labels
do not change its identity. Untouched crop names still save their original
stored value. No catalog names are duplicated or seeded in the frontend.

The adjacent UI audit also aligns existing-crop hints, the republish species
picker prefill and local-name fallbacks in library update messages. The crop
tree/detail/delete/publishing headings and planning/demand labels already use
shared display helpers. Public-library hierarchy/adapters retain their separate
published-entry/original-language contract. Incoming library update labels and
publish duplicate candidates describe library entries; they retain that API
value rather than inventing a project label.

Stored-name reads used for duplicate matching, general-crop ownership fallback,
JSON/spreadsheet values and companion export tokens remain identity/exchange
data, not UI reference labels. Their canonical values must not silently change
when a user changes UI language or a catalog species is renamed. Export tests
cover divergent stored/display names explicitly.

## Spreadsheet and JSON import/export

The export writes two columns, "Gute Nachbarn" and "Schlechte Nachbarn", on
Kultur rows only. The export dialog offers scope and format; spreadsheets use
the active UI language captured when export starts, even if it changes while
data is loading. The browser remembers only the last successfully exported
format, defaults to ODS for missing/invalid preferences, and restores the saved
format after cancellation or failure independently of scope. Import automatically
uses the UI language captured when reading the file. Ordinary CSV/XLSX/ODS cells carry the notes; JSON is
optional and preserves the entire `notes` language map.

The canonical cell grammar is **one group per line**, comma/semicolon-separated
names and an optional note following the spaced delimiter ` | `:

```text
Tomate; Gurke; Bohne | Schutz vor Schädlingen
Erdbeere | Quelle: Gartenversuch 2025
Sellerie
```

A group note applies to every name on that line. A plain list is still valid.
Separators inside parentheses do not split a name; unspaced hyphens, as in
`Pak-Choi`, never split names. Export groups neighbors sharing the selected
language's note and writes neighbors without a note as names only. Language
maps are authoritative: a missing or explicitly empty selected version does
not fall back to another map language. As in project details, older records
without a language map fall back to their scalar note. Re-importing such a
fallback note assigns it to the UI language captured at file selection; JSON
preserves all stored language versions without resolving them for the UI.

**Reserved characters and line breaks.** Export quotes names/notes containing
commas, semicolons, pipes, quotes, backslashes or line breaks, or surrounding
whitespace. Within these quoted text tokens, `\"` represents a quote, `\\`
a backslash and `\n` a line break. These are quoted text strings, not JSON
objects in cells. The outer CSV writer independently quotes the entire cell,
including the real line breaks between groups; XLSX/ODS preserve the same cell
text. For example, the following is one group with a multiline note:

```text
"Kraut; Spezial"; "Salat - Pflücksalat" | "Quelle: \"A | B\"\nSeite 12"
```

**Safe legacy reading.** A line containing a spaced dash (` - ` or ` – `)
is deferred to the backend. Exact normalized full neighbor names win. Otherwise
only one split whose every preceding name resolves exactly to a project crop,
known species or plant family is accepted; its suffix applies to the entire
group. Existing historical reason labels followed by `:` are recognized only
in this legacy form. Arbitrary prose after a canonical pipe never implies a
reason enum. Unresolved/ambiguous legacy groups remain intact as free text and
are called out in preview; the importer never searches arbitrary name prefixes.
Names are limited to 200 characters and notes to 500; oversized unresolved
input is rejected rather than truncated.

**Merge and replacement.** Import adds relations without deleting others.
Existing structured reasons are retained on re-import. Nonempty notes update
only the current UI language captured when reading the file; absent/empty
spreadsheet notes preserve existing values. The import dialog has no language
selector or replacement checkbox. Other languages, the opposite side of a
shared pair and existing reason categories stay intact. Conflicting good/bad
assignments keep the existing kind and are reported. An explicit JSON `notes` map merges only
its supplied language keys, with `""` clearing that version; omitted keys are
preserved. A derived `note` alongside a full map is not copied into another
language.

Both the cell parser and backend import normalization ignore names without any
Unicode letter or number (e.g. `#`, `-`, `?`); the backend does so even when an
item carries a reason or note. These placeholders do not count as neighbours, unresolved names or
good/bad conflicts. The import template has a neighbour example on its Kultur
row.

The backend resolves each name once every row of the file exists: a crop of
the project with that name, then the project's crops of the crop species the name names (in any
language), then a plant family by name or synonym, else free text. The import
is additive: existing relations are kept, and a pair already listed with the
other kind is reported as a conflict and left as it is. The preview lists the
names that will stay free text (names of rows in the same file count as
known); the result reports created relations, free-text names and conflicts.

A CSV cell in quotes may contain line breaks; before this feature the parser
split such a cell into extra rows, which ended up as crops named after the
rest of the text.

## Crop library

The library knows no projects ([crop-library-architecture.md](./crop-library-architecture.md) §3),
so a published neighbour names a **crop species** or a **plant family**:

- `PublicCrop.companions` is a JSON list of `{species, species_name, family,
  kind, reason, note, notes}` (species id plus the neighbour's name at publishing,
  or a family), with `notes` holding its language versions, only on the species-level entry. It is an editable public
  field: version history, direct edits and change proposals cover it.
- **Publishing** a Kultur, or a Sorte whose species entry is created or
  updated from its Kultur, writes the Kultur's neighbours: a neighbouring
  Kultur through its crop species, a family as is. Free text and neighbours
  without a crop species stay in the project; the publish preview's
  `unpublishable_companion_count` drives a note in the wizard.
- **Importing** a species-level entry into a project adds its neighbours to the
  new Kultur: a species becomes the project's Kultur of that species, else free
  text with the stored name; a family stays a family.
- **Sync and library updates.** A Kultur linked to a species-level entry
  compares its neighbours like a copy field (`companions` in the sync dialog,
  the library update dialog and the pin list; `public_crops.COMPANIONS_FIELD`).
  The local side is what the library could hold, measured against the entry
  (`library_companion_view`): species and family neighbours, the stored names
  taken from the entry, and a free-text neighbour named like one of the entry's
  species counts as that species (it is what importing a species the project
  has no Kultur for leaves behind). Item order, the stored names and a
  neighbour of the Kultur's own species never read as a difference.
  - *Take the library's value* replaces those neighbours with the entry's list
    (`replace_library_companions`); free text and Kulturen without a species
    stay. A pair that is dropped also leaves the other Kultur, which the sync
    row says. Applying a library update does the same unless the neighbours
    are pinned.
  - *Share mine* writes the Kultur's list into the entry (direct edit or
    proposal); publishing again does the same.
  - *Keep locally* pins `companions`; the list then stays out of updates and
    publishing.
  The crop and library list serializers attach one `CompanionRelationIndex`
  per request, so the comparison costs one query per list (pinned in
  `farm/tests/test_api_query_counts.py`).
- **The library page** shows the neighbours of the species entry, also on its
  varieties (`buildLibraryCompanionRows`). A species neighbour links to that
  species' published entry. The other side of a pair is shown too: an entry
  listing this entry's species appears here, unless this entry already lists
  that species. Family neighbours are not mirrored, or every crop of the
  family would list them.

## Known limits

- Neighbouring beds are not checked (beds have no position).
- The project history records each neighbour change on its own, not as one
  entry per form save.

## Note languages and compatibility

Companion prose is an explicit exception to the otherwise single-language
private project content: project relations preserve every imported library
note version so publication, import, pins, sync and JSON backup do not discard
translations. No translation is generated automatically. The existing form's
language selector switches note text independently of neighbor identity and
reason; saving sends only the languages actually edited. Switching languages
retains unsaved changes. Library and project details show only the current UI
language's note and continue to show translated structured reasons. Newline
and citation text is rendered as escaped plain text with preserved line breaks.

API writes may send `note` plus `note_language_code`, or an explicit `notes`
map. Language maps and text lengths are validated. Library note patches merge
against the locked current entry, preserving other languages changed since
validation. Private relation updates use the same locking discipline. Ordinary
publication/sync updates scope note changes to the request language; a newly
created library entry can preserve all known versions. Pulling library data
preserves local versions absent from that entry. Removing a relation through
an existing explicit whole-list edit still removes that relation and its notes.

Migration `farm.0141_localized_companion_notes` adds the private language map.
Historical private notes are preserved verbatim as German legacy content;
historical public notes use the entry's declared original language, with German
only for missing/unsupported historical metadata. Species and translations are
not seeded or renamed. The old storage field remains for compatibility. Schema
rollback drops private language maps and reduces public maps to the original
language; restore a backup to recover newer additional versions after rollback.
