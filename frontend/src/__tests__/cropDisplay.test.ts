import { describe, expect, it } from 'vitest';

import { formatCropDisplayName, getCropDisplayName } from '../crops/cropDisplay';

describe('crop display names', () => {
  it('prefers the localized crop display name', () => {
    expect(getCropDisplayName({
      name: 'Ackerbohne',
      crop_display_name: 'Broad bean',
    })).toBe('Broad bean');
  });

  it('falls back to the stored project crop name when no localized display name exists', () => {
    expect(getCropDisplayName({
      name: 'Ackerbohne',
      crop_display_name: null,
    })).toBe('Ackerbohne');
  });

  it('falls back when the resolved display name is empty', () => {
    expect(getCropDisplayName({ name: 'Stored crop name', crop_display_name: '' })).toBe('Stored crop name');
  });

  it('supports planting-plan and aggregate rows with crop_name fields', () => {
    expect(formatCropDisplayName({
      crop_name: 'Ackerbohne',
      crop_display_name: 'Broad bean',
      crop_variety: 'Hangdown',
    })).toBe('Broad bean (Hangdown)');
  });

  it('keeps variety language-independent when formatting display labels', () => {
    expect(formatCropDisplayName({
      name: 'Ackerbohne',
      crop_display_name: 'Broad bean',
      variety: 'Hangdown',
    })).toBe('Broad bean (Hangdown)');
  });
});
