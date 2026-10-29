import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CompactAreaCell } from '../components/planting-plans/CompactAreaCell';

function mockElementOverflow(element: HTMLElement, sizes: { clientWidth: number; scrollWidth: number }): void {
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: sizes.clientWidth });
  Object.defineProperty(element, 'scrollWidth', { configurable: true, value: sizes.scrollWidth });
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: 20 });
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 20 });
}

describe('CompactAreaCell', () => {
  it('shows tooltip with full text on hover only when the value overflows', async () => {
    const user = userEvent.setup();
    const label = 'Regenbogenland · 8 Karotte + Zwiebel · Beet 5 (10,00 m²)';

    render(<CompactAreaCell label={label} />);

    mockElementOverflow(screen.getByText(label), {
      clientWidth: 120,
      scrollWidth: 420,
    });
    await user.hover(screen.getByText(label));

    expect(await screen.findByRole('tooltip')).toHaveTextContent(label);
  });

  it('does not show a tooltip for long values that are fully visible', async () => {
    const user = userEvent.setup();
    const label = 'Regenbogenland · 8 Karotte + Zwiebel · Beet 5 (10,00 m²)';

    render(<CompactAreaCell label={label} />);

    mockElementOverflow(screen.getByText(label), {
      clientWidth: 420,
      scrollWidth: 420,
    });
    await user.hover(screen.getByText(label));

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('is keyboard focusable when the grid cell has focus', async () => {
    const label = 'Regenbogenland · 8 Karotte + Zwiebel · Beet 5 (10,00 m²)';

    render(<CompactAreaCell label={label} hasFocus />);

    const focusTarget = screen.getByText(label).closest('div') as HTMLElement;
    expect(focusTarget).toHaveAttribute('tabindex', '0');
    await waitFor(() => expect(focusTarget).toHaveFocus());
  });

  it('stays out of the tab order when the grid cell does not have focus', () => {
    const label = 'Regenbogenland · 8 Karotte + Zwiebel · Beet 5 (10,00 m²)';

    render(<CompactAreaCell label={label} />);

    expect(screen.getByText(label).closest('div')).toHaveAttribute('tabindex', '-1');
  });

  it('keeps short values compact without tooltip interaction', async () => {
    const user = userEvent.setup();
    const label = 'Parzelle · Beet';

    render(<CompactAreaCell label={label} />);

    await user.hover(screen.getByText(label));

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('opens its editor on a single click when it acts as the trigger', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();

    render(<CompactAreaCell label="Beet 5" onOpen={onOpen} triggerLabel="Anbaufläche bearbeiten" />);

    await user.click(screen.getByRole('button', { name: 'Anbaufläche bearbeiten' }));

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('opens its editor from the keyboard without bubbling the key to the grid cell', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onCellKeyDown = vi.fn();

    render(
      <div onKeyDown={onCellKeyDown}>
        <CompactAreaCell label="Beet 5" hasFocus onOpen={onOpen} triggerLabel="Anbaufläche bearbeiten" />
      </div>,
    );

    const trigger = screen.getByRole('button', { name: 'Anbaufläche bearbeiten' });
    await waitFor(() => expect(trigger).toHaveFocus());

    await user.keyboard('{Enter}');
    await user.keyboard(' ');

    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onCellKeyDown).not.toHaveBeenCalled();
  });

  it('renders no separate edit affordance next to the value', () => {
    render(<CompactAreaCell label="Beet 5" onOpen={vi.fn()} triggerLabel="Anbaufläche bearbeiten" />);

    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(document.querySelector('svg[data-testid="EditIcon"]')).toBeNull();
  });

  it('falls back to the placeholder while no area is assigned', () => {
    render(<CompactAreaCell label="" placeholder="Anbaufläche wählen" onOpen={vi.fn()} />);

    expect(screen.getByText('Anbaufläche wählen')).toBeInTheDocument();
  });

  it('keeps focus inside the editor while it is open', async () => {
    const { rerender } = render(<CompactAreaCell label="Beet 5" hasFocus suppressFocus onOpen={vi.fn()} />);

    const trigger = screen.getByRole('button');
    expect(trigger).not.toHaveFocus();

    rerender(<CompactAreaCell label="Beet 5" hasFocus onOpen={vi.fn()} />);

    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('uses compact ellipsis styles', () => {
    const label = 'Regenbogenland · 8 Karotte + Zwiebel · Beet 5 (10,00 m²)';
    const { container } = render(<CompactAreaCell label={label} />);

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper).toHaveStyle({ overflow: 'hidden' });
  });
});
