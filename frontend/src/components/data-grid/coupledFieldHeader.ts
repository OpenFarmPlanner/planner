/**
 * Shared marker classes for a "coupled field" column pair — two columns that
 * present the same underlying value from two directions (see
 * docs/datagrid-architecture.md#coupled-field-pairs). Any table can reuse
 * these to tint a pair's headers with the shared background styled in
 * `components/data-grid/styles.ts`.
 */

export const COUPLED_FIELD_HEADER_CLASS = 'coupled-field-header';
export const COUPLED_FIELD_HEADER_START_CLASS = 'coupled-field-header-start';
export const COUPLED_FIELD_HEADER_END_CLASS = 'coupled-field-header-end';

export type CoupledFieldHeaderPosition = 'start' | 'end';

/**
 * Header class name for one half of a coupled-field pair. The tint only
 * makes sense between two visible headers, so it is dropped entirely —
 * falling back to the plain marker class with no tint — once the partner
 * column is hidden.
 */
export function getCoupledFieldHeaderClassName(
  position: CoupledFieldHeaderPosition,
  isPartnerColumnVisible: boolean,
): string {
  if (!isPartnerColumnVisible) {
    return COUPLED_FIELD_HEADER_CLASS;
  }
  const positionClass = position === 'start'
    ? COUPLED_FIELD_HEADER_START_CLASS
    : COUPLED_FIELD_HEADER_END_CLASS;
  return `${COUPLED_FIELD_HEADER_CLASS} ${positionClass}`;
}
