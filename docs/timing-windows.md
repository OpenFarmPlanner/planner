# Timing Windows (Zeiträume)

A crop can carry **windows** for when it is usually raised, sown and planted
out, as printed on seed packets and in growing guides ("Vorkultur Mitte März
bis Ende April, Pflanzung Mai"). The crop list filters by them ("Aussaat
möglich im Monat") and the planting plan points out dates outside them. Issue #858; windows
relative to the last frost date are #872 and not part of this.

## Kinds and terms

| Kind (code) | DE | EN | FR | ES |
| --- | --- | --- | --- | --- |
| `pre_cultivation` | Anzucht | Propagation | Pépinière | Semillero |
| `direct_sowing` | Direktsaat | Direct sowing | Semis direct | Siembra directa |
| `planting` | Pflanzung | Transplanting | Plantation | Trasplante |

**No harvest windows.** A plan's harvest start already follows from its
planting date plus the growth duration
(`PlantingPlan.calculate_effective_harvest_dates`); a harvest window would be
a second, contradicting source, so there is none. The detail view shows a
calculated harvest lane instead (see below).

"Anzucht", not "Vorkultur": the glossary uses *Vorkultur* for the previous
crop on a bed. Column names from seed catalogues ("Vorkultur", "Voranzucht",
"Anzuchtzeitraum", "Aussaat Freiland", "Auspflanzung", "Pflanzzeitraum", "start
indoors", "sow outdoors", "plant out", and French and Spanish equivalents) are
spreadsheet column aliases; `spreadsheetColumns.test.ts` checks that no alias
belongs to two columns. A kind holds any
number of windows (e.g. a spring and a late-summer sowing).

## Units

A window has exactly **one** unit, stored with it:

- **`decade`** (Monatsdrittel): start and end month (1–12), each with a third
  of the month: `early` = day 1–10 (Anfang), `mid` = 11–20 (Mitte), `late` =
  21 to the last day (Ende).
- **`iso_week`** (Kalenderwoche): start and end ISO week, 1–52. Week 53 is
  neither offered nor accepted; a window across the year end covers it anyway.

There are no day dates, neither in the form nor in the import. A window is
stored in its unit, never as a converted date (`CropTimingWindow`, with
`CheckConstraint`s per unit: exactly the unit's own fields are set and in
range, the other unit's are empty; the API serializer applies the same rules
with readable errors).

## Resolution

Only a check resolves a window to real dates, always for a concrete year
(`farm/services/timing_windows.py`, the single backend implementation):

- Month ends and leap years come from the real calendar (Ende Februar 2024 is
  21–29 February).
- ISO weeks run from the Monday of the start week to the Sunday of the end
  week (`date.fromisocalendar`). A date is also checked against a week window
  resolved in its ISO year, which differs from the calendar year around New
  Year (31 December 2025 lies in week 1 of 2026).
- A start after the end wraps the year end. For a date in year `Y` both
  candidates count: start in `Y-1` to end in `Y`, and start in `Y` to end in
  `Y+1`. That is how "KW 50 bis 2" contains 31 December 2026, which lies in
  ISO week 53. Start equal to end is allowed (one third or one week).
- **Month overlap** (the sowing-month filter): a window resolved in `Y`
  overlaps a month of `Y` when they share a day. Week windows in the filter
  use the current calendar year; decade windows do not depend on it.

The frontend keeps a small equivalent (`frontend/src/crops/timingWindows.ts`)
for the form's "Über den Jahreswechsel" note, the canonical text and the
detail view's year bar. `tests/fixtures/timing_windows.json` holds shared
cases (text in all four languages, ranges, containment, months) that both
`backend/farm/tests/test_timing_windows.py` and
`frontend/src/__tests__/timingWindows.test.ts` run, so the two cannot drift.

## Canonical text

Used for display, the planting hints and the spreadsheet export, in the UI
language (frontend: `crops:timingWindows.text.*` with `common:months`;
backend: the same forms in `timing_windows.py`):

| Window | DE | EN | FR | ES |
| --- | --- | --- | --- | --- |
| whole month | März | March | mars | marzo |
| whole months | März bis Mai | March to May | mars à mai | marzo a mayo |
| one third | Mitte März | mid March | mi-mars | mediados de marzo |
| otherwise | Anfang März bis Mitte Mai | early March to mid May | début mars à mi-mai | principios de marzo a mediados de mayo |
| one week | KW 10 | week 10 | semaine 10 | semana 10 |
| weeks | KW 10 bis 14 | week 10 to 14 | semaines 10 à 14 | semanas 10 a 14 |

Several windows of a kind are joined with "; ".

## Kultur and Sorte

A Sorte without own windows **of a kind** uses its general Kultur's windows of
that kind, live and per kind (`INHERITABLE_TIMING_WINDOW_KINDS` and
`resolve_effective_timing_windows()` in `farm/services/crop_inheritance.py`;
frontend `VARIETY_INHERITABLE_TIMING_WINDOW_KINDS` in `varietyValueSource.ts`).
They are rows, not a scalar field, so they are kept outside
`CROP_INHERITABLE_FIELDS` but follow the same principle: the edit form shows
the inherited windows, highlights a kind the Sorte overrides, and strips a
kind that still equals the inherited windows on save, so the Sorte keeps
inheriting it.

## API

`CropSerializer` (also used by the agent API's crop endpoints):

- `timing_windows`: the crop's own windows. A write replaces the whole list.
  Each item: `kind`, `unit`, `start_month`, `start_decade`, `end_month`,
  `end_decade`, `start_week`, `end_week` (the other unit's fields `null`).
- `effective_timing_windows` (read-only): the windows the crop plans with,
  each with `inherited`.
- `sowing_months` (read-only): months of the current year an effective
  Anzucht or Direktsaat window overlaps; the crop list's filter reads it.

The crop list loads every window of the project in one query
(`load_timing_window_index`), pinned in the list query-count tests.

## History and undo

The crop's own windows are part of its revision snapshot (`timing_windows`,
written by `Crop.save()`), so they show up in the change history and are
restored by "Wiederherstellen", project restores and batch undo like any
other crop field. A snapshot from before windows existed has no such key and
leaves the current windows alone.

## Crop library: not included

Windows stay in the project. They are left out of publishing, the library
import, the sync, the update diff and the sync dialogs. Reason: sowing times
depend on the local climate (altitude, last frost, greenhouse), not on the
country, so months copied from someone else's farm would mislead. See
[crop-library-architecture.md](./crop-library-architecture.md#project-only-crop-data).

## Crop form and detail view

- Section "Zeiträume", explained by an info icon with tooltip after the
  heading (the shared `crops/FieldInfoIcon.tsx`: focusable, opens on tap),
  with the groups Anzucht, Direktsaat, Pflanzung, each with its rows and
  "+ Zeitraum hinzufügen". A row has a "Monat"/"KW" switch, native selects for
  "Von"/"Bis" (third before month, reading like "Anfang April", or week 1–52) and a
  remove button ("Zeitraum entfernen"). Switching the unit clears the row; a
  new row starts in the unit of the row added last in this form, else
  "Monat" (form state only). A start after the end shows "Über den
  Jahreswechsel". An incomplete row blocks saving with "Bitte Anfang und Ende
  angeben.".
- The detail view hides the section when the crop has no effective window
  ([crop-detail.md](crop-detail.md)).
- The detail view lists the effective windows per kind and draws a year bar
  (January to December) with one labelled lane per kind; week windows are
  drawn in the current year. Colours come from the theme palette
  (`timingWindowStyles.ts`).
- Below them the lane **"Ernte (berechnet)"**, hatched and labelled in italics
  so it reads as derived (`computedHarvestYearSegments` in `timingWindows.ts`),
  from the effective windows and durations (Sorte before Kultur): per
  Direktsaat or Pflanzung window, start + growth duration to end + growth
  duration + harvest duration; Anzucht windows count, plus the propagation
  duration, only when the crop has no Pflanzung windows. Windows are resolved
  in the previous and the current year, so a harvest reaching into January
  from last autumn's sowing shows too. Without a growth duration there is no
  lane; without a harvest duration it shows only the harvest start.

## Spreadsheet import and export

One column per kind ("Anzucht", "Direktsaat", "Pflanzung", localized like the
other headers), several windows in one cell separated by ";" (also accepted
on import: a line break or the word "or": "oder", "o.", "or", "ou", so
"02a o. 11a" is two windows). Only "or" is accepted, not "and", which could
also be read as one range ("Mitte März und April"); a bare Spanish "o" is
left out as too easy to misread. The
export writes the canonical text in the UI language; importing it again gives
the same windows (tested in all four languages, backend and frontend).

The parser (`farm/services/crop_import/timing_windows.py`) accepts the
vocabulary of all four app languages whatever the UI language, case- and
space-insensitively:

- Separators "–", "—", "-", "bis", "to", "à", "a", "hasta", "jusqu'à".
- Month names and common abbreviations, with or without a dot ("Mär", "Mrz",
  "Jänner", "Jän", "Mar", "Sept", "févr.", "dic").
- Thirds: Anfang/Mitte/Ende, early/mid/late, début/mi/fin,
  principios/mediados/finales.
- Forms: third to third, one third, month to month, one month, month to third
  and the reverse (a month alone means Anfang as a start and Ende as an end).
- Import-only numeric thirds: `04a-04c` (all April), `4a-4c` (same),
  `03b-05a` (mid March to early May), `04b` (one third), `10a-03c`
  (across New Year). Month 1–12, optional leading zero; letters are
  case-insensitive: **a = days 1–10, b = days 11–20, c = day 21 to month end**.
  Hyphen, en/em dash and `bis` separate endpoints, with optional surrounding
  spaces. Other letters, invalid months and incomplete ranges are rejected.
- Formats are detected per window: `04b-04c; KW10-14; Anfang Mai` is valid,
  as are mixed formats in one column or file. No format selector or new unit.
  The preview displays parsed windows in the UI language, including new crops.
  Export always writes the canonical long form in the export language;
  shorthand is for import only. All four languages import back identically.
- Weeks: `KW10-14`, `W10-14`, `KW10–14`, `W10–14`, "KW 10", "KW10", "KW 10 bis 14", "KW 10 bis KW 14", "CW 10",
  "week 10 to 14", "semaine(s) 10 à 14", "semana(s) 10 a 14".

Nothing is guessed. A cell that does not fit is rejected as a whole and
reported once per cell (row, column, value) in the import preview; only that
cell is dropped, the rest of the row is imported. A cell replaces the windows
of its kind; kinds without a cell keep their windows. Codes and German texts:

| Code | Example | Message |
| --- | --- | --- |
| `timing_window_not_recognized` | "Frühjahr" | „…“ ist keine Zeitangabe. … |
| `timing_window_open_end` | "ab März", "bis April" | „…“: Bitte Anfang und Ende angeben … |
| `timing_window_ambiguous_slash` | "März/April" | „…“ ist mehrdeutig. … |
| `timing_window_day_dates` | "15.03. bis 30.04." | Tagesdaten werden nicht unterstützt. … |
| `timing_window_mixed_units` | "Anfang März bis KW 16" | Monate und Kalenderwochen bitte nicht … mischen. |
| `timing_window_invalid_week` | "KW 53" | Kalenderwochen von 1 bis 52 angeben. |
| `timing_window_harvest_not_imported` | "Juli bis September" in the harvest-duration column | Erntezeiträume werden nicht importiert. … |

"Erntezeitraum" is an alias of the harvest duration in days
(`harvest_duration_days`). When such a cell holds no number, the spreadsheet
reader sends its text as `harvest_duration_days_text`; the backend reports it
with `timing_window_harvest_not_imported` when the window parser reads it as
a window, and drops any other text silently as before.

The JSON export carries the structured `timing_windows` list instead.

## Planning hints

Never blocking (`farm/services/timing_window_check.py`). A date is checked only
when the crop has effective windows of the matching kind:

- direct sowing: the planting date (= sowing date) against Direktsaat;
- transplanting from own propagation: the planting date against Pflanzung.
  Only when the crop has no effective Pflanzung windows is the sowing date
  (planting date minus the effective propagation duration, Sorte before
  Kultur, as in the sowing-date column) checked against Anzucht instead, so a
  wrong planting date gives exactly one hint;
- bought-in plants: the planting date against Pflanzung.

The harvest start is never checked (there are no harvest windows). Anzucht
windows still count fully for the filter, the display and the import.

Each date is resolved in its own year. The findings are
`PlantingPlanSerializer.timing_window_findings`; the dialog asks
`GET planting-plans/timing-window-check/` live. The table marks the affected
date cell like a harvest overlap (dotted info underline, tooltip), the mobile
card shows an icon, the dialog an info alert. The planting-plan filter
"Zeiträume" → "Außerhalb der Zeiträume" shows only plans with such a hint.

### Excel date cells

The XLSX reader does not interpret number formats or date styles. An Excel
serial date arrives as a number and is sent as its numeric text in a window
column; it is rejected by the window parser, never converted to a month or
third. An ISO date stored with XLSX type `d` remains text and is rejected as a
day date. Enter window values as text. This behavior is unchanged.
