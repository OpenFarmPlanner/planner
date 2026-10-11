"""European (dd.mm.yyyy, 24-hour) date formats for the active `en` locale.

The Django admin is the only server-rendered UI and runs under the default
`LANGUAGE_CODE` (`en-us`), whose stock formats are US-style (`10/09/2026
8:12 p.m.`). Its users are in Central Europe, so dates there are shown and
entered as `09.10.2026 20:12`. API responses are unaffected: DRF serializes
ISO 8601 independently of these settings.
"""

DATE_FORMAT = 'd.m.Y'
TIME_FORMAT = 'H:i'
DATETIME_FORMAT = 'd.m.Y H:i'
SHORT_DATE_FORMAT = 'd.m.Y'
SHORT_DATETIME_FORMAT = 'd.m.Y H:i'
FIRST_DAY_OF_WEEK = 1  # Monday

# The first entry is what the admin's date widgets display and its calendar
# picker writes; ISO stays accepted so pasted or typed ISO dates still parse.
DATE_INPUT_FORMATS = [
    '%d.%m.%Y',  # '25.10.2026'
    '%d.%m.%y',  # '25.10.26'
    '%Y-%m-%d',  # '2026-10-25'
]
DATETIME_INPUT_FORMATS = [
    '%d.%m.%Y %H:%M:%S',
    '%d.%m.%Y %H:%M:%S.%f',
    '%d.%m.%Y %H:%M',
    '%d.%m.%y %H:%M:%S',
    '%d.%m.%y %H:%M',
    '%Y-%m-%d %H:%M:%S',
    '%Y-%m-%d %H:%M:%S.%f',
    '%Y-%m-%d %H:%M',
]
