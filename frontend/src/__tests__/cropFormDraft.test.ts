import { describe, expect, it } from 'vitest';
import type { Crop, PublicCrop } from '../api/types';
import {
  buildDraftFromPublicCrop,
  buildInitialFormData,
  emptyInheritableValue,
  getPublicCropDraftName,
} from '../crops/cropFormDraft';

describe('crop form draft calculations', () => {
  it('keeps creation defaults and overlays only the supplied initial fields', () => {
    const empty = buildInitialFormData();
    expect(empty).toMatchObject({
      name: '', variety: '', cultivation_types: ['pre_cultivation'],
      crop_family: null, seed_rate_value: null, timing_windows: [],
    });
    expect(buildInitialFormData(undefined, { name: 'Carrot', notes: 'Private' })).toMatchObject({
      name: 'Carrot', notes: 'Private', cultivation_types: ['pre_cultivation'],
    });
    expect(empty.name).toBe('');
  });

  it('normalizes edit spacing and citations without changing the source crop', () => {
    const crop: Crop = {
      name: 'Old name', crop_display_name: 'Current name', variety: '',
      distance_within_row_cm: 12.6, row_spacing_cm: 30.3,
      sowing_depth_cm: 1.25, notes: 'Private note 【123†source】',
    };
    expect(buildInitialFormData(crop)).toMatchObject({
      name: 'Current name', distance_within_row_cm: 13, row_spacing_cm: 30,
      sowing_depth_cm: 1.25, notes: 'Private note',
    });
    expect(crop.distance_within_row_cm).toBe(12.6);
    expect(crop.notes).toContain('【');
  });

  it('adapts legacy supplier text only when there is no supplier object', () => {
    const crop: Crop = { name: 'Carrot', variety: '', seed_supplier: 'Legacy seed shop' };
    expect(buildInitialFormData(crop).supplier).toEqual({ name: 'Legacy seed shop', allowed_domains: [] });
    const supplier = { id: 5, name: 'Selected shop', allowed_domains: [] };
    expect(buildInitialFormData({ ...crop, supplier }).supplier).toBe(supplier);
    expect(crop.supplier).toBeUndefined();
  });

  it('displays inherited variety values without changing stored overrides', () => {
    const crop: Crop = {
      name: 'Carrot', variety: 'Synthetic', general_crop: 3,
      inherited_fields: ['growth_duration_days', 'row_spacing_cm'],
      effective_values: { growth_duration_days: 80, row_spacing_cm: 30.6 },
      growth_duration_days: null, row_spacing_cm: undefined,
    };
    expect(buildInitialFormData(crop)).toMatchObject({
      growth_duration_days: 80, row_spacing_cm: 31,
    });
    expect(crop.growth_duration_days).toBeNull();
    expect(crop.row_spacing_cm).toBeUndefined();
  });

  it('retains legacy seed-rate unit normalization for edit drafts', () => {
    const crop = {
      name: 'Carrot', variety: '', seed_rate_unit: 'g/m²', seed_rate_direct_unit: '-',
      seed_rate_pre_cultivation_unit: 'seeds per plant',
    } as unknown as Crop;
    expect(buildInitialFormData(crop)).toMatchObject({
      seed_rate_unit: 'g_per_m2', seed_rate_direct_unit: null,
      seed_rate_pre_cultivation_unit: 'seeds_per_plant',
    });
    expect(crop.seed_rate_unit).toBe('g/m²');
  });

  it('uses the served library name with the established fallback order', () => {
    const entry = { name: 'Canonical', crop_species_name: 'Species', display_name: 'Localized' } as PublicCrop;
    expect(getPublicCropDraftName(entry)).toBe('Localized');
    expect(getPublicCropDraftName({ ...entry, display_name: '' })).toBe('Species');
    expect(getPublicCropDraftName({ ...entry, display_name: '', crop_species_name: '' })).toBe('Canonical');
  });

  it('retains explicit library provenance and precise sowing depth in an import draft', () => {
    const entry = {
      id: 15, version: 7, name: 'Carrot', variety: 'Synthetic', notes: 'Library note',
      distance_within_row_m: 0.126, row_spacing_m: 0.303,
      sowing_depth_m: 0.0125, sowing_depth_max_m: 0.025,
      specific_properties: { synthetic: 1 }, cultivation_types: ['direct_sowing'],
    } as PublicCrop;
    const draft = buildDraftFromPublicCrop(entry);
    expect(draft).toMatchObject({
      source_public_crop: 15, source_public_version: 7, origin_type: 'imported',
      is_modified_from_source: false, notes: 'Library note',
      distance_within_row_cm: 13, row_spacing_cm: 30,
      sowing_depth_cm: 1.25, sowing_depth_max_cm: 2.5,
      cultivation_types: ['direct_sowing'],
    });
    expect(draft.specific_properties).not.toBe(entry.specific_properties);
    expect(entry.distance_within_row_m).toBe(0.126);
  });

  it('preserves list-valued inheritance resets instead of sending empty strings', () => {
    expect(emptyInheritableValue('tags', ['old'])).toEqual([]);
    expect(emptyInheritableValue('notes', 'old')).toBe('');
    expect(emptyInheritableValue('growth_duration_days', 42)).toBeUndefined();
    expect(emptyInheritableValue('specific_properties', { synthetic: 1 })).toEqual({});
  });
});
