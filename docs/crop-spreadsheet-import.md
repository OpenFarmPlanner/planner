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
uses the following `phase` values with the existing confirmation and note
language/replacement options:

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
There is no import session, new persistence model or global taxonomy write.

## Interrupted imports

Only validated, internally consistent row receipts contribute to confirmed
counts. On a failed request, processing stops: earlier confirmations remain;
unstarted and rejected rows are reported as unsaved; a network error, server
error or invalid response leaves that request's write outcomes unknown.
Companion failures distinguish saved crops from incomplete neighbours.
Finalization and list-refresh failures never erase acknowledged crop writes.

The result names source rows and confirmed row ranges. It offers Close rather
than replaying uncertain writes. Users must inspect existing crops before a
new import; each new file requires fresh update confirmation and there are no
automatic retries. The crop list refreshes once after
an apply attempt, including uncertain outcomes.
