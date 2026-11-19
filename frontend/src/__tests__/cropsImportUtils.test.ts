import i18n from '../i18n/config';
import {
  analyzeCropImportJson,
  partitionImportEntries,
  formatImportRowRanges,
  formatImportDiffChange,
  formatImportFailure,
} from '../pages/cropsImportUtils';
import { buildCompanionPreviewErrors, buildTimingWindowPreviewWarnings } from '../pages/cropsPageUtils';

const t = (key: string): string => key;

it('localizes legacy companion limits separately from note validation', () => {
  const translate = i18n.getFixedT('de', 'crops');
  const row = {
    index: 0, status: 'create' as const, import_data: { name: 'Mint' },
    error: 'Import limit', error_code: 'legacy_companion_import_limit',
  };
  expect(buildCompanionPreviewErrors([row], () => 7, translate)).toEqual([
    translate('companions.import.legacyLimitRow', { row: 7 }),
  ]);
  expect(formatImportFailure(row, translate)).toBe(translate('companions.import.legacyLimit'));
  expect(buildCompanionPreviewErrors([
    { ...row, error_code: 'companion_notes_invalid' },
  ], () => 7, translate)).toEqual([translate('companions.import.invalidRow', { row: 7 })]);
});

it('makes a plant-health import diff reviewable and distinguishes a clear from inheritance', () => {
  const translate = i18n.getFixedT('de', 'crops');
  const identity = '00000000-0000-0000-0000-000000000001';
  expect(formatImportDiffChange({ field: 'plant_health', current: null, new: { entries: [
    { name: 'Private, with; delimiters' }, { name: 'Official snapshot', catalogue_identity: identity },
  ] } }, translate)).toBe(`Schädlinge und Krankheiten: ${translate('plantHealth.unspecified')} → Private, with; delimiters · Privater Name; Official snapshot · Katalogeintrag (${identity})`);
  expect(formatImportDiffChange({ field: 'plant_health', current: { entries: [] }, new: null }, translate))
    .toBe(`Schädlinge und Krankheiten: ${translate('plantHealth.emptySelection')} → ${translate('plantHealth.unspecified')}`);
});

it('retains original JSON positions through non-record and invalid-name filtering', () => {
  const result = analyzeCropImportJson('[null, {"name":"A"}, [], {}, {"name":"B"}]', t);
  expect(result).toMatchObject({ status: 'ready', rowNumbers: [2, 5],
    invalidEntries: ['import.invalidEntry 1', 'import.invalidEntry 3', 'import.invalidEntry 4'] });
});

it('formats confirmed source rows as compact ordered ranges', () => {
  expect(formatImportRowRanges([7, 2, 4, 3, 7, 10], 'en')).toBe('2–4, 7, 10');
  expect(formatImportRowRanges([], 'fr')).toBe('');
});

describe('partitionImportEntries', () => {
  it('keeps entries that carry a name', () => {
    const { validEntries, invalidEntries } = partitionImportEntries(
      [{ name: 'Tomate' }, { name: 'Karotte' }], t,
    );

    expect(validEntries).toHaveLength(2);
    expect(invalidEntries).toEqual([]);
  });

  it('rejects an entry whose name is missing, blank or not a string', () => {
    const { validEntries, invalidEntries } = partitionImportEntries(
      [{ name: 'Tomate' }, {}, { name: '   ' }, { name: 42 }, { name: null }], t,
    );

    expect(validEntries).toEqual([{ name: 'Tomate' }]);
    expect(invalidEntries).toHaveLength(4);
  });

  it('numbers the rejected entries by their position in the file, from 1', () => {
    const { invalidEntries } = partitionImportEntries([{ name: 'Tomate' }, {}, {}], t);

    // Position, not index — the user is looking at a file, not an array.
    expect(invalidEntries).toEqual(['import.invalidEntry 2', 'import.invalidEntry 3']);
  });

  it('keeps the original order of the valid entries', () => {
    const { validEntries } = partitionImportEntries(
      [{ name: 'Zucchini' }, {}, { name: 'Aubergine' }], t,
    );

    expect(validEntries.map((entry) => entry.name)).toEqual(['Zucchini', 'Aubergine']);
  });

  it('returns two empty lists for an empty input', () => {
    expect(partitionImportEntries([], t)).toEqual({ validEntries: [], invalidEntries: [], rowNumbers: [], invalidRowNumbers: [] });
  });
});

describe('analyzeCropImportJson', () => {
  it('reports a ready import for a well-formed array', () => {
    const result = analyzeCropImportJson('[{"name": "Tomate"}]', t);

    expect(result.status).toBe('ready');
    expect(result.originalCount).toBe(1);
    expect(result.invalidEntries).toEqual([]);
  });

  it('accepts both export envelopes as well as a bare array', () => {
    const many = analyzeCropImportJson('{"type": "crops", "crops": [{"name": "Tomate"}]}', t);
    const single = analyzeCropImportJson('{"type": "crop", "crop": {"name": "Tomate"}}', t);

    expect(many.status).toBe('ready');
    expect(many.originalCount).toBe(1);
    expect(single.status).toBe('ready');
    expect(single.originalCount).toBe(1);
  });

  it('reports a parse error for JSON that is valid but not a crop export', () => {
    // Worth pinning as-is: `extractImportItems` throws for an unrecognised
    // shape, so this lands in the catch and reports `parse` — the dedicated
    // `notArray` key is reached only by an envelope that parsed to zero items.
    const result = analyzeCropImportJson('{"foo": "bar"}', t);

    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.errorKey).toBe('import.errors.parse');
  });

  it('reports a ready import that also lists the entries it had to skip', () => {
    const result = analyzeCropImportJson('[{"name": "Tomate"}, {}]', t);

    expect(result.status).toBe('ready');
    expect(result.originalCount).toBe(2);
    expect(result.invalidEntries).toHaveLength(1);
    if (result.status === 'ready') {
      expect(result.validEntries).toHaveLength(1);
    }
  });

  it('distinguishes "nothing to import" from "nothing usable"', () => {
    // The two produce different messages, because the fix is different: one
    // is the wrong file, the other is a file missing crop names.
    const empty = analyzeCropImportJson('[]', t);
    const unusable = analyzeCropImportJson('[{}, {}]', t);

    expect(empty.status).toBe('error');
    expect(unusable.status).toBe('error');
    if (empty.status === 'error') expect(empty.errorKey).toBe('import.errors.notArray');
    if (unusable.status === 'error') expect(unusable.errorKey).toBe('import.errors.noValidEntries');
  });

  it('still lists the rejected entries when none of them were usable', () => {
    const result = analyzeCropImportJson('[{}, {}]', t);

    expect(result.invalidEntries).toHaveLength(2);
    expect(result.originalCount).toBe(2);
  });

  it('reports a parse error for text that is not JSON at all', () => {
    const result = analyzeCropImportJson('das ist kein json', t);

    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.errorKey).toBe('import.errors.parse');
    expect(result.originalCount).toBe(0);
    expect(result.invalidEntries).toEqual([]);
  });

  it('recovers from a trailing comma, which hand-edited exports often carry', () => {
    const result = analyzeCropImportJson('[{"name": "Tomate"},]', t);

    expect(result.status).toBe('ready');
    expect(result.originalCount).toBe(1);
  });

  it('reports a parse error rather than throwing for an empty file', () => {
    const result = analyzeCropImportJson('', t);

    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.errorKey).toBe('import.errors.parse');
  });

  it('counts every item in the file, not only the ones it could use', () => {
    const result = analyzeCropImportJson('[{"name": "A"}, {}, {"name": "B"}, {}]', t);

    expect(result.originalCount).toBe(4);
    if (result.status === 'ready') expect(result.validEntries).toHaveLength(2);
  });
});

describe('buildTimingWindowPreviewWarnings', () => {
  const tCrops = i18n.getFixedT('de', 'crops') as unknown as (key: string, options?: Record<string, unknown>) => string;

  it('names row, column and reason for every dropped cell', () => {
    const lines = buildTimingWindowPreviewWarnings([
      {
        index: 0,
        status: 'create',
        import_data: { name: 'Salat' },
        timing_window_issues: [
          { field: 'planting_windows', value: 'Frühjahr', code: 'timing_window_not_recognized' },
          { field: 'harvest_duration_days', value: 'Juli bis September', code: 'timing_window_harvest_not_imported' },
          { field: 'direct_sowing_windows', value: 'KW 53', code: 'timing_window_invalid_week' },
          { field: 'germination_days', value: 'fk', code: 'range_not_recognized' },
        ],
      },
    ], (index) => index + 2, tCrops);
    expect(lines).toEqual([
      'Zeile 2, Pflanzzeitraum: „Frühjahr“ ist keine Zeitangabe. Möglich sind zum Beispiel „Anfang März bis Ende April“, „KW 10 bis 14“ oder „03a-04c“. Mehrere Zeiträume mit „;“ trennen, zum Beispiel „März; Oktober“. Der Wert wird nicht übernommen.',
      'Zeile 2, Erntezeit (Tage), „Juli bis September“: Erntezeiträume werden nicht importiert. Die Ernte ergibt sich aus Pflanzung und Kulturdauer. In dieser Spalte wird die Erntedauer in Tagen erwartet. Der Wert wird nicht übernommen.',
      'Zeile 2, Direktsaatzeitraum, „KW 53“: Kalenderwochen von 1 bis 52 angeben. Der Wert wird nicht übernommen.',
      'Zeile 2, Keimdauer (Tage), „fk“: Bitte eine Zahl oder einen Bereich wie „18–25“ angeben. Der Wert wird nicht übernommen.',
    ]);
  });
});
