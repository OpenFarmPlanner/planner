import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Bed, Field } from '../api/types';
import { BulkBedCreateDialog } from '../components/hierarchy/BulkBedCreateDialog';

vi.mock('../i18n', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'dialogs.bulkCreateBeds.defaultFirstName') return 'Beet 1';
      return options && 'count' in options ? `${key}:${String(options.count)}` : key;
    },
  }),
}));

const FIELD: Field = { id: 10, name: 'Nordfeld', location: 1, length_m: 20, width_m: 10 };

const renderDialog = (fieldBeds: Bed[] = [], field: Field = FIELD, onCreate = vi.fn().mockResolvedValue(undefined)) => {
  render(
    <BulkBedCreateDialog open field={field} fieldBeds={fieldBeds} onClose={vi.fn()} onCreate={onCreate} />,
  );
  return { dialog: screen.getByRole('dialog'), onCreate };
};

const countField = (dialog: HTMLElement): HTMLElement => (
  within(dialog).getByRole('spinbutton', { name: /dialogs.bulkCreateBeds.count/ })
);

const setDecimal = (dialog: HTMLElement, name: RegExp | string, value: string): void => {
  fireEvent.change(within(dialog).getByRole('textbox', { name }), { target: { value } });
};

describe('BulkBedCreateDialog', () => {
  it('starts with "Beet 1", the field length and no count for an empty field', () => {
    const { dialog } = renderDialog();

    expect(within(dialog).getByRole('textbox', { name: /dialogs.bulkCreateBeds.firstName/ })).toHaveValue('Beet 1');
    expect(within(dialog).getByRole('textbox', { name: /dialogs.bulkCreateBeds.length/ })).toHaveValue('20');
    expect(countField(dialog)).toHaveValue(null);
    expect(within(dialog).queryByText(/dialogs.bulkCreateBeds.suggestion/)).not.toBeInTheDocument();
    expect(within(dialog).getByText('dialogs.bulkCreateBeds.previewEmpty')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'dialogs.bulkCreateBeds.submit' })).toBeDisabled();
  });

  it('shows the live suggestion and applies it only through the link', () => {
    const { dialog } = renderDialog();
    setDecimal(dialog, /dialogs.bulkCreateBeds.width/, '1,2');
    setDecimal(dialog, /dialogs.bulkCreateBeds.pathWidth/, '0,4');

    // floor((10 + 0.4) / (1.2 + 0.4)) = 6
    expect(within(dialog).getByText('dialogs.bulkCreateBeds.suggestion:6')).toBeInTheDocument();
    expect(countField(dialog)).toHaveValue(null);

    fireEvent.click(within(dialog).getByRole('button', { name: 'dialogs.bulkCreateBeds.applySuggestion:6' }));

    expect(countField(dialog)).toHaveValue(6);
    expect(within(dialog).queryByRole('button', { name: /applySuggestion/ })).not.toBeInTheDocument();
  });

  it('prefills the count, continues the names and counts in existing beds', () => {
    const { dialog, onCreate } = renderDialog([
      { id: 1, name: 'E 2 1', field: 10, length_m: 20, width_m: 1 },
      { id: 2, name: 'E 2 2', field: 10, length_m: 20, width_m: 1 },
    ]);

    // free = 10 - 2 = 8 → 8 beds of 1 m
    expect(countField(dialog)).toHaveValue(8);
    expect(within(dialog).getByText('dialogs.bulkCreateBeds.suggestionRemaining:8')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /applySuggestion/ })).not.toBeInTheDocument();

    fireEvent.change(countField(dialog), { target: { value: '16' } });
    const items = within(within(dialog).getByRole('list')).getAllByRole('listitem').map((item) => item.textContent);
    expect(items).toEqual(['E 2 3', 'E 2 4', 'E 2 5', 'E 2 6', 'E 2 7', 'E 2 8', '…', 'E 2 16', 'E 2 17', 'E 2 18']);
    // The suggestion never overwrites the typed value; the link offers it again.
    expect(within(dialog).getByRole('button', { name: 'dialogs.bulkCreateBeds.applySuggestion:8' })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'dialogs.bulkCreateBeds.submitCount:16' }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ field: 10 }));
    expect(onCreate.mock.calls[0][0].beds).toHaveLength(16);
    expect(onCreate.mock.calls[0][0].beds[15]).toEqual({ name: 'E 2 18', length_m: 20, width_m: 1 });
  });

  it('switches the length with the orientation until the user edits it', () => {
    const { dialog } = renderDialog();
    const length = within(dialog).getByRole('textbox', { name: /dialogs.bulkCreateBeds.length/ });

    fireEvent.click(within(dialog).getByRole('radio', { name: 'dialogs.bulkCreateBeds.orientationWidth' }));
    expect(length).toHaveValue('10');

    setDecimal(dialog, /dialogs.bulkCreateBeds.length/, '7');
    fireEvent.click(within(dialog).getByRole('radio', { name: 'dialogs.bulkCreateBeds.orientationLength' }));
    expect(length).toHaveValue('7');
  });

  it('says when no room is left', () => {
    const { dialog } = renderDialog([{ id: 1, name: 'A', field: 10, length_m: 20, width_m: 10 }]);

    expect(within(dialog).getByText('dialogs.bulkCreateBeds.noSpaceLeft')).toBeInTheDocument();
    expect(countField(dialog)).toHaveValue(null);
  });

  it('hides the orientation and the hint for a field without dimensions', () => {
    const { dialog } = renderDialog([], { ...FIELD, length_m: null, width_m: null });
    setDecimal(dialog, /dialogs.bulkCreateBeds.width/, '1');

    expect(within(dialog).queryByRole('radio')).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/dialogs.bulkCreateBeds.suggestion/)).not.toBeInTheDocument();
  });

  it('warns without blocking when the beds exceed the field area', () => {
    const { dialog } = renderDialog([{ id: 1, name: '1', field: 10, length_m: 20, width_m: 9, area_sqm: 180 }]);
    fireEvent.change(countField(dialog), { target: { value: '2' } });

    expect(within(dialog).getByText('dialogs.bulkCreateBeds.areaWarning')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'dialogs.bulkCreateBeds.submitCount:2' })).toBeEnabled();
  });

  it('blocks names that already exist in the field', () => {
    const { dialog } = renderDialog([{ id: 2, name: '5', field: 10 }, { id: 1, name: '3', field: 10, length_m: 1, width_m: 1 }]);
    fireEvent.change(countField(dialog), { target: { value: '4' } });

    expect(within(dialog).getByText('dialogs.bulkCreateBeds.namesTaken:1')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'dialogs.bulkCreateBeds.submitCount:4' })).toBeDisabled();
  });
});
