import registryData from '../../../backend/crops/specific_properties.v1.json';

export type SpecificPropertyValue = string | number | boolean;
export type SpecificProperties = Record<string, SpecificPropertyValue>;
export interface SpecificPropertyDefinition {
  type: 'enum' | 'number' | 'integer' | 'boolean' | 'text';
  label_key: string;
  options?: Record<string, string>;
  minimum?: number;
  maximum?: number;
  max_length?: number;
}
interface Registry {
  version: number;
  profiles: Record<string, string[]>;
  properties: Record<string, SpecificPropertyDefinition>;
}
export const SPECIFIC_PROPERTY_REGISTRY = registryData as Registry;
export const SPECIFIC_PROPERTY_PREFIX = 'specific_properties.';

export function specificPropertyDefinitions(profile?: string): Record<string, SpecificPropertyDefinition> {
  return Object.fromEntries((SPECIFIC_PROPERTY_REGISTRY.profiles[profile ?? ''] ?? [])
    .map((key) => [key, SPECIFIC_PROPERTY_REGISTRY.properties[key]]));
}

export function hasSpecificPropertyValues(profile?: string, values: SpecificProperties = {}): boolean {
  return Object.keys(specificPropertyDefinitions(profile)).some((key) => values[key] !== undefined && values[key] !== '');
}

function validValue(value: SpecificPropertyValue, definition: SpecificPropertyDefinition): boolean {
  switch (definition.type) {
    case 'enum': return typeof value === 'string' && Object.hasOwn(definition.options ?? {}, value);
    case 'boolean': return typeof value === 'boolean';
    case 'text': return typeof value === 'string' && value.length <= (definition.max_length ?? 1000);
    default: return typeof value === 'number' && Number.isFinite(value)
      && (definition.type !== 'integer' || Number.isInteger(value))
      && value >= (definition.minimum ?? -Infinity) && value <= (definition.maximum ?? Infinity);
  }
}

export function invalidSpecificPropertyKeys(profile: string | undefined, values: SpecificProperties = {}): string[] {
  const definitions = specificPropertyDefinitions(profile);
  return Object.keys(values).filter((key) => !definitions[key] || !validValue(values[key], definitions[key]));
}

export function formatSpecificProperties(values: SpecificProperties, t: (key: string) => string): string {
  return Object.entries(values).flatMap(([key, value]) => {
    const definition = SPECIFIC_PROPERTY_REGISTRY.properties[key];
    if (!definition) return [];
    const option = definition.options?.[String(value)];
    const formatted = definition.type === 'enum' ? t(option ?? 'specificProperties.invalidValue') : typeof value === 'boolean'
      ? t(`detail.boolean.${value ? 'yes' : 'no'}`) : String(value);
    return [`${t(definition.label_key)}: ${formatted}`];
  }).join('; ');
}
