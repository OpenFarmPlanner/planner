import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import {
  buildSpreadsheetFile,
  computeColumnWidths,
  parseSpreadsheetRows,
  type SpreadsheetRows,
} from '../crops/spreadsheetFile';

const rows: SpreadsheetRows = [
  ['Name', 'Sorte', 'Wachstumszeit', 'Mehrjährig'],
  ['Tomate', 'Roma', 70, false],
  ['Salat', 'Maikönig', 42, true],
];

describe('spreadsheetFile', () => {
  it.each(['csv', 'xlsx', 'ods'] as const)('round-trips %s rows without the xlsx package', (format) => {
    const file = buildSpreadsheetFile(rows, format);
    const buffer = typeof file === 'string'
      ? new TextEncoder().encode(file).buffer
      : file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    const expectedRows = format === 'csv'
      ? [
        ['Name', 'Sorte', 'Wachstumszeit', 'Mehrjährig'],
        ['Tomate', 'Roma', '70', 'nein'],
        ['Salat', 'Maikönig', '42', 'ja'],
      ]
      : rows;

    expect(parseSpreadsheetRows(buffer, format)).toEqual(expectedRows);
  });

  it('reads semicolon-separated CSV files', () => {
    const buffer = new TextEncoder().encode('Name;Sorte;Wachstumszeit\nTomate;Roma;70').buffer;

    expect(parseSpreadsheetRows(buffer, 'csv')).toEqual([
      ['Name', 'Sorte', 'Wachstumszeit'],
      ['Tomate', 'Roma', '70'],
    ]);
  });

  it('keeps line breaks inside quoted CSV cells in their cell', () => {
    const csv = 'Name;Gute Nachbarn;Schlechte Nachbarn\r\n'
      + 'Kartoffel;"Kapuzinerkresse – lockt Blattläuse ab\nKlee";"Tomate – Krankheiten"\r\n'
      + 'Gurke;"Dill ""Tetra""";\r\n';
    const buffer = new TextEncoder().encode(csv).buffer;

    expect(parseSpreadsheetRows(buffer, 'csv')).toEqual([
      ['Name', 'Gute Nachbarn', 'Schlechte Nachbarn'],
      ['Kartoffel', 'Kapuzinerkresse – lockt Blattläuse ab\nKlee', 'Tomate – Krankheiten'],
      ['Gurke', 'Dill "Tetra"', ''],
    ]);
  });

  it('round-trips a multi-line cell through CSV', () => {
    const file = buildSpreadsheetFile([['Name', 'Notizen'], ['Tomate', 'Zeile 1\nZeile 2']], 'csv') as string;

    expect(parseSpreadsheetRows(new TextEncoder().encode(file).buffer, 'csv')).toEqual([
      ['Name', 'Notizen'],
      ['Tomate', 'Zeile 1\nZeile 2'],
    ]);
  });

  describe('column widths', () => {
    it('fits each column to its longest cell, header included', () => {
      expect(computeColumnWidths(rows)).toEqual([8, 10, 15, 12]);
    });

    it('caps a very long cell and keeps short columns readable', () => {
      expect(computeColumnWidths([['Notizen', 'x'], ['a'.repeat(500), null]])).toEqual([50, 6]);
    });

    const unzipText = (file: Uint8Array | string, path: string): string =>
      new TextDecoder().decode(unzipSync(file as Uint8Array)[path]);

    it('writes the widths into an xlsx sheet', () => {
      const sheet = unzipText(buildSpreadsheetFile(rows, 'xlsx'), 'xl/worksheets/sheet1.xml');

      expect(sheet).toContain('<col min="3" max="3" width="15" customWidth="1"/>');
    });

    it('writes the widths into an ods table', () => {
      const content = unzipText(buildSpreadsheetFile(rows, 'ods'), 'content.xml');

      expect(content).toContain('style:column-width="3.00cm"');
      expect(content).toContain('<table:table-column table:style-name="co3"/>');
    });
  });
});
