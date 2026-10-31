import type { Crop } from '../api/types';
import { getEffectiveCropValue } from './varietyValueSource';

// The backend's rules (farm/services/crop_tags.py), so the form shows what will be saved.
const LEADING_BULLETS = /^[\s•‣⁃▪●·*\-–—]+/;
const MAX_TAG_LENGTH = 60;

export const normalizeCropTag = (value: string): string => (
  value.replace(LEADING_BULLETS, '').replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LENGTH).trim()
);

const tagKey = (value: string): string => normalizeCropTag(value).toLocaleLowerCase();

/**
 * Group names cleaned up and without duplicates; a name in `known` (the
 * project's groups) takes that spelling, so "kräuter" joins "Kräuter".
 */
export const normalizeCropTags = (values: readonly string[], known: readonly string[] = []): string[] => {
  const spellings = new Map(known.map((tag) => [tagKey(tag), tag] as const));
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const tag = normalizeCropTag(value);
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(spellings.get(key) ?? tag);
  }
  return tags;
};

/** A crop's groups, a Sorte's inherited from its Kultur when it has none of its own. */
export const getEffectiveCropTags = (crop: Partial<Crop> | null | undefined): string[] => (
  getEffectiveCropValue(crop, 'tags') ?? []
);

/** Every group used in the project, sorted, each in its first spelling. */
export const collectProjectTags = (crops: readonly Partial<Crop>[]): string[] => {
  const byKey = new Map<string, string>();
  for (const crop of crops) {
    for (const tag of crop.tags ?? []) {
      const key = tagKey(tag);
      if (key && !byKey.has(key)) byKey.set(key, normalizeCropTag(tag));
    }
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
};
