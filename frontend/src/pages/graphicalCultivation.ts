import type { PlantingPlan, Season, SeasonalHarvestPeriod } from '../api/types';
import { addUtcDays, formatDateToAPI, formatIsoDate, parseIsoDate } from '../utils/isoDate';
import { getPlanPropagationInfo } from './planSowingDate';

export const GRAPHICAL_DISPLAY_MODES = ['areas', 'crops', 'tasks', 'cropsAndTasks'] as const;
export type GraphicalDisplayMode = typeof GRAPHICAL_DISPLAY_MODES[number];
export type CropDateRange = { kind: 'range'; start: string; end: string };
export type CropDateSelection = { kind: 'today' | 'season' } | { kind: 'date'; date: string } | CropDateRange;
export type CropReference = { kind: 'season' } | { kind: 'date'; date: string; today: boolean } | CropDateRange;

export function readCropDateSelection(value: unknown): CropDateSelection | null {
  if (!value || typeof value !== 'object' || !('kind' in value)) return null;
  if (value.kind === 'today' || value.kind === 'season') return { kind: value.kind };
  if (value.kind === 'date' && 'date' in value && typeof value.date === 'string') {
    return { kind: 'date', date: value.date };
  }
  if (value.kind === 'range' && 'start' in value && 'end' in value
    && typeof value.start === 'string' && typeof value.end === 'string') {
    return { kind: 'range', start: value.start, end: value.end };
  }
  return null;
}

type SeasonBounds = Pick<Season, 'start_date' | 'end_date'>;

export const includesCrops = (mode: GraphicalDisplayMode) => mode === 'crops' || mode === 'cropsAndTasks';
export const includesTasks = (mode: GraphicalDisplayMode) => mode === 'tasks' || mode === 'cropsAndTasks';

export function isCropDateInSeason(date: string, season: SeasonBounds): boolean {
  if (date < season.start_date || date > season.end_date) return false;
  const parsed = parseIsoDate(date);
  return parsed !== null && formatIsoDate(parsed) === date;
}

export function isCropRangeInSeason(start: string, end: string, season: SeasonBounds): boolean {
  return start <= end && isCropDateInSeason(start, season) && isCropDateInSeason(end, season);
}

/** Number of calendar days between two ISO dates, independent of DST and locale. */
export function cropDateOffset(start: string, date: string): number {
  const left = parseIsoDate(start);
  const right = parseIsoDate(date);
  return left && right ? (right.getTime() - left.getTime()) / 86_400_000 : 0;
}

export function getCropReference(
  selection: CropDateSelection | null,
  season: SeasonBounds,
  today = formatDateToAPI(new Date()),
): CropReference {
  if (selection?.kind === 'season') return { kind: 'season' };
  if (selection?.kind === 'range' && isCropRangeInSeason(selection.start, selection.end, season)) return selection;
  if (selection?.kind === 'date' && isCropDateInSeason(selection.date, season)) {
    return { kind: 'date', date: selection.date, today: false };
  }
  return isCropDateInSeason(today, season)
    ? { kind: 'date', date: today, today: true }
    : { kind: 'date', date: season.start_date, today: false };
}

export function stepCropDate(date: string, days: number, season: SeasonBounds): string {
  const parsed = parseIsoDate(date);
  if (!parsed) return season.start_date;
  const next = formatIsoDate(addUtcDays(parsed, days));
  return next < season.start_date ? season.start_date : next > season.end_date ? season.end_date : next;
}

type CropPhase = 'growth' | 'harvest' | 'occupancy';
export interface BedCultivationPlan {
  id: number;
  crop: number | null;
  name: string | null;
  variety?: string | null;
  color?: string | null;
  start: string | null;
  end: string | null;
  planted: string | null;
  estimatedHarvest: readonly SeasonalHarvestPeriod[];
  recordedHarvest: readonly SeasonalHarvestPeriod[];
  perennial: boolean;
}

function harvestInterval(first?: string | null, last?: string | null): SeasonalHarvestPeriod[] {
  const start = first ?? last;
  const end = last ?? first;
  return start && end && start <= end ? [{ start_date: start, end_date: end }] : [];
}

export function cultivationPlan(plan: PlantingPlan & { id: number }): BedCultivationPlan {
  const { isPreCultivation, isPurchasedTransplant } = getPlanPropagationInfo(plan, undefined);
  const planted = (isPreCultivation || isPurchasedTransplant
    ? plan.actual_transplanting_date : plan.actual_sowing_date) ?? null;
  const recurring = plan.seasonal_harvest;
  const perennial = plan.crop_life_cycle === 'perennial' || Boolean(recurring);
  const recordedHarvest = plan.harvest_actual_occurrences?.flatMap(occurrence =>
    harvestInterval(occurrence.actual_start_date, occurrence.actual_end_date))
    ?? harvestInterval(recurring?.actual_start_date ?? plan.actual_harvest_start_date,
      recurring?.actual_end_date ?? plan.recorded_harvest_end_date);
  const estimatedHarvest = recurring?.periods ?? harvestInterval(plan.harvest_date, plan.harvest_end_date);
  // A plan with only a planting date has no reliable end. The serialized
  // occupancy end falls back to that same date for older incomplete plans.
  const explicitEnd = plan.clearing_date ?? plan.harvest_end_date ?? plan.harvest_date;
  const end = explicitEnd ? plan.occupancy_end_date ?? explicitEnd : null;
  return {
    id: plan.id, crop: plan.crop, name: plan.crop_display_name || plan.crop_name || null,
    variety: plan.crop_variety, color: plan.crop_display_color,
    start: planted ?? recurring?.occupancy_start_date ?? plan.planting_date,
    end, planted, estimatedHarvest, recordedHarvest, perennial,
  };
}

export function indexBedCultivations(plans: readonly PlantingPlan[]): Map<number, BedCultivationPlan[]> {
  const result = new Map<number, BedCultivationPlan[]>();
  for (const plan of plans) {
    if (typeof plan.id !== 'number' || typeof plan.bed !== 'number') continue;
    const entry = cultivationPlan({ ...plan, id: plan.id });
    const inBed = result.get(plan.bed);
    if (inBed) inBed.push(entry);
    else result.set(plan.bed, [entry]);
  }
  for (const inBed of result.values()) inBed.sort((a, b) =>
    (a.start ?? '\uffff').localeCompare(b.start ?? '\uffff') || a.id - b.id);
  return result;
}

export interface BedCultivationEntry {
  plan: BedCultivationPlan;
  phase: CropPhase | null;
  recordedHarvest: boolean;
  harvest?: SeasonalHarvestPeriod;
  recordedPeriods?: readonly SeasonalHarvestPeriod[];
}

export function bedCropDisplayName(
  plan: BedCultivationPlan, t: (key: string, options: { id: number | string }) => string, showVariety = true,
): string {
  const name = plan.name || t('ganttChart:taskNames.unknownCrop', { id: plan.crop ?? '' });
  return showVariety && plan.variety ? `${name} (${plan.variety})` : name;
}

export function bedCropPhaseLabel(entry: BedCultivationEntry, t: (key: string) => string): string | null {
  if (!entry.phase) return null;
  return t(entry.recordedHarvest ? 'graphical.display.recordedHarvest' : `graphical.display.phase.${entry.phase}`);
}

function periodIncludes(period: SeasonalHarvestPeriod, date: string): boolean {
  return date >= period.start_date && date <= period.end_date;
}

export function projectBedCultivation(
  plans: readonly BedCultivationPlan[],
  reference: CropReference,
  season: SeasonBounds,
): BedCultivationEntry[] {
  const date = reference.kind === 'date' ? reference.date
    : reference.kind === 'range' && reference.start === reference.end ? reference.start : null;
  const range = reference.kind === 'range' ? { start_date: reference.start, end_date: reference.end }
    : date ? { start_date: date, end_date: date } : season;
  return plans.flatMap<BedCultivationEntry>(plan => {
    const recordedPeriods = plan.recordedHarvest.filter(period =>
      period.start_date <= range.end_date && period.end_date >= range.start_date,
    );
    const isOutside = (plan.start !== null && plan.start > range.end_date)
      || (plan.end !== null && plan.end < range.start_date);
    if (isOutside && recordedPeriods.length === 0) return [];
    if (date === null) return [{ plan, phase: null, recordedHarvest: false, recordedPeriods }];
    const recorded = recordedPeriods[0];
    if (recorded) return [{ plan, phase: 'harvest', recordedHarvest: true, harvest: recorded }];
    if (plan.start === null || plan.end === null || plan.crop === null) {
      return [{ plan, phase: null, recordedHarvest: false }];
    }
    const harvest = plan.estimatedHarvest.find(period => periodIncludes(period, date));
    const windows = [...plan.estimatedHarvest, ...plan.recordedHarvest];
    const beforeHarvest = windows.length > 0 && windows.every(period => date < period.start_date);
    return [{
      plan, phase: harvest ? 'harvest' : !plan.perennial && beforeHarvest ? 'growth' : 'occupancy',
      recordedHarvest: false, harvest,
    }];
  });
}
