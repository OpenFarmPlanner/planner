/**
 * Crop detail read views (the crops page and the crop library) show only
 * filled-in values and leave out sections without any. Edit forms are not
 * affected.
 */

/**
 * Whether a value counts as filled in: null, undefined, blank strings and
 * empty arrays/objects are missing; `0` and `false` are meaningful values.
 */
export function hasDetailValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return !Number.isNaN(value);
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

/** Whether any of a section's values is filled in. */
export function hasAnyDetailValue(...values: unknown[]): boolean {
  return values.some(hasDetailValue);
}
