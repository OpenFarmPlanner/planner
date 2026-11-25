import type { Bed, BedLayoutEntry, BulkBedPlacement, Field } from '../../../api/types';
import { getGraphicalBedLayout, getSchematicFieldSize } from '../../../pages/graphicalAreaGeometry';
import { DEFAULT_PLACEMENT_SPACING } from '../../../pages/graphicalLayoutUtils';
import { MAX_BULK_BED_COUNT } from './bedNaming';
import type { BulkBedFormValues } from './bulkBedCreatePlan';
import { validateAreaGeometry, type MetricRect } from './growingAreaGeometry';
import { placeRegularBeds } from './regularBedPlacement';

export function getBulkBedPreviewContext(
  field: Field, beds: readonly Bed[], layouts: Readonly<Record<number, BedLayoutEntry>>,
) {
  const graphical = getGraphicalBedLayout(field, getSchematicFieldSize(field), beds, layouts, 0);
  const { fieldMeters, pixelsPerMeter: displayScale, storedPixelsPerMeter: scale } = graphical;
  if (!fieldMeters || !displayScale || displayScale.x <= 0 || displayScale.y <= 0 || !scale) return null;
  const bounds = { x: 0, y: 0, ...fieldMeters };
  const existing = graphical.bedRects.map(bed => ({
    id: bed.id, name: bed.name, measured: bed.supportsMetricSpacing,
    rect: { x: bed.x / displayScale.x, y: bed.y / displayScale.y,
      width: bed.width / displayScale.x, height: bed.height / displayScale.y },
    // Keep all new positions clear of the Graphic's inferred positions by its
    // automatic layout margin, so adding saved positions cannot displace them.
    clearanceX: layouts[bed.id] ? 0 : (DEFAULT_PLACEMENT_SPACING + 0.00001) / scale.x,
    clearanceY: layouts[bed.id] ? 0 : (DEFAULT_PLACEMENT_SPACING + 0.00001) / scale.y,
  }));
  return { bounds, existing, scale };
}

export function buildBulkBedPreview(
  context: NonNullable<ReturnType<typeof getBulkBedPreviewContext>>,
  values: BulkBedFormValues,
  names: readonly string[],
  recommendedGapM: number,
) {
  const { bounds, existing, scale } = context;
  const { lengthM, widthM, pathM } = values;
  if (lengthM === null || widthM === null || !Number.isFinite(lengthM) || lengthM <= 0
      || !Number.isFinite(widthM) || widthM <= 0 || !Number.isFinite(pathM ?? 0) || (pathM ?? 0) < 0) return null;
  const across = values.orientation === 'width';
  const size = across ? { width: lengthM, height: widthM } : { width: widthM, height: lengthM };
  const maxGaps = Math.max(size.width, size.height, pathM ?? 0) * (MAX_BULK_BED_COUNT + 1);
  if (!Number.isFinite(maxGaps * Math.max(1, scale.x, scale.y))) return null;
  const proposal = placeRegularBeds(bounds, size, MAX_BULK_BED_COUNT, pathM ?? 0, existing, across);
  const beds = proposal.rectangles.slice(0, names.length).map((rect, index) => ({
    id: -1 - index, name: names[index], rect,
  }));
  // Include the extent of either orientation so the reference parcel and its
  // existing beds stay still even when switching exposes overflowing beds.
  const alternate = placeRegularBeds(bounds, { width: size.height, height: size.width },
    names.length, pathM ?? 0, existing, !across);
  const frame = getBulkPreviewFrame(bounds, [
    ...existing.map(bed => bed.rect), ...beds.map(bed => bed.rect), ...alternate.rectangles,
  ]);
  const geometry = validateAreaGeometry(bounds, [
    ...existing.map(bed => ({ id: bed.id, rect: bed.measured ? bed.rect : null })), ...beds,
  ], recommendedGapM);
  const placements: BulkBedPlacement[] = beds.map(({ rect }) => ({
    x: rect.x * scale.x, y: rect.y * scale.y, runs_across_parcel: across,
  }));
  return { bounds, existing, beds, placements, frame, insideCount: proposal.insideCount, geometry };
}

function getBulkPreviewFrame(bounds: MetricRect, beds: readonly MetricRect[]): MetricRect {
  return beds.reduce((frame, rect) => {
    const x = Math.min(frame.x, rect.x);
    const y = Math.min(frame.y, rect.y);
    return { x, y, width: Math.max(frame.x + frame.width, rect.x + rect.width) - x,
      height: Math.max(frame.y + frame.height, rect.y + rect.height) - y };
  }, bounds);
}
