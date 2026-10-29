import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GridColDef } from '@mui/x-data-grid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import FieldsBedsHierarchy from '../pages/FieldsBedsHierarchy';
import {
  isCompletelyEmptyNewHierarchyRow,
  isPartiallyFilledNamelessNewHierarchyRow,
} from '../components/hierarchy/utils/hierarchyRowDraft';
import { hasPersistedEntityId } from '../components/hierarchy/utils/hierarchyUtils';
import { mockT } from './helpers/testI18n';

const {
  bedBulkCreateMock,
  bedCreateMock,
  bedDeleteMock,
  bedListMock,
  bedUpdateMock,
  fieldCreateMock,
  fieldDeleteMock,
  fieldDuplicateMock,
  fieldListMock,
  fieldUpdateMock,
  locationCreateMock,
  locationDeleteMock,
  locationListMock,
  locationUpdateMock,
  mockUseNavigationBlocker,
  mockDrafts,
} = vi.hoisted(() => ({
  bedBulkCreateMock: vi.fn(),
  bedCreateMock: vi.fn(),
  bedDeleteMock: vi.fn(),
  bedListMock: vi.fn(),
  bedUpdateMock: vi.fn(),
  fieldCreateMock: vi.fn(),
  fieldDeleteMock: vi.fn(),
  fieldDuplicateMock: vi.fn(),
  fieldListMock: vi.fn(),
  fieldUpdateMock: vi.fn(),
  locationCreateMock: vi.fn(),
  locationDeleteMock: vi.fn(),
  locationListMock: vi.fn(),
  locationUpdateMock: vi.fn(),
  mockUseNavigationBlocker: vi.fn(),
  mockDrafts: new Map<string, Record<string, unknown>>(),
}));

vi.mock('../i18n', () => ({
  useTranslation: () => ({ t: mockT }),
}));

vi.mock('../components/data-grid/RichTextEditor', () => ({
  RichTextEditor: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <textarea
      aria-label="notes"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
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
      bulkCreate: bedBulkCreateMock,
      create: bedCreateMock,
      delete: bedDeleteMock,
      list: bedListMock,
      // listAll mirrors whatever list() is mocked to resolve, unwrapped —
      // useHierarchyData uses listAll (not list) to fetch every page.
      listAll: async () => (await bedListMock()).data,
      update: bedUpdateMock,
    },
    fieldAPI: {
      create: fieldCreateMock,
      delete: fieldDeleteMock,
      duplicate: fieldDuplicateMock,
      list: fieldListMock,
      listAll: async () => (await fieldListMock()).data,
      update: fieldUpdateMock,
    },
    locationAPI: {
      create: locationCreateMock,
      delete: locationDeleteMock,
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
    onCellDoubleClick,
    onCellKeyDown,
    onProcessRowUpdateError,
    onRowEditStop,
    processRowUpdate,
    rowModesModel,
    rows,
  }: {
    apiRef?: {
      current?: {
        getCellParams?: (id: string | number, field: string) => unknown;
        getRowWithUpdatedValues?: (id: string | number, field: string) => unknown;
        isCellEditable?: (params: unknown) => boolean;
        stopRowEditMode?: (params: { id: string | number }) => void;
      };
    };
    columns: GridColDef[];
    isCellEditable?: (params: { row: Record<string, unknown>; field: string }) => boolean;
    onCellClick?: (params: { id: string | number; field: string; isEditable: boolean; row: Record<string, unknown> }) => void;
    onCellDoubleClick?: (
      params: { id: string | number; field: string; isEditable: boolean; row: Record<string, unknown> },
      event: React.MouseEvent,
    ) => void;
    onCellKeyDown?: (params: { id: string | number; field: string; isEditable: boolean; row: Record<string, unknown> }, event: React.KeyboardEvent) => void;
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
      apiRef.current.getCellParams = (id: string | number, field: string) => {
        const row = rows.find((candidate) => String(candidate.id) === String(id));
        return row ? { id: row.id, field, row } : null;
      };
      apiRef.current.isCellEditable = (params: unknown) => {
        const cellParams = params as { field: string; row: Record<string, unknown> };
        return isCellEditable?.(cellParams) ?? true;
      };
      // Mirrors MUI's real stopRowEditMode: forces the same commit path the
      // "Blur"/"Enter" test buttons use, since production code relies on this
      // to actually save a row when focus leaves the grid entirely.
      apiRef.current.stopRowEditMode = ({ id }: { id: string | number }) => {
        const row = rows.find((candidate) => String(candidate.id) === String(id));
        if (row) {
          void commitBlur(row);
        }
      };
    }, [apiRef, commitBlur, rows]);

    return (
      <div data-testid="hierarchy-grid">
        <div data-testid="row-count">{rows.length}</div>
        {rows.map((row) => {
          const rowMode = rowModesModel[row.id] ?? rowModesModel[String(row.id)];
          const mode = rowMode?.mode ?? GridRowModes.View;
          return (
            <div data-id={String(row.id)} data-testid={`row-${row.id}`} key={String(row.id)} role="row">
              <span data-testid={`mode-${row.id}`}>{mode}</span>
              <span data-testid={`focus-field-${row.id}`}>{rowMode?.fieldToFocus ?? ''}</span>
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
                onClick={(event) => {
                  // Stands for a double click: the click that selects, then the edit start.
                  const nameColumn = columns.find((column) => column.field === 'name');
                  const nameEditable = Boolean(nameColumn?.editable) && (isCellEditable?.({ row, field: 'name' }) ?? true);
                  const params = { id: row.id, field: 'name', isEditable: nameEditable, row };
                  onCellClick?.(params);
                  onCellDoubleClick?.(params, event);
                }}
              >
                {`Edit ${row.id}`}
              </button>
              <div data-field="length_m" role="gridcell">
                <button
                  type="button"
                  onClick={(event) => {
                    const lengthColumn = columns.find((column) => column.field === 'length_m');
                    const lengthEditable = Boolean(lengthColumn?.editable) && (isCellEditable?.({ row, field: 'length_m' }) ?? true);
                    const params = { id: row.id, field: 'length_m', isEditable: lengthEditable, row };
                    onCellClick?.(params);
                    onCellDoubleClick?.(params, event);
                  }}
                >
                  {`Edit length ${row.id}`}
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  mockDrafts.set(String(row.id), { ...row, name: 'Teilweise gefuellt' });
                }}
              >
                {`Partial name ${row.id}`}
              </button>
              <button
                type="button"
                onClick={() => {
                  mockDrafts.set(String(row.id), { ...row, name: '', length_m: 2 });
                }}
              >
                {`Partial invalid ${row.id}`}
              </button>
              <button
                type="button"
                onClick={() =>
                  onCellKeyDown?.(
                    { id: row.id, field: 'name', isEditable: true, row },
                    { key: 'Escape', preventDefault: vi.fn(), defaultMuiPrevented: false } as unknown as React.KeyboardEvent,
                  )
                }
              >
                {`Escape ${row.id}`}
              </button>
              <button type="button" onClick={() => void commitBlur(row)}>
                {`Blur ${row.id}`}
              </button>
              <button type="button" onClick={() => void commitBlur(row)}>
                {`Enter ${row.id}`}
              </button>
              <button
                type="button"
                onClick={() =>
                  onCellKeyDown?.(
                    { id: row.id, field: 'name', isEditable: true, row },
                    {
                      key: 'Tab',
                      preventDefault: vi.fn(),
                      stopPropagation: vi.fn(),
                      defaultMuiPrevented: false,
                      altKey: false,
                      ctrlKey: false,
                      metaKey: false,
                      shiftKey: false,
                    } as unknown as React.KeyboardEvent,
                  )
                }
              >
                {`Tab from name ${row.id}`}
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

const renderHierarchy = (initialPath = '/app/fields-beds') => (
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <FieldsBedsHierarchy showTitle={false} />
    </MemoryRouter>,
  )
);

const renderHierarchyWithCreateFieldRequest = (
  createFieldRequest: number,
  onCreateFieldRequestHandled = vi.fn(),
) => render(
  <MemoryRouter initialEntries={['/app/fields-beds']}>
    <FieldsBedsHierarchy
      showTitle={false}
      createFieldRequest={createFieldRequest}
      onCreateFieldRequestHandled={onCreateFieldRequestHandled}
    />
  </MemoryRouter>,
);

const addNewBed = async (): Promise<void> => {
  fireEvent.click(await screen.findByRole('button', { name: 'Beet zu dieser Parzelle hinzufügen' }));
  await waitFor(() => expect(screen.getByTestId('row--1700000000000')).toBeInTheDocument());
  await waitFor(() => expect(screen.getByTestId('mode--1700000000000')).toHaveTextContent('edit'));
};

const deleteRowViaContextMenu = (row: HTMLElement): void => {
  fireEvent.contextMenu(row);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Löschen' }));
};

const useMultipleLocations = (): void => {
  locationListMock.mockResolvedValue({
    data: {
      results: [
        { id: 1, name: 'Hofstelle' },
        { id: 2, name: 'Außenfläche' },
      ],
    },
  });
};

describe('FieldsBedsHierarchy edit cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDrafts.clear();
    window.sessionStorage.clear();
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    locationListMock.mockResolvedValue({ data: { results: [{ id: 1, name: 'Hofstelle' }] } });
    fieldListMock.mockResolvedValue({ data: { results: [{ id: 10, name: 'Nordfeld', location: 1, area_sqm: 20 }] } });
    bedListMock.mockResolvedValue({ data: { results: [] } });
    bedDeleteMock.mockResolvedValue({ data: {} });
    bedCreateMock.mockImplementation((data: { name: string; field: number }) => Promise.resolve({
      data: { id: 100 + Number(bedCreateMock.mock.calls.length), ...data },
    }));
    fieldDeleteMock.mockResolvedValue({ data: {} });
    fieldCreateMock.mockImplementation((data: { name: string; location: number }) => Promise.resolve({
      data: { id: 200 + Number(fieldCreateMock.mock.calls.length), ...data },
    }));
    locationDeleteMock.mockResolvedValue({ data: {} });
    locationCreateMock.mockImplementation((data: { name: string }) => Promise.resolve({
      data: { id: 300 + Number(locationCreateMock.mock.calls.length), ...data },
    }));
    fieldUpdateMock.mockResolvedValue({ data: { id: 10, name: 'Nordfeld', location: 1, area_sqm: 20 } });
    bedUpdateMock.mockResolvedValue({ data: { id: 21, name: 'Beet A', field: 10, area_sqm: 10 } });
    locationUpdateMock.mockResolvedValue({ data: { id: 1, name: 'Hofstelle umbenannt' } });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('detects completely empty new hierarchy rows', () => {
    expect(isCompletelyEmptyNewHierarchyRow({ id: -1, type: 'bed', level: 1, isNew: true, name: '', field: 10 })).toBe(true);
    expect(isCompletelyEmptyNewHierarchyRow({ id: -1, type: 'bed', level: 1, isNew: true, name: '', field: 10, length_m: 2 })).toBe(false);
    expect(isPartiallyFilledNamelessNewHierarchyRow({ id: -1, type: 'bed', level: 1, isNew: true, name: '', field: 10, length_m: 2 })).toBe(true);
  });

  it('recognizes only positive integer hierarchy IDs as persisted', () => {
    expect(hasPersistedEntityId(1)).toBe(true);
    expect(hasPersistedEntityId(-1)).toBe(false);
    expect(hasPersistedEntityId(0)).toBe(false);
    expect(hasPersistedEntityId(undefined)).toBe(false);
  });

  it('renders location rows when multiple locations exist without parcels', async () => {
    useMultipleLocations();
    fieldListMock.mockResolvedValue({ data: { results: [] } });
    bedListMock.mockResolvedValue({ data: { results: [] } });

    renderHierarchy();

    expect(await screen.findByTestId('row-location-1')).toBeInTheDocument();
    expect(screen.getByTestId('row-location-2')).toBeInTheDocument();
    expect(screen.getByTestId('row-count')).toHaveTextContent('2');
  });

  it('creates exactly one editable parcel row for one create request', async () => {
    fieldListMock.mockResolvedValue({ data: { results: [] } });
    const onCreateFieldRequestHandled = vi.fn();
    const { rerender } = renderHierarchyWithCreateFieldRequest(1, onCreateFieldRequestHandled);

    await waitFor(() => expect(screen.getByTestId('row-field--1700000000000')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('mode-field--1700000000000')).toHaveTextContent('edit'));
    expect(screen.getByTestId('row-count')).toHaveTextContent('1');
    expect(onCreateFieldRequestHandled).toHaveBeenCalledTimes(1);

    rerender(
      <MemoryRouter initialEntries={['/app/fields-beds']}>
        <FieldsBedsHierarchy
          showTitle={false}
          createFieldRequest={1}
          onCreateFieldRequestHandled={onCreateFieldRequestHandled}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('row-count')).toHaveTextContent('1');
    expect(screen.getAllByRole('row')).toHaveLength(1);
  });

  it('discards a completely empty new parcel row on blur without showing a validation error', async () => {
    fieldListMock.mockResolvedValue({ data: { results: [] } });
    renderHierarchyWithCreateFieldRequest(1);

    await waitFor(() => expect(screen.getByTestId('row-field--1700000000000')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Blur field--1700000000000' }));

    await waitFor(() => expect(screen.queryByTestId('row-field--1700000000000')).not.toBeInTheDocument());
    expect(screen.queryByText('Name ist ein Pflichtfeld')).not.toBeInTheDocument();
    expect(fieldCreateMock).not.toHaveBeenCalled();
  });

  it('enters inline edit mode when a Standort name is double-clicked', async () => {
    const user = userEvent.setup();
    useMultipleLocations();
    renderHierarchy();

    await user.click(await screen.findByRole('button', { name: 'Edit location-1' }));

    expect(screen.getByTestId('mode-location-1')).toHaveTextContent('edit');
  });

  it('cancels inline Standort editing with Escape without saving', async () => {
    const user = userEvent.setup();
    useMultipleLocations();
    renderHierarchy();

    await user.click(await screen.findByRole('button', { name: 'Edit location-1' }));
    await user.click(screen.getByRole('button', { name: 'Escape location-1' }));

    expect(screen.getByTestId('mode-location-1')).toHaveTextContent('view');
    expect(locationUpdateMock).not.toHaveBeenCalled();
  });

  it('saves inline Standort name edits through the shared row update flow', async () => {
    const user = userEvent.setup();
    useMultipleLocations();
    renderHierarchy();

    await user.click(await screen.findByRole('button', { name: 'Edit location-1' }));
    await user.click(screen.getByRole('button', { name: 'Partial name location-1' }));
    await user.click(screen.getByRole('button', { name: 'Enter location-1' }));

    await waitFor(() => {
      expect(locationUpdateMock).toHaveBeenCalledWith(1, expect.objectContaining({ name: 'Teilweise gefuellt' }));
    });
  });

  it('keeps Standort name validation consistent with other hierarchy rows', async () => {
    const user = userEvent.setup();
    useMultipleLocations();
    renderHierarchy();

    await user.click(await screen.findByRole('button', { name: 'Edit location-1' }));
    await user.click(screen.getByRole('button', { name: 'Partial invalid location-1' }));
    await user.click(screen.getByRole('button', { name: 'Blur location-1' }));

    expect(await screen.findByText('Name ist ein Pflichtfeld')).toBeInTheDocument();
    expect(locationUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects duplicate field names within the same location before saving', async () => {
    const user = userEvent.setup();
    fieldListMock.mockResolvedValue({
      data: {
        results: [
          { id: 10, name: 'Teilweise gefuellt', location: 1, area_sqm: 20 },
          { id: 11, name: 'Suedfeld', location: 1, area_sqm: 20 },
        ],
      },
    });
    renderHierarchy();

    await user.click(await screen.findByRole('button', { name: 'Edit field-11' }));
    await user.click(screen.getByRole('button', { name: 'Partial name field-11' }));
    await user.click(screen.getByRole('button', { name: 'Enter field-11' }));

    expect(await screen.findByText('Eine Parzelle mit diesem Namen existiert in diesem Standort bereits.')).toBeInTheDocument();
    expect(fieldUpdateMock).not.toHaveBeenCalled();
  });

  it('reverts a stale row to view instead of leaving two rows editable when a cross-row save is rejected', async () => {
    const user = userEvent.setup();
    fieldListMock.mockResolvedValue({
      data: {
        results: [
          { id: 10, name: 'Teilweise gefuellt', location: 1, area_sqm: 20 },
          { id: 11, name: 'Suedfeld', location: 1, area_sqm: 20 },
        ],
      },
    });
    renderHierarchy();

    await user.click(await screen.findByRole('button', { name: 'Edit field-11' }));
    await user.click(screen.getByRole('button', { name: 'Partial name field-11' }));

    // Click into a DIFFERENT row before field-11's (invalid, duplicate-name)
    // save comes back - this is the async stopRowEditMode race: field-10
    // enters edit mode synchronously while field-11's rejected save resolves
    // later.
    await user.click(screen.getByRole('button', { name: 'Edit field-10' }));

    expect(await screen.findByText('Eine Parzelle mit diesem Namen existiert in diesem Standort bereits.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('mode-field-11')).toHaveTextContent('view'));
    expect(screen.getByTestId('mode-field-10')).toHaveTextContent('edit');
    expect(fieldUpdateMock).not.toHaveBeenCalled();
  });

  it('shows the unsaved-row dialog when clicking into a different row on a partially filled new bed', async () => {
    const user = userEvent.setup();
    renderHierarchy();
    await addNewBed();

    await user.click(screen.getByRole('button', { name: 'Partial invalid -1700000000000' }));

    // Click into a DIFFERENT, existing row - not a click outside the grid,
    // but MUI's own row-to-row edit switch (stopRowEditMode).
    await user.click(screen.getByRole('button', { name: 'Edit field-10' }));

    expect(await screen.findByText('Zeile nicht gespeichert')).toBeInTheDocument();
    expect(screen.getByText('Name ist ein Pflichtfeld. Ohne Namen kann diese Zeile nicht gespeichert werden.')).toBeInTheDocument();
    expect(screen.getByTestId('row--1700000000000')).toBeInTheDocument();
    expect(bedCreateMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Verwerfen' }));

    await waitFor(() => expect(screen.queryByTestId('row--1700000000000')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText('Zeile nicht gespeichert')).not.toBeInTheDocument());
  });

  it('rejects duplicate bed names within the same field before saving', async () => {
    const user = userEvent.setup();
    bedListMock.mockResolvedValue({
      data: {
        results: [
          { id: 21, name: 'Teilweise gefuellt', field: 10, area_sqm: 5 },
          { id: 22, name: 'Beet B', field: 10, area_sqm: 5 },
        ],
      },
    });
    renderHierarchy();

    await user.click(await screen.findByRole('button', { name: 'Edit 22' }));
    await user.click(screen.getByRole('button', { name: 'Partial name 22' }));
    await user.click(screen.getByRole('button', { name: 'Enter 22' }));

    expect(await screen.findByText('Ein Beet mit diesem Namen existiert in dieser Parzelle bereits.')).toBeInTheDocument();
    expect(bedUpdateMock).not.toHaveBeenCalled();
  });

  it('cancels editing on an existing row with Escape without deleting data', async () => {
    const user = userEvent.setup();
    renderHierarchy();

    await user.click(await screen.findByRole('button', { name: 'Edit field-10' }));
    expect(screen.getByTestId('mode-field-10')).toHaveTextContent('edit');

    await user.click(screen.getByRole('button', { name: 'Escape field-10' }));

    expect(screen.getByTestId('mode-field-10')).toHaveTextContent('view');
    expect(fieldDeleteMock).not.toHaveBeenCalled();
    expect(screen.getByText('Nordfeld')).toBeInTheDocument();
  });

  it('cancels editing on an existing row when clicking outside without deleting data', async () => {
    const user = userEvent.setup();
    renderHierarchy();

    await user.click(await screen.findByRole('button', { name: 'Edit field-10' }));
    fireEvent.mouseDown(document.body);

    // Clicking outside now commits via the same async processRowUpdate path as a
    // real blur, instead of synchronously discarding, so the mode change lags
    // behind the (mocked) API response.
    await waitFor(() => expect(screen.getByTestId('mode-field-10')).toHaveTextContent('view'));
    expect(fieldDeleteMock).not.toHaveBeenCalled();
    expect(screen.getByText('Nordfeld')).toBeInTheDocument();
  });

  it('removes a completely empty newly created row with Escape', async () => {
    const user = userEvent.setup();
    renderHierarchy();
    await addNewBed();

    await user.click(screen.getByRole('button', { name: 'Escape -1700000000000' }));

    await waitFor(() => expect(screen.queryByTestId('row--1700000000000')).not.toBeInTheDocument());
    expect(screen.queryByText('Zeile wurde nicht gespeichert, da der Name fehlt.')).not.toBeInTheDocument();
  });

  it('removes an untouched prefilled new bed with Escape, like an empty one', async () => {
    const user = userEvent.setup();
    bedListMock.mockResolvedValue({
      data: { results: [{ id: 21, name: 'E 1', field: 10, length_m: 10, width_m: 0.75 }] },
    });
    renderHierarchy();
    await screen.findByTestId('row-21');
    await addNewBed();

    await user.click(screen.getByRole('button', { name: 'Escape -1700000000000' }));

    await waitFor(() => expect(screen.queryByTestId('row--1700000000000')).not.toBeInTheDocument());
    expect(bedCreateMock).not.toHaveBeenCalled();
  });

  it('keeps an edited prefilled new bed as a draft on Escape', async () => {
    const user = userEvent.setup();
    bedListMock.mockResolvedValue({
      data: { results: [{ id: 21, name: 'E 1', field: 10, length_m: 10, width_m: 0.75 }] },
    });
    renderHierarchy();
    await screen.findByTestId('row-21');
    await addNewBed();

    await user.click(screen.getByRole('button', { name: 'Partial name -1700000000000' }));
    await user.click(screen.getByRole('button', { name: 'Escape -1700000000000' }));

    await waitFor(() => expect(screen.getByTestId('mode--1700000000000')).toHaveTextContent('view'));
    expect(screen.getByTestId('row--1700000000000')).toBeInTheDocument();
  });

  it('discards a completely empty new row on blur without showing a validation error', async () => {
    renderHierarchy();
    await addNewBed();

    fireEvent.click(screen.getByRole('button', { name: 'Blur -1700000000000' }));

    await waitFor(() => expect(screen.queryByTestId('row--1700000000000')).not.toBeInTheDocument());
    expect(screen.queryByText('Name ist ein Pflichtfeld')).not.toBeInTheDocument();
    expect(screen.queryByText('Zeile wurde nicht gespeichert, da der Name fehlt.')).not.toBeInTheDocument();
    expect(bedCreateMock).not.toHaveBeenCalled();
  });

  it('opens the unsaved-row dialog when a partially filled new row is blurred without a name', async () => {
    const user = userEvent.setup();
    renderHierarchy();
    await addNewBed();

    await user.click(screen.getByRole('button', { name: 'Partial invalid -1700000000000' }));
    await user.click(screen.getByRole('button', { name: 'Blur -1700000000000' }));

    expect(await screen.findByText('Zeile nicht gespeichert')).toBeInTheDocument();
    expect(screen.getByText('Name ist ein Pflichtfeld. Ohne Namen kann diese Zeile nicht gespeichert werden.')).toBeInTheDocument();
    expect(screen.getByTestId('row--1700000000000')).toBeInTheDocument();
    // The row cleanly exits edit mode before the dialog opens (avoids an
    // input fighting the dialog's focus trap) - "Weiter bearbeiten" resumes
    // editing with the typed values intact.
    expect(screen.getByTestId('mode--1700000000000')).toHaveTextContent('view');
    expect(bedCreateMock).not.toHaveBeenCalled();
  });

  it('saves the row once a name is filled in after continuing from the unsaved-row dialog', async () => {
    const user = userEvent.setup();
    renderHierarchy();
    await addNewBed();

    await user.click(screen.getByRole('button', { name: 'Partial invalid -1700000000000' }));
    await user.click(screen.getByRole('button', { name: 'Blur -1700000000000' }));
    await user.click(await screen.findByRole('button', { name: 'Weiter bearbeiten' }));
    await waitFor(() => expect(screen.queryByText('Zeile nicht gespeichert')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Partial name -1700000000000' }));
    await user.click(screen.getByRole('button', { name: 'Blur -1700000000000' }));

    await waitFor(() => expect(bedCreateMock).toHaveBeenCalled());
    expect(screen.queryByText('Zeile nicht gespeichert')).not.toBeInTheDocument();
  });

  it('removes the row when discarding it from the dialog opened by blurring without a name', async () => {
    const user = userEvent.setup();
    renderHierarchy();
    await addNewBed();

    await user.click(screen.getByRole('button', { name: 'Partial invalid -1700000000000' }));
    await user.click(screen.getByRole('button', { name: 'Blur -1700000000000' }));
    await user.click(await screen.findByRole('button', { name: 'Verwerfen' }));

    await waitFor(() => expect(screen.queryByTestId('row--1700000000000')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText('Zeile nicht gespeichert')).not.toBeInTheDocument());
    expect(bedCreateMock).not.toHaveBeenCalled();
  });

  it('keeps a partially filled new row available after Escape', async () => {
    const user = userEvent.setup();
    renderHierarchy();
    await addNewBed();

    await user.click(screen.getByRole('button', { name: 'Partial name -1700000000000' }));
    await user.click(screen.getByRole('button', { name: 'Escape -1700000000000' }));

    expect(screen.getByTestId('row--1700000000000')).toBeInTheDocument();
    expect(await screen.findByText('Teilweise gefuellt')).toBeInTheDocument();
    expect(screen.getByTestId('mode--1700000000000')).toHaveTextContent('view');
  });

  it('keeps a partially filled invalid new row local and does not persist it', async () => {
    const user = userEvent.setup();
    renderHierarchy();
    await addNewBed();

    await user.click(screen.getByRole('button', { name: 'Partial invalid -1700000000000' }));
    await user.click(screen.getByRole('button', { name: 'Escape -1700000000000' }));

    expect(screen.getByTestId('row--1700000000000')).toBeInTheDocument();
    expect(screen.getByText('Zeile wurde nicht gespeichert, da der Name fehlt.')).toBeInTheDocument();
    expect(bedCreateMock).not.toHaveBeenCalled();
    expect(mockUseNavigationBlocker).toHaveBeenLastCalledWith(
      true,
      'Es gibt eine nicht gespeicherte Zeile ohne Namen. Beim Verlassen der Seite geht sie verloren.',
    );
  });

  it('moves the row edit focus from name to length when tabbing in a new bed row', async () => {
    const user = userEvent.setup();
    renderHierarchy();
    await addNewBed();

    expect(screen.getByTestId('focus-field--1700000000000')).toHaveTextContent('name');

    await user.click(screen.getByRole('button', { name: 'Tab from name -1700000000000' }));

    await waitFor(() => {
      expect(screen.getByTestId('mode--1700000000000')).toHaveTextContent('edit');
      expect(screen.getByTestId('focus-field--1700000000000')).toHaveTextContent('length_m');
    });
  });

  it('removes a completely empty new row when clicking outside', async () => {
    renderHierarchy();
    await addNewBed();

    fireEvent.mouseDown(document.body);

    await waitFor(() => expect(screen.queryByTestId('row--1700000000000')).not.toBeInTheDocument());
    expect(screen.queryByText('Zeile wurde nicht gespeichert, da der Name fehlt.')).not.toBeInTheDocument();
  });

  it('persists a new row with a name when clicking outside, instead of just keeping it local', async () => {
    const user = userEvent.setup();
    renderHierarchy();
    await addNewBed();

    await user.click(screen.getByRole('button', { name: 'Partial name -1700000000000' }));
    fireEvent.mouseDown(document.body);

    // Unlike Escape (a deliberate "give up"), clicking outside a row that has a
    // name is a real save attempt, matching normal click-away-to-save UX - the
    // temporary negative id is replaced by the backend's real id once saved.
    expect(await screen.findByText('Teilweise gefuellt')).toBeInTheDocument();
    await waitFor(() => expect(bedCreateMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId('row--1700000000000')).not.toBeInTheDocument());
  });

  it('keeps the first tapped dimension cell editing when saving replaces a new row id', async () => {
    const user = userEvent.setup();
    renderHierarchy();
    await addNewBed();

    await user.click(screen.getByRole('button', { name: 'Partial name -1700000000000' }));
    const lengthCell = screen.getByRole('button', { name: 'Edit length -1700000000000' });
    fireEvent.pointerDown(lengthCell, { button: 0 });
    await user.click(screen.getByRole('button', { name: 'Blur -1700000000000' }));

    await waitFor(() => expect(bedCreateMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('mode-101')).toHaveTextContent('edit'));
    expect(screen.getByTestId('focus-field-101')).toHaveTextContent('length_m');
  });

  it('keeps the first touched dimension cell editing when saving replaces a new parcel id', async () => {
    const user = userEvent.setup();
    let fieldResults: Array<Record<string, unknown>> = [];
    fieldListMock.mockImplementation(() => Promise.resolve({ data: { results: fieldResults } }));
    fieldCreateMock.mockImplementation((data: Record<string, unknown>) => {
      fieldResults = [{ id: 201, ...data }];
      return Promise.resolve({ data: fieldResults[0] });
    });
    renderHierarchyWithCreateFieldRequest(1);

    await waitFor(() => expect(screen.getByTestId('row-field--1700000000000')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Partial name field--1700000000000' }));
    const lengthCell = screen.getByRole('button', { name: 'Edit length field--1700000000000' });
    fireEvent.touchStart(lengthCell, { touches: [{ identifier: 1, clientX: 10, clientY: 10 }] });
    await user.click(screen.getByRole('button', { name: 'Blur field--1700000000000' }));

    await waitFor(() => expect(fieldCreateMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('mode-field-201')).toHaveTextContent('edit'));
    expect(screen.getByTestId('focus-field-field-201')).toHaveTextContent('length_m');
  });

  it('persists a new bed before saving notes from the notes drawer', async () => {
    const user = userEvent.setup();
    renderHierarchy();
    await addNewBed();

    await user.click(screen.getByRole('button', { name: 'Partial name -1700000000000' }));
    const notesButtons = within(screen.getByTestId('row--1700000000000')).getAllByRole('button', { name: 'notes.editEmpty' });
    await user.click(notesButtons[notesButtons.length - 1]);
    const notesInput = await screen.findByRole('textbox');
    fireEvent.change(notesInput, { target: { value: 'Neue Notiz' } });
    expect(notesInput).toHaveValue('Neue Notiz');
    await user.click(screen.getByRole('button', { name: 'actions.save' }));

    await waitFor(() => {
      expect(bedCreateMock).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Teilweise gefuellt',
        field: 10,
        notes: 'Neue Notiz',
      }));
    });
  });

  it('shows a name-required confirm dialog when clicking outside a partially filled new row', async () => {
    const user = userEvent.setup();
    renderHierarchy();
    await addNewBed();

    await user.click(screen.getByRole('button', { name: 'Partial invalid -1700000000000' }));
    fireEvent.mouseDown(document.body);

    expect(await screen.findByText('Zeile nicht gespeichert')).toBeInTheDocument();
    expect(screen.getByText('Name ist ein Pflichtfeld. Ohne Namen kann diese Zeile nicht gespeichert werden.')).toBeInTheDocument();
    // The row cleanly exits edit mode before the dialog opens (avoids an
    // input fighting the dialog's focus trap) - discarding/continuing from
    // the dialog is an explicit choice, not an implicit side effect of the
    // outside click.
    expect(screen.getByTestId('mode--1700000000000')).toHaveTextContent('view');
    expect(bedCreateMock).not.toHaveBeenCalled();
  });

  it('warns before navigating away while a partially filled new field sits behind the unsaved-row dialog', async () => {
    const user = userEvent.setup();
    renderHierarchyWithCreateFieldRequest(1);

    await waitFor(() => expect(screen.getByTestId('row-field--1700000000000')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Partial invalid field--1700000000000' }));
    fireEvent.mouseDown(document.body);

    expect(await screen.findByText('Zeile nicht gespeichert')).toBeInTheDocument();
    // The row already exited edit mode before the dialog opened, so the
    // generic "a row is being edited" navigation warning no longer applies -
    // the unsaved-row-specific one has to cover it instead, or leaving the
    // page while the dialog is still open silently drops the draft.
    expect(mockUseNavigationBlocker).toHaveBeenLastCalledWith(
      true,
      'Es gibt eine nicht gespeicherte Zeile ohne Namen. Beim Verlassen der Seite geht sie verloren.',
    );
    expect(fieldCreateMock).not.toHaveBeenCalled();
  });

  it('removes the row entirely when discarding it from the unsaved-row dialog', async () => {
    const user = userEvent.setup();
    renderHierarchy();
    await addNewBed();

    await user.click(screen.getByRole('button', { name: 'Partial invalid -1700000000000' }));
    fireEvent.mouseDown(document.body);
    await user.click(await screen.findByRole('button', { name: 'Verwerfen' }));

    await waitFor(() => expect(screen.queryByTestId('row--1700000000000')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText('Zeile nicht gespeichert')).not.toBeInTheDocument());
    expect(bedCreateMock).not.toHaveBeenCalled();
  });

  it('keeps editing the row, focused on the name field, when continuing from the unsaved-row dialog', async () => {
    const user = userEvent.setup();
    renderHierarchy();
    await addNewBed();

    await user.click(screen.getByRole('button', { name: 'Partial invalid -1700000000000' }));
    fireEvent.mouseDown(document.body);
    await user.click(await screen.findByRole('button', { name: 'Weiter bearbeiten' }));

    await waitFor(() => expect(screen.queryByText('Zeile nicht gespeichert')).not.toBeInTheDocument());
    expect(screen.getByTestId('row--1700000000000')).toBeInTheDocument();
    expect(screen.getByTestId('mode--1700000000000')).toHaveTextContent('edit');
    expect(screen.getByTestId('focus-field--1700000000000')).toHaveTextContent('name');
    expect(bedCreateMock).not.toHaveBeenCalled();
  });

  it('removes unsaved invalid new rows on remount because they were never persisted', async () => {
    const user = userEvent.setup();
    const { unmount } = renderHierarchy();
    await addNewBed();

    await user.click(screen.getByRole('button', { name: 'Partial invalid -1700000000000' }));
    await user.click(screen.getByRole('button', { name: 'Escape -1700000000000' }));
    expect(screen.getByTestId('row--1700000000000')).toBeInTheDocument();
    expect(bedCreateMock).not.toHaveBeenCalled();

    unmount();
    renderHierarchy();

    await waitFor(() => expect(screen.queryByTestId('row--1700000000000')).not.toBeInTheDocument());
  });

  it('keeps hover actions rendered for invalid rows with empty required names', async () => {
    const user = userEvent.setup();
    renderHierarchy();
    await addNewBed();

    await user.click(screen.getByRole('button', { name: 'Partial invalid -1700000000000' }));
    await user.click(screen.getByRole('button', { name: 'Escape -1700000000000' }));

    expect(screen.getAllByRole('button', { name: 'Aktionen' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Löschen' }).length).toBeGreaterThan(0);
  });

  it('opens hierarchy actions from the right-click context menu', async () => {
    useMultipleLocations();
    bedListMock.mockResolvedValue({ data: { results: [{ id: 21, name: 'Beet A', field: 10 }] } });
    renderHierarchy();

    const locationRow = await screen.findByTestId('row-location-1');
    fireEvent.contextMenu(locationRow);

    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Parzelle hinzufügenEinfg',
      'Löschen',
      'actions.copyRow',
      'actions.copyTable',
    ]);
    expect(screen.getByRole('menuitem', { name: /^Parzelle hinzufügen/ })).toBeInTheDocument();
    expect(screen.getAllByRole('separator')).toHaveLength(2);

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());

    const fieldRow = await screen.findByTestId('row-field-10');
    fireEvent.contextMenu(fieldRow);

    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Beet hinzufügenEinfg',
      'Mehrere Beete anlegen',
      'Parzelle duplizieren',
      'Löschen',
      'actions.copyRow',
      'actions.copyTable',
    ]);
    expect(screen.getByRole('menuitem', { name: /^Beet hinzufügen/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Beet' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('separator')).toHaveLength(2);

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(within(fieldRow).getByLabelText('Aktionen')).toBeInTheDocument();
    fireEvent.contextMenu(fieldRow);

    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Beet hinzufügenEinfg',
      'Mehrere Beete anlegen',
      'Parzelle duplizieren',
      'Löschen',
      'actions.copyRow',
      'actions.copyTable',
    ]);
    expect(screen.getByRole('menuitem', { name: /^Beet hinzufügen/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Beet' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('separator')).toHaveLength(2);

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());

    const bedRow = await screen.findByTestId('row-21');
    fireEvent.contextMenu(bedRow);

    const createPlanMenuItem = screen.getByRole('menuitem', { name: 'Pflanzplan erstellen' });
    expect(createPlanMenuItem).toBeInTheDocument();
    expect(createPlanMenuItem.querySelector('svg')).not.toBeNull();
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Beet duplizierenStrg+D',
      'Pflanzplan erstellen',
      'Löschen',
      'actions.copyRow',
      'actions.copyTable',
    ]);
  });

  it('prefills "Beet hinzufügen" from the last bed of the field and counts its name up', async () => {
    bedListMock.mockResolvedValue({
      data: { results: [{ id: 21, name: 'E 2 8', field: 10, length_m: 10, width_m: 0.75, area_sqm: 7.5 }] },
    });
    renderHierarchy();
    await screen.findByTestId('row-21');

    await addNewBed();
    fireEvent.click(screen.getByRole('button', { name: 'Blur -1700000000000' }));

    await waitFor(() => expect(bedCreateMock).toHaveBeenCalledTimes(1));
    expect(bedCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      name: 'E 2 9',
      field: 10,
      length_m: 10,
      width_m: 0.75,
    }));
  });

  it('keeps "Beet hinzufügen" empty for a field without beds', async () => {
    renderHierarchy();
    await addNewBed();

    fireEvent.click(screen.getByRole('button', { name: 'Blur -1700000000000' }));

    await waitFor(() => expect(screen.queryByTestId('row--1700000000000')).not.toBeInTheDocument());
    expect(bedCreateMock).not.toHaveBeenCalled();
  });

  it('duplicates a bed from its context menu with only the dimensions and a counted-up name', async () => {
    bedListMock.mockResolvedValue({
      data: {
        results: [
          { id: 21, name: 'B-3', field: 10, length_m: 8, width_m: 1.2, area_sqm: 9.6, notes: 'Mulch' },
          { id: 22, name: 'B-4', field: 10 },
        ],
      },
    });
    renderHierarchy();

    fireEvent.contextMenu(await screen.findByTestId('row-21'));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Beet duplizieren/ }));

    await waitFor(() => expect(bedCreateMock).toHaveBeenCalledWith({
      name: 'B-5',
      field: 10,
      length_m: 8,
      width_m: 1.2,
      notes: '',
    }));
    expect(await screen.findByTestId('row-101')).toBeInTheDocument();
  });

  it('duplicates the focused bed row with Ctrl+D', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
    bedListMock.mockResolvedValue({ data: { results: [{ id: 21, name: 'Beet 09', field: 10 }] } });
    renderHierarchy();

    const bedRow = await screen.findByTestId('row-21');
    fireEvent.click(within(bedRow).getByRole('button', { name: 'Edit length 21' }));
    fireEvent.click(within(bedRow).getByRole('button', { name: 'Escape 21' }));
    await waitFor(() => expect(screen.getByTestId('mode-21')).toHaveTextContent('view'));

    const event = new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true, cancelable: true });
    await act(async () => {
      window.dispatchEvent(event);
    });

    await waitFor(() => expect(bedCreateMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'Beet 10' })));
    expect(event.defaultPrevented).toBe(true);
  });

  it('duplicates a field with its beds from the field menu', async () => {
    bedListMock.mockResolvedValue({
      data: { results: [{ id: 21, name: 'N 1', field: 10, length_m: 10, width_m: 1, area_sqm: 10 }] },
    });
    fieldDuplicateMock.mockResolvedValue({
      data: {
        field: { id: 11, name: 'Nordfeld 2', location: 1, area_sqm: 20 },
        beds: [{ id: 600, name: 'S 1', field: 11, length_m: 10, width_m: 1, area_sqm: 10 }],
      },
    });
    renderHierarchy();

    fireEvent.contextMenu(await screen.findByTestId('row-field-10'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Parzelle duplizieren' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('textbox', { name: /dialogs.duplicateField.name/ })).toHaveValue('Nordfeld 2');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'dialogs.duplicateField.replaceSearch' }), { target: { value: 'N' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'dialogs.duplicateField.replaceWith' }), { target: { value: 'S' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'dialogs.duplicateField.submit' }));

    await waitFor(() => expect(fieldDuplicateMock).toHaveBeenCalledWith(10, {
      name: 'Nordfeld 2', copy_beds: true, replace_search: 'N', replace_with: 'S',
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('row-field-11')).toBeInTheDocument();
    // The copy is expanded, so its bed is visible right away.
    expect(screen.getByTestId('row-600')).toBeInTheDocument();
  });

  it('creates a numbered bed series from the "Mehrere Beete anlegen" dialog', async () => {
    bedListMock.mockResolvedValue({
      data: { results: [{ id: 21, name: 'E 1', field: 10, length_m: 10, width_m: 0.75, area_sqm: 7.5 }] },
    });
    bedBulkCreateMock.mockImplementation((payload: { field: number; beds: Array<{ name: string }> }) => Promise.resolve({
      data: payload.beds.map((bed, index) => ({ id: 500 + index, field: payload.field, ...bed })),
    }));
    renderHierarchy();

    fireEvent.contextMenu(await screen.findByTestId('row-field-10'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mehrere Beete anlegen' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('textbox', { name: /dialogs.bulkCreateBeds.firstName/ })).toHaveValue('E 2');
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: /dialogs.bulkCreateBeds.count/ }), {
      target: { value: '3' },
    });
    expect(within(dialog).getByRole('list', { name: 'dialogs.bulkCreateBeds.previewList' })).toHaveTextContent('E 2E 3E 4');

    fireEvent.click(within(dialog).getByRole('button', { name: 'dialogs.bulkCreateBeds.submitCount' }));

    await waitFor(() => expect(bedBulkCreateMock).toHaveBeenCalledWith({
      field: 10,
      beds: [
        { name: 'E 2', length_m: 10, width_m: 0.75 },
        { name: 'E 3', length_m: 10, width_m: 0.75 },
        { name: 'E 4', length_m: 10, width_m: 0.75 },
      ],
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('row-500')).toBeInTheDocument();
    expect(screen.getByTestId('row-502')).toBeInTheDocument();
  });

  it('adds a bed via the Insert key when a field row is focused, mirroring "Beet hinzufügen"', async () => {
    renderHierarchy();

    const fieldRow = await screen.findByTestId('row-field-10');
    fireEvent.click(within(fieldRow).getByRole('button', { name: 'Edit field-10' }));

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Insert', bubbles: true }));
    });

    await waitFor(() => expect(screen.getByTestId('row--1700000000000')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('mode--1700000000000')).toHaveTextContent('edit'));
  });

  it('adds a field via the Insert key when a location row is focused, mirroring "Parzelle hinzufügen"', async () => {
    useMultipleLocations();
    renderHierarchy();

    const locationRow = await screen.findByTestId('row-location-1');
    fireEvent.click(within(locationRow).getByRole('button', { name: 'Edit location-1' }));

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Insert', bubbles: true }));
    });

    await waitFor(() => expect(screen.getByTestId('row-field--1700000000000')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('mode-field--1700000000000')).toHaveTextContent('edit'));
  });

  it('does not add a bed via Insert when no row is focused', async () => {
    renderHierarchy();
    await screen.findByTestId('row-field-10');

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Insert', bubbles: true }));
    });

    expect(screen.queryByTestId('row--1700000000000')).not.toBeInTheDocument();
  });

  it('removes a newly created empty bed locally without calling the delete API', async () => {
    renderHierarchy();
    await addNewBed();

    deleteRowViaContextMenu(screen.getByTestId('row--1700000000000'));

    await waitFor(() => expect(screen.queryByTestId('row--1700000000000')).not.toBeInTheDocument());
    expect(bedDeleteMock).not.toHaveBeenCalled();
    expect(fieldDeleteMock).not.toHaveBeenCalled();
    expect(locationDeleteMock).not.toHaveBeenCalled();
    expect(screen.queryByText('Fehler beim Löschen')).not.toBeInTheDocument();
  });

  it('removes a newly created empty parcel locally without calling the delete API', async () => {
    fieldListMock.mockResolvedValue({ data: { results: [] } });
    renderHierarchyWithCreateFieldRequest(1);

    const fieldRow = await screen.findByTestId('row-field--1700000000000');
    deleteRowViaContextMenu(fieldRow);

    await waitFor(() => expect(screen.queryByTestId('row-field--1700000000000')).not.toBeInTheDocument());
    expect(fieldDeleteMock).not.toHaveBeenCalled();
    expect(bedDeleteMock).not.toHaveBeenCalled();
    expect(locationDeleteMock).not.toHaveBeenCalled();
    expect(screen.queryByText('Fehler beim Löschen')).not.toBeInTheDocument();
  });

  it('persists a deleted bed immediately and shows undo feedback', async () => {
    bedListMock.mockResolvedValue({ data: { results: [{ id: 21, name: 'Beet A', field: 10 }] } });
    renderHierarchy();

    const bedRow = await screen.findByTestId('row-21');
    deleteRowViaContextMenu(bedRow);

    await waitFor(() => expect(bedDeleteMock).toHaveBeenCalledWith(21));
    await waitFor(() => expect(screen.queryByTestId('row-21')).not.toBeInTheDocument());
    expect(screen.getByText('Beet gelöscht')).toBeInTheDocument();
    expect(screen.getByTestId('hierarchy-delete-snackbar')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('button', { name: /Rückgängig: Beet gelöscht/i })).toBeInTheDocument();
  });

  it('restores a deleted bed when undo is clicked', async () => {
    const user = userEvent.setup();
    bedListMock.mockResolvedValue({ data: { results: [{ id: 21, name: 'Beet A', field: 10 }] } });
    renderHierarchy();

    const bedRow = await screen.findByTestId('row-21');
    deleteRowViaContextMenu(bedRow);
    await waitFor(() => expect(screen.queryByTestId('row-21')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Rückgängig: Beet gelöscht/i }));

    await waitFor(() => expect(bedCreateMock).toHaveBeenCalledWith({ name: 'Beet A', field: 10 }));
    expect(screen.getByTestId('row-21')).toBeInTheDocument();
    expect(bedDeleteMock).toHaveBeenCalledWith(21);
  });

  it('restores cascading field deletion with child beds on undo', async () => {
    const user = userEvent.setup();
    bedListMock.mockResolvedValue({
      data: {
        results: [
          { id: 21, name: 'Beet A', field: 10 },
          { id: 22, name: 'Beet B', field: 10 },
        ],
      },
    });
    renderHierarchy();

    const fieldRow = await screen.findByTestId('row-field-10');
    deleteRowViaContextMenu(fieldRow);

    await waitFor(() => expect(fieldDeleteMock).toHaveBeenCalledWith(10));
    await waitFor(() => expect(screen.queryByTestId('row-field-10')).not.toBeInTheDocument());
    expect(screen.queryByTestId('row-21')).not.toBeInTheDocument();
    expect(screen.queryByTestId('row-22')).not.toBeInTheDocument();
    expect(screen.getByText('Parzelle und {{count}} Beete gelöscht')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Rückgängig:/i }));

    await waitFor(() => expect(fieldCreateMock).toHaveBeenCalledWith({ name: 'Nordfeld', location: 1, area_sqm: 20 }));
    expect(bedCreateMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('row-field-10')).toBeInTheDocument();
    expect(screen.getByTestId('row-21')).toBeInTheDocument();
    expect(screen.getByTestId('row-22')).toBeInTheDocument();
    expect(fieldDeleteMock).toHaveBeenCalledWith(10);
  });

  it('restores cascading location deletion with child fields and beds on undo', async () => {
    const user = userEvent.setup();
    locationListMock.mockResolvedValue({
      data: {
        results: [
          { id: 1, name: 'Hofstelle' },
          { id: 2, name: 'Außenfläche' },
        ],
      },
    });
    fieldListMock.mockResolvedValue({
      data: {
        results: [
          { id: 10, name: 'Nordfeld', location: 1, area_sqm: 20 },
          { id: 11, name: 'Suedfeld', location: 2, area_sqm: 12 },
        ],
      },
    });
    bedListMock.mockResolvedValue({ data: { results: [{ id: 21, name: 'Beet A', field: 10 }] } });
    renderHierarchy();

    const locationRow = await screen.findByTestId('row-location-1');
    deleteRowViaContextMenu(locationRow);

    await waitFor(() => expect(locationDeleteMock).toHaveBeenCalledWith(1));
    await waitFor(() => expect(screen.queryByTestId('row-location-1')).not.toBeInTheDocument());
    expect(screen.queryByTestId('row-field-10')).not.toBeInTheDocument();
    expect(screen.queryByTestId('row-21')).not.toBeInTheDocument();
    expect(screen.getByTestId('row-field-11')).toBeInTheDocument();
    expect(screen.getByText('Standort und {{count}} Beete gelöscht')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Rückgängig:/i }));

    await waitFor(() => expect(locationCreateMock).toHaveBeenCalledWith({ name: 'Hofstelle' }));
    expect(fieldCreateMock).toHaveBeenCalledWith({ name: 'Nordfeld', location: 301, area_sqm: 20 });
    expect(bedCreateMock).toHaveBeenCalledWith({ name: 'Beet A', field: 201 });
    expect(screen.getByTestId('row-location-1')).toBeInTheDocument();
    expect(screen.getByTestId('row-field-10')).toBeInTheDocument();
    expect(screen.getByTestId('row-21')).toBeInTheDocument();
    expect(locationDeleteMock).toHaveBeenCalledWith(1);
  });

  it('handles multiple pending deletions independently', async () => {
    bedListMock.mockResolvedValue({
      data: {
        results: [
          { id: 21, name: 'Beet A', field: 10 },
          { id: 22, name: 'Beet B', field: 10 },
        ],
      },
    });
    renderHierarchy();

    const firstBedRow = await screen.findByTestId('row-21');
    deleteRowViaContextMenu(firstBedRow);
    await waitFor(() => expect(screen.queryByTestId('row-21')).not.toBeInTheDocument());
    deleteRowViaContextMenu(screen.getByTestId('row-22'));

    await waitFor(() => expect(screen.queryByTestId('row-22')).not.toBeInTheDocument());
    expect(screen.getAllByRole('button', { name: /Rückgängig:/i })).toHaveLength(2);
    expect(bedDeleteMock).toHaveBeenCalledWith(21);
    expect(bedDeleteMock).toHaveBeenCalledWith(22);

    bedListMock.mockResolvedValue({ data: { results: [{ id: 21, name: 'Beet A', field: 10 }] } });
    fireEvent.click(screen.getAllByRole('button', { name: /Rückgängig:/i })[0]);
    await waitFor(() => expect(bedCreateMock).toHaveBeenCalledWith({ name: 'Beet A', field: 10 }));
    expect(screen.getByTestId('row-21')).toBeInTheDocument();
    expect(screen.queryByTestId('row-22')).not.toBeInTheDocument();
  });

  it('does not depend on pending deletion timers after unmount', async () => {
    bedListMock.mockResolvedValue({ data: { results: [{ id: 21, name: 'Beet A', field: 10 }] } });
    const { unmount } = renderHierarchy();

    const bedRow = await screen.findByTestId('row-21');
    deleteRowViaContextMenu(bedRow);
    await waitFor(() => expect(bedDeleteMock).toHaveBeenCalledWith(21));
    unmount();

    expect(bedDeleteMock).toHaveBeenCalledTimes(1);
  });
});
