# QA Coverage — 2026-07-27

Targeted localhost public crop-library and moderation workflow audit based on
Git commit `7c3a6b0a` on branch `fix/simplify-publishing-wizard`.

## Audited areas

| Area | Viewports | Result |
|---|---|---|
| Public crop-library collaboration E2E | 1440x900, 390x844 | quick import dialog, full library navigation, import, detail persistence, discussion, direct edit, version restore, and mobile layout pass locally |
| Public crop edit form | 1440x900 | shared crop form opens from the public library, saves changed timing/notes, and records versions |
| Public crop import dialog | 1440x900 | search, selection, project import, and link to the full public library pass locally |
| Moderator request flow | 1440x900 | normal user can submit a moderator request from account settings |
| Moderator permissions | 1440x900 | normal user is blocked from moderation page; approved moderator can access species moderation without seeing admin-only moderator requests |
| Admin moderation queue | 1440x900 | staff admin can approve a crop-species proposal and approve a moderator request |
| Moderator species review | 1440x900 | approved non-admin moderator can reject a species proposal |

## Findings

- The first localhost E2E run reused an already-running backend on port 8000
  with an unmigrated local database. `/api/crop-species/` failed with
  `column crops_cropspecies.proposed_by_id does not exist`. Running
  `cd backend && DJANGO_ENV=development DEBUG=True E2E_TEST_TOKEN=openfarmplanner-e2e-token uv run python manage.py migrate`
  applied `crops.0003...` and fixed the local environment.
- No application-code regression was found during the public-library and
  moderation workflow pass after the local migration was applied.

## Verification

- `cd frontend && npm run build`
- `cd frontend && npx playwright test e2e/public-crop-library.spec.ts`
- Temporary local Playwright QA spec for moderator request/admin approval/
  non-admin moderator review; deleted after the run.
- `cd frontend && npm run test -- PublicCropLibraryPage PublicCropLibraryDialog PublicLibraryModerationPage AccountSettingsPage cropSections i18n`
- `cd backend && pdm run python manage.py test crops.tests.test_views farm.tests.test_public_crops_api farm.tests.test_crops_api.CropApiTest.test_crop_list_query_count_does_not_scale_with_result_count --settings=config.settings_test`

## Follow-up QA — 2026-07-28

Targeted localhost discussion-flow audit on branch
`codex/implementiere-strukturiertes-diskussionssystem` at Git commit
`c7daca0f`.

### Audited areas

| Area | Viewports | Result |
|---|---|---|
| Public crop-library discussion reload | 1440x900 | passed; selected public crop loaded without showing the empty-state text |
| Discussion topic overview | 1440x900 | passed; seeded general, version-linked, and moderation topics were visible |
| Nested discussion replies | 1440x900, 390x844 | passed; root comments, replies, and nested replies rendered correctly for different logged-in users |
| New reply creation | 1440x900 | passed; member user created a nested reply through the UI |
| New discussion creation | 1440x900 | passed when opened via `http://localhost:5173`; member user created a new topic through the UI |
| Root-comment delete permissions | 1440x900 | passed; root owner saw edit but no delete action |
| Moderator root-comment soft delete | 1440x900 | passed; moderator soft-deleted a root post and its child reply remained visible |

### Findings

- No discussion-flow application regression was found in the localhost run.
- Local POST requests fail CSRF origin checks when the frontend is opened as
  `http://127.0.0.1:5173`; use `http://localhost:5173` for this local setup.

### Verification

- Temporary local Playwright multi-user discussion-flow script against
  `http://localhost:5173/app/crop-library?cropId=56`.

## Follow-up QA — 2026-07-28 Navigation And Deletion

Targeted discussion navigation and deletion audit on branch
`codex/implementiere-strukturiertes-diskussionssystem`.

### Audited Areas

| Area | Viewports | Result |
|---|---|---|
| Public crop-library discussion routing | automated router regression | passed; discussion overview/thread state is URL-backed and browser back/forward restores overview/thread |
| Discussion direct links | automated router regression | passed; direct thread URLs load the selected crop, discussion tab, topic, and comments |
| Internal discussion back action | automated router regression | passed; "Alle Diskussionen" deterministically removes only `discussionId` |
| Incompatible URL state | automated router regression | passed; crop and tab switches remove stale `discussionId`, unknown `discussionId` falls back to overview |
| Deleted comment placeholders | automated frontend/backend regression | passed; author deletion and moderator removal render distinct neutral placeholders without moderator names |
| Root discussion deletion rules | automated frontend/backend regression | passed; root deletion checks visible replies only, moderators can always delete, and empty topics disappear from the normal overview |

### Verification

- `cd frontend && npm run test -- PublicCropLibraryPage.test.tsx`
- `cd backend && pdm run python manage.py test farm.tests.test_public_crops_api --settings=config.settings_test`
- `jq empty frontend/src/i18n/locales/de/crops.json frontend/src/i18n/locales/en/crops.json`
- `cd frontend && npm run lint`
- `cd frontend && npm run build`

## Follow-up QA — 2026-07-28 Bilingual Publishing

Targeted localhost crop publishing audit on branch
`agent/move-language-selector-header` at Git commit `a2caf390`.

### Audited Areas

| Area | Viewports | Result |
|---|---|---|
| German crop publishing wizard | 1440x900 | passed; wizard opened from the selected project crop, selected the official species, defaulted the original language to German, showed the licence confirmation for the first publication, and published successfully |
| English crop publishing wizard | 1440x900 | passed; after switching the account UI language to English, the wizard labels changed to English, defaulted the original language to English, skipped the already-accepted licence confirmation, and published successfully |
| Public crop-library language fallback | 1440x900 | passed; German-only public notes remained German in the English UI with the English fallback notice, and English-only public notes remained English in the German UI with the German fallback notice |
| Public crop-library localized species display | 1440x900 | passed; the shared tomato species displayed through the active UI language while user-entered variety names and notes remained unchanged |

### Findings

- No bilingual publishing regression was found in the localhost run.
- The publishing wizard's first-click behaviour is two-stage when public
  library contribution terms have not yet been accepted: preview first,
  licence confirmation second, final publish after the checkbox is checked.
  After the terms are accepted, a later publication can complete directly from
  the first publish click. This matched the expected behaviour.

### Verification

- `cd backend && DJANGO_ENV=development DEBUG=True FRONTEND_URL=http://localhost:5173 CORS_ALLOWED_ORIGINS=http://localhost:5173 CSRF_TRUSTED_ORIGINS=http://localhost:5173 E2E_TEST_TOKEN=openfarmplanner-e2e-token pdm run python manage.py migrate`
- Temporary inline Playwright script against `http://localhost:5173` and
  `http://localhost:8000`, scenario
  `qa-bilingual-publish-1785241573703`.
