import { useCallback } from 'react';

import { usePlantFamilies } from '../../../crops/plantFamilies';
import type { FamilyNameResolver } from './rotationCopy';

/**
 * Plant-family names for rotation copy, always in the UI language: resolved
 * from the botanical key through the curated family list, never taken from
 * the stored label. The backend's name only stands in while the list loads.
 */
export function useFamilyNameResolver(): FamilyNameResolver {
  const families = usePlantFamilies();
  return useCallback((key, fallbackName) => {
    if (!key) {
      return fallbackName ?? '';
    }
    return families.getFamily(key) ? families.getName(key) : (fallbackName ?? key);
  }, [families]);
}
