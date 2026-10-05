import type { Bed, Crop, Field, Location, PlantingPlan } from '../api/types';
import { getCropDisplayName } from '../crops/cropDisplay';
import { getEffectiveCropValue } from '../crops/varietyValueSource';
import { addUtcDays, formatIsoDate, parseIsoDate } from '../utils/isoDate';
import { getPlanSowingSchedule } from './planSowingDate';

export type DerivedTaskType =
  | 'sowing'
  | 'planting'
  | 'propagationStart'
  | 'harvestStart';

export interface DerivedLocationTask {
  type: DerivedTaskType;
  date: string;
  locationId: number;
  planId?: number;
  cropName?: string;
  bedName?: string;
  fieldName?: string;
}

const getPlanCropDisplayName = (plan: PlantingPlan): string | undefined => (
  plan.crop_display_name || plan.crop_name || undefined
);

export function deriveLocationTasks({
  locations,
  fields,
  beds,
  plantingPlans,
  crops,
  today = new Date(),
}: {
  locations: Location[];
  fields: Field[];
  beds: Bed[];
  plantingPlans: PlantingPlan[];
  crops: Crop[];
  today?: Date;
}): Record<number, DerivedLocationTask[]> {
  const locationIds = new Set(locations.map((location) => location.id).filter((id): id is number => typeof id === 'number'));
  const fieldById = new Map(fields.filter((field): field is Field & { id: number } => typeof field.id === 'number').map((field) => [field.id, field]));
  const bedById = new Map(beds.filter((bed): bed is Bed & { id: number } => typeof bed.id === 'number').map((bed) => [bed.id, bed]));
  const cropById = new Map(crops.filter((crop): crop is Crop & { id: number } => typeof crop.id === 'number').map((crop) => [crop.id, crop]));
  const byLocation: Record<number, DerivedLocationTask[]> = {};
  const dedupe = new Set<string>();
  const todayIso = formatIsoDate(today);

  const pushTask = (task: DerivedLocationTask): void => {
    if (task.date < todayIso) return;
    const key = `${task.locationId}:${task.planId ?? 'na'}:${task.type}:${task.date}`;
    if (dedupe.has(key)) return;
    dedupe.add(key);
    byLocation[task.locationId] = byLocation[task.locationId] ?? [];
    byLocation[task.locationId].push(task);
  };

  plantingPlans.forEach((plan) => {
    if (!plan.bed || !plan.crop) return;
    const bed = bedById.get(plan.bed);
    if (!bed) return;
    const field = fieldById.get(bed.field);
    if (!field || !locationIds.has(field.location)) return;
    const plantingDate = parseIsoDate(plan.planting_date);
    if (!plantingDate) return;
    const crop = cropById.get(plan.crop);
    const cropName = getPlanCropDisplayName(plan) || (crop ? getCropDisplayName(crop) : undefined);
    const schedule = getPlanSowingSchedule(plan, crop);
    const baseTaskType: DerivedTaskType = schedule?.isPreCultivation ? 'planting' : 'sowing';

    pushTask({
      type: baseTaskType,
      date: formatIsoDate(plantingDate),
      locationId: field.location,
      planId: plan.id,
      cropName,
      bedName: plan.bed_name || bed.name,
      fieldName: field.name,
    });

    if (schedule?.isPreCultivation && schedule.sowingDate) {
      pushTask({
        type: 'propagationStart',
        date: schedule.sowingDate,
        locationId: field.location,
        planId: plan.id,
        cropName,
        bedName: plan.bed_name || bed.name,
        fieldName: field.name,
      });
    }

    const growthDuration = getEffectiveCropValue(crop, 'growth_duration_days') ?? null;
    if (growthDuration && growthDuration > 0) {
      pushTask({
        type: 'harvestStart',
        date: formatIsoDate(addUtcDays(plantingDate, growthDuration)),
        locationId: field.location,
        planId: plan.id,
        cropName,
        bedName: plan.bed_name || bed.name,
        fieldName: field.name,
      });
    }
  });

  Object.values(byLocation).forEach((tasks) => {
    tasks.sort((left, right) => left.date.localeCompare(right.date));
  });
  return byLocation;
}
