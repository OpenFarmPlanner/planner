import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ColumnsPanelButton } from '../components/data-grid/ColumnsPanelButton';

/**
 * Shared "Spalten" toggle used by table toolbars to drive `EditableDataGrid`'s
 * built-in columns panel from outside the grid. Covered on its own since it
 * forwards its ref so callers can anchor the panel to it (see
 * `columnsPanelAnchorEl` on `EditableDataGrid`) and has to suppress the
 * panel's click-away handling on its own re-click (see the `onPointerUp`
 * comment in the component).
 */
describe('ColumnsPanelButton', () => {
  it('announces its open state', () => {
    render(<ColumnsPanelButton open={false} onOpenChange={vi.fn()} label="Spalten" />);

    const button = screen.getByRole('button', { name: 'Spalten' });
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('forwards its ref to the underlying button, for anchoring the panel', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<ColumnsPanelButton ref={ref} open={false} onOpenChange={vi.fn()} label="Spalten" />);

    expect(ref.current).toBe(screen.getByRole('button', { name: 'Spalten' }));
  });

  it('asks to open when shut and to close when open', () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <ColumnsPanelButton open={false} onOpenChange={onOpenChange} label="Spalten" />,
    );
    screen.getByRole('button', { name: 'Spalten' }).click();
    expect(onOpenChange).toHaveBeenCalledWith(true);

    rerender(<ColumnsPanelButton open={true} onOpenChange={onOpenChange} label="Spalten" />);
    screen.getByRole('button', { name: 'Spalten' }).click();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // MUI's ClickAwayListener (used by the panel itself) listens on `document`,
  // the same place real-world click-away handling lives, so the spy has to
  // sit there too for this to actually exercise the same race.
  it('stops a pointerup from reaching the panel while open, so a re-click cannot close-then-reopen it', () => {
    render(<ColumnsPanelButton open={true} onOpenChange={vi.fn()} label="Spalten" />);
    const button = screen.getByRole('button', { name: 'Spalten' });
    const outerHandler = vi.fn();
    document.addEventListener('pointerup', outerHandler);

    try {
      button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      expect(outerHandler).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('pointerup', outerHandler);
    }
  });

  it('lets a pointerup bubble normally while closed', () => {
    render(<ColumnsPanelButton open={false} onOpenChange={vi.fn()} label="Spalten" />);
    const button = screen.getByRole('button', { name: 'Spalten' });
    const outerHandler = vi.fn();
    document.addEventListener('pointerup', outerHandler);

    try {
      button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      expect(outerHandler).toHaveBeenCalled();
    } finally {
      document.removeEventListener('pointerup', outerHandler);
    }
  });
});
