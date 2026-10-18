import { describe, expect, it } from 'vitest';

import {
  centimetersToMeters,
  metersToCentimeters,
  metersToRoundedCentimeters,
} from '../utils/measurementConversion';

describe('measurementConversion', () => {
  it('rounds metre values at the centimetre form boundary', () => {
    expect(metersToRoundedCentimeters(0)).toBe(0);
    expect(metersToRoundedCentimeters(0.124)).toBe(12);
    expect(metersToRoundedCentimeters(0.125)).toBe(13);
  });

  it('keeps fractional centimetres without floating-point noise', () => {
    expect(metersToCentimeters(0.015)).toBe(1.5);
    expect(metersToCentimeters(0.035)).toBe(3.5);
    expect(metersToCentimeters(null)).toBeUndefined();
  });

  it('keeps absent metre values out of form drafts', () => {
    expect(metersToRoundedCentimeters(null)).toBeUndefined();
    expect(metersToRoundedCentimeters(undefined)).toBeUndefined();
  });

  it('converts centimetres to SI storage values and normalizes absence', () => {
    expect(centimetersToMeters(12.5)).toBe(0.125);
    expect(centimetersToMeters(0)).toBe(0);
    expect(centimetersToMeters(null)).toBeNull();
    expect(centimetersToMeters(undefined)).toBeNull();
  });
});
