# Form Layout

OpenFarmPlanner uses responsive field-width roles from
`frontend/src/components/forms/formLayout.ts`. Form fields are full width on
small screens and receive a stable maximum width from the `sm` breakpoint.
This keeps desktop forms compact without introducing separate mobile forms.

## Width roles

| Role | Typical content | Desktop maximum |
|---|---|---:|
| `compactFieldSx` | numbers, dates, versions, priorities | 180 px |
| `smallFieldSx` | short selects, status, units, methods | 224 px |
| `mediumFieldSx` | families, suppliers, coordinates | 300 px |
| `wideFieldSx` | names, email addresses, URLs | 400 px |
| `fullWidthFieldSx` | descriptions, notes, comments | full row |

Use `formRowSx` to place related compact fields beside each other. It wraps
automatically and aligns fields at the top so validation and helper text do
not disturb neighboring controls.

The width roles are applied to the field's own `FormControl`, which is a
column flexbox, and deliberately set no `alignItems`. A non-default value
there (e.g. `flex-start`) stops the outlined input from stretching: it then
shrink-wraps to the native `<input>`'s intrinsic width, which differs per
browser engine and font (Chromium, Firefox and WebKit all differ, and a
`type="number"` input with a `max` collapses to a few characters). That made
the "Kultur bearbeiten" form look different in every browser, most visibly
in Firefox on mobile. The cross-browser layout suite
(`frontend/e2e-cross-browser/crop-form.spec.ts`) guards against it.

### Stacked variants

`compactFieldSx` … `wideFieldSx` set a `flex` shorthand, which sizes the
*main axis*. Inside a column `Stack` that axis is the height, so a multiline
field would be stretched vertically instead of constrained horizontally. For
fields stacked vertically rather than laid out in a `formRowSx` row, use the
plain width/maxWidth variants instead:

| Role | Equivalent of |
|---|---|
| `mediumStackedFieldSx` | `mediumFieldSx` (300 px) |
| `wideSingleColumnFieldSx` | `wideFieldSx` (400 px) |
| `wideStackedFieldSx` | wide multiline fields (460 px) |

Authentication and similar identity forms are capped by their page shell
(`AuthPageShell` plus `pages/auth/authPageStyles.ts`), not by a form-layout
role.

## Decimal fields

Fields that hold decimal values (amounts, depths, percentages, weights) use
`LocalizedDecimalField` (`frontend/src/components/inputs/`), not a
`TextField` with `type="number"`. A native number input is formatted by the
browser engine: WebKit shows `0,5` under German, Chromium and Firefox `0.5`,
and neither matches the comma the rest of the UI uses. The component shows
the UI language's separator, accepts both `,` and `.` while typing and
reports a number (or `null` when cleared). Whole-number fields (days, years,
centimetre spacings) may stay `type="number"`.

## Exceptions

DataGrid cell editors must fill their cell and therefore do not use these
roles. A field may also remain full width inside an already narrow popover or
small dialog, and search fields may grow when the remaining horizontal space
is intentionally assigned to search.
