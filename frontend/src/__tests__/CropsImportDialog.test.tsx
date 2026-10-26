import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CropsImportDialog } from '../pages/CropsImportDialog';
import type { CropImportState } from '../pages/useCropImportState';

const t = (key: string): string => key;

const buildState = (overrides: Partial<CropImportState>): CropImportState => ({
  previewCount: 1,
  validCount: 1,
  invalidEntries: [],
  payload: [{ name: 'Carrot' }],
  previewResults: [{ index: 0, status: 'create', import_data: { name: 'Carrot' } }],
  status: 'ready',
  error: null,
  success: null,
  failedEntries: [],
  ...overrides,
});

describe('CropsImportDialog', () => {
  it('disables import start when entries are not importable', () => {
    render(
      <CropsImportDialog
        open
        importState={buildState({ validCount: 0, payload: [] })}
        hasImportableEntries={false}
        confirmUpdates={false}
        onConfirmUpdatesChange={vi.fn()}
        onClose={vi.fn()}
        onImportStart={vi.fn()}
        t={t}
      />,
    );

    expect(screen.getByRole('button', { name: 'import.start' })).toBeDisabled();
  });

  it('propagates update-confirmation checkbox changes', () => {
    const onConfirmUpdatesChange = vi.fn();

    render(
      <CropsImportDialog
        open
        importState={buildState({
          previewResults: [{
            index: 0,
            status: 'update_candidate',
            import_data: { name: 'Carrot' },
            diff: [{ field: 'notes', current: 'old', new: 'new' }],
          }],
        })}
        hasImportableEntries
        confirmUpdates={false}
        onConfirmUpdatesChange={onConfirmUpdatesChange}
        onClose={vi.fn()}
        onImportStart={vi.fn()}
        t={t}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox'));

    expect(onConfirmUpdatesChange).toHaveBeenCalledWith(true);
  });

  it('shows changed fields and values with their labels, not raw API values', () => {
    render(
      <CropsImportDialog
        open
        importState={buildState({
          previewResults: [{
            index: 0,
            status: 'update_candidate',
            import_data: { name: 'Buschbohne' },
            diff: [
              { field: 'nutrient_demand', current: 'medium', new: 'low' },
              { field: 'expected_yield', current: '1.30', new: 1.2 },
              { field: 'row_spacing_cm', current: 50, new: 40 },
            ],
          }],
        })}
        hasImportableEntries
        confirmUpdates={false}
        onConfirmUpdatesChange={vi.fn()}
        onClose={vi.fn()}
        onImportStart={vi.fn()}
        t={t}
      />,
    );

    expect(screen.getByText('Nährstoffbedarf: Mittelzehrer → Schwachzehrer')).toBeInTheDocument();
    expect(screen.getByText(/: 1,3 kg → 1,2 kg$/)).toBeInTheDocument();
    expect(screen.getByText(/\(cm\): 50 → 40$/)).toBeInTheDocument();
    expect(screen.queryByText(/nutrient_demand/)).not.toBeInTheDocument();
  });

  it('names the rejected field and value instead of the raw validation payload', () => {
    render(
      <CropsImportDialog
        open
        importState={buildState({
          status: 'error',
          failedEntries: [
            {
              index: 0,
              name: 'Brokkoli',
              error: { nutrient_demand: ['"Sehr hoch" is not a valid choice.'] },
              importData: { name: 'Brokkoli', nutrient_demand: 'Sehr hoch' },
            },
            { index: 1, name: 'Senf', error: 'Unexpected failure' },
          ],
        })}
        hasImportableEntries={false}
        confirmUpdates={false}
        onConfirmUpdatesChange={vi.fn()}
        onClose={vi.fn()}
        onImportStart={vi.fn()}
        t={t}
      />,
    );

    expect(screen.getByText('Nährstoffbedarf: „Sehr hoch“ ist kein gültiger Wert')).toBeInTheDocument();
    expect(screen.getByText('Dieser Eintrag konnte nicht gespeichert werden.')).toBeInTheDocument();
    expect(screen.queryByText(/is not a valid choice/)).not.toBeInTheDocument();
  });
});
