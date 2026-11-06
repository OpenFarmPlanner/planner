# Supplier seed status

`CropSupplierData` records the seed status of a supplier's offer for a project
crop. `seed_status` accepts `organic`, `in_conversion`, `conventional`, or
`unknown`. `seed_exemption_status` accepts `approved`, `not_approved`,
`not_required`, or `unknown`. Both default to `unknown`; API clients can omit
them. Empty strings, null and unrecognised choices are rejected. An update
that omits either field preserves its stored value. Choosing Unknown resets it.
The dedicated supplier-data section on crop details edits these values through
an independently saved dialog; the general crop editor omits supplier fields.
There is no new seed-management module or automatic approval workflow.

## Domain limits

Seed certification describes the offer; an exemption is not an intrinsic
property of a supplier or variety. It can depend on the farm, certification
body/jurisdiction, intended use, quantity, season and validity period.
Consequently, `seed_exemption_status` is only a manually maintained note in
this project's supplier row. `approved` does not certify that the current
farm or planting plan is covered, and `not_required` is a user's statement,
not a rule inferred from `organic`. No combinations are automatically forced.
The editor asks users to check farm, use and period separately. Approval
references, documents, quantities and expiry dates are not tracked here.
A future authoritative approval workflow would need farm/use-scoped records.

The existing unique constraint allows **one row per crop and supplier**.
Two offers of the same variety from different suppliers can have independent
statuses. Multiple simultaneous offers/lots from the same supplier cannot
be represented separately; the row describes the offer currently maintained
by the project. Statuses are not inherited by varieties or published to the
shared crop library. Switching a supplier does not transfer another row's
status, and seed-demand calculations do not use these fields.

## Existing data, import/export and recovery

The additive schema migration populates existing rows with `unknown` without
changing their product, price, packaging or other seed metadata. It is reversible;
rolling it back drops the two new columns and loses their values.

The nested crop API (`supplier_data` on reads, `supplier_data_input` on writes)
and `/crop-supplier-data/` expose both values. API clients exporting supplier
rows must retain them per row and use the existing write contract to restore
them in the intended project. Recheck exemption applicability after transfer.

The existing portable crop JSON and CSV/XLSX/ODS exports carry crop fields
and a preferred supplier name; they do not export the supplier-offer rows
(product metadata, packaging, price or these statuses). They are **not a
backup of supplier offers**. Their existing imports omit `supplier_data_input`
and preserve statuses on existing offers; new offers default to `unknown`.
This change does not introduce ambiguous crop-level status columns or change
those formats. API imports that supply nested supplier rows follow the same
validation and omission behaviour as ordinary edits.

Supplier deletion/undo explicitly carries both statuses, and legacy undo
payloads without them restore `unknown`. Project history snapshots include
the fields through the existing model-field serializer.


## Independent editing (#898)

Crop details expose a compact Supplier data section next to seed requirements,
matching the Varieties section, with an Add button and offer-level Edit/Delete
actions. Each editor opens only the selected offer (or a new offer). It reuses the
existing supplier/package controls, inline supplier creation, validation,
keyboard save shortcut and draft/discard handling. Saving sends only
`supplier_data_input` through PATCH on the crop endpoint. Crop identity, timing,
spacing and other metadata are not part of that request. Existing row IDs,
packaging values, status fields and other offer data are preserved. Removing all
rows sends an explicit empty list; a legacy preferred supplier does not recreate
them. Failed saves retain the draft.

Before saving, the UI reads the latest crop and merges the edited offer into
its supplier collection. Other offers added since opening the dialog are kept.
If the selected offer itself changed or was removed, saving is refused and the
draft remains available. Deletion requires confirmation and removes only that
crop offer, preserving the supplier entity and normalized seed packages.

The normal crop editor omits supplier writes, so an unrelated crop edit cannot
overwrite offers saved independently. No schema or seed-demand formula changes
are required; the existing supplier-specific packaging/TKG/germination resolution
and supplier-selection behavior remain in use.
