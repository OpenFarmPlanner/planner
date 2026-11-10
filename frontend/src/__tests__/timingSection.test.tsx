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
  'form.harvestDurationDaysHelp': 'Zeit vom Erntebeginn bis zum Ernteende.',
  'form.fieldInfoAriaLabel': 'Info zu {{field}}',
};

const t = (key: string, options?: Record<string, unknown>) => (translations[key] ?? key)
  .replace('{{field}}', String(options?.field ?? ''));

const PRE_CULTIVATION = { cultivation_type: 'pre_cultivation', cultivation_types: ['pre_cultivation'] } as const;

describe('TimingSection', () => {
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

  it('orders the fields cultivation type, propagation, growth and harvest duration', () => {
    render(<TimingSection formData={{ ...PRE_CULTIVATION }} errors={{}} onChange={vi.fn()} t={t} />);

    const fields = [
      screen.getByRole('combobox', { name: 'Anbauart' }),
      screen.getByLabelText('Anzuchtdauer (Tage)'),
      screen.getByLabelText('Wachstumszeit (Tage)'),
      screen.getByLabelText('Erntezeit (Tage)'),
    ];
    for (let index = 1; index < fields.length; index += 1) {
      expect(fields[index - 1].compareDocumentPosition(fields[index]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('explains each duration through an info button inside the field, not on hovering the field', async () => {
    const user = userEvent.setup();
    render(<TimingSection formData={{ ...PRE_CULTIVATION }} errors={{}} onChange={vi.fn()} t={t} />);

    const assertions = [
      ['Anzuchtdauer (Tage)', 'Zeit vom Beginn der Anzucht bis zum Pflanzdatum.'],
      ['Wachstumszeit (Tage)', 'Zeit vom Pflanzdatum bis zum Erntebeginn.'],
      ['Erntezeit (Tage)', 'Zeit vom Erntebeginn bis zum Ernteende.'],
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
    // The cultivation type has no help text of its own.
    expect(screen.getAllByTestId('field-info-button')).toHaveLength(3);
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
        formData={{ cultivation_type: 'direct_sowing', cultivation_types: ['direct_sowing'] }}
        errors={{}}
        onChange={vi.fn()}
        t={t}
      />,
    );

    expect(screen.getByLabelText('Anzuchtdauer (Tage)')).toBeDisabled();
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

  it('sets propagation duration to 0 when cultivation type changes to direct sowing', () => {
    const onChange = vi.fn();

    render(<TimingSection formData={{ ...PRE_CULTIVATION }} errors={{}} onChange={onChange} t={t} />);

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Anbauart' }));
    fireEvent.click(screen.getByRole('option', { name: 'Direktsaat' }));

    expect(onChange).toHaveBeenCalledWith('cultivation_types', ['pre_cultivation', 'direct_sowing']);
    expect(onChange).toHaveBeenCalledWith('cultivation_type', 'pre_cultivation');
    expect(onChange).not.toHaveBeenCalledWith('propagation_duration_days', 0);
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

  it('shows the library pin of the harvest duration next to its info button', () => {
    render(
      <TimingSection
        formData={{ ...PRE_CULTIVATION, harvest_duration_days: 14 }}
        errors={{}}
        onChange={vi.fn()}
        t={t}
        getFieldPinProps={(field) => (field === 'harvest_duration_days'
          ? { pinned: true, fieldSx: {}, endAdornment: null, button: <button type="button">pin</button> }
          : null)}
      />
    );

    const fieldRoot = screen.getByLabelText('Erntezeit (Tage)').closest('.MuiInputBase-root');
    const infoButton = screen.getByRole('button', { name: 'Info zu Erntezeit (Tage)' });
    const pinButton = screen.getByRole('button', { name: 'pin' });
    expect(fieldRoot).toContainElement(infoButton);
    expect(fieldRoot).toContainElement(pinButton);
    expect(infoButton.compareDocumentPosition(pinButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
