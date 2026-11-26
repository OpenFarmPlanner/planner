import { describe, expect, it } from 'vitest';
import type { GridColDef } from '@mui/x-data-grid';
import { measureGridColumn } from '../components/data-grid/gridContentWidths';

describe('content-based grid column widths', () => {
  const measure = ({ text }: { text: string }) => text.length * 10;

  it('sizes a short flat column from the formatted value and leaves spare space', () => {
    const column: GridColDef<{ area: number }> = {
      field: 'area',
      headerName: 'm²',
      valueFormatter: value => `${value.toLocaleString('de-AT')} m²`,
      sortable: false,
      disableColumnMenu: true,
    };
    expect(measureGridColumn(column, [{ area: 1234 }], undefined, measure, true)).toBe(102);
  });

  it('fits the displayed heading and controls even when the heading exceeds the automatic content limit', () => {
    const column = { field: 'sowing', headerName: 'Sowing date' };
    const header = { text: 'Datum für die erste Aussaat', extra: 20, fontWeight: 500 };
    expect(measureGridColumn(column, [], { header, defaultMax: 250 }, measure, true)).toBe(360);
  });

  it('lets an explicit fit exceed both the default cap and the old manual ceiling', () => {
    const column = { field: 'crop', headerName: 'Crop' };
    const rows = [{ crop: 'Kultur'.repeat(20) }];
    expect(measureGridColumn(column, rows, undefined, measure, true)).toBe(250);
    expect(measureGridColumn(column, rows, undefined, measure, false)).toBe(1222);
    expect(measureGridColumn({ ...column, maxWidth: 140 }, rows, undefined, measure, false)).toBe(140);
  });
});
