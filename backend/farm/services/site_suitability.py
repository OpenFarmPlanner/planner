"""Advisory crop checks based on the effective conditions of a bed or parcel."""

from typing import Any

from farm.crop_light import normalize_crop_light
from farm.models import Bed, Crop, Field
from farm.services.crop_inheritance import GeneralCropIndex, resolve_crop_field
from farm.services.site_conditions import (
    effective_conditions_for_bed,
    effective_conditions_for_field,
)

CROP_LIGHT_BY_SITE_LIGHT = {
    'sunny': 'full_sun',
    'partial_shade': 'partial_shade',
    'shade': 'shade',
}


def check_site_suitability(
    crop: Crop | None, site: Bed | Field | None, index: GeneralCropIndex,
) -> list[dict[str, Any]]:
    if crop is None or site is None or crop.project_id != site.project_id:
        return []
    parcel = site.field if isinstance(site, Bed) else site
    if parcel.project_id != crop.project_id or parcel.location.project_id != crop.project_id:
        return []

    conditions = (
        effective_conditions_for_bed(site) if isinstance(site, Bed)
        else effective_conditions_for_field(parcel)
    )
    findings: list[dict[str, Any]] = []
    allowed = normalize_crop_light(resolve_crop_field(crop, 'light_requirement', index))
    light = conditions['light_condition']
    site_light = CROP_LIGHT_BY_SITE_LIGHT.get(light.value or '')
    if allowed and site_light and site_light not in allowed:
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
