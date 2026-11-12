"""Locale-specific companion prose; identity and reason remain language neutral."""

from typing import Any

from rest_framework import serializers

from config.languages import (
    SUPPORTED_LANGUAGE_CODES,
    normalize_language_tag,
    resolve_request_language,
)


def validate_notes(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        raise serializers.ValidationError("Companion notes must be an object.")
    result: dict[str, str] = {}
    for language, text in value.items():
        if language not in SUPPORTED_LANGUAGE_CODES or not isinstance(text, str) or len(text) > 500:
            raise serializers.ValidationError(
                "Use supported language codes and notes of at most 500 characters."
            )
        result[language] = text
    return result


def notes_of(item: Any, legacy_language: str = "de") -> dict[str, str]:
    if isinstance(item, dict):
        if "notes" in item:
            return dict(item.get("notes") or {})
        note = item.get("note") or ""
    else:
        if item.notes:
            return dict(item.notes)
        note = item.note
    return {legacy_language: note} if note else {}


def note_language(context: dict[str, Any], explicit: str | None = None) -> str:
    if explicit is not None:
        language = normalize_language_tag(explicit) if isinstance(explicit, str) else ""
        if not language:
            raise serializers.ValidationError({"note_language_code": "Unsupported note language."})
        return language
    request = context.get("request")
    return resolve_request_language(request) if request is not None else "de"


def merge_notes(existing: dict[str, str], patch: dict[str, Any], language: str) -> dict[str, str]:
    language = note_language({}, language)
    result = dict(existing)
    for code, text in validate_notes(patch.get("notes", {})).items():
        if text or code in result:
            result[code] = text
    if "note" in patch and ("notes" not in patch or "note_language_code" in patch):
        text = patch["note"]
        if not isinstance(text, str) or len(text) > 500:
            raise serializers.ValidationError({"note": "Use a note of at most 500 characters."})
        if text or language in result:
            result[language] = text
    return result


def legacy_note(notes: dict[str, str]) -> str:
    """Keep the old storage field useful; localized reads never fall back to it."""
    return notes.get("de") or next((text for text in notes.values() if text), "")


def localize_companions(
    items: Any, language: str, legacy_language: str = "de"
) -> list[dict[str, Any]]:
    return [
        {
            **item,
            "notes": notes_of(item, legacy_language),
            "note": notes_of(item, legacy_language).get(language, ""),
            "note_language_code": language,
        }
        for item in items or []
        if isinstance(item, dict)
    ]


def merge_library_notes(
    items: list[dict[str, Any]],
    existing: list[dict[str, Any]],
    language: str,
) -> list[dict[str, Any]]:
    def identity(item: dict[str, Any]) -> tuple[Any, Any]:
        return item.get("species"), item.get("family")

    previous = {identity(item): item for item in existing or []}
    result = []
    for item in items:
        item = dict(item)
        selected = item.pop("note_language_code", language)
        notes = merge_notes(notes_of(previous.get(identity(item), {})), item, selected)
        item.update(notes=notes, note=legacy_note(notes))
        result.append(item)
    return result


def companion_language_patch(
    items: list[dict[str, Any]], language: str | None
) -> list[dict[str, Any]]:
    if language is None:
        return items
    result = []
    for item in items:
        notes = notes_of(item)
        result.append({**item, "notes": {language: notes[language]} if language in notes else {}})
    return result
