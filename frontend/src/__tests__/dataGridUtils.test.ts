import { describe, it, expect, vi } from 'vitest';
import { GridRowEditStopReasons, GridRowModes } from '@mui/x-data-grid';
import type { GridSortModel } from '@mui/x-data-grid';
import { handleEditableCellClick, handleRowEditStop } from '../components/data-grid/handlers';
import { getPlainExcerpt, stripMarkdown } from '../components/data-grid/markdown';
import { buildDefaultClipboardColumns, getSortedRowIds, orderRowsByStableIds, prepareDataGridColumn } from '../components/data-grid/dataGridUtils';
import { formatDateAsGerman, parseGermanDateText, toGridDateValue } from '../components/data-grid/dateEditCellUtils';
import type { GridColDef } from '@mui/x-data-grid';
import type { EditableRow } from '../components/data-grid/types';

interface TestRow extends EditableRow {
  name: string;
}

describe('data-grid utility handlers', () => {
  it('enters edit mode on editable cell click when row is not already editing', () => {
    const setRowModesModel = vi.fn();

    handleEditableCellClick(
      { id: 1, field: 'name', isEditable: true } as never,
      {},
      setRowModesModel
    );

    expect(setRowModesModel).toHaveBeenCalledTimes(1);
    const updater = setRowModesModel.mock.calls[0][0] as (oldModel: Record<string, unknown>) => Record<string, unknown>;
    expect(updater({})).toEqual({
      1: { mode: GridRowModes.Edit, fieldToFocus: 'name' },
    });
  });

  it('does not change row mode for non-editable or already-editing cells', () => {
    const setRowModesModel = vi.fn();

    handleEditableCellClick(
      { id: 1, field: 'name', isEditable: false } as never,
      {},
      setRowModesModel
    );

    handleEditableCellClick(
      { id: 1, field: 'name', isEditable: true } as never,
      { 1: { mode: GridRowModes.Edit } },
      setRowModesModel
    );

    expect(setRowModesModel).not.toHaveBeenCalled();
  });

  it('prevents default grid behavior for escape key edit stop only', () => {
    const escapeEvent = { defaultMuiPrevented: false } as { defaultMuiPrevented: boolean };
    handleRowEditStop(
      { reason: GridRowEditStopReasons.escapeKeyDown } as never,
      escapeEvent as never
    );
    expect(escapeEvent.defaultMuiPrevented).toBe(true);

    const blurEvent = { defaultMuiPrevented: false } as { defaultMuiPrevented: boolean };
    handleRowEditStop(
      { reason: GridRowEditStopReasons.rowFocusOut } as never,
      blurEvent as never
    );
    expect(blurEvent.defaultMuiPrevented).toBe(false);
  });
});

describe('data-grid markdown utilities', () => {
  it('strips markdown syntax into plain text', () => {
    const markdown = `# Header\n\n**bold** and *italic* and __u__ and _i_\n\n[link](https://a.b)\n\n> quote\n\n- item\n1. num\n\n\
\
\`inline\`\n\n![img](x.png)`;

    const plain = stripMarkdown(markdown);

    expect(plain).toContain('Header');
    expect(plain).toContain('bold and italic and u and i');
    expect(plain).toContain('link');
    expect(plain).toContain('quote');
    expect(plain).toContain('item');
    expect(plain).toContain('num');
    expect(plain).toContain('inline');
    expect(plain).not.toContain('**');
    expect(plain).not.toContain('[');
  });

  it('returns empty values correctly and truncates excerpts', () => {
    expect(stripMarkdown('')).toBe('');
    expect(getPlainExcerpt('', 10)).toBe('');
    expect(getPlainExcerpt('   ', 10)).toBe('');

    const excerpt = getPlainExcerpt('Ein sehr langer Text ohne Markdown', 8);
    expect(excerpt).toBe('Ein sehr...');

    expect(getPlainExcerpt('Kurz', 10)).toBe('Kurz');
  });
});

// getSortedRowIds/orderRowsByStableIds back EditableDataGrid's stable client-side
// row order (see DataGrid.tsx's stableRowOrder/refreshStableRowOrder), which is
// what keeps every EditableDataGrid-based table (Anbaupläne/PlantingPlans,
// Crops, ...) from jumping a row to a new sorted position as a side effect of
// saving it — the order snapshot is only refreshed on load, an explicit sort
// change, or a filter change, never as a reaction to row data changing.
describe('stable row order (EditableDataGrid)', () => {
  const sortByNameAsc: GridSortModel = [{ field: 'name', sort: 'asc' }];

  it('keeps a renamed row in its snapshotted position instead of resorting live', () => {
    const rows: TestRow[] = [
      { id: 1, name: 'Ackerfeld' },
      { id: 2, name: 'Bergfeld' },
    ];
    const snapshot = getSortedRowIds(rows, sortByNameAsc);
    expect(snapshot).toEqual([1, 2]);

    // Renaming "Bergfeld" to "Aaa" would sort it first alphabetically, but
    // the snapshot wasn't refreshed by the save, so it must stay last.
    const renamedRows: TestRow[] = [
      { id: 1, name: 'Ackerfeld' },
      { id: 2, name: 'Aaa' },
    ];
    const ordered = orderRowsByStableIds(renamedRows, snapshot);
    expect(ordered.map((row) => row.id)).toEqual([1, 2]);
  });

  it('appends a newly created row at the end instead of at its sorted position', () => {
    const rows: TestRow[] = [{ id: 1, name: 'Bergfeld' }];
    const snapshot = getSortedRowIds(rows, sortByNameAsc);

    // A new draft row is appended to the raw rows array (as
    // DataGrid.tsx's handleAddClick does) and would sort before "Bergfeld"
    // — it must still render last since it's absent from the snapshot.
    const rowsWithNewDraft: TestRow[] = [...rows, { id: -1, name: 'Aaa', isNew: true }];
    const ordered = orderRowsByStableIds(rowsWithNewDraft, snapshot);
    expect(ordered.map((row) => row.id)).toEqual([1, -1]);
  });

  it('re-sorts to the current values when a fresh snapshot is taken (explicit sort / reload)', () => {
    const rows: TestRow[] = [
      { id: 1, name: 'Zoo' },
      { id: 2, name: 'Feld' },
    ];
    const freshSnapshot = getSortedRowIds(rows, sortByNameAsc);
    const ordered = orderRowsByStableIds(rows, freshSnapshot);
    expect(ordered.map((row) => row.name)).toEqual(['Feld', 'Zoo']);
  });

  it('falls back to array order when no sort is active', () => {
    const rows: TestRow[] = [
      { id: 2, name: 'Zoo' },
      { id: 1, name: 'Feld' },
    ];
    expect(getSortedRowIds(rows, [])).toEqual([2, 1]);
  });
});

describe('buildDefaultClipboardColumns', () => {
  it('drops id and action columns and falls back to the field name for missing headers', () => {
    const columns: GridColDef[] = [
      { field: 'id', headerName: 'ID' },
      { field: 'name', headerName: 'Name' },
      { field: 'width_m' },
      { field: 'actions', type: 'actions' },
      { field: 'rowActions', type: 'actions' },
    ];

    expect(buildDefaultClipboardColumns(columns)).toEqual([
      { field: 'name', headerName: 'Name' },
      { field: 'width_m', headerName: 'width_m' },
    ]);
  });
});

describe('toGridDateValue', () => {
  it('treats empty values as no date', () => {
    expect(toGridDateValue(null)).toBeNull();
    expect(toGridDateValue(undefined)).toBeNull();
    expect(toGridDateValue('')).toBeNull();
  });

  it('parses the ISO strings rows store dates as', () => {
    expect(toGridDateValue('2026-04-10')).toEqual(new Date('2026-04-10'));
  });

  it('parses the German text a date editor produces', () => {
    expect(toGridDateValue('10.04.2026')).toEqual(new Date(2026, 3, 10));
  });

  it('passes a valid Date through unchanged', () => {
    const date = new Date(2026, 3, 10);
    expect(toGridDateValue(date)).toBe(date);
  });

  it('reports unparseable input as no date instead of an Invalid Date', () => {
    expect(toGridDateValue('nicht datierbar')).toBeNull();
    expect(toGridDateValue(new Date('nope'))).toBeNull();
    expect(toGridDateValue({ year: 2026 })).toBeNull();
  });
});

describe('parseGermanDateText', () => {
  it('parses valid dd.MM.yyyy text into a local Date', () => {
    expect(parseGermanDateText('10.04.2026')).toEqual(new Date(2026, 3, 10));
    expect(parseGermanDateText('  5.1.2026 ')).toEqual(new Date(2026, 0, 5));
  });

  it('rejects malformed or non-existent dates', () => {
    expect(parseGermanDateText('2026-04-10')).toBeNull();
    expect(parseGermanDateText('31.02.2026')).toBeNull();
    expect(parseGermanDateText('nope')).toBeNull();
  });
});

describe('formatDateAsGerman', () => {
  it('formats a Date as zero-padded dd.MM.yyyy', () => {
    expect(formatDateAsGerman(new Date(2026, 3, 5))).toBe('05.04.2026');
  });

  it('returns an empty string for empty or invalid input', () => {
    expect(formatDateAsGerman(null)).toBe('');
    expect(formatDateAsGerman(undefined)).toBe('');
    expect(formatDateAsGerman(new Date('nope'))).toBe('');
  });
});

describe('prepareDataGridColumn', () => {
  it('keeps a column without its own renderHeader as bold as one that supplies its own', () => {
    const column = prepareDataGridColumn({ field: 'name', headerName: 'Name' } as GridColDef);

    expect(column.renderHeader).toBeTypeOf('function');
    const header = column.renderHeader?.({} as never) as { props: { sx?: Record<string, unknown> } };
    expect(header.props.sx).toMatchObject({ fontWeight: 600 });
  });

  it('leaves a column with its own renderHeader untouched', () => {
    const customRenderHeader = () => null;
    const column = prepareDataGridColumn({
      field: 'name',
      headerName: 'Name',
      renderHeader: customRenderHeader,
    } as GridColDef);

    expect(column.renderHeader).toBe(customRenderHeader);
  });
});
