import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BasicInfoSection } from '../crops/sections/BasicInfoSection';

const t = ((key: string) => key) as never;

const linkedVarietyForm = {
  name: 'Karotte',
  variety: 'Nantaise',
  crop_species: 5,
  crop_family: 'Apiaceae',
  nutrient_demand: 'medium',
  rotation_break_years: 4,
};

describe('BasicInfoSection', () => {
  it('disables variety identity editing when requested', () => {
    render(
      <BasicInfoSection
        formData={{ variety: 'Nantaise' }}
        errors={{}}
        onChange={vi.fn()}
        t={t}
        showIdentityFields={false}
        varietyReadOnly
      />
    );

    expect(screen.getByPlaceholderText('form.varietyPlaceholder')).toBeDisabled();
  });

  it('updates basic text fields', () => {
    const onChange = vi.fn();

    render(
      <BasicInfoSection
        formData={{ name: 'Karotte', variety: 'Nantaise', crop_family: 'Apiaceae' }}
        errors={{}}
        onChange={onChange}
        t={t}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('form.namePlaceholder'), { target: { value: 'Möhre' } });
    fireEvent.change(screen.getByPlaceholderText('form.varietyPlaceholder'), { target: { value: 'Paris' } });
    fireEvent.change(screen.getByPlaceholderText('form.cropFamilyPlaceholder'), { target: { value: 'Asteraceae' } });

    expect(onChange).toHaveBeenCalledWith('name', 'Möhre');
    expect(onChange).toHaveBeenCalledWith('variety', 'Paris');
    expect(onChange).toHaveBeenCalledWith('crop_family', 'Asteraceae');
  });

  it('updates nutrient demand via select', () => {
    const onChange = vi.fn();

    render(
      <BasicInfoSection
        formData={{ nutrient_demand: '' }}
        errors={{}}
        onChange={onChange}
        t={t}
      />
    );

    const nutrientCombobox = screen.getByRole('combobox');
    fireEvent.mouseDown(nutrientCombobox);
    fireEvent.click(screen.getByRole('option', { name: 'form.nutrientDemandHigh' }));

    expect(onChange).toHaveBeenCalledWith('nutrient_demand', 'high');
  });

  it('updates the rotation break in years, clearing back to null', () => {
    const onChange = vi.fn();

    render(
      <BasicInfoSection
        formData={{ rotation_break_years: 3 }}
        errors={{}}
        onChange={onChange}
        t={t}
      />
    );

    const rotationBreakInput = screen.getByLabelText('form.rotationBreakYears');
    expect(rotationBreakInput).toHaveValue(3);

    fireEvent.change(rotationBreakInput, { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledWith('rotation_break_years', 5);

    fireEvent.change(rotationBreakInput, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith('rotation_break_years', null);
  });

  it('keeps the crop-rotation fields editable with no info icon by default', () => {
    render(
      <BasicInfoSection
        formData={{ crop_family: 'Apiaceae', nutrient_demand: 'medium', rotation_break_years: 2 }}
        errors={{}}
        onChange={vi.fn()}
        t={t}
      />
    );

    expect(screen.getByText('form.sectionCropRotation')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('form.cropFamilyPlaceholder')).toBeEnabled();
    expect(screen.getByLabelText('form.rotationBreakYears')).toBeEnabled();
    expect(screen.getByRole('combobox')).not.toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByLabelText('form.cropRotationInheritedTooltip')).not.toBeInTheDocument();
  });

  it('renders the crop-rotation fields read-only with an info icon for a linked Sorte', () => {
    const onChange = vi.fn();

    render(
      <BasicInfoSection
        formData={linkedVarietyForm}
        errors={{}}
        onChange={onChange}
        t={t}
        speciesInvariantFieldsReadOnly
      />
    );

    const cropFamilyInput = screen.getByPlaceholderText('form.cropFamilyPlaceholder');
    expect(cropFamilyInput).toBeDisabled();
    expect(cropFamilyInput).toHaveValue('Apiaceae');
    expect(screen.getByLabelText('form.rotationBreakYears')).toBeDisabled();
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-disabled', 'true');

    const infoIcon = screen.getByLabelText('form.cropRotationInheritedTooltip');
    expect(infoIcon).toHaveAttribute('tabindex', '0');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the info-icon tooltip on hover and on keyboard focus', async () => {
    render(
      <BasicInfoSection
        formData={linkedVarietyForm}
        errors={{}}
        onChange={vi.fn()}
        t={t}
        speciesInvariantFieldsReadOnly
      />
    );

    const infoIcon = screen.getByLabelText('form.cropRotationInheritedTooltip');

    fireEvent.mouseOver(infoIcon);
    expect(await screen.findByRole('tooltip'))
      .toHaveTextContent('form.cropRotationInheritedTooltip');
    fireEvent.mouseLeave(infoIcon);

    fireEvent.focus(infoIcon);
    expect(await screen.findByRole('tooltip'))
      .toHaveTextContent('form.cropRotationInheritedTooltip');
  });
});
