/**
 * Inherited site conditions of the growing-area hierarchy (#1075).
 *
 * Frontend twin of `backend/farm/services/site_conditions.py`, pinned to the
 * same cases by `tests/fixtures/site_conditions.json`. It is recomputed
 * locally so a changed location default shows on its fields and beds at once,
 * without waiting for a refetch.
 */
import type {
  Bed,
  EffectiveSiteCondition,
  EffectiveSiteConditions,
  Field,
  Location,
  SiteConditionLevel,
} from '../../../api/types';

export const INHERITED_SITE_CONDITION_FIELDS = [
  'light_condition',
  'soil_moisture',
  'irrigation',
  'soil_type',
] as const;

export type InheritedSiteConditionField = typeof INHERITED_SITE_CONDITION_FIELDS[number];

/** The structured choices of each inherited property, in display order. */
export const SITE_CONDITION_OPTIONS = {
  light_condition: ['sunny', 'partial_shade', 'shade'],
  soil_moisture: ['dry', 'normal', 'moist'],
  irrigation: ['available', 'unavailable'],
  soil_type: ['sand', 'loam', 'clay'],
} as const satisfies Record<InheritedSiteConditionField, readonly string[]>;

export const CULTIVATION_ENVIRONMENT_OPTIONS = ['open_field', 'polytunnel', 'greenhouse'] as const;

export interface SiteConditionChainNode {
  level: SiteConditionLevel;
  id: number | null | undefined;
  name: string;
  values: Partial<Record<InheritedSiteConditionField, string | null | undefined>>;
}

const UNKNOWN: EffectiveSiteCondition = { value: null, source: null, source_id: null, source_name: null };

/** Resolves every inherited property along `chain` (the entity first, then its ancestors). */
export function resolveEffectiveConditions(chain: readonly SiteConditionChainNode[]): EffectiveSiteConditions {
  const resolved = {} as Record<InheritedSiteConditionField, EffectiveSiteCondition>;
  INHERITED_SITE_CONDITION_FIELDS.forEach((field) => {
    const node = chain.find((candidate) => Boolean(candidate.values[field]));
    resolved[field] = node
      ? { value: node.values[field] ?? null, source: node.level, source_id: node.id ?? null, source_name: node.name }
      : UNKNOWN;
  });
  return resolved as EffectiveSiteConditions;
}

const toNode = (level: SiteConditionLevel, entity: Location | Field | Bed): SiteConditionChainNode => ({
  level,
  id: entity.id,
  name: entity.name,
  values: {
    light_condition: entity.light_condition,
    soil_moisture: entity.soil_moisture,
    irrigation: entity.irrigation,
    soil_type: entity.soil_type,
  },
});

/** The chain of a location, field or bed; missing ancestors are skipped. */
export function buildSiteConditionChain(
  entities: { location?: Location; field?: Field; bed?: Bed },
): SiteConditionChainNode[] {
  const chain: SiteConditionChainNode[] = [];
  if (entities.bed) chain.push(toNode('bed', entities.bed));
  if (entities.field) chain.push(toNode('field', entities.field));
  if (entities.location) chain.push(toNode('location', entities.location));
  return chain;
}

/** What a property would be without the entity's own value, i.e. after "Reset to inherited". */
export function resolveInheritedCondition(
  chain: readonly SiteConditionChainNode[],
  field: InheritedSiteConditionField,
): EffectiveSiteCondition {
  return resolveEffectiveConditions(chain.slice(1))[field];
}

/** The properties the growing-area grid edits inline (optional, hidden-by-default columns). */
export const INLINE_SITE_CONDITION_FIELDS = ['light_condition', 'soil_moisture', 'irrigation'] as const;
export type InlineSiteConditionField = typeof INLINE_SITE_CONDITION_FIELDS[number];

/**
 * The inline-editable conditions of a grid row as a save payload. A property
 * the row does not carry is left out, so a PUT keeps the stored value.
 */
export function pickInlineSiteConditions(
  row: Partial<Record<InlineSiteConditionField, unknown>>,
): Partial<Pick<Bed, InlineSiteConditionField>> {
  const payload: Record<string, string | null> = {};
  INLINE_SITE_CONDITION_FIELDS.forEach((field) => {
    const value = row[field];
    if (value === undefined) return;
    payload[field] = typeof value === 'string' && value !== '' ? value : null;
  });
  return payload as Partial<Pick<Bed, InlineSiteConditionField>>;
}
