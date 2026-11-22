import type { Bed, PlantingPlan } from '../api/types';
import { parseIsoDate } from '../utils/isoDate';

const DAY_MS = 86_400_000;
const AREA_SCALE = 100;

export type BedCapacityStatus = 'free' | 'partial' | 'occupied' | 'unknown' | 'overallocated';

export interface BedCapacityInterval {
  startDay: number;
  endDayExclusive: number;
  totalArea: number | null;
  knownUsedArea: number;
  freeArea: number | null;
  hasUnknownUsage: boolean;
  status: BedCapacityStatus;
}

export interface BedCapacityTimeline {
  name: string;
  intervals: BedCapacityInterval[];
}

interface AreaChange {
  area: number;
  unknown: number;
}

function calendarDay(value: string | null | undefined): number | null {
  const date = parseIsoDate(value);
  return date ? date.getTime() / DAY_MS : null;
}

export function bedCapacityDayToDate(day: number): Date {
  return new Date(day * DAY_MS);
}

function areaInHundredths(value: number | string | null | undefined): number | null {
  const area = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof area !== 'number' || area < 0) return null;
  const units = Math.round(area * AREA_SCALE);
  return Number.isSafeInteger(units) ? units : null;
}

function makeInterval(
  startDay: number, endDayExclusive: number, total: number | null, used: number, unknown: number,
): BedCapacityInterval {
  const free = total !== null && unknown === 0 && used <= total ? total - used : null;
  const status = total !== null && used > total ? 'overallocated'
    : free === null ? 'unknown'
      : free === 0 ? 'occupied'
        : used === 0 ? 'free' : 'partial';
  return {
    startDay,
    endDayExclusive,
    totalArea: total === null ? null : total / AREA_SCALE,
    knownUsedArea: used / AREA_SCALE,
    freeArea: free === null ? null : free / AREA_SCALE,
    hasUnknownUsage: unknown > 0,
    status,
  };
}

/** Calculate estimated area from the already season-scoped plans, one event per boundary. */
export function buildBedCapacityTimelines(
  beds: readonly Bed[],
  plans: readonly PlantingPlan[],
  seasonStart: string,
  seasonEnd: string,
): Map<number, BedCapacityTimeline> {
  const firstDay = calendarDay(seasonStart);
  const lastDay = calendarDay(seasonEnd);
  const result = new Map<number, BedCapacityTimeline>();
  if (firstDay === null || lastDay === null || lastDay < firstDay) return result;

  const endExclusive = lastDay + 1;
  const eventsByBed = new Map<number, Map<number, AreaChange>>();
  for (const bed of beds) {
    if (bed.id !== undefined) eventsByBed.set(bed.id, new Map());
  }
  const seenPlans = new Set<number>();
  for (const plan of plans) {
    const events = plan.bed === null ? undefined : eventsByBed.get(plan.bed);
    if (!events || (plan.id !== undefined && seenPlans.has(plan.id))) continue;
    const planted = calendarDay(plan.seasonal_harvest?.occupancy_start_date ?? plan.planting_date);
    // Same inclusive last-day contract as PlantingPlan.occupancy_end_date.
    const occupiedUntil = calendarDay(
      plan.occupancy_end_date ?? plan.clearing_date ?? plan.harvest_end_date ?? plan.harvest_date ?? plan.planting_date,
    );
    if (planted === null || occupiedUntil === null || occupiedUntil < planted) continue;
    const start = Math.max(firstDay, planted);
    const end = Math.min(endExclusive, occupiedUntil + 1);
    if (end <= start) continue;
    if (plan.id !== undefined) seenPlans.add(plan.id);

    const area = areaInHundredths(plan.area_usage_sqm);
    for (const [day, direction] of [[start, 1], [end, -1]]) {
      const change = events.get(day) ?? { area: 0, unknown: 0 };
      change.area += (area ?? 0) * direction;
      change.unknown += area === null ? direction : 0;
      events.set(day, change);
    }
  }

  for (const bed of beds) {
    if (bed.id === undefined) continue;
    const events = eventsByBed.get(bed.id)!;
    const total = areaInHundredths(bed.area_sqm) || null;
    const intervals: BedCapacityInterval[] = [];
    let used = 0;
    let unknown = 0;
    let start = firstDay;
    // Adjacent plans can hand over an equal area without changing capacity.
    for (const [day, change] of [...events].sort(([a], [b]) => a - b)) {
      if (change.area === 0 && change.unknown === 0) continue;
      if (day > start) intervals.push(makeInterval(start, day, total, used, unknown));
      used += change.area;
      unknown += change.unknown;
      start = day;
    }
    if (start < endExclusive) intervals.push(makeInterval(start, endExclusive, total, used, unknown));
    result.set(bed.id, { name: bed.name, intervals });
  }
  return result;
}
