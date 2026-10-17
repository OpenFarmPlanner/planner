# Changelog

All notable changes to this project will be documented in this file.

The format is based on Conventional Commits and is managed by Python Semantic Release.

## Unreleased

### Refactor

- Crop species: the database (`CropSpecies`, `CropSpeciesTranslation`) is now the
  only source of crop-species names, synonyms, regional names and languages.
  `backend/crops/seed_data.py` was retired; its content survives unchanged as the
  frozen bootstrap snapshot `backend/crops/migrations/data/species_bootstrap_v1.json`,
  read only by the historical migrations of a fresh database. New names are
  maintained through the crop-species API only.
