# Changelog

All notable changes to this project will be documented in this file.

The format is based on Conventional Commits and is managed by Python Semantic Release.

## Unreleased

### Features

- OpenFarmPlanner is now available in French and Spanish as well as German
  and English: the whole app interface, emails to users, the public pages
  (landing, about, imprint, privacy policy, terms) with their own indexable
  URLs under `/fr` and `/es`, and the crop library, which accepts and shows
  French and Spanish names and descriptions (falling back to English until
  they exist). Browsers in French or Spanish (including `fr-CA`, `es-419`,
  `es-MX`) start in their language; the switcher offers "Français" and
  "Español". The language-version clause of the terms and the privacy
  policy now names all four languages (the English version still prevails).
  Dates and numbers that were always formatted the German way now follow the
  active language.
- Editing in the tables (Anbauflächen, Anbaupläne) now works like a
  spreadsheet on desktop: a single click only selects a cell, editing starts
  with a double click, Enter, F2 or by just typing (date and select cells:
  double click, Enter or F2). Editable cells show a text cursor. A single
  click on an editable cell shows a short hint, at most three times and
  never again once the user edited a cell or closed it, on every device. Touch
  devices and narrow screens keep tap-to-edit.

### Fixes

- Anbauflächen: clicking a cell in another row while a row was being edited
  no longer makes the focus jump back to the saved row; the clicked cell
  stays selected. In edit mode the name keeps its hierarchy indentation.

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
