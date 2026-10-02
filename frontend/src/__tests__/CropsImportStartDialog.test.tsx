import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { CropsImportStartDialog } from '../pages/CropsImportStartDialog';
import i18n from '../i18n';
import theme from '../theme';

/** The app theme's `primary.main`, which the zone takes on while dragging. */
const PRIMARY_COLOR = 'rgb(37, 111, 42)';
/** How jsdom reports `transparent`, which the zone sits at while idle. */
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

const t = i18n.getFixedT('de', 'crops') as unknown as (
  key: string,
  options?: Record<string, unknown>,
) => string;

const renderDialog = ({ open = true }: { open?: boolean } = {}) => {
  const onClose = vi.fn();
  const onFileSelected = vi.fn();
  const view = render(
    <ThemeProvider theme={theme}>
      <CropsImportStartDialog
        open={open}
        onClose={onClose}
        onFileSelected={onFileSelected}
        t={t}
      />
    </ThemeProvider>,
  );
  return { ...view, onClose, onFileSelected };
};

const fileInput = (): HTMLInputElement =>
  document.querySelector('input[type="file"]') as HTMLInputElement;

/** The whole dashed panel is the drop target, and the input's grandparent. */
const dropZone = (): HTMLElement => fileInput().parentElement as HTMLElement;

const selectButton = (): HTMLElement => screen.getByRole('button', { name: 'Datei auswählen' });

const spreadsheet = (name = 'kulturen.xlsx'): File =>
  new File(['content'], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

/**
 * The first step of the crops import: pick a file. Parsing, preview and the
 * actual import live in `useCropImportExport`, which has its own suite, so this
 * dialog's whole job is to hand a `File` to its caller -- and the three ways it
 * can fail to are what is covered here: not opening the picker, not reporting a
 * drop, and not resetting the hidden input afterwards.
 *
 * One mutation stands: removing the select button's own `onClick` entirely. The
 * click then bubbles to the zone, which opens the picker anyway, so the button's
 * handler is redundant *as long as* it keeps its `stopPropagation` -- dropping
 * only that half asks the browser for a file twice, and is caught.
 */
describe('CropsImportStartDialog', () => {
  describe('what it shows', () => {
    it('titles itself and names the supported formats', () => {
      renderDialog();
      expect(screen.getByText('Kulturen importieren')).toBeInTheDocument();
      expect(
        screen.getByText('Unterstützte Formate: JSON, CSV, Excel (.xlsx), OpenDocument (.ods)'),
      ).toBeInTheDocument();
    });

    it('renders nothing while closed', () => {
      renderDialog({ open: false });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(fileInput()).toBeNull();
    });

    /** The dialog's accept list has to match the formats it advertises. */
    it('accepts exactly the formats it advertises', () => {
      renderDialog();
      expect(fileInput()).toHaveAttribute('accept', '.json,.csv,.xlsx,.ods');
    });

    it('keeps the file input out of the layout', () => {
      renderDialog();
      expect(fileInput().style.display).toBe('none');
    });

    it('closes on its own close button', async () => {
      const user = userEvent.setup();
      const { onClose, onFileSelected } = renderDialog();
      await user.click(screen.getByRole('button', { name: 'Schließen' }));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onFileSelected).not.toHaveBeenCalled();
    });

    it('closes on Escape', async () => {
      const user = userEvent.setup();
      const { onClose } = renderDialog();
      await user.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('opening the file picker', () => {
    it('opens it from anywhere in the drop zone', async () => {
      const user = userEvent.setup();
      renderDialog();
      const click = vi.spyOn(fileInput(), 'click').mockImplementation(() => {});
      await user.click(dropZone());
      expect(click).toHaveBeenCalledTimes(1);
    });

    /**
     * The button sits inside the zone, which also opens the picker on click.
     * Without `stopPropagation` both handlers would run and the browser would
     * be asked for a file twice.
     */
    it('opens it exactly once from the button inside the zone', async () => {
      const user = userEvent.setup();
      renderDialog();
      const click = vi.spyOn(fileInput(), 'click').mockImplementation(() => {});
      await user.click(selectButton());
      expect(click).toHaveBeenCalledTimes(1);
    });
  });

  describe('picking a file', () => {
    it('hands the chosen file to the caller', async () => {
      const user = userEvent.setup();
      const { onFileSelected } = renderDialog();
      const file = spreadsheet();
      await user.upload(fileInput(), file);
      expect(onFileSelected).toHaveBeenCalledExactlyOnceWith(file);
    });

    /**
     * The input is cleared after every pick, so choosing the same file again
     * still fires a `change` event. Without it a user who fixes a spreadsheet
     * and re-picks it sees nothing happen.
     */
    it('clears the input so the same file can be picked again', async () => {
      const user = userEvent.setup();
      const { onFileSelected } = renderDialog();
      const file = spreadsheet();

      await user.upload(fileInput(), file);
      expect(fileInput().value).toBe('');

      await user.upload(fileInput(), file);
      expect(onFileSelected).toHaveBeenCalledTimes(2);
    });

    it('reports nothing when the picker comes back empty', () => {
      const { onFileSelected } = renderDialog();
      fireEvent.change(fileInput(), { target: { files: [] } });
      expect(onFileSelected).not.toHaveBeenCalled();
    });

    it('does not close itself -- the caller moves on to the preview', async () => {
      const user = userEvent.setup();
      const { onClose } = renderDialog();
      await user.upload(fileInput(), spreadsheet());
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('dropping a file', () => {
    const drop = (files: File[]): void => {
      fireEvent.drop(dropZone(), { dataTransfer: { files } });
    };

    it('hands a dropped file to the caller', () => {
      const { onFileSelected } = renderDialog();
      const file = spreadsheet();
      drop([file]);
      expect(onFileSelected).toHaveBeenCalledExactlyOnceWith(file);
    });

    it('takes the first of several dropped files', () => {
      const { onFileSelected } = renderDialog();
      const first = spreadsheet('erste.xlsx');
      drop([first, spreadsheet('zweite.xlsx')]);
      expect(onFileSelected).toHaveBeenCalledExactlyOnceWith(first);
    });

    it('reports nothing for a drop that carries no file', () => {
      const { onFileSelected } = renderDialog();
      drop([]);
      expect(onFileSelected).not.toHaveBeenCalled();
    });

    /**
     * Without `preventDefault` the browser navigates away to the dropped file
     * and the half-finished import is gone.
     */
    it('keeps the browser from opening the file itself', () => {
      renderDialog();
      const event = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { files: [spreadsheet()] } });
      const notCancelled = fireEvent(dropZone(), event);
      expect(notCancelled).toBe(false);
    });
  });

  describe('while a file is dragged over it', () => {
    /**
     * Both colours are named rather than just compared against each other. An
     * earlier version of these tests asserted only that the border "changed"
     * and that the background was not `'transparent'` -- which jsdom reports as
     * `rgba(0, 0, 0, 0)`, so that half passed whatever the component did.
     */
    const zoneStyle = (): CSSStyleDeclaration => window.getComputedStyle(dropZone());

    it('sits unhighlighted to begin with', () => {
      renderDialog();
      expect(zoneStyle().borderColor).not.toBe(PRIMARY_COLOR);
      expect(zoneStyle().backgroundColor).toBe(TRANSPARENT);
    });

    it('highlights the zone', () => {
      renderDialog();
      fireEvent.dragOver(dropZone());
      expect(zoneStyle().borderColor).toBe(PRIMARY_COLOR);
      expect(zoneStyle().backgroundColor).not.toBe(TRANSPARENT);
    });

    it('drops the highlight again when the pointer leaves', () => {
      renderDialog();
      fireEvent.dragOver(dropZone());
      expect(zoneStyle().borderColor).toBe(PRIMARY_COLOR);

      fireEvent.dragLeave(dropZone());
      expect(zoneStyle().borderColor).not.toBe(PRIMARY_COLOR);
      expect(zoneStyle().backgroundColor).toBe(TRANSPARENT);
    });

    /**
     * A drop leaves the zone highlighted unless the state is reset, and the
     * dialog stays mounted through the preview step that follows.
     */
    it('drops the highlight after a drop', () => {
      renderDialog();
      fireEvent.dragOver(dropZone());
      fireEvent.drop(dropZone(), { dataTransfer: { files: [spreadsheet()] } });
      expect(zoneStyle().borderColor).not.toBe(PRIMARY_COLOR);
      expect(zoneStyle().backgroundColor).toBe(TRANSPARENT);
    });

    /** Without this the browser refuses the drop and nothing is ever handed over. */
    it('accepts the drag, rather than letting the browser refuse it', () => {
      renderDialog();
      const event = new Event('dragover', { bubbles: true, cancelable: true });
      const notCancelled = fireEvent(dropZone(), event);
      expect(notCancelled).toBe(false);
    });
  });
});
