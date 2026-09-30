import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CropsExportDialog } from '../pages/CropsExportDialog';
import i18n from '../i18n';
import { expectNoTooltip, tooltipOf } from './helpers/disabledActionTooltip';

const t = i18n.getFixedT('de', ['crops', 'common']) as unknown as (
  key: string,
  options?: Record<string, unknown>,
) => string;

type ExportScope = 'current' | 'all';
type ExportFormat = 'xlsx' | 'ods' | 'csv' | 'json';

interface RenderOptions {
  open?: boolean;
  hasCurrentCrop?: boolean;
  initialScope?: ExportScope;
  onExport?: (scope: ExportScope, format: ExportFormat) => Promise<void>;
}

const renderDialog = ({
  open = true,
  hasCurrentCrop = true,
  initialScope,
  onExport = vi.fn(async () => {}),
}: RenderOptions = {}) => {
  const onClose = vi.fn();
  const props = { open, hasCurrentCrop, initialScope, onClose, onExport, t };
  const view = render(<CropsExportDialog {...props} />);
  const rerenderWith = (next: Partial<RenderOptions>) =>
    view.rerender(<CropsExportDialog {...props} {...next} />);
  return { ...view, onClose, onExport, rerenderWith };
};

const radio = (name: string): HTMLElement => screen.getByRole('radio', { name });
const submitButton = (): HTMLElement => screen.getByRole('button', { name: 'Exportieren' });
const cancelButton = (): HTMLElement => screen.getByRole('button', { name: 'Abbrechen' });

/**
 * The crops page's export dialog. It owns three pieces of state -- scope,
 * format and an in-flight flag -- and hands the chosen pair to a caller-supplied
 * `onExport`. The hook behind that callback has its own tests in
 * `useCropImportExport.test.ts`; what is covered here is the dialog's own
 * decisions: which scope it starts on, that it only resets the scope, what it
 * disables while an export runs, and that it closes once the export resolves.
 *
 * A mutation battery leaves two breaks standing, both because the code is
 * redundant rather than untested: the `useState(initialScope)` seed, which the
 * reset effect overwrites before the first paint, and the effect's own
 * `if (open)`, which only avoids a state write while the dialog is unmounted.
 * Neither is observable from outside, and neither is worth changing.
 */
describe('CropsExportDialog', () => {
  describe('chrome', () => {
    it('titles itself and labels both groups of choices', () => {
      renderDialog();
      expect(screen.getByText('Kulturen exportieren')).toBeInTheDocument();
      expect(screen.getByText('Umfang')).toBeInTheDocument();
      expect(screen.getByText('Format')).toBeInTheDocument();
    });

    it('closes on Escape without exporting', async () => {
      const user = userEvent.setup();
      const { onClose, onExport } = renderDialog();
      await user.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onExport).not.toHaveBeenCalled();
    });
  });

  describe('scope', () => {
    it('defaults to all crops when the caller names no scope', () => {
      renderDialog();
      expect(radio('Alle Kulturen')).toBeChecked();
      expect(radio('Aktuelle Kultur')).not.toBeChecked();
    });

    it('honours the entry point that asks for the current crop', () => {
      renderDialog({ initialScope: 'current' });
      expect(radio('Aktuelle Kultur')).toBeChecked();
      expect(radio('Alle Kulturen')).not.toBeChecked();
    });

    it('lets the user switch scope', async () => {
      const user = userEvent.setup();
      renderDialog({ initialScope: 'all' });
      await user.click(radio('Aktuelle Kultur'));
      expect(radio('Aktuelle Kultur')).toBeChecked();
    });

    it('offers no current-crop scope without a selected crop', () => {
      renderDialog({ hasCurrentCrop: false });
      expect(radio('Aktuelle Kultur')).toBeDisabled();
      expect(radio('Alle Kulturen')).toBeEnabled();
    });

    it('explains the empty current-crop scope when an entry point preselected it', () => {
      renderDialog({ hasCurrentCrop: false, initialScope: 'current' });
      expect(screen.getByText('Keine Kultur ausgewählt')).toBeInTheDocument();
    });

    it('stays quiet about the current-crop scope while a crop is selected', () => {
      renderDialog({ hasCurrentCrop: true, initialScope: 'current' });
      expect(screen.queryByText('Keine Kultur ausgewählt')).not.toBeInTheDocument();
    });

    it('does not explain a scope the user is not on', () => {
      renderDialog({ hasCurrentCrop: false, initialScope: 'all' });
      expect(screen.queryByText('Keine Kultur ausgewählt')).not.toBeInTheDocument();
    });
  });

  describe('reopening', () => {
    it('drops the scope the user picked last time', async () => {
      const user = userEvent.setup();
      const { rerenderWith } = renderDialog({ initialScope: 'all' });
      await user.click(radio('Aktuelle Kultur'));
      rerenderWith({ open: false });
      rerenderWith({ open: true });
      expect(radio('Alle Kulturen')).toBeChecked();
    });

    it('keeps the format the user picked last time', async () => {
      const user = userEvent.setup();
      const { rerenderWith } = renderDialog();
      await user.click(radio('CSV (.csv)'));
      rerenderWith({ open: false });
      rerenderWith({ open: true });
      expect(radio('CSV (.csv)')).toBeChecked();
      expect(radio('Excel (.xlsx)')).not.toBeChecked();
    });

    it('picks up a scope the caller changed while the dialog was closed', () => {
      const { rerenderWith } = renderDialog({ open: false, initialScope: 'all' });
      rerenderWith({ open: true, initialScope: 'current' });
      expect(radio('Aktuelle Kultur')).toBeChecked();
    });

    /**
     * Not reachable through `Crops.tsx`, which sets the scope in the same commit
     * that opens the dialog -- but the prop is documented as the entry point's
     * choice, so the dialog follows it for as long as it is mounted rather than
     * only sampling it once.
     */
    it('follows a scope the caller changes while the dialog is open', async () => {
      const user = userEvent.setup();
      const { rerenderWith } = renderDialog({ initialScope: 'all' });
      await user.click(radio('Aktuelle Kultur'));
      rerenderWith({ initialScope: 'current' });
      expect(radio('Aktuelle Kultur')).toBeChecked();
      rerenderWith({ initialScope: 'all' });
      expect(radio('Alle Kulturen')).toBeChecked();
    });

    it('renders nothing while closed', () => {
      renderDialog({ open: false });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  describe('format', () => {
    it('offers the three spreadsheet formats and JSON, starting on xlsx', () => {
      renderDialog();
      expect(radio('Excel (.xlsx)')).toBeChecked();
      ['OpenDocument Tabelle (.ods)', 'CSV (.csv)', 'JSON (.json)'].forEach((label) => {
        expect(radio(label)).toBeEnabled();
        expect(radio(label)).not.toBeChecked();
      });
    });

    it('stays available without a selected crop, unlike the scope', () => {
      renderDialog({ hasCurrentCrop: false });
      expect(radio('JSON (.json)')).toBeEnabled();
    });
  });

  describe('exporting', () => {
    it.each([
      ['Excel (.xlsx)', 'xlsx' as const],
      ['OpenDocument Tabelle (.ods)', 'ods' as const],
      ['CSV (.csv)', 'csv' as const],
      ['JSON (.json)', 'json' as const],
    ])('hands over %s as %s', async (label, format) => {
      const user = userEvent.setup();
      const { onExport } = renderDialog();
      await user.click(radio(label));
      await user.click(submitButton());
      expect(onExport).toHaveBeenCalledWith('all', format);
    });

    it('hands over the scope the user switched to', async () => {
      const user = userEvent.setup();
      const { onExport } = renderDialog({ initialScope: 'all' });
      await user.click(radio('Aktuelle Kultur'));
      await user.click(submitButton());
      expect(onExport).toHaveBeenCalledWith('current', 'xlsx');
    });

    it('closes once the export resolves', async () => {
      const user = userEvent.setup();
      const { onClose } = renderDialog();
      await user.click(submitButton());
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('blocks the current-crop scope without a crop, and says why', async () => {
      const user = userEvent.setup();
      const { onExport } = renderDialog({ hasCurrentCrop: false, initialScope: 'current' });
      expect(submitButton()).toBeDisabled();
      expect(await tooltipOf(user, submitButton())).toHaveTextContent('Keine Kultur ausgewählt');
      expect(onExport).not.toHaveBeenCalled();
    });

    it('leaves the submit action enabled and untooltipped when the scope is usable', async () => {
      const user = userEvent.setup();
      renderDialog({ hasCurrentCrop: true, initialScope: 'current' });
      expect(submitButton()).toBeEnabled();
      await expectNoTooltip(user, submitButton());
    });

    it('cancels without exporting', async () => {
      const user = userEvent.setup();
      const { onClose, onExport } = renderDialog();
      await user.click(cancelButton());
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onExport).not.toHaveBeenCalled();
    });
  });

  describe('while an export is in flight', () => {
    /**
     * `onExport` is kept unresolved for the whole assertion: the in-flight flag
     * is cleared in a `finally`, so a resolved promise would put the dialog back
     * in its idle state before anything could be read off it.
     */
    const pendingExport = () => {
      let resolve = (): void => {};
      const onExport = vi.fn(() => new Promise<void>((res) => { resolve = res; }));
      return { onExport, resolve: () => resolve() };
    };

    it('disables both actions', async () => {
      const user = userEvent.setup();
      const { onExport } = pendingExport();
      renderDialog({ onExport });
      await user.click(submitButton());
      await waitFor(() => expect(submitButton()).toBeDisabled());
      expect(cancelButton()).toBeDisabled();
    });

    it('says why they are disabled', async () => {
      const user = userEvent.setup();
      const { onExport } = pendingExport();
      renderDialog({ onExport });
      await user.click(submitButton());
      await waitFor(() => expect(cancelButton()).toBeDisabled());
      expect(await tooltipOf(user, cancelButton())).toHaveTextContent(
        'Aktion wird gerade verarbeitet.',
      );
      expect(await tooltipOf(user, submitButton())).toHaveTextContent(
        'Aktion wird gerade verarbeitet.',
      );
    });

    it('stays open until the export resolves', async () => {
      const user = userEvent.setup();
      const { onExport, resolve } = pendingExport();
      const { onClose } = renderDialog({ onExport });
      await user.click(submitButton());
      await waitFor(() => expect(submitButton()).toBeDisabled());
      expect(onClose).not.toHaveBeenCalled();
      resolve();
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    });

    /**
     * The real parent unmounts the dialog in its `onClose`, so this is only
     * observable because the harness leaves `open` true -- but it is what pins
     * the `finally` that clears the in-flight flag. The rejecting path cannot be
     * pinned the same way: the click handler is `() => void handleExport()`, so
     * a rejection escapes as an unhandled promise rejection and fails the run.
     * That is the repo-wide `void asyncFn()` click pattern, not this dialog's,
     * and changing it belongs in its own change.
     */
    it('re-enables the actions once the export resolves', async () => {
      const user = userEvent.setup();
      const { onExport, resolve } = pendingExport();
      renderDialog({ onExport });
      await user.click(submitButton());
      await waitFor(() => expect(submitButton()).toBeDisabled());
      resolve();
      await waitFor(() => expect(submitButton()).toBeEnabled());
      expect(cancelButton()).toBeEnabled();
    });
  });
});
