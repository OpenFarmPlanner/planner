import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';

import i18n from '../i18n/config';
import type { CropTimingWindow } from '../api/types';
import { TimingWindowsSection } from '../crops/sections/TimingWindowsSection';
import { validateCrop } from '../crops/validation';
import { emptyTimingWindow } from '../crops/timingWindows';

const t = i18n.getFixedT('de', 'crops') as unknown as TFunction;

const decade = (kind: CropTimingWindow['kind'], fields: Partial<CropTimingWindow>): CropTimingWindow => ({
  ...emptyTimingWindow(kind, 'decade'),
  ...fields,
});

function Harness({ initial, errors = {} }: { initial: CropTimingWindow[]; errors?: Record<string, string> }) {
  const [windows, setWindows] = useState(initial);
  return (
    <>
      <TimingWindowsSection windows={windows} errors={errors} onChange={setWindows} t={t} />
      <output data-testid="windows">{JSON.stringify(windows)}</output>
    </>
  );
}

const currentWindows = (): CropTimingWindow[] => JSON.parse(screen.getByTestId('windows').textContent ?? '[]');
const group = (name: string): HTMLElement => screen.getByRole('group', { name });

describe('TimingWindowsSection', () => {
  it('shows the four kinds in order, each with an add button', () => {
    render(<Harness initial={[]} />);
    expect(screen.getAllByRole('group').filter((element) => element.getAttribute('aria-labelledby'))
      .map((element) => element.textContent?.split('Zeitraum hinzufügen')[0]))
      .toEqual(['Anzucht', 'Direktsaat', 'Pflanzung', 'Ernte']);
    expect(screen.getAllByRole('button', { name: 'Zeitraum hinzufügen' })).toHaveLength(4);
  });

  it('adds a month row and fills it with native selects', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[]} />);
    await user.click(within(group('Direktsaat')).getByRole('button', { name: 'Zeitraum hinzufügen' }));

    const row = within(group('Direktsaat'));
    await user.selectOptions(row.getByLabelText('Von: Monatsdrittel'), 'Anfang');
    await user.selectOptions(row.getByLabelText('Von: Monat'), 'März');
    await user.selectOptions(row.getByLabelText('Bis: Monatsdrittel'), 'Mitte');
    await user.selectOptions(row.getByLabelText('Bis: Monat'), 'Mai');

    expect(currentWindows()).toEqual([decade('direct_sowing', {
      start_month: 3, start_decade: 'early', end_month: 5, end_decade: 'mid',
    })]);
  });

  it('clears the values when the unit of a row is switched', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[decade('harvest', { start_month: 7, start_decade: 'early', end_month: 9, end_decade: 'late' })]} />);
    await user.click(within(group('Ernte')).getByRole('button', { name: 'KW' }));

    expect(currentWindows()).toEqual([emptyTimingWindow('harvest', 'iso_week')]);
    const weekSelect = within(group('Ernte')).getByLabelText('Von: Kalenderwoche');
    expect(within(weekSelect).getAllByRole('option')).toHaveLength(53);
    expect(within(weekSelect).getByRole('option', { name: 'KW 52' })).toBeInTheDocument();
    expect(within(weekSelect).queryByRole('option', { name: 'KW 53' })).toBeNull();
  });

  it('starts a new row in the unit of the row added last', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[]} />);
    await user.click(within(group('Anzucht')).getByRole('button', { name: 'Zeitraum hinzufügen' }));
    await user.click(within(group('Anzucht')).getByRole('button', { name: 'KW' }));
    await user.click(within(group('Ernte')).getByRole('button', { name: 'Zeitraum hinzufügen' }));

    expect(currentWindows().map((window) => [window.kind, window.unit])).toEqual([
      ['pre_cultivation', 'iso_week'],
      ['harvest', 'iso_week'],
    ]);
  });

  it('notes a window across the turn of the year', () => {
    render(<Harness initial={[decade('direct_sowing', { start_month: 11, start_decade: 'early', end_month: 2, end_decade: 'late' })]} />);
    expect(screen.getByText('Über den Jahreswechsel')).toBeInTheDocument();
  });

  it('does not note an ordinary or incomplete window', () => {
    render(<Harness initial={[
      decade('direct_sowing', { start_month: 3, start_decade: 'early', end_month: 5, end_decade: 'late' }),
      decade('harvest', { start_month: 11, start_decade: 'early' }),
    ]} />);
    expect(screen.queryByText('Über den Jahreswechsel')).toBeNull();
  });

  it('removes a row', () => {
    render(<Harness initial={[decade('planting', { start_month: 5, start_decade: 'mid', end_month: 6, end_decade: 'early' })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Zeitraum entfernen' }));
    expect(currentWindows()).toEqual([]);
  });

  it('shows the field message of an incomplete row', () => {
    render(<Harness
      initial={[decade('planting', { start_month: 5, start_decade: 'mid' })]}
      errors={{ 'timing_windows.0': 'Bitte Anfang und Ende angeben.' }}
    />);
    expect(within(group('Pflanzung')).getByText('Bitte Anfang und Ende angeben.')).toBeInTheDocument();
  });
});

describe('validateCrop with timing windows', () => {
  const tValidation = i18n.getFixedT('de', 'crops') as unknown as TFunction;

  it('refuses to save an incomplete row and names it', () => {
    const result = validateCrop({
      name: 'Möhre',
      timing_windows: [
        decade('direct_sowing', { start_month: 3, start_decade: 'early', end_month: 5, end_decade: 'late' }),
        { ...emptyTimingWindow('harvest', 'iso_week'), start_week: 30 },
      ],
    }, tValidation, 'submit', false);
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual({ 'timing_windows.1': 'Bitte Anfang und Ende angeben.' });
  });

  it('accepts complete rows', () => {
    const result = validateCrop({
      name: 'Möhre',
      timing_windows: [{ ...emptyTimingWindow('harvest', 'iso_week'), start_week: 30, end_week: 30 }],
    }, tValidation, 'submit', false);
    expect(result.errors).toEqual({});
  });
});
