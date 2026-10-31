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
| `note` | Optional short text. |

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
(see [agent-api.md](./agent-api.md)). Creates, updates and deletes are recorded
in the project history and take part in whole-project restore
([versioning-and-history.md](./versioning-and-history.md)); the personal data
export lists them under `crop_companions`.

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

## Crop details

The crop details have a "Mischkultur" section (`CropCompanionsSection`): good
and bad neighbours with reason and note, a neighbouring crop as a link, an
"Nachbar hinzufügen" button and per-entry edit and delete (with undo).
Changes are saved immediately through the API. A Sorte shows its Kultur's
list with "Gilt für alle Sorten von …".

## Spreadsheet and JSON import/export

The export writes two columns, "Gute Nachbarn" and "Schlechte Nachbarn", on
Kultur rows only: one neighbour per line, `Name`, `Name – note`,
`Name – Reason` or `Name – Reason: note`, with the reason label in the export
language. The JSON export writes the same as `good_companions` /
`bad_companions` lists of `{name, reason, note}`.

The import reads the cells in any UI language (`crops/companions.ts`):
several names before the dash share the note (`Tomate, Kartoffel – gleiche
Krankheiten`), commas inside parentheses do not split. The backend resolves
each name once every row of the file exists: a crop of the project with that
name, then the project's crops of the crop species the name names (in any
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
  kind, reason, note}` (species id plus the neighbour's name at publishing,
  or a family), only on the species-level entry. It is an editable public
  field: version history, direct edits and change proposals cover it.
- **Publishing** a Kultur, or a Sorte whose species entry is created or
  updated from its Kultur, writes the Kultur's neighbours: a neighbouring
  Kultur through its crop species, a family as is. Free text and neighbours
  without a crop species stay in the project; the publish preview's
  `unpublishable_companion_count` drives a note in the wizard.
- **Importing** a species-level entry into a project adds its neighbours to the
  new Kultur: a species becomes the project's Kultur of that species, else free
  text with the stored name; a family stays a family.
- The library page shows the neighbours of the species entry, also on its
  varieties.

## Known limits

- Pulling library updates into an already linked project crop does not touch
  its neighbours; republishing updates the entry's list.
- The library page shows neighbours but has no editor for them yet; the
  update API accepts them.
- Neighbouring beds are not checked (beds have no position).
