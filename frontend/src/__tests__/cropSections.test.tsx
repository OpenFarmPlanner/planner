import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ColorSection } from '../crops/sections/ColorSection';
import { NotesSection } from '../crops/sections/NotesSection';
import { SpacingSection } from '../crops/sections/SpacingSection';
import { SeedingSection } from '../crops/sections/SeedingSection';
import { HarvestSection } from '../crops/sections/HarvestSection';
import { BasicInfoSection } from '../crops/sections/BasicInfoSection';

import i18n from '../i18n/config';

vi.mock('../components/data-grid/RichTextEditor', () => ({
  RichTextEditor: ({
    value,
    onChange,
    ariaLabel,
  }: {
    value: string;
    onChange: (value: string) => void;
    ariaLabel?: string;
  }) => (
    <textarea
      data-testid="rich-text-editor"
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

// Resolve against the real German bundle rather than a hand-kept stub map, so
// a key removed from the bundle fails the test instead of silently rendering
// the raw key.
const t = (key: string, options?: Record<string, unknown>) =>
  i18n.getFixedT('de', 'crops')(key, options) as string;

describe('crop form UI sections', () => {
  it('renders ColorSection with default color and emits display color changes', () => {
    const onChange = vi.fn();

    render(
      <ColorSection
        formData={{}}
        errors={{}}
        onChange={onChange}
        t={t}
        defaultColor="#00ff00"
      />
    );

    const colorInput = screen.getByLabelText('Anzeigefarbe');
    expect(colorInput).toHaveValue('#00ff00');
    expect(screen.getByText('#00FF00')).toBeInTheDocument();

    fireEvent.change(colorInput, { target: { value: '#123456' } });

    expect(onChange).toHaveBeenCalledWith('display_color', '#123456');
    expect(screen.getByText('Farbe zur Darstellung im Anbaukalender.')).toBeInTheDocument();
  });

  it('renders the saved display color as a visible hex value', () => {
    render(
      <ColorSection
        formData={{ display_color: '#7cb342' }}
        errors={{}}
        onChange={vi.fn()}
        t={t}
        defaultColor="#00ff00"
      />
    );

    expect(screen.getByLabelText('Anzeigefarbe')).toHaveValue('#7cb342');
    expect(screen.getByText('#7CB342')).toBeInTheDocument();
  });

  it('keeps invalid display color validation visible', () => {
    render(
      <ColorSection
        formData={{ display_color: '#12ZZ00' }}
        errors={{ display_color: 'Ungültiges Farbformat (verwenden Sie #RRGGBB)' }}
        onChange={vi.fn()}
        t={t}
        defaultColor="#00ff00"
      />
    );

    expect(screen.getByLabelText('Anzeigefarbe')).toHaveValue('#00ff00');
    expect(screen.getByText('#12ZZ00')).toBeInTheDocument();
    expect(screen.getByText('Ungültiges Farbformat (verwenden Sie #RRGGBB)')).toBeInTheDocument();
  });

  it('renders NotesSection as a rich-text editor and emits note changes', async () => {
    const onChange = vi.fn();

    render(
      <NotesSection
        formData={{ notes: 'Bestehende Notiz' }}
        errors={{}}
        onChange={onChange}
        t={t}
      />
    );

    const notesInput = screen.getByRole('textbox', { name: 'Notizen' });
    expect(screen.getByTestId('rich-text-editor')).toBeInTheDocument();
    expect(notesInput).toHaveValue('Bestehende Notiz');

    fireEvent.change(notesInput, { target: { value: 'Neue Notiz' } });

    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('notes', 'Neue Notiz'));
  });

  it('renders SpacingSection and parses numeric inputs', () => {
    const onChange = vi.fn();

    render(
      <SpacingSection
        formData={{}}
        errors={{}}
        onChange={onChange}
        t={t}
      />
    );

    const distanceWithinRowInput = screen.getByLabelText('Abstand in der Reihe (cm)');
    const rowSpacingInput = screen.getByLabelText('Reihenabstand (cm)');
    const sowingDepthInput = screen.getByLabelText('Saattiefe (cm)');

    expect(distanceWithinRowInput).toHaveAttribute('inputmode', 'numeric');
    expect(rowSpacingInput).toHaveAttribute('inputmode', 'numeric');
    expect(sowingDepthInput).toHaveAttribute('inputmode', 'decimal');

    fireEvent.change(distanceWithinRowInput, { target: { value: '25' } });
    fireEvent.change(rowSpacingInput, { target: { value: '40' } });
    fireEvent.change(sowingDepthInput, { target: { value: '2.1' } });

    expect(onChange).toHaveBeenCalledWith('distance_within_row_cm', 25);
    expect(onChange).toHaveBeenCalledWith('row_spacing_cm', 40);
    expect(onChange).toHaveBeenCalledWith('sowing_depth_cm', 2.1);

  });

  it('renders SeedingSection and handles method-specific seed changes', () => {
    const onChange = vi.fn();

    render(
      <SeedingSection
        formData={{ cultivation_types: ['direct_sowing'], seed_rate_direct_value: 5, seed_rate_direct_unit: 'g_per_lfm' }}
        errors={{ seed_rate_direct_unit: 'Bitte wählen' }}
        onChange={onChange}
        t={t}
      />
    );

    const amountInput = screen.getByLabelText('Menge');
    expect(amountInput).toHaveAttribute('min', '0.001');
    expect(amountInput).toHaveAttribute('step', '0.001');
    fireEvent.change(amountInput, { target: { value: '12.5' } });
    expect(onChange).toHaveBeenCalledWith('seed_rate_direct_value', 12.5);

    const safetyInput = screen.getByLabelText('Sicherheitszuschlag für Saatgut (%)');
    fireEvent.change(safetyInput, { target: { value: '10' } });
    expect(onChange).toHaveBeenCalledWith('sowing_calculation_safety_percent_direct', 10);

    const tkgInput = screen.getByLabelText('1000-Korn-Gewicht (g)');
    fireEvent.change(tkgInput, { target: { value: '3,9' } });
    expect(onChange).toHaveBeenCalledWith('thousand_kernel_weight_g', 3.9);

    expect(screen.getByText('Bitte wählen')).toBeInTheDocument();
  });

  it('hides the seed safety margin field when showSeedSafetyMargin is false (public library form)', () => {
    render(
      <SeedingSection
        formData={{ cultivation_types: ['direct_sowing'], seed_rate_direct_value: 5 }}
        errors={{}}
        onChange={vi.fn()}
        t={t}
        showSeedSafetyMargin={false}
      />
    );

    expect(screen.queryByLabelText('Sicherheitszuschlag für Saatgut (%)')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Menge')).toBeInTheDocument();
  });

  it('renders an empty seed unit placeholder without a synthetic option', () => {
    const onChange = vi.fn();

    render(
      <SeedingSection
        formData={{ cultivation_types: ['direct_sowing'], seed_rate_direct_unit: null }}
        errors={{}}
        onChange={onChange}
        t={t}
      />
    );

    expect(screen.getByText('Einheit auswählen')).toBeInTheDocument();
    expect(screen.queryByText('-')).not.toBeInTheDocument();
  });

  it('hides the seed unit tooltip while the dropdown menu is open', async () => {
    const onChange = vi.fn();

    render(
      <SeedingSection
        formData={{ cultivation_types: ['direct_sowing'], seed_rate_direct_unit: 'g_per_m2' }}
        errors={{}}
        onChange={onChange}
        t={t}
      />
    );

    const unitSelect = screen.getByRole('combobox');
    fireEvent.mouseOver(unitSelect);

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Saatgutmenge pro ausgewählter Einheit. Daraus wird der Gesamtbedarf berechnet.');

    fireEvent.mouseDown(unitSelect);

    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });
  });

  it('shows method blocks based on selected cultivation types', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SeedingSection
        formData={{ cultivation_types: ['direct_sowing'] }}
        errors={{}}
        onChange={onChange}
        t={t}
      />
    );
    expect(screen.getByText('Saatgutbedarf Direktsaat')).toBeInTheDocument();
    expect(screen.queryByText('Saatgutbedarf Pflanzung')).not.toBeInTheDocument();

    rerender(
      <SeedingSection
        formData={{ cultivation_types: ['pre_cultivation', 'direct_sowing'] }}
        errors={{}}
        onChange={onChange}
        t={t}
      />
    );
    expect(screen.getByText('Saatgutbedarf Direktsaat')).toBeInTheDocument();
    expect(screen.getByText('Saatgutbedarf Pflanzung')).toBeInTheDocument();
  });

  it('keeps hidden method values and shows them again after re-activation', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SeedingSection
        formData={{
          cultivation_types: ['direct_sowing', 'pre_cultivation'],
          seed_rate_direct_value: 7,
          seed_rate_direct_unit: 'g_per_m2',
          seed_rate_pre_cultivation_value: 3,
          seed_rate_pre_cultivation_unit: 'g_per_m2',
        }}
        errors={{}}
        onChange={onChange}
        t={t}
      />
    );

    expect(screen.getByDisplayValue('7')).toBeInTheDocument();
    expect(screen.getByDisplayValue('3')).toBeInTheDocument();

    rerender(
      <SeedingSection
        formData={{
          cultivation_types: ['pre_cultivation'],
          seed_rate_direct_value: 7,
          seed_rate_direct_unit: 'g_per_m2',
          seed_rate_pre_cultivation_value: 3,
          seed_rate_pre_cultivation_unit: 'g_per_m2',
        }}
        errors={{}}
        onChange={onChange}
        t={t}
      />
    );
    expect(screen.queryByDisplayValue('7')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('3')).toBeInTheDocument();

    rerender(
      <SeedingSection
        formData={{
          cultivation_types: ['pre_cultivation', 'direct_sowing'],
          seed_rate_direct_value: 7,
          seed_rate_direct_unit: 'g_per_m2',
          seed_rate_pre_cultivation_value: 3,
          seed_rate_pre_cultivation_unit: 'g_per_m2',
        }}
        errors={{}}
        onChange={onChange}
        t={t}
      />
    );
    expect(screen.getByDisplayValue('7')).toBeInTheDocument();
    expect(screen.getByDisplayValue('3')).toBeInTheDocument();
  });



  it('renders HarvestSection and parses expected yield input including empty value', () => {
    const onChange = vi.fn();

    render(
      <HarvestSection
        formData={{ expected_yield: 3.5 }}
        errors={{ expected_yield: 'Ungültig' }}
        onChange={onChange}
        t={t}
      />
    );

    const yieldInput = screen.getByLabelText('Erwarteter Ertrag (kg)');
    // Shown with the UI language's decimal separator in every browser, not
    // the engine's native number formatting.
    expect(yieldInput).toHaveValue('3,5');
    expect(yieldInput).toHaveAttribute('inputmode', 'decimal');

    fireEvent.change(yieldInput, { target: { value: '4.25' } });
    expect(onChange).toHaveBeenCalledWith('expected_yield', 4.25);
    fireEvent.change(yieldInput, { target: { value: '4,75' } });
    expect(onChange).toHaveBeenCalledWith('expected_yield', 4.75);

    fireEvent.change(yieldInput, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith('expected_yield', undefined);
    expect(screen.getByText('Ungültig')).toBeInTheDocument();
    expect(screen.getByLabelText('Erwarteter Ertrag (kg)')).toBeInTheDocument();
  });

  it('name and variety fields enforce maxLength=200 (K-01 regression guard)', () => {
    render(
      <BasicInfoSection
        formData={{ name: '', variety: '' }}
        errors={{}}
        onChange={vi.fn()}
        t={t}
      />
    );

    const nameInput = screen.getByLabelText(/^Name/i);
    const varietyInput = screen.getByLabelText(/^Sorte/i);

    expect(nameInput).toHaveAttribute('maxlength', '200');
    expect(varietyInput).toHaveAttribute('maxlength', '200');
  });
});
