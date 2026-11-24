import type { BedLayoutEntry } from '../api/api';
import type { Bed, Field, Location, LocationPathSpacing } from '../api/types';
import { validateAreaGeometry, type AreaFootprint, type GeometryIssue, type MetricRect } from '../components/hierarchy/utils/growingAreaGeometry';
import { FIELD_WORLD_PX_PER_METER, getFieldUsableArea, type BedViewModel, type Point, type RectViewModel } from './graphicalFieldsGeometry';
import {
  clampInsideParent, DEFAULT_PLACEMENT_SPACING, getBedRectSizeWithinField, initialAutoLayout,
  rotateRectBetweenSizes, type GraphicalRotation, type Rect, type RectSize,
} from './graphicalLayoutUtils';

export interface GeometryPreview {
  type: 'field' | 'bed';
  id: number;
  locationId: number;
  position: Point;
}

function measuredSize(area: Pick<Field, 'width_m' | 'length_m'>, rotation: GraphicalRotation): RectSize | null {
  const { width_m: width, length_m: height } = area;
  if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0
      || typeof height !== 'number' || !Number.isFinite(height) || height <= 0) return null;
  return rotation % 180 ? { width: height, height: width } : { width, height };
}

export function getGraphicalBedLayout(
  field: Field,
  storedField: RectSize,
  beds: readonly Bed[],
  savedLayouts: Readonly<Record<number, BedLayoutEntry>>,
  rotation: GraphicalRotation,
) {
  const fieldSize = rotation % 180 ? { width: storedField.height, height: storedField.width } : storedField;
  const usableArea = getFieldUsableArea(fieldSize);
  const storedUsableArea = getFieldUsableArea(storedField);
  const sizes = new Map<number, RectSize>();
  const missing: number[] = [];
  const occupied: Rect[] = [];
  for (const bed of beds) {
    if (bed.id === undefined) continue;
    const size = getBedRectSizeWithinField(bed, field, storedUsableArea);
    sizes.set(bed.id, size);
    const saved = savedLayouts[bed.id];
    if (saved) occupied.push({ x: saved.x, y: saved.y, ...size });
    else missing.push(bed.id);
  }
  const arranged = initialAutoLayout(
    missing, sizes, storedUsableArea, DEFAULT_PLACEMENT_SPACING, occupied, DEFAULT_PLACEMENT_SPACING,
  );
  const bedRects: BedViewModel[] = beds.flatMap(bed => {
    if (bed.id === undefined) return [];
    const size = sizes.get(bed.id)!;
    const saved = savedLayouts[bed.id];
    // A subsequent resize may leave the saved position outside the usable area.
    // Keep that position visible so the warning names the actual footprint.
    const position = saved ? { x: saved.x, y: saved.y } : clampInsideParent(
      arranged.get(bed.id) ?? { x: 10, y: 10 }, size, storedUsableArea,
    );
    const rect = rotateRectBetweenSizes({ ...position, ...size }, storedUsableArea, usableArea, rotation);
    return [{ ...rect, id: bed.id, name: bed.name, area: Number(bed.area_sqm ?? 0),
      supportsMetricSpacing: measuredSize(bed, rotation) !== null }];
  });
  const fieldMeters = measuredSize(field, rotation);
  const pixelsPerMeter = fieldMeters
    ? { x: usableArea.width / fieldMeters.width, y: usableArea.height / fieldMeters.height }
    : null;
  return { fieldSize, usableArea, storedUsableArea, fieldMeters, pixelsPerMeter, bedRects };
}

type GraphicalBedLayout = ReturnType<typeof getGraphicalBedLayout>;

export interface GraphicalParcel {
  field: Field;
  rect: RectViewModel;
  layout: GraphicalBedLayout;
}

function previewPosition(rect: RectViewModel, preview: GeometryPreview | null, type: GeometryPreview['type']): Point {
  return preview?.type === type && preview.id === rect.id ? preview.position : rect;
}

export function analyzeGraphicalGeometry(
  location: Location,
  boundary: Rect | null,
  parcels: readonly GraphicalParcel[],
  spacing: LocationPathSpacing,
  rotation: GraphicalRotation,
  drag: GeometryPreview | null,
  showFreeAreas = false,
) {
  const preview = drag?.locationId === location.id ? drag : null;
  const locationMeters = measuredSize(location, rotation);
  const locationBounds: MetricRect | null = boundary && locationMeters ? { x: 0, y: 0, ...locationMeters } : null;
  const origin = boundary ?? { x: 0, y: 0 };
  const plotFootprints = parcels.map<AreaFootprint>(({ field, rect }) => {
    const size = rect.supportsMetricSpacing ? measuredSize(field, rotation) : null;
    const position = previewPosition(rect, preview, 'field');
    return {
      id: rect.id,
      rect: size ? { x: (position.x - origin.x) / FIELD_WORLD_PX_PER_METER,
        y: (position.y - origin.y) / FIELD_WORLD_PX_PER_METER, ...size } : null,
    };
  });
  const locationReport = validateAreaGeometry(locationBounds, plotFootprints, spacing.parcel_path_spacing_cm / 100, showFreeAreas);

  const parcelReports = new Map(parcels.map(({ rect, layout }) => {
    const bounds: MetricRect | null = layout.fieldMeters ? { x: 0, y: 0, ...layout.fieldMeters } : null;
    const scale = layout.pixelsPerMeter;
    const footprints = layout.bedRects.map<AreaFootprint>(bed => {
      const position = previewPosition(bed, preview, 'bed');
      return {
        id: bed.id,
        rect: bed.supportsMetricSpacing && scale && scale.x > 0 && scale.y > 0
          ? { x: position.x / scale.x, y: position.y / scale.y, width: bed.width / scale.x, height: bed.height / scale.y }
          : null,
      };
    });
    return [rect.id, validateAreaGeometry(bounds, footprints, spacing.bed_path_spacing_cm / 100, showFreeAreas)] as const;
  }));
  return { locationReport, parcelReports };
}

export type OutlineKind = 'outside' | 'overlap' | 'shortGap';

const severity: Record<OutlineKind, number> = { shortGap: 0, overlap: 1, outside: 2 };

export function getGeometryOutlines(issues: readonly GeometryIssue[]): Map<number, OutlineKind> {
  const result = new Map<number, OutlineKind>();
  for (const issue of issues) {
    if (issue.kind === 'noPathSpace') continue;
    const ids = issue.kind === 'outside' ? [issue.id] : issue.ids;
    for (const id of ids) {
      const current = result.get(id);
      if (current === undefined || severity[issue.kind] > severity[current]) result.set(id, issue.kind);
    }
  }
  return result;
}
