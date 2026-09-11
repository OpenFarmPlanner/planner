import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import i18n from '../../i18n';
import { ProjectHistoryDialog } from '../ProjectHistoryDialog';
import type { CropHistoryEntry } from '../../api/types';

const t = i18n.getFixedT('de', 'navigation');
const tCrops = i18n.getFixedT('de', 'crops');
const restoreVersionLabel = t('commandPalette.restoreVersion');

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
    const { onRevertBatch } = renderDialog([batchEntry]);

    expect(screen.getByText('Saison 25/26 gelöscht: 2 Anbaupläne gelöscht')).toBeInTheDocument();
    // One summary row, no individual child rows.
    expect(screen.queryByText(/Salat \/ Beet 1/)).not.toBeInTheDocument();

    const buttons = screen.getAllByRole('button', { name: restoreVersionLabel });
    expect(buttons).toHaveLength(1);
    await user.click(buttons[0]);
    expect(onRevertBatch).toHaveBeenCalledWith(batchEntry);
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
    const { onRevertBatch } = renderDialog([revertEntry]);

    expect(screen.getByText('Wiederhergestellt: Saison 25/26 gelöscht')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: restoreVersionLabel }));
    expect(onRevertBatch).toHaveBeenCalledWith(revertEntry);
  });

  it('lists ungrouped revisions flat with "Version wiederherstellen"', () => {
    renderDialog([
      entry({ object_type: 'crop', object_display_name: 'Newest', action: 'updated' }),
      entry({ object_type: 'crop', object_display_name: 'Bijella', action: 'updated' }),
    ]);

    expect(screen.getByText(/Bijella/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: restoreVersionLabel }).length).toBeGreaterThan(0);
  });
});
