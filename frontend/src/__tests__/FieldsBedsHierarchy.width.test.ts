import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { measureGridColumn } from '../components/data-grid/gridContentWidths';
import { measureHierarchyName } from '../components/hierarchy/utils/hierarchyNameColumnWidth';
import type { HierarchyRow } from '../components/hierarchy/utils/types';
import { getHierarchyGridHeight } from '../pages/fieldsBedsHierarchyStyles';

describe('fields-beds hierarchy name column width', () => {
  const t = (() => '3 Einzelpflanzen') as unknown as TFunction;
  const bed: HierarchyRow = { id: 'bed-1', name: 'Gründüngungsversuch', level: 2, type: 'bed', bedId: 1 };
  const plan: HierarchyRow = { id: 'plan-1', name: 'Karotten', level: 3, type: 'individualPlan', individualPlantCount: 3 };

  it('measures indentation, expand slots and leading icons without allocating action space', () => {
    expect(measureHierarchyName(bed, t, false)).toMatchObject({ text: bed.name, extra: 100 });
    expect(measureHierarchyName({ ...bed, level: 1 }, t, false)).toMatchObject({ text: bed.name, extra: 76 });
    expect(measureHierarchyName({ ...bed, bedId: undefined }, t, false)).toEqual(measureHierarchyName(bed, t, false));
    expect(measureHierarchyName(plan, t, true)).toMatchObject({ text: 'Karotten · 3 Einzelpflanzen', extra: 140 });
  });

  it('caps defaults and uses the widest complete row for an explicit fit', () => {
    const longPlan = { ...plan, name: 'Lang'.repeat(30) };
    const deeperBed = { ...bed, level: 5 };
    const column = { field: 'name', headerName: 'Name' };
    const content = { cell: (row: HierarchyRow) => measureHierarchyName(row, t, false), defaultMax: 420 };
    const measure = ({ text }: { text: string }) => text.length * 8;
    expect(measureGridColumn(column, [deeperBed, longPlan], content, measure, true)).toBe(420);
    expect(measureGridColumn(column, [deeperBed, longPlan], content, measure, false)).toBe(1122);
  });
});

describe('fields-beds hierarchy grid height', () => {
  const scrollbar = 'var(--DataGrid-hasScrollX, 0) * var(--DataGrid-scrollbarSize, 0px)';

  it('sizes to the rows plus the horizontal scrollbar when nothing caps it', () => {
    expect(getHierarchyGridHeight(400, 400, null)).toBe(`calc(400px + ${scrollbar})`);
  });

  it('uses the tallest internal page rather than all rows', () => {
    expect(getHierarchyGridHeight(3600, 9000, undefined)).toBe(`calc(3600px + ${scrollbar})`);
  });

  it('caps the height at the available viewport space', () => {
    expect(getHierarchyGridHeight(3600, 9000, 610)).toBe(`min(calc(3600px + ${scrollbar}), 610px)`);
  });
});
