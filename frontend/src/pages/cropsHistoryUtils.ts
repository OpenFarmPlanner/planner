import type { TFunction } from 'i18next';
import type { CropHistoryChange, CropHistoryEntry } from '../api/types';

export type HistoryScope = 'crop' | 'global' | 'project';

const OBJECT_TYPE_TRANSLATION_KEYS: Record<string, string> = {
  crop: 'history.objectTypes.crop',
  planting_plan: 'history.objectTypes.plantingPlan',
  location: 'history.objectTypes.location',
  field: 'history.objectTypes.field',
  bed: 'history.objectTypes.bed',
  supplier: 'history.objectTypes.supplier',
  task: 'history.objectTypes.task',
  season: 'history.objectTypes.season',
  note_attachment: 'history.objectTypes.noteAttachment',
  media_file: 'history.objectTypes.mediaFile',
  seed_package: 'history.objectTypes.seedPackage',
  project: 'history.objectTypes.project',
};

const ACTION_TRANSLATION_KEYS: Record<string, string> = {
  created: 'history.actions.created',
  updated: 'history.actions.updated',
  deleted: 'history.actions.deleted',
  restored: 'history.actions.restored',
};

const HISTORY_FIELD_LABEL_KEYS: Record<string, string> = {
  created: 'history.fieldLabels.created',
  name: 'form.name',
  variety: 'form.variety',
  notes: 'form.notes',
  seed_supplier: 'form.supplier',
  crop_family: 'form.cropFamily',
  nutrient_demand: 'form.nutrientDemand',
  cultivation_type: 'form.cultivationType',
  cultivation_types: 'form.cultivationType',
  growth_duration_days: 'form.growthDurationDays',
  harvest_duration_days: 'form.harvestDurationDays',
  propagation_duration_days: 'form.propagationDurationDays',
  harvest_method: 'form.yieldUnit',
  expected_yield: 'form.expectedYield',
  distance_within_row_m: 'form.distanceWithinRowCm',
  row_spacing_m: 'form.rowSpacingCm',
  sowing_depth_m: 'form.sowingDepthCm',
  seed_rate_value: 'form.seedRateValue',
  seed_rate_unit: 'form.seedRateUnit',
  seed_rate_by_cultivation: 'form.seedRateSectionTitle',
  seed_rate_direct_value: 'form.seedRateDirectValue',
  seed_rate_direct_unit: 'form.seedRateDirectUnit',
  sowing_calculation_safety_percent_direct: 'history.fieldLabels.sowingCalculationSafetyPercentDirect',
  seed_rate_pre_cultivation_value: 'form.seedRatePreCultivationValue',
  seed_rate_pre_cultivation_unit: 'form.seedRatePreCultivationUnit',
  sowing_calculation_safety_percent_pre_cultivation: 'history.fieldLabels.sowingCalculationSafetyPercentPreCultivation',
  sowing_calculation_safety_percent: 'form.sowingCalculationSafetyPercentLabel',
  thousand_kernel_weight_g: 'form.thousandKernelWeightLabel',
  seeding_requirement: 'form.seedRateSectionTitle',
  seeding_requirement_type: 'history.fieldLabels.seedingRequirementType',
  display_color: 'form.displayColor',
  supplier_id: 'history.fieldLabels.supplier',
  supplier_product_url: 'form.supplierHomepage',
  image_file_id: 'history.fieldLabels.image',
  selected_seed_demand_supplier_id: 'history.fieldLabels.selectedSeedDemandSupplier',
};

const SEED_RATE_UNIT_LABELS: Record<string, string> = {
  g_per_m2: 'g / m²',
  g_per_lfm: 'g / lfm',
  seeds_per_m2: 'Korn / m²',
  seeds_per_lfm: 'Korn / lfm',
  seeds_per_plant: 'Korn / Pflanze',
};

export function getHistoryObjectTypeLabel(objectType: string | undefined, t: TFunction<'crops'>): string {
  if (!objectType) {
    return t('history.objectTypes.fallback');
  }
  return t(OBJECT_TYPE_TRANSLATION_KEYS[objectType] ?? 'history.objectTypes.fallback');
}

export function getHistoryActionLabel(action: string | undefined, t: TFunction<'crops'>): string {
  if (!action) {
    return t('history.actions.updated');
  }
  return t(ACTION_TRANSLATION_KEYS[action] ?? 'history.actions.updated');
}

export function getHistoryEntryTitle(entry: CropHistoryEntry, t: TFunction<'crops'>): string {
  const objectTypeLabel = getHistoryObjectTypeLabel(entry.object_type, t);
  const actionLabel = getHistoryActionLabel(entry.action, t);
  const objectDisplayName = entry.object_display_name?.trim();

  if (objectDisplayName) {
    return t('history.title.withName', {
      objectType: objectTypeLabel,
      objectName: objectDisplayName,
      action: actionLabel,
    });
  }

  return t('history.title.withoutName', {
    objectType: objectTypeLabel,
    action: actionLabel,
  });
}

export function getHistoryActorLabel(
  entry: CropHistoryEntry,
  t: TFunction<'crops'>,
  fallbackActorLabel?: string,
): string {
  return entry.actor_label?.trim()
    || entry.history_user?.trim()
    || fallbackActorLabel?.trim()
    || t('history.unknownUser');
}

export function getHistoryEntryMeta(
  entry: CropHistoryEntry,
  t: TFunction<'crops'>,
  fallbackActorLabel?: string,
): string {
  const actorLabel = getHistoryActorLabel(entry, t, fallbackActorLabel);
  const timestamp = new Date(entry.history_date).toLocaleString('de-DE');
  return t('history.meta', { actor: actorLabel, timestamp });
}

export function isCurrentHistoryEntry(
  entry: CropHistoryEntry,
  index: number,
): boolean {
  return entry.is_current_version ?? index === 0;
}

/** Localized label for a raw crop field name, for any surface that shows one. */
export function getCropFieldLabel(field: string, t: TFunction<'crops'>): string {
  return t(HISTORY_FIELD_LABEL_KEYS[field] ?? 'history.fieldLabels.fallback');
}

export function getHistoryChangeFieldLabel(change: CropHistoryChange, t: TFunction<'crops'>): string {
  return getCropFieldLabel(change.field, t);
}

function formatNumberValue(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(value);
}

function formatCultivationType(value: unknown, t: TFunction<'crops'>): string {
  if (value === 'direct_sowing') {
    return t('form.cultivationTypeDirectSowing');
  }
  if (value === 'pre_cultivation') {
    return t('form.cultivationTypePreCultivation');
  }
  return typeof value === 'string' ? value : t('history.emptyValue');
}

function formatSeedRateByCultivation(value: unknown, t: TFunction<'crops'>): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return t('history.emptyValue');
  }

  const entries = Object.entries(value as Record<string, { value?: unknown; unit?: unknown }>)
    .map(([method, payload]) => {
      if (!payload || typeof payload.value !== 'number') {
        return null;
      }
      const methodLabel = formatCultivationType(method, t);
      const unitLabel = typeof payload.unit === 'string'
        ? SEED_RATE_UNIT_LABELS[payload.unit] ?? payload.unit
        : '';
      return `${methodLabel}: ${formatNumberValue(payload.value)}${unitLabel ? ` ${unitLabel}` : ''}`;
    })
    .filter((entry): entry is string => Boolean(entry));

  return entries.length > 0 ? entries.join('; ') : t('history.emptyValue');
}

export function formatHistoryChangeValue(
  value: unknown,
  field: string,
  t: TFunction<'crops'>,
): string {
  if (value === null || value === undefined || value === '') {
    return t('history.emptyValue');
  }
  if (field === 'created') {
    return t('history.createdValue');
  }
  if (field === 'seed_rate_by_cultivation') {
    return formatSeedRateByCultivation(value, t);
  }
  if (field.endsWith('_unit') && typeof value === 'string') {
    return SEED_RATE_UNIT_LABELS[value] ?? value;
  }
  if (field === 'cultivation_type') {
    return formatCultivationType(value, t);
  }
  if (field === 'cultivation_types' && Array.isArray(value)) {
    return value.map((item) => formatCultivationType(item, t)).join(', ');
  }
  if (field === 'harvest_method') {
    if (value === 'per_plant') {
      return t('form.yieldUnitPerPlant');
    }
    if (value === 'per_sqm') {
      return t('form.yieldUnitPerSqm');
    }
  }
  if (field === 'nutrient_demand') {
    if (value === 'low') {
      return t('form.nutrientDemandLow');
    }
    if (value === 'medium') {
      return t('form.nutrientDemandMedium');
    }
    if (value === 'high') {
      return t('form.nutrientDemandHigh');
    }
  }
  if (typeof value === 'boolean') {
    return value ? t('history.booleanYes') : t('history.booleanNo');
  }
  if (typeof value === 'number') {
    if (field === 'distance_within_row_m' || field === 'row_spacing_m' || field === 'sowing_depth_m') {
      return `${formatNumberValue(value * 100)} cm`;
    }
    if (field.includes('safety_percent')) {
      return `${formatNumberValue(value)} %`;
    }
    if (field === 'expected_yield') {
      return `${formatNumberValue(value)} kg`;
    }
    if (field === 'thousand_kernel_weight_g') {
      return `${formatNumberValue(value)} g`;
    }
    return formatNumberValue(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => formatHistoryChangeValue(item, field, t)).join(', ');
  }
  if (typeof value === 'object') {
    return t('history.complexValue');
  }
  return String(value);
}

function extractObjectIdFromSummary(summary: string): number | null {
  const match = summary.match(/#(\d+)/);
  if (!match) {
    return null;
  }

  const objectId = Number.parseInt(match[1], 10);
  return Number.isFinite(objectId) ? objectId : null;
}

const BATCH_OPERATION_BASE_KEYS: Record<string, string> = {
  season_create: 'history.batch.seasonCreate',
  season_delete: 'history.batch.seasonDelete',
  season_undelete: 'history.batch.seasonUndelete',
  season_copy_data: 'history.batch.seasonCopyData',
};

const BATCH_COUNT_KEYS: Record<string, string> = {
  deleted: 'history.batch.countDeleted',
  created: 'history.batch.countCreated',
  restored: 'history.batch.countRestored',
  updated: 'history.batch.countUpdated',
};

/** A batch entry always renders as one row with a single revert action. */
export function isBatchGroupEntry(entry: CropHistoryEntry): boolean {
  return Boolean(entry.is_batch);
}

function batchBaseText(
  operationType: string | undefined,
  context: Record<string, unknown>,
  t: TFunction<'crops'>,
): string {
  const baseKey = BATCH_OPERATION_BASE_KEYS[operationType ?? ''] ?? 'history.batch.fallback';
  return t(baseKey, {
    season: String(context.season_label ?? ''),
    source: String(context.source_season_label ?? ''),
    target: String(context.target_season_label ?? ''),
  });
}

export function getBatchSummary(entry: CropHistoryEntry, t: TFunction<'crops'>): string {
  const context = (entry.batch_context ?? {}) as Record<string, unknown>;

  if (entry.batch_operation_type === 'batch_reverted') {
    return t('history.batch.reverted', {
      what: batchBaseText(String(context.reverted_operation_type ?? ''), context, t),
    });
  }

  const base = batchBaseText(entry.batch_operation_type, context, t);

  // Only planting plans carry a count today; the primary entity's own revision
  // (e.g. the season) is described by the base text, not counted.
  const counts = (entry.children ?? []).reduce<Record<string, number>>((acc, child) => {
    if (child.object_type === 'planting_plan') {
      const action = child.action ?? 'updated';
      acc[action] = (acc[action] ?? 0) + 1;
    }
    return acc;
  }, {});

  const parts = ['deleted', 'created', 'restored', 'updated']
    .filter((action) => counts[action])
    .map((action) => t(BATCH_COUNT_KEYS[action], { count: counts[action] }));

  return parts.length > 0 ? `${base}: ${parts.join(', ')}` : base;
}

export function getHistoryEntryTarget(entry: CropHistoryEntry): string | null {
  if (entry.object_type === 'crop') {
    const cropId = entry.crop_id ?? extractObjectIdFromSummary(entry.summary);
    if (cropId) {
      return `/app/crops?cropId=${cropId}`;
    }
    return '/app/crops';
  }

  if (entry.object_type === 'planting_plan') {
    return '/app/planting-plans';
  }

  return null;
}
