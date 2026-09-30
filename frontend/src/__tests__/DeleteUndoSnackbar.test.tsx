import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DELETE_UNDO_DURATION_MS,
  DeleteUndoSnackbar,
} from '../components/data-grid/DeleteUndoSnackbar';

interface RenderOptions {
  open?: boolean;
  message?: string;
  undoLabel?: string;
  offsetIndex?: number;
  testId?: string;
}

const renderSnackbar = ({
  open = true,
  message = 'Lieferant gelöscht.',
  undoLabel = 'Rückgängig',
  offsetIndex,
  testId,
}: RenderOptions = {}) => {
  const onClose = vi.fn();
  const onUndo = vi.fn();
  const view = render(
    <DeleteUndoSnackbar
      open={open}
      message={message}
      undoLabel={undoLabel}
      offsetIndex={offsetIndex}
      testId={testId}
      onClose={onClose}
      onUndo={onUndo}
    />,
  );
  return { ...view, onClose, onUndo };
};

const undoButton = () => screen.getByRole('button', { name: /Rückgängig/ });

afterEach(() => {
  vi.useRealTimers();
});

/**
 * The undo offer shown after a delete. Seven callers use it -- the shared
 * DataGrid, the season switcher and five pages -- so the deletion in every
 * one of them is only reversible for as long as this stays on screen.
 */
describe('DeleteUndoSnackbar', () => {
  it('stays away until there is something to undo', () => {
    renderSnackbar({ open: false });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('says what was deleted and offers to take it back', () => {
    renderSnackbar();

    expect(screen.getByRole('status')).toHaveTextContent('Lieferant gelöscht.');
    expect(undoButton()).toBeInTheDocument();
  });

  it('undoes on request, without also closing itself', async () => {
    const user = userEvent.setup();
    const { onUndo, onClose } = renderSnackbar();

    await user.click(undoButton());

    // Closing is the caller's business: it knows whether the undo succeeded.
    expect(onUndo).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('names its undo button after the deletion it belongs to', () => {
    renderSnackbar({ message: 'Kultur „Bijella“ gelöscht.' });

    // Several deletions can stack, and then "Rückgängig" alone is the same
    // name three times over for anyone listening rather than looking.
    expect(
      screen.getByRole('button', { name: 'Rückgängig: Kultur „Bijella“ gelöscht.' }),
    ).toBeInTheDocument();
  });

  it('announces itself politely rather than interrupting', () => {
    renderSnackbar();

    // A delete is something the user just did; it does not need to cut in.
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  describe('dismissing it', () => {
    it('ignores a click somewhere else on the page', () => {
      const { onClose } = renderSnackbar();

      // MUI would treat any outside click as a dismissal. Here that would
      // throw away the undo window for an unrelated click -- the one thing
      // this snackbar exists to keep open.
      act(() => {
        document.body.click();
      });

      expect(onClose).not.toHaveBeenCalled();
    });

    it('closes itself once the undo window has run out', () => {
      vi.useFakeTimers();
      const { onClose } = renderSnackbar();

      act(() => {
        vi.advanceTimersByTime(DELETE_UNDO_DURATION_MS);
      });

      expect(onClose).toHaveBeenCalledWith('timeout');
    });

    it('is still there a moment before the window closes', () => {
      vi.useFakeTimers();
      const { onClose } = renderSnackbar();

      act(() => {
        vi.advanceTimersByTime(DELETE_UNDO_DURATION_MS - 1);
      });

      // Ten seconds is the promise; closing early would shorten it.
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('closes on Escape, and says that is why', async () => {
      const user = userEvent.setup();
      const { onClose } = renderSnackbar();

      await user.keyboard('{Escape}');

      // The reason is passed on so a caller can tell a deliberate dismissal
      // from the window simply expiring.
      expect(onClose).toHaveBeenCalledWith('escapeKeyDown');
    });
  });

  describe('when several deletions stack', () => {
    it('sits at the bottom when it is the only one', () => {
      renderSnackbar({ offsetIndex: 0 });

      const snackbar = screen.getByRole('status').parentElement as HTMLElement;
      expect(snackbar).toHaveStyle({ marginBottom: '0px' });
    });

    it('is lifted clear of the ones below it', () => {
      renderSnackbar({ offsetIndex: 1 });

      // Seven spacing units per snackbar, on MUI's 8px grid: one snackbar's
      // height plus a gap. Without the offset every undo would land on the
      // same spot and only the last one would be clickable.
      const snackbar = screen.getByRole('status').parentElement as HTMLElement;
      expect(snackbar).toHaveStyle({ marginBottom: '56px' });
    });

    it('stacks by a constant step, so a third one clears the second', () => {
      renderSnackbar({ offsetIndex: 2 });

      const snackbar = screen.getByRole('status').parentElement as HTMLElement;
      expect(snackbar).toHaveStyle({ marginBottom: '112px' });
    });

    it('can be told apart by a caller-chosen test id', () => {
      renderSnackbar({ testId: 'crop-undo-snackbar' });

      expect(screen.getByTestId('crop-undo-snackbar')).toBeInTheDocument();
      expect(screen.queryByTestId('delete-undo-snackbar')).not.toBeInTheDocument();
    });

    it('carries a default test id when the caller has only one', () => {
      renderSnackbar();

      expect(screen.getByTestId('delete-undo-snackbar')).toBeInTheDocument();
    });
  });

  describe('what a screen reader is spared', () => {
    it('keeps the decorative tick and divider out of the announcement', () => {
      renderSnackbar();

      const status = screen.getByRole('status');
      // The message and the button carry the meaning; the tick and the rule
      // between them are there for the eye, so both are hidden from the
      // accessibility tree and the announcement stays one sentence.
      expect(status.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
      expect(status).toHaveAccessibleName('');
      expect(status).toHaveTextContent('Lieferant gelöscht.');
    });
  });

  it('renders outside its caller, so a dialog cannot clip it', () => {
    render(
      <div style={{ overflow: 'hidden', height: 0 }} data-testid="cramped-host">
        <DeleteUndoSnackbar
          open
          message="Lieferant gelöscht."
          undoLabel="Rückgängig"
          onClose={vi.fn()}
          onUndo={vi.fn()}
        />
      </div>,
    );

    // Portalled to the body: the callers include grids and dialogs that clip
    // their own overflow, and an undo the user cannot reach is no undo.
    const host = screen.getByTestId('cramped-host');
    expect(host).not.toContainElement(screen.getByRole('status'));
  });
});
