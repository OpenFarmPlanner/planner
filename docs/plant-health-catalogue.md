# Plant-health catalogue

The catalogue foundation for #1011 lives in `crops/plant_health_*.py` and in
**Crop library → Moderation**, below the existing change-proposal queue.
It manages global identities and sourced host relationships. Project crops can
also store the private selections described below. Explicit mappings, publication,
library synchronization, pins, selection filters and sourced-host inspection
are implemented. Existing `pests_diseases` prose is preserved. No initial catalogue data is seeded. The separate
crop-data #8 work owns researching and populating the initial entries.

## Identity and evidence

`PlantHealthEntry.identity_key` is an immutable UUID. Its integer API ID is the
local reference. A translated name or a broad label is not an identity key:
separate identities may have the same vernacular name. The kinds are specific
pest, specific pathogen, disease concept and broad group. A group such as
powdery mildew does not establish a shared pathogen. Neither a crop association
nor missing evidence establishes infestation, resistance or immunity.

Each identity has translated preferred names, synonyms and ISO two-letter
country-specific names. Search uses the binding accent/ligature/ß folding from
`docs/search.md` and ANDs query words across the reference name, scientific name,
EPPO code and every translated name, synonym and regional name. Search folding
never changes displayed names or the stricter whitespace/case-only identity keys,
and never performs fuzzy or semantic identity merges.

Approval requires identity sources and names in all seven supported languages
(de/en/fr/es/it/pt/nl). An explicit scientific-name fallback is allowed per
language only with its documented reason and the exact scientific name.
Published specific identities additionally require a scientific name; normalized
published scientific names and nonblank EPPO codes have database uniqueness
constraints. Broad labels remain nonunique. Optional six-character EPPO codes
are restricted to specific identities and require a matching `gd.eppo.int/taxon/CODE`
source URL. Moderators verify the actual external evidence and identity; the
server validates structure and provenance without fetching external URLs.

`PlantHealthHost` links an identity to an official published `CropSpecies`, with
optional variety and qualification, nonempty sources, and separate confirmation
and active flags. Only a specific pest/pathogen identity can have a confirmed
host relationship. Archive its active confirmed links before changing that
identity into a broad concept. Active host links can also be archived while the
parent identity is archived, rejected or pending; create/update still requires
a published identity and species. Host entry/species references cannot be moved by
editing: archive the old relationship and create the replacement. Creating the
same entry/species/variety scope after archival reactivates its existing row and ID. The new POST payload replaces the sources; omitted optional
confirmation/qualification values use new-creation defaults (false/empty), so old
confirmed evidence cannot silently survive a changed broad identity. PATCH
preserves omitted fields and refuses collisions with active or archived scopes.
A species with historical host references is protected from deletion (HTTP 409).
Ordinary catalogue and host reads omit relationships whose species is no longer
published. Moderators retain editorial access. Host responses include the
species status without extra per-row queries.

## Moderation and audit

Anyone authenticated, except a guest demo account, can propose an entry with
one language. Only published entries and the caller's own pending proposals are
visible to ordinary users; moderators can inspect all statuses. Creating a
proposal never publishes it. Only session-authenticated moderators may approve,
reject, archive or reopen an entry. Reopening a rejected/archived identity keeps
its UUID and returns it to proposed status for another complete review.

After a successful catalogue save or moderation action, the moderation list returns
to its first page while preserving its search and status filters. Removing the
last matching row on a later page cannot leave the remaining results unreachable.

Failed entry and host saves keep the draft open and focus the persistent error
summary at the top of the dialog's own scroll area. The requirements notice is
linked as its accessible description. Repeated failures reveal the summary again;
background-page scroll and entered values are preserved. Successful saves close
the editor and use the existing moderation-page success notification.

Partial translation writes upsert only supplied languages and fields. Omitted
languages, synonyms and regional names survive. Explicit `synonyms: []` and
`regional_names: {}` clear those fields. An empty translations array is a no-op;
it does not delete names. Existing names cannot be blanked. Pending proposals may
have empty sources; approval and edits of published entries must retain sources.

Every entry/host write records a `PlantHealthRevision` containing the complete
entry, names and active/archived host rows, actor, action and time. Moderator
history returns the most recent 100 snapshots, with each actor's explicitly
chosen public display name or an entry-scoped anonymous number, following the
existing public-library identity policy. Anonymous numbers are assigned from
first contribution across the complete entry history, so the 100-row response
window does not renumber them. Deleted accounts use the localized unknown-user
label. Private usernames and email addresses are never returned. There are no hard-delete API
routes; archival preserves identity and evidence. Reversal of the schema-only
migration removes these new tables and any catalogue data entered since upgrade;
existing crop prose and public translations are untouched.

## API and credentials

All endpoints require authentication; pagination uses the existing bounded
pagination contract. Lists accept `q`, `kind`, `status`, `include_proposed`,
`page` and `page_size` as applicable. A normal user's status parameters never
expand visibility. Host lists accept integer `entry` and `species` filters.

| Endpoint | Session authorization | Crop-library token |
|---|---|---|
| `GET /api/plant-health/entries/`, `entries/{id}/` | Visibility rules above | Read scope, same user visibility |
| `POST /api/plant-health/entries/` | Propose only | Write scope, propose only |
| `PATCH/PUT .../entries/{id}/` | Moderator | Write scope and bound moderator role |
| `POST .../entries/{id}/{approve,reject,archive,reopen}/` | Moderator | Denied |
| `GET .../entries/{id}/history/` | Moderator | Denied |
| `GET /api/plant-health/hosts/`, `hosts/{id}/` | Published active hosts; moderators see all | Read scope, same visibility |
| `POST/PATCH/PUT .../hosts/` (detail for updates) | Moderator | Write scope and bound moderator role |
| `POST .../hosts/{id}/archive/` | Moderator | Denied |
| Any `DELETE` | No route | Denied |

Legacy URL-prefix aliases retain the same permissions. Project-bound tokens
cannot access any global catalogue endpoint, including reads by a moderator.
The project-token generated schema intentionally excludes these routes. See
[crop-library-api-tokens.md](./crop-library-api-tokens.md) for the separate
platform credential and its session-only issuance.

This change contains no deployment, remote source crawling or paid API calls.

## Private crop selections

`Crop.plant_health` stores individual names separately from the existing
`pests_diseases` explanatory text. It is a bounded portable JSON object, following
the existing project-tag storage pattern, with at most 40 selections and names
up to 200 characters. A selection is either `{"name": "Private name"}` or an
explicit `{"catalogue_identity": "UUID", "name": "Reference-name snapshot"}`.
The UUID refers to the catalogue's stable identity, never its integer database
ID or a translated label. Two catalogue identities with the same label remain
separate; a typed matching name remains a private name. Local spelling reuse
only inspects active crops of the current project and normalizes whitespace
and case. It does not infer an organism, strip accents or split one name at
commas/semicolons. No private write proposes or publishes a global record.

The project crop form offers current published catalogue names and synonyms
alongside that project's existing private names. Selecting a catalogue result
is explicit. Chips distinguish private names, catalogue references and
unavailable references. Selected references use one bounded, permission-filtered
`entries/?identities=UUID,UUID` lookup for translated names; the parameter accepts
at most 40 UUIDs and cannot expand ordinary catalogue visibility. Failed lookups
retain the selection and offer retry. Archived references remain portable;
other unpublished identities may only be retained on a crop that already held
them. A new unknown or unreviewed UUID is rejected instead of silently becoming
a local name. A reference-name snapshot does not establish host evidence.

| Write | Meaning |
|---|---|
| Field omitted | Preserve the stored selections |
| `"plant_health": null` | Unspecified; a linked variety uses its general culture's live selections |
| `"plant_health": {"entries": []}` | Explicit empty override, including on a variety |
| Nonempty `entries` | Replace this crop's own selections |

The form displays inherited selections without freezing a copy when saved.
Removing every chip creates an empty override; **Use culture entries** restores
live inheritance. Neither an empty list nor missing information means
resistance or safety. An explicitly selected own value remains an override even
when it currently matches the culture; later culture edits do not replace it.
An association is not an observed infestation. Selections
participate in private entity/project history and restore. Import previews and
history show snapshot names, private/catalogue origins and stable catalogue
references; unspecified inheritance and an explicit empty override have distinct
labels. A snapshot predating the field restores it to `null` while restoring its
original prose unchanged.
Migration `0142_crop_plant_health_selections` adds only a nullable column, with
no extraction or data seeding. Reversing it preserves existing prose and drops
the new selections column and its values.

### Portable files and compatibility

JSON exchange carries the same object/null API value and stable UUIDs. The new
localized **Pest and disease entries (JSON)** spreadsheet column uses a JSON
array of names or reference objects; `[]` explicitly clears, `null` restores
inheritance, and an empty/absent cell leaves selections unspecified. JSON
escaping preserves delimiters and quotes inside individual names. The backend
also accepts the full selections object in that column. Invalid JSON and
unavailable identities are reported in preview before writes.

**Pest and disease notes** is the existing `pests_diseases` column under a more
explicit label. All seven former translated headers, including **Schädlinge und
Krankheiten**, still map only to explanatory prose. A legacy row such as
“early sowing protects against carrot fly; repels aphids” stays one note and
leaves structured selections unspecified. Companion comments and untouched
language versions are not reinterpreted. Agent import previews validate the
new field, and a confirmed import preserves explicit `null` rather than dropping
it as an omitted value.

Private selections are currently project data, outside the public library copy
fields. Explicit publication mapping/proposals, preservation of unresolved
private entries during official updates, local pins and four-case library sync
are part of the remaining public integration in #1011.

### Local private-selection acceptance data

After checking the actual local database and applying this checkout's migrations,
use an existing active user, published species and published catalogue entry.
The command creates no catalogue/species records and grants no global role.
The catalogue fixture below can supply an explicitly synthetic approved entry
when an existing moderator has prepared it on that same verified local database.

```bash
cd backend
DJANGO_ENV=development OFP_LOCAL_TEST_DATA=1 pdm run python manage.py seed_private_plant_health_acceptance \
  --username LOCAL_USER --species-id LOCAL_SPECIES_ID \
  --catalogue-entry-id LOCAL_PUBLISHED_ENTRY_ID --database-name EXACT_LOCAL_DATABASE
# Inspect the target and preview; repeat the same command with --apply.
```

The command reuses the local-only database, explicit target, migration and
routing guards of `seed_library_import_acceptance`. It creates a new isolated
**Private plant-health acceptance** project: a general culture with one private
name, one catalogue reference and unchanged prevention prose; three varieties
with inherited, empty and independent selections; and a plan referencing the
inheriting variety. Repeated runs keep manual edits. Slug/ownership collisions
abort without changing existing data. Cloud verification uses a separate
disposable database and has not seeded the owner's localhost.

Open that project → Crops. Change the general culture's entries and check the
inheriting variety, the explicit empty variety and the independent variety.
Add a free name, explicitly select a catalogue synonym, clear all chips, then
restore inheritance. Check the separate prose and retained crop/plan IDs.
Restore an earlier crop history entry. Export/reimport CSV, XLSX, ODS and JSON;
inspect the preview and try delimiters/quotes and explicit clearing. Repeat at
phone and desktop sizes and with another UI language. Public mapping/sync and
filter acceptance remain pending until the next part.

## Contextual crop help and ordering

In private crops and the public library, **Site and plant health** is a main
section and **Pests and diseases** is its smaller field label. Light, water, life
cycle and winter hardiness come first, assignments next, then general prevention
notes, matching the shared edit form. Cultivation type belongs to Timing, before
growth/harvest duration; seed quantities remain in Seed demand. Empty read-only
fields are omitted without changing the relative order. Editing still offers
all fields. See [crop-detail.md](./crop-detail.md) for context-specific sections.

The info button beside the assignment label contains the existing private-name,
explicit-catalogue-selection and unknown/infestation/resistance explanations.
The documented-host dialog's title info button explains catalogue evidence and
variety/source qualifications. Hover and keyboard focus reveal help; click/tap
keeps it open. Escape, repeated activation, blur or click-away dismisses it.
Help uses the existing shared tooltip, a larger touch target and viewport bounds
with scrolling for enlarged text. Blocking validation errors remain inline.
The dialog's accessible name stays its title. Actual sources, qualifications and
host evidence remain directly visible. Catalogue chips have an actionable
document icon; private-name chips do not open unavailable catalogue details.

For local acceptance, reuse the guarded catalogue and private-selection fixture
commands documented above/below; first verify the real local database, existing
moderator/user, species and catalogue IDs, and inspect the preview. In **Private
plant-health acceptance**, compare the general crop and its inherited, empty and
own-selection varieties in details and Edit. For a fully populated comparison,
fill optional timing, seed, germination and site values in that isolated project;
shared fields must stay in the edit form's order. Use the normal publish UI for a
synthetic variety and explicit catalogue mapping to compare the same fields in
public-library details and Edit with an existing local moderator. Do this only on
the verified local test database. Check empty details against complete editors,
private versus catalogue chips, hover, keyboard, touch, Escape and 200% text at
375px, short landscape and desktop. Repeat a long help message in French. Sources
and variety qualifications must remain visible without opening help. Fixture
commands preserve manual edits on repeat; Cloud has not seeded localhost.
The demo has no catalogue assignment fixture to rewrite; its shared form/detail
renderers receive the same presentation changes without fabricated health data.

## Local manual acceptance data

Cloud tests use disposable synthetic databases. They do not seed the owner's
localhost. On a local checkout containing this migration, use the guarded
`seed_plant_health_acceptance` management command after checking the actual
configured database and applying the checkout's migrations. Supply an existing
active moderator username, an existing published species ID and the exact local
database name/path; the command never grants roles or creates credentials.

```bash
cd backend
DJANGO_ENV=development OFP_LOCAL_TEST_DATA=1 pdm run python manage.py seed_plant_health_acceptance \
  --username LOCAL_MODERATOR --species-id LOCAL_SPECIES_ID --database-name EXACT_LOCAL_DATABASE
# Inspect the preview, then repeat the same command with --apply.
```

Only explicitly opted-in development/test local SQLite (within backend) or
loopback PostgreSQL is accepted. Remote/socket targets, routing overrides,
unapplied migrations, mismatched database confirmation and non-moderators are
refused. The command creates one pending proposal, one approved specific identity
with a visibly synthetic qualified host relationship, and two separate broad
identities sharing one label. All sources clearly identify synthetic data; they
are not agronomic claims. Stable fixture UUIDs make repeated runs preserve local
manual edits. An identity ownership collision aborts the transaction.

Open `/app/public-library-moderation`, find the catalogue below the existing
change-proposal queue, and search for `Synthetic`. Review the pending proposal:
one language is enough to propose, but approval needs all seven names and identity
sources. Scroll to the bottom and approve the incomplete proposal: the persistent
error must be visible and focused above the requirements notice. Scroll down and
retry unchanged, then correct the names and sources. A failed server request must
reveal the same feedback and preserve the draft; a successful approval closes the
dialog and shows the existing success notification. Check 375px portrait, short
phone landscape and desktop, including keyboard submission. The host editor uses
the same feedback behavior. Inspect the approved host's variety/scope, search a synonym, then archive
and reopen an entry and inspect its history. The two broad labels must remain
separate, and broad host editors must not allow confirmed-pathogen evidence.
Repeat at phone and desktop widths. This exercises only the catalogue foundation.

## Public selections, explicit mapping and synchronization

`PublicCrop.plant_health` contains only stable catalogue UUID references and
reference-name snapshots, never unresolved project names. New selections use
published identities; archived references remain portable as in private crops.
Other unpublished references can only be retained on the same public entry.
Public chips and form selections use translated visible catalogue names, with
an unavailable snapshot fallback. Autocomplete options show the identity kind
and scientific/reference name so equal vernacular labels remain distinguishable.
The public explanatory `pests_diseases` prose and its translations remain separate.
Public variety details resolve a null selection through the species-level entry,
including a section containing only inherited selections. An explicit empty
wrapper suppresses that fallback. Moderated edits validate retained references
against the same existing public entry as direct edits.

The publication and linked-entry sync dialog offers an explicit mapping panel
for each crop's unresolved names, including selected varieties. **Save mapping**
is a separate private write: it persists immediately even if publication is later
cancelled, and the panel states this before the action. It replaces only the
chosen local name on that project crop with a currently published stable UUID.
It never infers a match from typed text, publishes a library entry or creates
sourced host evidence. A variety's inherited names are mapped explicitly on its
general culture instead: the dialog names that culture and explains the effect
on every inheriting variety. The variety keeps its stored null and live inheritance;
it is never silently frozen into an override. New catalogue proposals use the existing
one-language moderation endpoint, start as broad pending concepts and keep the
private name unresolved until moderation and a later explicit mapping.

`POST /api/crops/{id}/plant-health/mappings/` accepts `expected_updated_at` and
`mappings: [{local_name, catalogue_identity}]` (1–40 unique local names). Project
permissions and token write scope apply. The action locks the project, verifies
the timestamp and effective source names, locks published targets and records
normal private history/actor attribution. Stale timestamps or disappeared source
names return 409 `plant_health_mapping_conflict`; attempting to map an inherited
variety directly returns 409 `plant_health_mapping_inherited`. Invalid/unapproved targets
return 400 without changing the crop. Project tokens still cannot propose or
read global catalogue entries. There is no automatic retry of a stale mapping.

Publishing skips unresolved/unreviewed entries and reports the count in preview;
they stay intact in the project. Every non-null selection retains its explicit
override wrapper even when no approved references remain, so an intentionally
empty variety never starts inheriting the general culture on publication. UUID sets, independent of order, language and
snapshot spelling, participate in the existing four-case library comparison.
Private-name and snapshot-spelling edits within the same override do not mark a
crop as divergent. Null inheritance remains distinct from any explicit override,
including an empty list. Both selected-field pulls
and full library updates replace only the official segment and preserve all
private names, IDs, plans and notes. If the combined private/public selection
would exceed 40 entries, the transaction fails instead of dropping names. An
unchanged inherited official segment leaves the variety's raw null intact.
A null public value also preserves an already-inheriting variety's raw null,
including when the parent contains private names; those names are not copied
into a frozen variety override.
An explicitly empty public selection still creates a variety override when
its current inherited official selection is empty. Comparison previews retain
this distinction, so later parent changes cannot undo the user's pull choice.
Official references can be pinned locally; private names are always retained,
and a private-only/empty official segment cannot keep a library pin.
Public proposals, revision snapshots and revert include this field while partial
translation edits preserve omitted languages. Old snapshots have no references.

Migration `0143_public_crop_plant_health_selections` only adds the nullable public
column. It seeds no catalogue rows and parses no prose; reversing it drops only
the new public selections and leaves legacy notes and private selections intact.
Queued plant-health proposals store canonical catalogue names alongside the
validated UUIDs, so moderation displays the same identity that approval applies.
The existing guarded `seed_private_plant_health_acceptance` fixture can be reused
to inspect private mapping/proposal controls with existing published catalogue
and species IDs. Preview/apply only on a verified disposable local database;
the command never writes shared library/catalogue entries or changes roles.

## Selection filters and sourced host inspection

The project filter and both public-library pickers offer a multiple-selection
plant-health filter. Every selected entry must match (AND), alongside the
other filters and search. The full library's mobile selector uses the same
filter button and popover as its desktop selector, with the same state and
reset behavior. UUIDs identify official entries across translations;
local names use only exact case/spacing normalization inside the active
project. Notes and broad wording never generate extra identities. Options come
from the effective values of the current crop collection; a null variety
inherits, while an explicit empty wrapper supplies no matches.
When legacy duplicate general rows remain, inheritance uses the first general
entry in the collection, matching the crop hierarchy and detail view.

The filter reuses the selection editor without free-text creation. It searches
canonical/scientific names and all translated names, synonyms and regional
names, retaining distinct UUIDs under the same vernacular label. Official
metadata is looked up in batches of at most 40 UUIDs, with at most four requests
in flight, so unrelated global search results cannot hide an in-use identity
beyond the first result page. Unavailable identities remain filterable by their
saved label; no evidence is inferred from that fallback. New project-local
filter selections carry their project ID in session state and are masked on a
project switch, including while the component remains mounted. Existing
unrelated filter persistence and legacy storage-key reads remain supported.

Choose an official selection chip on a private or public crop to inspect its
host evidence. The dialog refreshes the catalogue lookup and only presents
active, confirmed, sourced relationships for a published specific pest/pathogen
and published host species. Species-level and variety-qualified evidence stay
separate, with their original qualification and sources. A broad group or
disease concept explains why no single shared organism can be inferred.
Unresolved private names have no official-host action. An ordinary crop
selection is never itself proof that the crop is a confirmed host or currently
infested; an empty evidence list means unknown, not resistant or safe. No
rotation or companion rule is derived from these filters or relationships.

For local manual testing, reuse the guarded catalogue and private fixture
commands above: the specific synthetic entry has a qualified sourced host,
the two broad entries deliberately share a label, and the private project has
inherited, empty and own-value varieties. Select a private name and the official
identity together, change the parent and switch projects. Then inspect a
specific and a broad entry, including at phone portrait/landscape sizes and in
another language. These fixtures are not agronomic evidence; Cloud never
populates a production catalogue or the user's localhost.
