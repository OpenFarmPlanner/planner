import { describe, expect, it } from 'vitest';
import { buildAllCropsExport, buildSingleCropExport, buildSingleCropFilename, slugifyFilenamePart, toPortableCrop } from '../crops/exportUtils';
import type { Crop } from '../api/types';

describe('crop export mapping', () => {
  const crop: Crop = {
    id: 42,
    name: 'Tomate',
    variety: 'Roma',
    supplier: {
      id: 7,
      name: 'Bingenheimer',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z',
    },
    growth_duration_days: 80,
    harvest_duration_days: 30,
    created_at: '2024-01-10T00:00:00Z',
    updated_at: '2024-02-10T00:00:00Z',
    notes: 'Freiland',
  };

  it('removes ids and timestamps from portable crop data', () => {
    const portable = toPortableCrop(crop) as Record<string, unknown>;

    expect(portable).toMatchObject({
      name: 'Tomate',
      variety: 'Roma',
      supplierName: 'Bingenheimer',
      growth_duration_days: 80,
      harvest_duration_days: 30,
    });

    expect(portable).not.toHaveProperty('id');
    expect(portable).not.toHaveProperty('created_at');
    expect(portable).not.toHaveProperty('updated_at');
    expect(portable).not.toHaveProperty('supplier');
  });

  it('writes all cultivation types, the primary one first', () => {
    const portable = toPortableCrop({
      ...crop, cultivation_type: 'direct_sowing', cultivation_types: ['pre_cultivation', 'direct_sowing'],
    });

    expect(portable.cultivation_types).toEqual(['direct_sowing', 'pre_cultivation']);
  });

  it('leaves out an empty cultivation type list, which the import API rejects', () => {
    const portable = toPortableCrop({ ...crop, cultivation_types: [] }) as Record<string, unknown>;

    expect(portable).not.toHaveProperty('cultivation_types');
  });

  it('buildSingleCropFilename uses crop name and variety, not supplier', () => {
    const date = new Date('2026-06-29T00:00:00Z');
    expect(buildSingleCropFilename(crop, date)).toBe('kultur_tomate_roma_2026-06-29.json');
  });

  it('buildSingleCropFilename uses "unbekannt" for empty variety but never for the name itself', () => {
    const noVariety: Crop = { ...crop, variety: undefined };
    const date = new Date('2026-06-29T00:00:00Z');
    expect(buildSingleCropFilename(noVariety, date)).toBe('kultur_tomate_unbekannt_2026-06-29.json');
  });

  it('slugifyFilenamePart handles german umlauts and special chars', () => {
    expect(slugifyFilenamePart('Möhre & Kohl')).toBe('mohre_kohl');
    expect(slugifyFilenamePart('')).toBe('unbekannt');
    expect(slugifyFilenamePart('Anbau-Salat')).toBe('anbau_salat');
  });

  it('builds single and bulk export envelopes with schema version', () => {
    const single = buildSingleCropExport(crop, new Date('2026-01-15T00:00:00Z'));
    const all = buildAllCropsExport([crop], new Date('2026-01-15T00:00:00Z'));

    expect(single).toEqual({
      schemaVersion: 1,
      exportedAt: '2026-01-15',
      type: 'crop',
      crop: expect.objectContaining({ supplierName: 'Bingenheimer', variety: 'Roma' }),
    });

    expect(all).toEqual({
      schemaVersion: 1,
      exportedAt: '2026-01-15',
      type: 'crops',
      crops: [expect.objectContaining({ supplierName: 'Bingenheimer', variety: 'Roma' })],
    });
  });
});
