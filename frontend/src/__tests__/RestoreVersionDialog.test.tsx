import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RestoreVersionDialog } from '../navigation/RestoreVersionDialog';
import i18n from '../i18n';
import type { CropHistoryEntry } from '../api/types';

const tCrops = i18n.getFixedT('de', 'crops');

const entry = (partial: Partial<CropHistoryEntry> = {}): CropHistoryEntry => ({
  history_id: 7,
  history_date: '2026-03-23T14:48:00.000Z',
  history_type: 'snapshot',
  history_user: null,
  summary: '',
  ...partial,
});

const batchEntry = (partial: Partial<CropHistoryEntry> = {}): CropHistoryEntry =>
  entry({
    is_batch: true,
    batch_id: 42,
    batch_operation_type: 'season_create',
    batch_context: { season_label: '2027' },
    ...partial,
  });

const renderDialog = (value: CropHistoryEntry | null) => {
  const onClose = vi.fn();
  const onConfirm = vi.fn();
  const onConfirmRevertBatch = vi.fn();
  const getEntryTitle = vi.fn((item: CropHistoryEntry) => `Eintrag #${item.history_id}`);
  const formatTimestamp = vi.fn((raw: string) => `formatiert(${raw})`);
  const view = render(
    <RestoreVersionDialog
      entry={value}
      getEntryTitle={getEntryTitle}
      formatTimestamp={formatTimestamp}
      tCrops={tCrops}
      onClose={onClose}
      onConfirm={onConfirm}
      onConfirmRevertBatch={onConfirmRevertBatch}
    />,
  );
  return { ...view, onClose, onConfirm, onConfirmRevertBatch, getEntryTitle, formatTimestamp };
};

const confirmButton = (): HTMLElement =>
  screen.getByRole('button', { name: 'Version wiederherstellen' });

const cancelButton = (): HTMLElement => screen.getByRole('button', { name: 'Abbrechen' });

/**
 * The project history's confirmation dialog. It is presentational -- the state
 * and the two restore calls live in `RootLayout.tsx`, and the label helpers are
 * covered by `cropsHistoryUtils.test.ts`. What is left, and what is covered
 * here, is the fork it makes on `is_batch`: a plain revision offers "restore to
 * this version" and confirms with the `history_id`, while a batch offers "undo
 * this action" and confirms with the `batch_id`. Every user-facing string is
 * asserted through the real German bundle, because a swapped branch renders
 * perfectly valid copy that just describes the other operation.
 *
 * Three lines here are unreachable rather than untested, and no fixture can
 * reach them: `entry ? ... : null`, `entry ? isBatchGroupEntry(entry) : false`
 * and the confirm handler's `if (!entry) return;`. MUI unmounts a closed
 * dialog's children, so `entry === null` means nothing below `DialogTitle`
 * exists at all; those guards only narrow `CropHistoryEntry | null` for
 * TypeScript.
 */
describe('RestoreVersionDialog', () => {
  describe('open state', () => {
    it('renders nothing while the entry is null', () => {
      renderDialog(null);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.queryByText('Version wiederherstellen?')).not.toBeInTheDocument();
    });

    it('opens as soon as an entry is set', () => {
      renderDialog(entry());
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('shows the same title for both kinds of entry', () => {
      const { unmount } = renderDialog(entry());
      expect(screen.getByText('Version wiederherstellen?')).toBeInTheDocument();
      unmount();
      renderDialog(batchEntry());
      expect(screen.getByText('Version wiederherstellen?')).toBeInTheDocument();
    });
  });

  describe('copy for a plain revision', () => {
    it('describes restoring an earlier version', () => {
      renderDialog(entry());
      expect(screen.getByText('Du stellst eine frühere Version wieder her.')).toBeInTheDocument();
      expect(
        screen.queryByText('Du machst diese Aktion mit allen zugehörigen Änderungen rückgängig.'),
      ).not.toBeInTheDocument();
    });

    it('promises that the current version survives the restore', () => {
      renderDialog(entry());
      expect(
        screen.getByText(
          'Die aktuelle Version bleibt erhalten. Vor der Wiederherstellung wird automatisch eine neue Version erstellt, sodass du jederzeit wieder zurückwechseln kannst.',
        ),
      ).toBeInTheDocument();
    });
  });

  describe('copy for a batch entry', () => {
    it('describes undoing the whole action', () => {
      renderDialog(batchEntry());
      expect(
        screen.getByText('Du machst diese Aktion mit allen zugehörigen Änderungen rückgängig.'),
      ).toBeInTheDocument();
      expect(
        screen.queryByText('Du stellst eine frühere Version wieder her.'),
      ).not.toBeInTheDocument();
    });

    it('promises that the action itself stays in the history', () => {
      renderDialog(batchEntry());
      expect(
        screen.getByText(
          'Der vorherige Stand wird wiederhergestellt. Die Aktion selbst bleibt im Verlauf und kann erneut ausgeführt werden.',
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(
          'Die aktuelle Version bleibt erhalten. Vor der Wiederherstellung wird automatisch eine neue Version erstellt, sodass du jederzeit wieder zurückwechseln kannst.',
        ),
      ).not.toBeInTheDocument();
    });
  });

  describe('the entry being acted on', () => {
    it('names a plain revision by its display name', () => {
      const { getEntryTitle } = renderDialog(entry({ object_display_name: 'Karotte (Nantaise)' }));
      expect(screen.getByText('Karotte (Nantaise)')).toBeInTheDocument();
      expect(getEntryTitle).not.toHaveBeenCalled();
    });

    it('trims the display name it was given', () => {
      renderDialog(entry({ object_display_name: '   Karotte   ' }));
      expect(screen.getByText('Karotte')).toBeInTheDocument();
    });

    it.each([
      ['a missing display name', undefined],
      ['a null display name', null],
      ['an empty display name', ''],
      ['a whitespace-only display name', '   '],
    ])('falls back to the page-supplied title for %s', (_label, displayName) => {
      const { getEntryTitle } = renderDialog(
        entry({ history_id: 91, object_display_name: displayName }),
      );
      expect(screen.getByText('Eintrag #91')).toBeInTheDocument();
      expect(getEntryTitle).toHaveBeenCalledWith(expect.objectContaining({ history_id: 91 }));
    });

    it('names a batch by its summary, not by the display name it also carries', () => {
      const { getEntryTitle } = renderDialog(
        batchEntry({ object_display_name: 'Saison 2027' }),
      );
      expect(screen.getByText('Saison 2027 erstellt')).toBeInTheDocument();
      expect(screen.queryByText('Saison 2027')).not.toBeInTheDocument();
      expect(getEntryTitle).not.toHaveBeenCalled();
    });

    it('includes the batch child counts in the summary', () => {
      renderDialog(
        batchEntry({
          children: [
            entry({ history_id: 2, object_type: 'planting_plan', action: 'created' }),
            entry({ history_id: 3, object_type: 'planting_plan', action: 'created' }),
          ],
        }),
      );
      expect(
        screen.getByText('Saison 2027 erstellt: 2 Anbaupläne neu angelegt'),
      ).toBeInTheDocument();
    });

    it('renders the timestamp through the caller-supplied formatter', () => {
      const { formatTimestamp } = renderDialog(entry({ history_date: '2026-01-02T03:04:05.000Z' }));
      expect(formatTimestamp).toHaveBeenCalledWith('2026-01-02T03:04:05.000Z');
      expect(screen.getByText('formatiert(2026-01-02T03:04:05.000Z)')).toBeInTheDocument();
    });

    it('formats the timestamp of a batch entry too', () => {
      renderDialog(batchEntry({ history_date: '2025-12-24T00:00:00.000Z' }));
      expect(screen.getByText('formatiert(2025-12-24T00:00:00.000Z)')).toBeInTheDocument();
    });
  });

  describe('cancelling', () => {
    it('focuses Cancel rather than the confirm action, so Enter does not restore', () => {
      renderDialog(entry());
      expect(cancelButton()).toHaveFocus();
      expect(confirmButton()).not.toHaveFocus();
    });

    it('closes on Cancel without restoring anything', async () => {
      const user = userEvent.setup();
      const { onClose, onConfirm, onConfirmRevertBatch } = renderDialog(entry());
      await user.click(cancelButton());
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onConfirm).not.toHaveBeenCalled();
      expect(onConfirmRevertBatch).not.toHaveBeenCalled();
    });

    it('closes on Escape', async () => {
      const user = userEvent.setup();
      const { onClose, onConfirm } = renderDialog(entry());
      await user.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onConfirm).not.toHaveBeenCalled();
    });
  });

  describe('confirming', () => {
    it('restores a plain revision by its history id', async () => {
      const user = userEvent.setup();
      const { onConfirm, onConfirmRevertBatch, onClose } = renderDialog(entry({ history_id: 123 }));
      await user.click(confirmButton());
      expect(onConfirm).toHaveBeenCalledWith(123);
      expect(onConfirmRevertBatch).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('reverts a batch by its batch id', async () => {
      const user = userEvent.setup();
      const { onConfirm, onConfirmRevertBatch } = renderDialog(
        batchEntry({ history_id: 123, batch_id: 42 }),
      );
      await user.click(confirmButton());
      expect(onConfirmRevertBatch).toHaveBeenCalledWith(42);
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it.each([
      ['a missing batch id', undefined],
      ['a null batch id', null as unknown as undefined],
    ])('restores by history id when a batch entry has %s', async (_label, batchId) => {
      const user = userEvent.setup();
      const { onConfirm, onConfirmRevertBatch } = renderDialog(
        batchEntry({ history_id: 123, batch_id: batchId }),
      );
      await user.click(confirmButton());
      expect(onConfirm).toHaveBeenCalledWith(123);
      expect(onConfirmRevertBatch).not.toHaveBeenCalled();
    });

    /**
     * `revision_payload` in `backend/farm/history/views.py` puts `batch_id` only
     * on the grouping entry, never on the child revisions it groups, so the API
     * cannot produce this shape today -- which is why the `isBatch` half of the
     * guard has no other way to be reached. It is pinned anyway: the moment a
     * revision starts carrying the batch it belongs to, restoring that one
     * revision must not silently undo the whole batch.
     */
    it('restores by history id when a non-batch entry carries a batch id', async () => {
      const user = userEvent.setup();
      const { onConfirm, onConfirmRevertBatch } = renderDialog(
        entry({ history_id: 123, batch_id: 42 }),
      );
      await user.click(confirmButton());
      expect(onConfirm).toHaveBeenCalledWith(123);
      expect(onConfirmRevertBatch).not.toHaveBeenCalled();
    });

    it('reverts a batch whose id is zero', async () => {
      const user = userEvent.setup();
      const { onConfirm, onConfirmRevertBatch } = renderDialog(batchEntry({ batch_id: 0 }));
      await user.click(confirmButton());
      expect(onConfirmRevertBatch).toHaveBeenCalledWith(0);
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('leaves closing the dialog to the caller', async () => {
      const user = userEvent.setup();
      const { onClose } = renderDialog(batchEntry());
      await user.click(confirmButton());
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
