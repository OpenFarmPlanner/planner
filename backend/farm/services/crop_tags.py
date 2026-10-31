"""Crop groups: the user's own labels on crops ("Gruppen" in the UI).

A crop row (Kultur or Sorte) holds a list of free-text group names in
``Crop.tags``; a Sorte without groups of its own uses its Kultur's
(``CROP_INHERITABLE_FIELDS``). The names are the user's, so they stay in the
project and never reach the crop library. Rules: docs/crop-groups.md.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from typing import Any

from farm.models import Crop

MAX_TAG_LENGTH = 60
MAX_TAGS_PER_CROP = 20

# List markers a spreadsheet cell may start with ("• Getreide").
_LEADING_BULLETS = re.compile(r'^[\s•‣⁃▪●·*\-–—]+')
_WHITESPACE = re.compile(r'\s+')
# Several groups in one text cell: commas, semicolons or line breaks.
_SEPARATORS = re.compile(r'[,;\n\r  ]+')


def normalize_tag(value: Any) -> str:
    """One group name as stored: no list marker, single spaces, at most MAX_TAG_LENGTH."""
    text = _LEADING_BULLETS.sub('', str(value or ''))
    return _WHITESPACE.sub(' ', text).strip()[:MAX_TAG_LENGTH].strip()


def tag_key(value: str) -> str:
    """Two names with the same key are the same group ("kräuter" and "Kräuter ")."""
    return normalize_tag(value).casefold()


def split_tag_text(text: str) -> list[str]:
    """The group names in one text value, e.g. a spreadsheet cell."""
    return [part for part in _SEPARATORS.split(text) if part.strip()]


def normalize_tags(values: Iterable[Any] | str | None) -> list[str]:
    """Group names cleaned up, without duplicates (first spelling wins), in order."""
    if values is None:
        return []
    items = split_tag_text(values) if isinstance(values, str) else list(values)
    tags: list[str] = []
    seen: set[str] = set()
    for item in items:
        tag = normalize_tag(item)
        key = tag.casefold()
        if tag and key not in seen:
            seen.add(key)
            tags.append(tag)
    return tags[:MAX_TAGS_PER_CROP]


def project_tag_spellings(project_id: int, *, exclude_crop_id: int | None = None) -> dict[str, str]:
    """The project's group names by key, in the spelling used first (oldest crop)."""
    crops = Crop.objects.filter(project_id=project_id).exclude(tags=[])
    if exclude_crop_id is not None:
        crops = crops.exclude(pk=exclude_crop_id)
    spellings: dict[str, str] = {}
    for tags in crops.order_by('id').values_list('tags', flat=True):
        for tag in tags if isinstance(tags, list) else []:
            spellings.setdefault(tag_key(tag), normalize_tag(tag))
    return spellings


def canonical_tags(
    values: Iterable[Any] | str | None,
    project_id: int | None,
    *,
    exclude_crop_id: int | None = None,
) -> list[str]:
    """``normalize_tags``, with a name the project already uses taking that spelling."""
    tags = normalize_tags(values)
    if not tags or project_id is None:
        return tags
    spellings = project_tag_spellings(project_id, exclude_crop_id=exclude_crop_id)
    return normalize_tags(spellings.get(tag.casefold(), tag) for tag in tags)
