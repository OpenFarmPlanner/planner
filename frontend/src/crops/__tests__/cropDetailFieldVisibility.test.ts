import { beforeEach, describe, expect, it } from 'vitest';

import {
  CROP_DETAIL_SHOW_ALL_FIELDS_STORAGE_KEY,
  hasDetailValue,
  readShowAllCropDetailFields,
  storeShowAllCropDetailFields,
} from '../cropDetailFieldVisibility';

describe('hasDetailValue', () => {
  it.each([null, undefined, '', '   ', [], {}, Number.NaN])('treats %j as missing', (value) => {
    expect(hasDetailValue(value)).toBe(false);
  });

  it.each([0, false, 'x', ['cold'], { direct_sowing: 1 }, 12.5])('keeps %j as a value', (value) => {
    expect(hasDetailValue(value)).toBe(true);
  });
});

describe('show-all preference', () => {
  beforeEach(() => {
    window.localStorage.removeItem(CROP_DETAIL_SHOW_ALL_FIELDS_STORAGE_KEY);
  });

  it('defaults to hiding empty details', () => {
    expect(readShowAllCropDetailFields()).toBe(false);
  });

  it('round-trips the stored choice', () => {
    storeShowAllCropDetailFields(true);
    expect(readShowAllCropDetailFields()).toBe(true);
    storeShowAllCropDetailFields(false);
    expect(readShowAllCropDetailFields()).toBe(false);
  });
});
