import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GridColDef } from '@mui/x-data-grid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import FieldsBedsHierarchy from '../pages/FieldsBedsHierarchy';
import { mockT } from './helpers/testI18n';

// Regression coverage for: renaming or creating a row in a sorted
// Anbauflächen table used to immediately re-sort the visible table to the
// new alphabetical/numeric position, making the row the user was just
// editing jump elsewhere. The fix (hierarchyUtils' stable order snapshot)
// only re-sorts on initial load, an explicit sort change, or a reload — not
// as a side effect of a create/rename. See docs/datagrid-architecture.md.

const {
  bedCreateMock,
  bedListMock,
  bedUpdateMock,
  fieldCreateMock,
  fieldListMock,
  fieldUpdateMock,
  locationListMock,
  locationUpdateMock,
  mockUseNavigationBlocker,
  mockDrafts,
} = vi.hoisted(() => ({
  bedCreateMock: vi.fn(),
  bedListMock: vi.fn(),
  bedUpdateMock: vi.fn(),
  fieldCreateMock: vi.fn(),
  fieldListMock: vi.fn(),
  fieldUpdateMock: vi.fn(),
  locationListMock: vi.fn(),
  locationUpdateMock: vi.fn(),
  mockUseNavigationBlocker: vi.fn(),
  mockDrafts: new Map<string, Record<string, unknown>>(),
}));

vi.mock('../i18n', () => ({
  useTranslation: () => ({ t: mockT }),
}));

vi.mock('../commands/useCommandContext', () => ({
  useCommandContextTag: vi.fn(),
  useRegisterCommands: vi.fn(),
}));

vi.mock('../hooks/autosave', () => ({
  useNavigationBlocker: (...args: unknown[]) => mockUseNavigationBlocker(...args),
}));

vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return {
    ...actual,
    bedAPI: {
      create: bedCreateMock,
      delete: vi.fn().mockResolvedValue({ data: {} }),
      list: bedListMock,
      listAll: async () => (await bedListMock()).data,
      update: bedUpdateMock,
    },
    fieldAPI: {
      create: fieldCreateMock,
      delete: vi.fn().mockResolvedValue({ data: {} }),
      list: fieldListMock,
      listAll: async () => (await fieldListMock()).data,
      update: fieldUpdateMock,
    },
    locationAPI: {
      create: vi.fn(),
      delete: vi.fn().mockResolvedValue({ data: {} }),
      list: locationListMock,
      listAll: async () => (await locationListMock()).data,
      update: locationUpdateMock,
    },
  };
});

vi.mock('@mui/x-data-grid', async () => {
  const ReactModule = await import('react');
  const GridRowModes = { Edit: 'edit', View: 'view' };
  const GridRowEditStopReasons = {
    escapeKeyDown: 'escapeKeyDown',
    rowFocusOut: 'rowFocusOut',
  };

  const useGridApiRef = vi.fn(() => ({
    current: {
      getRowWithUpdatedValues: (id: string | number) => mockDrafts.get(String(id)) ?? null,
    },
  }));

  const DataGrid = ({
    apiRef,
    columns,
    isCellEditable,
    onCellClick,
    onProcessRowUpdateError,
    onRowEditStop,
    processRowUpdate,
    rowModesModel,
    rows,
  }: {
    apiRef?: {
      current?: {
        getRowWithUpdatedValues?: (id: string | number, field: string) => unknown;
        stopRowEditMode?: (params: { id: string | number }) => void;
      };
    };
    columns: GridColDef[];
    isCellEditable?: (params: { row: Record<string, unknown>; field: string }) => boolean;
    onCellClick?: (params: { id: string | number; field: string; isEditable: boolean; row: Record<string, unknown> }) => void;
    onProcessRowUpdateError?: (error: Error) => void;
    onRowEditStop?: (params: { id: string | number; reason: string }, event: { defaultMuiPrevented: boolean }) => void;
    processRowUpdate?: (row: Record<string, unknown>) => Promise<Record<string, unknown>>;
    rowModesModel: Record<string, { mode: string; fieldToFocus?: string }>;
    rows: Array<Record<string, unknown> & { id: string | number }>;
  }) => {
    const commitBlur = async (row: Record<string, unknown> & { id: string | number }): Promise<void> => {
      const draft = mockDrafts.get(String(row.id)) ?? row;
      try {
        await processRowUpdate?.(draft);
      } catch (error) {
        onProcessRowUpdateError?.(error as Error);
      }
      onRowEditStop?.({ id: row.id, reason: GridRowEditStopReasons.rowFocusOut }, { defaultMuiPrevented: false });
    };

    ReactModule.useEffect(() => {
      if (!apiRef?.current) {
        return;
      }

      apiRef.current.getRowWithUpdatedValues = (id: string | number) => mockDrafts.get(String(id)) ?? null;
      apiRef.current.stopRowEditMode = ({ id }: { id: string | number }) => {
        const row = rows.find((candidate) => String(candidate.id) === String(id));
        if (row) {
          void commitBlur(row);
        }
      };
    }, [apiRef, commitBlur, rows]);

    return (
      <div data-testid="hierarchy-grid">
        {/* Row order in this list mirrors the order the real DataGrid would render */}
        <ol data-testid="row-order">
          {rows.map((row) => (
            <li data-testid={`order-${row.id}`} key={String(row.id)}>{row.name as string}</li>
          ))}
        </ol>
        {rows.map((row) => {
          const rowMode = rowModesModel[row.id] ?? rowModesModel[String(row.id)];
          const mode = rowMode?.mode ?? GridRowModes.View;
          return (
            <div data-id={String(row.id)} data-testid={`row-${row.id}`} key={String(row.id)} role="row">
              <span data-testid={`mode-${row.id}`}>{mode}</span>
              {columns.map((column) => {
                const editable = Boolean(column.editable) && (isCellEditable?.({ row, field: column.field }) ?? true);
                if (typeof column.renderCell === 'function') {
                  return (
                    <ReactModule.Fragment key={`${row.id}-${column.field}`}>
                      {column.renderCell({
                        api: {},
                        cellMode: mode === GridRowModes.Edit ? 'edit' : 'view',
                        field: column.field,
                        id: row.id,
                        row,
                        value: row[column.field],
                      } as never)}
                    </ReactModule.Fragment>
                  );
                }
                return (
                  <button
                    key={`${row.id}-${column.field}`}
                    type="button"
                    onClick={() => onCellClick?.({ id: row.id, field: column.field, isEditable: editable, row })}
                  >
                    {`Cell ${row.id}-${column.field}`}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  const nameColumn = columns.find((column) => column.field === 'name');
                  const nameEditable = Boolean(nameColumn?.editable) && (isCellEditable?.({ row, field: 'name' }) ?? true);
                  onCellClick?.({ id: row.id, field: 'name', isEditable: nameEditable, row });
                }}
              >
                {`Edit ${row.id}`}
              </button>
              <button
                type="button"
                onClick={() => {
                  // "Aaa" sorts before every other name used in this file's
                  // fixtures, so this deliberately inverts alphabetical
                  // order — a live re-sort would jump the row to the top of
                  // its group; the fix must leave it exactly where it was.
                  mockDrafts.set(String(row.id), { ...row, name: 'Aaa' });
                }}
              >
                {`Rename ${row.id}`}
              </button>
              <button type="button" onClick={() => void commitBlur(row)}>
                {`Blur ${row.id}`}
              </button>
            </div>
          );
        })}
      </div>
    );
  };

  return {
    DataGrid,
    GridRowEditStopReasons,
    GridRowModes,
    useGridApiRef,
  };
});

const renderHierarchy = () => render(
  <MemoryRouter initialEntries={['/app/fields-beds']}>
    <FieldsBedsHierarchy showTitle={false} />
  </MemoryRouter>,
);

const renameRow = async (
  user: ReturnType<typeof userEvent.setup>,
  rowId: string,
  editButtonName: string,
): Promise<void> => {
  await user.click(screen.getByRole('button', { name: editButtonName }));
  await user.click(screen.getByRole('button', { name: `Rename ${rowId}` }));
  await user.click(screen.getByRole('button', { name: `Blur ${rowId}` }));
};

const readOrder = (): string[] =>
  Array.from(document.querySelectorAll('[data-testid="row-order"] li')).map((el) => el.textContent ?? '');

const useMultipleLocations = (): void => {
  locationListMock.mockResolvedValue({
    data: { results: [{ id: 1, name: 'Hofstelle' }, { id: 2, name: 'Nebenstelle' }] },
  });
};

describe('FieldsBedsHierarchy row order stability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDrafts.clear();
    window.sessionStorage.clear();
    // Ascending name sort, matching the "sorted table" scenario from the bug report.
    window.sessionStorage.setItem(
      'tableSort.fieldsBedsHierarchy',
      JSON.stringify([{ field: 'name', sort: 'asc' }]),
    );
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);

    locationListMock.mockResolvedValue({ data: { results: [{ id: 1, name: 'Hofstelle' }] } });
    fieldListMock.mockResolvedValue({
      data: {
        results: [
          { id: 10, name: 'Ackerfeld', location: 1, area_sqm: 20 },
          { id: 11, name: 'Bergfeld', location: 1, area_sqm: 20 },
        ],
      },
    });
    bedListMock.mockResolvedValue({
      data: {
        results: [
          { id: 21, name: 'Beet A', field: 10, area_sqm: 5 },
          { id: 22, name: 'Beet C', field: 10, area_sqm: 5 },
        ],
      },
    });
    fieldUpdateMock.mockImplementation((id: number, data: { name: string; location: number; area_sqm?: number }) =>
      Promise.resolve({ data: { id, area_sqm: 20, ...data } }));
    bedUpdateMock.mockImplementation((id: number, data: { name: string; field: number; area_sqm?: number }) =>
      Promise.resolve({ data: { id, area_sqm: 5, ...data } }));
    locationUpdateMock.mockImplementation((id: number, data: { name: string }) =>
      Promise.resolve({ data: { id, ...data } }));
    bedCreateMock.mockImplementation((data: { name: string; field: number }) => Promise.resolve({
      data: { id: 100 + Number(bedCreateMock.mock.calls.length), ...data },
    }));
    fieldCreateMock.mockImplementation((data: { name: string; location: number }) => Promise.resolve({
      data: { id: 200 + Number(fieldCreateMock.mock.calls.length), ...data },
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // With only 4 total entities (well below HIERARCHY_AUTO_EXPAND_ALL_THRESHOLD),
  // the page auto-expands every row by default, so beds are visible from the
  // start without an explicit expand click.
  const INITIAL_ORDER = ['Ackerfeld', 'Beet A', 'Beet C', 'Bergfeld'];

  it('loads rows sorted by name ascending on initial load', async () => {
    renderHierarchy();

    await waitFor(() => expect(readOrder()).toEqual(INITIAL_ORDER));
  });

  it('keeps a renamed field in place instead of resorting it to the top after save', async () => {
    const user = userEvent.setup();
    renderHierarchy();
    await waitFor(() => expect(readOrder()).toEqual(INITIAL_ORDER));

    // Renaming "Bergfeld" (last) to "Aaa" would sort it first alphabetically
    // under a live re-sort — it must stay last.
    await renameRow(user, 'field-11', 'Edit field-11');

    await waitFor(() => expect(fieldUpdateMock).toHaveBeenCalled());
    expect(readOrder()).toEqual(['Ackerfeld', 'Beet A', 'Beet C', 'Aaa']);
  });

  it('keeps a renamed bed in place within its field even when the new name would sort earlier', async () => {
    const user = userEvent.setup();
    renderHierarchy();
    await waitFor(() => expect(readOrder()).toEqual(INITIAL_ORDER));

    // Renaming "Beet C" (second/last of its group) to "Aaa" would sort it
    // before "Beet A" under a live re-sort — it must stay second.
    await renameRow(user, '22', 'Edit 22');

    await waitFor(() => expect(bedUpdateMock).toHaveBeenCalled());
    expect(readOrder()).toEqual(['Ackerfeld', 'Beet A', 'Aaa', 'Bergfeld']);
  });

  it('inserts a newly created bed as the first child of its group, right next to the "add" action, and keeps it there after saving', async () => {
    const user = userEvent.setup();
    renderHierarchy();
    await waitFor(() => expect(readOrder()).toEqual(INITIAL_ORDER));

    const fieldRow = screen.getByTestId('row-field-10');
    fireEvent.click(within(fieldRow).getByRole('button', { name: 'Beet zu dieser Parzelle hinzufügen' }));
    await waitFor(() => expect(screen.getByTestId('row--1700000000000')).toBeInTheDocument());

    // The new draft (name prefilled from the group's last bed, "Beet C") is
    // expected to render as the first bed under Ackerfeld right away, next
    // to the action that created it — not below the existing beds.
    expect(readOrder()).toEqual(['Ackerfeld', 'Beet C 2', 'Beet A', 'Beet C', 'Bergfeld']);

    await user.click(screen.getByRole('button', { name: 'Rename -1700000000000' }));
    await user.click(screen.getByRole('button', { name: 'Blur -1700000000000' }));

    await waitFor(() => expect(bedCreateMock).toHaveBeenCalled());
    // "Aaa" would sort first alphabetically among beds anyway here, but the
    // point is it stays at its insertion position (first in the group)
    // since the order snapshot wasn't refreshed by the save.
    expect(readOrder()).toEqual(['Ackerfeld', 'Aaa', 'Beet A', 'Beet C', 'Bergfeld']);
  });

  it('inserts a newly created field as the first child of its location', async () => {
    useMultipleLocations();
    let currentFields = [
      { id: 10, name: 'Ackerfeld', location: 1, area_sqm: 20 },
      { id: 11, name: 'Bergfeld', location: 1, area_sqm: 20 },
    ];
    fieldListMock.mockImplementation(() => Promise.resolve({ data: { results: currentFields } }));
    // Creating a field also triggers a silent background refetch
    // (useHierarchyRowUpdate's `fetchData({ showLoading: false })`); keep
    // fieldListMock's fixture in sync so that refetch doesn't drop the row
    // this test just created.
    fieldCreateMock.mockImplementation((data: { name: string; location: number }) => {
      const created = { id: 200 + Number(fieldCreateMock.mock.calls.length), ...data };
      currentFields = [...currentFields, created];
      return Promise.resolve({ data: created });
    });
    const user = userEvent.setup();
    renderHierarchy();
    // "Beet A"/"Beet C" are the default bedListMock fixture, nested under
    // "Ackerfeld" (field 10).
    await waitFor(() => expect(readOrder()).toEqual(
      ['Hofstelle', 'Ackerfeld', 'Beet A', 'Beet C', 'Bergfeld', 'Nebenstelle'],
    ));

    const locationRow = screen.getByTestId('row-location-1');
    fireEvent.click(within(locationRow).getByRole('button', { name: 'Parzelle hinzufügen' }));
    await waitFor(() => expect(screen.getByTestId('row-field--1700000000000')).toBeInTheDocument());

    // The new field renders directly under "Hofstelle", before the
    // existing fields, not appended after "Bergfeld".
    expect(readOrder()).toEqual(
      ['Hofstelle', '', 'Ackerfeld', 'Beet A', 'Beet C', 'Bergfeld', 'Nebenstelle'],
    );

    await user.click(screen.getByRole('button', { name: 'Rename field--1700000000000' }));
    await user.click(screen.getByRole('button', { name: 'Blur field--1700000000000' }));

    await waitFor(() => expect(fieldCreateMock).toHaveBeenCalled());
    expect(readOrder()).toEqual(
      ['Hofstelle', 'Aaa', 'Ackerfeld', 'Beet A', 'Beet C', 'Bergfeld', 'Nebenstelle'],
    );
  });

  it('re-sorts on reload (remount), applying the current sort to the fresh data', async () => {
    fieldUpdateMock.mockResolvedValue({ data: { id: 10, name: 'Zeta', location: 1, area_sqm: 20 } });
    const user = userEvent.setup();
    const { unmount } = renderHierarchy();
    await waitFor(() => expect(readOrder()).toEqual(INITIAL_ORDER));

    await renameRow(user, 'field-10', 'Edit field-10');
    await waitFor(() => expect(fieldUpdateMock).toHaveBeenCalled());
    // Not resorted immediately after save — "Zeta" stays in Ackerfeld's old
    // (first) position together with its beds.
    expect(readOrder()).toEqual(['Zeta', 'Beet A', 'Beet C', 'Bergfeld']);

    fieldListMock.mockResolvedValue({
      data: {
        results: [
          { id: 10, name: 'Zeta', location: 1, area_sqm: 20 },
          { id: 11, name: 'Bergfeld', location: 1, area_sqm: 20 },
        ],
      },
    });
    unmount();
    renderHierarchy();

    // A fresh load re-sorts by the current values: "Bergfeld" now comes
    // first, with "Zeta" and its beds grouped after it.
    await waitFor(() => expect(readOrder()).toEqual(['Bergfeld', 'Zeta', 'Beet A', 'Beet C']));
  });
});
