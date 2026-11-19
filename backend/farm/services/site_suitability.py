"""Advisory crop and bed checks based on explicit, effective site values."""

from typing import Any

from farm.crop_light import normalize_crop_light
from farm.models import Bed, Crop
from farm.services.crop_inheritance import GeneralCropIndex, resolve_crop_field
from farm.services.site_conditions import effective_conditions_for_bed

CROP_LIGHT_BY_BED_LIGHT = {
    'sunny': 'full_sun',
    'partial_shade': 'partial_shade',
    'shade': 'shade',
}


def check_site_suitability(
    crop: Crop | None, bed: Bed | None, index: GeneralCropIndex,
) -> list[dict[str, Any]]:
    if crop is None or bed is None or crop.project_id != bed.project_id:
        return []
    if bed.field.project_id != bed.project_id or bed.field.location.project_id != bed.project_id:
        return []

    conditions = effective_conditions_for_bed(bed)
    findings: list[dict[str, Any]] = []
    allowed = normalize_crop_light(resolve_crop_field(crop, 'light_requirement', index))
    light = conditions['light_condition']
    bed_light = CROP_LIGHT_BY_BED_LIGHT.get(light.value or '')
    if allowed and bed_light and bed_light not in allowed:
        findings.append({
            'code': 'light_mismatch',
            'crop_light': allowed,
            'light': light.as_dict(),
        })

    moisture, irrigation = conditions['soil_moisture'], conditions['irrigation']
    if (
        moisture.value == 'dry' and irrigation.value == 'unavailable'
        and resolve_crop_field(crop, 'water_requirement', index) == 'high'
    ):
        findings.append({
            'code': 'water_mismatch',
            'crop_water': 'high',
            'soil_moisture': moisture.as_dict(),
            'irrigation': irrigation.as_dict(),
        })
    return findings
