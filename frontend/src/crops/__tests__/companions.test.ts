import { describe, expect, it } from 'vitest';

import type { Crop, CropCompanion, PublicCrop, PublicCropCompanion } from '../../api/types';
import {
  buildCompanionItemsByCrop,
  buildLibraryCompanionRows,
  buildCompanionReasonLookup,
  findKulturId,
  formatCompanionCell,
  parseCompanionCell,
  relationPartner,
} from '../companions';

const labels: Record<string, string> = {
  'companions.reasons.competition': 'Konkurrenz',
  'companions.reasons.allelopathy': 'Hemmt das Wachstum',
  'companions.reasons.pest_control': 'Schädlingsabwehr',
  'companions.reasons.soil': 'Bodenverbesserung',
  'companions.reasons.shared_pests_diseases': 'Gleiche Schädlinge oder Krankheiten',
};
const t = (key: string): string => labels[key] ?? key;
const lookup = buildCompanionReasonLookup(t);

const crop = (id: number, name: string, variety = '', extra: Partial<Crop> = {}): Crop => (
  { id, name, variety, ...extra } as Crop
);

const relation = (overrides: Partial<CropCompanion>): CropCompanion => ({
  crop: 1,
  companion_crop: null,
  companion_family: null,
  companion_text: '',
  kind: 'bad',
  reason: 'other',
  note: '',
  ...overrides,
});

describe('parseCompanionCell', () => {
  it('reads one neighbour per line, several names sharing the note', () => {
    expect(parseCompanionCell(
      'Tomate, Kartoffel – gleiche Krankheiten (Verticillium) Kräuter (Dill, Basilikum) – Geschmack',
      lookup,
    )).toEqual([
      { name: 'Tomate', reason: 'other', note: 'gleiche Krankheiten (Verticillium)' },
      { name: 'Kartoffel', reason: 'other', note: 'gleiche Krankheiten (Verticillium)' },
      { name: 'Kräuter (Dill, Basilikum)', reason: 'other', note: 'Geschmack' },
    ]);
  });

  it('maps a leading reason label to the reason', () => {
    expect(parseCompanionCell('Dill – Schädlingsabwehr\nSalbei - konkurrenz: Wurzelraum', lookup)).toEqual([
      { name: 'Dill', reason: 'pest_control', note: '' },
      { name: 'Salbei', reason: 'competition', note: 'Wurzelraum' },
    ]);
  });

  it('ignores empty lines, stray semicolons and non-text cells', () => {
    expect(parseCompanionCell('\n Salbei ;\n\n', lookup)).toEqual([{ name: 'Salbei', reason: 'other', note: '' }]);
    expect(parseCompanionCell(42, lookup)).toEqual([]);
  });

  it('reads back what formatCompanionCell writes', () => {
    const items = [
      { name: 'Basilikum', reason: 'pest_control', note: '' },
      { name: 'Tagetes', reason: 'other', note: 'lockt Schnecken ab' },
      { name: 'Kartoffel', reason: 'shared_pests_diseases', note: 'Krautfäule' },
    ] as const;

    expect(parseCompanionCell(formatCompanionCell(items, t), lookup)).toEqual(items);
  });
});

describe('findKulturId', () => {
  const kultur = crop(1, 'Tomate');
  const linkedVariety = crop(2, 'Tomate', 'Roma', { general_crop: 1 });
  const unlinkedVariety = crop(3, ' tomate ', 'Ochsenherz');
  const orphanVariety = crop(4, 'Paprika', 'Frühzauber');

  it('resolves a variety to its Kultur by species link, else by name', () => {
    const crops = [kultur, linkedVariety, unlinkedVariety, orphanVariety];

    expect(findKulturId(kultur, crops)).toBe(1);
    expect(findKulturId(linkedVariety, crops)).toBe(1);
    expect(findKulturId(unlinkedVariety, crops)).toBe(1);
    expect(findKulturId(orphanVariety, crops)).toBeNull();
  });
});

describe('export items', () => {
  it('lists a shared pair on both Kulturen and names families and free text', () => {
    const crops = [crop(1, 'Tomate'), crop(2, 'Kartoffel'), crop(3, 'Tomate', 'Roma')];
    const relations = [
      relation({ crop: 1, companion_crop: 2, reason: 'shared_pests_diseases' }),
      relation({ crop: 1, companion_family: 'Brassicaceae', kind: 'good' }),
      relation({ crop: 2, companion_text: 'Salbei', note: 'hemmt' }),
    ];

    const items = buildCompanionItemsByCrop(crops, relations, (key) => `family:${key}`);

    expect(items.get(1)).toEqual({
      good: [{ name: 'family:Brassicaceae', reason: 'other', note: '' }],
      bad: [{ name: 'Kartoffel', reason: 'shared_pests_diseases', note: '' }],
    });
    expect(items.get(2)?.bad.map((item) => item.name)).toEqual(['Tomate', 'Salbei']);
    expect(items.has(3)).toBe(false);
  });

  it('names the other crop of a pair from either side', () => {
    const pair = relation({ crop: 1, companion_crop: 2 });

    expect(relationPartner(pair, 1)).toEqual({ type: 'crop', cropId: 2 });
    expect(relationPartner(pair, 2)).toEqual({ type: 'crop', cropId: 1 });
  });
});

describe('buildLibraryCompanionRows', () => {
  const item = (overrides: Partial<PublicCropCompanion>): PublicCropCompanion => ({
    species: null, species_name: '', family: null, kind: 'bad', reason: 'other', note: '', ...overrides,
  });
  const entry = (id: number, name: string, species: number, companions: PublicCropCompanion[] = [], extra: Partial<PublicCrop> = {}) => (
    { id, name, display_name: name, variety: '', crop_species: species, status: 'published', companions, ...extra } as PublicCrop
  );
  const familyLabel = (key: string) => `${key} (Pflanzenfamilie)`;

  it("links a species neighbour to its entry and shows the other side of a pair", () => {
    const tomato = entry(1, 'Tomate', 10, [
      item({ species: 20, species_name: 'Kartoffel' }),
      item({ species: 30, species_name: 'Fenchel', kind: 'good' }),
      item({ family: 'Brassicaceae', kind: 'good' }),
    ]);
    const potato = entry(2, 'Kartoffel', 20);
    const basil = entry(3, 'Basilikum', 40, [item({ species: 10, kind: 'good', reason: 'pest_control' })]);
    const romaVariety = entry(4, 'Tomate', 10, [], { variety: 'Roma' });

    const rows = buildLibraryCompanionRows(tomato, [tomato, potato, basil, romaVariety], familyLabel);

    expect(rows.map((row) => [row.label, row.kind, row.entry?.id ?? null])).toEqual([
      ['Kartoffel', 'bad', 2],
      ['Fenchel', 'good', null],
      ['Brassicaceae (Pflanzenfamilie)', 'good', null],
      ['Basilikum', 'good', 3],
    ]);
    expect(rows[3].reason).toBe('pest_control');
  });

  it("does not mirror a pair the entry already lists, nor a removed entry's neighbours", () => {
    const tomato = entry(1, 'Tomate', 10, [item({ species: 20, species_name: 'Kartoffel', kind: 'bad' })]);
    const potato = entry(2, 'Kartoffel', 20, [item({ species: 10, kind: 'good' })]);
    const removed = entry(3, 'Basilikum', 40, [item({ species: 10 })], { status: 'removed' });

    const rows = buildLibraryCompanionRows(tomato, [tomato, potato, removed], familyLabel);

    expect(rows.map((row) => [row.label, row.kind])).toEqual([['Kartoffel', 'bad']]);
  });
});
