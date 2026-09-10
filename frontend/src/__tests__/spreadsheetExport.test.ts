import {
  buildSpreadsheetFilename,
  exportCropsToSpreadsheet,
} from '../crops/spreadsheetExport';
import { getLocalizedCropColumns } from '../crops/spreadsheetColumns';
import type { Crop } from '../api/types';

/** The translator the export is handed: returns the key, so a German label in
 * an assertion would stand out as a hardcoded string rather than an i18n key. */
const t = (key: string): string => key;

const crop = (overrides: Partial<Crop> = {}): Crop => ({
  id: 1,
  name: 'Tomate',
  variety: 'Roma',
  ...overrides,
} as Crop);

const columnIndex = (key: string): number =>
  getLocalizedCropColumns(t).findIndex((column) => column.key === key);

/** Captures the Blob the download path builds, decoded as text. */
async function exportedCsv(crops: Crop[]): Promise<string> {
  const blobs: Blob[] = [];
  const createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob);
    return 'blob:mock';
  });
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });

  exportCropsToSpreadsheet(crops, 'csv', 'kulturen.csv', t);

  expect(blobs).toHaveLength(1);
  return blobs[0].text();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('exportCropsToSpreadsheet', () => {
  it('writes the localized headers as the first row', async () => {
    const text = await exportedCsv([crop()]);

    const headers = getLocalizedCropColumns(t).map((column) => column.header);
    expect(text.split('\n')[0]).toContain(headers[0]);
  });

  it('writes one row per crop, in the order given', async () => {
    const text = await exportedCsv([crop({ name: 'Tomate' }), crop({ id: 2, name: 'Karotte' })]);

    const lines = text.trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('Tomate');
    expect(lines[2]).toContain('Karotte');
    expect(lines[1].indexOf('Tomate')).toBeGreaterThanOrEqual(0);
  });

  it('still writes the header row for an empty crop list', async () => {
    const text = await exportedCsv([]);

    expect(text.trim().split('\n')).toHaveLength(1);
  });

  it('maps enum values through the column export table instead of leaking the raw value', async () => {
    const column = getLocalizedCropColumns(t).find((entry) => entry.enumExport);
    const [rawValue, exported] = Object.entries(column!.enumExport!)[0];

    const text = await exportedCsv([crop({ [column!.key]: rawValue } as Partial<Crop>)]);

    expect(text).toContain(exported);
  });

  it('passes an unmapped enum value through unchanged rather than dropping it', async () => {
    const column = getLocalizedCropColumns(t).find((entry) => entry.enumExport);

    const text = await exportedCsv([crop({ [column!.key]: 'etwas_unbekanntes' } as Partial<Crop>)]);

    expect(text).toContain('etwas_unbekanntes');
  });

  it('exports only the declared columns, ignoring other crop fields', () => {
    // `CROP_COLUMNS` declares only string and number columns, so
    // `buildSheetData`'s `typeof raw === 'boolean'` branch is unreachable —
    // the same dead branch `parseRawValue` has on the import side. Asserting
    // a yes/no label here would only be testing a line that never runs.
    const types = new Set(getLocalizedCropColumns(t).map((column) => column.type));

    expect(types).toEqual(new Set(['string', 'number']));
  });

  it('leaves a missing value empty instead of writing null or undefined', async () => {
    const text = await exportedCsv([crop({ variety: undefined })]);

    expect(text).not.toContain('null');
    expect(text).not.toContain('undefined');
  });

  it('keeps numbers as numbers so the spreadsheet can compute with them', async () => {
    const text = await exportedCsv([crop({ growth_duration_days: 45 })]);
    const index = columnIndex('growth_duration_days');

    expect(index).toBeGreaterThanOrEqual(0);
    expect(text.trim().split('\n')[1].split(',')[index]).toBe('45');
  });

  it('names the download and revokes the object URL it created', async () => {
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    exportCropsToSpreadsheet([crop()], 'csv', 'meine_kulturen.csv', t);

    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
    // The anchor is a temporary carrier; leaving it behind would accumulate
    // one dead node per export.
    expect(document.querySelectorAll('a')).toHaveLength(0);
  });

  it('labels the blob with the mime type of the chosen format', () => {
    const blobs: Blob[] = [];
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:mock'; }),
      revokeObjectURL: vi.fn(),
    });

    exportCropsToSpreadsheet([crop()], 'csv', 'a.csv', t);
    exportCropsToSpreadsheet([crop()], 'xlsx', 'a.xlsx', t);
    exportCropsToSpreadsheet([crop()], 'ods', 'a.ods', t);

    expect(blobs.map((blob) => blob.type)).toEqual([
      'text/csv;charset=utf-8',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.oasis.opendocument.spreadsheet',
    ]);
  });
});

describe('buildSpreadsheetFilename', () => {
  const today = new Date().toISOString().slice(0, 10);

  it('names an all-crops export by date', () => {
    expect(buildSpreadsheetFilename('csv', 'all')).toBe(`kulturen_export_${today}.csv`);
  });

  it('uses the chosen format as the extension', () => {
    expect(buildSpreadsheetFilename('xlsx', 'all')).toBe(`kulturen_export_${today}.xlsx`);
    expect(buildSpreadsheetFilename('ods', 'all')).toBe(`kulturen_export_${today}.ods`);
  });

  it('names a single-crop export after its supplier and variety', () => {
    const single = crop({ supplier: { id: 1, name: 'Bingenheimer' }, variety: 'Roma' } as Partial<Crop>);

    expect(buildSpreadsheetFilename('csv', 'single', single)).toBe(
      `kultur_bingenheimer_roma_${today}.csv`,
    );
  });

  it('slugifies umlauts and punctuation out of the filename', () => {
    const single = crop({
      supplier: { id: 1, name: 'Müller & Söhne GmbH' }, variety: 'Grüner Zwerg',
    } as Partial<Crop>);

    expect(buildSpreadsheetFilename('csv', 'single', single)).toBe(
      `kultur_muller_sohne_gmbh_gruner_zwerg_${today}.csv`,
    );
  });

  it('falls back to the free-text supplier when no supplier record is linked', () => {
    const single = crop({ seed_supplier: 'Sativa', variety: 'Roma' } as Partial<Crop>);

    expect(buildSpreadsheetFilename('csv', 'single', single)).toBe(
      `kultur_sativa_roma_${today}.csv`,
    );
  });

  it('prefers the linked supplier over the free-text one', () => {
    const single = crop({
      supplier: { id: 1, name: 'Bingenheimer' }, seed_supplier: 'Sativa', variety: 'Roma',
    } as Partial<Crop>);

    expect(buildSpreadsheetFilename('csv', 'single', single)).toContain('bingenheimer');
  });

  it('uses a placeholder rather than an empty segment when a part is missing', () => {
    const single = crop({ variety: undefined } as Partial<Crop>);

    expect(buildSpreadsheetFilename('csv', 'single', single)).toBe(
      `kultur_unbekannt_unbekannt_${today}.csv`,
    );
  });

  it('falls back to the all-crops name when single scope has no crop', () => {
    expect(buildSpreadsheetFilename('csv', 'single')).toBe(`kulturen_export_${today}.csv`);
  });
});
