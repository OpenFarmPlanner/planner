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

  it('groups each from/to pair in one range field and labels the minimum temperature like any field', () => {
    render(<GerminationSection formData={{ germination_days_min: 14, germination_days_max: 7 }} errors={{}} onChange={vi.fn()} t={t} />);

    const temperature = screen.getByRole('group', { name: 'germination.optimalTemperature' });
    expect(temperature).toContainElement(screen.getByLabelText('germination.fields.germination_temperature_optimal_min_c'));
    expect(temperature).toContainElement(screen.getByLabelText('germination.fields.germination_temperature_optimal_max_c'));
    const days = screen.getByRole('group', { name: 'germination.days' });
    expect(days).toContainElement(screen.getByLabelText('germination.fields.germination_days_min'));
    // From greater than To: the inline error sits below the range field.
    expect(days).toHaveTextContent('germination.invalidRange');

    // A regular outlined field with its floating label, not a caption above it.
    const minimum = screen.getByLabelText('germination.fields.germination_temperature_min_c');
    expect(minimum.closest('[role="group"]')).toBeNull();
    expect(screen.getByText('germination.fields.germination_temperature_min_c', { selector: 'label' }))
      .toHaveAttribute('for', minimum.id);
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

  it('uses independent single-choice selectors and conditionally shows the stratification ranges', () => {
    const onChange = vi.fn();
    const { rerender } = render(<GerminationSection formData={{}} errors={{}} onChange={onChange} t={t} />);
    expect(screen.queryByLabelText('germination.fields.stratification_days_min')).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'germination.fields.germination_temperature_requirement' }));
    fireEvent.click(screen.getByRole('option', { name: 'germination.values.germination_temperature_requirement.cold_stratification' }));
    expect(onChange).toHaveBeenCalledWith('germination_temperature_requirement', 'cold_stratification');
    expect(onChange).not.toHaveBeenCalledWith('germination_light_requirement', expect.anything());
    rerender(<GerminationSection formData={{ germination_temperature_requirement: 'cold_stratification', germination_light_requirement: 'light' }} errors={{}} onChange={onChange} t={t} />);
    expect(screen.getByLabelText('germination.fields.stratification_days_min')).toBeVisible();
    expect(screen.getByLabelText('germination.fields.stratification_days_max')).toBeVisible();
    fireEvent.change(screen.getByLabelText('germination.fields.stratification_temperature_min_c'), { target: { value: '-5' } });
    expect(onChange).toHaveBeenCalledWith('stratification_temperature_min_c', -5);
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'germination.fields.germination_light_requirement' }));
    fireEvent.click(screen.getByRole('option', { name: 'germination.values.germination_light_requirement.dark' }));
    expect(onChange).toHaveBeenCalledWith('germination_light_requirement', 'dark');
    rerender(<GerminationSection formData={{ germination_temperature_requirement: 'none' }} errors={{}} onChange={onChange} t={t} />);
    expect(screen.queryByLabelText('germination.fields.stratification_days_min')).not.toBeInTheDocument();
  });

  it('detects canonical edits, validates partial ranges, and preserves all fields in public updates', () => {
    const values = {
      germination_temperature_requirement: 'frost_treatment', germination_light_requirement: 'none',
      stratification_days_min: 0, stratification_days_max: null,
      stratification_temperature_min_c: -5.5, stratification_temperature_max_c: null,
    } as const;
    expect(hasEffectiveCropFormChanges({}, values)).toBe(true);
    const payload = buildPublicCropUpdatePayload(publicCropToCropFormData({ id: 1, name: 'Test', ...values } as PublicCrop), 1);
    expect(payload).toMatchObject(values);
    const draft = { name: 'Test', ...values } as Crop;
    expect(validateCrop(draft, t).errors.stratification_days_min).toBeUndefined();
    expect(validateCrop({ ...draft, stratification_days_max: -1 }, t).errors.stratification_days_max).toBeDefined();
    expect(validateCrop({ ...draft, stratification_days_min: 1.5 }, t).errors.stratification_days_min).toBe('germination.invalidNumber');
    expect(validateCrop({ ...draft, stratification_temperature_max_c: -6 }, t).errors.stratification_temperature_max_c).toBe('germination.invalidRange');
  });

  it('warns about retained legacy conflicts without arbitrarily selecting a requirement', () => {
    render(<GerminationSection formData={{ germination_types: ['cold', 'frost', 'light', 'dark'] }} errors={{}} onChange={vi.fn()} t={t} />);
    expect(screen.getByRole('alert')).toHaveTextContent('germination.legacyConflict');
    expect(screen.queryByLabelText('germination.fields.stratification_days_min')).not.toBeInTheDocument();
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
