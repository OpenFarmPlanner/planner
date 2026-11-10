import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { YieldSection } from '../crops/sections/YieldSection';
import { SeedingSection } from '../crops/sections/SeedingSection';

import i18n from '../i18n/config';

const t = (key: string, options?: Record<string, unknown>) =>
  i18n.getFixedT('de', 'crops')(key, options) as string;

describe('YieldSection and SeedingSection', () => {
  it('changes yield unit via select', () => {
    const onChange = vi.fn();

    render(
      <YieldSection
        formData={{ harvest_method: '' }}
        errors={{ harvest_method: 'required' }}
        onChange={onChange}
        t={t}
      />
    );

    const harvestCombobox = screen.getAllByRole('combobox')[0];
    fireEvent.mouseDown(harvestCombobox);
    fireEvent.click(screen.getByRole('option', { name: 'Pro Pflanze' }));

    expect(onChange).toHaveBeenCalledWith('harvest_method', 'per_plant');
    expect(screen.getByLabelText('Erwarteter Ertrag')).toHaveAttribute('inputmode', 'decimal');
    expect(screen.getByText('Ertragseinheit ist bei angegebenem Ertrag erforderlich')).toBeInTheDocument();
  });

  it('is titled "Ertrag" and holds no harvest duration (it sits in the timing section)', () => {
    render(<YieldSection formData={{}} errors={{}} onChange={vi.fn()} t={t} />);

    expect(screen.getByRole('heading', { name: 'Ertrag' })).toBeInTheDocument();
    expect(screen.queryByLabelText(t('form.harvestDurationDays'))).not.toBeInTheDocument();
  });

  it('shows no hover tooltips on the seed rate and safety margin fields', async () => {
    const user = userEvent.setup();
    render(
      <SeedingSection
        formData={{ cultivation_types: ['direct_sowing'], seed_rate_direct_unit: 'g_per_m2', seed_rate_direct_value: 3 }}
        errors={{}}
        onChange={vi.fn()}
        t={t}
      />
    );

    for (const field of [screen.getByLabelText('Menge'), screen.getByLabelText('Sicherheitszuschlag für Saatgut (%)')]) {
      await user.hover(field);
      await user.click(field);
    }
    await user.hover(screen.getAllByRole('combobox')[0]);
    // MUI opens a tooltip after its enter delay; wait past it.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    // Only the thousand kernel weight keeps its help, behind an info button.
    expect(screen.getAllByRole('button', { name: /^Info zu / })).toHaveLength(1);
  });

  it('explains the thousand kernel weight through an info button inside the field', async () => {
    const user = userEvent.setup();
    render(<SeedingSection formData={{ cultivation_types: ['direct_sowing'] }} errors={{}} onChange={vi.fn()} t={t} />);

    const field = screen.getByLabelText('1000-Korn-Gewicht (g)');
    await user.hover(field);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    const infoButton = screen.getByRole('button', { name: 'Info zu 1000-Korn-Gewicht (g)' });
    expect(field.closest('.MuiInputBase-root')).toContainElement(infoButton);
    await user.click(infoButton);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(t('form.thousandKernelWeightHelp'));
    await user.click(document.body);
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
  });

  it('handles seeding unit select and blur callbacks', () => {
    const onChange = vi.fn();

    render(
      <SeedingSection
        formData={{ cultivation_types: ['direct_sowing'], seed_rate_direct_unit: 'g_per_m2', seed_rate_direct_value: 3 }}
        errors={{ seed_rate_direct_value: 'invalid' }}
        onChange={onChange}
        t={t}
      />
    );

    const amountInput = screen.getByLabelText('Menge');
    expect(amountInput).toHaveAttribute('min', '0.001');
    expect(amountInput).toHaveAttribute('step', '0.001');
    expect(amountInput).toHaveAttribute('inputmode', 'decimal');
    fireEvent.change(amountInput, { target: { value: '4' } });
    expect(onChange).toHaveBeenCalledWith('seed_rate_direct_value', 4);

    expect(screen.getByLabelText('Sicherheitszuschlag für Saatgut (%)')).toHaveAttribute('inputmode', 'decimal');
    expect(screen.getByLabelText('1000-Korn-Gewicht (g)')).toHaveAttribute('inputmode', 'decimal');

    const unitCombobox = screen.getAllByRole('combobox')[0];
    fireEvent.mouseDown(unitCombobox);
    fireEvent.click(screen.getByRole('option', { name: 'g / lfm' }));
    expect(onChange).toHaveBeenCalledWith('seed_rate_direct_unit', 'g_per_lfm');
    
    expect(screen.getByText('invalid')).toBeInTheDocument();
  });

  it('uses backend seed-rate constraints for seeds per plant inputs', () => {
    render(
      <SeedingSection
        formData={{
          cultivation_types: ['pre_cultivation'],
          seed_rate_pre_cultivation_unit: 'seeds_per_plant',
          seed_rate_pre_cultivation_value: 1,
        }}
        errors={{}}
        onChange={vi.fn()}
        t={t}
        seedRateUnitConstraints={{
          g_per_m2: { value_type: 'number', step: 0.001, minimum: 0.001 },
          g_per_lfm: { value_type: 'number', step: 0.001, minimum: 0.001 },
          seeds_per_m2: { value_type: 'number', step: 0.001, minimum: 0.001 },
          seeds_per_lfm: { value_type: 'number', step: 0.001, minimum: 0.001 },
          seeds_per_plant: { value_type: 'integer', step: 1, minimum: 1 },
        }}
      />
    );

    const amountInput = screen.getByLabelText('Menge');
    expect(amountInput).toHaveAttribute('min', '1');
    expect(amountInput).toHaveAttribute('step', '1');
    expect(amountInput).toHaveAttribute('inputmode', 'numeric');
  });

});
