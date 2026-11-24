import type { LocationPathSpacing } from '../../../api/types';

export const defaultLocationPathSpacing: LocationPathSpacing = {
  bed_path_spacing_cm: 30,
  parcel_path_spacing_cm: 75,
  snap_to_path_spacing: true,
};

export function getLocationPathSpacing(location: Partial<LocationPathSpacing>): LocationPathSpacing {
  return {
    bed_path_spacing_cm: location.bed_path_spacing_cm ?? defaultLocationPathSpacing.bed_path_spacing_cm,
    parcel_path_spacing_cm: location.parcel_path_spacing_cm ?? defaultLocationPathSpacing.parcel_path_spacing_cm,
    snap_to_path_spacing: location.snap_to_path_spacing ?? defaultLocationPathSpacing.snap_to_path_spacing,
  };
}
