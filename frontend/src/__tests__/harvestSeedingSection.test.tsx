import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HarvestSection } from '../crops/sections/HarvestSection';
import { SeedingSection } from '../crops/sections/SeedingSection';

import i18n from '../i18n/config';

const t = (key: string, options?: Record<string, unknown>) =>
  i18n.getFixedT('de', 'crops')(key, options) as string;

describe('HarvestSection and SeedingSection', () => {
  it('changes yield unit via select', () => {
    const onChange = vi.fn();

    render(
      <HarvestSection
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
    expect(screen.getByLabelText('Erwarteter Ertrag (kg)')).toHaveAttribute('inputmode', 'decimal');
    expect(screen.getByText('Ertragseinheit ist bei angegebenem Ertrag erforderlich')).toBeInTheDocument();
  });

  it('edits the harvest duration and explains it in a tooltip', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <HarvestSection
        formData={{ harvest_duration_days: 7 }}
        errors={{}}
        onChange={onChange}
        t={t}
      />
    );

    const harvestInput = screen.getByLabelText(t('form.harvestDurationDays'));
    expect(harvestInput).toHaveAttribute('inputmode', 'numeric');
    fireEvent.change(harvestInput, { target: { value: '12' } });
    expect(onChange).toHaveBeenCalledWith('harvest_duration_days', 12);
    fireEvent.change(harvestInput, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith('harvest_duration_days', 0);

    await user.hover(harvestInput);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(t('form.harvestDurationDaysHelp'));
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
