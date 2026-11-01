export type SpreadsheetColumnDef = {
  headerKey: string;
  key: string;
  aliases: string[];
  /**
   * `list`: several values in one cell, separated by commas, semicolons or
   *   line breaks; with `enumExport`/`enumImport` they are enum values.
   * `companions`: one neighbour per line (see crops/companions.ts).
   */
  type: 'string' | 'number' | 'boolean' | 'list' | 'companions';
  enumExport?: Record<string, string>;
  enumImport?: Record<string, string>;
};

type LocalizedSpreadsheetColumnDef = SpreadsheetColumnDef & { header: string };
type SpreadsheetT = (key: string) => string;

export const NUTRIENT_DEMAND_EXPORT: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export const NUTRIENT_DEMAND_IMPORT: Record<string, string> = {
  niedrig: 'low',
  mittel: 'medium',
  hoch: 'high',
  low: 'low',
  medium: 'medium',
  high: 'high',
};

export const CULTIVATION_TYPE_EXPORT: Record<string, string> = {
  direct_sowing: 'Direct sowing',
  pre_cultivation: 'Transplanting',
};

export const CULTIVATION_TYPE_IMPORT: Record<string, string> = {
  direktsaat: 'direct_sowing',
  direktsaht: 'direct_sowing',
  pflanzung: 'pre_cultivation',
  'direct sowing': 'direct_sowing',
  transplanting: 'pre_cultivation',
  direct_sowing: 'direct_sowing',
  pre_cultivation: 'pre_cultivation',
};

export const YIELD_UNIT_EXPORT: Record<string, string> = {
  per_plant: 'Per plant',
  per_sqm: 'Per m²',
};

export const YIELD_UNIT_IMPORT: Record<string, string> = {
  'pro pflanze': 'per_plant',
  'je pflanze': 'per_plant',
  'pro m²': 'per_sqm',
  'pro qm': 'per_sqm',
  'per plant': 'per_plant',
  'per m²': 'per_sqm',
  'per sqm': 'per_sqm',
  per_plant: 'per_plant',
  per_sqm: 'per_sqm',
};

export const SEED_RATE_UNIT_EXPORT: Record<string, string> = {
  g_per_m2: 'g/m²',
  g_per_lfm: 'g/running m',
  seeds_per_m2: 'seeds/m²',
  seeds_per_lfm: 'seeds/running m',
  seeds_per_plant: 'seeds/plant',
};

export const SEED_RATE_UNIT_IMPORT: Record<string, string> = {
  'g/m²': 'g_per_m2',
  'g/qm': 'g_per_m2',
  'g/lfm': 'g_per_lfm',
  'körner/m²': 'seeds_per_m2',
  'körner/qm': 'seeds_per_m2',
  'körner/lfm': 'seeds_per_lfm',
  'körner/pflanze': 'seeds_per_plant',
  'g/running m': 'g_per_lfm',
  'seeds/m²': 'seeds_per_m2',
  'seeds/qm': 'seeds_per_m2',
  'seeds/running m': 'seeds_per_lfm',
  'seeds/plant': 'seeds_per_plant',
  g_per_m2: 'g_per_m2',
  g_per_lfm: 'g_per_lfm',
  seeds_per_m2: 'seeds_per_m2',
  seeds_per_lfm: 'seeds_per_lfm',
  seeds_per_plant: 'seeds_per_plant',
};

export const CROP_COLUMNS: SpreadsheetColumnDef[] = [
  {
    key: 'name',
    headerKey: 'form.name',
    aliases: ['kulturname', 'kultur', 'bezeichnung'],
    type: 'string',
  },
  {
    key: 'variety',
    headerKey: 'form.variety',
    aliases: ['sortenname', 'varietät', 'cultivar'],
    type: 'string',
  },
  {
    key: 'supplier_name',
    headerKey: 'form.supplier',
    aliases: ['lieferant', 'seed_supplier', 'hersteller', 'lieferanten'],
    type: 'string',
  },
  {
    key: 'botanical_name',
    headerKey: 'form.botanicalName',
    aliases: [
      'lateinische bezeichnung', 'lateinischer name', 'botanischer name', 'wissenschaftlicher name',
      'latin name', 'botanical name', 'scientific name',
    ],
    type: 'string',
  },
  {
    key: 'crop_family',
    headerKey: 'form.cropFamily',
    aliases: ['familie', 'pflanzenart', 'pfanzenfamilie'],
    type: 'string',
  },
  {
    key: 'nutrient_demand',
    headerKey: 'form.nutrientDemand',
    aliases: ['nährstoff', 'düngebedarf', 'nutrient_demand'],
    type: 'string',
    enumExport: NUTRIENT_DEMAND_EXPORT,
    enumImport: NUTRIENT_DEMAND_IMPORT,
  },
  {
    key: 'cultivation_types',
    headerKey: 'form.cultivationType',
    aliases: ['anbaumethode', 'saatmethode', 'cultivation_type', 'cultivation_types'],
    type: 'list',
    enumExport: CULTIVATION_TYPE_EXPORT,
    enumImport: CULTIVATION_TYPE_IMPORT,
  },
  {
    key: 'tags',
    headerKey: 'form.tags',
    aliases: ['gruppe', 'gruppen', 'groups', 'group', 'tags', 'groupes', 'grupos'],
    type: 'list',
  },
  {
    key: 'growth_duration_days',
    headerKey: 'form.growthDurationDays',
    aliases: ['wachstumszeit', 'wachstumsdauer', 'wachstumstage', 'tage bis ernte', 'growth_duration_days'],
    type: 'number',
  },
  {
    key: 'harvest_duration_days',
    headerKey: 'form.harvestDurationDays',
    aliases: ['erntezeit', 'erntezeitraum', 'erntedauer', 'erntedauer tage', 'harvest_duration_days'],
    type: 'number',
  },
  {
    key: 'propagation_duration_days',
    headerKey: 'form.propagationDurationDays',
    aliases: ['anzuchtdauer', 'anzuchttage', 'propagation_duration_days'],
    type: 'number',
  },
  {
    key: 'harvest_method',
    headerKey: 'form.yieldUnit',
    aliases: ['ertragseinheit', 'ernte methode', 'ernteart', 'harvest_method'],
    type: 'string',
    enumExport: YIELD_UNIT_EXPORT,
    enumImport: YIELD_UNIT_IMPORT,
  },
  {
    key: 'expected_yield',
    headerKey: 'export.columns.expectedYieldKgPerSqm',
    aliases: ['ertrag', 'erwarteter ertrag', 'expected_yield'],
    type: 'number',
  },
  {
    key: 'distance_within_row_cm',
    headerKey: 'form.distanceWithinRowCm',
    aliases: ['pflanzenabstand', 'abstand in der reihe', 'abstand reihe', 'distance_within_row_cm'],
    type: 'number',
  },
  {
    key: 'row_spacing_cm',
    headerKey: 'form.rowSpacingCm',
    aliases: ['zeilenabstand', 'reihenzwischenabstand', 'row_spacing_cm'],
    type: 'number',
  },
  {
    key: 'sowing_depth_cm',
    headerKey: 'form.sowingDepthCm',
    aliases: ['tiefe', 'aussaattiefe', 'sowing_depth_cm'],
    type: 'number',
  },
  {
    key: 'thousand_kernel_weight_g',
    headerKey: 'form.thousandKernelWeightLabel',
    aliases: ['tkg', 'tausendkorngewicht', '1000-korn', 'thousand_kernel_weight_g'],
    type: 'number',
  },
  {
    key: 'sowing_calculation_safety_percent',
    headerKey: 'detail.fields.seedSafetyMarginPercent',
    aliases: ['sicherheitsaufschlag', 'sicherheitsmarge', 'sowing_calculation_safety_percent'],
    type: 'number',
  },
  {
    key: 'seed_rate_direct_value',
    headerKey: 'form.seedRateDirectValue',
    aliases: ['direktsaat menge', 'direktsaat saatgut', 'seed_rate_direct_value'],
    type: 'number',
  },
  {
    key: 'seed_rate_direct_unit',
    headerKey: 'form.seedRateDirectUnit',
    aliases: ['direktsaat einheit', 'seed_rate_direct_unit'],
    type: 'string',
    enumExport: SEED_RATE_UNIT_EXPORT,
    enumImport: SEED_RATE_UNIT_IMPORT,
  },
  {
    key: 'sowing_calculation_safety_percent_direct',
    headerKey: 'export.columns.safetyPercentDirect',
    aliases: ['sicherheitszuschlag direktsaat', 'sowing_calculation_safety_percent_direct'],
    type: 'number',
  },
  {
    key: 'seed_rate_pre_cultivation_value',
    headerKey: 'form.seedRatePreCultivationValue',
    aliases: ['pflanzung menge', 'pflanzung saatgut', 'seed_rate_pre_cultivation_value'],
    type: 'number',
  },
  {
    key: 'seed_rate_pre_cultivation_unit',
    headerKey: 'form.seedRatePreCultivationUnit',
    aliases: ['pflanzung einheit', 'seed_rate_pre_cultivation_unit'],
    type: 'string',
    enumExport: SEED_RATE_UNIT_EXPORT,
    enumImport: SEED_RATE_UNIT_IMPORT,
  },
  {
    key: 'sowing_calculation_safety_percent_pre_cultivation',
    headerKey: 'export.columns.safetyPercentPreCultivation',
    aliases: ['sicherheitszuschlag pflanzung', 'sowing_calculation_safety_percent_pre_cultivation'],
    type: 'number',
  },
  {
    key: 'display_color',
    headerKey: 'form.displayColor',
    aliases: ['farbe', 'color', 'colour', 'display_color'],
    type: 'string',
  },
  {
    key: 'notes',
    headerKey: 'form.notes',
    aliases: ['anmerkungen', 'kommentar', 'notiz', 'hinweise'],
    type: 'string',
  },
  {
    key: 'good_companions',
    headerKey: 'companions.goodColumn',
    aliases: ['good companions', 'good neighbours', 'gute nachbarn', 'mischkultur gut'],
    type: 'companions',
  },
  {
    key: 'bad_companions',
    headerKey: 'companions.badColumn',
    aliases: ['bad companions', 'bad neighbours', 'schlechte nachbarn', 'mischkultur schlecht'],
    type: 'companions',
  },
];

const buildNutrientDemandExport = (t: SpreadsheetT): Record<string, string> => ({
  low: t('form.nutrientDemandLow'),
  medium: t('form.nutrientDemandMedium'),
  high: t('form.nutrientDemandHigh'),
});

const buildCultivationTypeExport = (t: SpreadsheetT): Record<string, string> => ({
  direct_sowing: t('form.cultivationTypeDirectSowing'),
  pre_cultivation: t('form.cultivationTypePreCultivation'),
});

const buildYieldUnitExport = (t: SpreadsheetT): Record<string, string> => ({
  per_plant: t('form.yieldUnitPerPlant'),
  per_sqm: t('form.yieldUnitPerSqm'),
});

const buildSeedRateUnitExport = (t: SpreadsheetT): Record<string, string> => ({
  g_per_m2: t('detail.seedUnits.gPerSqm'),
  g_per_lfm: t('detail.seedUnits.gPerRunningMeter'),
  seeds_per_m2: t('detail.seedUnits.seedsPerSqm'),
  seeds_per_lfm: t('detail.seedUnits.seedsPerRunningMeter'),
  seeds_per_plant: t('detail.seedUnits.seedsPerPlant'),
});

const getLocalizedEnumExport = (columnKey: string, t: SpreadsheetT): Record<string, string> | undefined => {
  if (columnKey === 'nutrient_demand') return buildNutrientDemandExport(t);
  if (columnKey === 'cultivation_types') return buildCultivationTypeExport(t);
  if (columnKey === 'harvest_method') return buildYieldUnitExport(t);
  if (columnKey === 'seed_rate_direct_unit' || columnKey === 'seed_rate_pre_cultivation_unit') {
    return buildSeedRateUnitExport(t);
  }
  return undefined;
};

export const getLocalizedCropColumns = (t: SpreadsheetT): LocalizedSpreadsheetColumnDef[] =>
  CROP_COLUMNS.map((column) => ({
    ...column,
    header: t(column.headerKey),
    enumExport: getLocalizedEnumExport(column.key, t) ?? column.enumExport,
  }));

export const normalizeHeaderForLookup = (header: string): string =>
  header.trim().toLowerCase().replace(/\s+/g, ' ');

/** Like the header lookup, but also ignores spacing around "/" ("g / m²" = "g/m²"). */
export const normalizeEnumValueForLookup = (value: string): string =>
  normalizeHeaderForLookup(value).replace(/\s*\/\s*/g, '/');

/**
 * Header lookup for an imported sheet. Pass one translator per UI language so
 * a file exported in any language imports regardless of the current one.
 */
export const buildHeaderToKeyMap = (...translators: SpreadsheetT[]): Map<string, string> => {
  const map = new Map<string, string>();
  for (const t of translators) {
    for (const col of getLocalizedCropColumns(t)) {
      map.set(normalizeHeaderForLookup(col.header), col.key);
    }
  }
  for (const col of CROP_COLUMNS) {
    map.set(normalizeHeaderForLookup(col.headerKey), col.key);
    for (const alias of col.aliases) {
      map.set(normalizeHeaderForLookup(alias), col.key);
    }
  }
  return map;
};

/**
 * Enum label lookup per column key: the static aliases plus the inverse of the
 * localized export labels for every translator, later translators winning.
 * Without the latter a sheet exported by the app ("Starkzehrer", "g / m²")
 * would not import back.
 */
export const buildEnumImportMaps = (...translators: SpreadsheetT[]): Map<string, Record<string, string>> => {
  const maps = new Map<string, Record<string, string>>();
  for (const col of CROP_COLUMNS) {
    if (!col.enumImport) continue;
    const map: Record<string, string> = {};
    for (const [label, value] of Object.entries(col.enumImport)) {
      map[normalizeEnumValueForLookup(label)] = value;
    }
    for (const t of translators) {
      for (const [value, label] of Object.entries(getLocalizedEnumExport(col.key, t) ?? {})) {
        map[normalizeEnumValueForLookup(label)] = value;
      }
    }
    maps.set(col.key, map);
  }
  return maps;
};
