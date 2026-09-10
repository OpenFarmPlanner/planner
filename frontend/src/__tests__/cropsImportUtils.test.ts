import {
  analyzeCropImportJson,
  partitionImportEntries,
} from '../pages/cropsImportUtils';

const t = (key: string): string => key;

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
    expect(partitionImportEntries([], t)).toEqual({ validEntries: [], invalidEntries: [] });
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
