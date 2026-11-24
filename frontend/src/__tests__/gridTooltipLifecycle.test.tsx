import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppTooltip } from '../components/AppTooltip';
import { GridTooltipScope } from '../components/data-grid/GridTooltipScope';
import { registerOpenContextMenu } from '../components/contextMenu/contextMenuOpenState';

function Grid({ editing = false, firstRow = 'first' }: { editing?: boolean; firstRow?: string }) {
  return (
    <GridTooltipScope editing={editing}>
      <div role="grid">
        <div role="row" data-id={firstRow}>
          <div role="gridcell" data-field="name" tabIndex={-1} aria-label="First grid cell">
            <AppTooltip title="First preview" cellHasFocus={false} enterDelay={250} enterNextDelay={250}>
              <button aria-label="First cell" />
            </AppTooltip>
          </div>
        </div>
        <div role="row" data-id="second">
          <div role="gridcell" data-field="name">
            <AppTooltip title="Second preview" enterDelay={250} enterNextDelay={250}>
              <button aria-label="Second cell" />
            </AppTooltip>
            <AppTooltip title="Save the edited row" allowedDuringEdit enterDelay={250} enterNextDelay={250}>
              <button aria-label="Save" />
            </AppTooltip>
          </div>
        </div>
      </div>
    </GridTooltipScope>
  );
}

const hover = (name: string) => fireEvent.mouseOver(screen.getByRole('button', { name }));
const finishDelays = () => act(async () => { await vi.advanceTimersByTimeAsync(450); });

describe('grid tooltip lifecycle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('replaces a pending request and clears a visible tooltip on scroll or row reuse', async () => {
    const { rerender } = render(<Grid />);
    hover('First cell');
    hover('Second cell');
    await finishDelays();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Second preview');

    hover('First cell');
    await finishDelays();
    expect(screen.getByRole('tooltip')).toHaveTextContent('First preview');

    fireEvent.scroll(screen.getByRole('grid'));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    hover('First cell');
    await finishDelays();
    expect(screen.getByRole('tooltip')).toHaveTextContent('First preview');

    rerender(<Grid firstRow="recycled" />);
    await finishDelays();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('cancels a pending tooltip through edit entry and exit and keeps editor help available', async () => {
    const { rerender } = render(<Grid />);
    hover('First cell');
    rerender(<Grid editing />);
    hover('Second cell');
    await finishDelays();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    hover('Save');
    await finishDelays();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Save the edited row');

    rerender(<Grid />);
    await finishDelays();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    hover('Second cell');
    await finishDelays();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Second preview');
  });

  it('drops a pending opening when a context menu opens and closes', async () => {
    render(<Grid />);
    hover('First cell');
    act(() => {
      const close = registerOpenContextMenu(Symbol('row menu'));
      close();
    });
    await finishDelays();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    hover('Second cell');
    await finishDelays();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Second preview');
  });

  it('ignores mouseover when the view cell returns under the stationary pointer', async () => {
    const { rerender } = render(<Grid editing />);
    const first = screen.getByRole('button', { name: 'First cell' });
    const previousPoint = { clientX: 23, clientY: 47 };
    fireEvent.mouseMove(first, previousPoint);
    rerender(<Grid />);
    fireEvent.mouseOver(first, previousPoint);
    await finishDelays();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.mouseMove(document.body, { clientX: 83, clientY: 19 });
    fireEvent.mouseOver(first, previousPoint);
    await finishDelays();
    expect(screen.getByRole('tooltip')).toHaveTextContent('First preview');
  });

  it('opens a preview when native focus moves to its grid cell', async () => {
    render(<Grid />);
    act(() => screen.getByRole('gridcell', { name: 'First grid cell' }).focus());
    await finishDelays();
    expect(screen.getByRole('tooltip')).toHaveTextContent('First preview');
  });

  it('resets controlled help on dismiss so the next hover keeps its explanatory delay', async () => {
    const onDismiss = vi.fn();
    function ControlledHelp() {
      const [open, setOpen] = useState(false);
      return (
        <AppTooltip title="Delayed explanation" explanatory open={open} onOpen={() => setOpen(true)}
          onClose={event => { onDismiss(event.type); setOpen(false); }}>
          <button aria-label="Help" />
        </AppTooltip>
      );
    }
    render(<GridTooltipScope editing={false}><div role="grid"><ControlledHelp /></div></GridTooltipScope>);
    hover('Help');
    await act(async () => { await vi.advanceTimersByTimeAsync(650); });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Delayed explanation');

    fireEvent.scroll(screen.getByRole('grid'));
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledWith('scroll');
    hover('Help');
    await finishDelays();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Delayed explanation');
  });
});
