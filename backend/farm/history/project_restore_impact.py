"""Bounded restore summaries and tokens for a confirmed project snapshot."""

import json
from hashlib import sha256
from typing import TYPE_CHECKING

from django.core.signing import BadSignature, Signer

from farm.models import format_crop_display_name

if TYPE_CHECKING:
    from .project_restore import ProjectState

_NAMES_PER_CHANGE = 5
_TOKEN_SALT = "farm.project-restore-preview.v1"
_NAMED_CATEGORIES = ("crops", "varieties", "planting_plans", "locations", "fields", "beds")
_CHANGE_TYPES = ("removed", "restored", "changed")
_CATEGORY_BY_LABEL = {
    "planting_plan": "planting_plans",
    "location": "locations",
    "field": "fields",
    "bed": "beds",
}
_AUDIT_FIELDS = {"created_at", "updated_at", "name_normalized", "variety_normalized"}
_LAYOUT_FIELDS = ("x", "y", "scale", "location_id")


def restore_preview_token(
    project_id: int, revision_id: int, current: "ProjectState", target: "ProjectState",
) -> str:
    """Bind confirmation to all domain data, including records outside the sample."""
    encoded = json.dumps([current, target], sort_keys=True, separators=(",", ":")).encode()
    fingerprint = sha256(encoded).hexdigest()
    return Signer(salt=_TOKEN_SALT).sign(f"{project_id}:{revision_id}:{fingerprint}")


def valid_preview_token_for_revision(token: str, project_id: int, revision_id: int) -> bool:
    """Reject unrelated confirmation tokens before reconstructing any state."""
    try:
        payload = Signer(salt=_TOKEN_SALT).unsign(token)
    except BadSignature:
        return False
    return payload.startswith(f"{project_id}:{revision_id}:")


def _category(label: str, row: dict) -> str:
    if label == "crop":
        return "varieties" if (row.get("variety") or "").strip() else "crops"
    return _CATEGORY_BY_LABEL.get(label, "other")


def _name(label: str, row: dict, state: "ProjectState") -> str:
    if label == "planting_plan":
        crop = state["crop"].get(str(row.get("crop_id")), {})
        bed = state["bed"].get(str(row.get("bed_id")), {})
        return " · ".join(filter(None, (_name("crop", crop, state), bed.get("name"))))
    if label == "crop":
        return format_crop_display_name(row.get("name"), row.get("variety")) or ""
    return row.get("name") or ""


def _changed(label: str, old: dict, new: dict) -> bool:
    ignored = _AUDIT_FIELDS | {"orphaned_at"} if label == "media_file" else _AUDIT_FIELDS
    return any(
        old.get(field) != new.get(field) for field in (old.keys() | new.keys()) - ignored
    )


def _area_layouts(state: "ProjectState") -> dict[str, dict[str, tuple]]:
    return {
        label: {
            str(row[f"{label}_id"]): tuple(row.get(field) for field in _LAYOUT_FIELDS)
            for row in state[f"{label}_layout"].values()
        }
        for label in ("bed", "field")
    }


def summarize_restore(current: "ProjectState", target: "ProjectState") -> list[dict]:
    """Describe the change to each active row once. Only the name samples are capped."""
    counts = {
        category: {action: {"count": 0, "names": []} for action in _CHANGE_TYPES}
        for category in (*_NAMED_CATEGORIES, "other")
    }
    current_layouts, target_layouts = _area_layouts(current), _area_layouts(target)
    for label, current_rows in current.items():
        if label in ("bed_layout", "field_layout"):
            continue
        target_rows = target[label]
        current_layout = current_layouts.get(label, {})
        target_layout = target_layouts.get(label, {})
        for key in sorted(current_rows.keys() | target_rows.keys(), key=int):
            old, new = current_rows.get(key), target_rows.get(key)
            active_now = old is not None and old.get("deleted_at") is None
            active_then = new is not None and new.get("deleted_at") is None
            if not active_now and not active_then:
                continue
            if not active_then:
                action, row, state = "removed", old, current
            elif not active_now:
                action, row, state = "restored", new, target
            else:
                same_layout = current_layout.get(key) == target_layout.get(key)
                if same_layout and not _changed(label, old, new):
                    continue
                action, row, state = "changed", new, target
            category = _category(label, row)
            entry = counts[category][action]
            entry["count"] += 1
            if category != "other" and len(entry["names"]) < _NAMES_PER_CHANGE:
                name = _name(label, row, state)
                if name:
                    entry["names"].append(name)
    return [
        {"category": category, **changes}
        for category, changes in counts.items()
        if any(impact["count"] for impact in changes.values())
    ]
