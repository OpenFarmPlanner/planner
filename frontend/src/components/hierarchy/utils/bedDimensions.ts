import type { Bed } from '../../../api/types';

export type BedDimensions = Pick<Bed, 'length_m' | 'width_m'>;

/** Editable dimensions must round-trip their persisted numeric value. */
export const bedDimensionInputFormat = { maximumSignificantDigits: 17 } as const;

/** Applies project values once, while building a new bed draft. */
export function getNewBedDimensions(
  defaults?: BedDimensions,
  suggestions?: BedDimensions,
): { length_m: number | null; width_m: number | null } {
  return {
    length_m: defaults?.length_m ?? suggestions?.length_m ?? null,
    width_m: defaults?.width_m ?? suggestions?.width_m ?? null,
  };
}
