import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { GridRenderEditCellParams } from '@mui/x-data-grid';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DateEditCell } from '../components/data-grid/DateEditCell';
import { EditCellNavigationContext } from '../components/data-grid/EditCellNavigationContext';

const renderDateEditCell = (
  value: Date | string | null = new Date('2026-04-10T00:00:00'),
  editCellNavigation: ComponentProps<typeof EditCellNavigationContext.Provider>['value'] = null,
) => {
  const setEditCellValue = vi.fn().mockResolvedValue(true);
  const onCommitted = vi.fn();

  render(
    <EditCellNavigationContext.Provider value={editCellNavigation}>
      <DateEditCell
        {...({
          id: 1,
          field: 'planting_date',
          value,
          hasFocus: true,
          api: { setEditCellValue },
          onCommitted,
        } as unknown as GridRenderEditCellParams)}
      />
    </EditCellNavigationContext.Provider>,
  );

  return {
    input: screen.getByRole('textbox') as HTMLInputElement,
    setEditCellValue,
    onCommitted,
  };
};

const expectSelection = async (input: HTMLInputElement, start: number, end: number): Promise<void> => {
  await waitFor(() => {
    expect(input.selectionStart).toBe(start);
    expect(input.selectionEnd).toBe(end);
  });
};

describe('DateEditCell', () => {
  it('shows German date text and keeps a calendar button available', async () => {
    const { input } = renderDateEditCell();

    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveDisplayValue('10.04.2026');
    expect(screen.getByRole('button', { name: 'Kalender öffnen' })).toBeInTheDocument();
    await expectSelection(input, 0, 2);
  });

  it('moves the active date segment with left and right arrows', async () => {
    const { input } = renderDateEditCell();
    await expectSelection(input, 0, 2);

    fireEvent.keyDown(input, { key: 'ArrowRight' });
    await expectSelection(input, 3, 5);

    fireEvent.keyDown(input, { key: 'ArrowRight' });
    await expectSelection(input, 6, 10);

    fireEvent.keyDown(input, { key: 'ArrowLeft' });
    await expectSelection(input, 3, 5);
  });

  it.each([
    ['day', 'ArrowUp', 0, 2, '2026-04-11'],
    ['day', 'ArrowDown', 0, 2, '2026-04-09'],
    ['month', 'ArrowUp', 3, 5, '2026-05-10'],
    ['month', 'ArrowDown', 3, 5, '2026-03-10'],
    ['year', 'ArrowUp', 6, 10, '2027-04-10'],
    ['year', 'ArrowDown', 6, 10, '2025-04-10'],
  ])('changes the %s segment with %s', async (_segment, key, start, end, expectedDate) => {
    const { input, setEditCellValue, onCommitted } = renderDateEditCell();
    input.setSelectionRange(start, end);

    fireEvent.keyDown(input, { key });

    await waitFor(() => {
      expect(setEditCellValue).toHaveBeenCalledWith({
        id: 1,
        field: 'planting_date',
        value: new Date(`${expectedDate}T00:00:00`),
      });
    });
    expect(onCommitted).toHaveBeenCalledWith(new Date(`${expectedDate}T00:00:00`));
    await expectSelection(input, start, end);
  });

  it('keeps dates valid when changing months', async () => {
    const { input, setEditCellValue } = renderDateEditCell(new Date('2026-01-31T00:00:00'));
    input.setSelectionRange(3, 5);

    fireEvent.keyDown(input, { key: 'ArrowUp' });

    await waitFor(() => {
      expect(setEditCellValue).toHaveBeenCalledWith({
        id: 1,
        field: 'planting_date',
        value: new Date('2026-02-28T00:00:00'),
      });
    });
  });

  it('keeps direct German date typing working', async () => {
    const { input, setEditCellValue, onCommitted } = renderDateEditCell();

    fireEvent.change(input, { target: { value: '12.05.2026' } });

    expect(input).toHaveDisplayValue('12.05.2026');
    await waitFor(() => {
      expect(setEditCellValue).toHaveBeenCalledWith({
        id: 1,
        field: 'planting_date',
        value: new Date('2026-05-12T00:00:00'),
      });
    });
    expect(onCommitted).toHaveBeenCalledWith(new Date('2026-05-12T00:00:00'));
  });

  it('does not commit invalid directly typed dates', () => {
    const { input, setEditCellValue, onCommitted } = renderDateEditCell();

    fireEvent.change(input, { target: { value: '32.13.2026' } });

    expect(input).toHaveDisplayValue('32.13.2026');
    expect(setEditCellValue).not.toHaveBeenCalled();
    expect(onCommitted).not.toHaveBeenCalled();
  });

  it('delegates Tab navigation to the owning grid', () => {
    const editCellNavigation = vi.fn().mockReturnValue(true);
    const { input, setEditCellValue } = renderDateEditCell(
      new Date('2026-04-10T00:00:00'),
      editCellNavigation,
    );

    fireEvent.keyDown(input, { key: 'Tab' });

    expect(editCellNavigation).toHaveBeenCalledWith(expect.objectContaining({
      id: 1,
      field: 'planting_date',
      event: expect.objectContaining({ key: 'Tab' }),
    }));
    expect(setEditCellValue).not.toHaveBeenCalled();
  });

  it('keeps Ctrl+A inside the date input instead of bubbling to grid shortcuts', () => {
    const documentKeyDown = vi.fn();
    document.addEventListener('keydown', documentKeyDown);
    const { input } = renderDateEditCell();

    try {
      fireEvent.keyDown(input, { key: 'a', ctrlKey: true });

      expect(documentKeyDown).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', documentKeyDown);
    }
  });

  it('opens the native picker from the calendar button', () => {
    const showPicker = vi.fn();
    renderDateEditCell();
    const pickerInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    pickerInput.showPicker = showPicker;

    fireEvent.click(screen.getByRole('button', { name: 'Kalender öffnen' }));

    expect(showPicker).toHaveBeenCalledTimes(1);
  });
});
