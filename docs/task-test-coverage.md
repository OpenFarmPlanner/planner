# Task workflow verification

The epic is verified alongside each feature; the final integration layer covers
transitions across the APIs rather than duplicating date arithmetic tests.

| Contract | Coverage |
| --- | --- |
| Project/season scoping, relational validation, server-owned provenance | `backend/farm/tests/test_planning_api.py`, `test_task_workflow.py` |
| Token read-only surface and published operations | `test_agent_api_tokens.py`, `test_public_api_schema.py` |
| Constant list query counts with multiple rows and deleted identities | `test_api_query_counts.py` |
| Direct sowing, own propagation, bought-in transplants, inherited timing, missing dates | `test_task_generation.py` |
| Rescheduling, cancellation, date overrides, unchanged completion and no duplicate IDs | `test_task_generation.py`, `test_task_workflow.py` |
| Template CRUD, signed offsets, project isolation, history | `test_task_templates.py` |
| Recurrence count, inclusive harvest endpoints, independent completion, shortened rules, limits | `test_task_recurrence.py`, `test_task_workflow.py` |
| Schema/data forward migration and rollback/replay | `test_migrations_plan_event_tasks.py`, `test_migrations_task_identity.py`, `test_migrations_task_templates.py` |
| Season deletion/restoration and plan deletion with protected/manual tasks | `test_seasons.py`, `test_task_workflow.py` |
| User-private hint retirement, authentication and preference preservation | `backend/accounts/tests/test_task_drag_hint.py`, `test_migrations_task_drag_hint.py` |
| Board filters/metrics, manual CRUD, generated editing and concurrent rollback | `frontend/src/__tests__/Dashboard.test.tsx`, `taskBoard.test.ts`, `api.test.ts` |
| Template forms, signed offsets, recurrence and failed saves/deletes | `CropTaskTemplatesSection.test.tsx` |
| Hint persistence, retry and account isolation | `useTaskDragHint.test.tsx` |
| Mouse/touch drag, empty columns, scrolling, announcements, keyboard menu, dismissal and reload | `frontend/e2e/task-dashboard.spec.ts` |
| Independent template saves and separately completable occurrences after rescheduling | `frontend/e2e/task-templates.spec.ts` |
| Supplier/package/status preservation, partial PATCH, errors, clearing and editor routing | `test_crops_api.py`, `CropsSavePayload.test.tsx`, `CropForm.test.tsx`, `CropsPersistence.test.tsx`, `frontend/e2e/crop-form-responsive.spec.ts` |
| Responsive layouts and browser-specific rendering | `frontend/e2e/responsive-layouts.spec.ts`, `frontend/e2e-cross-browser/` |

## Deliberate edge-case policies

- A past due date does not imply completion. Backfilled tasks start pending.
- Missing dates produce no invented events or occurrences. Harvest end is an
  optional standard event, but remains a template reference event.
- Source identity consists of plan/event or plan/template and an occurrence
  index, independently of date. Manual rows keep their empty source identity.
- Completion and explicit date overrides survive rescheduling; a null override
  remains null. Resetting an override uses the latest calculated baseline.
- Deleted generated tasks retain hidden identities. Cancelled/obsolete events
  and occurrences never reopen implicitly when dates or rules return.
- Shortening a recurrence cancels only unprotected open occurrences; completed
  and manually dated rows remain. The 1000-occurrence bound rejects excessive
  expansion atomically; it does not silently truncate a sequence.
- Deleting a plan detaches preserved work and cancels unprotected automatic
  work. Season deletion/restoration uses the existing batched snapshots and
  restores original task IDs, statuses, overrides and deletion markers.
- Template text is a snapshot; custom task titles/descriptions are not replaced
  by later rule edits. Canonical standard-event titles are localized only when
  still unchanged. Rules apply to the exact crop, without implicit inheritance.
- Hint retirement follows a saved drag or explicit dismissal, not an optimistic
  move, failed request or menu change. It is per user across projects/devices.
- Supplier edits send only supplier rows; general crop edits omit supplier
  writes. An explicit empty supplier list clears rows without reintroducing a
  legacy preferred supplier. Existing seed-demand calculations remain in use.

Relevant local tests, typecheck, lint, production build and visual checks are
run before feature PRs; the full backend/frontend and cross-browser suites run
in CI. Screenshot baselines are reviewed for intended changes, never updated
merely to make a failing comparison pass.
