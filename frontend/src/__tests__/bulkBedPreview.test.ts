import { describe, expect, it } from 'vitest';
import type { Bed, BedLayoutEntry, Field } from '../api/types';
import { buildBulkBedPreview, getBulkBedPreviewContext } from '../components/hierarchy/utils/bulkBedPreview';
import type { BulkBedFormValues } from '../components/hierarchy/utils/bulkBedCreatePlan';
import { getGraphicalBedLayout } from '../pages/graphicalAreaGeometry';
import { rotateRect, type GraphicalRotation } from '../pages/graphicalLayoutUtils';

const field: Field = { id: 1, location: 1, name: 'Parcel', length_m: 75, width_m: 85 };
const existing: Bed[] = [
  { id: 2, field: 1, name: 'Short patch', width_m: 4, length_m: 8 },
  { id: 3, field: 1, name: 'Long patch', width_m: 2, length_m: 25 },
];
const saved: Record<number, BedLayoutEntry> = { 2: { bed: 2, location: 1, x: 200, y: 20 } };
const values: BulkBedFormValues = { orientation: 'length', lengthM: 10, widthM: 1.2, pathM: 0.45,
  count: '200', firstName: 'Batch 1' };
const names = Array.from({ length: 200 }, (_, index) => `Batch ${index + 1}`);

describe('bulk bed geometry shared with the Graphic', () => {
  it('places 200 beds deterministically around mixed stored and inferred footprints', () => {
    const context = getBulkBedPreviewContext(field, existing, saved)!;
    const preview = buildBulkBedPreview(context, values, names, 0.45)!;
    expect(preview.beds).toHaveLength(200);
    expect(preview.insideCount).toBe(200);
    expect(preview.geometry.issues).toEqual([]);
    expect(preview.geometry.coverage.footprintArea).toBeCloseTo(200 * 12 + 8 * 4 + 2 * 25);
    expect(preview.geometry.coverage.remainingArea).toBeCloseTo(85 * 75 - 200 * 12 - 8 * 4 - 2 * 25);
    expect(buildBulkBedPreview(context, values, names.slice(0, 50), 0.45)?.placements)
      .toEqual(preview.placements.slice(0, 50));

    const newBeds = names.map((name, index) => ({ id: 100 + index, name, field: 1, width_m: 1.2, length_m: 10 }));
    const newLayouts = Object.fromEntries(preview.placements.map((placement, index) => [100 + index,
      { ...placement, bed: 100 + index, location: 1 }]));
    const rendered = getGraphicalBedLayout(field, [...existing, ...newBeds], { ...saved, ...newLayouts }, 0);
    for (const bed of context.existing) {
      const after = rendered.bedRects.find(rect => rect.id === bed.id)!;
      expect(after.x / rendered.pixelsPerMeter!.x).toBeCloseTo(bed.rect.x);
      expect(after.y / rendered.pixelsPerMeter!.y).toBeCloseTo(bed.rect.y);
    }
  });

  it.each([[20, 8], [8, 20], [12, 12]])('fills a %s × %s m parcel with uniform metrics in every rotation', (width, length) => {
    const parcel = { ...field, width_m: width, length_m: length };
    const oldBed = { ...existing[0], width_m: 1.2, length_m: 3 };
    const stored = { 2: { ...saved[2], x: 24, y: 12 } };
    const context = getBulkBedPreviewContext(parcel, [oldBed], stored)!;
    const orientations = ['length', 'width'] as const;
    for (const orientation of orientations) {
      const preview = buildBulkBedPreview(context, { ...values, lengthM: 3, orientation }, ['New bed'], 0.45)!;
      const placement = preview.placements[0];
      const newBed = { ...oldBed, id: 11, name: 'New bed' };
      const layouts = { ...stored, 11: { ...placement, bed: 11, location: 1 } };
      for (const rotation of [0, 90, 180, 270] satisfies GraphicalRotation[]) {
        const view = getGraphicalBedLayout(parcel, [oldBed, newBed], layouts, rotation);
        const scale = view.pixelsPerMeter!.x;
        expect(view.pixelsPerMeter!.y).toBe(scale);
        [preview.existing[0].rect, preview.beds[0].rect].forEach((rect, index) => {
          const expected = rotateRect(rect, preview.bounds, rotation);
          const actual = view.bedRects[index];
          expect(actual.x / scale).toBeCloseTo(expected.x);
          expect(actual.y / scale).toBeCloseTo(expected.y);
          expect(actual.width / scale).toBeCloseTo(expected.width);
          expect(actual.height / scale).toBeCloseTo(expected.height);
          expect(actual.width / actual.height).toBeCloseTo(expected.width / expected.height);
        });
      }
    }
  });

  it('keeps zero spacing, orientation and overflow distinct from the recommendation', () => {
    const context = getBulkBedPreviewContext({ ...field, width_m: 10, length_m: 3 }, [], {})!;
    const preview = buildBulkBedPreview(context, { ...values, orientation: 'width', pathM: 0 }, names.slice(0, 3), 0.45)!;
    expect(preview.insideCount).toBe(2);
    expect(preview.beds.map(({ rect }) => rect)).toEqual([
      { x: 0, y: 0, width: 10, height: 1.2 }, { x: 0, y: 1.2, width: 10, height: 1.2 },
      { x: 10, y: 0, width: 10, height: 1.2 },
    ]);
    expect(preview.placements.every(layout => layout.runs_across_parcel)).toBe(true);
    expect(preview.geometry.issues).toContainEqual({ kind: 'outside', id: -3 });
    expect(preview.geometry.issues).toContainEqual({ kind: 'shortGap', ids: [-2, -1], gapM: 0, recommendedM: 0.45 });
    expect(preview.geometry.coverage).toMatchObject({ footprintArea: 24, remainingArea: 6 });
    const lengthwise = buildBulkBedPreview(context, { ...values, pathM: 0 }, names.slice(0, 3), 0.45)!;
    expect(lengthwise.frame).toEqual(preview.frame);
  });

  it('reports incomplete geometry without inventing physical footprint and rejects invalid inputs', () => {
    expect(getBulkBedPreviewContext({ ...field, width_m: null }, existing, saved)).toBeNull();
    const context = getBulkBedPreviewContext(field, [{ ...existing[0], length_m: null }], saved)!;
    expect(buildBulkBedPreview(context, values, names.slice(0, 1), 0.45)?.geometry.coverage.remainingArea).toBeNull();
    for (const invalid of [{ pathM: -1 }, { widthM: Number.NaN }, { lengthM: Infinity }]) {
      expect(buildBulkBedPreview(context, { ...values, ...invalid }, names, 0.45)).toBeNull();
    }
  });
});
