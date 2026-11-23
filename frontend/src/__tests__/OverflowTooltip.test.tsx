import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OverflowTooltip } from '../components/OverflowTooltip';

function mockFinePointer(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches,
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
    })),
  });
}

function mockElementOverflow(element: HTMLElement, sizes: { clientWidth: number; scrollWidth: number }): void {
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: sizes.clientWidth });
  Object.defineProperty(element, 'scrollWidth', { configurable: true, value: sizes.scrollWidth });
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: 20 });
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 20 });
}

describe('OverflowTooltip', () => {
  it('does not show a tooltip when text is fully visible', async () => {
    mockFinePointer(true);
    const user = userEvent.setup();

    render(
      <OverflowTooltip title="Pflanzdatum">
        <span>Pflanzdatum</span>
      </OverflowTooltip>,
    );

    mockElementOverflow(screen.getByText('Pflanzdatum'), { clientWidth: 120, scrollWidth: 120 });
    await user.hover(screen.getByText('Pflanzdatum'));

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows the full value when the trigger actually overflows', async () => {
    mockFinePointer(true);
    const user = userEvent.setup();

    render(
      <OverflowTooltip title="Sehr langer Spaltenwert">
        <span>Sehr langer Spaltenwert</span>
      </OverflowTooltip>,
    );

    mockElementOverflow(screen.getByText('Sehr langer Spaltenwert'), { clientWidth: 60, scrollWidth: 180 });
    await user.hover(screen.getByText('Sehr langer Spaltenwert'));

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Sehr langer Spaltenwert');
  });

  it('updates tooltip behavior after a resize changes overflow', async () => {
    mockFinePointer(true);
    const user = userEvent.setup();

    render(
      <OverflowTooltip title="Dynamische Breite">
        <span>Dynamische Breite</span>
      </OverflowTooltip>,
    );

    const trigger = screen.getByText('Dynamische Breite');
    mockElementOverflow(trigger, { clientWidth: 180, scrollWidth: 180 });
    await user.hover(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    await user.unhover(trigger);
    mockElementOverflow(trigger, { clientWidth: 60, scrollWidth: 180 });
    await user.hover(trigger);

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Dynamische Breite');
  });

  it('reveals a clipped column label on keyboard focus with a coarse primary pointer', async () => {
    mockFinePointer(false);
    const user = userEvent.setup();

    render(
      <div role="columnheader" tabIndex={0}>
        <OverflowTooltip title="Pflanzung" focusWithinColumnHeader>
          <span>Pflanzung</span>
        </OverflowTooltip>
      </div>,
    );

    mockElementOverflow(screen.getByText('Pflanzung'), { clientWidth: 40, scrollWidth: 70 });
    await user.tab();

    expect(screen.getByRole('columnheader')).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Pflanzung');
  });

  it('does not add hover tooltip parity on coarse touch pointers', async () => {
    mockFinePointer(false);
    const user = userEvent.setup();

    render(
      <OverflowTooltip title="Mobile gekürzt">
        <span>Mobile gekürzt</span>
      </OverflowTooltip>,
    );

    mockElementOverflow(screen.getByText('Mobile gekürzt'), { clientWidth: 40, scrollWidth: 160 });
    await user.hover(screen.getByText('Mobile gekürzt'));

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
