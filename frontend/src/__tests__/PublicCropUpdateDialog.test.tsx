import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicCropUpdateDialog } from '../crops/PublicCropUpdateDialog';
import { usePublicCropUpdate } from '../crops/usePublicCropUpdate';
import type { Crop, CropPublicUpdate } from '../api/types';
import translations from '@/test-utils/translations';

const apiMocks = vi.hoisted(() => ({
  publicUpdate: vi.fn(),
  rejectPublicUpdate: vi.fn(),
  importToProject: vi.fn(),
}));

vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return {
    ...actual,
    cropAPI: {
      ...actual.cropAPI,
      publicUpdate: apiMocks.publicUpdate,
      rejectPublicUpdate: apiMocks.rejectPublicUpdate,
    },
    publicCropAPI: { ...actual.publicCropAPI, importToProject: apiMocks.importToProject },
  };
});

const t = translations.crops.library;

const importedCrop: Crop = {
  id: 7,
  name: 'Karotte',
  variety: 'Nantes',
  origin_type: 'imported',
  source_public_crop: 42,
  public_update_available: true,
};

const varietyRenameUpdate: CropPublicUpdate = {
  available: true,
  public_crop_id: 42,
  public_crop_name: 'Karotte (Nantes II)',
  public_version: 2,
  local_version: 1,
  has_local_changes: false,
  changes: [
    { field: 'variety', local_value: 'Nantes', public_value: 'Nantes II' },
    { field: 'growth_duration_days', local_value: 70, public_value: 80 },
  ],
};

/** The dialog is opened from the badge-row action button; here a plain trigger stands in for it. */
function DialogHarness({ crop, onUpdated }: { crop: Crop; onUpdated?: () => void }) {
  const controller = usePublicCropUpdate(crop, onUpdated);
  return (
    <>
      <button type="button" onClick={controller.openDiff}>open</button>
      <PublicCropUpdateDialog crop={crop} controller={controller} />
    </>
  );
}

describe('PublicCropUpdateDialog', () => {
  beforeEach(() => {
    apiMocks.publicUpdate.mockReset();
    apiMocks.rejectPublicUpdate.mockReset();
    apiMocks.importToProject.mockReset();
  });

  const openDialog = async (
    update: CropPublicUpdate = varietyRenameUpdate,
    crop: Crop = importedCrop,
  ) => {
    apiMocks.publicUpdate.mockResolvedValue({ data: update });
    const onUpdated = vi.fn();
    render(<DialogHarness crop={crop} onUpdated={onUpdated} />);
    await userEvent.click(screen.getByRole('button', { name: 'open' }));
    await screen.findByText(t.publicUpdate.dialogTitle);
    return onUpdated;
  };

  it('stays closed until it is opened', () => {
    apiMocks.publicUpdate.mockResolvedValue({ data: varietyRenameUpdate });
    render(<DialogHarness crop={importedCrop} />);
    expect(screen.queryByText(t.publicUpdate.dialogTitle)).toBeNull();
  });

  it('calls out a variety rename explicitly instead of as a generic field row', async () => {
    await openDialog();

    expect(screen.getByTestId('crop-public-update-variety-change'))
      .toHaveTextContent('Sortenname geändert: „Nantes“ → „Nantes II“');
    expect(screen.getByText(t.publishWizard.comparison.fields.growth_duration_days)).toBeInTheDocument();
    expect(screen.getByText('80')).toBeInTheDocument();
  });

  it('applies nothing until the user confirms', async () => {
    const onUpdated = await openDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));

    await waitFor(() => expect(screen.queryByText(t.publicUpdate.dialogTitle)).toBeNull());
    expect(apiMocks.importToProject).not.toHaveBeenCalled();
    expect(apiMocks.rejectPublicUpdate).not.toHaveBeenCalled();
    expect(onUpdated).not.toHaveBeenCalled();
  });

  it('applies the update through the shared import/update model once confirmed', async () => {
    apiMocks.importToProject.mockResolvedValue({ data: { operation: 'updated' } });
    const onUpdated = await openDialog();

    await userEvent.click(screen.getByRole('button', { name: t.publicUpdate.apply }));

    await waitFor(() => expect(apiMocks.importToProject).toHaveBeenCalledWith(
      42, 'update', { unpinFields: [], pinFields: [], baseVersion: 2 },
    ));
    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
  });

  it('warns that local edits are replaced when the copy was modified', async () => {
    await openDialog({ ...varietyRenameUpdate, has_local_changes: true });

    expect(screen.getByText(t.importConflictDialog.updateWarning)).toBeInTheDocument();
  });

  it('records a rejection without copying anything into the local crop', async () => {
    apiMocks.rejectPublicUpdate.mockResolvedValue({ data: {} });
    const onUpdated = await openDialog();

    await userEvent.click(screen.getByRole('button', { name: t.publicUpdate.reject }));

    await waitFor(() => expect(apiMocks.rejectPublicUpdate).toHaveBeenCalledWith(7));
    expect(apiMocks.importToProject).not.toHaveBeenCalled();
    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText(t.publicUpdate.dialogTitle)).toBeNull());
  });

  it('lets the user reverse a rejection: the declined version stays applyable', async () => {
    await openDialog(
      { ...varietyRenameUpdate, is_rejected: true },
      { ...importedCrop, public_update_available: false, public_update_rejected: true },
    );

    expect(screen.getByTestId('crop-public-update-rejected-hint')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.publicUpdate.reject })).toBeDisabled();
    expect(screen.getByRole('button', { name: t.publicUpdate.apply })).toBeEnabled();
  });

  describe('locally changed fields', () => {
    const localChangeUpdate: CropPublicUpdate = {
      ...varietyRenameUpdate,
      has_local_changes: true,
      changes: [
        {
          field: 'growth_duration_days', local_value: 75, public_value: 60,
          locally_changed: true, can_keep_local: true,
        },
        {
          field: 'harvest_duration_days', local_value: 30, public_value: 40,
          locally_changed: false, can_keep_local: false,
        },
      ],
    };

    it('offers "Nur lokal behalten" against taking the library value, taking it by default', async () => {
      await openDialog(localChangeUpdate);

      const row = screen.getByTestId('crop-public-update-local-growth_duration_days');
      expect(row).toHaveTextContent('Dein Wert: 75');
      expect(row).toHaveTextContent('Bibliothek: 60');
      expect(screen.getByRole('radio', { name: t.publicUpdate.localChangeTake })).toBeChecked();
      expect(screen.getByRole('radio', { name: t.publicUpdate.localChangeKeep })).not.toBeChecked();
      // A field only the library changed stays a plain row of the table.
      expect(screen.queryByTestId('crop-public-update-local-harvest_duration_days')).not.toBeInTheDocument();
      expect(screen.getByText(t.importConflictDialog.updateWarning)).toBeInTheDocument();
    });

    it('takes the library value for the local change when the user keeps the default', async () => {
      apiMocks.importToProject.mockResolvedValue({ data: { operation: 'updated' } });
      await openDialog(localChangeUpdate);

      await userEvent.click(screen.getByRole('button', { name: t.publicUpdate.apply }));

      await waitFor(() => expect(apiMocks.importToProject).toHaveBeenCalledWith(
        42, 'update', { unpinFields: [], pinFields: [], baseVersion: 2 },
      ));
    });

    it('keeps the local value and pins it with "Nur lokal behalten"', async () => {
      apiMocks.importToProject.mockResolvedValue({ data: { operation: 'updated' } });
      await openDialog(localChangeUpdate);

      await userEvent.click(screen.getByRole('radio', { name: t.publicUpdate.localChangeKeep }));

      // Nothing local is overwritten any more.
      expect(screen.queryByText(t.importConflictDialog.updateWarning)).not.toBeInTheDocument();
      expect(screen.getByTestId('crop-public-update-summary')).toHaveTextContent(
        '1 Wert wird in deine Kultur übernommen, 1 Wert bleibt nur lokal.',
      );
      await userEvent.click(screen.getByRole('button', { name: t.publicUpdate.apply }));

      await waitFor(() => expect(apiMocks.importToProject).toHaveBeenCalledWith(
        42, 'update', { unpinFields: [], pinFields: ['growth_duration_days'], baseVersion: 2 },
      ));
    });

    it('closes without applying when the library moved on since the dialog loaded', async () => {
      apiMocks.importToProject.mockRejectedValue({
        isAxiosError: true,
        response: { status: 409, data: { code: 'stale_public_crop_version' } },
      });
      const onUpdated = await openDialog(localChangeUpdate);

      await userEvent.click(screen.getByRole('button', { name: t.publicUpdate.apply }));

      await waitFor(() => expect(screen.queryByText(t.publicUpdate.dialogTitle)).toBeNull());
      expect(onUpdated).toHaveBeenCalled();
    });
  });

  describe('pinned fields', () => {
    const pinnedUpdate: CropPublicUpdate = {
      ...varietyRenameUpdate,
      changes: [{ field: 'growth_duration_days', local_value: 70, public_value: 80 }],
      pinned_changes: [{
        field: 'harvest_duration_days', local_value: 30, previous_public_value: 20, public_value: 25,
      }],
    };

    it('lists a pinned field the library changed as unchanged, with the library move', async () => {
      await openDialog(pinnedUpdate);

      const block = screen.getByTestId('crop-public-update-pinned');
      expect(block).toHaveTextContent('Lokal fixiert – bleibt unverändert');
      expect(block).toHaveTextContent('Dein Wert: 30');
      expect(block).toHaveTextContent('Bibliothek: 20 → 25');
      expect(screen.getByTestId('crop-public-update-summary')).toHaveTextContent(
        '1 Wert wird in deine Kultur übernommen, 1 fixierter Wert bleibt erhalten.',
      );
    });

    it('keeps pins by default and releases only the ones the user ticks', async () => {
      apiMocks.importToProject.mockResolvedValue({ data: { operation: 'updated' } });
      await openDialog(pinnedUpdate);

      await userEvent.click(screen.getByRole('checkbox', { name: 'Fixierung lösen und 25 übernehmen' }));
      expect(screen.getByTestId('crop-public-update-summary')).toHaveTextContent(
        '2 Werte werden in deine Kultur übernommen.',
      );
      await userEvent.click(screen.getByRole('button', { name: t.publicUpdate.apply }));

      await waitFor(() => expect(apiMocks.importToProject).toHaveBeenCalledWith(
        42, 'update', { unpinFields: ['harvest_duration_days'], pinFields: [], baseVersion: 2 },
      ));
    });

    it('shows no pinned block when no pinned field changed', async () => {
      await openDialog();

      expect(screen.queryByTestId('crop-public-update-pinned')).not.toBeInTheDocument();
      expect(screen.queryByTestId('crop-public-update-summary')).not.toBeInTheDocument();
    });
  });
});
