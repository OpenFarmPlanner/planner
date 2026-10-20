import { fireEvent, render, screen, within } from '@testing-library/react';
import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it, vi } from 'vitest';
import type { Bed, Field } from '../api/types';
import { DuplicateFieldDialog } from '../components/hierarchy/DuplicateFieldDialog';

vi.mock('../i18n', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (!options) return key;
      if ('count' in options) return `${key}:${String(options.count)}`;
      if ('total' in options) return `${key}:${String(options.total)}`;
      if ('name' in options) return `${key}:${String(options.name)}`;
      return key;
    },
  }),
}));

const SOURCE: Field = { id: 1, name: 'Nord 1', location: 1, length_m: 20, width_m: 10 };
const FIELDS: Field[] = [SOURCE, { id: 2, name: 'Nord 2', location: 1 }];
const BEDS: Bed[] = [
  { id: 1, name: 'N 1', field: 1 },
  { id: 2, name: 'N 2', field: 1 },
  { id: 3, name: 'N 3', field: 1 },
  { id: 4, name: 'N 4', field: 1 },
];

const renderDialog = (beds: Bed[] = BEDS, onDuplicate = vi.fn().mockResolvedValue(undefined)) => {
  render(
    <DuplicateFieldDialog open source={SOURCE} sourceBeds={beds} fields={FIELDS} onClose={vi.fn()} onDuplicate={onDuplicate} />,
  );
  return { dialog: screen.getByRole('dialog'), onDuplicate };
};

const nameField = (dialog: HTMLElement): HTMLElement => (
  within(dialog).getByRole('textbox', { name: /dialogs.duplicateField.name/ })
);

describe('DuplicateFieldDialog', () => {
  it('suggests the next free name, copies beds by default and previews the result', () => {
    const { dialog } = renderDialog();

    expect(nameField(dialog)).toHaveValue('Nord 3');
    expect(within(dialog).getByRole('checkbox', { name: 'dialogs.duplicateField.copyBeds:4' })).toBeChecked();
    expect(within(dialog).getByText(/dialogs.duplicateField.previewField:Nord 3/)).toHaveTextContent(
      'dialogs.duplicateField.previewField:Nord 3, dialogs.duplicateField.previewDimensions, dialogs.duplicateField.previewBeds:4',
    );
  });

  it('sends the replacement and hints when the search text is not found', () => {
    const { dialog, onDuplicate } = renderDialog();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'dialogs.duplicateField.replaceSearch' }), { target: { value: 'X' } });
    expect(within(dialog).getByText('dialogs.duplicateField.searchNotFound')).toBeInTheDocument();

    fireEvent.change(within(dialog).getByRole('textbox', { name: 'dialogs.duplicateField.replaceSearch' }), { target: { value: 'N' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'dialogs.duplicateField.replaceWith' }), { target: { value: 'S' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'dialogs.duplicateField.submit' }));

    expect(onDuplicate).toHaveBeenCalledWith({ name: 'Nord 3', copy_beds: true, replace_search: 'N', replace_with: 'S' });
  });

  it('hides the bed options for a field without beds', () => {
    const { dialog, onDuplicate } = renderDialog([]);

    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'dialogs.duplicateField.submit' }));
    expect(onDuplicate).toHaveBeenCalledWith({ name: 'Nord 3', copy_beds: false, replace_search: '', replace_with: '' });
  });

  it('blocks an empty or taken name', () => {
    const { dialog } = renderDialog();

    fireEvent.change(nameField(dialog), { target: { value: 'Nord 2' } });
    expect(within(dialog).getByText('dialogs.duplicateField.nameTaken')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'dialogs.duplicateField.submit' })).toBeDisabled();

    fireEvent.change(nameField(dialog), { target: { value: ' ' } });
    expect(within(dialog).getByRole('button', { name: 'dialogs.duplicateField.submit' })).toBeDisabled();
  });

  it('shows a server name conflict', async () => {
    const response = { status: 409, data: { code: 'field_name_taken' }, statusText: '', headers: {}, config: { headers: new AxiosHeaders() } };
    const onDuplicate = vi.fn().mockRejectedValue(new AxiosError('conflict', '409', undefined, undefined, response));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { dialog } = renderDialog(BEDS, onDuplicate);

    fireEvent.click(within(dialog).getByRole('button', { name: 'dialogs.duplicateField.submit' }));

    expect(await within(dialog).findByText('dialogs.duplicateField.nameTaken')).toBeInTheDocument();
  });
});
