import type { Bed, BedLayoutEntry, Crop, Field, PlantingPlan, StemCoordinates } from '../api/types';
import { getBulkBedPreviewContext } from '../components/hierarchy/utils/bulkBedPreview';
import { getEffectiveCropValue } from '../crops/varietyValueSource';
import { addUtcDays, formatIsoDate, parseIsoDate } from '../utils/isoDate';
import { parcelMeters, planPlacementParent, type PlacementParent } from './individualPlantGeometry';
import type { Rect, RectSize } from './graphicalLayoutUtils';

export const MAX_INDIVIDUAL_POSITIONS = 1000;

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
      end.setUTCFullYear(end.getUTCFullYear() + years);
      return { start: date, end: formatIsoDate(end) };
    }
  }
  const growth = Number(getEffectiveCropValue(crop, 'growth_duration_days') ?? 0);
  const harvest = Number(getEffectiveCropValue(crop, 'harvest_duration_days') ?? 0);
  return { start: date, end: formatIsoDate(addUtcDays(start, growth + harvest)) };
}

export function collectOccupiedPlantPositions({
  frames, parent, plans, planId, period,
}: {
  frames: PlacementFrames | undefined;
  parent: PlacementParent;
  plans: readonly PlantingPlan[];
  planId?: number;
  period: PlantingPeriod | null;
}): StemCoordinates[] {
  const key = placementFrameKey(parent);
  const target = frames?.get(key);
  return plans.flatMap(plan => {
    if (plan.id !== undefined && plan.id === planId) return [];
    const peer = planPlacementParent(plan);
    if (!peer) return [];
    const planted = savedPeriod(plan);
    if (period && planted && (planted.end < period.start || planted.start > period.end)) return [];
    const peerKey = placementFrameKey(peer);
    const stems = plan.individual_positions ?? [];
    if (key === peerKey) return stems;
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
): RegularPlantPreview {
  const remaining = Math.max(0, MAX_INDIVIDUAL_POSITIONS - existingCount);
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
  const freeSlots = BigInt(rows.slots) * BigInt(columns.slots) - BigInt(blockedSlots);
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
  for (let r = 0; r < rows.slots && positions.length < count; r += 1) {
    const before = positions.length;
    const across = (rows.first + r * rows.step) / CM;
    const blockedColumns = blocked.get(r);
    for (let c = 0; c < columns.slots && positions.length < count; c += 1) {
      if (blockedColumns?.has(c)) continue;
      const along = (columns.first + c * columns.step) / CM;
      positions.push(alongWidth ? { x_m: along, y_m: across } : { x_m: across, y_m: along });
    }
    if (positions.length > before) rowCount += 1;
  }
  return { ...preview, positions, rowCount };
}
