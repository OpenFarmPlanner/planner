import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GerminationSection } from '../crops/sections/GerminationSection';
import { validateCrop } from '../crops/validation';
import { hasEffectiveCropFormChanges } from '../crops/cropFormChangeDetection';
import { publicCropToCropFormData, buildPublicCropUpdatePayload } from '../crops/publicCropFormAdapter';
import type { Crop, PublicCrop } from '../api/types';

const t = (key: string) => key;

describe('germination crop fields', () => {
  it('edits and clears range endpoints and shows a non-blocking propagation hint', () => {
    const onChange = vi.fn();
    render(<GerminationSection formData={{ cultivation_types: ['pre_cultivation'], propagation_duration_days: 5, germination_days_max: 14, germination_days_min: 7 }} errors={{}} onChange={onChange} t={t} />);
    expect(screen.getByRole('alert')).toHaveTextContent('germination.propagationShort');
    const input = screen.getByLabelText('germination.fields.germination_days_min');
    fireEvent.change(input, { target: { value: '3' } });
    expect(onChange).toHaveBeenCalledWith('germination_days_min', 3);
    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith('germination_days_min', null);
  });

  it('detects edits to requirements and ignores their order', () => {
    expect(hasEffectiveCropFormChanges({}, { germination_types: ['cold'] })).toBe(true);
    expect(hasEffectiveCropFormChanges({ germination_types: ['cold', 'light'] }, { germination_types: ['light', 'cold'] })).toBe(false);
    expect(hasEffectiveCropFormChanges({}, { germination_pretreatment: 'Chill' })).toBe(true);
  });

  it('validates reversed ranges and fractional or negative days without blocking on short propagation', () => {
    const base = { name: 'Test', germination_days_min: 7, germination_days_max: 14, cultivation_types: ['pre_cultivation'], propagation_duration_days: 3 } as Crop;
    expect(validateCrop(base, t).errors.germination_days_max).toBeUndefined();
    expect(validateCrop({ ...base, germination_days_max: 5 }, t).errors.germination_days_max).toBe('germination.invalidRange');
    expect(validateCrop({ ...base, germination_days_min: -1 }, t).errors.germination_days_min).toBe('germination.invalidNumber');
    expect(validateCrop({ ...base, germination_days_min: 1.5 }, t).errors.germination_days_min).toBe('germination.invalidNumber');
  });

  it('keeps germination fields when editing a public crop', () => {
    const crop = { id: 1, name: 'Test', germination_days_min: 7, germination_days_max: 14, germination_types: ['light'], germination_pretreatment: 'Soak' } as PublicCrop;
    const draft = publicCropToCropFormData(crop);
    const payload = buildPublicCropUpdatePayload(draft, 1);
    expect(payload).toMatchObject({ germination_days_min: 7, germination_days_max: 14, germination_types: ['light'], germination_pretreatment: 'Soak' });
  });
});

describe('germination plan information', () => {
  it('shows localized hints and the expected emergence range', async () => {
    const { GerminationInfo } = await import('../components/planting-plans/GerminationInfo');
    render(<GerminationInfo germination_findings={[{ code: 'cold_period_required' }]} expected_emergence={{ min: '2026-06-03', max: '2026-06-10' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Kälteperiode');
    expect(screen.getByText(/Auflaufen ca\./)).toHaveTextContent('2026');
  });
});
