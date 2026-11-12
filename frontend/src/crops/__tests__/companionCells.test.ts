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
  it('assigns a group note to every name without inferring a reason from prose', () => {
    expect(parseCompanionCell('Tomate, Gurke; Bohne | Schutz vor Schädlingen\nSellerie')).toEqual([
      ...['Tomate', 'Gurke', 'Bohne'].map((name) => ({ name, reason: 'other', note: 'Schutz vor Schädlingen' })),
      { name: 'Sellerie', reason: 'other', note: '' },
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

  it('keeps edits in a different note language dirty after switching the selected language', () => {
    const original: CompanionFormRow = {
      key: 'row', kind: 'good', reason: 'other', target: { type: 'text', text: 'Tomate', label: 'Tomate' },
      note: 'Quelle', noteLanguage: 'de', notes: { de: 'Quelle', en: 'Source' },
    };
    expect(sameCompanionRows([original], [{ ...original, noteChanges: { en: 'Changed source' } }])).toBe(false);
    expect(sameCompanionRows([original], [{ ...original, noteLanguage: 'en', note: 'Source' }])).toBe(true);
  });

  for (const language of ['de', 'en', 'fr', 'es'] as const) {
    it.each(['csv', 'xlsx', 'ods'] as const)(`preserves grouped multiline notes in ${language} through %s`, async (format) => {
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
