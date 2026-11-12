# Crop-specific properties

`Crop` and `PublicCrop` each own a `specific_properties` JSON dictionary.
The initial properties are potato cooking type (`waxy`, `mostly_waxy`,
`floury`) and maturity group (`very_early`, `early`, `medium_early`,
`medium_late`, `late`). Both are optional. Maturity group is descriptive;
growth duration remains an independent planning value and never supplies it.

## Registry and database identity

[`specific_properties.v1.json`](../backend/crops/specific_properties.v1.json)
is the versioned definition registry. It declares types, stable property and
option IDs, validation constraints and frontend translation keys. Both Python
and TypeScript read this same file. Vite permits that exact file outside its
frontend root; it does not expose the backend directory through the dev server.
The agent OpenAPI document exposes the same registry under
`x-crop-specific-properties`.

Species identities and names remain database records. A curated
`CropSpecies.specific_property_profile` attaches a registry profile to a
species; the current profile is `solanum_tuberosum`. Runtime applicability
uses that stored metadata, never a translated name, synonym or scientific-name
guess. Renaming a species does not change its profile. The read-only profile
is returned by species, project-crop and public-crop APIs so the form can show
the fields immediately when a species is selected, even without a variety or
an existing public-library entry.

Staff can maintain profiles in the species-profile Django admin; names remain
read-only there and continue to be maintained through the species API. A
profile change that would invalidate existing values is rejected. To add a
property, extend the registry and all four translation bundles; to use a new
profile, attach it to the appropriate database species through that admin.
Neither operation needs a property-specific model column or schema migration.
Keep used IDs stable; retiring or reinterpreting existing values needs an
explicit compatibility/data-conversion plan.

## Ownership and validation

Properties belong to the selected record. A variety does not inherit its
general crop's dictionary; a crop without a variety may have its own values.
The form and both detail views put the compact property section after general
information and before rotation properties. Empty read-only values/sections
are hidden, while captions distinguish crop values from variety values.

Project and library writes validate keys, types, options and applicability to
the linked species. The profile cannot be forged through a crop write. A
species change that would leave incompatible values is rejected. The form
retains those values when the species changes and offers an explicit action
to remove them; choosing the previous species restores their controls. It
does not silently discard or publish hidden values.

Library publication, proposals, explicit sync, import, revisions and local
pinning include the dictionary. Pinning applies to the whole property group.
Publishing a variety does not seed the automatically created general entry
with variety-only properties; any copied general properties come from the
project's general record and respect its local pin. Private and public
dictionaries are copied rather than sharing mutable values. Updating either
record does not implicitly overwrite the other. Old revisions without the
field restore an empty dictionary instead of retaining newer values.

## API and spreadsheet exchange

An omitted `specific_properties` field preserves the dictionary. An explicit
JSON dictionary replaces it, including `{}` to clear it:

```json
{"specific_properties": {"cooking_type": "waxy", "maturity_group": "early"}}
```

CSV, XLSX and ODS use ordinary localized columns such as `Kochtyp` and
`Reifegruppe`, with localized option labels in de/en/fr/es. Canonical column
keys are `specific_properties.cooking_type` and
`specific_properties.maturity_group`; plain property IDs are accepted aliases.
No JSON cell is required. Export includes only columns relevant to the species
in the export, leaving inapplicable mixed-species cells empty.

The spreadsheet importer resolves the species from the database before
validating the properties. Nonempty property cells merge with the existing
dictionary; empty cells preserve existing values. Explicit JSON still means
replacement, with supplied individual columns applied to that dictionary.
Unknown keys, unsupported options or inapplicable properties produce row-level
preview errors (`specific_properties_invalid`) and are rejected on apply.
The agent's draft importer uses the same rules. Import templates include a
localized potato example with both properties.

Migration `crops.0020_crop_specific_properties` adds profile metadata and assigns
the initial profile to existing rows with botanical metadata `Solanum tuberosum`
or the published canonical potato record (`kartoffel`) when botanical metadata
is absent. This one-time legacy identity mapping never runs in application
code. It neither creates species nor changes their names.
`farm.0140_crop_specific_properties` adds the two JSON dictionaries, initially
empty. Schema rollback drops the new fields and their values; restoring a
pre-deploy backup is needed if those values must be recovered. Historical
revision snapshots are not rewritten.
