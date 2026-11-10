# Changelog

All notable changes to this project will be documented in this file.

The format is based on Conventional Commits and is managed by Python Semantic Release.

## Unreleased

### Features

- Crops: the crop and variety form is calmer and easier to scan. Kultur and
  Sorte share one section order: general information, crop rotation, timing
  (cultivation type, then Anzuchtdauer, Wachstumszeit and Erntezeit in one
  row), plant spacing, yield ("Ertrag", formerly "Ernteinformationen", now
  without the harvest duration), seed demand, time windows, germination, site
  and plant health, companion planting, display colour and notes. Fields no
  longer show tooltips on hover: the "inherited"/"own value" tooltip on a
  Sorte's fields is gone (the green highlight and its legend stay), and only
  the three durations and the thousand kernel weight keep their explanation,
  behind an info button inside the field that opens on click, tap or keyboard.
  The help texts under the display colour, the seed rate and the safety margin
  are gone. From/to pairs (sowing depth, optimal germination temperature,
  germination time) are one field each with "Von" and "Bis" inside and an
  inline error when the minimum exceeds the maximum. The companion planting
  section shows a group heading only for neighbours it has, always offers
  "Guten Nachbarn hinzufügen" and "Schlechten Nachbarn hinzufügen" below, and
  says so when no neighbour is recorded yet.
- Crops: **time windows** (Zeiträume) for Anzucht, Direktsaat and Pflanzung,
  any number per kind, in thirds of a month ("Anfang März bis Mitte Mai") or
  calendar weeks ("KW 10 bis 14"), also across the turn of the year. They are
  edited in a new "Zeiträume" section of the crop form, shown with a year bar
  on the crop page (plus a calculated, hatched "Ernte (berechnet)" lane from
  the windows and the growth and harvest durations), and a Sorte without its
  own windows of a kind uses its Kultur's. There are no harvest windows: the
  harvest follows from planting and growth duration. The crop filter "Aussaat
  möglich im Monat" is back and matches the Anzucht and Direktsaat windows.
  Planting plans point out (never block) sowing and planting dates outside
  the windows, one hint per wrong date, with a new filter "Zeiträume" →
  "Außerhalb der Zeiträume". The spreadsheet import and export have one
  column per kind and recognise seed-catalogue column names such as
  "Vorkultur" or "Aussaat Freiland"; the import reads the terms of all four
  app languages and reports cells it cannot read without dropping the row,
  including a harvest window put into the "Erntezeitraum" column. Windows
  stay in the project and are not shared through the crop library.
- Crops: the user's own labels on crops are called **tags** (Tags) instead of
  groups, matching what they are: any number of free labels to filter by.
  The crop import reads them from the key `tags` (or `tag`) and the
  spreadsheet column "Tags" ("Étiquettes" / "Etiquetas" in French and
  Spanish exports). A tag typed in another case than an existing one
  ("kräuter" vs "Kräuter") reuses the existing tag.
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
  click on an editable cell shows a short hint right at that cell, once per
  page visit and at most three times in total, and never again once the user
  edited a cell or closed it, on every device. Touch devices and narrow
  screens keep tap-to-edit.

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
