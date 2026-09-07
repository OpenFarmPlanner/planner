import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GridColDef } from '@mui/x-data-grid';
import { AxiosError } from 'axios';
import { EditableDataGrid, type EditableDataGridCommandApi } from '../components/data-grid/DataGrid';
import { createGridApiMock, createGridRow, type TestGridRow } from './helpers/factories';
import { mockT } from './helpers/testI18n';

const mockUseNavigationBlocker = vi.fn();
const mockStopRowEditMode = vi.hoisted(() => vi.fn());
const mockSetCellFocus = vi.hoisted(() => vi.fn());
const mockSetEditCellValue = vi.hoisted(() => vi.fn().mockResolvedValue(true));

vi.mock('../hooks/autosave', () => ({
  useNavigationBlocker: (...args: unknown[]) => mockUseNavigationBlocker(...args),
}));

vi.mock('../i18n', () => ({
  useTranslation: () => ({ t: mockT }),
}));

vi.mock('@mui/x-data-grid', async () => {
  const React = await import('react');
  const createGridApiMockRefValue = () => ({
    setEditCellValue: mockSetEditCellValue,
    stopRowEditMode: mockStopRowEditMode,
  });
  const useGridApiRef = vi.fn(() => React.useRef(createGridApiMockRefValue()));
  const GridRowModes = { Edit: 'edit', View: 'view' };
  const GridRowEditStopReasons = {
    rowFocusOut: 'rowFocusOut',
    enterKeyDown: 'enterKeyDown',
    tabKeyDown: 'tabKeyDown',
    escapeKeyDown: 'escapeKeyDown',
  };
  const getMockFilterOperators = () => [
    {
      value: 'contains',
      getApplyFilterFn: () => () => true,
    },
  ];

  const DataGrid = ({
    apiRef,
    rows,
    columns,
    processRowUpdate,
    onProcessRowUpdateError,
    onCellClick,
    onCellKeyDown,
    onRowEditStop,
    onRowSelectionModelChange,
    rowModesModel,
    rowSelectionModel,
    columnVisibilityModel,
    slots,
    pagination,
    paginationModel,
    pageSizeOptions,
    sx,
  }: unknown) => {
    const [, forceFocusRender] = React.useState(0);
    const [editValues, setEditValues] = React.useState<Record<string, unknown>>({});
    const visibleColumns = columns.filter(
      (column: GridColDef) => columnVisibilityModel?.[column.field] !== false,
    );

    if (apiRef?.current) {
      apiRef.current.state = apiRef.current.state ?? { focus: { cell: null } };
      apiRef.current.setEditCellValue = (params: { id: string | number; field: string; value: unknown }) => {
        // Mirrors MUI's own `throwIfNotEditable`: a field without an editor in
        // the open edit session is a hard error, not a silent no-op.
        if (columns.find((column: GridColDef) => column.field === params.field)?.editable === false) {
          throw new Error(`MUI X: The cell with id=${String(params.id)} and field=${params.field} is not editable.`);
        }
        setEditValues((currentValues) => ({
          ...currentValues,
          [`${String(params.id)}-${params.field}`]: params.value,
        }));
        return mockSetEditCellValue(params);
      };
      apiRef.current.getVisibleColumns = () => visibleColumns;
      apiRef.current.getAllRowIds = () => rows.map((row: TestGridRow) => row.id);
      apiRef.current.getRowWithUpdatedValues = (id: string | number) => {
        const baseRow = rows.find((row: TestGridRow) => String(row.id) === String(id));
        if (!baseRow) {
          return null;
        }
        const rowKeyPrefix = `${String(id)}-`;
        return Object.entries(editValues).reduce<TestGridRow>((updatedRow, [editKey, value]) => {
          if (!editKey.startsWith(rowKeyPrefix)) {
            return updatedRow;
          }
          return {
            ...updatedRow,
            [editKey.slice(rowKeyPrefix.length)]: value,
          };
        }, baseRow);
      };
      apiRef.current.getRowIndexRelativeToVisibleRows = (id: string | number) =>
        rows.findIndex((row: TestGridRow) => String(row.id) === String(id));
      // Deliberately mirrors MUI's own (misnamed) implementation: it resolves
      // the field against *all* columns, hidden ones included.
      apiRef.current.getColumnIndexRelativeToVisibleColumns = (field: string) =>
        columns.findIndex((column: GridColDef) => column.field === field);
      apiRef.current.getCellParams = (id: string | number, field: string) => {
        const row = rows.find((currentRow: TestGridRow) => String(currentRow.id) === String(id));
        return { id, field, row };
      };
      apiRef.current.isCellEditable = (params: { field: string }) =>
        columns.find((column: GridColDef) => column.field === params.field)?.editable !== false;
      // MUI reads `visibleColumns[colIndex].computedWidth`, so an index that
      // counted hidden columns too blows up here instead of scrolling.
      apiRef.current.scrollToIndexes = (indexes: { rowIndex?: number; colIndex?: number }) => {
        if (indexes.colIndex !== undefined && !visibleColumns[indexes.colIndex]) {
          throw new TypeError("Cannot read properties of undefined (reading 'computedWidth')");
        }
      };
      apiRef.current.setCellFocus = (id: string | number, field: string) => {
        mockSetCellFocus(id, field);
        apiRef.current.state.focus.cell = { id, field };
        forceFocusRender((version) => version + 1);
      };
    }

    const commit = async (row: TestGridRow, reason: string) => {
      const event = { defaultMuiPrevented: false };
      onRowEditStop?.({ id: row.id, reason }, event);
      if (event.defaultMuiPrevented) {
        return;
      }
      const updatedRow = apiRef?.current?.getRowWithUpdatedValues?.(row.id) ?? row;
      try {
        await processRowUpdate(updatedRow);
      } catch (error) {
        onProcessRowUpdateError?.(error);
      }
    };

    return (
      <div>
        <div data-testid="row-count">{rows.length}</div>
        <div data-testid="pagination-enabled">{String(Boolean(pagination))}</div>
        <div data-testid="pagination-page">{paginationModel?.page ?? ''}</div>
        <div data-testid="pagination-page-size">{paginationModel?.pageSize ?? ''}</div>
        <div data-testid="pagination-options">{pageSizeOptions?.join(',') ?? ''}</div>
        <div data-testid="continuous-render-zone-collapsed">
          {String(Boolean((sx as Record<string, unknown> | undefined)?.['& .MuiDataGrid-virtualScrollerRenderZone']))}
        </div>
        <div data-testid="continuous-content-height">
          {String(((sx as Record<string, Record<string, unknown>> | undefined)?.['& .MuiDataGrid-virtualScrollerContent']?.height) ?? '')}
        </div>
        {rows.map((row: TestGridRow) => (
          <div
            key={row.id}
            role="row"
            data-id={String(row.id)}
            data-selected={rowSelectionModel?.ids?.has(row.id) ? 'true' : 'false'}
            data-testid={`row-${row.id}`}
          >
            <span data-testid={`mode-${row.id}`}>{rowModesModel?.[row.id]?.mode ?? GridRowModes.View}</span>
            {visibleColumns.map((col: GridColDef) => {
              const isEditingCell =
                rowModesModel?.[row.id]?.mode === GridRowModes.Edit &&
                rowModesModel?.[row.id]?.fieldToFocus === col.field;
              const editValueKey = `${String(row.id)}-${col.field}`;
              if (typeof col.getActions === 'function') {
                return (
                  <div key={`${row.id}-${col.field}`}>
                    {col.getActions({ id: row.id, row } as unknown)}
                  </div>
                );
              }
              if (typeof col.renderCell === 'function') {
                return (
                  <div key={`${row.id}-${col.field}`}>
                    {col.renderCell({ id: row.id, row, value: row[col.field as keyof TestGridRow] } as never)}
                  </div>
                );
              }

              return (
                <div key={`${row.id}-${col.field}`}>
                  {col.renderEditCell && (
                    <span
                      data-testid={`edit-renderer-${row.id}-${col.field}`}
                      data-width={col.width ?? ''}
                      data-min-width={col.minWidth ?? ''}
                    />
                  )}
                  {isEditingCell ? (
                    <input
                      aria-label={`Editor ${row.id}-${col.field}`}
                      data-testid={`edit-input-${row.id}-${col.field}`}
                      readOnly
                      value={String(editValues[editValueKey] ?? row[col.field as keyof TestGridRow] ?? '')}
                    />
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      if (apiRef?.current) {
                        apiRef.current.state.focus.cell = { id: row.id, field: col.field };
                      }
                      onRowSelectionModelChange?.({ type: 'include', ids: new Set([row.id]) });
                      onCellClick?.({ id: row.id, field: col.field, isEditable: col.editable !== false });
                    }}
                    onKeyDown={(event) => {
                      onCellKeyDown?.(
                        {
                          id: row.id,
                          field: col.field,
                          isEditable: col.editable !== false,
                          row,
                        },
                        event,
                      );
                    }}
                  >
                    Zelle {row.id}-{col.field}
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              onClick={() =>
                onCellKeyDown?.({ id: row.id, field: 'name' }, { key: 'Escape', preventDefault: vi.fn() })
              }
            >
              ESC {row.id}
            </button>
            <button
              type="button"
              onClick={() =>
                onCellKeyDown?.(
                  { id: row.id, field: 'name' },
                  {
                    key: 'Enter',
                    shiftKey: false,
                    ctrlKey: false,
                    metaKey: false,
                    altKey: false,
                    target: document.createElement('input'),
                    preventDefault: vi.fn(),
                    defaultMuiPrevented: false,
                  },
                )
              }
            >
              Eingabe per Return {row.id}
            </button>
            <button type="button" onClick={() => commit(row, GridRowEditStopReasons.rowFocusOut)}>
              Blur speichern {row.id}
            </button>
            <button type="button" onClick={() => commit(row, GridRowEditStopReasons.enterKeyDown)}>
              Enter speichern {row.id}
            </button>
            <button type="button" onClick={() => commit(row, GridRowEditStopReasons.tabKeyDown)}>
              Tab speichern {row.id}
            </button>
          </div>
        ))}
        <span data-testid="focused-cell">
          {apiRef?.current?.state?.focus?.cell
            ? `${apiRef.current.state.focus.cell.id}-${apiRef.current.state.focus.cell.field}`
            : 'none'}
        </span>
        {slots?.footer ? <slots.footer /> : null}
      </div>
    );
  };

  const GridPagination = () => <div data-testid="grid-pagination" />;

  return {
    DataGrid,
    GridPagination,
    GridRowModes,
    GridRowEditStopReasons,
    getGridBooleanOperators: getMockFilterOperators,
    getGridDateOperators: getMockFilterOperators,
    getGridNumericOperators: getMockFilterOperators,
    getGridSingleSelectOperators: getMockFilterOperators,
    getGridStringOperators: getMockFilterOperators,
    useGridApiRef,
  };
});

describe('EditableDataGrid', () => {
  const columns: GridColDef[] = [
    { field: 'name', headerName: 'Name', editable: true },
    { field: 'area_sqm', headerName: 'Fläche', editable: true },
  ];

  const baseProps = (validateRow = (row: TestGridRow) => (!row.name ? 'Name ist erforderlich' : null)) => ({
    columns,
    api: createGridApiMock(),
    createNewRow: () => createGridRow({ id: -1, isNew: true, name: '' }),
    mapToRow: (item: TestGridRow) => item,
    mapToApiData: (row: TestGridRow) => ({ name: row.name, area_sqm: row.area_sqm, notes: row.notes }),
    validateRow,
    loadErrorMessage: 'Laden fehlgeschlagen',
    saveErrorMessage: 'Speichern fehlgeschlagen',
    deleteErrorMessage: 'Löschen fehlgeschlagen',
    deleteConfirmMessage: 'Wirklich löschen?',
    addButtonLabel: 'Neu',
  });

  const basePropsWithEmptyNewRow = (validateRow = (row: TestGridRow) => (!row.name ? 'Name ist erforderlich' : null)) => ({
    ...baseProps(validateRow),
    createNewRow: () => createGridRow({
      id: -1,
      isNew: true,
      name: '',
      area_sqm: undefined as never,
      notes: '',
    }),
  });

  /**
   * Grid props whose api mock keeps its own row set, so an immediate delete and
   * a following restore-by-recreate are visible in the next `list()` call.
   */
  const serverBackedProps = (initialRows: TestGridRow[]) => {
    let serverRows = [...initialRows];
    let nextCreatedId = 100;
    const props = baseProps(() => null);
    vi.spyOn(props.api, 'list').mockImplementation(async () => ({ data: { results: [...serverRows] } }));
    vi.spyOn(props.api, 'delete').mockImplementation(async (id) => {
      serverRows = serverRows.filter((row) => row.id !== Number(id));
    });
    vi.spyOn(props.api, 'create').mockImplementation(async (data) => {
      const createdRow = createGridRow({ ...(data as Partial<TestGridRow>), id: nextCreatedId });
      nextCreatedId += 1;
      serverRows = [...serverRows, createdRow];
      return { data: createdRow };
    });
    return props;
  };

  const basePropsWithRows = (rows: TestGridRow[]) => {
    const props = baseProps(() => null);
    vi.spyOn(props.api, 'list').mockResolvedValue({ data: { results: rows } });
    vi.spyOn(props.api, 'update').mockImplementation(async (id, data) => ({
      data: createGridRow({ ...(data as Partial<TestGridRow>), id: Number(id) }),
    }));
    return props;
  };

  const renderGridWithKeyboardRows = () => {
    const props = basePropsWithRows([
      createGridRow({ id: 1, name: 'Blumen 1', area_sqm: 11 }),
      createGridRow({ id: 2, name: 'Kartoffeln', area_sqm: 12 }),
      createGridRow({ id: 3, name: 'Kürbis', area_sqm: 13 }),
      createGridRow({ id: 4, name: 'Melone', area_sqm: 14 }),
    ]);
    render(<EditableDataGrid {...props} showDeleteAction={false} />);
    return props;
  };

  const editSecondRowAndSaveWithEnter = async () => {
    renderGridWithKeyboardRows();
    const editedCell = await screen.findByRole('button', { name: 'Zelle 2-name' });
    fireEvent.click(editedCell);
    await waitFor(() => expect(screen.getByTestId('mode-2')).toHaveTextContent('edit'));
    fireEvent.click(screen.getByRole('button', { name: 'Eingabe per Return 2' }));
    await waitFor(() => {
      expect(screen.getByTestId('mode-2')).toHaveTextContent('view');
      expect(screen.getByTestId('focused-cell')).toHaveTextContent('3-name');
    });
  };

  const pressCellKey = (rowId: number, field: string, key: string, options: { shiftKey?: boolean } = {}) => {
    fireEvent.keyDown(screen.getByRole('button', { name: `Zelle ${rowId}-${field}` }), {
      key,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: options.shiftKey ?? false,
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSetEditCellValue.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders with minimal props and loads rows', async () => {
    render(<EditableDataGrid {...baseProps()} showDeleteAction={false} />);

    await waitFor(() => {
      expect(screen.getByTestId('row-count')).toHaveTextContent('1');
    });
  });

  it('configures explicit pagination page sizes when requested', async () => {
    render(
      <EditableDataGrid
        {...baseProps()}
        showDeleteAction={false}
        paginationPageSizeOptions={[25, 50, 100]}
        initialPageSize={25}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('row-count')).toHaveTextContent('1'));
    expect(screen.getByTestId('pagination-enabled')).toHaveTextContent('true');
    expect(screen.getByTestId('pagination-page-size')).toHaveTextContent('25');
    expect(screen.getByTestId('pagination-options')).toHaveTextContent('25,50,100');
  });

  it('uses hidden balanced internal pagination for continuous scroll without rendering pager controls', async () => {
    const rows = Array.from({ length: 125 }, (_, index) => (
      createGridRow({ id: index + 1, name: `Plan ${index + 1}`, area_sqm: index + 1 })
    ));
    const props = basePropsWithRows(rows);

    render(
      <EditableDataGrid
        {...props}
        showDeleteAction={false}
        scrollMode="continuous"
      />,
    );

    await waitFor(() => expect(screen.getByTestId('row-count')).toHaveTextContent('125'));
    expect(screen.getByTestId('continuous-render-zone-collapsed')).toHaveTextContent('false');
    expect(screen.getByTestId('pagination-enabled')).toHaveTextContent('true');
    expect(screen.getByTestId('pagination-page')).toHaveTextContent('0');
    // 125 rows need two internal pages, and they are split evenly (63/62)
    // rather than 100/25: the grid sizes itself to the rows its current page
    // holds, so a short final page would collapse the table's height when the
    // user scrolls to the end (see getBalancedPageSize).
    expect(screen.getByTestId('pagination-page-size')).toHaveTextContent('63');
    expect(screen.getByTestId('pagination-options')).toBeEmptyDOMElement();
    expect(screen.queryByTestId('grid-pagination')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Neu'));

    await waitFor(() => expect(screen.getByTestId('pagination-page')).toHaveTextContent('1'));
  });

  it('collapses the continuous-scroll render zone when all rows fit on one page', async () => {
    const props = basePropsWithRows([
      createGridRow({ id: 1, name: 'Plan 1', area_sqm: 1 }),
      createGridRow({ id: 2, name: 'Plan 2', area_sqm: 2 }),
    ]);

    render(
      <EditableDataGrid
        {...props}
        showDeleteAction={false}
        scrollMode="continuous"
      />,
    );

    await waitFor(() => expect(screen.getByTestId('row-count')).toHaveTextContent('2'));
    expect(screen.getByTestId('continuous-render-zone-collapsed')).toHaveTextContent('true');
    expect(screen.getByTestId('continuous-content-height')).toHaveTextContent('60px !important');
  });

  it('supports add, blur/enter/tab commit flows and calls API save with payload', async () => {
    const validateRow = vi
      .fn<(row: TestGridRow) => string | null>()
      .mockImplementation((row) => (!row.name ? 'Name ist erforderlich' : null));
    const props = baseProps(validateRow);
    const createSpy = vi.spyOn(props.api, 'create');
    const updateSpy = vi.spyOn(props.api, 'update');

    render(<EditableDataGrid {...props} />);

    await waitFor(() => expect(screen.getByText('Zelle 1-name')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Neu'));
    fireEvent.click(screen.getByRole('button', { name: /Blur speichern -1/i }));
    expect(screen.getByText('messages.validationErrors')).toBeInTheDocument();

    validateRow.mockReturnValue(null);
    fireEvent.click(screen.getByRole('button', { name: /Enter speichern -1/i }));
    await waitFor(() => expect(createSpy).toHaveBeenCalled());

    fireEvent.click(screen.getAllByRole('button', { name: /Tab speichern 1/i })[0]);
    await waitFor(() => expect(updateSpy).toHaveBeenCalled());
    expect(updateSpy).toHaveBeenLastCalledWith(expect.any(Number), expect.objectContaining({ area_sqm: 12 }));
  });

  it('commits command draft values and stops row edit mode', async () => {
    const props = baseProps();
    const updateSpy = vi.spyOn(props.api, 'update');
    const commandApiRef: { current: EditableDataGridCommandApi | null } = { current: null };

    render(<EditableDataGrid {...props} commandApiRef={commandApiRef} showDeleteAction={false} />);

    await waitFor(() => expect(commandApiRef.current).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Zelle 1-name' }));
    await waitFor(() => expect(screen.getByTestId('mode-1')).toHaveTextContent('edit'));

    await commandApiRef.current?.commitDraftValues(1, { area_sqm: 5 });

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith(1, expect.objectContaining({ area_sqm: 5 })));
    expect(mockStopRowEditMode).toHaveBeenCalledWith({ id: 1, ignoreModifications: true });
    await waitFor(() => expect(screen.getByTestId('mode-1')).toHaveTextContent('view'));
  });

  it('preserves the focused cell after saving an existing row', async () => {
    const props = baseProps(() => null);
    const updateSpy = vi.spyOn(props.api, 'update');

    render(<EditableDataGrid {...props} showDeleteAction={false} />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Zelle 1-name' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Zelle 1-name' }));
    await waitFor(() => expect(screen.getByTestId('focused-cell')).toHaveTextContent('1-name'));
    await waitFor(() => expect(screen.getByTestId('mode-1')).toHaveTextContent('edit'));

    fireEvent.click(screen.getByRole('button', { name: 'Enter speichern 1' }));

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalled();
      expect(screen.getByTestId('mode-1')).toHaveTextContent('view');
      expect(screen.getByTestId('focused-cell')).toHaveTextContent('1-name');
    });
  });

  it('focuses an initial draft row created from navigation context', async () => {
    render(
      <EditableDataGrid
        {...baseProps()}
        initialRow={{ name: 'Vorgefüllter Entwurf' }}
        showDeleteAction={false}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('row--1')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('mode--1')).toHaveTextContent('edit'));
    expect(screen.getByTestId('row--1')).toHaveAttribute('data-selected', 'true');
    await waitFor(() => expect(screen.getByTestId('focused-cell')).toHaveTextContent('-1-name'));
  });

  it('prevents delete when canceled and deletes when confirmed', async () => {
    const user = userEvent.setup();
    const props = baseProps();
    const deleteSpy = vi.spyOn(props.api, 'delete');

    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);

    render(<EditableDataGrid {...props} />);

    await waitFor(() => expect(screen.getByLabelText('Löschen')).toBeInTheDocument());
    await user.click(screen.getByLabelText('Löschen'));
    expect(deleteSpy).not.toHaveBeenCalled();

    await user.click(screen.getByLabelText('Löschen'));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(1));
  });

  it('shows backend validation message instead of generic axios status text', async () => {
    const props = baseProps(() => null);
    const axiosError = new AxiosError('Request failed with status code 400', 'ERR_BAD_REQUEST');
    axiosError.response = {
      status: 400,
      statusText: 'Bad Request',
      headers: {},
      config: {} as never,
      data: {
        area_usage_sqm: ['Die Fläche dieses Beets wird im überlappenden Zeitraum überschritten.'],
      },
    };
    vi.spyOn(props.api, 'update').mockRejectedValue(axiosError);

    render(<EditableDataGrid {...props} showDeleteAction={false} />);

    await waitFor(() => expect(screen.getByText('Zelle 1-name')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Tab speichern 1/i }));

    await waitFor(() => {
      expect(
        screen.getByText(
          'Fläche (m²): Die Fläche dieses Beets wird im überlappenden Zeitraum überschritten.',
        ),
      ).toBeInTheDocument();
    });
  });

  it('blocks navigation when cell enters edit mode', async () => {
    const user = userEvent.setup();

    render(<EditableDataGrid {...baseProps()} showDeleteAction={false} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Zelle 1-name' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Zelle 1-name' }));

    await waitFor(() => {
      expect(mockUseNavigationBlocker).toHaveBeenLastCalledWith(
        true,
        'messages.unsavedChanges',
        expect.any(Function),
        false,
      );
    });
  });

  it('starts editing from a typed number and replaces the focused cell value', async () => {
    render(<EditableDataGrid {...baseProps()} showDeleteAction={false} />);

    const cell = await screen.findByRole('button', { name: 'Zelle 1-area_sqm' });
    fireEvent.keyDown(cell, { key: '5' });

    await waitFor(() => expect(screen.getByTestId('mode-1')).toHaveTextContent('edit'));
    await waitFor(() => {
      expect(mockSetEditCellValue).toHaveBeenCalledWith({ id: 1, field: 'area_sqm', value: '5' });
    });
    await waitFor(() => expect(screen.getByTestId('edit-input-1-area_sqm')).toHaveValue('5'));
    expect(mockSetCellFocus).toHaveBeenCalledWith(1, 'area_sqm');
  });

  it('starts editing from a typed letter and replaces the focused cell value', async () => {
    render(<EditableDataGrid {...baseProps()} showDeleteAction={false} />);

    const cell = await screen.findByRole('button', { name: 'Zelle 1-name' });
    fireEvent.keyDown(cell, { key: 'A' });

    await waitFor(() => expect(screen.getByTestId('mode-1')).toHaveTextContent('edit'));
    await waitFor(() => {
      expect(mockSetEditCellValue).toHaveBeenCalledWith({ id: 1, field: 'name', value: 'A' });
    });
    await waitFor(() => expect(screen.getByTestId('edit-input-1-name')).toHaveValue('A'));
  });

  it('keeps multiple fast typed characters when starting edit mode', async () => {
    render(<EditableDataGrid {...baseProps()} showDeleteAction={false} />);

    const cell = await screen.findByRole('button', { name: 'Zelle 1-area_sqm' });
    fireEvent.keyDown(cell, { key: '1' });
    fireEvent.keyDown(cell, { key: '2' });
    fireEvent.keyDown(cell, { key: '3' });

    await waitFor(() => expect(screen.getByTestId('mode-1')).toHaveTextContent('edit'));
    await waitFor(() => {
      expect(mockSetEditCellValue).toHaveBeenCalledWith({ id: 1, field: 'area_sqm', value: '123' });
    });
    await waitFor(() => expect(screen.getByTestId('edit-input-1-area_sqm')).toHaveValue('123'));
  });

  it('starts editing with F2 without replacing the existing value', async () => {
    render(<EditableDataGrid {...baseProps()} showDeleteAction={false} />);

    const cell = await screen.findByRole('button', { name: 'Zelle 1-name' });
    fireEvent.keyDown(cell, { key: 'F2' });

    await waitFor(() => expect(screen.getByTestId('mode-1')).toHaveTextContent('edit'));
    expect(mockSetEditCellValue).not.toHaveBeenCalled();
    expect(mockSetCellFocus).toHaveBeenCalledWith(1, 'name');
    expect(screen.getByTestId('edit-input-1-name')).toHaveValue('Beet A');
  });

  it('starts editing from a click without replacing the existing value', async () => {
    render(<EditableDataGrid {...baseProps()} showDeleteAction={false} />);

    const cell = await screen.findByRole('button', { name: 'Zelle 1-name' });
    fireEvent.click(cell);

    await waitFor(() => expect(screen.getByTestId('mode-1')).toHaveTextContent('edit'));
    expect(mockSetEditCellValue).not.toHaveBeenCalled();
    expect(screen.getByTestId('edit-input-1-name')).toHaveValue('Beet A');
  });

  it('does not start editing for browser shortcut keys', async () => {
    render(<EditableDataGrid {...baseProps()} showDeleteAction={false} />);

    const cell = await screen.findByRole('button', { name: 'Zelle 1-name' });
    fireEvent.keyDown(cell, { key: 'c', ctrlKey: true });

    expect(screen.getByTestId('mode-1')).toHaveTextContent('view');
    expect(mockSetEditCellValue).not.toHaveBeenCalled();
  });

  it('does not start editing from typed keys on readonly cells', async () => {
    render(
      <EditableDataGrid
        {...baseProps()}
        columns={[
          { field: 'name', headerName: 'Name', editable: true },
          { field: 'area_sqm', headerName: 'Fläche', editable: false },
        ]}
        showDeleteAction={false}
      />,
    );

    const cell = await screen.findByRole('button', { name: 'Zelle 1-area_sqm' });
    fireEvent.keyDown(cell, { key: '5' });

    expect(screen.getByTestId('mode-1')).toHaveTextContent('view');
    expect(mockSetEditCellValue).not.toHaveBeenCalled();
  });

  it('keeps draft rows local and exposes save controls until saved', async () => {
    const props = baseProps((row) => (!row.name ? 'Name ist erforderlich' : null));
    const createSpy = vi.spyOn(props.api, 'create');
    render(<EditableDataGrid {...props} showDeleteAction={false} />);

    await waitFor(() => expect(screen.getByTestId('row-count')).toHaveTextContent('1'));
    fireEvent.click(screen.getByLabelText('Neu'));
    expect(screen.getByRole('button', { name: 'actions.save' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Blur speichern -1/i }));
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('discards untouched empty new rows on blur without saving or validating', async () => {
    const props = basePropsWithEmptyNewRow();
    const createSpy = vi.spyOn(props.api, 'create');

    render(<EditableDataGrid {...props} showDeleteAction={false} />);

    await waitFor(() => expect(screen.getByTestId('row-count')).toHaveTextContent('1'));
    fireEvent.click(screen.getByLabelText('Neu'));
    await waitFor(() => expect(screen.getByTestId('row-count')).toHaveTextContent('2'));

    fireEvent.click(screen.getByRole('button', { name: /Blur speichern -1/i }));

    await waitFor(() => expect(screen.getByTestId('row-count')).toHaveTextContent('1'));
    expect(createSpy).not.toHaveBeenCalled();
    expect(screen.queryByText('messages.validationErrors')).not.toBeInTheDocument();
    expect(screen.queryByText('Name ist erforderlich')).not.toBeInTheDocument();
  });

  it('keeps edited new rows on blur and runs the existing validation flow', async () => {
    const validateRow = vi.fn((row: TestGridRow) => (!row.name ? 'Name ist erforderlich' : null));
    const props = basePropsWithEmptyNewRow(validateRow);
    const createSpy = vi.spyOn(props.api, 'create');
    const commandApiRef: { current: EditableDataGridCommandApi | null } = { current: null };

    render(<EditableDataGrid {...props} commandApiRef={commandApiRef} showDeleteAction={false} />);

    await waitFor(() => expect(commandApiRef.current).not.toBeNull());
    fireEvent.click(screen.getByLabelText('Neu'));
    await waitFor(() => expect(screen.getByTestId('row-count')).toHaveTextContent('2'));

    await act(async () => {
      await commandApiRef.current?.setDraftValues(-1, { area_sqm: 4 });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Blur speichern -1/i }));
    });

    expect(createSpy).not.toHaveBeenCalled();
    expect(validateRow).toHaveBeenCalledWith(expect.objectContaining({ area_sqm: 4 }));
    expect(screen.getByText('messages.validationErrors')).toBeInTheDocument();
    expect(screen.getByTestId('row-count')).toHaveTextContent('2');
  });

  it('runs before-save validation for implicit blur persistence and keeps blocked rows editable', async () => {
    const props = baseProps(() => null);
    const updateSpy = vi.spyOn(props.api, 'update');
    const onBeforeSaveRow = vi.fn(() => false);

    render(
      <EditableDataGrid
        {...props}
        onBeforeSaveRow={onBeforeSaveRow}
        showDeleteAction={false}
      />,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Zelle 1-name' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Zelle 1-name' }));
    await waitFor(() => expect(screen.getByTestId('mode-1')).toHaveTextContent('edit'));
    fireEvent.click(screen.getByRole('button', { name: 'Blur speichern 1' }));

    await waitFor(() => expect(onBeforeSaveRow).toHaveBeenCalled());
    expect(updateSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('mode-1')).toHaveTextContent('edit');
  });

  it('keeps existing row blur persistence unchanged', async () => {
    const props = baseProps(() => null);
    const updateSpy = vi.spyOn(props.api, 'update');

    render(<EditableDataGrid {...props} showDeleteAction={false} />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Zelle 1-name' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Zelle 1-name' }));
    await waitFor(() => expect(screen.getByTestId('mode-1')).toHaveTextContent('edit'));

    fireEvent.click(screen.getByRole('button', { name: 'Blur speichern 1' }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith(1, expect.objectContaining({ name: 'Beet A' })));
  });

  it('does not autosave an edited row when interacting with a portal dialog', async () => {
    const props = baseProps(() => null);
    const updateSpy = vi.spyOn(props.api, 'update');
    const dialogRoot = document.createElement('div');
    dialogRoot.className = 'MuiDialog-root MuiModal-root';
    const dialogButton = document.createElement('button');
    dialogButton.type = 'button';
    dialogButton.textContent = 'Parzelle';
    dialogRoot.appendChild(dialogButton);
    document.body.appendChild(dialogRoot);

    try {
      render(<EditableDataGrid {...props} showDeleteAction={false} />);

      await waitFor(() => expect(screen.getByRole('button', { name: 'Zelle 1-name' })).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: 'Zelle 1-name' }));
      await waitFor(() => expect(screen.getByTestId('mode-1')).toHaveTextContent('edit'));

      fireEvent.pointerDown(dialogButton);
      await new Promise((resolve) => {
        window.setTimeout(resolve, 0);
      });

      expect(updateSpy).not.toHaveBeenCalled();
      expect(screen.getByTestId('mode-1')).toHaveTextContent('edit');
    } finally {
      dialogRoot.remove();
    }
  });

  it('saves transformed before-save values directly on input Enter', async () => {
    const props = baseProps(() => null);
    const updateSpy = vi.spyOn(props.api, 'update');
    const onBeforeSaveRow = vi.fn((row: TestGridRow) => ({
      ...row,
      area_sqm: 4,
    }));

    render(
      <EditableDataGrid
        {...props}
        onBeforeSaveRow={onBeforeSaveRow}
        showDeleteAction={false}
      />,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Zelle 1-name' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Zelle 1-name' }));
    await waitFor(() => expect(screen.getByTestId('mode-1')).toHaveTextContent('edit'));
    fireEvent.click(screen.getByRole('button', { name: 'Eingabe per Return 1' }));

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith(1, expect.objectContaining({ area_sqm: 4 }));
    });
    expect(onBeforeSaveRow).toHaveBeenCalledTimes(1);
  });

  it('adds the shared edit renderer to date columns without changing column width', async () => {
    render(
      <EditableDataGrid
        {...baseProps(() => null)}
        columns={[
          { field: 'name', headerName: 'Name', editable: true },
          { field: 'planting_date', headerName: 'Pflanzdatum', type: 'date', editable: true, minWidth: 96, width: 96 },
        ]}
        showDeleteAction={false}
      />,
    );

    expect(await screen.findByTestId('edit-renderer-1-planting_date')).toBeInTheDocument();
    expect(screen.getByTestId('edit-renderer-1-planting_date')).toHaveAttribute('data-width', '96');
    expect(screen.getByTestId('edit-renderer-1-planting_date')).toHaveAttribute('data-min-width', '96');
    expect(screen.getByRole('button', { name: 'Zelle 1-planting_date' })).toBeInTheDocument();
  });

  it('discards draft rows with Escape', async () => {
    const props = basePropsWithEmptyNewRow();
    const createSpy = vi.spyOn(props.api, 'create');

    render(<EditableDataGrid {...props} showDeleteAction={false} />);

    await waitFor(() => expect(screen.getByTestId('row-count')).toHaveTextContent('1'));
    fireEvent.click(screen.getByLabelText('Neu'));
    await waitFor(() => expect(screen.getByTestId('row-count')).toHaveTextContent('2'));
    fireEvent.click(screen.getByRole('button', { name: 'ESC -1' }));

    await waitFor(() => expect(screen.getByTestId('row-count')).toHaveTextContent('1'));
    expect(createSpy).not.toHaveBeenCalled();
    expect(screen.queryByText('messages.validationErrors')).not.toBeInTheDocument();
    expect(screen.queryByText('Name ist erforderlich')).not.toBeInTheDocument();
  });

  it('removes touched draft rows with Escape without saving or validating', async () => {
    const props = baseProps((row) => (!row.name ? 'Name ist erforderlich' : null));
    const createSpy = vi.spyOn(props.api, 'create');

    render(<EditableDataGrid {...props} showDeleteAction={false} />);

    await waitFor(() => expect(screen.getByTestId('row-count')).toHaveTextContent('1'));
    fireEvent.click(screen.getByLabelText('Neu'));
    await waitFor(() => expect(screen.getByTestId('row-count')).toHaveTextContent('2'));
    fireEvent.click(screen.getByRole('button', { name: 'Zelle -1-name' }));
    fireEvent.click(screen.getByRole('button', { name: 'ESC -1' }));

    await waitFor(() => expect(screen.getByTestId('row-count')).toHaveTextContent('1'));
    expect(createSpy).not.toHaveBeenCalled();
    expect(screen.queryByText('messages.validationErrors')).not.toBeInTheDocument();
    expect(screen.queryByText('Name ist erforderlich')).not.toBeInTheDocument();
  });

  it('cancels existing row edits with Escape without saving or validating', async () => {
    const props = baseProps((row) => (!row.name ? 'Name ist erforderlich' : null));
    const updateSpy = vi.spyOn(props.api, 'update');

    render(<EditableDataGrid {...props} showDeleteAction={false} />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Zelle 1-name' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Zelle 1-name' }));
    await waitFor(() => expect(screen.getByTestId('mode-1')).toHaveTextContent('edit'));
    await waitFor(() => expect(screen.getByTestId('row-1')).toHaveAttribute('data-selected', 'true'));
    fireEvent.click(screen.getByRole('button', { name: 'ESC 1' }));

    await waitFor(() => {
      expect(screen.getByTestId('mode-1')).toHaveTextContent('view');
      expect(screen.getByTestId('row-1')).toHaveAttribute('data-selected', 'false');
    });
    expect(updateSpy).not.toHaveBeenCalled();
    expect(screen.queryByText('messages.validationErrors')).not.toBeInTheDocument();
    expect(screen.queryByText('Name ist erforderlich')).not.toBeInTheDocument();

    // Cancelling edit mode suppresses MUI's own default Escape handling
    // (which normally restores keyboard focus), so it has to be restored
    // manually — otherwise focus is stranded outside the grid entirely.
    await waitFor(() => expect(screen.getByTestId('focused-cell')).toHaveTextContent('1-name'));
  });

  it('moves through a new planting plan row with Tab without row validation', async () => {
    const props = baseProps((row) => {
      const missing = [
        !row.planting_date ? 'Pflanzdatum' : null,
        !row.bed ? 'Beet' : null,
      ].filter(Boolean);
      return missing.length > 0
        ? `Folgende Pflichtfelder müssen ausgefüllt werden: ${missing.join(', ')}`
        : null;
    });
    const createSpy = vi.spyOn(props.api, 'create');
    const plantingPlanColumns: GridColDef[] = [
      { field: 'crop', headerName: 'Kultur', editable: true },
      { field: 'planting_date', headerName: 'Pflanzdatum', editable: true },
      { field: 'bed', headerName: 'Beet', editable: true },
    ];

    render(
      <EditableDataGrid
        {...props}
        columns={plantingPlanColumns}
        createNewRow={() => ({
          id: -1,
          isNew: true,
          crop: 1,
          planting_date: '',
          bed: '',
        } as TestGridRow)}
        showDeleteAction={false}
      />,
    );

    await screen.findByRole('button', { name: 'Zelle 1-crop' });
    fireEvent.click(await screen.findByLabelText('Neu'));
    const cropCell = await screen.findByRole('button', { name: 'Zelle -1-crop' });
    fireEvent.click(cropCell);

    fireEvent.keyDown(cropCell, { key: 'Tab' });

    await waitFor(() => expect(screen.getByTestId('focused-cell')).toHaveTextContent('-1-planting_date'));
    expect(screen.queryByText(/Folgende Pflichtfelder müssen ausgefüllt werden/)).not.toBeInTheDocument();
    expect(createSpy).not.toHaveBeenCalled();

    fireEvent.keyDown(await screen.findByRole('button', { name: 'Zelle -1-planting_date' }), {
      key: 'Tab',
      shiftKey: true,
    });

    await waitFor(() => expect(screen.getByTestId('focused-cell')).toHaveTextContent('-1-crop'));
    expect(screen.queryByText(/Folgende Pflichtfelder müssen ausgefüllt werden/)).not.toBeInTheDocument();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('skips read-only cells during keyboard navigation', async () => {
    const props = baseProps();
    const columnsWithReadOnlyMiddle: GridColDef[] = [
      { field: 'name', headerName: 'Name', editable: true },
      { field: 'area_sqm', headerName: 'Fläche', editable: false },
      { field: 'notes', headerName: 'Notizen', editable: true },
    ];

    render(
      <EditableDataGrid
        {...props}
        columns={columnsWithReadOnlyMiddle}
        showDeleteAction={false}
      />,
    );

    const nameCell = await screen.findByRole('button', { name: 'Zelle 1-name' });
    fireEvent.keyDown(nameCell, {
      key: 'ArrowRight',
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    await waitFor(() => expect(screen.getByTestId('focused-cell')).toHaveTextContent('1-notes'));
    expect(screen.getByTestId('focused-cell')).not.toHaveTextContent('1-area_sqm');
  });

  it('keeps tabbing through an edited row when columns to the left are hidden', async () => {
    // Regression: the planting plans grid hides both harvest-date columns
    // below the `lg` breakpoint. Resolving the scroll target with MUI's
    // `getColumnIndexRelativeToVisibleColumns` (which counts hidden columns)
    // made `scrollToIndexes` throw, and the exception aborted the Tab
    // handler — Tab out of "Pflanzdatum" reached "Fläche" and then went dead,
    // never arriving at "Pflanzen".
    const props = baseProps(() => null);
    const plantingPlanColumns: GridColDef[] = [
      { field: 'crop', headerName: 'Kultur', editable: true },
      { field: 'planting_date', headerName: 'Pflanzdatum', editable: true },
      { field: 'harvest_date', headerName: 'Erntebeginn', editable: false },
      { field: 'harvest_end_date', headerName: 'Ernteende', editable: false },
      { field: 'area_sqm', headerName: 'Fläche', editable: true },
      { field: 'plants_count', headerName: 'Pflanzen', editable: true },
    ];

    render(
      <EditableDataGrid
        {...props}
        columns={plantingPlanColumns}
        columnVisibilityModel={{ harvest_date: false, harvest_end_date: false }}
        showDeleteAction={false}
      />,
    );

    const dateCell = await screen.findByRole('button', { name: 'Zelle 1-planting_date' });
    fireEvent.click(dateCell);
    await waitFor(() => expect(screen.getByTestId('mode-1')).toHaveTextContent('edit'));

    fireEvent.keyDown(dateCell, { key: 'Tab' });
    await waitFor(() => expect(screen.getByTestId('focused-cell')).toHaveTextContent('1-area_sqm'));

    fireEvent.keyDown(await screen.findByRole('button', { name: 'Zelle 1-area_sqm' }), { key: 'Tab' });
    await waitFor(() => expect(screen.getByTestId('focused-cell')).toHaveTextContent('1-plants_count'));

    fireEvent.keyDown(await screen.findByRole('button', { name: 'Zelle 1-plants_count' }), {
      key: 'Tab',
      shiftKey: true,
    });
    await waitFor(() => expect(screen.getByTestId('focused-cell')).toHaveTextContent('1-area_sqm'));
  });

  describe('dialog-edited cells', () => {
    const dialogColumns: GridColDef[] = [
      { field: 'name', headerName: 'Name', editable: true },
      { field: 'area_sqm', headerName: 'Anbaufläche', editable: false },
      { field: 'notes', headerName: 'Notizen', editable: true },
    ];

    const renderWithDialogColumn = (
      overrides: Partial<Parameters<typeof EditableDataGrid>[0]> = {},
    ) => {
      const props = baseProps(() => null);
      render(
        <EditableDataGrid
          {...props}
          columns={dialogColumns}
          dialogEditFields={['area_sqm']}
          showDeleteAction={false}
          {...overrides}
        />,
      );
      return props;
    };

    it('never opens the inline edit mode when the cell is clicked', async () => {
      renderWithDialogColumn();

      const cell = await screen.findByRole('button', { name: 'Zelle 1-area_sqm' });
      fireEvent.click(cell);

      expect(screen.getByTestId('mode-1')).toHaveTextContent('view');
      expect(mockSetEditCellValue).not.toHaveBeenCalled();
    });

    it('ignores F2 and printable keys that would start the inline editor', async () => {
      renderWithDialogColumn();

      const cell = await screen.findByRole('button', { name: 'Zelle 1-area_sqm' });
      fireEvent.keyDown(cell, { key: 'F2' });
      fireEvent.keyDown(cell, { key: '5' });

      expect(screen.getByTestId('mode-1')).toHaveTextContent('view');
      expect(mockSetEditCellValue).not.toHaveBeenCalled();
    });

    it('stays a keyboard navigation stop even though the column is not editable', async () => {
      renderWithDialogColumn();

      const nameCell = await screen.findByRole('button', { name: 'Zelle 1-name' });
      fireEvent.keyDown(nameCell, {
        key: 'ArrowRight',
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      });

      await waitFor(() => expect(screen.getByTestId('focused-cell')).toHaveTextContent('1-area_sqm'));
    });

    it('saves the row right away when the dialog applies values in view mode', async () => {
      const commandApiRef: { current: EditableDataGridCommandApi | null } = { current: null };
      const props = renderWithDialogColumn({ commandApiRef });
      const updateSpy = vi.spyOn(props.api, 'update');

      await waitFor(() => expect(commandApiRef.current).not.toBeNull());
      await act(async () => {
        await commandApiRef.current?.applyDialogEditValues(1, { area_sqm: 42 });
      });

      await waitFor(() => expect(updateSpy).toHaveBeenCalledWith(1, expect.objectContaining({ area_sqm: 42 })));
      expect(screen.getByTestId('mode-1')).toHaveTextContent('view');
    });

    it('only feeds the open draft when the row is already being edited', async () => {
      const commandApiRef: { current: EditableDataGridCommandApi | null } = { current: null };
      const props = renderWithDialogColumn({ commandApiRef });
      const updateSpy = vi.spyOn(props.api, 'update');

      await waitFor(() => expect(commandApiRef.current).not.toBeNull());
      fireEvent.click(await screen.findByRole('button', { name: 'Zelle 1-name' }));
      await waitFor(() => expect(screen.getByTestId('mode-1')).toHaveTextContent('edit'));

      await act(async () => {
        await commandApiRef.current?.applyDialogEditValues(1, { area_sqm: 42 });
      });

      expect(updateSpy).not.toHaveBeenCalled();
      expect(screen.getByTestId('mode-1')).toHaveTextContent('edit');

      fireEvent.click(screen.getByRole('button', { name: 'Enter speichern 1' }));
      await waitFor(() => expect(updateSpy).toHaveBeenCalledWith(1, expect.objectContaining({ area_sqm: 42 })));
    });
  });

  it('focuses the next editable row cell once after Tab saves the edited row', async () => {
    const props = baseProps(() => null);
    vi.spyOn(props.api, 'list').mockResolvedValue({
      data: {
        results: [
          createGridRow({ id: 1, name: 'Beet A', area_sqm: 12 }),
          createGridRow({ id: 2, name: 'Beet B', area_sqm: 8 }),
        ],
      },
    });
    const updateSpy = vi.spyOn(props.api, 'update');

    render(<EditableDataGrid {...props} showDeleteAction={false} />);

    const lastEditableCell = await screen.findByRole('button', { name: 'Zelle 1-area_sqm' });
    fireEvent.click(lastEditableCell);
    await waitFor(() => expect(screen.getByTestId('mode-1')).toHaveTextContent('edit'));

    mockSetCellFocus.mockClear();
    fireEvent.keyDown(lastEditableCell, {
      key: 'Tab',
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalled();
      expect(mockSetCellFocus).toHaveBeenCalledTimes(1);
      expect(mockSetCellFocus).toHaveBeenCalledWith(2, 'name');
      expect(screen.getByTestId('focused-cell')).toHaveTextContent('2-name');
    });
  });

  it('keeps internal focus synchronized after Enter save so ArrowUp moves to the edited row', async () => {
    await editSecondRowAndSaveWithEnter();

    pressCellKey(3, 'name', 'ArrowUp');

    await waitFor(() => expect(screen.getByTestId('focused-cell')).toHaveTextContent('2-name'));
  });

  it('keeps internal focus synchronized after Enter save so ArrowDown moves immediately to the following row', async () => {
    await editSecondRowAndSaveWithEnter();

    pressCellKey(3, 'name', 'ArrowDown');

    await waitFor(() => expect(screen.getByTestId('focused-cell')).toHaveTextContent('4-name'));
  });

  it('keeps internal focus synchronized after Enter save so Tab starts from the visible cell', async () => {
    await editSecondRowAndSaveWithEnter();

    pressCellKey(3, 'name', 'Tab');

    await waitFor(() => expect(screen.getByTestId('focused-cell')).toHaveTextContent('3-area_sqm'));
  });

  it('keeps internal focus synchronized after Enter save so Shift+Tab starts from the visible cell', async () => {
    await editSecondRowAndSaveWithEnter();

    pressCellKey(3, 'name', 'Tab', { shiftKey: true });

    await waitFor(() => expect(screen.getByTestId('focused-cell')).toHaveTextContent('2-area_sqm'));
  });

  it('keeps keyboard navigation anchored after Escape cancels an edit', async () => {
    renderGridWithKeyboardRows();
    fireEvent.click(await screen.findByRole('button', { name: 'Zelle 2-name' }));
    await waitFor(() => expect(screen.getByTestId('mode-2')).toHaveTextContent('edit'));

    fireEvent.click(screen.getByRole('button', { name: 'ESC 2' }));
    await waitFor(() => expect(screen.getByTestId('focused-cell')).toHaveTextContent('2-name'));

    pressCellKey(2, 'name', 'ArrowUp');
    await waitFor(() => expect(screen.getByTestId('focused-cell')).toHaveTextContent('1-name'));

    pressCellKey(1, 'name', 'ArrowDown');
    await waitFor(() => expect(screen.getByTestId('focused-cell')).toHaveTextContent('2-name'));
  });

  it('keeps keyboard navigation anchored after a mouse-selected cell returns to view mode', async () => {
    renderGridWithKeyboardRows();
    fireEvent.click(await screen.findByRole('button', { name: 'Zelle 3-name' }));
    await waitFor(() => expect(screen.getByTestId('focused-cell')).toHaveTextContent('3-name'));
    fireEvent.click(screen.getByRole('button', { name: 'ESC 3' }));
    await waitFor(() => expect(screen.getByTestId('mode-3')).toHaveTextContent('view'));

    pressCellKey(3, 'name', 'ArrowUp');
    await waitFor(() => expect(screen.getByTestId('focused-cell')).toHaveTextContent('2-name'));

    pressCellKey(2, 'name', 'ArrowDown');
    await waitFor(() => expect(screen.getByTestId('focused-cell')).toHaveTextContent('3-name'));
  });

  it('keeps focus on the first row when Enter saves it and ArrowUp is pressed', async () => {
    renderGridWithKeyboardRows();
    fireEvent.click(await screen.findByRole('button', { name: 'Zelle 1-name' }));
    await waitFor(() => expect(screen.getByTestId('mode-1')).toHaveTextContent('edit'));

    fireEvent.click(screen.getByRole('button', { name: 'Eingabe per Return 1' }));
    await waitFor(() => expect(screen.getByTestId('focused-cell')).toHaveTextContent('2-name'));

    pressCellKey(2, 'name', 'ArrowUp');
    await waitFor(() => expect(screen.getByTestId('focused-cell')).toHaveTextContent('1-name'));
  });

  it('keeps focus on the last row when Enter saves it without a following row', async () => {
    renderGridWithKeyboardRows();
    fireEvent.click(await screen.findByRole('button', { name: 'Zelle 4-name' }));
    await waitFor(() => expect(screen.getByTestId('mode-4')).toHaveTextContent('edit'));

    fireEvent.click(screen.getByRole('button', { name: 'Eingabe per Return 4' }));
    await waitFor(() => expect(screen.getByTestId('focused-cell')).toHaveTextContent('4-name'));

    pressCellKey(4, 'name', 'ArrowDown');
    await waitFor(() => expect(screen.getByTestId('focused-cell')).toHaveTextContent('4-name'));
  });

  it('shows required-field validation when explicitly saving an incomplete new row', async () => {
    const props = baseProps((row) => {
      const missing = [
        !row.planting_date ? 'Pflanzdatum' : null,
        !row.bed ? 'Beet' : null,
      ].filter(Boolean);
      return missing.length > 0
        ? `Folgende Pflichtfelder müssen ausgefüllt werden: ${missing.join(', ')}`
        : null;
    });
    const createSpy = vi.spyOn(props.api, 'create');
    const plantingPlanColumns: GridColDef[] = [
      { field: 'crop', headerName: 'Kultur', editable: true },
      { field: 'planting_date', headerName: 'Pflanzdatum', editable: true },
      { field: 'bed', headerName: 'Beet', editable: true },
    ];

    render(
      <EditableDataGrid
        {...props}
        columns={plantingPlanColumns}
        createNewRow={() => ({
          id: -1,
          isNew: true,
          crop: 1,
          planting_date: '',
          bed: '',
        } as TestGridRow)}
        showDeleteAction={false}
      />,
    );

    await screen.findByRole('button', { name: 'Zelle 1-crop' });
    fireEvent.click(await screen.findByLabelText('Neu'));
    const saveDraftButton = await screen.findByRole('button', { name: 'Blur speichern -1' });
    fireEvent.click(saveDraftButton);

    expect(await screen.findByText('Folgende Pflichtfelder müssen ausgefüllt werden: Pflanzdatum, Beet')).toBeInTheDocument();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('shows row-bound save/cancel actions only while row is being edited', async () => {
    const user = userEvent.setup();
    render(
      <EditableDataGrid
        {...baseProps()}
        showDeleteAction={false}
        showFooterEditControls={false}
        showRowEditActions={true}
      />,
    );

    await waitFor(() => expect(screen.queryByRole('button', { name: 'actions.save' })).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Zelle 1-name' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'actions.save' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'actions.cancel' })).toBeInTheDocument();
    });
  });

  it('clears row dirty indicator after cancel', async () => {
    const user = userEvent.setup();
    render(
      <EditableDataGrid
        {...baseProps()}
        showDeleteAction={false}
        showFooterEditControls={false}
        showRowEditActions={true}
      />,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Zelle 1-name' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Zelle 1-name' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'actions.cancel' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'ESC 1' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'actions.cancel' })).not.toBeInTheDocument());
  });

  it('clears row dirty indicator after successful save', async () => {
    const user = userEvent.setup();
    const props = baseProps(() => null);
    const updateSpy = vi.spyOn(props.api, 'update');
    render(
      <EditableDataGrid
        {...props}
        showDeleteAction={false}
        showFooterEditControls={false}
        showRowEditActions={true}
      />,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Zelle 1-name' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Zelle 1-name' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'actions.save' })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('row-1')).toHaveAttribute('data-selected', 'true'));
    await user.click(screen.getByRole('button', { name: /Tab speichern 1/i }));
    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalled();
      expect(screen.getByTestId('mode-1')).toHaveTextContent('view');
      expect(screen.getByTestId('row-1')).toHaveAttribute('data-selected', 'false');
      expect(screen.getByTestId('focused-cell')).toHaveTextContent('1-name');
    });
  });

  it('opens contextual row actions without rendering a permanent action column', async () => {
    render(
      <EditableDataGrid
        {...baseProps()}
        showDeleteAction={false}
        showRowEditActions={false}
        duplicateRow={(row) => ({ ...row, id: -2, isNew: true })}
      />,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Zelle 1-name' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Löschen' })).not.toBeInTheDocument();

    const contextMenuEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    const stopPropagationSpy = vi.spyOn(contextMenuEvent, 'stopPropagation');
    fireEvent(screen.getByTestId('row-1'), contextMenuEvent);

    expect(screen.queryByRole('menuitem', { name: 'Bearbeiten' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Duplizieren' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Löschen' })).toBeInTheDocument();
    expect(contextMenuEvent.defaultPrevented).toBe(true);
    expect(stopPropagationSpy).toHaveBeenCalled();
  });

  it('opens row actions from a touch long-press and suppresses the trailing click, so the cell does not also enter edit mode', async () => {
    render(
      <EditableDataGrid
        {...baseProps()}
        showDeleteAction={false}
        showRowEditActions={false}
        duplicateRow={(row) => ({ ...row, id: -2, isNew: true })}
      />,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Zelle 1-name' })).toBeInTheDocument());
    const row = screen.getByTestId('row-1');

    let touchEndEvent: TouchEvent;
    vi.useFakeTimers();
    try {
      fireEvent.touchStart(row, { touches: [{ identifier: 1, clientX: 10, clientY: 10 }] });
      act(() => {
        vi.advanceTimersByTime(600);
      });
      // A real browser would synthesize a trailing click from this touchend
      // (which the grid would otherwise treat as a tap-to-edit on the cell
      // underneath) unless its default is prevented — jsdom doesn't perform
      // that synthesis itself, so defaultPrevented is the testable proxy.
      touchEndEvent = new TouchEvent('touchend', { bubbles: true, cancelable: true });
      fireEvent(row, touchEndEvent);
    } finally {
      vi.useRealTimers();
    }

    expect(screen.getByRole('menuitem', { name: 'Duplizieren' })).toBeInTheDocument();
    expect(touchEndEvent!.defaultPrevented).toBe(true);
    expect(screen.queryByTestId('mode-1')).not.toHaveTextContent('edit');
  });

  it('a tap outside the open row-action menu (on another cell) only closes it, and does not start editing that cell', async () => {
    render(
      <EditableDataGrid
        {...baseProps()}
        showDeleteAction={false}
        showRowEditActions={false}
        duplicateRow={(row) => ({ ...row, id: -2, isNew: true })}
      />,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Zelle 1-name' })).toBeInTheDocument());
    const firstRow = screen.getByTestId('row-1');
    const otherCell = screen.getByRole('button', { name: 'Zelle 1-area_sqm' });

    vi.useFakeTimers();
    try {
      fireEvent.touchStart(firstRow, { touches: [{ identifier: 1, clientX: 10, clientY: 10 }] });
      act(() => {
        vi.advanceTimersByTime(600);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(screen.getByRole('menuitem', { name: 'Duplizieren' })).toBeInTheDocument();

    // A tap that lands outside the menu, on a *different* cell, must only
    // dismiss the menu — not also start editing that cell.
    const outsideTap = new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [] });
    fireEvent(otherCell, outsideTap);

    expect(screen.queryByRole('menuitem', { name: 'Duplizieren' })).not.toBeInTheDocument();
    expect(outsideTap.defaultPrevented).toBe(true);
    expect(screen.queryByTestId('mode-1')).not.toHaveTextContent('edit');

    // A further, separate tap on that same cell now behaves completely
    // normally — the menu is closed, so nothing intercepts it.
    fireEvent.click(otherCell);

    await waitFor(() => expect(screen.getByTestId('mode-1')).toHaveTextContent('edit'));
  });

  it('a left click outside the open row-action menu only closes it before a second click can edit the cell', async () => {
    render(
      <EditableDataGrid
        {...baseProps()}
        showDeleteAction={false}
        showRowEditActions={false}
        duplicateRow={(row) => ({ ...row, id: -2, isNew: true })}
      />,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Zelle 1-name' })).toBeInTheDocument());
    const row = screen.getByTestId('row-1');
    const otherCell = screen.getByRole('button', { name: 'Zelle 1-area_sqm' });

    fireEvent.contextMenu(row);
    expect(screen.getByRole('menuitem', { name: 'Duplizieren' })).toBeInTheDocument();

    const pointerDownEvent = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 });
    fireEvent(otherCell, pointerDownEvent);
    const mouseDownEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
    fireEvent(otherCell, mouseDownEvent);
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    fireEvent(otherCell, clickEvent);

    expect(screen.queryByRole('menuitem', { name: 'Duplizieren' })).not.toBeInTheDocument();
    expect(pointerDownEvent.defaultPrevented).toBe(true);
    expect(mouseDownEvent.defaultPrevented).toBe(false);
    expect(clickEvent.defaultPrevented).toBe(true);
    expect(screen.queryByTestId('mode-1')).not.toHaveTextContent('edit');

    fireEvent.click(otherCell);

    await waitFor(() => expect(screen.getByTestId('mode-1')).toHaveTextContent('edit'));
  });

  it('ignores normal cell clicks while a row-action context menu is still open', async () => {
    render(
      <EditableDataGrid
        {...baseProps()}
        showDeleteAction={false}
        showRowEditActions={false}
        duplicateRow={(row) => ({ ...row, id: -2, isNew: true })}
      />,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Zelle 1-name' })).toBeInTheDocument());
    fireEvent.contextMenu(screen.getByTestId('row-1'));
    expect(screen.getByRole('menuitem', { name: 'Duplizieren' })).toBeInTheDocument();
    const otherCell = screen.getByText('Zelle 1-area_sqm').closest('button');
    expect(otherCell).not.toBeNull();

    fireEvent.click(otherCell as HTMLButtonElement);

    expect(screen.getByRole('menuitem', { name: 'Duplizieren' })).toBeInTheDocument();
    expect(screen.getByTestId('mode-1')).toHaveTextContent('view');
  });

  it('does not open row actions on a short tap (touch)', async () => {
    render(
      <EditableDataGrid
        {...baseProps()}
        showDeleteAction={false}
        showRowEditActions={false}
        duplicateRow={(row) => ({ ...row, id: -2, isNew: true })}
      />,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Zelle 1-name' })).toBeInTheDocument());
    const row = screen.getByTestId('row-1');

    vi.useFakeTimers();
    try {
      fireEvent.touchStart(row, { touches: [{ identifier: 1, clientX: 10, clientY: 10 }] });
      fireEvent.touchEnd(row);
      act(() => {
        vi.advanceTimersByTime(600);
      });
    } finally {
      vi.useRealTimers();
    }

    expect(screen.queryByRole('menuitem', { name: 'Duplizieren' })).not.toBeInTheDocument();
  });

  it('keeps row actions right-click only without a hover trigger', async () => {
    render(
      <EditableDataGrid
        {...baseProps()}
        showDeleteAction={false}
        showRowEditActions={false}
        duplicateRow={(row) => ({ ...row, id: -2, isNew: true })}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('row-1')).toBeInTheDocument());
    fireEvent.mouseMove(screen.getByTestId('row-1'));

    expect(screen.queryByRole('button', { name: 'Aktionen' })).not.toBeInTheDocument();

    fireEvent.contextMenu(screen.getByTestId('row-1'));

    expect(screen.queryByRole('menuitem', { name: 'Bearbeiten' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Duplizieren' })).toBeInTheDocument();
  });

  it('renders configured inline row actions inside the requested cell', async () => {
    const props = baseProps();
    const deleteSpy = vi.spyOn(props.api, 'delete');
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <EditableDataGrid
        {...props}
        showDeleteAction={false}
        inlineRowActionField="name"
        getInlineRowActions={(row, helpers) => [
          {
            id: 'delete',
            label: 'Löschen',
            onClick: () => helpers.delete(row.id),
          },
        ]}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('row-1')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Löschen' }));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(1));
  });

  it('renders configured inline row actions when the requested cell is empty', async () => {
    const props = basePropsWithRows([createGridRow({ id: 1, name: '', area_sqm: 12 })]);
    const deleteSpy = vi.spyOn(props.api, 'delete');
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <EditableDataGrid
        {...props}
        showDeleteAction={false}
        inlineRowActionField="name"
        getInlineRowActions={(row, helpers) => [
          {
            id: 'delete',
            label: 'Löschen',
            onClick: () => helpers.delete(row.id),
          },
        ]}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('row-1')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Löschen' }));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(1));
  });

  it('opens the contextual row action menu from the configured inline actions cell', async () => {
    render(
      <EditableDataGrid
        {...baseProps()}
        showDeleteAction={false}
        inlineRowActionField="name"
        showInlineRowActionMenu
        duplicateRow={(row) => ({ ...row, id: -2, isNew: true })}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('row-1')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Aktionen' }));

    expect(screen.getByRole('menuitem', { name: 'Duplizieren' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Löschen' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'actions.copyRow' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'actions.copyTable' })).toBeInTheDocument();
  });

  it('opens the app context menu (not the native one) when right-clicking directly on the inline action icon', async () => {
    render(
      <EditableDataGrid
        {...baseProps()}
        showDeleteAction={false}
        inlineRowActionField="name"
        showInlineRowActionMenu
        duplicateRow={(row) => ({ ...row, id: -2, isNew: true })}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('row-1')).toBeInTheDocument());
    const actionsButton = screen.getByRole('button', { name: 'Aktionen' });
    // A real right-click on a MUI IconButton icon lands on the inner SVG
    // <path>, an SVGElement rather than an HTMLElement - regression guard
    // for the bug where such right-clicks fell through to the native menu.
    const iconPath = actionsButton.querySelector('svg path');
    expect(iconPath).not.toBeNull();

    const contextMenuEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    fireEvent(iconPath as Element, contextMenuEvent);

    expect(screen.getByRole('menuitem', { name: 'Duplizieren' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Löschen' })).toBeInTheDocument();
    expect(contextMenuEvent.defaultPrevented).toBe(true);
  });

  it('left-click on the inline action icon still works normally after the context-menu fix', async () => {
    render(
      <EditableDataGrid
        {...baseProps()}
        showDeleteAction={false}
        inlineRowActionField="name"
        showInlineRowActionMenu
        duplicateRow={(row) => ({ ...row, id: -2, isNew: true })}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('row-1')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Aktionen' }));

    expect(screen.getByRole('menuitem', { name: 'Duplizieren' })).toBeInTheDocument();
  });

  it('duplicates a row from the contextual menu and starts editing the copy', async () => {
    const user = userEvent.setup();
    render(
      <EditableDataGrid
        {...baseProps()}
        showDeleteAction={false}
        showRowEditActions={false}
        duplicateRow={(row) => ({ ...row, id: -2, isNew: true })}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('row-count')).toHaveTextContent('1'));
    fireEvent.contextMenu(screen.getByTestId('row-1'));
    await user.click(screen.getByRole('menuitem', { name: 'Duplizieren' }));

    await waitFor(() => expect(screen.getByTestId('row-count')).toHaveTextContent('2'));
    expect(screen.getByTestId('mode--2')).toHaveTextContent('edit');
  });

  it('runs delete from the contextual row action menu', async () => {
    const user = userEvent.setup();
    const props = baseProps();
    const deleteSpy = vi.spyOn(props.api, 'delete');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <EditableDataGrid
        {...props}
        showDeleteAction={false}
        showRowEditActions={false}
        duplicateRow={(row) => ({ ...row, id: -2, isNew: true })}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('row-1')).toBeInTheDocument());
    fireEvent.contextMenu(screen.getByTestId('row-1'));
    await user.click(screen.getByRole('menuitem', { name: 'Löschen' }));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(1));
  });

  it('deletes a row in the backend right away and recreates it from the delete undo snackbar', async () => {
    const user = userEvent.setup();
    const props = serverBackedProps([createGridRow({ id: 1 }), createGridRow({ id: 2, name: 'Beet B' })]);
    const confirmSpy = vi.spyOn(window, 'confirm');

    render(
      <EditableDataGrid
        {...props}
        showDeleteAction={false}
        showRowEditActions={false}
        duplicateRow={(row) => ({ ...row, id: -2, isNew: true })}
        deleteUndoOptions={{ message: 'Anbauplan gelöscht' }}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('row-1')).toBeInTheDocument());
    fireEvent.contextMenu(screen.getByTestId('row-1'));
    await user.click(screen.getByRole('menuitem', { name: 'Löschen' }));

    expect(screen.queryByTestId('row-1')).not.toBeInTheDocument();
    // The delete is already persisted while undo is still offered — a reload
    // at this point must not bring the row back.
    await waitFor(() => expect(props.api.delete).toHaveBeenCalledWith(1));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(await screen.findByText('Anbauplan gelöscht')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Rückgängig: Anbauplan gelöscht' }));

    await waitFor(() => expect(props.api.create).toHaveBeenCalledWith({
      name: 'Beet A',
      area_sqm: 12,
      notes: '',
    }));
    await waitFor(() => expect(screen.getByTestId('row-count')).toHaveTextContent('2'));
    expect(screen.getByTestId('row-100')).toBeInTheDocument();
  });

  it('does not defer the backend delete until the undo window has passed', async () => {
    const props = baseProps();
    const deleteSpy = vi.spyOn(props.api, 'delete');

    render(
      <EditableDataGrid
        {...props}
        showDeleteAction={false}
        showRowEditActions={false}
        duplicateRow={(row) => ({ ...row, id: -2, isNew: true })}
        deleteUndoOptions={{ message: 'Anbauplan gelöscht' }}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('row-1')).toBeInTheDocument());
    fireEvent.contextMenu(screen.getByTestId('row-1'));
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Löschen' }));
    });

    expect(deleteSpy).toHaveBeenCalledWith(1);
  });

  it('puts the row back and reports the error when the immediate delete fails', async () => {
    const props = baseProps();
    vi.spyOn(props.api, 'list').mockResolvedValue({
      data: { results: [createGridRow({ id: 1 }), createGridRow({ id: 2, name: 'Beet B' })] },
    });
    vi.spyOn(props.api, 'delete').mockRejectedValue(new Error('boom'));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <EditableDataGrid
        {...props}
        showDeleteAction={false}
        showRowEditActions={false}
        duplicateRow={(row) => ({ ...row, id: -2, isNew: true })}
        deleteUndoOptions={{ message: 'Anbauplan gelöscht' }}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('row-1')).toBeInTheDocument());
    fireEvent.contextMenu(screen.getByTestId('row-1'));
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Löschen' }));
    });

    expect(screen.getByTestId('row-1')).toBeInTheDocument();
    expect(screen.queryByText('Anbauplan gelöscht')).not.toBeInTheDocument();
    expect(screen.getByText('Löschen fehlgeschlagen')).toBeInTheDocument();
    consoleErrorSpy.mockRestore();
  });

  it('discards an unsaved new row without backend delete or undo state', async () => {
    const user = userEvent.setup();
    const props = baseProps();
    const deleteSpy = vi.spyOn(props.api, 'delete');
    const confirmSpy = vi.spyOn(window, 'confirm');

    render(
      <EditableDataGrid
        {...props}
        deleteUndoOptions={{ message: 'Anbauplan gelöscht' }}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('row-1')).toBeInTheDocument());
    await user.click(screen.getByLabelText('Neu'));
    await waitFor(() => expect(screen.getByTestId('row--1')).toBeInTheDocument());
    await user.click(within(screen.getByTestId('row--1')).getByLabelText('Löschen'));

    expect(screen.queryByTestId('row--1')).not.toBeInTheDocument();
    expect(screen.queryByText('Anbauplan gelöscht')).not.toBeInTheDocument();
    expect(screen.getByTestId('focused-cell')).not.toHaveTextContent('-1-');
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('handles multiple immediate deletions independently', async () => {
    const user = userEvent.setup();
    const props = serverBackedProps([createGridRow({ id: 1 }), createGridRow({ id: 2, name: 'Beet B' })]);

    render(
      <EditableDataGrid
        {...props}
        showDeleteAction={false}
        showRowEditActions={false}
        duplicateRow={(row) => ({ ...row, id: -3, isNew: true })}
        deleteUndoOptions={{ message: 'Anbauplan gelöscht' }}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('row-1')).toBeInTheDocument());
    fireEvent.contextMenu(screen.getByTestId('row-1'));
    await user.click(screen.getByRole('menuitem', { name: 'Löschen' }));
    fireEvent.contextMenu(screen.getByTestId('row-2'));
    await user.click(screen.getByRole('menuitem', { name: 'Löschen' }));

    expect(screen.queryByTestId('row-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('row-2')).not.toBeInTheDocument();
    await waitFor(() => expect(props.api.delete).toHaveBeenCalledWith(1));
    expect(props.api.delete).toHaveBeenCalledWith(2);

    const undoButtons = await screen.findAllByRole('button', { name: 'Rückgängig: Anbauplan gelöscht' });
    expect(undoButtons).toHaveLength(2);
    await user.click(undoButtons[0]);

    // Only the undone row is recreated; the second deletion stays deleted and
    // keeps its own snackbar.
    await waitFor(() => expect(props.api.create).toHaveBeenCalledTimes(1));
    expect(props.api.create).toHaveBeenCalledWith({ name: 'Beet A', area_sqm: 12, notes: '' });
    await waitFor(() => expect(screen.getByTestId('row-100')).toBeInTheDocument());
    expect(screen.queryByTestId('row-2')).not.toBeInTheDocument();
  });

  it('reloads the restored row from the backend after undo', async () => {
    const user = userEvent.setup();
    const props = serverBackedProps([createGridRow({ id: 1 }), createGridRow({ id: 2, name: 'Beet B' })]);

    render(
      <EditableDataGrid
        {...props}
        showDeleteAction={false}
        showRowEditActions={false}
        duplicateRow={(row) => ({ ...row, id: -2, isNew: true })}
        deleteUndoOptions={{ message: 'Anbauplan gelöscht' }}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('row-1')).toBeInTheDocument());
    fireEvent.contextMenu(screen.getByTestId('row-1'));
    await user.click(screen.getByRole('menuitem', { name: 'Löschen' }));
    await user.click(await screen.findByRole('button', { name: 'Rückgängig: Anbauplan gelöscht' }));

    // The restore recreates the record, so the row comes back with the id the
    // backend assigned rather than the id it had before the delete.
    await waitFor(() => expect(screen.getByTestId('row-100')).toBeInTheDocument());
    expect(screen.getAllByRole('row').map((row) => row.getAttribute('data-id'))).toEqual(['2', '100']);
  });

  it('keeps the delete persisted when the grid unmounts right after deleting', async () => {
    const props = baseProps();
    const deleteSpy = vi.spyOn(props.api, 'delete');
    const { unmount } = render(
      <EditableDataGrid
        {...props}
        showDeleteAction={false}
        showRowEditActions={false}
        duplicateRow={(row) => ({ ...row, id: -2, isNew: true })}
        deleteUndoOptions={{ message: 'Anbauplan gelöscht' }}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('row-1')).toBeInTheDocument());
    fireEvent.contextMenu(screen.getByTestId('row-1'));
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Löschen' }));
    });
    unmount();

    // Leaving the page (or reloading it) must not undo the delete.
    expect(deleteSpy).toHaveBeenCalledWith(1);
  });

  it('keeps inline editing available when contextual actions are enabled', async () => {
    const user = userEvent.setup();
    render(
      <EditableDataGrid
        {...baseProps()}
        showDeleteAction={false}
        showRowEditActions={false}
        duplicateRow={(row) => ({ ...row, id: -2, isNew: true })}
      />,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Zelle 1-name' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Zelle 1-name' }));

    await waitFor(() => expect(screen.getByTestId('mode-1')).toHaveTextContent('edit'));
  });
});
