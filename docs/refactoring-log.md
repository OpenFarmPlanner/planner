# Refactoring log

Date: 2026-09-08

This log groups the refactoring pass by review area. It records both behavioral
changes and guardrails so reviewers can inspect or revert each area separately.

## 1. Frontend theme-token audit

- Added an ESLint rule that identifies literal hex/RGB colours and pixel values
  in common style properties. It currently reports warnings so the existing
  legacy backlog remains visible without hiding errors from the normal lint
  gate; newly touched styles should resolve each warning with a theme token or
  MUI spacing value.
- Replaced the crop-library list and dialog's literal shadows with MUI elevation
  tokens and replaced the loading mask colour with the theme's action token.
- Kept data colours (user-selected crop colours), brand-logo SVG fills, test
  fixtures, and the vendored Gantt implementation outside this styling rule's
  semantic scope.

## 2. Kulturbibliothek publish/update model

- Kept project-copy pulls routed through the shared public-crop import service.
- Corrected the publish endpoint's response contract: creating an entry returns
  `201 Created`, while updating or restoring the established entry returns
  `200 OK`. Tests now assert the operation-specific result for update cases.
  This makes the HTTP result match the same create/update distinction already
  returned in the response's `operation` field.

## 3. Live inheritance

- Fixed the frontend effective-value accessor to distinguish an explicitly
  resolved `null` from a missing `effective_values` property. An authoritative
  backend `null` can no longer fall through to stale raw variety data.
- Added regression coverage for both authoritative-null and legacy-payload
  fallback behavior. The edit-form baseline stripping and multilingual public
  text editor remain raw-input paths; neither stores displayed fallback text.

## 4. Disabled-control explanations

- Added keyboard- and pointer-accessible explanatory tooltips to the season
  copy confirmation when no source season is selected and to transition-season
  creation when no transition option is selected.
- Used `AppTooltip` and a wrapper element so disabled MUI buttons remain
  describable even though disabled controls do not emit pointer events.

## 5. DRF error and response consistency

- Added one shared `api_error_response` builder for the stable `{code, detail,
  ...context}` error envelope and migrated repeated Crop Library permission,
  validation, not-found, and moderator responses to it.
- Added a focused unit test proving status and contextual validation data are
  retained. The publish response correction in area 2 removes a separate
  create/update status inconsistency.

## 6. i18n coverage

- Moved the version-restore dialog's German literals into the German `crops`
  resource first, then supplied matching English resources.
- Routed the global overflow button's German `aria-label` through the existing
  navigation resource. Dialog titles, explanations, notices, and actions now
  all react to the selected UI language.

## 7. Seasons and migration tests

- Added API integration coverage for an overlapping pattern transition. The
  test verifies the overlap is reported precisely and that the due period is
  not silently shifted.
- Hardened migration `0101` for fresh installs and migration tests: a linked
  variety is cleared only when a general-crop inheritance target exists;
  otherwise its sole values are preserved. Missing values are promoted to an
  existing general crop before the dead override is cleared.
- Extended the migration test with an orphan linked variety to lock in the
  no-silent-data-loss behavior.

## Validation notes

- Frontend ESLint and the focused inheritance unit suite pass locally.
- Python modules compile successfully. Backend tests could not be executed in
  this container because the project-mandated `pdm` executable is unavailable.
- The disabled-control changes do not alter layout at any breakpoint: each
  button remains in the same dialog action slot and is wrapped only for tooltip
  event handling. Desktop and mobile use the same MUI dialogs. A browser
  screenshot could not be produced because the backend test/dev runner depends
  on the unavailable PDM environment.
