import { afterEach, describe, expect, it } from 'vitest';
import type { Crop, CompanionImportItem } from '../../api/types';
import i18n from '../../i18n/config';
import { formatCompanionCell, parseCompanionCell } from '../companionCells';
import { buildSheetData } from '../spreadsheetExport';
import { buildSpreadsheetFile } from '../spreadsheetFile';
import { parseSpreadsheetFile } from '../spreadsheetImport';
import { sameCompanionRows, type CompanionFormRow } from '../companions';

afterEach(async () => { await i18n.changeLanguage('de'); });

describe('localized companion cells', () => {
  it('assigns a note only to the neighbor directly before it without inferring a reason from prose', () => {
    expect(parseCompanionCell('Tomate, Gurke; Bohne | Schutz vor Schädlingen\nSellerie')).toEqual([
      ...['Tomate', 'Gurke'].map((name) => ({ name, reason: 'other', note: '' })),
      { name: 'Bohne', reason: 'other', note: 'Schutz vor Schädlingen' },
      { name: 'Sellerie', reason: 'other', note: '' },
    ]);
  });

  it('exports neighbours in one canonical "; "-separated cell with notes kept as written', () => {
    const items: CompanionImportItem[] = [
      { name: 'Tomate', reason: 'other', note: 'Schutz vor Schädlingen' },
      { name: 'Gurke', reason: 'other', note: 'Quelle 2025, S. 3 - Versuch' },
      { name: 'Basilikum', reason: 'other', note: '' },
    ];
    const cell = formatCompanionCell(items);
    expect(cell).toBe('Tomate | Schutz vor Schädlingen; Gurke | Quelle 2025, S. 3 - Versuch; Basilikum');
    expect(parseCompanionCell(cell)).toEqual(items);
  });

  it('quotes a name with an open bracket so it cannot swallow the next entry', () => {
    const items: CompanionImportItem[] = [
      { name: 'Kräuter (Dill', reason: 'other', note: '' },
      { name: 'Kräuter (Dill; Basilikum)', reason: 'other', note: 'A' },
      { name: 'Gurke', reason: 'other', note: '' },
    ];
    const cell = formatCompanionCell(items);
    expect(cell).toBe('"Kräuter (Dill"; "Kräuter (Dill; Basilikum)" | A; Gurke');
    expect(parseCompanionCell(cell)).toEqual(items);
  });

  it('still reads legacy line-separated entries and comma-separated names', () => {
    expect(parseCompanionCell('Tomate | Schutz, Quelle\nGurke\nSellerie, Dill')).toEqual([
      { name: 'Tomate', reason: 'other', note: 'Schutz, Quelle' },
      ...['Gurke', 'Sellerie', 'Dill'].map((name) => ({ name, reason: 'other', note: '' })),
    ]);
    expect(parseCompanionCell('Tomate - A; Gurke - B')).toEqual([
      { name: 'Tomate - A; Gurke - B', reason: 'other', note: '', legacy: true },
    ]);
  });

  it('quotes reserved delimiters and multiline notes reversibly', () => {
    const items: CompanionImportItem[] = [
      { name: 'Kraut; "Spezial" | A', reason: 'pest_control', note: 'Quelle: "A | B"\nZeile 2\\Pfad' },
      { name: 'Salat - Pflücksalat', reason: 'other', note: '' },
    ];
    expect(parseCompanionCell(formatCompanionCell(items))).toEqual(items.map((item) => ({ ...item, reason: 'other' })));
  });

  it('exports only the selected language and retains every version in the input object', () => {
    const item: CompanionImportItem = { name: 'Tomate', reason: 'other', note: 'Quelle', notes: { de: 'Quelle', fr: 'Source' } };
    expect(formatCompanionCell([item], 'fr')).toBe('Tomate | Source');
    expect(formatCompanionCell([item], 'es')).toBe('Tomate');
    expect(item.notes).toEqual({ de: 'Quelle', fr: 'Source' });
  });

  it.each(['csv', 'xlsx', 'ods'] as const)('matches detail fallback for legacy notes without a map in %s', async (format) => {
    await i18n.changeLanguage('fr');
    const items: CompanionImportItem[] = [
      { name: 'Legacy neighbor', reason: 'other', note: 'Legacy source' },
      { name: 'Missing translation', reason: 'other', note: 'Quelle', notes: { de: 'Quelle' } },
      { name: 'Explicit empty', reason: 'other', note: 'Old source', notes: { fr: '' } },
      { name: 'No notes', reason: 'other', note: '' },
    ];
    const original = structuredClone(items);
    const rows = buildSheetData([{ id: 1, name: 'Gurke' } as Crop], i18n.getFixedT('fr', 'crops'),
      new Map([[1, { good: items, bad: [] }]]), 'fr');
    const data = buildSpreadsheetFile(rows, format);
    const imported = await parseSpreadsheetFile(new File([data as BlobPart], `notes.${format}`));
    expect(imported.entries[0]?.good_companions).toEqual(items.map(({ name }, index) => ({
      name, reason: 'other', note: index === 0 ? 'Legacy source' : '',
    })));
    expect(items).toEqual(original);
  });

  it('keeps edits in a different note language dirty after switching the selected language', () => {
    const original: CompanionFormRow = {
      key: 'row', kind: 'good', reason: 'other', target: { type: 'text', text: 'Tomate', label: 'Tomate' },
      note: 'Quelle', noteLanguage: 'de', notes: { de: 'Quelle', en: 'Source' },
    };
    expect(sameCompanionRows([original], [{ ...original, noteChanges: { en: 'Changed source' } }])).toBe(false);
    expect(sameCompanionRows([original], [{ ...original, noteLanguage: 'en', note: 'Source' }])).toBe(true);
  });

  for (const language of ['de', 'en', 'fr', 'es'] as const) {
    it.each(['csv', 'xlsx', 'ods'] as const)(`preserves shared multiline notes per neighbor in ${language} through %s`, async (format) => {
      await i18n.changeLanguage(language);
      const note = `Source ${language}: "A | B"\n2025; p. 12\\annex`;
      const items: CompanionImportItem[] = ['Pak-Choi', 'Kraut; Spezial', 'Salat - Pflücksalat'].map((name) => ({
        name, reason: 'other', note, notes: { [language]: note },
      }));
      const rows = buildSheetData([{ id: 1, name: 'Gurke' } as Crop], i18n.getFixedT(language, 'crops'),
        new Map([[1, { good: items, bad: [] }]]), language);
      const data = buildSpreadsheetFile(rows, format);
      await i18n.changeLanguage('de');
      const imported = await parseSpreadsheetFile(new File([data as BlobPart], `notes.${format}`));
      expect(imported.warnings).toEqual([]);
      expect(imported.entries[0]?.good_companions).toEqual(items.map(({ name }) => ({ name, reason: 'other', note })));
    });
  }
});
