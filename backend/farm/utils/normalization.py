"""Text normalization utilities for deduplication and matching.

This module provides functions to normalize text values (crop names, varieties,
supplier names) for consistent matching and deduplication in the database.
"""

import re
import unicodedata


def normalize_text(value: str | None) -> str | None:
    """Normalize text for matching and deduplication.
    
    Applies the following transformations:
    - Trim leading/trailing whitespace
    - Collapse multiple whitespace to single space
    - Convert to lowercase (casefold)
    
    :param value: The text to normalize
    :return: Normalized text, or None if input is None or empty
    """
    if not value:
        return None
    
    # Trim and collapse whitespace
    normalized = ' '.join(value.split())
    
    if not normalized:
        return None
    
    # Convert to lowercase
    normalized = normalized.casefold()
    
    return normalized


def normalize_supplier_name(value: str | None) -> str | None:
    """Normalize supplier name for matching and deduplication.
    
    Applies the same transformations as normalize_text, plus:
    - Remove common legal suffixes (gmbh, kg, og, e.u., ltd, inc, ag, gbr, co. kg)
    
    :param value: The supplier name to normalize
    :return: Normalized supplier name, or None if input is None or empty
    """
    if not value:
        return None
    
    # First apply basic text normalization
    normalized = normalize_text(value)
    
    if not normalized:
        return None
    
    # Remove common legal suffixes (order matters - match longer patterns first)
    legal_suffixes = [
        r'\s+co\.?\s+kg\s*$',  # Match "co. kg" or "co kg" first
        r'\s+e\.u\.\s*$',
        r'\s+ltd\.?\s*$',
        r'\s+inc\.?\s*$',
        r'\s+gmbh\s*$',
        r'\s+gbr\s*$',
        r'\s+kg\s*$',
        r'\s+og\s*$',
        r'\s+ag\s*$',
    ]
    
    for suffix in legal_suffixes:
        normalized = re.sub(suffix, '', normalized, flags=re.IGNORECASE)
    
    # Final trim
    normalized = normalized.strip()
    
    return normalized if normalized else None


_COMBINING_MARKS = re.compile(r'[̀-ͯ]')
# Ligatures that NFD leaves intact ("Cœur de bœuf" is typed "coeur de boeuf").
_LIGATURE_FOLDS = {'œ': 'oe', 'æ': 'ae'}


def normalize_search_text(value: str | None) -> str:
    """Fold text the way ``docs/search.md`` §Normalization specifies.

    Lower case, ``ß`` → ``ss``, ``œ``/``æ`` → ``oe``/``ae``, diacritics
    removed after NFD decomposition, whitespace trimmed and collapsed. Mirrors
    ``normalizeSearchText`` in ``frontend/src/search/searchText.ts``.
    """
    compacted = ' '.join((value or '').split()).lower().replace('ß', 'ss')
    for ligature, folded in _LIGATURE_FOLDS.items():
        compacted = compacted.replace(ligature, folded)
    return _COMBINING_MARKS.sub('', unicodedata.normalize('NFD', compacted))
