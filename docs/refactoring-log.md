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

## Theme and inheritance continuation

- Migrated the project-crop hierarchy, detail selector, variety overview, and
  shared DataGrid surfaces from literal colours and shadows to semantic MUI
  palette tokens, `alpha()` derivations, and elevation values.
- Removed raw-field reads from the Anbauplan cultivation-option resolver and
  the project crop list's inheritable-field filters. Both now consume the same
  authoritative effective-value accessor as Gantt and derived planning tasks.
- Added regression coverage for a Sorte whose cultivation restriction exists
  only in `effective_values`; the selector no longer incorrectly offers both
  cultivation methods in that state.

## Theme, inheritance, and planning continuation

- Finished the remaining project-crop presentation literals: hierarchy rows,
  selectors, detail panels, variety summaries, DataGrid calculated/editable
  cells, delete actions, scrollbars, contextual hints, and undo notifications
  now use semantic palette values, theme-derived alpha colours, or MUI
  elevations. User-selected crop swatches remain data rather than UI tokens.
- Corrected two additional raw/effective leaks. Crop-list family, cultivation,
  duration, nutrient, and yield filters now evaluate inherited effective values,
  and planting-plan cultivation choices resolve the same effective payload.
  A variety that inherits a single cultivation method no longer incorrectly
  offers both methods in the planting-plan editor.
- Extended structured DRF errors to yield-calendar and remaining-area validation.
  Invalid years, malformed interval parameters, inaccessible beds, missing
  excluded plans, and invalid ranges now carry stable codes while retaining the
  existing `detail` strings for compatibility.
- Added focused frontend inheritance coverage and backend assertions for the new
  planning error codes.

## 2026-09-09 follow-up audit

### Theme tokens

- Replaced the last literal crop-hierarchy hover, title-button interaction, and
  varieties-panel colours found by the source sweep with `surface` and MUI
  action tokens. Dynamic crop swatches remain user data, not design tokens.
- Continued through the crop detail selector/card and colour-picker inset;
  these now use surface palette entries, MUI elevation, and a theme-derived
  alpha value rather than embedded hex/RGB values.
- Extended the ESLint guard to cover `background`, `outlineColor`, logical
  spacing properties, and template literals, closing parser/property gaps in
  the original rule. Migrated the remaining notes/image overlays, context-menu
  backdrop, command palette backdrop, restore notice, and stable scrollbar
  colours found by that expanded sweep to palette-derived values.

### Four-case update model and live inheritance

- Re-audited the publish wizard, project-copy update dialog, public import
  endpoint, and crop-library action resolver. Pulls still converge on the
  public import/update service and pushes still converge on the publishing
  service; no competing update path was found.
- Re-audited `CULTURE_INHERITABLE_FIELDS`, the backend resolver, form baseline
  stripping, multilingual raw-value editing, and frontend effective-value
  consumers. The existing authoritative-null handling and raw edit payloads
  preserve explicit overrides without snapshotting inherited display values;
  no further copying violation was found.

### Disabled actions

- Added explanatory busy-state tooltips to translation save/cancel actions,
  all three import-conflict decisions, and version restore. The shared wrapper
  keeps explanations reachable even though native disabled buttons do not emit
  pointer events.
- Continued the moderation sweep with the species-approval and alias-save
  actions. The approval tooltip distinguishes an in-progress request from
  missing required German and English names.
- Covered every remaining moderation table action (proposal decisions, alias
  editing, moderator-request decisions, and removed-entry restoration) with
  the same localized busy explanation.

### API consistency

- Routed the remaining project-crop publish, duplicate, blocked-update, terms,
  and reject-update errors through `api_error_response`. Existing codes,
  details, context payloads, and HTTP statuses remain stable; the previously
  code-less missing-name response now has `crop_name_required`.

### Internationalization

- Moved the compact notes cell's four German accessibility labels into the
  German `common` resource first and added matching English translations. The
  compact indicator now follows the active UI language.

### Seasons and migration coverage

- Confirmed the seasons suite already covers gap, overlap, seamless-boundary,
  manual-residual, transition creation, and overlap rejection paths at service
  and API levels. Confirmed the inheritance migrations separately cover linked
  varieties, general crops, free-text/orphan varieties, and preservation of
  their only stored values. No uncovered branch requiring a new test was found
  in this follow-up.
