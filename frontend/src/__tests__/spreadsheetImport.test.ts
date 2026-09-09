import { parseSpreadsheetFile } from '../crops/spreadsheetImport';
import { buildSpreadsheetFile } from '../crops/spreadsheetFile';
import { CROP_COLUMNS } from '../crops/spreadsheetColumns';
import type { SpreadsheetRows } from '../crops/spreadsheetTypes';

vi.mock('i18next', () => {
  const t = (key: string) => key;
  return { default: { t, getFixedT: () => t, resolvedLanguage: 'de', language: 'de' } };
});

/** A real CSV File, the way the browser hands one to the import. */
function csvFile(rows: SpreadsheetRows, name = 'crops.csv'): File {
  const csv = buildSpreadsheetFile(rows, 'csv') as string;
  return new File([csv], name, { type: 'text/csv' });
}

const NAME_HEADER = CROP_COLUMNS.find((c) => c.key === 'name')!.headerKey;

describe('parseSpreadsheetFile', () => {
  it('rejects a format it cannot read', async () => {
    const result = await parseSpreadsheetFile(new File(['x'], 'crops.pdf'));

    expect(result.entries).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });

  it('reports an empty file rather than throwing', async () => {
    const result = await parseSpreadsheetFile(csvFile([]));

    expect(result.entries).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });

  it('reads a row back under the column key its header maps to', async () => {
    const result = await parseSpreadsheetFile(csvFile([[NAME_HEADER], ['Tomate']]));

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].name).toBe('Tomate');
  });

  it('matches a header whatever case and spacing the file used', async () => {
    const result = await parseSpreadsheetFile(csvFile([
      [`  ${NAME_HEADER.toUpperCase()}  `],
      ['Tomate'],
    ]));

    expect(result.entries[0]?.name).toBe('Tomate');
  });

  it('skips a row that has data but no name', async () => {
    const numberColumn = CROP_COLUMNS.find((c) => c.type === 'number')!;
    const result = await parseSpreadsheetFile(csvFile([
      [NAME_HEADER, numberColumn.headerKey],
      ['Tomate', '70'],
      ['', '42'],
      ['Salat', '30'],
    ]));

    expect(result.entries.map((e) => e.name)).toEqual(['Tomate', 'Salat']);
    expect(result.skippedRows).toBe(1);
  });

  it('warns about a column it does not recognise, and imports the rest', async () => {
    const result = await parseSpreadsheetFile(csvFile([
      [NAME_HEADER, 'Lieblingsfarbe'],
      ['Tomate', 'rot'],
    ]));

    expect(result.warnings).toHaveLength(1);
    expect(result.entries[0]?.name).toBe('Tomate');
    expect(result.entries[0]).not.toHaveProperty('Lieblingsfarbe');
  });

  describe('value parsing', () => {
    const numberColumn = CROP_COLUMNS.find((c) => c.type === 'number')!;
    const enumColumn = CROP_COLUMNS.find((c) => c.enumImport)!;

    it('reads a number as a number', async () => {
      const result = await parseSpreadsheetFile(csvFile([
        [NAME_HEADER, numberColumn.headerKey],
        ['Tomate', '70'],
      ]));

      expect(result.entries[0]?.[numberColumn.key]).toBe(70);
    });

    it('accepts a comma decimal separator, as a German locale writes it', async () => {
      const result = await parseSpreadsheetFile(csvFile([
        [NAME_HEADER, numberColumn.headerKey],
        ['Tomate', '1,5'],
      ]));

      expect(result.entries[0]?.[numberColumn.key]).toBe(1.5);
    });

    it('drops a number it cannot parse rather than storing the text', async () => {
      const result = await parseSpreadsheetFile(csvFile([
        [NAME_HEADER, numberColumn.headerKey],
        ['Tomate', 'weiß nicht'],
      ]));

      expect(result.entries[0]).not.toHaveProperty(numberColumn.key);
    });

    it('leaves an empty cell absent rather than storing an empty string', async () => {
      const result = await parseSpreadsheetFile(csvFile([
        [NAME_HEADER, numberColumn.headerKey],
        ['Tomate', ''],
      ]));

      expect(result.entries[0]).not.toHaveProperty(numberColumn.key);
    });

    it('maps an enum label back to its internal value', async () => {
      const column = enumColumn;
      const [importKey, internalValue] = Object.entries(column.enumImport!)[0];
      const result = await parseSpreadsheetFile(csvFile([
        [NAME_HEADER, column.headerKey],
        ['Tomate', importKey],
      ]));

      expect(result.entries[0]?.[column.key]).toBe(internalValue);
    });

    it('keeps an unmapped enum value instead of discarding it', async () => {
      const column = enumColumn;
      const result = await parseSpreadsheetFile(csvFile([
        [NAME_HEADER, column.headerKey],
        ['Tomate', 'etwas anderes'],
      ]));

      expect(result.entries[0]?.[column.key]).toBe('etwas anderes');
    });
  });

  it('tolerates a row shorter than the header', async () => {
    const numberColumn = CROP_COLUMNS.find((c) => c.type === 'number')!;
    const result = await parseSpreadsheetFile(csvFile([
      [NAME_HEADER, numberColumn.headerKey],
      ['Tomate'],
    ]));

    expect(result.entries[0]?.name).toBe('Tomate');
    expect(result.entries[0]).not.toHaveProperty(numberColumn.key);
  });
});
