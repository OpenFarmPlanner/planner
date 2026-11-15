# Plant-health catalogue

The catalogue foundation for #1011 lives in `crops/plant_health_*.py` and in
**Crop library → Moderation**, below the existing change-proposal queue.
It manages global identities and sourced host relationships. Private crop tags,
public crop mappings, shared-pathogen views and import/export integration are
subsequent parts of #1011; this foundation does not change crop records or their
existing `pests_diseases` prose. No initial catalogue data is seeded. The separate
crop-data #8 work owns researching and populating the initial entries.

## Identity and evidence

`PlantHealthEntry.identity_key` is an immutable UUID. Its integer API ID is the
local reference. A translated name or a broad label is not an identity key:
separate identities may have the same vernacular name. The kinds are specific
pest, specific pathogen, disease concept and broad group. A group such as
powdery mildew does not establish a shared pathogen. Neither a crop association
nor missing evidence establishes infestation, resistance or immunity.

Each identity has translated preferred names, synonyms and ISO two-letter
country-specific names. Search normalizes whitespace/case and ANDs query words
across the reference name, scientific name, EPPO code and every translated name,
synonym and regional name. It never performs fuzzy or semantic identity merges.

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
editing: archive the old relationship and create the replacement. A species with
historical host references is protected from deletion (HTTP 409).

## Moderation and audit

Anyone authenticated, except a guest demo account, can propose an entry with
one language. Only published entries and the caller's own pending proposals are
visible to ordinary users; moderators can inspect all statuses. Creating a
proposal never publishes it. Only session-authenticated moderators may approve,
reject, archive or reopen an entry. Reopening a rejected/archived identity keeps
its UUID and returns it to proposed status for another complete review.

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
sources. Inspect the approved host's variety/scope, search a synonym, then archive
and reopen an entry and inspect its history. The two broad labels must remain
separate, and broad host editors must not allow confirmed-pathogen evidence.
Repeat at phone and desktop widths. This exercises only the catalogue foundation.
