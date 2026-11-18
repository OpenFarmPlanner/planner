import { describe, expect, it } from 'vitest';
import {
  calculateHierarchyNameColumnWidth,
  NAME_COLUMN_MEASUREMENT_RESERVE_PX,
  type HierarchyNameMeasureEntry,
} from '../components/hierarchy/utils/hierarchyNameColumnWidth';
import { getHierarchyGridHeight } from '../pages/fieldsBedsHierarchyStyles';

describe('fields-beds hierarchy name column width', () => {
  it('adds a small measurement reserve to the dynamic name width', () => {
    const entries: HierarchyNameMeasureEntry[] = [
      { name: 'Langer Name', level: 1, type: 'field' },
    ];

    const width = calculateHierarchyNameColumnWidth(entries, () => 240);

    expect(width).toBe(24 + 44 + 20 + 2 + 240 + NAME_COLUMN_MEASUREMENT_RESERVE_PX);
  });

  it('keeps hover action icons out of the name width calculation', () => {
    const entries: HierarchyNameMeasureEntry[] = [
      { name: 'Langes Beet', level: 2, type: 'bed' },
    ];
    const textWidth = 220;
    const assumedActionOverlayWidth = 64;

    const width = calculateHierarchyNameColumnWidth(entries, () => textWidth);

    expect(width).toBe(48 + 44 + 20 + 8 + 2 + textWidth + NAME_COLUMN_MEASUREMENT_RESERVE_PX);
    expect(width).toBeLessThan(
      48 + 44 + 20 + 8 + 2 + textWidth + NAME_COLUMN_MEASUREMENT_RESERVE_PX + assumedActionOverlayWidth,
    );
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
