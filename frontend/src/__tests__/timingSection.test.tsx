import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TimingSection } from '../crops/sections/TimingSection';
import type { GetVarietyFieldTooltipProps } from '../crops/varietyFieldTooltipHelpers';

const translations: Record<string, string> = {
  'form.cultivationType': 'Anbauart',
  'form.cultivationTypeDirectSowing': 'Direktsaat',
  'form.cultivationTypePreCultivation': 'Pflanzung',
  'form.growthDurationDays': 'Wachstumszeit (Tage)',
  'form.growthDurationDaysHelp': 'Zeit vom Pflanzdatum bis zum Erntebeginn.',
  'form.propagationDurationDays': 'Anzuchtdauer (Tage)',
  'form.propagationDurationDaysHelp': 'Zeit vom Beginn der Anzucht bis zum Pflanzdatum.',
};

const t = (key: string) => translations[key] ?? key;

describe('TimingSection', () => {
  it('parses growth and propagation duration inputs', () => {
    const onChange = vi.fn();

    render(
      <TimingSection
        formData={{ cultivation_type: 'pre_cultivation', cultivation_types: ['pre_cultivation'] }}
        errors={{}}
        onChange={onChange}
        t={t}
      />
    );

    const growthInput = screen.getByPlaceholderText('form.growthDurationDaysPlaceholder');
    const propagationInput = screen.getByLabelText(/Anzuchtdauer \(Tage\)/);

    expect(growthInput).toHaveAttribute('inputmode', 'numeric');
    expect(propagationInput).toHaveAttribute('inputmode', 'numeric');

    fireEvent.change(growthInput, { target: { value: '30' } });
    fireEvent.change(propagationInput, { target: { value: '8' } });

    expect(onChange).toHaveBeenCalledWith('growth_duration_days', 30);
    expect(onChange).toHaveBeenCalledWith('propagation_duration_days', 8);
  });

  it('explains each timing field using the dates used by the calculation', async () => {
    const user = userEvent.setup();
    render(
      <TimingSection
        formData={{ cultivation_type: 'pre_cultivation', cultivation_types: ['pre_cultivation'] }}
        errors={{}}
        onChange={vi.fn()}
        t={t}
      />
    );

    const assertions = [
      ['Wachstumszeit (Tage)', 'Zeit vom Pflanzdatum bis zum Erntebeginn.'],
      ['Anzuchtdauer (Tage)', 'Zeit vom Beginn der Anzucht bis zum Pflanzdatum.'],
    ] as const;

    for (const [label, explanation] of assertions) {
      const field = screen.getByLabelText(label);
      await user.hover(field);
      expect(await screen.findByRole('tooltip')).toHaveTextContent(explanation);
      await user.unhover(field);
      await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
    }
  });

  it('uses fallback values and direct sowing behavior', () => {
    const onChange = vi.fn();

    const { rerender } = render(
      <TimingSection
        formData={{ cultivation_type: 'pre_cultivation', cultivation_types: ['pre_cultivation'], growth_duration_days: 20, harvest_duration_days: 7, propagation_duration_days: 30 }}
        errors={{}}
        onChange={onChange}
        t={t}
      />
    );

    expect(screen.getByText('form.propagationDurationDaysTooLong')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('form.growthDurationDaysPlaceholder'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/Anzuchtdauer \(Tage\)/), { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith('growth_duration_days', 0);
    expect(screen.queryByPlaceholderText('form.harvestDurationDaysPlaceholder')).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith('propagation_duration_days', undefined);

    rerender(
      <TimingSection
        formData={{ cultivation_type: 'direct_sowing', cultivation_types: ['direct_sowing'] }}
        errors={{ propagation_duration_days: 'Fehler' }}
        onChange={onChange}
        t={t}
      />
    );

    const propagationField = screen.getByLabelText(/Anzuchtdauer \(Tage\)/);
    expect(propagationField).toBeDisabled();
    expect(screen.getByText('Fehler')).toBeInTheDocument();
  });


  it('sets propagation duration to 0 when cultivation type changes to direct sowing', () => {
    const onChange = vi.fn();

    render(
      <TimingSection
        formData={{ cultivation_type: 'pre_cultivation', cultivation_types: ['pre_cultivation'] }}
        errors={{}}
        onChange={onChange}
        t={t}
      />
    );

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Anbauart' }));
    fireEvent.click(screen.getByRole('option', { name: 'Direktsaat' }));

    expect(onChange).toHaveBeenCalledWith('cultivation_types', ['pre_cultivation', 'direct_sowing']);
    expect(onChange).toHaveBeenCalledWith('cultivation_type', 'pre_cultivation');
    expect(onChange).not.toHaveBeenCalledWith('propagation_duration_days', 0);
  });

  describe('variety override highlighting', () => {
    const activeFields = new Set(['growth_duration_days']);
    const getFieldTooltipProps: GetVarietyFieldTooltipProps = (fields, helpText) => {
      const fieldList = Array.isArray(fields) ? fields : [fields];
      const active = fieldList.some((field) => activeFields.has(field));
      const varietyText = active ? 'hierarchy.ownValueFieldTooltip' : 'hierarchy.inheritedFieldTooltip';
      return {
        sx: active ? { backgroundColor: 'rgb(1, 2, 3)' } : undefined,
        tooltipTitle: helpText ? `${helpText} / ${varietyText}` : varietyText,
      };
    };

    it('combines the field help text with the override tooltip and highlights an overridden field', async () => {
      const user = userEvent.setup();
      render(
        <TimingSection
          formData={{ cultivation_type: 'pre_cultivation', cultivation_types: ['pre_cultivation'], growth_duration_days: 30 }}
          errors={{}}
          onChange={vi.fn()}
          t={t}
          getFieldTooltipProps={getFieldTooltipProps}
        />
      );

      const growthField = screen.getByLabelText('Wachstumszeit (Tage)');
      await user.hover(growthField);
      expect(await screen.findByRole('tooltip')).toHaveTextContent(
        'Zeit vom Pflanzdatum bis zum Erntebeginn. / hierarchy.ownValueFieldTooltip',
      );
      expect(growthField.closest('.MuiFormControl-root')).toHaveStyle({ backgroundColor: 'rgb(1, 2, 3)' });
    });

    it('shows the inherited tooltip and no highlight for a field without an own value', async () => {
      const user = userEvent.setup();
      render(
        <TimingSection
          formData={{ cultivation_type: 'pre_cultivation', cultivation_types: ['pre_cultivation'], growth_duration_days: 30, propagation_duration_days: 7 }}
          errors={{}}
          onChange={vi.fn()}
          t={t}
          getFieldTooltipProps={getFieldTooltipProps}
        />
      );

      const propagationField = screen.getByLabelText('Anzuchtdauer (Tage)');
      await user.hover(propagationField);
      expect(await screen.findByRole('tooltip')).toHaveTextContent(
        'Zeit vom Beginn der Anzucht bis zum Pflanzdatum. / hierarchy.inheritedFieldTooltip',
      );
      expect(propagationField.closest('.MuiFormControl-root')).not.toHaveStyle({ backgroundColor: 'rgb(1, 2, 3)' });
    });

    it('keeps the override tooltip on a disabled field (direct sowing propagation)', async () => {
      const user = userEvent.setup();
      const disabledActiveFields = new Set(['propagation_duration_days']);
      const getPropagationTooltipProps: GetVarietyFieldTooltipProps = (fields, helpText) => {
        const fieldList = Array.isArray(fields) ? fields : [fields];
        const active = fieldList.some((field) => disabledActiveFields.has(field));
        return {
          sx: active ? { backgroundColor: 'rgb(9, 9, 9)' } : undefined,
          tooltipTitle: active ? `${helpText} / hierarchy.ownValueFieldTooltip` : helpText,
        };
      };

      render(
        <TimingSection
          formData={{ cultivation_type: 'direct_sowing', cultivation_types: ['direct_sowing'] }}
          errors={{}}
          onChange={vi.fn()}
          t={t}
          getFieldTooltipProps={getPropagationTooltipProps}
        />
      );

      const propagationField = screen.getByLabelText(/Anzuchtdauer \(Tage\)/);
      expect(propagationField).toBeDisabled();
      expect(propagationField.closest('.MuiFormControl-root')).toHaveStyle({ backgroundColor: 'rgb(9, 9, 9)' });

      await user.hover(propagationField);
      expect(await screen.findByRole('tooltip')).toHaveTextContent('hierarchy.ownValueFieldTooltip');
    });
  });
});
