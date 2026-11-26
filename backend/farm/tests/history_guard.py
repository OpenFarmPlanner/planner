"""History-completeness guard: every committed API write must stay restorable.

After each successful mutating request made through the Django/DRF test client
in a farm test, the latest selectable project version is reconstructed from
history and compared with the live project state. A write path that changes a
restorable row without recording a revision makes that comparison fail with a
per-row/field diff. See docs/testing-and-ci.md#history-completeness-guard.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterator
from typing import Any

from django.test.client import Client

from farm.history.project_restore import (
    PROJECT_STATE_MODELS,
    ProjectRestoreConflict,
    ProjectState,
    _apply_recorded_parent_deletions,
    _restore_history,
    _revision_overlay,
    capture_project_state,
    reconstruct_project_state,
)
from farm.history.restore import _with_legacy_snapshot_fields
from farm.models import EntityRevision, Project

MUTATING_METHODS = frozenset({'POST', 'PUT', 'PATCH', 'DELETE'})
# Refreshed on every write or derived from other columns on restore.
IGNORED_FIELDS = frozenset({'updated_at', 'name_normalized', 'variety_normalized'})
MAX_DIFF_LINES = 40
_ISO_DATETIME = re.compile(
    r'^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})?$'
)


class HistoryGap(AssertionError):
    """The latest selectable version does not reproduce the live project."""


def latest_selectable_revision(project: Project) -> EntityRevision | None:
    """The newest entry the project history list offers (see ProjectHistoryListView)."""
    return (
        EntityRevision.objects.filter(project=project)
        .exclude(batch_operation_id__isnull=True, snapshot__has_key='_project_version_internal')
        .order_by('-created_at', '-id')
        .first()
    )


def _normalize_value(value: Any) -> Any:
    """JSON snapshots keep milliseconds; live capture keeps microseconds."""
    if isinstance(value, str):
        match = _ISO_DATETIME.match(value)
        if match:
            millis = (match.group(2) or '').ljust(3, '0')[:3]
            zone = '+00:00' if match.group(3) in (None, 'Z') else match.group(3)
            return f'{match.group(1)}.{millis}{zone}'
        return value
    if isinstance(value, list):
        return [_normalize_value(item) for item in value]
    if isinstance(value, dict):
        return {key: _normalize_value(item) for key, item in value.items()}
    return value


def _comparable_rows(model: type, rows: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Active rows by pk with restorable fields only; soft-deleted rows count as absent."""
    fields = {field.attname for field in model._meta.concrete_fields} - IGNORED_FIELDS
    if model._meta.model_name == 'crop':
        fields.add('timing_windows')
    result: dict[str, dict[str, Any]] = {}
    for pk, snapshot in rows.items():
        row = _with_legacy_snapshot_fields(model, snapshot)
        if row.get('deleted_at') is not None:
            continue
        result[pk] = {name: _normalize_value(row.get(name, '<missing>')) for name in sorted(fields)}
    return result


def state_diff(reconstructed: ProjectState, live: ProjectState) -> list[str]:
    """Readable `label#pk.field` differences between a reconstruction and the live state."""
    lines: list[str] = []
    for model, label in PROJECT_STATE_MODELS:
        restored = _comparable_rows(model, reconstructed.get(label, {}))
        current = _comparable_rows(model, live.get(label, {}))
        for pk in sorted(restored.keys() | current.keys(), key=int):
            if pk not in restored:
                lines.append(f'{label}#{pk}: live row missing from the latest version')
            elif pk not in current:
                lines.append(f'{label}#{pk}: latest version has a row that is not live')
            else:
                lines.extend(
                    f'{label}#{pk}.{name}: version={restored[pk][name]!r} live={value!r}'
                    for name, value in current[pk].items()
                    if restored[pk][name] != value
                )
    return lines


def _rows_without_evidence(
    project: Project, revision: EntityRevision, live: ProjectState
) -> list[str]:
    """Name the live rows that neither the checkpoint nor a later revision accounts for."""
    try:
        state, seen, checkpoint = _revision_overlay(_restore_history(project, revision))
        for label, objects in (checkpoint or {}).items():
            state[label].update({pk: row for pk, row in objects.items() if (label, pk) not in seen})
        _apply_recorded_parent_deletions(state, seen)
    except ProjectRestoreConflict:
        return []
    return [
        f'{label}#{pk}: no revision or checkpoint covers this live row'
        for _model, label in PROJECT_STATE_MODELS
        for pk in live[label]
        if (label, pk) not in seen and pk not in state[label]
    ]


REFUSED = 'latest version'


def check_project_history(project: Project) -> list[str]:
    """Empty when the latest selectable version reproduces the live project exactly."""
    revision = latest_selectable_revision(project)
    live = capture_project_state(project)
    if revision is None:
        return [f'{REFUSED} none: the project has no history yet'] + [
            f'{label}#{pk}: no revision or checkpoint covers this live row'
            for _model, label in PROJECT_STATE_MODELS
            for pk in live[label]
        ]
    try:
        reconstructed = reconstruct_project_state(project, revision, live)
    except ProjectRestoreConflict as exc:
        return [
            f'{REFUSED} #{revision.pk} cannot be reconstructed: {exc}',
            *_rows_without_evidence(project, revision, live),
        ]
    return state_diff(reconstructed, live)


def _request_project(client: Client, request: dict[str, Any]) -> Project | None:
    project_id = request.get('HTTP_X_PROJECT_ID') or client.defaults.get('HTTP_X_PROJECT_ID')
    if not project_id or not str(project_id).isdigit():
        return None
    return Project.objects.filter(pk=int(project_id)).first()


def _is_checked(request: dict[str, Any], status_code: int) -> bool:
    path = str(request.get('PATH_INFO', ''))
    return (
        request.get('REQUEST_METHOD', '').upper() in MUTATING_METHODS
        and 200 <= status_code < 300
        and 'preview' not in path
    )


def _gap_key(line: str) -> str:
    """`label#pk.field` identifies a gap independent of its values."""
    return line.split(':', 1)[0]


def introduced_gaps(before: list[str], after: list[str]) -> list[str]:
    """Gaps the request created; gaps left by test setup outside the client are not its fault.

    Rows that already lacked evidence before the request (fixtures written
    through the ORM) are not reported again. A request that turns a
    reconstructable project into a refused one is reported in full.
    """
    rows_before = {_gap_key(line) for line in before if not line.startswith(REFUSED)}
    refused_before = bool(before) and before[0].startswith(REFUSED)
    if after and after[0].startswith(REFUSED):
        new_rows = [line for line in after[1:] if _gap_key(line) not in rows_before]
        if refused_before:
            return [after[0], *new_rows] if new_rows else []
        return after
    return [line for line in after if _gap_key(line) not in rows_before]


def guarded_request(
    original: Callable[..., Any], on_gap: Callable[[str], None]
) -> Callable[..., Any]:
    """Wrap `Client.request` so each committed write is checked against history."""

    def request(self: Client, **request: Any) -> Any:
        method = str(request.get('REQUEST_METHOD', '')).upper()
        project = _request_project(self, request) if method in MUTATING_METHODS else None
        before = check_project_history(project) if project is not None else []
        response = original(self, **request)
        if project is None or not _is_checked(request, response.status_code):
            return response
        gap = introduced_gaps(before, check_project_history(project))
        if gap:
            shown = gap[:MAX_DIFF_LINES] + (
                [f'... {len(gap) - MAX_DIFF_LINES} more'] if len(gap) > MAX_DIFF_LINES else []
            )
            on_gap(
                f"{method} {request.get('PATH_INFO')} changed project "
                f"{project.pk} without a restorable version:\n  " + '\n  '.join(shown)
            )
        return response

    return request


def install(on_gap: Callable[[str], None]) -> Iterator[None]:
    """Generator for a pytest fixture: patch the test client for one test."""
    original = Client.request
    Client.request = guarded_request(original, on_gap)  # type: ignore[method-assign]
    try:
        yield
    finally:
        Client.request = original  # type: ignore[method-assign]
