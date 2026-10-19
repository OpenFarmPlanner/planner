import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Bed, Field } from '../api/types';
import { BulkBedCreateDialog } from '../components/hierarchy/BulkBedCreateDialog';

vi.mock('../i18n', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (
      options && 'count' in options ? `${key}:${String(options.count)}` : key
    ),
  }),
}));

const FIELD: Field = { id: 10, name: 'Nordfeld', location: 1, length_m: 20, width_m: 10 };

const renderDialog = (fieldBeds: Bed[] = [], field: Field = FIELD, onCreate = vi.fn().mockResolvedValue(undefined)) => {
  render(
    <BulkBedCreateDialog open field={field} fieldBeds={fieldBeds} onClose={vi.fn()} onCreate={onCreate} />,
  );
  return { dialog: screen.getByRole('dialog'), onCreate };
};

const setValue = (dialog: HTMLElement, name: RegExp | string, value: string): void => {
  fireEvent.change(within(dialog).getByRole('spinbutton', { name }), { target: { value } });
};

const setDecimal = (dialog: HTMLElement, name: RegExp | string, value: string): void => {
  fireEvent.change(within(dialog).getByRole('textbox', { name }), { target: { value } });
};

describe('BulkBedCreateDialog', () => {
  it('starts empty with start 1 when the field has no beds', () => {
    const { dialog } = renderDialog();

    expect(within(dialog).getByRole('textbox', { name: 'dialogs.bulkCreateBeds.prefix' })).toHaveValue('');
    expect(within(dialog).getByRole('spinbutton', { name: 'dialogs.bulkCreateBeds.startNumber' })).toHaveValue(1);
    expect(within(dialog).getByText('dialogs.bulkCreateBeds.previewEmpty')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'dialogs.bulkCreateBeds.submit' })).toBeDisabled();
  });

  it('previews row/bed names, abbreviated beyond 12, and creates them', () => {
    const { dialog, onCreate } = renderDialog();

    fireEvent.click(within(dialog).getByRole('radio', { name: 'dialogs.bulkCreateBeds.namingRowBed' }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'dialogs.bulkCreateBeds.prefix' }), { target: { value: 'E' } });
    setValue(dialog, /dialogs.bulkCreateBeds.rowCount/, '2');
    setValue(dialog, /dialogs.bulkCreateBeds.bedsPerRow/, '8');
    setDecimal(dialog, /dialogs.bulkCreateBeds.length/, '10');
    setDecimal(dialog, /dialogs.bulkCreateBeds.width/, '0,75');

    const items = within(within(dialog).getByRole('list')).getAllByRole('listitem').map((item) => item.textContent);
    expect(items).toEqual(['E 1 1', 'E 1 2', 'E 1 3', 'E 1 4', 'E 1 5', 'E 1 6', '…', 'E 2 6', 'E 2 7', 'E 2 8']);
    expect(within(dialog).getByText('dialogs.bulkCreateBeds.summary:16')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'dialogs.bulkCreateBeds.submitCount:16' }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ field: 10 }));
    expect(onCreate.mock.calls[0][0].beds).toHaveLength(16);
    expect(onCreate.mock.calls[0][0].beds[15]).toEqual({ name: 'E 2 8', length_m: 10, width_m: 0.75 });
  });

  it('suggests a count from the field width and applies it with the field length', () => {
    const { dialog } = renderDialog();
    setDecimal(dialog, /dialogs.bulkCreateBeds.width/, '1,2');

    fireEvent.click(within(dialog).getByRole('button', { name: 'dialogs.bulkCreateBeds.calculatorToggle' }));
    setDecimal(dialog, 'dialogs.bulkCreateBeds.pathWidth', '0,4');
    // floor((10 + 0.4) / (1.2 + 0.4)) = 6
    expect(within(dialog).getByText('dialogs.bulkCreateBeds.suggestion:6')).toBeInTheDocument();
    expect(within(dialog).getByRole('spinbutton', { name: /dialogs.bulkCreateBeds.count/ })).toHaveValue(null);

    fireEvent.click(within(dialog).getByRole('button', { name: 'dialogs.bulkCreateBeds.applyCount' }));

    expect(within(dialog).getByRole('spinbutton', { name: /dialogs.bulkCreateBeds.count/ })).toHaveValue(6);
    expect(within(dialog).getByRole('textbox', { name: /dialogs.bulkCreateBeds.length/ })).toHaveValue('20');
  });

  it('applies the suggestion to "beds per row" in row/bed mode', () => {
    const { dialog } = renderDialog([{ id: 1, name: 'A 1 1', field: 10, length_m: 15, width_m: 1 }]);

    fireEvent.click(within(dialog).getByRole('button', { name: 'dialogs.bulkCreateBeds.calculatorToggle' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'dialogs.bulkCreateBeds.applyCount' }));

    expect(within(dialog).getByRole('spinbutton', { name: /dialogs.bulkCreateBeds.bedsPerRow/ })).toHaveValue(10);
    expect(within(dialog).getByRole('textbox', { name: /dialogs.bulkCreateBeds.length/ })).toHaveValue('15');
  });

  it('hides the calculator for a field without dimensions', () => {
    const { dialog } = renderDialog([], { ...FIELD, length_m: null, width_m: null });

    expect(within(dialog).queryByRole('button', { name: 'dialogs.bulkCreateBeds.calculatorToggle' })).not.toBeInTheDocument();
  });

  it('warns without blocking when the beds exceed the field area', () => {
    const { dialog } = renderDialog([{ id: 1, name: '1', field: 10, length_m: 20, width_m: 9, area_sqm: 180 }]);
    setValue(dialog, /dialogs.bulkCreateBeds.count/, '2');

    expect(within(dialog).getByText('dialogs.bulkCreateBeds.areaWarning')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'dialogs.bulkCreateBeds.submitCount:2' })).toBeEnabled();
  });

  it('blocks names that already exist in the field', () => {
    const { dialog } = renderDialog([{ id: 2, name: 'x', field: 10 }, { id: 1, name: '3', field: 10, length_m: 1, width_m: 1 }]);
    setValue(dialog, /dialogs.bulkCreateBeds.count/, '4');

    expect(within(dialog).getByText('dialogs.bulkCreateBeds.namesTaken:1')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'dialogs.bulkCreateBeds.submitCount:4' })).toBeDisabled();
  });
});
