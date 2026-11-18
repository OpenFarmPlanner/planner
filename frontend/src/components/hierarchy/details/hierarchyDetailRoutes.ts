import type { HierarchyRow } from '../utils/types';

export type HierarchyEntityType = 'location' | 'field' | 'bed';

export const GROWING_AREAS_PATH = '/app/fields-beds';

const SEGMENTS: Record<HierarchyEntityType, string> = {
  location: 'locations',
  field: 'fields',
  bed: 'beds',
};

/** Shareable detail route of a location, field (Parzelle) or bed (#1075). */
export function getEntityDetailPath(type: HierarchyEntityType, id: number): string {
  return `${GROWING_AREAS_PATH}/${SEGMENTS[type]}/${id}`;
}

export function getHierarchyDetailPath(row: HierarchyRow): string | null {
  const id = row.type === 'location' ? row.locationId : row.type === 'field' ? row.fieldId : row.bedId;
  return typeof id === 'number' && id > 0 ? getEntityDetailPath(row.type, id) : null;
}

/**
 * Back to the list with the entity's row focused and flashed (the existing
 * `?highlight=` deep link); search and filters come back from the session.
 */
export function getGrowingAreaListPath(type: HierarchyEntityType, id: number): string {
  return `${GROWING_AREAS_PATH}?highlight=${type}:${id}`;
}
