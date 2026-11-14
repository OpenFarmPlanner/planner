import type {
  CompanionImportItem,
  CompanionKind,
  CompanionReason,
  CompanionReplaceItem,
  Crop,
  CropCompanion,
  PublicCrop,
  PublicCropCompanion,
} from '../api/types';

export const COMPANION_KINDS: readonly CompanionKind[] = ['good', 'bad'];

/** Recognizable absence statements are information, never a named neighbour. */
export function isCompanionInformationText(text: string): boolean {
  return [
    /^no\s+(?:(?:specific|known|bad)\s+)*neighbou?rs(?:\s+(?:known|reported))?(?:\s*[.!:;—–-]|\s*$)/i,
    /^keine\s+(?:(?:besonderen|spezifischen|schlechten|bekannten)\s+)*nachbarn(?:\s+bekannt)?(?:\s*[.!:;—–-]|\s*$)/i,
    /^aucun\s+(?:(?:mauvais|spécifique|connu)\s+)*voisin(?:\s+(?:spécifique|connu))*(?:\s*[.!:;—–-]|\s*$)/i,
    /^(?:no\s+se\s+conocen|sin)\s+(?:(?:malos|específicos|conocidos)\s+)*vecinos(?:\s+(?:específicos|conocidos))*(?:\s*[.!:;—–-]|\s*$)/i,
  ].some(pattern => pattern.test(text.trim()));
}

export const COMPANION_REASONS: readonly CompanionReason[] = [
  'competition',
  'allelopathy',
  'pest_control',
  'soil',
  'shared_pests_diseases',
  'other',
];


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
    items[relation.kind].push({ name, reason: relation.reason, note: relation.note, notes: relation.notes });
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

export { formatCompanionCell, getCompanionNote, parseCompanionCell } from './companionCells';

// --- Crop form ----------------------------------------------------------------

/** A neighbour picked in the crop form: a project Kultur, a library crop species, a family or text. */
export type CompanionFormTarget =
  | { type: 'crop'; cropId: number; label: string }
  | { type: 'species'; speciesId: number; label: string }
  | { type: 'family'; familyKey: string; label: string }
  | { type: 'text'; text: string; label: string };

/** One row of the form's "Mischkultur" section; `target` is null until a neighbour is picked. */
/** A pickable neighbour with the heading it is listed under. */
export type CompanionFormOption = CompanionFormTarget & { group: string };

export interface CompanionFormRow {
  key: string;
  kind: CompanionKind;
  target: CompanionFormTarget | null;
  reason: CompanionReason;
  note: string;
  noteLanguage?: string;
  noteChanges?: CropCompanion['notes'];
  notes?: CropCompanion['notes'];
}

export type CompanionFormRowError = 'required' | 'duplicate';

let nextRowKey = 0;
export const newCompanionRowKey = (): string => {
  nextRowKey += 1;
  return `companion-row-${nextRowKey}`;
};

export const emptyCompanionFormRow = (kind: CompanionKind = 'good'): CompanionFormRow => ({
  key: newCompanionRowKey(),
  kind,
  target: null,
  reason: 'other',
  note: '',
});

/** Two rows naming the same neighbour share this key. */
export const companionTargetKey = (target: CompanionFormTarget): string => {
  if (target.type === 'crop') return `crop:${target.cropId}`;
  if (target.type === 'species') return `species:${target.speciesId}`;
  if (target.type === 'family') return `family:${target.familyKey}`;
  return `text:${normalizeName(target.text)}`;
};

/** A crop or species that can be picked as a neighbour, and the plant family it is listed under. */
export interface CompanionNeighbor {
  target: CompanionFormTarget;
  familyKey: string | null | undefined;
}

/**
 * The neighbour field's options, one group per plant family in alphabetical
 * order: the family itself, then its crops or species. Crops without a family
 * come last. `familyKeys` are the catalogue's families, listed even without a
 * crop; a crop's family outside the catalogue gets a heading but is not pickable.
 */
export const buildCompanionFormOptions = (
  neighbors: readonly CompanionNeighbor[],
  familyKeys: readonly string[],
  familyName: (familyKey: string) => string,
  noFamilyLabel: string,
  locale?: string,
): CompanionFormOption[] => {
  const targetsByFamily = new Map<string, CompanionFormTarget[]>();
  for (const { target, familyKey } of neighbors) {
    const key = familyKey || '';
    targetsByFamily.set(key, [...(targetsByFamily.get(key) ?? []), target]);
  }
  const groupTargets = (key: string, group: string): CompanionFormOption[] => (
    [...(targetsByFamily.get(key) ?? [])]
      .sort((first, second) => first.label.localeCompare(second.label, locale))
      .map((target) => ({ ...target, group }))
  );
  const pickable = new Set(familyKeys);
  const groupedKeys = [...new Set([...familyKeys, ...targetsByFamily.keys()])]
    .filter(Boolean)
    .map((familyKey) => ({ familyKey, label: familyName(familyKey) }))
    .sort((first, second) => first.label.localeCompare(second.label, locale));
  return [
    ...groupedKeys.flatMap(({ familyKey, label }): CompanionFormOption[] => [
      ...(pickable.has(familyKey) ? [{ type: 'family' as const, familyKey, label, group: label }] : []),
      ...groupTargets(familyKey, label),
    ]),
    ...groupTargets('', noFamilyLabel),
  ];
};

export const relationToFormRow = (
  relation: CropCompanion,
  kulturId: number,
  cropLabel: (cropId: number) => string,
  familyName: (familyKey: string) => string,
): CompanionFormRow => {
  const partner = relationPartner(relation, kulturId);
  const target: CompanionFormTarget = partner.type === 'crop'
    ? { type: 'crop', cropId: partner.cropId, label: cropLabel(partner.cropId) }
    : partner.type === 'family'
      ? { type: 'family', familyKey: partner.familyKey, label: familyName(partner.familyKey) }
      : { type: 'text', text: partner.text, label: partner.text };
  return { key: newCompanionRowKey(), kind: relation.kind, target, reason: relation.reason, note: relation.note, notes: relation.notes ?? (relation.note ? { de: relation.note } : {}), noteLanguage: relation.note_language_code };
};

export const libraryItemToFormRow = (
  item: PublicCropCompanion,
  familyName: (familyKey: string) => string,
): CompanionFormRow => ({
  key: newCompanionRowKey(),
  kind: item.kind,
  target: item.family
    ? { type: 'family', familyKey: item.family, label: familyName(item.family) }
    : { type: 'species', speciesId: item.species as number, label: item.species_name },
  reason: item.reason,
  note: item.note,
  notes: item.notes ?? (item.note ? { de: item.note } : {}),
  noteLanguage: item.note_language_code,
});

/** Why a row cannot be saved, by row key: no neighbour picked, or the neighbour is listed twice. */
export const findCompanionRowErrors = (
  rows: readonly CompanionFormRow[],
): Record<string, CompanionFormRowError> => {
  const errors: Record<string, CompanionFormRowError> = {};
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.target) {
      errors[row.key] = 'required';
      continue;
    }
    const key = companionTargetKey(row.target);
    if (seen.has(key)) errors[row.key] = 'duplicate';
    seen.add(key);
  }
  return errors;
};

/** The rows as `PUT /crop-companions/replace/` takes them (project form). */
export const formRowsToReplaceItems = (rows: readonly CompanionFormRow[]): CompanionReplaceItem[] => rows
  .flatMap((row) => {
    const { target } = row;
    if (!target || target.type === 'species') return [];
    return [{
      companion_crop: target.type === 'crop' ? target.cropId : null,
      companion_family: target.type === 'family' ? target.familyKey : null,
      companion_text: target.type === 'text' ? target.text.trim() : '',
      kind: row.kind,
      reason: row.reason,
      note: row.note,
      ...(row.noteLanguage ? { note_language_code: row.noteLanguage } : {}),
      ...(row.noteChanges ? { notes: row.noteChanges } : {}),
    }];
  });

/** The rows as a library entry stores them (library form): crop species and families only. */
export const formRowsToLibraryItems = (rows: readonly CompanionFormRow[]): PublicCropCompanion[] => rows
  .flatMap((row) => {
    const { target } = row;
    if (target?.type !== 'species' && target?.type !== 'family') return [];
    return [{
      species: target.type === 'species' ? target.speciesId : null,
      species_name: target.type === 'species' ? target.label : '',
      family: target.type === 'family' ? target.familyKey : null,
      kind: row.kind,
      reason: row.reason,
      note: row.note,
      ...(row.noteLanguage ? { note_language_code: row.noteLanguage } : {}),
      ...(row.noteChanges ? { notes: row.noteChanges } : {}),
    }];
  });

/** Whether two row lists save the same neighbours (order and row keys aside). */
export const sameCompanionRows = (
  first: readonly CompanionFormRow[],
  second: readonly CompanionFormRow[],
): boolean => {
  const signature = (rows: readonly CompanionFormRow[]): string => rows
    .map((row) => JSON.stringify([
      row.target ? companionTargetKey(row.target) : '', row.kind, row.reason,
      Object.entries({ ...row.notes, ...row.noteChanges, [row.noteLanguage ?? 'de']: row.note }).sort(([a], [b]) => a.localeCompare(b)),
    ]))
    .sort().join('\n');
  return signature(first) === signature(second);
};

// --- Crop library page ------------------------------------------------------------

/** One neighbour of a library entry as the library page lists it. */
export interface LibraryCompanionRow {
  kind: CompanionKind;
  reason: CompanionReason;
  note: string;
  label: string;
  /** The neighbour's species-level entry, linked from the row; null for a family or an unpublished species. */
  entry: PublicCrop | null;
  notes?: PublicCropCompanion['notes'];
}

const isPublishedSpeciesEntry = (entry: PublicCrop): boolean => (
  !(entry.variety || '').trim() && entry.status === 'published' && Boolean(entry.crop_species)
);

const entryLabel = (entry: PublicCrop): string => entry.display_name || entry.name;

/**
 * The neighbours of a species-level entry, each linked to its neighbour's
 * entry, plus the other side of a pair: an entry listing this one's species
 * shows here too, as a pair does in a project (docs/crop-companions.md).
 * Family neighbours are not mirrored; every crop of the family would list them.
 */
export const buildLibraryCompanionRows = (
  speciesEntry: PublicCrop,
  entries: readonly PublicCrop[],
  familyLabel: (familyKey: string) => string,
): LibraryCompanionRow[] => {
  const entriesBySpecies = new Map<number, PublicCrop>();
  for (const entry of entries) {
    if (isPublishedSpeciesEntry(entry) && !entriesBySpecies.has(entry.crop_species as number)) {
      entriesBySpecies.set(entry.crop_species as number, entry);
    }
  }
  const rows: LibraryCompanionRow[] = [];
  const listedSpecies = new Set<number>();
  const row = (item: PublicCropCompanion, label: string, entry: PublicCrop | null): LibraryCompanionRow => ({
    kind: item.kind, reason: item.reason, note: item.note, notes: item.notes, label, entry,
  });
  for (const item of speciesEntry.companions ?? []) {
    if (item.family) {
      rows.push(row(item, familyLabel(item.family), null));
      continue;
    }
    if (item.species === null) continue;
    listedSpecies.add(item.species);
    const entry = entriesBySpecies.get(item.species) ?? null;
    rows.push(row(item, entry ? entryLabel(entry) : item.species_name, entry));
  }
  const ownSpecies = speciesEntry.crop_species;
  if (ownSpecies) {
    for (const entry of entriesBySpecies.values()) {
      if (entry.id === speciesEntry.id || listedSpecies.has(entry.crop_species as number)) continue;
      const item = (entry.companions ?? []).find((candidate) => candidate.species === ownSpecies);
      if (item) rows.push(row(item, entryLabel(entry), entry));
    }
  }
  return rows;
};
