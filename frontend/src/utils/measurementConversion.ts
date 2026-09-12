export const metersToRoundedCentimeters = (
  value: number | null | undefined,
): number | undefined => (
  typeof value === 'number' ? Math.round(value * 100) : undefined
);

export const centimetersToMeters = (
  value: number | null | undefined,
): number | null => (
  typeof value === 'number' ? value / 100 : null
);
