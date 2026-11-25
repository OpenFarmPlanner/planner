import type { BedLayoutEntry, FieldLayoutEntry, LocationBoundaryOrigin, LocationLayoutsResponse } from '../api/api';
import type { Bed, Field, Location, LocationPathSpacing } from '../api/types';
import { calculateMetricCoverage, validateAreaGeometry, type AreaFootprint, type GeometryIssue, type MetricRect } from '../components/hierarchy/utils/growingAreaGeometry';
import {
  DEFAULT_STAGE_HEIGHT, LOCATION_FIELD_GAP, LOCATION_LAYOUT_PADDING, WORKSPACE_MIN_HEIGHT, WORKSPACE_MIN_WIDTH,
  FIELD_WORLD_BASE_WIDTH, FIELD_WORLD_MAX_WIDTH, FIELD_WORLD_MIN_HEIGHT, FIELD_WORLD_MIN_WIDTH,
  FIELD_WORLD_PX_PER_METER, FIELD_WORLD_SCALE_FACTOR, getFieldUsableArea, getFitViewportPadding,
  type BedViewModel, type Point, type RectViewModel,
} from './graphicalFieldsGeometry';
import {
  arrangeFieldRects, clampInsideParent, DEFAULT_PLACEMENT_SPACING, fieldUsesWorldScale, getBedRectSizeWithinField,
  getFieldRectSize, getLocationBoundaryRect, initialAutoLayout, placeFieldRects, rotateRect,
  rotateRectBetweenSizes, type GraphicalRotation, type Rect, type RectSize,
} from './graphicalLayoutUtils';
import { getContentBoundsFromRects } from './graphicalViewport';

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

export function getMeasuredArea(area: Pick<Field, 'width_m' | 'length_m'>): number | null {
  const size = measuredSize(area, 0);
  return size ? size.width * size.height : null;
}

export function getSchematicFieldSize(field: Field): RectSize {
  return getFieldRectSize(field, FIELD_WORLD_PX_PER_METER, {
    baseWidth: FIELD_WORLD_BASE_WIDTH,
    minWidth: FIELD_WORLD_MIN_WIDTH,
    maxWidth: FIELD_WORLD_MAX_WIDTH,
    minHeight: FIELD_WORLD_MIN_HEIGHT,
    scaleFactor: FIELD_WORLD_SCALE_FACTOR,
  });
}

export function getGraphicalBedLayout(
  field: Field,
  storedField: RectSize,
  beds: readonly Bed[],
  savedLayouts: Readonly<Record<number, BedLayoutEntry>>,
  rotation: GraphicalRotation,
) {
  const fieldSize = rotation % 180 ? { width: storedField.height, height: storedField.width } : storedField;
  const available = getFieldUsableArea(fieldSize);
  const storedUsableArea = getFieldUsableArea(storedField);
  const storedMeters = measuredSize(field, 0);
  const storedPixelsPerMeter = storedMeters
    ? { x: storedUsableArea.width / storedMeters.width, y: storedUsableArea.height / storedMeters.height }
    : null;
  const fieldMeters = measuredSize(field, rotation);
  const scale = fieldMeters ? Math.min(available.width / fieldMeters.width, available.height / fieldMeters.height) : null;
  const pixelsPerMeter = scale === null ? null : { x: scale, y: scale };
  // Keep the saved coordinate system while fitting the measured parcel into
  // the display area with the same metric scale on both axes.
  const usableArea = fieldMeters && scale !== null
    ? { ...available, width: fieldMeters.width * scale, height: fieldMeters.height * scale }
    : available;
  const sizes = new Map<number, RectSize>();
  const missing: number[] = [];
  const occupied: Rect[] = [];
  for (const bed of beds) {
    if (bed.id === undefined) continue;
    const saved = savedLayouts[bed.id];
    const dimensions = saved?.runs_across_parcel
      ? { ...bed, length_m: bed.width_m, width_m: bed.length_m } : bed;
    const size = getBedRectSizeWithinField(dimensions, field, storedUsableArea);
    sizes.set(bed.id, size);
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
  return { fieldSize, usableArea, storedUsableArea, fieldMeters, pixelsPerMeter, storedPixelsPerMeter, bedRects };
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

function getLocationMetricGeometry(
  location: Location,
  boundary: Rect | null,
  parcels: readonly Pick<GraphicalParcel, 'field' | 'rect'>[],
  rotation: GraphicalRotation,
  preview: GeometryPreview | null,
) {
  const locationMeters = measuredSize(location, rotation);
  const bounds: MetricRect | null = boundary && locationMeters ? { x: 0, y: 0, ...locationMeters } : null;
  const origin = boundary ?? { x: 0, y: 0 };
  const footprints = parcels.map<AreaFootprint>(({ field, rect }) => {
    const size = rect.supportsMetricSpacing ? measuredSize(field, rotation) : null;
    const position = previewPosition(rect, preview, 'field');
    return {
      id: rect.id,
      rect: size ? { x: (position.x - origin.x) / FIELD_WORLD_PX_PER_METER,
        y: (position.y - origin.y) / FIELD_WORLD_PX_PER_METER, ...size } : null,
    };
  });
  return { bounds, footprints };
}

function getParcelMetricGeometry(layout: GraphicalBedLayout, preview: GeometryPreview | null) {
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
  return { bounds, footprints };
}

export function getSchematicLocationLayout(
  location: Location,
  fields: readonly Field[],
  savedPositions: Readonly<Record<number, FieldLayoutEntry>>,
  savedBoundaryOrigin: LocationBoundaryOrigin | null,
  rotation: GraphicalRotation,
  stageWidth: number,
  stageHeight: number,
) {
  const sizedFields = fields.map(field => ({ field, ...getSchematicFieldSize(field) }));
  const fitPadding = getFitViewportPadding(stageWidth, stageHeight);
  const arrangement = arrangeFieldRects(
    sizedFields,
    // Pack for the default quarter turn; later rotations preserve this arrangement.
    Math.max(1, stageHeight - fitPadding.top - fitPadding.bottom) /
      Math.max(1, stageWidth - fitPadding.left - fitPadding.right),
    LOCATION_FIELD_GAP,
  );
  const originX = Math.max(LOCATION_LAYOUT_PADDING, Math.round(WORKSPACE_MIN_WIDTH / 2 - arrangement.width / 2));
  const originY = Math.max(LOCATION_LAYOUT_PADDING, Math.round(WORKSPACE_MIN_HEIGHT / 2 - arrangement.height / 2));
  const defaultFieldRects = sizedFields.map((entry, index) => ({
    ...entry, defaultX: originX + arrangement.positions[index].x, defaultY: originY + arrangement.positions[index].y,
  }));
  const fieldsContentSize = {
    width: Math.max(WORKSPACE_MIN_WIDTH, ...defaultFieldRects.map(rect => rect.width + rect.defaultX + LOCATION_LAYOUT_PADDING)),
    height: Math.max(WORKSPACE_MIN_HEIGHT, DEFAULT_STAGE_HEIGHT, originY + arrangement.height + LOCATION_LAYOUT_PADDING),
  };
  // A narrow viewport must not move a saved parcel into the site's boundary.
  for (const rect of defaultFieldRects) {
    const saved = savedPositions[rect.field.id!];
    if (!saved) continue;
    fieldsContentSize.width = Math.max(fieldsContentSize.width, saved.x + rect.width);
    fieldsContentSize.height = Math.max(fieldsContentSize.height, saved.y + rect.height);
  }
  const storedFieldRects = placeFieldRects(defaultFieldRects, savedPositions, fieldsContentSize);
  const storedFieldBounds = getContentBoundsFromRects(storedFieldRects);
  const storedBoundary = getLocationBoundaryRect(
    location,
    FIELD_WORLD_PX_PER_METER,
    savedBoundaryOrigin ?? (storedFieldBounds ? { x: storedFieldBounds.minX, y: storedFieldBounds.minY } : { x: originX, y: originY }),
  );
  const storedContentSize = {
    width: Math.max(fieldsContentSize.width, storedBoundary ? storedBoundary.x + storedBoundary.width + LOCATION_LAYOUT_PADDING : 0),
    height: Math.max(fieldsContentSize.height, storedBoundary ? storedBoundary.y + storedBoundary.height + LOCATION_LAYOUT_PADDING : 0),
  };
  const rotatedContent = rotateRect({ x: 0, y: 0, ...storedContentSize }, storedContentSize, rotation);
  const metricFieldIds = new Set(sizedFields
    .filter(rect => fieldUsesWorldScale(rect.field, rect, FIELD_WORLD_PX_PER_METER))
    .map(rect => rect.field.id));
  const fieldViewModels = storedFieldRects.map(rect => ({
    ...rotateRect(rect, storedContentSize, rotation),
    supportsMetricSpacing: metricFieldIds.has(rect.id),
  }));
  return {
    location, defaultFieldRects, fieldViewModels, rotation,
    boundary: storedBoundary ? rotateRect(storedBoundary, storedContentSize, rotation) : null,
    unsavedBoundaryOrigin: storedBoundary && !savedBoundaryOrigin ? { x: storedBoundary.x, y: storedBoundary.y } : null,
    contentWidth: rotatedContent.width,
    contentHeight: rotatedContent.height,
  };
}

export function getSavedLocationCoverage(location: Location, fields: readonly Field[], layouts: LocationLayoutsResponse) {
  const positions = Object.fromEntries(layouts.field_layouts.map(layout => [layout.field, layout]));
  const locationFields = fields.filter(field => field.id !== undefined && field.id > 0 && field.location === location.id);
  const layout = getSchematicLocationLayout(
    location, locationFields, positions, layouts.location_boundary ?? null, 0, WORKSPACE_MIN_WIDTH, WORKSPACE_MIN_HEIGHT,
  );
  // An auto-placed parcel is unambiguous only when it is the sole parcel
  // and the boundary is anchored to it. Other positions can depend on the canvas.
  const anchoredToOnlyParcel = locationFields.length === 1 && !layouts.location_boundary;
  const fieldsById = new Map(locationFields.map(field => [field.id, field]));
  const parcels = layout.fieldViewModels.map(rect => ({
    field: fieldsById.get(rect.id)!,
    rect: { ...rect, supportsMetricSpacing: rect.supportsMetricSpacing && (anchoredToOnlyParcel || Boolean(positions[rect.id])) },
  }));
  const { bounds, footprints } = getLocationMetricGeometry(location, layout.boundary, parcels, 0, null);
  return calculateMetricCoverage(bounds, footprints);
}

export function getSavedParcelCoverage(field: Field, beds: readonly Bed[], layouts: LocationLayoutsResponse) {
  const bedLayouts = Object.fromEntries(layouts.bed_layouts.map(layout => [layout.bed, layout]));
  const layout = getGraphicalBedLayout(field, getSchematicFieldSize(field), beds, bedLayouts, 0);
  const { bounds, footprints } = getParcelMetricGeometry(layout, null);
  return calculateMetricCoverage(bounds, footprints);
}

export interface GraphicalGeometryAnalysis {
  locationReport: ReturnType<typeof validateAreaGeometry>;
  parcelReports: Map<number, ReturnType<typeof validateAreaGeometry>>;
}

export function analyzeGraphicalGeometry(
  location: Location,
  boundary: Rect | null,
  parcels: readonly GraphicalParcel[],
  spacing: LocationPathSpacing,
  rotation: GraphicalRotation,
  drag: GeometryPreview | null,
  includeFreeRects = false,
  saved?: GraphicalGeometryAnalysis,
): GraphicalGeometryAnalysis {
  const preview = drag?.locationId === location.id ? drag : null;
  let locationReport = preview?.type !== 'field' ? saved?.locationReport : undefined;
  if (!locationReport) {
    const { bounds, footprints } = getLocationMetricGeometry(location, boundary, parcels, rotation, preview);
    locationReport = validateAreaGeometry(bounds, footprints, spacing.parcel_path_spacing_cm / 100, includeFreeRects);
  }
  const parcelReports = new Map(parcels.map(({ rect, layout }) => {
    const movingBed = preview?.type === 'bed' && layout.bedRects.some(bed => bed.id === preview.id);
    const previous = movingBed ? undefined : saved?.parcelReports.get(rect.id);
    if (previous) return [rect.id, previous] as const;
    const { bounds, footprints } = getParcelMetricGeometry(layout, preview);
    return [rect.id, validateAreaGeometry(bounds, footprints, spacing.bed_path_spacing_cm / 100, includeFreeRects)] as const;
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
