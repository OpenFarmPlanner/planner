# Frozen crop-species bootstrap snapshot

**Frozen. Do not edit.**

`species_bootstrap_v1.json` is the starting crop-species catalogue (names,
search aliases, regional display names) that the historical `crops` migrations
write into a fresh database. It is the former content of
`backend/crops/seed_data.py`, copied unchanged when that file was retired.

- The database (`CropSpecies`, `CropSpeciesTranslation`) is the only source of
  crop-species names, synonyms and regional names.
- New names, synonyms or languages are maintained **only through the API**
  (crop-taxonomy admin endpoints / Django admin), never by editing this file.
  Editing it would make a fresh database differ from every existing one
  without any migration recording the change.
- `species_bootstrap.py` is the only reader. It imports no app code, so the
  migrations that use it stay reproducible.
- `crops/tests/test_species_bootstrap_snapshot.py` guards the snapshot's
  integrity.

The naming and alias rules that used to live as comments next to this data are
in [`docs/crop-taxonomy-guidelines.md`](../../../../docs/crop-taxonomy-guidelines.md).
