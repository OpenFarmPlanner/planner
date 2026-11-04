"""Expand germination spreadsheet ranges and individual requirement columns."""

import re
from typing import Any

from farm.germination import GERMINATION_TYPES

_RANGE = re.compile(r"^\s*([+-]?\d+(?:[.,]\d+)?)\s*(?:[-–]\s*([+-]?\d+(?:[.,]\d+)?))?\s*$")


def apply_germination_cells(data: dict[str, Any]) -> None:
    for column, lower, upper in (
        (
            "germination_temperature_optimal",
            "germination_temperature_optimal_min_c",
            "germination_temperature_optimal_max_c",
        ),
        ("germination_days", "germination_days_min", "germination_days_max"),
    ):
        raw = data.pop(column, None)
        if raw is None or str(raw).strip() == "":
            continue
        match = _RANGE.fullmatch(str(raw))
        if match is None:
            raise ValueError(f"{column}: enter a number or a range such as 18–25.")
        minimum = float(match[1].replace(",", "."))
        maximum = float((match[2] or match[1]).replace(",", "."))
        data[lower], data[upper] = minimum, maximum
    types = list(data.get("germination_types") or [])
    flags_present = False
    for kind in GERMINATION_TYPES:
        flag = data.pop(f"germination_{kind}", None)
        if flag is None:
            continue
        flags_present = True
        if flag and kind not in types:
            types.append(kind)
        elif not flag and kind in types:
            types.remove(kind)
    if flags_present:
        data["germination_types"] = types
