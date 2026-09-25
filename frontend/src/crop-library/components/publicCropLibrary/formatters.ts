import type { TFunction } from 'i18next';
import type {
  PublicCrop,
  PublicCropDiscussionComment,
  PublicCropFieldChange,
} from '../../../api/types';
import { getLanguageDisplayName, normalizeLanguageTag } from '../../../i18n/languages';
import { stripCitationMarkers } from '../../../components/data-grid/markdown';
import {
  getCultivationTypeLabel,
  getPublicCropTitle,
} from '../../publicCropDisplay';
import { formatSeedRateByCultivation } from '../../../pages/cropsHistoryUtils';
import { readWithLegacyKey } from '../../../compat/legacyCropNames';

export type PublicCropTab = 'details' | 'versions' | 'discussion';

export const SELECTED_PUBLIC_CROP_STORAGE_KEY = 'selectedPublicCropId';
/** Pre-"Crop" spelling, still present for users who last visited before the rename. */
export const LEGACY_SELECTED_PUBLIC_CROP_STORAGE_KEY = 'selectedPublicCultureId';
export const PUBLIC_CROP_LIBRARY_VIEW_STATE_STORAGE_KEY = 'publicCropLibraryViewState';
export const MAX_VISIBLE_REPLY_DEPTH = 3;
export const PUBLIC_CROP_TAB_BY_INDEX: PublicCropTab[] = ['details', 'versions', 'discussion'];
export const PUBLIC_CROP_TAB_INDEX_BY_PARAM: Record<PublicCropTab, number> = {
  details: 0,
  versions: 1,
  discussion: 2,
};

export interface ThreadCommentGroup {
  comment: PublicCropDiscussionComment;
  children: ThreadCommentGroup[];
}

export interface PublicCropLibraryViewState {
  cropId: number;
  tab: PublicCropTab;
  discussionId: number | null;
  query: string;
  listScrollTop: number;
}

export function parsePublicCropId(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsedId = Number.parseInt(value, 10);
  return Number.isFinite(parsedId) ? parsedId : null;
}

export function getPublicCropTabIndex(tabParam: string | null, discussionId: number | null): number {
  if (discussionId !== null) {
    return PUBLIC_CROP_TAB_INDEX_BY_PARAM.discussion;
  }
  if (tabParam === 'versions' || tabParam === 'discussion') {
    return PUBLIC_CROP_TAB_INDEX_BY_PARAM[tabParam];
  }
  return PUBLIC_CROP_TAB_INDEX_BY_PARAM.details;
}

export function getStoredPublicCropId(): number | null {
  return parsePublicCropId(readWithLegacyKey(
    window.localStorage,
    SELECTED_PUBLIC_CROP_STORAGE_KEY,
    LEGACY_SELECTED_PUBLIC_CROP_STORAGE_KEY,
  ));
}

export function isPublicCropTab(value: unknown): value is PublicCropTab {
  return value === 'details' || value === 'versions' || value === 'discussion';
}

export function getStoredPublicCropLibraryViewState(): PublicCropLibraryViewState | null {
  const rawValue = window.localStorage.getItem(PUBLIC_CROP_LIBRARY_VIEW_STATE_STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    const parsedValue = JSON.parse(rawValue) as Partial<PublicCropLibraryViewState>;
    const cropId = typeof parsedValue.cropId === 'number' && Number.isFinite(parsedValue.cropId)
      ? parsedValue.cropId
      : null;
    if (cropId === null || !isPublicCropTab(parsedValue.tab)) {
      return null;
    }

    const discussionId = typeof parsedValue.discussionId === 'number' && Number.isFinite(parsedValue.discussionId)
      ? parsedValue.discussionId
      : null;
    const query = typeof parsedValue.query === 'string' ? parsedValue.query : '';
    const listScrollTop = typeof parsedValue.listScrollTop === 'number' && Number.isFinite(parsedValue.listScrollTop)
      ? Math.max(0, parsedValue.listScrollTop)
      : 0;

    return {
      cropId,
      tab: parsedValue.tab,
      discussionId,
      query,
      listScrollTop,
    };
  } catch {
    return null;
  }
}

export function storePublicCropLibraryViewState(viewState: PublicCropLibraryViewState): void {
  window.localStorage.setItem(PUBLIC_CROP_LIBRARY_VIEW_STATE_STORAGE_KEY, JSON.stringify(viewState));
}

/**
 * Entry title in the active UI language.
 *
 * The species name follows the translation fallback chain; the variety name is
 * a proper name and is appended verbatim in every language.
 */
export const getCropTitle = (crop: PublicCrop, t: TFunction, language: string): string =>
  getPublicCropTitle(crop, language, t('library.translation.missingName'));

export function getCommentTimestamp(comment: PublicCropDiscussionComment): number {
  if (!comment.created_at) {
    return 0;
  }
  const timestamp = new Date(comment.created_at).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function compareComments(a: PublicCropDiscussionComment, b: PublicCropDiscussionComment): number {
  const timestampDifference = getCommentTimestamp(a) - getCommentTimestamp(b);
  return timestampDifference || a.id - b.id;
}

export function buildThreadCommentTree(comments: PublicCropDiscussionComment[]): ThreadCommentGroup[] {
  const nodesById = new Map<number, ThreadCommentGroup>();
  const rootNodes: ThreadCommentGroup[] = [];

  [...comments].sort(compareComments).forEach((comment) => {
    nodesById.set(comment.id, { comment, children: [] });
  });

  [...nodesById.values()].forEach((node) => {
    const parent = node.comment.parent ? nodesById.get(node.comment.parent) : undefined;
    if (!parent || parent.comment.id === node.comment.id) {
      rootNodes.push(node);
      return;
    }
    parent.children.push(node);
  });

  const sortTree = (nodes: ThreadCommentGroup[]): ThreadCommentGroup[] => (
    nodes.sort((a, b) => compareComments(a.comment, b.comment)).map((node) => ({
      ...node,
      children: sortTree(node.children),
    }))
  );

  return sortTree(rootNodes);
}

export function getDeletedCommentPlaceholder(
  comment: PublicCropDiscussionComment,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (comment.deletion_kind === 'author') {
    return t('library.page.discussion.authorDeleted');
  }
  if (comment.deletion_kind === 'moderator') {
    return t('library.page.discussion.moderatorDeleted');
  }
  return t('library.page.discussion.deleted');
}

export function formatDiscussionPreview(value?: string | null): string {
  return stripCitationMarkers(value ?? '')
    .replace(/[`*_>#~\-[\]()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatLocalizedNumber(value: number | string | null | undefined, locale: string, fallback: string, options?: Intl.NumberFormatOptions): string {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const numericValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return new Intl.NumberFormat(locale, options).format(numericValue);
}

export function formatDays(value: number | null | undefined, locale: string, fallback: string, dayLabel: string): string {
  return value === null || value === undefined
    ? fallback
    : `${formatLocalizedNumber(value, locale, fallback)} ${dayLabel}`;
}

export function formatMetersAsCentimeters(value: number | null | undefined, locale: string, fallback: string): string {
  return value === null || value === undefined
    ? fallback
    : `${formatLocalizedNumber(value * 100, locale, fallback, { maximumFractionDigits: 1 })} cm`;
}

export function getNutrientDemandLabel(
  value: PublicCrop['nutrient_demand'],
  t: (key: string, options?: Record<string, unknown>) => string,
  fallback: string,
): string {
  if (value === 'low' || value === 'medium' || value === 'high') {
    return t(`library.page.fields.nutrientDemandValues.${value}`);
  }
  return fallback;
}

export function getCultivationTypesLabel(
  crop: PublicCrop,
  t: TFunction,
  fallback: string,
): string {
  const values = crop.cultivation_types?.length
    ? crop.cultivation_types
    : crop.cultivation_type ? [crop.cultivation_type] : [];
  const labels = values
    .map((value) => getCultivationTypeLabel(value, t, ''))
    .filter(Boolean);
  return labels.length > 0 ? labels.join(', ') : fallback;
}

export function getHarvestMethodLabel(
  value: PublicCrop['harvest_method'],
  t: (key: string, options?: Record<string, unknown>) => string,
  fallback: string,
): string {
  if (value === 'per_plant') {
    return t('library.page.harvestMethods.perPlant');
  }
  if (value === 'per_sqm') {
    return t('library.page.harvestMethods.perSqm');
  }
  return fallback;
}

export function getLanguageLabel(code: string | null | undefined, displayLanguage: string, fallback: string): string {
  if (!code) {
    return fallback;
  }
  return getLanguageDisplayName(code, displayLanguage);
}

export function getPublicCropOriginalLanguageCode(crop: PublicCrop, currentLanguage: string): string {
  return normalizeLanguageTag(crop.original_language_code)
    ?? normalizeLanguageTag(crop.description_language_code)
    ?? normalizeLanguageTag(currentLanguage)
    ?? 'de';
}

export function buildPublicCropDescriptionDrafts(crop: PublicCrop): Record<string, string> {
  const translations = { ...(crop.translations ?? {}) };
  const servedLanguageCode = normalizeLanguageTag(crop.description_language_code);
  if (servedLanguageCode && !translations[servedLanguageCode] && crop.description) {
    translations[servedLanguageCode] = crop.description;
  }
  const originalLanguageCode = getPublicCropOriginalLanguageCode(crop, crop.original_language_code ?? '');
  if (!translations[originalLanguageCode] && crop.notes) {
    translations[originalLanguageCode] = crop.notes;
  }
  return translations;
}

export function getPublicCropFieldLabel(field: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  const fieldLabelKeys: Partial<Record<string, string>> = {
    name: 'library.page.fields.cropSpecies',
    variety: 'library.page.fields.variety',
    notes: 'library.page.fields.notes',
    growth_duration_days: 'library.page.fields.growthDurationDays',
    harvest_duration_days: 'library.page.fields.harvestDurationDays',
    propagation_duration_days: 'library.page.fields.propagationDurationDays',
  };
  const key = fieldLabelKeys[field];
  if (key) {
    return t(key);
  }
  return field;
}

const normalizeComparisonValue = (value: unknown): unknown => {
  if (value === undefined || value === '') return null;
  if (Array.isArray(value)) return value.length ? [...value].sort() : null;
  return value;
};

/** Label for one changed public-crop field, shared by every diff surface. */
export function getPublicCropComparisonFieldLabel(field: string, t: TFunction): string {
  return t(`library.publishWizard.comparison.fields.${field}`);
}

/**
 * Renders one public-crop field value for a diff row.
 *
 * Shared by the publishing wizard's comparison (private → public) and the
 * library-update dialog (public → private) so both directions localize enum
 * values, booleans and empty values identically.
 */
export function formatPublicCropValue(field: string, value: unknown, t: TFunction): string {
  const normalized = normalizeComparisonValue(value);
  if (normalized === null) return t('library.publishWizard.comparison.empty');
  if (typeof normalized === 'boolean') {
    return t(normalized ? 'library.publishWizard.comparison.yes' : 'library.publishWizard.comparison.no');
  }
  if (Array.isArray(normalized)) {
    return normalized.map((item) => {
      if (typeof item === 'object') return JSON.stringify(item);
      return t(`library.publishWizard.comparison.values.${String(item)}`, String(item));
    }).join(', ');
  }
  if (field === 'seed_rate_by_cultivation') return formatSeedRateByCultivation(normalized, t);
  if (typeof normalized === 'object') return JSON.stringify(normalized);
  if (['nutrient_demand', 'harvest_method', 'seed_rate_unit', 'seeding_requirement_type'].includes(field)) {
    return t(`library.publishWizard.comparison.values.${String(normalized)}`, String(normalized));
  }
  return String(normalized);
}

/**
 * One field's move from an old to a new value, e.g. "Anbaupause: 3 → 4".
 *
 * Built on the same label and value helpers every diff surface uses, so a
 * change rendered outside a diff table (a notification line) cannot drift from
 * the table's wording.
 */
export function formatPublicCropFieldChange(
  change: PublicCropFieldChange,
  t: TFunction,
): string {
  return t('library.publishWizard.comparison.changeEntry', {
    label: getPublicCropComparisonFieldLabel(change.field, t),
    oldValue: formatPublicCropValue(change.field, change.old_value, t),
    newValue: formatPublicCropValue(change.field, change.new_value, t),
  });
}

/** Several field changes as one readable line. */
export function formatPublicCropFieldChanges(
  changes: PublicCropFieldChange[],
  t: TFunction,
): string {
  return changes.map((change) => formatPublicCropFieldChange(change, t)).join('; ');
}

export function getRevisionValueLabel(value: unknown, fallback: string): string {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

export const isEmptyPublicValue = (value: unknown): boolean => (
  value === null
  || value === undefined
  || value === ''
  || (Array.isArray(value) && value.length === 0)
);

export function arePublicValuesEqual(left: unknown, right: unknown): boolean {
  if (isEmptyPublicValue(left) && isEmptyPublicValue(right)) {
    return true;
  }
  if (typeof left === 'number' && typeof right === 'number') {
    return Math.abs(left - right) < Number.EPSILON;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    // Order doesn't carry meaning for these fields (e.g. cultivation_types) —
    // sort before comparing so the same set in a different order isn't
    // reported as changed. Only meaningful for arrays of sortable primitives;
    // arrays of objects (e.g. seed_packages) fall through to their existing
    // JSON.stringify comparison since [...].sort() is a no-op on objects.
    return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
  }
  if (Array.isArray(left) || Array.isArray(right) || (typeof left === 'object' && left !== null) || (typeof right === 'object' && right !== null)) {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return left === right;
}
