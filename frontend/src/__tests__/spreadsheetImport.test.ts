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
  it.each(['csv', 'xlsx', 'ods'] as const)('preserves germination enums and partial stratification ranges in %s', async (format) => {
    const columns = [
      'name', 'germination_temperature_requirement', 'germination_light_requirement',
      'stratification_days_min', 'stratification_days_max',
      'stratification_temperature_min_c', 'stratification_temperature_max_c',
    ].map((key) => CROP_COLUMNS.find((column) => column.key === key)!);
    const rows: SpreadsheetRows = [
      columns.map((column) => column.headerKey),
      ['Lavender', 'cold_stratification', 'none', 14, null, -6.5, null],
      ['Lettuce', 'none', 'light', null, null, null, null],
    ];
    const data = buildSpreadsheetFile(rows, format);
    const result = await parseSpreadsheetFile(new File([data as BlobPart], `crops.${format}`));

    expect(result.warnings).toEqual([]);
    expect(result.entries[0]).toMatchObject({
      germination_temperature_requirement: 'cold_stratification', germination_light_requirement: 'none',
      stratification_days_min: 14, stratification_temperature_min_c: -6.5,
    });
    expect(result.entries[0]).not.toHaveProperty('stratification_days_max');
    expect(result.entries[0]).not.toHaveProperty('stratification_temperature_max_c');
    expect(result.entries[1]).toMatchObject({
      germination_temperature_requirement: 'none', germination_light_requirement: 'light',
    });
  });

  it.each([
    ['Kaltstratifikation', 'Lichtunabhängig'],
    ['Cold stratification', 'Light-independent'],
    ['Stratification à froid', 'Indifférent à la lumière'],
    ['Estratificación en frío', 'Indiferente a la luz'],
  ])('imports localized germination choices %s / %s', async (temperature, light) => {
    const result = await parseSpreadsheetFile(csvFile([
      [NAME_HEADER, 'germination_temperature_requirement', 'germination_light_requirement'],
      ['Lavender', temperature, light],
    ]));
    expect(result.entries[0]).toMatchObject({
      germination_temperature_requirement: 'cold_stratification', germination_light_requirement: 'none',
    });
    expect(result.warnings).toEqual([]);
  });

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

    it('warns once per number cell it drops instead of dropping it silently', async () => {
      const result = await parseSpreadsheetFile(csvFile([
        [NAME_HEADER, numberColumn.headerKey],
        ['Tomate', '2-3'],
        ['Gurke', '2'],
      ]));

      expect(result.entries[1][numberColumn.key]).toBe(2);
      expect(result.warnings).toEqual(['crops:import.numberCellIgnored']);
    });

    it('hands text in the harvest-duration column to the backend under its own key', async () => {
      // The backend's timing-window parser decides whether it is a harvest window to report.
      const result = await parseSpreadsheetFile(csvFile([
        [NAME_HEADER, 'erntezeitraum'],
        ['Kürbis', 'Juli bis September'],
      ]));

      expect(result.entries[0]).not.toHaveProperty('harvest_duration_days');
      expect(result.entries[0]).toMatchObject({ harvest_duration_days_text: 'Juli bis September' });
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
