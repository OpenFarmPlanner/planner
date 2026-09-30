import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GridApiContext } from '@mui/x-data-grid';
import type { GridRenderEditCellParams } from '@mui/x-data-grid';
import { describe, expect, it, vi } from 'vitest';
import { SearchableSelectEditCell } from '../components/data-grid/SearchableSelectEditCell';
import {
  SelectEditCellContext,
  buildSelectEditCellKey,
} from '../components/data-grid/SelectEditCellContext';
import type { SelectEditCellContextValue } from '../components/data-grid/SelectEditCellContext';

const options = [
  { value: 7, label: 'Reinsaat' },
  { value: 9, label: 'Bingenheimer' },
  { value: 11, label: 'Sativa' },
];

interface RenderOptions {
  value?: number | null;
  hasFocus?: boolean;
  onValueChange?: (next: number | null) => Promise<void> | void;
  selectContext?: SelectEditCellContextValue | null;
  placeholder?: string;
}

const renderCell = ({
  value = 7,
  hasFocus = true,
  onValueChange,
  selectContext = null,
  placeholder,
}: RenderOptions = {}) => {
  const setEditCellValue = vi.fn().mockResolvedValue(true);
  const apiRef = { current: { setEditCellValue } };
  const view = render(
    <GridApiContext.Provider value={apiRef as never}>
      <SelectEditCellContext.Provider value={selectContext}>
        <SearchableSelectEditCell
          {...({
            id: 3,
            field: 'seed_supplier',
            value,
            hasFocus,
          } as unknown as GridRenderEditCellParams)}
          options={options}
          onValueChange={onValueChange}
          placeholder={placeholder}
        />
      </SelectEditCellContext.Provider>
    </GridApiContext.Provider>,
  );
  const rerenderWithValue = (next: number | null) =>
    view.rerender(
      <GridApiContext.Provider value={apiRef as never}>
        <SelectEditCellContext.Provider value={selectContext}>
          <SearchableSelectEditCell
            {...({
              id: 3,
              field: 'seed_supplier',
              value: next,
              hasFocus,
            } as unknown as GridRenderEditCellParams)}
            options={options}
            onValueChange={onValueChange}
            placeholder={placeholder}
          />
        </SelectEditCellContext.Provider>
      </GridApiContext.Provider>,
    );
  return { ...view, setEditCellValue, rerenderWithValue };
};

const input = (): HTMLInputElement => screen.getByRole('combobox') as HTMLInputElement;

const openAndPick = async (
  user: ReturnType<typeof userEvent.setup>,
  label: string,
): Promise<void> => {
  await user.click(input());
  await user.click(await screen.findByRole('option', { name: label }));
};

/**
 * The DataGrid edit cell for a searchable single select. The dropdown itself is
 * `SearchableSelect` and has its own suite, and the open/close coordination
 * between sibling cells lives in `SelectEditCellContext`, also covered
 * separately. What this cell adds, and what is covered here, is the bridge to
 * the grid: which text the input shows while the user is mid-search, when the
 * grid is told about a new value, and when it is deliberately not told.
 *
 * A mutation battery leaves two breaks standing, and neither is reachable:
 *
 * - `if (nextValue !== value)` in `handleChange` cannot be exercised through
 *   the UI. MUI's Autocomplete does not fire `onChange` when the selected
 *   option is clicked again, and the clear button only exists once there is
 *   something to clear, so no interaction produces a pick equal to the current
 *   value. It is defence-in-depth for a programmatic caller.
 * - `setInputValue(newValue?.label ?? '')` in `onChange` has no effect.
 *   MUI closes the list in the same commit and `handleClose` resets the typed
 *   value to null, so the label the user sees always comes from the round-trip
 *   through the grid. Removing the line changes nothing.
 */
describe('SearchableSelectEditCell', () => {
  describe('what the input shows', () => {
    it('starts on the label of the row\'s current value', () => {
      renderCell({ value: 9 });
      expect(input()).toHaveValue('Bingenheimer');
    });

    it('starts empty when the row has no value', () => {
      renderCell({ value: null });
      expect(input()).toHaveValue('');
    });

    it('starts empty when the value is not among the options', () => {
      renderCell({ value: 999 });
      expect(input()).toHaveValue('');
    });

    /**
     * The grid hands the raw cell value through, so the option lookup compares
     * strictly: an id that arrives as text matches nothing and the cell renders
     * empty rather than quietly selecting the numeric option of the same name.
     */
    it('does not match an option by a stringified id', () => {
      renderCell({ value: '9' as unknown as number });
      expect(input()).toHaveValue('');
    });

    it('shows what the user typed instead of the current label', async () => {
      const user = userEvent.setup();
      renderCell({ value: 9 });
      await user.clear(input());
      await user.type(input(), 'Sat');
      expect(input()).toHaveValue('Sat');
    });

    /**
     * An emptied input is a search for everything, not "fall back to the label"
     * -- so the typed value has to win even when it is the empty string, which
     * is exactly what `inputValue ?? selectedOption?.label` gets right and
     * `inputValue || selectedOption?.label` would not.
     */
    it('keeps the input empty after the user clears it', async () => {
      const user = userEvent.setup();
      renderCell({ value: 9 });
      await user.clear(input());
      expect(input()).toHaveValue('');
      expect(await screen.findByRole('option', { name: 'Reinsaat' })).toBeInTheDocument();
    });

    /**
     * `onChange` sets the picked label optimistically, but MUI closes the
     * dropdown in the same commit and `handleClose` resets the typed value to
     * null -- so what the user ends up seeing is the label of whatever the grid
     * now holds, not the optimistic write. Both halves are asserted, because
     * the harness is the only place the two can be told apart: in the grid the
     * `value` prop follows `setEditCellValue` and they agree.
     */
    it('shows the label of the value the grid comes back with', async () => {
      const user = userEvent.setup();
      const { rerenderWithValue } = renderCell({ value: 7 });
      await openAndPick(user, 'Sativa');
      expect(input()).toHaveValue('Reinsaat');
      rerenderWithValue(11);
      expect(input()).toHaveValue('Sativa');
    });

    it('offers the placeholder it was handed', () => {
      renderCell({ value: null, placeholder: 'Lieferant wählen' });
      expect(input()).toHaveAttribute('placeholder', 'Lieferant wählen');
    });
  });

  describe('telling the grid', () => {
    it('writes the picked option to the cell', async () => {
      const user = userEvent.setup();
      const { setEditCellValue } = renderCell({ value: 7 });
      await openAndPick(user, 'Bingenheimer');
      await waitFor(() =>
        expect(setEditCellValue).toHaveBeenCalledWith({
          id: 3,
          field: 'seed_supplier',
          value: 9,
        }),
      );
    });

    /**
     * The write is held open for the whole assertion: the caller's callback
     * usually persists the row, so it must not run until the grid has actually
     * taken the value. A resolved mock would let a reordered implementation
     * look identical.
     */
    it('waits for the cell write before notifying the caller', async () => {
      const user = userEvent.setup();
      let finishWrite = (): void => {};
      const onValueChange = vi.fn();
      const { setEditCellValue } = renderCell({ value: 7, onValueChange });
      setEditCellValue.mockImplementation(
        () => new Promise((resolve) => { finishWrite = () => resolve(true); }),
      );

      await openAndPick(user, 'Bingenheimer');

      await waitFor(() => expect(setEditCellValue).toHaveBeenCalledTimes(1));
      expect(onValueChange).not.toHaveBeenCalled();

      finishWrite();
      await waitFor(() => expect(onValueChange).toHaveBeenCalledWith(9));
    });

    it('works without a caller-supplied callback', async () => {
      const user = userEvent.setup();
      const { setEditCellValue } = renderCell({ value: 7 });
      await openAndPick(user, 'Sativa');
      await waitFor(() => expect(setEditCellValue).toHaveBeenCalledTimes(1));
    });

    /**
     * Re-picking what is already selected must not write, because the caller's
     * `onValueChange` usually saves and an idempotent pick would cost a
     * request. MUI is what achieves this -- its Autocomplete does not fire
     * `onChange` when the selected option is clicked again -- so this asserts
     * the outcome rather than the `nextValue !== value` guard, which nothing
     * reachable through the dropdown can exercise.
     */
    it('stays quiet when the picked option is the one already set', async () => {
      const user = userEvent.setup();
      const onValueChange = vi.fn();
      const { setEditCellValue } = renderCell({ value: 7, onValueChange });
      await openAndPick(user, 'Reinsaat');
      expect(setEditCellValue).not.toHaveBeenCalled();
      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('writes null when the selection is cleared', async () => {
      const user = userEvent.setup();
      const onValueChange = vi.fn();
      const { setEditCellValue } = renderCell({ value: 7, onValueChange });
      await user.click(screen.getByRole('button', { name: /leeren|clear/i }));
      await waitFor(() =>
        expect(setEditCellValue).toHaveBeenCalledWith({
          id: 3,
          field: 'seed_supplier',
          value: null,
        }),
      );
      expect(onValueChange).toHaveBeenCalledWith(null);
    });

    /**
     * No click to open: `hasFocus` already opened the list, and clicking the
     * input from there would toggle it shut again.
     */
    it('does not write just from opening and closing the list', async () => {
      const user = userEvent.setup();
      const { setEditCellValue } = renderCell({ value: null });
      await screen.findByRole('option', { name: 'Reinsaat' });
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('option')).not.toBeInTheDocument());
      expect(setEditCellValue).not.toHaveBeenCalled();
    });
  });

  describe('focus', () => {
    /**
     * `SearchableSelect` sets `openOnFocus`, and this cell's `onOpen` drives the
     * controlled `open`, so a cell the grid has put into edit mode shows its
     * list without a second click. It also means the two context tests below
     * have to render unfocused, or they would pass on this alone.
     */
    it('opens its list as soon as the grid focuses the cell', async () => {
      renderCell({ hasFocus: true });
      expect(await screen.findByRole('option', { name: 'Reinsaat' })).toBeInTheDocument();
    });

    it('stays closed while the grid has not focused the cell', async () => {
      renderCell({ hasFocus: false });
      await waitFor(() => expect(screen.queryByRole('option')).not.toBeInTheDocument());
    });

    it('takes focus and joins the tab order while the grid says it is focused', () => {
      renderCell({ hasFocus: true });
      expect(input()).toHaveFocus();
      expect(input()).toHaveAttribute('tabindex', '0');
    });

    it('stays out of the tab order and unfocused otherwise', () => {
      renderCell({ hasFocus: false });
      expect(input()).not.toHaveFocus();
      expect(input()).toHaveAttribute('tabindex', '-1');
    });
  });

  describe('coordinating with the grid', () => {
    it('opens when the grid asks this cell to open', async () => {
      const consumeRequest = vi.fn();
      renderCell({
        hasFocus: false,
        selectContext: {
          request: { cellKey: buildSelectEditCellKey(3, 'seed_supplier'), token: 1 },
          consumeRequest,
        },
      });
      expect(await screen.findByRole('option', { name: 'Reinsaat' })).toBeInTheDocument();
      expect(consumeRequest).toHaveBeenCalledWith(1);
    });

    it('ignores a request for another field of the same row', async () => {
      const consumeRequest = vi.fn();
      renderCell({
        hasFocus: false,
        selectContext: {
          request: { cellKey: buildSelectEditCellKey(3, 'crop'), token: 1 },
          consumeRequest,
        },
      });
      await waitFor(() => expect(consumeRequest).not.toHaveBeenCalled());
      expect(screen.queryByRole('option')).not.toBeInTheDocument();
    });

    it('ignores a request meant for another row', async () => {
      const consumeRequest = vi.fn();
      renderCell({
        hasFocus: false,
        selectContext: {
          request: { cellKey: buildSelectEditCellKey(4, 'seed_supplier'), token: 1 },
          consumeRequest,
        },
      });
      await waitFor(() => expect(consumeRequest).not.toHaveBeenCalled());
      expect(screen.queryByRole('option')).not.toBeInTheDocument();
    });

    it('reports its own close so the grid can move focus on', async () => {
      const user = userEvent.setup();
      const onMenuClose = vi.fn();
      renderCell({
        selectContext: { request: null, consumeRequest: vi.fn(), onMenuClose },
      });
      await user.click(input());
      await screen.findByRole('option', { name: 'Reinsaat' });
      await user.keyboard('{Escape}');
      await waitFor(() => expect(onMenuClose).toHaveBeenCalled());
      expect(onMenuClose).toHaveBeenCalledWith(3, 'seed_supplier', expect.anything());
    });

    /**
     * Closing throws away the search text rather than leaving it in the cell,
     * so the input falls back to the label of whatever is actually selected --
     * and the list has to actually close, since `open` is controlled here and
     * MUI cannot close it on its own.
     */
    it('closes and drops an abandoned search', async () => {
      const user = userEvent.setup();
      renderCell({ value: 9 });
      await user.clear(input());
      await user.type(input(), 'Sat');
      expect(input()).toHaveValue('Sat');

      await user.keyboard('{Escape}');

      await waitFor(() => expect(input()).toHaveValue('Bingenheimer'));
      expect(screen.queryByRole('option')).not.toBeInTheDocument();
    });

    it('works with no grid coordination context at all', async () => {
      const user = userEvent.setup();
      const { setEditCellValue } = renderCell({ value: 7, selectContext: null });
      await openAndPick(user, 'Sativa');
      await waitFor(() => expect(setEditCellValue).toHaveBeenCalledTimes(1));
    });
  });
});
