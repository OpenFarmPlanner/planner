"""Parse a spreadsheet cell of timing windows ("Anfang März bis Ende April; KW 30").

The vocabulary of all four app languages is accepted whatever the UI
language, case-insensitively and with any spacing: German, English, French
and Spanish month names and their common abbreviations, the thirds of a month
(Anfang/Mitte/Ende, early/mid/late, début/mi/fin, principios/mediados/finales)
and calendar-week words (KW, CW, week, semaine, semana). Several windows are
separated by ";", a line break or the word "or" ("oder", "o.", "or", "ou":
"02a o. 11a" is two windows). Only "or" is accepted: "and" could also be read
as one range ("Mitte März und April").

Nothing is guessed: a cell that is not exactly one of the supported forms is
rejected as a whole with a machine code (see ``PARSE_ERROR_MESSAGES``), and
the import keeps the rest of the row. Resolution and the canonical text live
in ``farm/services/timing_windows.py``; the rules are documented in
``docs/timing-windows.md``.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from farm.services.timing_windows import (
    DECADE_EARLY,
    DECADE_LATE,
    DECADE_MID,
    MAX_ISO_WEEK,
    TimingWindow,
)

ERROR_NOT_RECOGNIZED = 'timing_window_not_recognized'
ERROR_OPEN_END = 'timing_window_open_end'
ERROR_AMBIGUOUS_SLASH = 'timing_window_ambiguous_slash'
ERROR_DAY_DATES = 'timing_window_day_dates'
ERROR_MIXED_UNITS = 'timing_window_mixed_units'
ERROR_INVALID_WEEK = 'timing_window_invalid_week'
# A window written into the harvest-duration column ("Erntezeitraum").
ERROR_HARVEST_NOT_IMPORTED = 'timing_window_harvest_not_imported'

PARSE_ERROR_MESSAGES: dict[str, str] = {
    ERROR_NOT_RECOGNIZED: (
        'Not a time of year. Use e.g. "early March to late April" or "week 10 to 14" or "03a-04c". '
        'Separate several windows with ";", e.g. "March; October".'
    ),
    ERROR_OPEN_END: 'Give a start and an end, e.g. "March to May".',
    ERROR_AMBIGUOUS_SLASH: (
        'Ambiguous: write "March to April" for one window or "March; April" for two.'
    ),
    ERROR_DAY_DATES: (
        'Day dates are not supported. Use thirds of a month (e.g. "mid March") or '
        'calendar weeks (e.g. "week 11").'
    ),
    ERROR_MIXED_UNITS: 'Do not mix months and calendar weeks within one window.',
    ERROR_INVALID_WEEK: 'Calendar weeks must be between 1 and 52.',
    ERROR_HARVEST_NOT_IMPORTED: (
        'Harvest windows are not imported: the harvest follows from planting and growth '
        'duration. This column expects the harvest duration in days.'
    ),
}


def is_timing_window_text(value: object) -> bool:
    """Whether the text reads as one or more timing windows ("Juli bis September")."""
    try:
        return bool(parse_timing_window_cell('planting', value))
    except TimingWindowParseError:
        return False


class TimingWindowParseError(ValueError):
    """A cell part that is not a supported window; ``value`` is that part as written."""

    def __init__(self, code: str, value: str) -> None:
        super().__init__(f'{PARSE_ERROR_MESSAGES[code]} ({value})')
        self.code = code
        self.value = value


def _month_words() -> dict[str, int]:
    names: dict[int, tuple[str, ...]] = {
        1: ('januar', 'jänner', 'jaenner', 'jän', 'jan', 'january', 'janvier', 'janv', 'enero',
            'ene'),
        2: ('februar', 'feber', 'feb', 'february', 'février', 'fevrier', 'févr', 'fevr', 'fév',
            'fev', 'febrero'),
        3: ('märz', 'maerz', 'mär', 'mrz', 'march', 'mar', 'mars', 'marzo'),
        4: ('april', 'apr', 'avril', 'avr', 'abril', 'abr'),
        5: ('mai', 'may', 'mayo'),
        6: ('juni', 'jun', 'june', 'juin', 'junio'),
        7: ('juli', 'jul', 'july', 'juillet', 'juil', 'julio'),
        8: ('august', 'aug', 'août', 'aout', 'agosto', 'ago'),
        9: ('september', 'sept', 'sep', 'septembre', 'septiembre', 'setiembre', 'set'),
        10: ('oktober', 'okt', 'october', 'oct', 'octobre', 'octubre'),
        11: ('november', 'nov', 'novembre', 'noviembre'),
        12: ('dezember', 'dez', 'december', 'dec', 'décembre', 'decembre', 'déc', 'diciembre',
             'dic'),
    }
    return {word: month for month, words in names.items() for word in words}


MONTH_WORDS = _month_words()

DECADE_WORDS: dict[str, str] = {
    **dict.fromkeys(
        ('anfang', 'early', 'beginning', 'start', 'début', 'debut', 'principios', 'principio',
         'inicios', 'inicio', 'comienzos'),
        DECADE_EARLY,
    ),
    **dict.fromkeys(('mitte', 'mid', 'middle', 'mi', 'mediados', 'mitad'), DECADE_MID),
    **dict.fromkeys(('ende', 'late', 'end', 'fin', 'finales', 'final', 'fines'), DECADE_LATE),
}

WEEK_WORDS = frozenset({
    'kw', 'kalenderwoche', 'woche', 'wochen', 'cw', 'wk', 'week', 'weeks', 'w',
    'semaine', 'semaines', 'sem', 's', 'semana', 'semanas',
})

SEPARATOR_WORDS = frozenset({
    '-', 'bis', 'to', 'till', 'until', 'through', 'thru', 'à', 'au', 'a', 'hasta', 'al',
})

# "from": a filler before a start, but alone it leaves the window open.
FROM_WORDS = frozenset({
    'von', 'vom', 'ab', 'from', 'since', 'starting', 'du', 'dès', 'depuis', 'desde',
})

FILLER_WORDS = frozenset({
    'de', 'del', 'of', 'the', 'in', 'im', 'en', 'le', 'la', 'el', 'des', 'calendar', 'kalender',
})

_NUMERIC_DATE = re.compile(
    r'\b\d{1,2}\.\s?\d{1,2}\.?(?:\d{2,4})?(?!\d)'  # 15.03. / 15.3 / 15.03.2026
    r'|\b\d{4}-\d{1,2}-\d{1,2}\b'  # 2026-03-15
    r'|\b\d{1,2}/\d{1,2}/\d{2,4}\b'  # 15/03/2026
)
# Between two windows, like ";". Whole words only; "o." needs its dot, since a
# bare letter is too easy to misread.
_WINDOW_SEPARATOR = re.compile(r'[;\n\r]+|\s+(?:oder|or|ou)\s+|\s+o\.\s*', re.IGNORECASE)
_ORDINAL = re.compile(r'^\d+(?:er|e|st|nd|rd|th|º|ª)$')
_DASHES = str.maketrans({'–': '-', '—': '-', '‑': '-', '−': '-', '’': "'"})


@dataclass(frozen=True)
class _Token:
    kind: str  # month | decade | week | number | ordinal | separator | from | unknown
    value: str | int | None = None


@dataclass(frozen=True)
class _Side:
    unit: str  # decade | week | number | decade_only
    month: int | None = None
    decade: str | None = None
    week: int | None = None


def parse_timing_window_cell(kind: str, value: object) -> list[TimingWindow]:
    """Every window of one cell; an empty cell yields none.

    :raises TimingWindowParseError: for the first part that is not a supported window.
    """
    text = '' if value is None else str(value)
    parts = [part.strip() for part in _WINDOW_SEPARATOR.split(text.strip())]
    return [_parse_part(kind, part) for part in parts if part]


def _parse_part(kind: str, part: str) -> TimingWindow:
    normalized = _normalize(part)
    if _NUMERIC_DATE.search(normalized):
        raise TimingWindowParseError(ERROR_DAY_DATES, part)
    if '/' in normalized:
        raise TimingWindowParseError(ERROR_AMBIGUOUS_SLASH, part)
    normalized = _expand_short_decades(normalized)
    tokens = [_classify(word) for word in _split_words(normalized)]
    if any(token.kind == 'unknown' for token in tokens):
        raise TimingWindowParseError(ERROR_NOT_RECOGNIZED, part)
    if _has_day_number(tokens):
        raise TimingWindowParseError(ERROR_DAY_DATES, part)
    has_from = any(token.kind == 'from' for token in tokens)
    tokens = [token for token in tokens if token.kind != 'from']
    separators = [index for index, token in enumerate(tokens) if token.kind == 'separator']
    if len(separators) > 1:
        raise TimingWindowParseError(ERROR_NOT_RECOGNIZED, part)
    if not separators:
        if has_from:
            raise TimingWindowParseError(ERROR_OPEN_END, part)
        return _single_window(kind, _parse_side(tokens, part), part)
    start_tokens, end_tokens = tokens[:separators[0]], tokens[separators[0] + 1:]
    if not start_tokens or not end_tokens:
        raise TimingWindowParseError(ERROR_OPEN_END, part)
    return _range_window(kind, _parse_side(start_tokens, part), _parse_side(end_tokens, part), part)


def _expand_short_decades(text: str) -> str:
    """Expand only complete numeric thirds, keeping the existing range parser."""
    thirds = {'a': 'early', 'b': 'mid', 'c': 'late'}
    months = {
        1: 'january', 2: 'february', 3: 'march', 4: 'april',
        5: 'may', 6: 'june', 7: 'july', 8: 'august',
        9: 'september', 10: 'october', 11: 'november', 12: 'december',
    }

    def expand(match: re.Match[str]) -> str:
        return f'{thirds[match[2]]} {months[int(match[1])]}'

    return re.sub(r'(?<!\w)(0?[1-9]|1[0-2])([abc])(?!\w)', expand, text)


def _normalize(part: str) -> str:
    text = unicodedata.normalize('NFC', part).translate(_DASHES).lower()
    text = re.sub(r"jusqu'\s*(?:à|au|en)\b", ' - ', text)
    text = re.sub(r'\b(?:à|a) partir (?:de|du|d\')', ' ab ', text)
    # French "mi-mars" is one word, not a range.
    text = re.sub(r'\bmi\s*-\s*', 'mi ', text)
    return ' '.join(text.split())


def _split_words(text: str) -> list[str]:
    text = text.replace('-', ' - ')
    # "KW10" and "S10" are a week word and a number.
    text = re.sub(r'([^\W\d_])(\d)', r'\1 \2', text)
    return [word.rstrip('.') or word for word in text.split()]


def _classify(word: str) -> _Token:
    if word in SEPARATOR_WORDS:
        return _Token('separator')
    if word in FROM_WORDS:
        return _Token('from')
    if word in MONTH_WORDS:
        return _Token('month', MONTH_WORDS[word])
    if word in DECADE_WORDS:
        return _Token('decade', DECADE_WORDS[word])
    if word in WEEK_WORDS:
        return _Token('week')
    if word.isdigit():
        return _Token('number', int(word))
    if _ORDINAL.match(word):
        return _Token('ordinal')
    if word in FILLER_WORDS:
        return _Token('filler')
    return _Token('unknown')


def _has_day_number(tokens: list[_Token]) -> bool:
    """A day number next to a month ("15 March", "1er mars", "15 de marzo")."""
    meaningful = [token for token in tokens if token.kind != 'filler']
    if any(token.kind == 'ordinal' for token in meaningful):
        return True
    for left, right in zip(meaningful, meaningful[1:], strict=False):
        pair = {left.kind, right.kind}
        if pair == {'number', 'month'}:
            return True
    return False


def _parse_side(tokens: list[_Token], part: str) -> _Side:
    kinds = [token.kind for token in tokens if token.kind != 'filler']
    values = [token.value for token in tokens if token.kind != 'filler']
    if kinds == ['month']:
        return _Side('decade', month=values[0])
    if kinds == ['decade', 'month']:
        return _Side('decade', month=values[1], decade=values[0])
    if kinds == ['decade']:
        return _Side('decade_only', decade=values[0])
    if kinds == ['week', 'number']:
        return _Side('week', week=_valid_week(values[1], part))
    if kinds == ['number']:
        return _Side('number', week=values[0])
    raise TimingWindowParseError(ERROR_NOT_RECOGNIZED, part)


def _valid_week(week: int, part: str) -> int:
    if not 1 <= week <= MAX_ISO_WEEK:
        raise TimingWindowParseError(ERROR_INVALID_WEEK, part)
    return week


def _single_window(kind: str, side: _Side, part: str) -> TimingWindow:
    if side.unit == 'week':
        return TimingWindow.weeks(kind, side.week, side.week)
    if side.unit == 'decade':
        if side.decade is None:
            return TimingWindow.decade(kind, side.month, DECADE_EARLY, side.month, DECADE_LATE)
        return TimingWindow.decade(kind, side.month, side.decade, side.month, side.decade)
    raise TimingWindowParseError(ERROR_NOT_RECOGNIZED, part)


def _range_window(kind: str, start: _Side, end: _Side, part: str) -> TimingWindow:
    units = {start.unit, end.unit}
    if 'week' in units and units & {'decade', 'decade_only'}:
        raise TimingWindowParseError(ERROR_MIXED_UNITS, part)
    if start.unit == 'week' and end.unit in {'week', 'number'}:
        return TimingWindow.weeks(kind, start.week, _valid_week(end.week, part))
    if start.unit == 'decade_only' and end.unit == 'decade' and end.decade is not None:
        # "Anfang bis Mitte März": both thirds belong to the one month named.
        return TimingWindow.decade(kind, end.month, start.decade, end.month, end.decade)
    if start.unit == 'decade' and end.unit == 'decade':
        return TimingWindow.decade(
            kind,
            start.month, start.decade or DECADE_EARLY,
            end.month, end.decade or DECADE_LATE,
        )
    raise TimingWindowParseError(ERROR_NOT_RECOGNIZED, part)
