# Refactoring log

## 2026-09-12 comprehensive audit

### Theme tokens and lint guard

- Closed the remaining theme-token lint gap for pixel-based border radii.
  Application-owned styles must now derive radii from the theme just as they
  already derive colours and spacing, while percentages such as circular
  `50%` radii remain valid.
- Replaced the mobile help sheet's literal corner radii with values derived
  from the theme spacing scale and added focused rule coverage to prevent a
  regression.
- Removed the remaining application colour and pixel literals from the global
  stylesheet. Root/link colours and the minimum body width now live in the
  theme's `MuiCssBaseline` overrides and consume semantic palette/spacing
  tokens while retaining the existing rendered values.
- Cleared the two legacy component findings exposed by the border-radius rule:
  the stable DataGrid scrollbar thumb and yield-chart swatches now use MUI
  radius factors with unchanged rendered corner sizes.

### API error consistency

- Routed the last-login-method social-account rejection and the public-crop
  import confirmation conflict through the shared API error response builder.
  Their status codes, stable codes, details, and conflict context remain
  unchanged, but these endpoint branches no longer duplicate the canonical
  error-envelope construction.
- Standardized supplier-create payload failures without breaking field-level
  consumers: these responses now include the stable English
  `invalid_supplier_payload` code and detail alongside their established field
  validation arrays.
- Applied the same envelope to duplicate supplier names raised by the
  service-level create path, so expected supplier-create failures now expose
  a code and English detail consistently while retaining the localized `name`
  field error used by the existing form.

### Disabled-state explanations

- Added a reachable, localized explanation to the additional-location
  dialog's disabled submit action. An empty location name now points users to
  the required field instead of leaving the unavailable action unexplained,
  with an interaction test covering the tooltip.
- Limited that explanation to the actually disabled state. Once a location
  name is entered, the enabled submit action no longer retains an obsolete
  required-field tooltip; the interaction test covers both transitions.
- Added the shared busy-state explanation to disabled project-history menu
  actions on desktop and mobile. The same shared disabled-menu wrapper now
  handles both history variants and the unavailable page-help item instead of
  retaining a menu-specific wrapper implementation.

### Internationalization coverage

- Extended the hardcoded-copy ESLint guard to image alternative text, closing
  an accessibility-facing attribute gap while continuing to allow the empty
  `alt` value used for decorative images.
- Re-ran the maintained-source lint audit and compared the complete German and
  English namespace key sets. No hardcoded UI copy remains under the guard,
  every locale key is shared by both languages, and no German-authored key was
  removed.

### Shared business logic

- Consolidated metre/centimetre boundary conversion into a typed measurement
  utility. Public-crop form adaptation and the interactive crop form now share
  the same rounding and null-handling rules instead of maintaining parallel
  implementations; SI storage remains converted only at the form/API boundary.
- Centralized supplier validation messages shared by service-level creation,
  serializer validation, and integrity-error handling. Supplier endpoints now
  have one source for required-name, URL, domain-list, domain-format, and
  duplicate-name wording without changing their established response payloads.

### Test coverage

- Added focused unit coverage for the shared measurement boundary, including
  half-centimetre rounding, zero, and the intentionally different null output
  contracts used by form drafts and API payloads.
- Completed the supplier validation consolidation with explicit serializer and
  view method types, making the field-value boundary and update contract clear
  to static analysis without changing API behavior.

### Documentation

- Updated the design-system enforcement reference to include tokenized border
  radii and documented how compound radii should be derived.
- Documented the maintained-source i18n lint boundary, including its
  accessibility attributes, decorative-image exception, and vendor/test
  exclusions.

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

### CI repair

- Updated five stale authentication test expectations to the API's established
  English response contract, in line with the repository language rules.
- Removed an accidental contradictory project-invitation assertion introduced
  while extending membership error coverage, and removed two Ruff `F841`
  findings (one unreachable assignment after a return and one unused test
  response variable).

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
- Extended the shared envelope to project switching and membership mutation,
  with stable codes for malformed/inaccessible projects, invalid roles, and
  forbidden self-mutation. Removed duplicate unreachable "last admin" checks:
  these endpoints require the caller to be an admin and already reject changes
  to that caller's own membership, so mutating another admin necessarily leaves
  the caller in place.
- Standardized note and media processing failures next. Backend-unavailable,
  invalid processed-image, and per-note attachment-limit responses now expose
  stable codes; the limit response also includes the numeric limit so clients
  do not need to parse the English detail. DRF field-validation dictionaries
  remain unchanged for missing/invalid form fields.
- Standardized the location-layout endpoint's collection-shape and ownership
  validation errors as `invalid_layout_collections` and
  `invalid_location_layout`. Focused integration tests now pin both codes while
  retaining the detailed ownership message used by existing clients.
- Routed agent-import execution and token-context failures through the same
  builder without changing their established codes. Completed the remaining
  seasons transition errors with codes for malformed manual dates, inapplicable
  transitions, and seamless periods where a transition is not required; one
  focused API test locks all three distinctions.
- Completed the remaining Crop Library discussion and seed-demand selection
  errors. Comment ownership/deleted-state conflicts and malformed or
  unavailable supplier selections now expose stable codes, with integration
  tests covering each branch.
- Standardized the last manually-built Crop Library relation-validation and
  project-invitation error envelopes through `api_error_response`. Relation
  failures retain their field-level arrays for backwards compatibility while
  also exposing stable machine-readable codes.
- Moved the shared error builder from the farm app boundary into `config` and
  retained the old import as a compatibility re-export. Authentication
  activation, login, and session errors can now use the same envelope without
  introducing an accounts-to-farm dependency; focused tests pin their codes.
- Completed the remaining manually constructed account validation responses:
  email/password changes, deletion restoration, and password-reset confirmation
  now expose stable codes while preserving their existing status and detail
  contracts. Existing endpoint tests assert the new codes.
- Removed the four duplicate email-delivery error payloads in the account API.
  Registration, activation resend, email change, and password reset now share
  one response helper, and the pending-deletion login response uses the same
  project-wide envelope builder without changing its contextual timestamp.

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

### Shared response import cleanup

- Migrated all backend callers and the response-builder unit test to the
  canonical `config.responses` module after the cross-app rollout. Removed the
  temporary farm compatibility re-export so new code has one discoverable
  import path and cannot recreate app-layer coupling.
- Finished the notes/media upload validation branches that deliberately bypass
  serializers for multipart files. Missing, oversized, or invalid uploads now
  include stable codes while retaining the established `file`/`image` arrays;
  focused API tests cover every manual branch.
- Closed the remaining disabled-action gaps in the season copy and suggested
  season dialogs. Cancel and primary actions now explain active submissions,
  while missing-selection guidance remains distinct from the busy state.
- Corrected the live-inheritance write boundary: non-empty species-invariant
  Sorte values are now rejected instead of silently cleared or promoted, and
  unrelated updates preserve legacy raw columns. The override migration now
  retains linked orphan values when no general Kultur exists; API and migration
  regressions cover both no-silent-change guarantees.
- Aligned runtime resolution with that orphan-migration guarantee. A linked
  Sorte without a general Kultur now reads its own raw invariant value,
  unrelated edits do not auto-create an empty Kultur, and explicit cleanup
  refuses to remove the only copy. Service and API tests cover the full path.
- Removed the final resolver split-brain for linked orphans:
  `build_effective_crop_values` now delegates every field to
  `resolve_crop_field`, so single-field and bulk effective reads return the
  same raw fallback when no inheritance source exists.
- Repaired the CI regressions the previous two entries left behind. The
  species-invariant write boundary now routes a Sorte-level value to the
  general Kultur (filling a gap, or matching what it already says) and rejects
  only a value that would contradict it, so creating the first Sorte for a
  species keeps working while nothing is dropped silently. Promotion and
  clearing are scoped to the fields a write actually sent. The auth API tests
  again assert the German response texts the endpoints really return.

## 2026-09-10 comprehensive audit

### Theme tokens and lint guard

- Replaced the remaining authentication-shell colour, focus-ring, border, and shadow literals with semantic surface/primary tokens, `alpha()` derivations, and theme elevations.
- Migrated the graphical-field zoom badge and crop requirement/snackbar styling to palette-derived colours and elevations. Dynamic canvas colours and user-selected crop colours remain domain data, while the vendored Gantt implementation remains outside the application-theme boundary documented in the design system.
- Re-ran the theme-token ESLint guard and TypeScript build after the migration. The changed authentication, graphical-field, and crop styles are clean; the audit also confirmed a legacy warning backlog elsewhere, now accurately documented in the design-system guide.

### API error consistency

- Routed malformed crop-import payloads and supplier deletion/restoration conflicts through the shared API error builder. These failures now consistently expose a stable `code` and English `detail` while retaining useful context such as supplier usage.
- Added endpoint regression tests for both malformed crop-import shapes and the supplier-in-use conflict envelope.

### Disabled-state explanations

- Wrapped the consent gate's mutually disabled accept/logout actions in the shared disabled-action tooltip. During an in-flight consent request, both controls now expose the existing localized busy explanation instead of silently becoming unavailable.

### Internationalization coverage

- Swept maintained TSX sources (excluding tests and the vendored Gantt package) for literal JSX text and user-facing label, title, placeholder, helper-text, and ARIA attributes; no application-owned hardcoded UI copy remained.
- Compared the complete nested key sets of every German and English locale namespace. The sets remain identical, confirming that no shared key was deleted and that the existing German-first resources retain matching English coverage.

### Shared business logic

- Rechecked the crop import/publish, inherited crop-value, crop display-name, season transition, seed-demand, and supplier deletion flows for parallel implementations across the frontend and backend. The domain calculations remain backend-owned services; frontend counterparts are presentation/validation boundary helpers rather than competing business rules. No additional duplication was introduced solely to manufacture an abstraction.
- The API work above reused the project-wide `api_error_response` utility instead of adding endpoint-local envelope builders, and the consent work reused `DisabledActionTooltip` plus the shared `common.disabledReasons.busy` key.

### Test coverage

- Added interaction coverage for the consent gate's in-flight state: both actions are asserted disabled and the shared German explanation is asserted reachable through the tooltip.
- Added backend integration coverage for the standardized crop-import and supplier error envelopes, targeting the newly changed high-branching endpoint paths rather than duplicating broad CRUD coverage.

### Documentation

- Corrected the design-system guide's stale approximate literal count. It now describes the ESLint warning inventory, its intentional exclusions, and the important distinction between a successful lint process and zero warnings.
- Kept this log updated in every area-specific commit so theme, API, disabled-state, i18n, shared-logic, test, and documentation changes can be reviewed or reverted independently.

### 2026-09-10 continuation

- Cleared the complete 43-item theme-token warning inventory across shared
  DataGrid/hierarchy surfaces, public landing/demo pages, chart overlays, and
  transient feedback. Values now use palette tokens, theme alpha derivations,
  spacing units, or elevations.
- Promoted the theme-token ESLint rule from warning to error now that its
  maintained-source inventory is empty. This turns the audit into a durable
  regression gate rather than a point-in-time cleanup.
- Consolidated the remaining Crop Library moderation, proposal-state, edit
  conflict, and disconnected-social-account failures on
  `api_error_response`. The social-account 404 now also has the stable
  `social_account_not_found` code that was missing from its peer errors.
- Continued the disabled-control sweep through supplier editing, feedback
  submission, note saving, attachment upload, and camera capture. Busy,
  missing-required-field, missing-file, and camera-readiness states now expose
  German-first explanations through the shared disabled-action tooltip.
- Extended the sweep to login/restore, project creation, and crop export
  actions. The shared tooltip now supports full-width controls without changing
  auth-page layout, and each busy or prerequisite state uses existing localized
  guidance.
- Restored compatibility with minimal MUI themes used by isolated component
  tests: auth alpha derivations now fall back to standard MUI background
  tokens when the application-specific `surface` palette is absent.
- Added persistent disabled-state guidance to the hierarchical area assignment
  form. Field and bed selectors explain the missing parent choice or empty
  hierarchy level, and the apply action points users to the required bed
  selection instead of remaining silently unavailable.
- Extended the area-assignment interaction suite to pin both the persistent
  downstream-selector explanation and the apply-button tooltip after changing
  a parent hierarchy selection.
- Corrected the helper ownership found during review: location guidance now
  belongs to the disabled field control and field guidance to the disabled bed
  control, so each message is associated with the input it explains.
- Finished the remaining structured backend-error sweep: guest-demo
  restrictions, non-revertible history batches, and invalid public-crop links
  now use the shared response builder. Serializer/service field dictionaries
  remain deliberately untouched because they preserve field-level validation.
- Closed a token-lint AST gap for literal SVG `fill` and `stroke`
  attributes, while explicitly excluding vendor-authentication logo artwork.
  Graphical field, bed, and alignment-guide shapes now consume semantic theme
  palette colours; the remaining dark-mode DataGrid literal uses
  `action.selected`.
- Extended the style-value visitor through nested conditional/logical
  expressions, closing the gap that allowed a literal Gantt fallback colour
  inside `task.color || ...`. The fallback is now the theme primary token;
  task-provided crop colours remain domain data.
- Consolidated the repeated disabled-menu wrapper pattern into
  `DisabledMenuItemTooltip` and applied it to shared row/table copy actions.
  Empty context-menu states now explain that there is no row or table data to
  copy, with German-first translations and direct wrapper regression coverage.
- Added an ESLint i18n guard for literal JSX text and user-facing
  `aria-label`, helper, label, placeholder, and title attributes. Tests and
  the vendored Gantt package are excluded; maintained application components
  now fail lint if new visible copy bypasses locale resources.
- Extended the i18n guard to string and template expressions embedded in JSX
  children or user-facing attributes, closing the expression-container escape
  hatch left by the first pass without treating route/data attributes as copy.
- Followed nested conditional, logical, and concatenated JSX expressions in
  the same guard. Translation function arguments remain opaque, so locale keys
  are not mistaken for visible copy while alternate render branches are checked.
- Moved the generic requirement checklist's fallback status phrases into the
  common locale namespace. Its callers can still supply feature-specific labels,
  while the shared fallback no longer assumes German inside component code.
- Consolidated the identical desktop-grid and mobile-dialog number-input
  formatters into `formatLocalizedNumberForInput`. Both planting-plan editing
  surfaces now share grouping and precision defaults, with utility-level tests
  covering locale behavior and caller precision overrides.
- Finished the remaining crop-species approval and demo-project creation error
  branches that still constructed envelopes inline. They now use
  `api_error_response`, retain their status and contextual fields, and have
  regression assertions for stable codes, details, and unchanged state.
- Extracted the i18n lint rule from the flat config into a directly testable
  local rule module. Focused Linter coverage now pins both its visible string
  findings and its deliberate exemptions for translation calls and non-visible
  discriminator attributes.
- Extracted the theme-token guard into its own local rule module and added
  direct regression tests for colours, pixel spacing, nested fallbacks, SVG
  attributes, semantic tokens, numeric spacing, and domain-provided colours.
- Closed additional token-guard gaps for MUI's shorthand spacing properties,
  signed pixel values, pixels embedded in `calc()`, and SVG colours expressed
  through JSX expression containers.
- Cleared the four findings exposed by the expanded rule: the compact Gantt
  selector now derives its reserved adornment space from `theme.spacing`, and
  season-dialog icon alignment uses equivalent numeric spacing factors.
- Applied the shared disabled-action tooltip inside the reusable account
  settings inline editor. Save actions now distinguish missing required fields
  from an in-flight request, while cancel actions explain the busy state; the
  account settings interaction test verifies the required-fields explanation.
- Added contextual disabled explanations to project-name saving and member
  invitations. Permission, busy, unchanged-name, and missing-email states now
  reuse existing localized messages, with regression coverage for the
  unchanged-name tooltip.
- Reused the existing self-removal warning as a reachable tooltip on the
  disabled member-removal action. The member-list test now confirms that the
  current user's protected action explains why it cannot be used.
- Surfaced the matching existing role-change explanation as persistent helper
  text beneath the current user's disabled role selector, covering the adjacent
  disabled form control without relying on hover behavior.
- Restored compatibility between the public demo hero and the minimal MUI theme
  used by router-level tests. Its translucent panel now falls back to
  `common.black` when the application-only navigation palette is absent.
- Applied the same compatibility guarantee to the shared application logo: its
  focus ring falls back to the standard primary palette when tests or embedded
  consumers provide an unextended MUI theme, with focused regression coverage.
- Split the growing frontend unit suite across three deterministic Vitest shards
  in CI and increased the per-shard guard to fifteen minutes so slower runners
  retain meaningful headroom without weakening failure isolation.
- Updated project-history assertions to use the current localized restore
  action label, keeping the accessibility contract explicit rather than
  deriving the expected value from the same resource as the component.
