import type { GraphicPlacementScene, GraphicStemPoint, Location, StemCoordinates } from '../api/types';
import { getBedWorldRect, type GraphicalParcel } from './graphicalAreaGeometry';
import { parcelMeters, matchesPlacementParent, type PlacementParent } from './individualPlantGeometry';
import { rotateRectBetweenSizes, type GraphicalRotation, type Position, type Rect } from './graphicalLayoutUtils';

type PlacementFrame = Rect & {
  parent: PlacementParent;
  name: string;
  measured: boolean;
  world: Rect;
  fieldId?: number;
  across?: boolean;
};

export type GraphicPlacementError = 'geometryUnknown' | 'outsideLocation' | 'parentAmbiguous';
export type GraphicPlacementResolution = { error: GraphicPlacementError } | {
  point: GraphicStemPoint;
  frame: PlacementFrame;
  local: StemCoordinates;
};

export interface PlantGenerationGeometry {
  bounds: Rect;
  excluded: Rect[];
}

const contains = (rect: Rect, point: Position) => point.x >= rect.x && point.y >= rect.y
  && point.x <= rect.x + rect.width && point.y <= rect.y + rect.height;

function containingFrame(frames: readonly PlacementFrame[], point: Position): PlacementFrame | GraphicPlacementError | undefined {
  let match: PlacementFrame | undefined;
  for (const frame of frames) {
    if (!contains(frame, point)) continue;
    if (!frame.measured) return 'geometryUnknown';
    if (match) return 'parentAmbiguous';
    match = frame;
  }
  return match;
}

function intersection(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width >= 0 && height >= 0 ? { x, y, width, height } : null;
}

export function createGraphicPlacementContext(location: Location, boundary: Rect | null,
  origin: Position | null, rotation: GraphicalRotation, parcels: readonly GraphicalParcel[]) {
  const meters = parcelMeters(location);
  if (!boundary || !meters || !origin || location.id === undefined) return null;
  const locationParent: PlacementParent = { kind: 'location', id: location.id };
  const inverse = ((360 - rotation) % 360) as GraphicalRotation;
  const toMeters = (world: Rect) => rotateRectBetweenSizes({ ...world, x: world.x - boundary.x, y: world.y - boundary.y },
    boundary, meters, inverse);
  const locationFrame: PlacementFrame = {
    x: 0, y: 0, ...meters, parent: locationParent, name: location.name, measured: true, world: boundary,
  };
  const fieldFrames = parcels.map<PlacementFrame>(({ field, rect }) => ({ ...toMeters(rect), world: rect,
    parent: { kind: 'field', id: rect.id }, name: field.name, measured: Boolean(rect.supportsMetricSpacing) }));
  const bedFrames = parcels.flatMap(parcel => parcel.layout.bedRects.map<PlacementFrame>(bed => {
    const world = getBedWorldRect(parcel, bed);
    return { ...toMeters(world), world, parent: { kind: 'bed', id: bed.id }, name: bed.name,
      measured: Boolean(bed.supportsMetricSpacing), fieldId: parcel.rect.id, across: bed.placementRotation !== rotation };
  }));
  const bedsByField = new Map<number, PlacementFrame[]>();
  for (const frame of bedFrames) {
    const fieldId = frame.fieldId!;
    const current = bedsByField.get(fieldId);
    if (current) current.push(frame);
    else bedsByField.set(fieldId, [frame]);
  }
  const scene: GraphicPlacementScene = { location: location.id, origin_x: origin.x, origin_y: origin.y,
    footprints: [...fieldFrames, ...bedFrames].map(({ parent, x, y, width, height }) => ({ ...parent, x, y, width, height })) };
  const frames = [locationFrame, ...fieldFrames, ...bedFrames];
  const getFrame = (parent: PlacementParent) => frames.find(item => matchesPlacementParent(item.parent, parent));
  const toLocal = (frame: PlacementFrame, point: Position): StemCoordinates => {
    const dx = point.x - frame.x;
    const dy = point.y - frame.y;
    return frame.across ? { x_m: dy, y_m: frame.width - dx } : { x_m: dx, y_m: dy };
  };
  const localToMetric = (parent: PlacementParent, position: StemCoordinates) => {
    const frame = getFrame(parent);
    if (!frame?.measured) return null;
    const x = frame.across ? frame.width - position.y_m : position.x_m;
    const y = frame.across ? position.x_m : position.y_m;
    return { x: frame.x + x, y: frame.y + y };
  };

  const resolveMetric = (point: Position): GraphicPlacementResolution => {
    if (!contains(locationFrame, point)) return { error: 'outsideLocation' };
    const field = containingFrame(fieldFrames, point);
    if (typeof field === 'string') return { error: field };
    const bed = field && containingFrame(bedsByField.get(field.parent.id) ?? [], point);
    if (typeof bed === 'string') return { error: bed };
    const frame = bed ?? field ?? locationFrame;
    return { frame, point: { x_m: point.x, y_m: point.y, parent: frame.parent },
      local: toLocal(frame, point) };
  };

  const resolveWorld = (point: Position) => resolveMetric(toMeters({ ...point, width: 0, height: 0 }));
  const resolveLocal = (parent: PlacementParent, position: StemCoordinates) => {
    const point = localToMetric(parent, position);
    return point ? resolveMetric(point) : { error: 'geometryUnknown' } as const;
  };
  const worldPoint = (point: StemCoordinates) => {
    const world = rotateRectBetweenSizes({ x: point.x_m, y: point.y_m, width: 0, height: 0 }, meters, boundary, rotation);
    return { x: boundary.x + world.x, y: boundary.y + world.y };
  };
  const generationGeometry = (parent: PlacementParent): PlantGenerationGeometry | null => {
    const frame = getFrame(parent);
    if (!frame?.measured) return null;
    const container = parent.kind === 'bed' ? fieldFrames.find(field => field.parent.id === frame.fieldId) : frame;
    if (!container?.measured) return null;
    const localRect = ({ x, y, width, height }: Rect): Rect => frame.across ? {
      x: y - frame.y, y: frame.x + frame.width - x - width, width: height, height: width,
    } : { x: x - frame.x, y: y - frame.y, width, height };
    const measuredParent = intersection(locationFrame, container);
    const bounds = measuredParent && intersection(measuredParent, frame);
    if (!bounds) return null;
    const competitors = [
      ...fieldFrames.filter(field => field !== container),
      ...(parent.kind === 'location' ? [] : bedsByField.get(container.parent.id) ?? []).filter(bed => bed !== frame),
    ];
    return { bounds: localRect(bounds), excluded: competitors.flatMap(candidate => {
      const blocked = intersection(candidate, bounds);
      return blocked ? [localRect(blocked)] : [];
    }) };
  };
  const projectBetweenParents = (source: PlacementParent, target: PlacementParent, stem: StemCoordinates) => {
    const frame = getFrame(target);
    const metric = localToMetric(source, stem);
    return frame?.measured && metric ? toLocal(frame, metric) : null;
  };
  return { scene, resolveWorld, resolveLocal, worldPoint, generationGeometry, projectBetweenParents };
}

export type GraphicPlacementContext = NonNullable<ReturnType<typeof createGraphicPlacementContext>>;
