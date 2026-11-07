# Sowing depth (Saattiefe)

Seed catalogues and growers often give the sowing depth as a range
("2–3 cm", "0,5–1 cm"), so a crop stores it as a range of two numbers. The
depth is only shown, not calculated with; it is kept numeric rather than as
text so it can be compared, synced through the crop library and checked
later (for example a Lichtkeimer sown deep).

## Fields

| Model field | API field | Meaning |
| --- | --- | --- |
| `sowing_depth_m` | `sowing_depth_cm` | lower bound, metres (SI) / centimetres |
| `sowing_depth_max_m` | `sowing_depth_max_cm` | upper bound |

Both exist on `Crop` and `PublicCrop`. `sowing_depth_m` kept its name on
purpose: saved history entries, library revisions and proposals, and the
agent API already use it, and as the lower bound it still means what it meant
for a single depth.

## Rules (`farm/sowing_depth.py`)

- **One depth is a range of one.** Both bounds are always stored together:
  when a save leaves one empty, it gets the other one's value
  (`fill_missing_depth_bound`, called in `Crop.save()` and
  `PublicCrop.save()`). Clearing both clears the depth.
- **Writes that send only the lower bound** (`sowing_depth_cm` without
  `sowing_depth_max_cm`, or `sowing_depth_m` alone) mean one depth and set
  both bounds (`complete_single_depth_write`). This keeps clients from before
  the range working: the agent API, browser tabs still open on the old
  frontend, and library proposals. It applies in `CropSerializer`,
  `PublicCropUpdateSerializer` and proposals (which store both bounds).
- **Validation:** both bounds are non-negative and the lower one is not
  greater than the upper one (`sowing_depth_errors`; frontend:
  `form.sowingDepthRangeError`).
- Both fields inherit Sorte → Kultur and sync with the library as separate
  fields, like the germination ranges; the single-depth rule keeps a Sorte
  from mixing its own lower bound with an inherited upper one.

## UI

The crop form shows "Saattiefe von (cm)" and "Saattiefe bis (cm)"; crop and
library details and the variety comparison show "2 cm" for one depth and
"2–3 cm" for a range.

## Spreadsheet import and export

One column, "Saattiefe (cm)" (aliases: `Tiefe`, `Aussaattiefe`, `Saattiefe`,
`sowing_depth`, `sowing_depth_cm`). Import accepts `2`, `2,5`, `2-3`, `2–3`
and `0,5 - 1`; the backend splits it like the germination ranges
(`farm/services/crop_import/germination.py`). Other text ("Kk") is reported in
the import preview (`range_not_recognized`) and only that cell is dropped.
Export writes `2` for one depth and `2–3` for a range. JSON import/export
carries `sowing_depth_cm` and `sowing_depth_max_cm` (or the `_m` fields).
