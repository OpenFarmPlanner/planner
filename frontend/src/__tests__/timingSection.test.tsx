import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TimingSection } from '../crops/sections/TimingSection';
import type { GetVarietyFieldHighlightSx } from '../crops/varietyValueAccent';

const translations: Record<string, string> = {
  'form.cultivationType': 'Anbauart',
  'form.cultivationTypeDirectSowing': 'Direktsaat',
  'form.cultivationTypePreCultivation': 'Pflanzung',
  'form.growthDurationDays': 'Wachstumszeit (Tage)',
  'form.growthDurationDaysHelp': 'Zeit vom Pflanzdatum bis zum Erntebeginn.',
  'form.propagationDurationDays': 'Anzuchtdauer (Tage)',
  'form.propagationDurationDaysHelp': 'Zeit vom Beginn der Anzucht bis zum Pflanzdatum.',
  'form.directSowingPropagationDisabledHelp': 'Bei Direktsaat ist keine Anzuchtdauer erforderlich.',
  'form.harvestDurationDays': 'Erntezeit (Tage)',
  'form.fieldInfoAriaLabel': 'Info zu {{field}}',
};

const t = (key: string, options?: Record<string, unknown>) => (translations[key] ?? key)
  .replace('{{field}}', String(options?.field ?? ''));

const PRE_CULTIVATION = { cultivation_type: 'pre_cultivation', cultivation_types: ['pre_cultivation'] } as const;

describe('timing section', () => {
  it('parses growth, propagation and harvest duration inputs', () => {
    const onChange = vi.fn();

    render(<TimingSection formData={{ ...PRE_CULTIVATION, harvest_duration_days: 7 }} errors={{}} onChange={onChange} t={t} />);

    const growthInput = screen.getByLabelText('Wachstumszeit (Tage)');
    const propagationInput = screen.getByLabelText('Anzuchtdauer (Tage)');
    const harvestInput = screen.getByLabelText('Erntezeit (Tage)');

    for (const input of [growthInput, propagationInput, harvestInput]) {
      expect(input).toHaveAttribute('inputmode', 'numeric');
    }

    fireEvent.change(growthInput, { target: { value: '30' } });
    fireEvent.change(propagationInput, { target: { value: '8' } });
    fireEvent.change(harvestInput, { target: { value: '12' } });
    fireEvent.change(harvestInput, { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith('growth_duration_days', 30);
    expect(onChange).toHaveBeenCalledWith('propagation_duration_days', 8);
    expect(onChange).toHaveBeenCalledWith('harvest_duration_days', 12);
    expect(onChange).toHaveBeenCalledWith('harvest_duration_days', 0);
  });

  it('keeps the help for growth and propagation anchors available inside their fields', async () => {
    const user = userEvent.setup();
    render(<TimingSection formData={{ ...PRE_CULTIVATION }} errors={{}} onChange={vi.fn()} t={t} />);

    const assertions = [
      ['Anzuchtdauer (Tage)', 'Zeit vom Beginn der Anzucht bis zum Pflanzdatum.'],
      ['Wachstumszeit (Tage)', 'Zeit vom Pflanzdatum bis zum Erntebeginn.'],
    ] as const;

    for (const [label, explanation] of assertions) {
      const field = screen.getByLabelText(label);
      await user.hover(field);
      await user.click(field);
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

      const infoButton = screen.getByRole('button', { name: `Info zu ${label}` });
      // The button sits inside the field's outline, as its end adornment.
      expect(field.closest('.MuiInputBase-root')).toContainElement(infoButton);
      await user.click(infoButton);
      expect(await screen.findByRole('tooltip')).toHaveTextContent(explanation);
      expect(infoButton).toHaveAttribute('aria-expanded', 'true');
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
    }
    expect(screen.queryByRole('button', { name: 'Info zu Erntezeit (Tage)' })).not.toBeInTheDocument();
    expect(screen.getAllByTestId('field-info-button')).toHaveLength(2);
  });

  it('opens the info tooltip from the keyboard', async () => {
    const user = userEvent.setup();
    render(<TimingSection formData={{ ...PRE_CULTIVATION }} errors={{}} onChange={vi.fn()} t={t} />);

    const infoButton = screen.getByRole('button', { name: 'Info zu Wachstumszeit (Tage)' });
    infoButton.focus();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Zeit vom Pflanzdatum bis zum Erntebeginn.');
    await user.tab();
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
  });

  it('keeps the info button active on the disabled propagation field and explains direct sowing', async () => {
    const user = userEvent.setup();
    render(
      <TimingSection
        formData={{ cultivation_type: 'direct_sowing', cultivation_types: ['direct_sowing'], propagation_duration_days: 28 }}
        errors={{}}
        onChange={vi.fn()}
        t={t}
      />,
    );

    const propagation = screen.getByLabelText('Anzuchtdauer (Tage)');
    expect(propagation).toBeDisabled();
    expect(propagation).toHaveValue(28);
    expect(screen.queryByText('form.propagationDurationDaysTooLong')).not.toBeInTheDocument();
    const infoButton = screen.getByRole('button', { name: 'Info zu Anzuchtdauer (Tage)' });
    expect(infoButton).toBeEnabled();
    await user.click(infoButton);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Bei Direktsaat ist keine Anzuchtdauer erforderlich.');
  });

  it('uses fallback values and direct sowing behavior', () => {
    const onChange = vi.fn();

    const { rerender } = render(
      <TimingSection
        formData={{ ...PRE_CULTIVATION, growth_duration_days: 20, harvest_duration_days: 7, propagation_duration_days: 30 }}
        errors={{}}
        onChange={onChange}
        t={t}
      />
    );

    expect(screen.getByText('form.propagationDurationDaysTooLong')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('form.growthDurationDaysPlaceholder'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Anzuchtdauer (Tage)'), { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith('growth_duration_days', 0);
    expect(onChange).toHaveBeenCalledWith('propagation_duration_days', undefined);

    rerender(
      <TimingSection
        formData={{ cultivation_type: 'direct_sowing', cultivation_types: ['direct_sowing'] }}
        errors={{ propagation_duration_days: 'Fehler', harvest_duration_days: 'Erntefehler' }}
        onChange={onChange}
        t={t}
      />
    );

    const propagationField = screen.getByLabelText('Anzuchtdauer (Tage)');
    expect(propagationField).toBeDisabled();
    expect(screen.getByText('Fehler')).toBeInTheDocument();
    // The harvest duration keeps its validation in the timing section.
    expect(screen.getByLabelText('Erntezeit (Tage)')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Erntefehler')).toBeInTheDocument();
  });

  it('keeps propagation editable for crops supporting both cultivation types', () => {
    const onChange = vi.fn();

    render(<TimingSection formData={{
      cultivation_type: 'direct_sowing',
      cultivation_types: ['direct_sowing', 'pre_cultivation'],
      propagation_duration_days: 28,
    }} errors={{}} onChange={onChange} t={t} />);

    const propagation = screen.getByLabelText('Anzuchtdauer (Tage)');
    expect(propagation).toBeEnabled();
    expect(propagation).toHaveValue(28);
  });

  describe('variety override highlighting', () => {
    const highlightFor = (activeFields: Set<string>, color: string): GetVarietyFieldHighlightSx => (fields) => {
      const fieldList = Array.isArray(fields) ? fields : [fields];
      return fieldList.some((field) => activeFields.has(field)) ? { backgroundColor: color } : undefined;
    };

    it('highlights only overridden fields, the moved harvest duration included', () => {
      render(
        <TimingSection
          formData={{ ...PRE_CULTIVATION, growth_duration_days: 30, harvest_duration_days: 14, propagation_duration_days: 7 }}
          errors={{}}
          onChange={vi.fn()}
          t={t}
          getFieldHighlightSx={highlightFor(new Set(['growth_duration_days', 'harvest_duration_days']), 'rgb(1, 2, 3)')}
        />
      );

      const formControl = (label: string) => screen.getByLabelText(label).closest('.MuiFormControl-root');
      expect(formControl('Wachstumszeit (Tage)')).toHaveStyle({ backgroundColor: 'rgb(1, 2, 3)' });
      expect(formControl('Erntezeit (Tage)')).toHaveStyle({ backgroundColor: 'rgb(1, 2, 3)' });
      expect(formControl('Anzuchtdauer (Tage)')).not.toHaveStyle({ backgroundColor: 'rgb(1, 2, 3)' });
    });

    it('keeps the highlight on a disabled field (direct sowing propagation)', () => {
      render(
        <TimingSection
          formData={{ cultivation_type: 'direct_sowing', cultivation_types: ['direct_sowing'] }}
          errors={{}}
          onChange={vi.fn()}
          t={t}
          getFieldHighlightSx={highlightFor(new Set(['propagation_duration_days']), 'rgb(9, 9, 9)')}
        />
      );

      const propagationField = screen.getByLabelText('Anzuchtdauer (Tage)');
      expect(propagationField).toBeDisabled();
      expect(propagationField.closest('.MuiFormControl-root')).toHaveStyle({ backgroundColor: 'rgb(9, 9, 9)' });
    });
  });

  it('keeps the library pin on harvest duration without the explanatory button', () => {
    render(
      <TimingSection
        formData={{ ...PRE_CULTIVATION, harvest_duration_days: 14 }}
        errors={{}}
        onChange={vi.fn()}
        t={t}
        getFieldPinProps={(field) => (field === 'harvest_duration_days'
          ? { pinned: true, fieldSx: {}, endAdornment: <button type="button">pin</button>, button: null }
          : null)}
      />
    );

    const fieldRoot = screen.getByLabelText('Erntezeit (Tage)').closest('.MuiInputBase-root');
    const pinButton = screen.getByRole('button', { name: 'pin' });
    expect(fieldRoot).toContainElement(pinButton);
    expect(screen.queryByRole('button', { name: 'Info zu Erntezeit (Tage)' })).not.toBeInTheDocument();
  });

  it('keeps pins on the annual window and first-harvest delay without info icons', () => {
    const windowPin = <button type="button">Window pin</button>;
    const delayPin = <button type="button">Delay pin</button>;
    render(<TimingSection formData={{ annual_harvest_window: '11-15/02-29', first_harvest_delay_years: 0 }}
      errors={{}} onChange={vi.fn()} t={t} isPerennial
      getFieldPinProps={(field) => {
        const button = field === 'annual_harvest_window' ? windowPin
          : field === 'first_harvest_delay_years' ? delayPin : null;
        return button ? { pinned: true, fieldSx: {}, endAdornment: button, button } : null;
      }} />);

    const start = screen.getByRole('textbox', { name: 'annualHarvest.start' });
    const delay = screen.getByRole('spinbutton', { name: 'annualHarvest.delay' });
    expect(start.closest('.MuiInputBase-root')).toContainElement(screen.getByRole('button', { name: 'Window pin' }));
    expect(delay.closest('.MuiInputBase-root')).toContainElement(screen.getByRole('button', { name: 'Delay pin' }));
    expect(screen.queryAllByTestId('field-info-button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Info zu Anzuchtdauer (Tage)' })).toBeEnabled();
  });
});
