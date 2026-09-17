import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TruncatedTextWithTooltip } from '../components/TruncatedTextWithTooltip';

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

describe('TruncatedTextWithTooltip', () => {
  it('applies the single-line truncation styles', () => {
    render(<TruncatedTextWithTooltip text="Parzelle Nord" data-testid="truncated" />);

    const element = screen.getByTestId('truncated');
    expect(element).toHaveTextContent('Parzelle Nord');
    expect(element).toHaveStyle({
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    });
  });

  it('shows the full text on hover once the element is truncated', async () => {
    mockFinePointer(true);
    const user = userEvent.setup();
    render(<TruncatedTextWithTooltip text="Parzelle mit sehr langem Namen" data-testid="truncated" />);

    const element = screen.getByTestId('truncated');
    mockElementOverflow(element, { clientWidth: 80, scrollWidth: 320 });
    await user.hover(element);

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Parzelle mit sehr langem Namen');
  });

  it('stays silent when the text fits its container', async () => {
    mockFinePointer(true);
    const user = userEvent.setup();
    render(<TruncatedTextWithTooltip text="Beet 1" data-testid="truncated" />);

    const element = screen.getByTestId('truncated');
    mockElementOverflow(element, { clientWidth: 320, scrollWidth: 320 });
    await user.hover(element);

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('stays out of the tab order unless it is asked to be focusable', async () => {
    const user = userEvent.setup();
    render(<TruncatedTextWithTooltip text="Sorte mit langem Namen" data-testid="truncated" />);

    const element = screen.getByTestId('truncated');
    expect(element).not.toHaveAttribute('tabindex');

    await user.tab();
    expect(element).not.toHaveFocus();
  });

  it('reveals the full text on keyboard focus when focusable', async () => {
    mockFinePointer(true);
    const user = userEvent.setup();
    render(<TruncatedTextWithTooltip text="Sorte mit langem Namen" focusable data-testid="truncated" />);

    const element = screen.getByTestId('truncated');
    mockElementOverflow(element, { clientWidth: 60, scrollWidth: 300 });
    await user.tab();

    expect(element).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Sorte mit langem Namen');
  });

  it('keeps decorated children while using the plain text as the tooltip title', async () => {
    mockFinePointer(true);
    const user = userEvent.setup();
    render(
      <TruncatedTextWithTooltip text="Kultur Tomate" data-testid="truncated">
        <em>Kultur Tomate</em>
      </TruncatedTextWithTooltip>,
    );

    const element = screen.getByTestId('truncated');
    expect(element.querySelector('em')).not.toBeNull();

    mockElementOverflow(element, { clientWidth: 40, scrollWidth: 300 });
    await user.hover(element);

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Kultur Tomate');
  });
});
