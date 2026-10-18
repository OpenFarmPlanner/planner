# Changelog

All notable changes to this project will be documented in this file.

The format is based on Conventional Commits and is managed by Python Semantic Release.

## Unreleased

### Fixes

- Emails to users (activation, password reset, email change, project
  invitation) are now sent in the recipient's language instead of always in
  German: the account's explicit UI language, otherwise the UI language of the
  triggering request (the inviter's for invitations), otherwise English. Each
  language has its own subject and body templates; registration stores the
  guest's UI language on the new account.

### Refactor

- Crop species: the database (`CropSpecies`, `CropSpeciesTranslation`) is now the
  only source of crop-species names, synonyms, regional names and languages.
  `backend/crops/seed_data.py` was retired; its content survives unchanged as the
  frozen bootstrap snapshot `backend/crops/migrations/data/species_bootstrap_v1.json`,
  read only by the historical migrations of a fresh database. New names are
  maintained through the crop-species API only.
