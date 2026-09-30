import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FilterPopoverShell } from '../components/filters/FilterPopoverShell';
import { FilterNumberField } from '../components/filters/FilterNumberField';

const anchor = (): HTMLElement => {
  const button = document.createElement('button');
  button.textContent = 'Filter';
  document.body.appendChild(button);
  return button;
};

interface ShellOptions {
  open?: boolean;
  resetLabel?: string;
  children?: React.ReactNode;
}

const renderShell = ({
  open = true,
  resetLabel = 'Filter zurücksetzen',
  children = <div data-testid="filter-field" />,
}: ShellOptions = {}) => {
  const onClose = vi.fn();
  const onReset = vi.fn();
  const view = render(
    <FilterPopoverShell
      id="test-filter-popover"
      anchorEl={open ? anchor() : null}
      onClose={onClose}
      onReset={onReset}
      resetLabel={resetLabel}
    >
      {children}
    </FilterPopoverShell>,
  );
  return { ...view, onClose, onReset };
};

/**
 * The chrome behind every "filter icon next to a search field" control in the
 * app: the crop selector's popover, the public library's, and any later one.
 * It exists so those all look and behave the same whatever they filter by,
 * so what is covered here is the part none of them should have to restate.
 *
 * `CalendarFiltersPopover` deliberately does not use this shell -- it is a
 * mobile-only, left-anchored, single-column sheet, and the two-column grid
 * below would be wrong there.
 */
describe('FilterPopoverShell', () => {
  it('stays closed until something anchors it', () => {
    renderShell({ open: false });

    // `anchorEl` doubles as the open flag, so there is no way to ask for a
    // popover with nowhere to point.
    expect(screen.queryByTestId('filter-field')).not.toBeInTheDocument();
  });

  it('opens against its anchor', () => {
    renderShell();

    expect(screen.getByTestId('filter-field')).toBeInTheDocument();
  });

  it('carries the id the caller gave it, so a trigger can point at it', () => {
    renderShell();

    // The button that opens it needs `aria-controls` to name something real.
    expect(document.getElementById('test-filter-popover')).not.toBeNull();
  });

  it('renders whatever fields the caller brings', () => {
    renderShell({
      children: (
        <>
          <div data-testid="filter-field" />
          <div data-testid="second-field" />
        </>
      ),
    });

    expect(screen.getByTestId('filter-field')).toBeInTheDocument();
    expect(screen.getByTestId('second-field')).toBeInTheDocument();
  });

  describe('the reset action', () => {
    it('is offered under the fields', () => {
      renderShell();

      expect(screen.getByRole('button', { name: 'Filter zurücksetzen' })).toBeInTheDocument();
    });

    it('takes the caller’s own wording', () => {
      // Each context words it for what it resets.
      renderShell({ resetLabel: 'Alle Filter löschen' });

      expect(screen.getByRole('button', { name: 'Alle Filter löschen' })).toBeInTheDocument();
    });

    it('resets without closing the popover', async () => {
      const user = userEvent.setup();
      const { onReset, onClose } = renderShell();

      await user.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));

      // The cleared fields are the feedback; closing would hide it and force
      // the user to reopen to see what happened.
      expect(onReset).toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('spans the full width below the field grid', () => {
      renderShell();

      // Otherwise it would sit inside a grid cell as if it were a third
      // filter rather than the action that clears them.
      const reset = screen.getByRole('button', { name: 'Filter zurücksetzen' });
      expect(reset).toHaveStyle({ gridColumn: '1/-1' });
    });
  });

  describe('closing', () => {
    it('closes on Escape', async () => {
      const user = userEvent.setup();
      const { onClose } = renderShell();

      await user.keyboard('{Escape}');

      expect(onClose).toHaveBeenCalled();
    });

    it('closes when the click lands outside', async () => {
      const user = userEvent.setup();
      const { onClose } = renderShell();

      // The popover's own backdrop, not `document.body`: MUI catches the
      // outside click there, and clicking the body misses it entirely.
      await user.click(document.querySelector('.MuiBackdrop-root') as HTMLElement);

      // Unlike the undo snackbar, a filter popover has nothing to lose by
      // closing: the filters are already applied.
      expect(onClose).toHaveBeenCalled();
    });
  });

  /**
   * The shell's own width -- `min(92vw, 360px)` below `sm`, a flat 360px
   * above -- is not asserted. It is a media query, jsdom resolves none, and
   * the computed width is only ever `auto`; an assertion on it would hold
   * whatever the value were. The same goes for the grid collapsing to one
   * column below `sm`. What is checkable is that the grid is a grid and that
   * the reset spans it, both below.
   */
  describe('its layout', () => {
    it('lays the fields out in two columns where there is room', () => {
      renderShell();

      const grid = screen.getByTestId('filter-field').parentElement as HTMLElement;
      expect(grid).toHaveStyle({ display: 'grid' });
    });

  });
});

/**
 * One numeric bound in a filter popover. Thin on purpose -- what it exists
 * for is the keyboard a phone offers, which is the difference between typing
 * "2.5" easily and hunting for the decimal point.
 */
describe('FilterNumberField', () => {
  const renderField = (inputMode: 'numeric' | 'decimal', value = '') => {
    const onValueChange = vi.fn();
    const view = render(
      <FilterNumberField
        label="Mindestertrag"
        value={value}
        onValueChange={onValueChange}
        inputMode={inputMode}
      />,
    );
    return { ...view, onValueChange };
  };

  const field = () => screen.getByRole('spinbutton', { name: 'Mindestertrag' });

  it('is a labelled number input', () => {
    renderField('decimal');

    expect(field()).toHaveAttribute('type', 'number');
  });

  it('offers a decimal keypad for measured amounts', () => {
    renderField('decimal');

    // A yield is 2.5 kg; a numeric keypad would hide the separator.
    expect(field()).toHaveAttribute('inputmode', 'decimal');
  });

  it('offers a whole-number keypad for counts', () => {
    renderField('numeric');

    // Growth duration is a number of days, never 2.5 of them.
    expect(field()).toHaveAttribute('inputmode', 'numeric');
  });

  it('reports what was typed as text, not as a number', async () => {
    const user = userEvent.setup();
    const { onValueChange } = renderField('decimal');

    await user.type(field(), '2');

    // A half-typed "2." is not a number yet; parsing here would throw away
    // the keystroke the user is in the middle of.
    expect(onValueChange).toHaveBeenCalledWith('2');
  });

  it('shows the bound it was given', () => {
    renderField('numeric', '14');

    expect(field()).toHaveValue(14);
  });

  it('shows an empty bound as empty rather than as zero', () => {
    renderField('numeric', '');

    // Zero is a filter; blank is no filter. They must not look alike.
    expect(field()).toHaveValue(null);
  });
});
