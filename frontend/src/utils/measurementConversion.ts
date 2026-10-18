export const metersToRoundedCentimeters = (
  value: number | null | undefined,
): number | undefined => (
  typeof value === 'number' ? Math.round(value * 100) : undefined
);

// Keeps fractional centimeters (e.g. a 1.5 cm sowing depth) and only drops
// floating-point noise such as 3.5000000000000004.
export const metersToCentimeters = (
  value: number | null | undefined,
): number | undefined => (
  typeof value === 'number' ? Math.round(value * 1_000_000) / 10_000 : undefined
);

export const centimetersToMeters = (
  value: number | null | undefined,
): number | null => (
  typeof value === 'number' ? value / 100 : null
);
