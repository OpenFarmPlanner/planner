import { describe, expect, it } from 'vitest';

import { hasAnyDetailValue, hasDetailValue } from '../cropDetailFieldVisibility';

describe('hasDetailValue', () => {
  it.each([null, undefined, '', '   ', [], {}, Number.NaN])('treats %j as missing', (value) => {
    expect(hasDetailValue(value)).toBe(false);
  });

  it.each([0, false, 'x', ['cold'], { direct_sowing: 1 }, 12.5])('keeps %j as a value', (value) => {
    expect(hasDetailValue(value)).toBe(true);
  });
});

describe('hasAnyDetailValue', () => {
  it('needs one filled-in value', () => {
    expect(hasAnyDetailValue(null, '', [])).toBe(false);
    expect(hasAnyDetailValue(null, 0)).toBe(true);
  });
});
