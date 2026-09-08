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
- Audited migration `0101` alongside the runtime resolver and retained its
  original, already-applied implementation. Applied migrations are immutable;
  live no-silent-change guarantees belong in current services and serializers,
  while the existing migration test continues to lock its historical contract.
- Added explicit manual-overlap API coverage, verifying that a user-entered
  start date is returned unchanged together with the precise overlap range.

## Validation notes

- Frontend ESLint and the focused inheritance unit suite pass locally.
- Python modules compile successfully. PDM was installed through `uv tool`,
  the locked backend test environment was synchronized, and the focused API,
  migration, and seasons suite was executed.
- The disabled-control changes keep each button in the same dialog action slot;
  the shared wrapper is `inline-flex` and is used by the same MUI dialog at
  desktop and mobile breakpoints. Component tests cover the tooltip interaction,
  and the production build/prerender completed with system Chrome.

## Follow-up refactoring

- Restored migration `0101` byte-for-byte to its applied form rather than
  changing historical migration behavior after release.
- Introduced `DisabledActionTooltip` as the single event-wrapper pattern for
  disabled controls and migrated season and feedback dialogs to it. A focused
  component test exercises the disabled-button hover path.
- Preserved the Crop Library loading mask's prior translucent white semantics
  with `alpha(theme.palette.background.paper, 0.6)` instead of substituting an
  unrelated disabled-control colour.
- Scoped the theme-token lint rule away from tests, the authoritative theme,
  and vendored Gantt sources, and stopped flagging structural border widths as
  spacing violations. Application colour and spacing findings remain visible.
- Reworked the overlap integration test around the reachable manual-start
  model: regular suggestions skip existing periods, while an explicit
  overlapping date remains unchanged and is accompanied by `manual_residual`.

## Disabled-action and API consistency continuation

- Completed the seasons dialog sweep: rename, setup, period editing, pattern
  editing, copy, and transition actions now explain busy, unchanged, missing,
  and invalid-range states through the shared disabled-action tooltip.
- Extended the same pattern through Crop Library comment submission, import,
  update rejection/application, and moderation removal. German explanations
  were authored first under `common.disabledReasons` and
  `crops.disabledReasons`, with matching English resources.
- Standardized the remaining hand-written seasons endpoint failures on
  `api_error_response`. Stable machine-readable codes now accompany the
  existing English details for missing seasons, invalid pattern parameters,
  and invalid copy sources without removing the backwards-compatible `detail`.
- Added API assertions for missing-source and same-source season-copy failures.
  The full seasons test module passes with the new response envelope.
