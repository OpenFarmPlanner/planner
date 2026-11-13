import { fireEvent, render, screen, within } from '@testing-library/react';
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
  confirmedRows: [],
  seedRateConstraints: null,
  ...overrides,
});

describe('CropsImportDialog', () => {
  it('does not report zero entries when preview failed before results were available', () => {
    render(<CropsImportDialog open importState={buildState({
      previewCount: 0, validCount: 0, previewResults: [], payload: [], status: 'error', error: 'Body limit',
    })} hasImportableEntries={false} confirmUpdates={false} onConfirmUpdatesChange={vi.fn()}
    onClose={vi.fn()} onImportStart={vi.fn()} t={t} />);
    expect(screen.getByText('Body limit')).toBeVisible();
    expect(screen.queryByText('import.foundCount')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'import.start' })).toBeDisabled();
  });
  it('lists duplicates separately with source rows and the first-row policy', () => {
    const translate = (key: string, options?: Record<string, unknown>) => {
      if (key === 'import.duplicateRows') return `Duplicate rows (${options?.count})`;
      if (key === 'import.duplicateRow') return `Row ${options?.row} duplicates row ${options?.firstRow}`;
      return key;
    };
    render(
      <CropsImportDialog
        open
        importState={buildState({
          previewCount: 3,
          validCount: 3,
          previewResults: [
            { index: 0, status: 'create', import_data: { name: 'Carrot' } },
            { index: 1, status: 'duplicate', duplicate_of_index: 0,
              row_number: 12, duplicate_of_row_number: 5, import_data: { name: 'Carrot' } },
            { index: 2, status: 'duplicate', duplicate_of_index: 0, import_data: { name: 'Carrot' } },
          ],
        })}
        hasImportableEntries
        confirmUpdates={false}
        onConfirmUpdatesChange={vi.fn()}
        onClose={vi.fn()}
        onImportStart={vi.fn()}
        t={translate}
      />,
    );
    expect(screen.getByText('import.newCrops (1)')).toBeInTheDocument();
    const section = screen.getByText('Duplicate rows (2)').parentElement!;
    expect(within(section).getAllByRole('listitem')).toHaveLength(2);
    expect(within(section).getByText('Row 12 duplicates row 5')).toBeInTheDocument();
    expect(within(section).getByText('Row 3 duplicates row 1')).toBeInTheDocument();
    expect(screen.getByText('import.duplicatePolicy')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

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

  it('shows that the import is running and locks both buttons meanwhile', () => {
    render(
      <CropsImportDialog
        open
        importState={buildState({ status: 'uploading' })}
        hasImportableEntries
        confirmUpdates={false}
        onConfirmUpdatesChange={vi.fn()}
        onClose={vi.fn()}
        onImportStart={vi.fn()}
        t={t}
      />,
    );

    expect(screen.getByRole('button', { name: 'import.importing' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'import.close' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'import.start' })).not.toBeInTheDocument();
    // The preview stays visible while the import runs.
    expect(screen.getByText('import.newCrops (1)')).toBeInTheDocument();
  });

  it('offers a retry with the same entries after a failed import', () => {
    const onImportStart = vi.fn();
    render(
      <CropsImportDialog
        open
        importState={buildState({ status: 'error', error: 'import.errors.network' })}
        hasImportableEntries
        confirmUpdates={false}
        onConfirmUpdatesChange={vi.fn()}
        onClose={vi.fn()}
        onImportStart={onImportStart}
        t={t}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('import.errors.network');
    expect(screen.getByText('import.newCrops (1)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'import.start' }));
    expect(onImportStart).toHaveBeenCalledTimes(1);
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

  it('offers only "close" once the import has a result, with the result above the list', () => {
    render(
      <CropsImportDialog
        open
        importState={buildState({
          status: 'error',
          error: 'import.errors.someFailures',
          success: 'import.created',
          failedEntries: [{ index: 0, name: 'Senf', error: 'boom' }],
        })}
        hasImportableEntries
        confirmUpdates={false}
        onConfirmUpdatesChange={vi.fn()}
        onClose={vi.fn()}
        onImportStart={vi.fn()}
        t={t}
      />,
    );

    expect(screen.queryByRole('button', { name: 'import.start' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'import.close' })).toBeEnabled();
    const alert = screen.getByText('import.errors.someFailures');
    const list = screen.getByText('import.newCrops', { exact: false });
    expect(alert.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('explains a fractional seeds-per-plant value with the crop form\'s rule', () => {
    render(
      <CropsImportDialog
        open
        importState={buildState({
          status: 'error',
          failedEntries: [{
            index: 0,
            name: 'Gurke',
            error: { seed_rate_pre_cultivation_value: ['Seed rate value must be a whole number for this unit.'] },
            importData: { name: 'Gurke', seed_rate_pre_cultivation_value: 1.2, seed_rate_pre_cultivation_unit: 'seeds_per_plant' },
          }],
          seedRateConstraints: { seeds_per_plant: { value_type: 'integer', step: 1, minimum: 1 } },
        })}
        hasImportableEntries={false}
        confirmUpdates={false}
        onConfirmUpdatesChange={vi.fn()}
        onClose={vi.fn()}
        onImportStart={vi.fn()}
        t={t}
      />,
    );

    expect(screen.getByText('Pflanzung: Menge: Die Menge muss für diese Einheit eine ganze Zahl sein.')).toBeInTheDocument();
  });

  it('shows a color change as swatches next to the codes', () => {
    render(
      <CropsImportDialog
        open
        importState={buildState({
          previewResults: [{
            index: 0,
            status: 'update_candidate',
            import_data: { name: 'Tomate' },
            diff: [{ field: 'display_color', current: '#b91c1c', new: 'rot' }],
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

    const line = screen.getByText(/Anzeigefarbe:/);
    expect(line).toHaveTextContent('Anzeigefarbe: #b91c1c → rot');
    const swatches = line.querySelectorAll('[aria-hidden="true"]');
    // Only the valid code gets a swatch; "rot" is shown as text alone.
    expect(swatches).toHaveLength(1);
    expect(swatches[0]).toHaveStyle({ backgroundColor: '#b91c1c' });
  });
});

it.each([
  ['de', 'Mitte April bis Ende April'],
  ['en', 'mid April to late April'],
  ['fr', 'mi-avril à fin avril'],
  ['es', 'mediados de abril a finales de abril'],
])('previews parsed shorthand in long form in %s', async (language, expected) => {
  const { default: i18n } = await import('../i18n/config');
  const originalLanguage = i18n.language;
  await i18n.changeLanguage(language);
  try {
    render(<CropsImportDialog
      open
      importState={buildState({ previewResults: [{ index: 0, status: 'create', import_data: {
        name: 'Carrot',
        timing_windows: [{ kind: 'direct_sowing', unit: 'decade', start_month: 4,
          start_decade: 'mid', end_month: 4, end_decade: 'late' }],
      } }] })}
      hasImportableEntries
      confirmUpdates={false}
      onConfirmUpdatesChange={vi.fn()}
      onClose={vi.fn()}
      onImportStart={vi.fn()}
      t={i18n.getFixedT(language, 'crops')}
    />);
    expect(screen.getByText(expected, { exact: false })).toBeInTheDocument();
    expect(screen.queryByText('04b-04c')).not.toBeInTheDocument();
  } finally {
    await i18n.changeLanguage(originalLanguage);
  }
});
