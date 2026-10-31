import type {
  CompanionImportItem,
  CompanionKind,
  CompanionReason,
  Crop,
  CropCompanion,
} from '../api/types';

export const COMPANION_KINDS: readonly CompanionKind[] = ['good', 'bad'];

export const COMPANION_REASONS: readonly CompanionReason[] = [
  'competition',
  'allelopathy',
  'pest_control',
  'soil',
  'shared_pests_diseases',
  'other',
];

type TranslateFn = (key: string) => string;

export const companionReasonLabelKey = (reason: CompanionReason): string => `companions.reasons.${reason}`;

const normalizeName = (value: string | null | undefined): string => (
  (value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de')
);

const isKultur = (crop: Crop): boolean => !(crop.variety || '').trim();

/**
 * The Kultur (general crop) whose neighbours apply to `crop`: the crop itself
 * when it has no variety, else its species' general crop, else the general
 * crop with the same name — the backend's rule in services/crop_companions.py.
 */
export const findKulturId = (crop: Crop, crops: readonly Crop[]): number | null => {
  if (isKultur(crop)) return crop.id ?? null;
  if (crop.general_crop) return crop.general_crop;
  const name = normalizeName(crop.name);
  return crops.find((candidate) => isKultur(candidate) && normalizeName(candidate.name) === name)?.id ?? null;
};

export const relationsOfKultur = (
  kulturId: number,
  relations: readonly CropCompanion[],
): CropCompanion[] => relations.filter(
  (relation) => relation.crop === kulturId || relation.companion_crop === kulturId,
);

export type CompanionPartner =
  | { type: 'crop'; cropId: number }
  | { type: 'family'; familyKey: string }
  | { type: 'text'; text: string };

/** The other side of a relation, seen from `kulturId`. */
export const relationPartner = (relation: CropCompanion, kulturId: number): CompanionPartner => {
  if (relation.companion_crop !== null) {
    return { type: 'crop', cropId: relation.crop === kulturId ? relation.companion_crop : relation.crop };
  }
  if (relation.companion_family) return { type: 'family', familyKey: relation.companion_family };
  return { type: 'text', text: relation.companion_text };
};

/** A Kultur's neighbours as import items, grouped by kind, for the export. */
export const buildCompanionExportItems = (
  kulturId: number,
  relations: readonly CropCompanion[],
  cropsById: ReadonlyMap<number, Crop>,
  familyName: (familyKey: string) => string,
): CompanionItemsByKind => {
  const items: CompanionItemsByKind = { good: [], bad: [] };
  for (const relation of relationsOfKultur(kulturId, relations)) {
    const partner = relationPartner(relation, kulturId);
    const name = partner.type === 'crop'
      ? cropsById.get(partner.cropId)?.name
      : partner.type === 'family' ? familyName(partner.familyKey) : partner.text;
    if (!name) continue;
    items[relation.kind].push({ name, reason: relation.reason, note: relation.note });
  }
  return items;
};

export type CompanionItemsByKind = Record<CompanionKind, CompanionImportItem[]>;

/** Every Kultur's neighbours as import items, keyed by crop id (Sorten have none). */
export const buildCompanionItemsByCrop = (
  crops: readonly Crop[],
  relations: readonly CropCompanion[],
  familyName: (familyKey: string) => string,
): Map<number, CompanionItemsByKind> => {
  const cropsById = new Map(crops.flatMap((crop) => (crop.id === undefined ? [] : [[crop.id, crop] as const])));
  const itemsByCrop = new Map<number, CompanionItemsByKind>();
  for (const crop of crops) {
    if (crop.id === undefined || !isKultur(crop)) continue;
    const items = buildCompanionExportItems(crop.id, relations, cropsById, familyName);
    if (items.good.length > 0 || items.bad.length > 0) itemsByCrop.set(crop.id, items);
  }
  return itemsByCrop;
};

/**
 * One neighbour per line: `Name`, `Name – note`, `Name – Reason` or
 * `Name – Reason: note`. The reason label is written in the export language
 * and read back in any language (see `buildCompanionReasonLookup`).
 */
export const formatCompanionCell = (
  items: readonly CompanionImportItem[],
  t: TranslateFn,
): string | null => {
  if (items.length === 0) return null;
  return items.map(({ name, reason, note }) => {
    const reasonLabel = reason === 'other' ? '' : t(companionReasonLabelKey(reason));
    const detail = reasonLabel && note ? `${reasonLabel}: ${note}` : reasonLabel || note;
    return detail ? `${name} – ${detail}` : name;
  }).join('\n');
};

/** Reason labels of every given language, lower-cased, mapped to their reason. */
export const buildCompanionReasonLookup = (...translators: TranslateFn[]): Map<string, CompanionReason> => {
  const lookup = new Map<string, CompanionReason>();
  for (const t of translators) {
    for (const reason of COMPANION_REASONS) {
      if (reason === 'other') continue;
      lookup.set(normalizeName(t(companionReasonLabelKey(reason))), reason);
    }
  }
  return lookup;
};

const LINE_SPLIT = /[\n\r\u2028\u2029]+/;
// The names end at the first dash with spaces around it ("Tomate – Konkurrenz").
const NAME_DETAIL_SPLIT = /\s+[\u2013\u2014-]\s+/;

/** "Tomate, Kartoffel" → two names; commas inside parentheses do not split. */
const splitNames = (names: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of names) {
    if (char === '(' || char === '[') depth += 1;
    if ((char === ')' || char === ']') && depth > 0) depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
};

const parseDetail = (
  detail: string,
  reasonLookup: ReadonlyMap<string, CompanionReason>,
): Pick<CompanionImportItem, 'reason' | 'note'> => {
  const colon = detail.indexOf(':');
  const head = colon >= 0 ? detail.slice(0, colon) : detail;
  const reason = reasonLookup.get(normalizeName(head));
  if (!reason) return { reason: 'other', note: detail };
  return { reason, note: colon >= 0 ? detail.slice(colon + 1).trim() : '' };
};

/** The neighbours named in one spreadsheet cell; the inverse of `formatCompanionCell`. */
export const parseCompanionCell = (
  text: unknown,
  reasonLookup: ReadonlyMap<string, CompanionReason>,
): CompanionImportItem[] => {
  if (typeof text !== 'string') return [];
  const items: CompanionImportItem[] = [];
  for (const rawLine of text.split(LINE_SPLIT)) {
    const line = rawLine.trim().replace(/^;+|;+$/g, '').trim();
    if (!line) continue;
    const separator = NAME_DETAIL_SPLIT.exec(line);
    const names = separator ? line.slice(0, separator.index) : line;
    const detail = separator ? line.slice(separator.index + separator[0].length).trim() : '';
    const { reason, note } = detail ? parseDetail(detail, reasonLookup) : { reason: 'other' as const, note: '' };
    for (const name of splitNames(names)) {
      items.push({ name, reason, note });
    }
  }
  return items;
};
