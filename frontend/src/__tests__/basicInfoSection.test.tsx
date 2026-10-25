import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BasicInfoSection } from '../crops/sections/BasicInfoSection';
import type { PlantFamily } from '../api/types';

const PLANT_FAMILIES: PlantFamily[] = [
  {
    botanical_name: 'Apiaceae',
    display_name: 'Doldenblütler',
    translations: { de: 'Doldenblütler', en: 'Doldenblütler' },
    default_rotation_break_years: 3,
  },
  {
    botanical_name: 'Asteraceae',
    display_name: 'Korbblütler',
    translations: { de: 'Korbblütler', en: 'Korbblütler' },
    default_rotation_break_years: 2,
  },
  {
    botanical_name: 'Poaceae',
    display_name: 'Süßgräser',
    translations: { de: 'Süßgräser', en: 'Süßgräser' },
    default_rotation_break_years: null,
  },
];

vi.mock('../api/api', () => ({
  plantFamilyAPI: { list: vi.fn(() => Promise.resolve({ data: PLANT_FAMILIES })) },
}));

// When `t` returns the key, a rendered helper text can be told apart by the
// key and its interpolation values.
const t = ((key: string, options?: Record<string, unknown>) => (
  options ? `${key}:${JSON.stringify(options)}` : key
)) as never;

/** The nutrient-demand select; the plant-family Autocomplete is a combobox too. */
const nutrientCombobox = (): HTMLElement => (
  screen.getAllByRole('combobox').find((element) => element.tagName !== 'INPUT') as HTMLElement
);

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

    expect(onChange).toHaveBeenCalledWith('name', 'Möhre');
    expect(onChange).toHaveBeenCalledWith('variety', 'Paris');
  });

  it('selects the plant family from the list and stores its botanical name', async () => {
    const onChange = vi.fn();

    render(
      <BasicInfoSection
        formData={{ crop_family: 'Apiaceae' }}
        errors={{}}
        onChange={onChange}
        t={t}
      />
    );

    const familyInput = screen.getByPlaceholderText('form.cropFamilyPlaceholder');
    expect(await screen.findByDisplayValue('Doldenblütler')).toBe(familyInput);

    const user = userEvent.setup();
    await user.clear(familyInput);
    // Searchable by the botanical name as well as by the display name.
    await user.type(familyInput, 'aster');
    const option = await screen.findByRole('option', { name: /Korbblütler/ });
    // The botanical name is the secondary text of each option.
    expect(within(option).getByText('Asteraceae')).toBeInTheDocument();
    await user.click(option);

    expect(onChange).toHaveBeenCalledWith('crop_family', 'Asteraceae');
  });

  it('moves the break definition and the family default into the label info tooltip', async () => {
    render(
      <BasicInfoSection
        formData={{ crop_family: 'Apiaceae', rotation_break_years: null }}
        errors={{}}
        onChange={vi.fn()}
        t={t}
      />
    );
    await screen.findByDisplayValue('Doldenblütler');

    const input = screen.getByRole('spinbutton', { name: 'form.rotationBreakYears' });
    expect(input).toHaveAttribute('placeholder', '3');
    // No helper text below the field any more.
    expect(screen.queryByText('form.rotationBreakYearsTooltip')).not.toBeInTheDocument();
    expect(input).not.toHaveAttribute('aria-describedby');

    const expected = 'form.rotationBreakYearsTooltip form.rotationBreakYearsFamilyDefault:{"family":"Doldenblütler","count":3}';
    const icon = screen.getByRole('img', { name: expected });
    expect(icon).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(document.body, { key: 'Tab' });
    act(() => icon.focus());
    expect(await screen.findByRole('tooltip')).toHaveTextContent(expected);
  });

  it('drops the default sentence from the tooltip when the family has none or none is chosen', async () => {
    const { rerender } = render(
      <BasicInfoSection
        formData={{ crop_family: 'Poaceae', rotation_break_years: null }}
        errors={{}}
        onChange={vi.fn()}
        t={t}
      />
    );
    await screen.findByDisplayValue('Süßgräser');
    expect(screen.getByRole('img', { name: 'form.rotationBreakYearsTooltip' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'form.rotationBreakYears' })).not.toHaveAttribute('placeholder');

    rerender(
      <BasicInfoSection
        formData={{ crop_family: null, rotation_break_years: 2 }}
        errors={{}}
        onChange={vi.fn()}
        t={t}
      />
    );
    expect(screen.getByRole('img', { name: 'form.rotationBreakYearsTooltip' })).toBeInTheDocument();
  });

  it('shows no field info icon when the rotation fields are read-only', async () => {
    render(
      <BasicInfoSection
        formData={{ crop_family: 'Apiaceae', rotation_break_years: null }}
        errors={{}}
        onChange={vi.fn()}
        t={t}
        speciesInvariantFieldsReadOnly
      />
    );
    await screen.findByDisplayValue('Doldenblütler');
    expect(screen.queryByRole('img', { name: /form\.rotationBreakYearsTooltip/ })).not.toBeInTheDocument();
    // The heading's info icon still explains the read-only fields.
    expect(screen.getByRole('img', { name: 'form.cropRotationInheritedTooltip' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'form.rotationBreakYears' })).toHaveAttribute('placeholder', '3');
  });

  it('points at the old free text when a migrated crop has no family yet', () => {
    render(
      <BasicInfoSection
        formData={{ crop_family: null, legacy_crop_family: 'Liliengewächse' }}
        errors={{}}
        onChange={vi.fn()}
        t={t}
      />
    );

    expect(screen.getByText('form.cropFamilyLegacyHint:{"value":"Liliengewächse"}')).toBeInTheDocument();
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

    fireEvent.mouseDown(nutrientCombobox());
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
    expect(nutrientCombobox()).not.toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByLabelText('form.cropRotationInheritedTooltip')).not.toBeInTheDocument();
  });

  it('renders the crop-rotation fields read-only with an info icon for a linked Sorte', async () => {
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
    expect(await screen.findByDisplayValue('Doldenblütler')).toBe(cropFamilyInput);
    expect(screen.getByLabelText('form.rotationBreakYears')).toBeDisabled();
    expect(nutrientCombobox()).toHaveAttribute('aria-disabled', 'true');

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
