import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import i18n from '../../i18n';
import { ProjectHistoryDialog } from '../ProjectHistoryDialog';
import type { CropHistoryEntry } from '../../api/types';

const t = i18n.getFixedT('de', 'navigation');
const tCrops = i18n.getFixedT('de', 'crops');
const restoreVersionLabel = 'Zu dieser Version wechseln';
const currentVersionLabel = 'Aktuelle Version';

function entry(partial: Partial<CropHistoryEntry>): CropHistoryEntry {
  return {
    history_id: Math.floor(Math.random() * 1e6),
    history_date: '2026-08-30T12:37:00.000Z',
    history_type: 'project_snapshot',
    history_user: 'Martin',
    summary: '',
    actor_label: 'Martin',
    ...partial,
  };
}

function renderDialog(
  items: CropHistoryEntry[],
  { onRestore = vi.fn(), onRevertBatch = vi.fn() } = {},
) {
  render(
    <MemoryRouter>
      <ProjectHistoryDialog
        open
        items={items}
        isPhonePortrait={false}
        fallbackActorLabel="Martin"
        formatTimestamp={(value) => new Date(value).toLocaleString('de-DE')}
        onClose={vi.fn()}
        onRestore={onRestore}
        onRevertBatch={onRevertBatch}
        t={t}
        tCrops={tCrops}
      />
    </MemoryRouter>,
  );
  return { onRestore, onRevertBatch };
}

describe('ProjectHistoryDialog', () => {
  it('retains the legacy season undo as a secondary action', async () => {
    const user = userEvent.setup();
    const season = entry({ is_batch: true, batch_id: 8, batch_operation_type: 'season_delete',
      batch_context: { season_label: '2026' } });
    const { onRevertBatch, onRestore } = renderDialog([season]);
    await user.click(screen.getByRole('button', { name: 'Mehr' }));
    await user.click(screen.getByRole('menuitem', { name: 'Diese Aktion rückgängig machen' }));
    expect(onRevertBatch).toHaveBeenCalledWith(season);
    expect(onRestore).not.toHaveBeenCalled();
  });
  it('keeps selective import undo in the menu and full restore on the main row', async () => {
    const user = userEvent.setup();
    const imported = entry({ is_batch: true, batch_id: 14, batch_operation_type: 'crop_import',
      batch_context: { created_count: 2, updated_count: 1 }, children: [
        entry({ object_type: 'crop', object_id: 70, object_display_name: 'Carrot', action: 'created' }),
        entry({ object_type: 'crop', object_id: 71, object_display_name: 'Leek', action: 'updated' }),
      ] });
    const { onRestore, onRevertBatch } = renderDialog([imported]);
    expect(screen.getByText('3 Kulturen importiert')).toBeInTheDocument();
    expect(screen.getByText('2 neue Kulturen erstellt · 1 Kultur aktualisiert')).toBeInTheDocument();
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: restoreVersionLabel }));
    expect(onRestore).toHaveBeenCalledWith(imported);
    expect(onRevertBatch).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Betroffene Datensätze' }));
    expect(screen.getByText(/Carrot/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Carrot/ })).toHaveAttribute('href', '/app/crops?cropId=70');
    expect(screen.getByText(/Leek/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Importaktionen' }));
    await user.click(screen.getByRole('menuitem', { name: 'Nur diesen Import rückgängig machen' }));
    expect(onRevertBatch).toHaveBeenCalledWith(imported);
  });
  it('renders a cascade as one summarized row with a single undo action', async () => {
    const user = userEvent.setup();
    const batchEntry = entry({
      is_batch: true,
      batch_id: 7,
      batch_operation_type: 'season_delete',
      batch_context: { season_label: '25/26' },
      children: [
        entry({ object_type: 'season', action: 'deleted' }),
        entry({ object_type: 'planting_plan', object_display_name: 'Salat / Beet 1', action: 'deleted' }),
        entry({ object_type: 'planting_plan', object_display_name: 'Karotte / Beet 2', action: 'deleted' }),
      ],
    });
    const { onRestore } = renderDialog([batchEntry]);

    expect(screen.getByText('Saison 25/26 gelöscht: 2 Anbaupläne gelöscht')).toBeInTheDocument();
    // One summary row, no individual child rows.
    expect(screen.queryByText(/Salat \/ Beet 1/)).not.toBeInTheDocument();

    const buttons = screen.getAllByRole('button', { name: restoreVersionLabel });
    expect(buttons).toHaveLength(1);
    await user.click(buttons[0]);
    expect(onRestore).toHaveBeenCalledWith(batchEntry);
  });

  it('shows a "revert of a revert" entry with the same restore button', async () => {
    const user = userEvent.setup();
    const revertEntry = entry({
      is_batch: true,
      batch_id: 9,
      batch_operation_type: 'batch_reverted',
      batch_context: { reverted_operation_type: 'season_delete', season_label: '25/26' },
      children: [entry({ object_type: 'season', action: 'restored' })],
    });
    const { onRestore } = renderDialog([revertEntry]);

    expect(screen.getByText('Wiederhergestellt: Saison 25/26 gelöscht')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: restoreVersionLabel }));
    expect(onRestore).toHaveBeenCalledWith(revertEntry);
  });

  it('lists ungrouped revisions flat with the localized restore action', () => {
    renderDialog([
      entry({ object_type: 'crop', object_display_name: 'Newest', action: 'updated' }),
      entry({ object_type: 'crop', object_display_name: 'Bijella', action: 'updated' }),
    ]);

    expect(screen.getByText(/Bijella/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: restoreVersionLabel }).length).toBeGreaterThan(0);
  });

  it('shows a badge instead of the restore action on the current version only', async () => {
    const user = userEvent.setup();
    const older = entry({ object_type: 'crop', object_display_name: 'Older', action: 'updated' });
    const { onRestore } = renderDialog([
      entry({ object_type: 'crop', object_display_name: 'Newest', action: 'updated', is_current_version: true }),
      older,
      entry({ object_type: 'crop', object_display_name: 'Oldest', action: 'created' }),
    ]);

    const [currentRow, ...otherRows] = screen.getAllByRole('listitem');
    expect(within(currentRow).getByText(currentVersionLabel)).toBeInTheDocument();
    expect(within(currentRow).queryByRole('button')).not.toBeInTheDocument();
    expect(otherRows).toHaveLength(2);
    for (const row of otherRows) {
      expect(within(row).getByRole('button', { name: restoreVersionLabel })).toBeInTheDocument();
      expect(within(row).queryByText(currentVersionLabel)).not.toBeInTheDocument();
    }

    await user.click(within(otherRows[0]).getByRole('button', { name: restoreVersionLabel }));
    expect(onRestore).toHaveBeenCalledWith(older);
  });

  it('does not infer the current version from list position', () => {
    renderDialog([
      entry({ object_type: 'crop', object_display_name: 'Newest', action: 'updated' }),
      entry({ object_type: 'crop', object_display_name: 'Older', action: 'updated' }),
    ]);

    expect(screen.queryByText(currentVersionLabel)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: restoreVersionLabel })).toHaveLength(2);
  });
});
