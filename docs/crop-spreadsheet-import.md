# Crop spreadsheet and JSON import

The crops page parses CSV, XLSX, ODS and JSON locally. It sends sequential
preview and apply batches through `cropImportBatches.ts`, bounded by **200
rows and 1 MiB of serialized UTF-8 request body**, including the envelope,
options and companion name context. A single oversized row or context is
rejected before that phase sends requests. Server body-limit rejections have
a localized explanation. Global server upload limits remain unchanged.

The page captures its project ID when preparing the file and sends
`expected_project_id` in every preview/apply request. The server returns
`409 crop_import_project_changed` before processing when the active project
differs. A switch in another browser tab therefore stops later batches instead
of writing into the new project. Legacy requests may omit this additive guard.

This is the crops page's stateless import, distinct from the external agent
API's draft-based preview/apply protocol.

## Multi-value cells

Inside a CSV, XLSX or ODS culture cell, `;` is the one separator between
several values (`LIST_CELL_SEPARATOR` in `crops/spreadsheetColumns.ts`). Export
and template write `; ` in every list-valued column:

- cultivation types: `Direktsaat; Pflanzung`;
- suitable light conditions: `Sonnig; Halbschattig` (historical one-value rows and column headers still import);
- tags: `Kräuter; Blumen`;
- several timing windows of one kind: `Mitte März bis Mitte April; KW 20 bis 24`;
- good/bad neighbours: `Tomate | Schutz vor Schädlingen; Gurke | Quelle 2025; Basilikum`
  (grammar and quoting in [crop-companions.md](crop-companions.md)).

This is a separator *within* a cell. It does not change the CSV column
delimiter, decimal commas or JSON, and the help's comma-joined lists of
allowed enum labels are not list syntax. Older files stay importable: list
columns also split at `,` and line breaks, and neighbour cells keep reading
line-separated entries, comma-separated names without a note and the legacy
dash form. The help describes only the canonical `;`.

## Preview and identity

`POST /crops/import/preview/` still accepts the legacy array. The optional
`{items, known_crop_names}` envelope supplies all unique names in the file
when companion fields exist. This keeps legacy companion parsing and unknown
name warnings consistent across batches. Preview never saves crops or suppliers.

Every result includes `normalized_identity` (`name`, nullable `variety`, or
null for a malformed identity), using the backend's normalization and Unicode
case folding. The frontend uses it to detect duplicates across the whole file:
the first occurrence wins, even if it later fails validation. Supplier names
do not distinguish crops. Results use zero-based payload indexes; the UI maps
them back to the original spreadsheet row or JSON array position, including
positions skipped while parsing.

## Apply phases

`POST /crops/import/apply/` keeps the legacy unphased behavior. The crops page
uses the following `phase` values with the existing update confirmation. It
captures the current UI language when reading a file and uses that language
through preview and apply, even if the UI language changes afterward. CSV,
XLSX and ODS nonempty neighbour notes update only that language; empty or
missing notes preserve existing text. There is no language selector,
replacement checkbox or replacement hint in the import dialog. JSON retains
all explicit note-language maps and their existing merge/explicit-empty
semantics; it is not restricted to the captured UI language.

The browser no longer sends `replace_companion_notes`. The backend retains
this deprecated option for old open tabs and external integrations; remove it
only once those clients no longer send it. New imports use the non-destructive
default for scalar notes.

Phases:

1. `crops`: general crops first, then varieties, without companion fields.
   Crop writes return one `results` receipt per item: `created`, `updated`,
   `skipped`, `duplicate` or `error`; successful writes include `crop_id`.
   Existing crops still require `confirm_updates`. Companion linking is deferred.
2. `companions`: acknowledged created/updated rows with companion fields,
   in original file order, using `{crop_id, good_companions?, bad_companions?}`.
   IDs must belong to the active project. Existing additive merge, reciprocal
   pairs, first-kind-wins conflicts, reasons and localized note rules apply.
   This phase does not update crop fields or increment crop write counts.
3. `finalize`: empty `items`, linking pre-existing free-text neighbours only
   after every submitted companion row. This preserves explicit row precedence.

All phases retain the existing crop-action authentication and permissions.
The current browser sends one `import_operation_id` UUID across every apply
phase/batch. `BatchOperation` binds it to the initiating user and project and
retains the server-owned before/after evidence for one grouped history entry
and selective undo. Legacy requests without this additive field remain
compatible and ungrouped. There is no global taxonomy write. See
[Versioning and History](./versioning-and-history.md#grouped-operations-and-imports)
for checkpoints, preview/revalidation, conflicts and restore semantics.

## Interrupted imports

Only validated, internally consistent row receipts contribute to confirmed
counts. On a failed request, processing stops: earlier confirmations remain;
unstarted and rejected rows are reported as unsaved; a network error, server
error or invalid response leaves that request's write outcomes unknown.
Companion failures distinguish saved crops from incomplete neighbours.
Finalization and list-refresh failures never erase acknowledged crop writes.

The result names source rows and confirmed row ranges. Once apply finishes,
the dialog offers Close. For an unconfirmed outcome, reload the page and check
the crops before importing again. Each new file requires fresh update
confirmation. The crop list refreshes once after a submitted apply in the
same project, including uncertain outcomes. If that read fails, the dialog
keeps the confirmed counts and ranges visible with a localized reload message.
Closing the result and reloading the page reads the current crops without
resubmitting the import.
