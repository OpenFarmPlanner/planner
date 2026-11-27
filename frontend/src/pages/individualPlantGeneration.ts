import type { Bed, BedLayoutEntry, Crop, Field, PlantingPlan, StemCoordinates } from '../api/types';
import { getBulkBedPreviewContext } from '../components/hierarchy/utils/bulkBedPreview';
import { getEffectiveCropValue } from '../crops/varietyValueSource';
import { addUtcDays, formatIsoDate, parseIsoDate } from '../utils/isoDate';
import { parcelMeters, planPlacementParent, type PlacementParent } from './individualPlantGeometry';
import type { Rect, RectSize } from './graphicalLayoutUtils';
import type { GraphicPlacementContext, PlantGenerationGeometry } from './graphicalPlantPlacement';

export const MAX_INDIVIDUAL_POSITIONS = 1000;

export function individualPositionLimit(exactCount?: number | null) {
  return Math.min(MAX_INDIVIDUAL_POSITIONS, exactCount ?? MAX_INDIVIDUAL_POSITIONS);
}

export interface RegularPlantInputs {
  count: number | 'max' | null;
  plantSpacing: number | null;
  rowSpacing: number | null;
  marginWidth: number | null;
  marginLength: number | null;
  along: 'length' | 'width';
}

export interface PlantingPeriod {
  start: string;
  end: string;
}

export function intersectsPlantingPeriod(first: PlantingPeriod, second: PlantingPeriod): boolean {
  return first.start <= second.end && second.start <= first.end;
}

export interface PlacementFrame {
  dimensions: RectSize;
  /** Extent of the parent in unrotated parcel metres, matching the graphic. */
  rect: Rect;
}

export type PlacementFrames = ReadonlyMap<string, PlacementFrame>;

const placementFrameKey = ({ kind, id }: PlacementParent) => `${kind}:${id}`;

/** Reuse the bulk-bed preview's measured parcel and the exact saved or inferred bed layout. */
export function getIndividualPlantFrames(
  fields: readonly Field[], beds: readonly Bed[], layouts: Readonly<Record<number, BedLayoutEntry>>,
) {
  const result = new Map<number, PlacementFrames>();
  for (const field of fields) {
    if (field.id === undefined) continue;
    const localBeds = beds.filter(bed => bed.field === field.id);
    const frames = new Map<string, PlacementFrame>();
    const geometry = getBulkBedPreviewContext(field, localBeds, layouts);
    if (geometry) {
      frames.set(`field:${field.id}`, { dimensions: geometry.bounds, rect: geometry.bounds });
      const measuredBeds = new Map(geometry.existing.map(({ id, rect }) => [id, rect]));
      for (const bed of localBeds) {
        const dimensions = parcelMeters(bed);
        const rect = bed.id === undefined ? undefined : measuredBeds.get(bed.id);
        if (dimensions && rect && rect.width > 0 && rect.height > 0) {
          frames.set(`bed:${bed.id}`, { dimensions, rect });
        }
      }
    }
    result.set(field.id, frames);
  }
  return result;
}

export function individualCropSpacings(crop: Crop | undefined) {
  const toMeters = (value: unknown) => {
    const cm = Number(value);
    return Number.isFinite(cm) && cm > 0 ? cm / 100 : null;
  };
  return {
    plantSpacing: toMeters(getEffectiveCropValue(crop, 'distance_within_row_cm')),
    rowSpacing: toMeters(getEffectiveCropValue(crop, 'row_spacing_cm')),
  };
}

function savedPeriod(plan: PlantingPlan): PlantingPeriod | null {
  const start = [plan.planting_date, plan.seasonal_harvest?.occupancy_start_date,
    plan.cultivation_type === 'direct_sowing' ? plan.actual_sowing_date : plan.actual_transplanting_date,
  ].filter((value): value is string => Boolean(value)).sort()[0];
  if (!start) return null;
  const end = plan.occupancy_end_date ?? plan.clearing_date ?? plan.harvest_end_date ?? plan.harvest_date ?? start;
  return { start, end: end > start ? end : start };
}

export function individualPlacementPeriod(
  date: string, crop: Crop | undefined, existing?: PlantingPlan,
): PlantingPeriod | null {
  if (existing) return savedPeriod(existing);
  const start = parseIsoDate(date);
  if (!start) return null;
  if (getEffectiveCropValue(crop, 'life_cycle') === 'perennial') {
    const end = new Date(start);
    const years = Number(getEffectiveCropValue(crop, 'standing_time_years'));
    if (Number.isFinite(years) && years > 0) {
      // Match the backend's last-day clamp when the target month has fewer days.
      end.setUTCFullYear(start.getUTCFullYear() + years, start.getUTCMonth() + 1, 0);
      end.setUTCDate(Math.min(start.getUTCDate(), end.getUTCDate()));
      return { start: date, end: formatIsoDate(end) };
    }
  }
  const growth = Number(getEffectiveCropValue(crop, 'growth_duration_days') ?? 0);
  const harvest = Number(getEffectiveCropValue(crop, 'harvest_duration_days') ?? 0);
  return { start: date, end: formatIsoDate(addUtcDays(start, growth + harvest)) };
}

export function collectOccupiedPlantPositions({
  frames, parent, plans, planId, period, projectBetweenParents,
}: {
  frames?: PlacementFrames;
  parent: PlacementParent;
  plans: readonly PlantingPlan[];
  planId?: number;
  period: PlantingPeriod | null;
  projectBetweenParents?: GraphicPlacementContext['projectBetweenParents'];
}): StemCoordinates[] {
  const key = placementFrameKey(parent);
  const target = frames?.get(key);
  return plans.flatMap(plan => {
    if (plan.id !== undefined && plan.id === planId) return [];
    const peer = planPlacementParent(plan);
    if (!peer) return [];
    const planted = savedPeriod(plan);
    if (period && planted && !intersectsPlantingPeriod(period, planted)) return [];
    const peerKey = placementFrameKey(peer);
    const stems = plan.individual_positions ?? [];
    if (key === peerKey) return stems;
    if (projectBetweenParents) return stems.flatMap(stem => projectBetweenParents(peer, parent, stem) ?? []);
    const source = frames?.get(peerKey);
    if (!source || !target) return [];
    return stems.map(stem => ({
      x_m: (source.rect.x + stem.x_m / source.dimensions.width * source.rect.width - target.rect.x)
        / target.rect.width * target.dimensions.width,
      y_m: (source.rect.y + stem.y_m / source.dimensions.height * source.rect.height - target.rect.y)
        / target.rect.height * target.dimensions.height,
    }));
  });
}

const CM = 100;
const MAX_COORDINATE_CM = 99_999_999; // DecimalField(max_digits=8, decimal_places=2)
const TOLERANCE = 1e-8;

interface Axis {
  first: number;
  step: number;
  slots: number;
}

function centimetres(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  const rounded = Math.round(value * CM);
  return rounded <= MAX_COORDINATE_CM && Math.abs(value * CM - rounded) <= TOLERANCE ? rounded : null;
}

function gridAxis(size: number, margin: number, step: number): Axis {
  const last = Math.min(MAX_COORDINATE_CM, Math.floor(size * CM + TOLERANCE) - margin);
  return { first: margin, step, slots: Math.max(0, Math.floor((last - margin) / step) + 1) };
}

/** Only nearby grid cells can violate the directional spacing around one occupied point. */
function blockedCells(rows: Axis, columns: Axis, occupied: readonly StemCoordinates[], alongWidth: boolean) {
  const blocked = new Map<number, Set<number>>();
  let count = 0;
  for (const point of occupied) {
    const row = ((alongWidth ? point.y_m : point.x_m) * CM - rows.first) / rows.step;
    const column = ((alongWidth ? point.x_m : point.y_m) * CM - columns.first) / columns.step;
    for (let r = Math.max(0, Math.ceil(row - 1)); r <= Math.min(rows.slots - 1, Math.floor(row + 1)); r += 1) {
      const rowDistance = (r - row) ** 2;
      for (let c = Math.max(0, Math.ceil(column - 1)); c <= Math.min(columns.slots - 1, Math.floor(column + 1)); c += 1) {
        if (rowDistance + (c - column) ** 2 >= 1 - TOLERANCE) continue;
        const cells = blocked.get(r) ?? new Set<number>();
        if (!cells.has(c)) {
          cells.add(c);
          blocked.set(r, cells);
          count += 1;
        }
      }
    }
  }
  return { blocked, count };
}

type GridSpan = { first: number; last: number };
type GridBand = GridSpan & { columns: GridSpan[] };

function insideGrid(axis: Axis, low = -Infinity, high = Infinity): GridSpan {
  return { first: Math.max(0, Math.ceil((low * CM - axis.first - TOLERANCE) / axis.step)),
    last: Math.min(axis.slots - 1, Math.floor((high * CM - axis.first + TOLERANCE) / axis.step)) };
}

function openColumns(range: GridSpan, excluded: GridSpan[]): GridSpan[] {
  const free: GridSpan[] = [];
  let next = range.first;
  for (const block of excluded.sort((a, b) => a.first - b.first)) {
    if (block.last < next || block.first > range.last) continue;
    if (block.first > next) free.push({ first: next, last: block.first - 1 });
    next = Math.max(next, block.last + 1);
  }
  if (next <= range.last) free.push({ first: next, last: range.last });
  return free;
}

/** Several rows can share the same exclusions even when the grid contains billions of cells. */
function availableBands(rows: Axis, columns: Axis, alongWidth: boolean, occupied: ReadonlyMap<number, Set<number>>,
  geometry?: PlantGenerationGeometry): GridBand[] {
  const extents = (rect: Rect) => ({
    rows: alongWidth ? insideGrid(rows, rect.y, rect.y + rect.height) : insideGrid(rows, rect.x, rect.x + rect.width),
    columns: alongWidth ? insideGrid(columns, rect.x, rect.x + rect.width) : insideGrid(columns, rect.y, rect.y + rect.height),
  });
  const allowed = geometry ? extents(geometry.bounds) : { rows: insideGrid(rows), columns: insideGrid(columns) };
  if (allowed.rows.first > allowed.rows.last || allowed.columns.first > allowed.columns.last) return [];
  const excluded = (geometry?.excluded ?? []).map(extents).filter(rect => rect.columns.first <= rect.columns.last);
  const rowEdges = new Set([allowed.rows.first, allowed.rows.last + 1]);
  for (const span of [...excluded.map(rect => rect.rows), ...[...occupied.keys()].map(row => ({ first: row, last: row }))]) {
    const first = Math.max(allowed.rows.first, span.first);
    const last = Math.min(allowed.rows.last, span.last);
    if (first <= last) { rowEdges.add(first); rowEdges.add(last + 1); }
  }
  const edges = [...rowEdges].sort((a, b) => a - b);
  return edges.slice(0, -1).flatMap((first, index) => {
    const blocked = excluded.filter(rect => rect.rows.first <= first && rect.rows.last >= first).map(rect => rect.columns);
    for (const column of occupied.get(first) ?? []) blocked.push({ first: column, last: column });
    const free = openColumns(allowed.columns, blocked);
    return free.length ? [{ first, last: edges[index + 1] - 1, columns: free }] : [];
  });
}

type GenerationProblem = 'dimensions' | 'spacing' | 'margin' | 'count' | 'noFit' | 'cap' | 'notEnough';
export interface RegularPlantPreview {
  positions: StemCoordinates[];
  rowCount: number;
  freeSlots: bigint;
  maxAdditional: number;
  blockedSlots: number;
  problem?: GenerationProblem;
}

/** Deterministic row-major order. Count all free slots, but only materialize a savable draft. */
export function generateRegularPlants(
  dimensions: RectSize | null,
  inputs: RegularPlantInputs,
  occupied: readonly StemCoordinates[],
  existingCount: number,
  geometry?: PlantGenerationGeometry,
  countLimit = MAX_INDIVIDUAL_POSITIONS,
): RegularPlantPreview {
  const remaining = Math.max(0, Math.min(countLimit, MAX_INDIVIDUAL_POSITIONS) - existingCount);
  const empty = { positions: [], rowCount: 0, freeSlots: 0n, maxAdditional: 0, blockedSlots: 0 };
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0
      || !Number.isFinite(dimensions.width) || !Number.isFinite(dimensions.height)) {
    return { ...empty, problem: 'dimensions' };
  }
  const plant = centimetres(inputs.plantSpacing);
  const row = centimetres(inputs.rowSpacing);
  if (!plant || !row) return { ...empty, problem: 'spacing' };
  const widthMargin = centimetres(inputs.marginWidth);
  const lengthMargin = centimetres(inputs.marginLength);
  if (widthMargin === null || lengthMargin === null) return { ...empty, problem: 'margin' };

  const alongWidth = inputs.along === 'width';
  const columns = alongWidth ? gridAxis(dimensions.width, widthMargin, plant)
    : gridAxis(dimensions.height, lengthMargin, plant);
  const rows = alongWidth ? gridAxis(dimensions.height, lengthMargin, row)
    : gridAxis(dimensions.width, widthMargin, row);
  const { blocked, count: blockedSlots } = blockedCells(rows, columns, occupied, alongWidth);
  const bands = availableBands(rows, columns, alongWidth, blocked, geometry);
  const freeSlots = bands.reduce((total, band) => total + BigInt(band.last - band.first + 1)
    * BigInt(band.columns.reduce((width, span) => width + span.last - span.first + 1, 0)), 0n);
  const maxAdditional = freeSlots > BigInt(remaining) ? remaining : Number(freeSlots);
  const preview = { ...empty, freeSlots, maxAdditional, blockedSlots };
  if (freeSlots === 0n) return { ...preview, problem: 'noFit' };

  const count = inputs.count === 'max' ? maxAdditional : inputs.count;
  if (count === null || !Number.isSafeInteger(count) || count < 0 || inputs.count === 0) {
    return { ...preview, problem: 'count' };
  }
  if (count > remaining || (inputs.count === 'max' && freeSlots > BigInt(remaining))) {
    return { ...preview, problem: 'cap' };
  }
  if (count > maxAdditional) return { ...preview, problem: 'notEnough' };

  const positions: StemCoordinates[] = [];
  let rowCount = 0;
  for (const band of bands) {
    if (positions.length >= count) break;
    for (let r = band.first; r <= band.last && positions.length < count; r += 1) {
      const across = (rows.first + r * rows.step) / CM;
      for (const span of band.columns) {
        for (let c = span.first; c <= span.last && positions.length < count; c += 1) {
          const along = (columns.first + c * columns.step) / CM;
          positions.push(alongWidth ? { x_m: along, y_m: across } : { x_m: across, y_m: along });
        }
      }
      rowCount += 1;
    }
  }
  return { ...preview, positions, rowCount };
}
