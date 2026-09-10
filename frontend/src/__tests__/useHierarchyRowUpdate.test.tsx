import { renderHook, act } from '@testing-library/react';
import { GridRowModes } from '@mui/x-data-grid';
import type { GridRowId, GridRowModesModel } from '@mui/x-data-grid';
import { AxiosError, AxiosHeaders } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bed, Field, Location } from '../api/api';
import i18n from '../i18n';
import {
  tagHierarchyRowUpdateError,
  useHierarchyRowUpdate,
} from '../components/hierarchy/hooks/useHierarchyRowUpdate';
import type { HierarchyRowUpdateError } from '../components/hierarchy/hooks/useHierarchyRowUpdate';
import type { HierarchyRow } from '../components/hierarchy/utils/types';

const { fieldCreateMock, fieldUpdateMock, locationUpdateMock } = vi.hoisted(() => ({
  fieldCreateMock: vi.fn(),
  fieldUpdateMock: vi.fn(),
  locationUpdateMock: vi.fn(),
}));

vi.mock('../api/api', () => ({
  fieldAPI: { create: fieldCreateMock, update: fieldUpdateMock },
  locationAPI: { update: locationUpdateMock },
}));

const t = i18n.getFixedT('de', 'hierarchy');

// extractApiErrorMessage only unpacks DRF payloads out of a genuine AxiosError,
// so a plain object with a `response` would fall straight through to the
// generic message and prove nothing about the mapping under test.
const validationError = (data: Record<string, string[]>): AxiosError => {
  const error = new AxiosError('Request failed with status code 400');
  error.response = {
    status: 400,
    statusText: 'Bad Request',
    data,
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  };
  return error;
};

const bed = (overrides: Partial<Bed> & { id: number; field: number }): Bed => ({
  name: `Beet ${overrides.id}`,
  area_sqm: 10,
  length_m: null,
  width_m: null,
  notes: '',
  ...overrides,
}) as Bed;

const field = (overrides: Partial<Field> & { id: number }): Field => ({
  name: `Parzelle ${overrides.id}`,
  location: 1,
  area_sqm: 100,
  length_m: null,
  width_m: null,
  notes: '',
  ...overrides,
}) as Field;

const bedRow = (overrides: Partial<HierarchyRow> = {}): HierarchyRow => ({
  id: 1,
  type: 'bed',
  level: 2,
  name: 'Beet A',
  bedId: 1,
  field: 1,
  ...overrides,
});

const fieldRow = (overrides: Partial<HierarchyRow> = {}): HierarchyRow => ({
  id: 'field-1',
  type: 'field',
  level: 1,
  name: 'Parzelle A',
  fieldId: 1,
  locationId: 1,
  ...overrides,
});

type Harness = {
  beds: Bed[];
  fields: Field[];
  locations: Location[];
  rowModesModel: GridRowModesModel;
  rowsById: Map<string, HierarchyRow>;
  drafts: Map<string, HierarchyRow>;
  selectedRowIdRef: { current: GridRowId | null };
  rowSnapshotRef: { current: Map<string, HierarchyRow> };
  setBeds: ReturnType<typeof vi.fn>;
  setFields: ReturnType<typeof vi.fn>;
  setLocations: ReturnType<typeof vi.fn>;
  setRowModesModel: ReturnType<typeof vi.fn>;
  setError: ReturnType<typeof vi.fn>;
  setDraftValidationWarning: ReturnType<typeof vi.fn>;
  fetchData: ReturnType<typeof vi.fn>;
  saveBed: ReturnType<typeof vi.fn>;
  onUnsavedMissingName: ReturnType<typeof vi.fn>;
};

// The hook takes React state setters, so the harness applies each updater to a
// plain array and keeps the result. That makes the functional updates the hook
// passes (`previousBeds => ...`) observable as the resulting collection rather
// than as an opaque function argument.
const setup = (overrides: Partial<Harness> = {}) => {
  const harness: Harness = {
    beds: [],
    fields: [],
    locations: [{ id: 1, name: 'Standort A' } as Location],
    rowModesModel: {},
    rowsById: new Map(),
    drafts: new Map(),
    selectedRowIdRef: { current: null },
    rowSnapshotRef: { current: new Map() },
    setBeds: vi.fn(),
    setFields: vi.fn(),
    setLocations: vi.fn(),
    setRowModesModel: vi.fn(),
    setError: vi.fn(),
    setDraftValidationWarning: vi.fn(),
    fetchData: vi.fn().mockResolvedValue(undefined),
    saveBed: vi.fn(),
    onUnsavedMissingName: vi.fn(),
    ...overrides,
  };

  harness.setBeds.mockImplementation((updater: (previous: Bed[]) => Bed[]) => {
    harness.beds = updater(harness.beds);
  });
  harness.setFields.mockImplementation((updater: (previous: Field[]) => Field[]) => {
    harness.fields = updater(harness.fields);
  });
  harness.setLocations.mockImplementation((updater: (previous: Location[]) => Location[]) => {
    harness.locations = updater(harness.locations);
  });
  harness.setRowModesModel.mockImplementation(
    (updater: (previous: GridRowModesModel) => GridRowModesModel) => {
      harness.rowModesModel = updater(harness.rowModesModel);
    },
  );

  const { result } = renderHook(() => useHierarchyRowUpdate({
    getDraftRow: (rowId) => harness.drafts.get(String(rowId)) ?? null,
    rowModesModel: harness.rowModesModel,
    selectedRowIdRef: harness.selectedRowIdRef as never,
    rowsById: harness.rowsById,
    beds: harness.beds,
    fields: harness.fields,
    locations: harness.locations,
    setBeds: harness.setBeds as never,
    setFields: harness.setFields as never,
    setLocations: harness.setLocations as never,
    rowSnapshotRef: harness.rowSnapshotRef as never,
    setRowModesModel: harness.setRowModesModel as never,
    setError: harness.setError,
    setDraftValidationWarning: harness.setDraftValidationWarning,
    fetchData: harness.fetchData,
    saveBed: harness.saveBed,
    onUnsavedMissingName: harness.onUnsavedMissingName,
    t,
  }));

  return { result, harness };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('tagHierarchyRowUpdateError', () => {
  it('stamps the row id onto an Error so a stale rejection can be told apart', () => {
    const error = new Error('boom');
    expect(tagHierarchyRowUpdateError(error, 'field-7')).toBe(error);
    expect((error as HierarchyRowUpdateError).hierarchyRowId).toBe('field-7');
  });

  it('hands back a non-Error rejection untouched rather than throwing on it', () => {
    // Rejections do not have to be Errors — a string reaching this helper must
    // pass straight through instead of failing the assignment.
    const rejection = 'not an error';
    expect(tagHierarchyRowUpdateError(rejection, 1)).toBe(rejection);
  });
});

describe('processRowUpdate — nameless rows', () => {
  it('silently drops a brand-new row nothing was typed into', async () => {
    const row = bedRow({ isNew: true, name: '', bedId: -1, id: -1 });
    const { result, harness } = setup({ beds: [bed({ id: -1, field: 1 })] });
    harness.drafts.set('-1', row);

    await act(async () => {
      await result.current.processRowUpdate(row);
    });

    // No error is surfaced: the user typed nothing, so there is nothing to warn
    // about — the draft just disappears.
    expect(harness.setError).not.toHaveBeenCalledWith(t('validation.nameRequired'));
    expect(harness.beds).toHaveLength(0);
    expect(harness.rowModesModel[-1]).toEqual({
      mode: GridRowModes.View,
      ignoreModifications: true,
    });
  });

  it('resolves, rather than rejects, a new row with data but no name', async () => {
    const row = bedRow({ isNew: true, name: '', area_sqm: '12', bedId: -1, id: -1 });
    const { result, harness } = setup({ beds: [bed({ id: -1, field: 1 })] });

    // Rejecting here would strand the row in edit mode; the hook resolves and
    // hands the decision to the confirm dialog instead.
    await act(async () => {
      await expect(result.current.processRowUpdate(row)).resolves.toBe(row);
    });

    expect(harness.onUnsavedMissingName).toHaveBeenCalledWith(-1);
    expect(harness.rowModesModel[-1]?.mode).toBe(GridRowModes.View);
  });

  it('rejects an existing row whose name was cleared', async () => {
    const { result, harness } = setup();

    await act(async () => {
      await expect(result.current.processRowUpdate(bedRow({ name: '   ' })))
        .rejects.toThrow('Name ist ein Pflichtfeld');
    });

    expect(harness.setError).toHaveBeenCalledWith('Name ist ein Pflichtfeld');
  });
});

describe('processRowUpdate — bed rows', () => {
  it('rejects a name another bed in the same field already uses', async () => {
    const { result, harness } = setup({
      beds: [bed({ id: 2, field: 1, name: 'Beet A' })],
    });

    await act(async () => {
      await expect(result.current.processRowUpdate(bedRow({ name: 'Beet A' })))
        .rejects.toThrow('Ein Beet mit diesem Namen existiert in dieser Parzelle bereits.');
    });
    expect(harness.saveBed).not.toHaveBeenCalled();
  });

  it('allows the same name in a different field', async () => {
    // The duplicate check is scoped to the field, not the whole project, so an
    // identically named bed elsewhere must not block the save.
    const { result, harness } = setup({
      beds: [bed({ id: 2, field: 99, name: 'Beet A' })],
    });
    harness.saveBed.mockResolvedValue(bed({ id: 1, field: 1, name: 'Beet A' }));

    await act(async () => {
      await result.current.processRowUpdate(bedRow({ name: 'Beet A' }));
    });
    expect(harness.saveBed).toHaveBeenCalled();
  });

  it('does not treat a row as a duplicate of itself', async () => {
    const { result, harness } = setup({
      beds: [bed({ id: 1, field: 1, name: 'Beet A' })],
    });
    harness.saveBed.mockResolvedValue(bed({ id: 1, field: 1, name: 'Beet A' }));

    await act(async () => {
      await result.current.processRowUpdate(bedRow({ bedId: 1, name: 'Beet A' }));
    });
    expect(harness.saveBed).toHaveBeenCalled();
  });

  it('rejects a length that is not a number', async () => {
    const { result } = setup();
    await act(async () => {
      await expect(result.current.processRowUpdate(bedRow({ length_m: 'zehn' as never })))
        .rejects.toThrow('Länge muss eine gültige Zahl sein.');
    });
  });

  it('rejects a negative width', async () => {
    const { result } = setup();
    await act(async () => {
      await expect(result.current.processRowUpdate(bedRow({ width_m: -1 })))
        .rejects.toThrow('Breite muss größer oder gleich 0 sein.');
    });
  });

  it('accepts a cleared dimension, which parses to null rather than to invalid', async () => {
    // `parseDimensionValue('')` is null, not undefined — emptying the field is
    // how a user removes a dimension and must not read as "not a number".
    const { result, harness } = setup();
    harness.saveBed.mockResolvedValue(bed({ id: 1, field: 1 }));

    await act(async () => {
      await result.current.processRowUpdate(bedRow({ length_m: '' as never }));
    });
    expect(harness.saveBed).toHaveBeenCalledWith(
      expect.objectContaining({ length_m: null }),
    );
  });

  it('derives the area from length times width, ignoring a typed area', async () => {
    const { result, harness } = setup({ fields: [field({ id: 1, area_sqm: 1000 })] });
    harness.saveBed.mockResolvedValue(bed({ id: 1, field: 1 }));

    await act(async () => {
      await result.current.processRowUpdate(
        bedRow({ length_m: 4, width_m: 2.5, area_sqm: '999' }),
      );
    });
    expect(harness.saveBed).toHaveBeenCalledWith(expect.objectContaining({ area_sqm: 10 }));
  });

  it('falls back to the typed area when only one dimension is given', async () => {
    const { result, harness } = setup({ fields: [field({ id: 1, area_sqm: 1000 })] });
    harness.saveBed.mockResolvedValue(bed({ id: 1, field: 1 }));

    await act(async () => {
      await result.current.processRowUpdate(bedRow({ length_m: 4, area_sqm: '7' }));
    });
    expect(harness.saveBed).toHaveBeenCalledWith(expect.objectContaining({ area_sqm: 7 }));
  });

  it('rejects a bed that would push the field over its own area', async () => {
    const { result } = setup({
      fields: [field({ id: 1, area_sqm: 100 })],
      beds: [bed({ id: 2, field: 1, area_sqm: 60 })],
    });

    await act(async () => {
      await expect(result.current.processRowUpdate(bedRow({ area_sqm: '50' })))
        .rejects.toThrow(/überschreitet die Fläche der Parzelle \(100.00 m²\)/);
    });
  });

  it('excludes the edited bed from the sum, so resizing it in place is allowed', async () => {
    // Bed 1 already occupies 60 of the field's 100 m². Growing it to 90 keeps
    // the total at 90 — counting its old area as well would wrongly reject it.
    const { result, harness } = setup({
      fields: [field({ id: 1, area_sqm: 100 })],
      beds: [bed({ id: 1, field: 1, area_sqm: 60 })],
    });
    harness.saveBed.mockResolvedValue(bed({ id: 1, field: 1, area_sqm: 90 }));

    await act(async () => {
      await result.current.processRowUpdate(bedRow({ bedId: 1, area_sqm: '90' }));
    });
    expect(harness.saveBed).toHaveBeenCalled();
  });

  it('skips the area check entirely when the field is not loaded', async () => {
    // A bed whose field is missing from state has nothing to compare against;
    // blocking the save would be worse than letting the backend decide.
    const { result, harness } = setup({ fields: [] });
    harness.saveBed.mockResolvedValue(bed({ id: 1, field: 1 }));

    await act(async () => {
      await result.current.processRowUpdate(bedRow({ area_sqm: '99999' }));
    });
    expect(harness.saveBed).toHaveBeenCalled();
  });

  it('returns the saved bed id, clearing the new-row flag', async () => {
    const { result, harness } = setup();
    harness.saveBed.mockResolvedValue(bed({ id: 42, field: 1, area_sqm: 12 }));

    let saved: HierarchyRow | undefined;
    await act(async () => {
      saved = await result.current.processRowUpdate(bedRow({ isNew: true, bedId: -1, id: -1 }));
    });

    expect(saved).toMatchObject({ id: 42, bedId: 42, isNew: false, area_sqm: 12 });
  });
});

describe('processRowUpdate — field rows', () => {
  it('rejects a name another field in the same location already uses', async () => {
    const { result } = setup({
      fields: [field({ id: 2, location: 1, name: 'Parzelle A' })],
    });

    await act(async () => {
      await expect(result.current.processRowUpdate(fieldRow({ name: 'Parzelle A' })))
        .rejects.toThrow('Eine Parzelle mit diesem Namen existiert in diesem Standort bereits.');
    });
  });

  it('allows the same field name in a different location', async () => {
    const { result } = setup({
      fields: [field({ id: 2, location: 9, name: 'Parzelle A' })],
    });
    fieldUpdateMock.mockResolvedValue({ data: field({ id: 1, name: 'Parzelle A' }) });

    await act(async () => {
      await result.current.processRowUpdate(fieldRow({ name: 'Parzelle A' }));
    });
    expect(fieldUpdateMock).toHaveBeenCalled();
  });

  it('creates rather than updates when the id is the negative placeholder', async () => {
    // New rows carry a negative client-side id until the backend assigns one.
    const { result } = setup();
    fieldCreateMock.mockResolvedValue({ data: field({ id: 7, name: 'Neu' }) });

    let saved: HierarchyRow | undefined;
    await act(async () => {
      saved = await result.current.processRowUpdate(
        fieldRow({ fieldId: -1, id: 'field--1', name: 'Neu', area_sqm: '50' }),
      );
    });

    expect(fieldUpdateMock).not.toHaveBeenCalled();
    expect(fieldCreateMock).toHaveBeenCalledWith(expect.objectContaining({ area_sqm: 50 }));
    expect(saved).toMatchObject({ id: 'field-7', fieldId: 7, isNew: false });
  });

  it('replaces the placeholder row instead of leaving it beside the created one', async () => {
    const { result, harness } = setup({ fields: [field({ id: -1, name: 'Neu' })] });
    fieldCreateMock.mockResolvedValue({ data: field({ id: 7, name: 'Neu' }) });

    await act(async () => {
      await result.current.processRowUpdate(fieldRow({ fieldId: -1, name: 'Neu' }));
    });

    expect(harness.fields.map((entry) => entry.id)).toEqual([7]);
  });

  it('rejects a zero area on a new field', async () => {
    const { result } = setup();
    await act(async () => {
      await expect(result.current.processRowUpdate(
        fieldRow({ fieldId: -1, area_sqm: '0' }),
      )).rejects.toThrow('Die Fläche muss größer als 0 sein.');
    });
    expect(fieldCreateMock).not.toHaveBeenCalled();
  });

  it('accepts a new field with no area at all', async () => {
    // An omitted area is undefined, which the positivity check deliberately
    // lets through — only a supplied, non-positive area is an error.
    const { result } = setup();
    fieldCreateMock.mockResolvedValue({ data: field({ id: 7 }) });

    await act(async () => {
      await result.current.processRowUpdate(fieldRow({ fieldId: -1, area_sqm: undefined }));
    });
    expect(fieldCreateMock).toHaveBeenCalled();
  });

  it('surfaces a create failure as a localized message', async () => {
    const { result, harness } = setup();
    fieldCreateMock.mockRejectedValue(new Error('network down'));

    await act(async () => {
      await expect(result.current.processRowUpdate(fieldRow({ fieldId: -1 })))
        .rejects.toThrow('Fehler beim Erstellen der Parzelle');
    });
    expect(harness.setError).toHaveBeenCalledWith('Fehler beim Erstellen der Parzelle');
  });

  it('rejects an area beyond the million-square-metre ceiling on an existing field', async () => {
    const { result } = setup();
    await act(async () => {
      await expect(result.current.processRowUpdate(fieldRow({ area_sqm: '1000001' })))
        .rejects.toThrow('Die eingegebene Fläche ist zu groß. Bitte einen kleineren Wert eingeben.');
    });
  });

  it('rejects shrinking a field below the beds it already contains', async () => {
    const { result } = setup({
      beds: [bed({ id: 1, field: 1, area_sqm: 80 }), bed({ id: 2, field: 1, area_sqm: 30 })],
    });

    await act(async () => {
      await expect(result.current.processRowUpdate(fieldRow({ area_sqm: '100' })))
        .rejects.toThrow(/\(110.00 m²\)/);
    });
  });

  it('translates a backend digits complaint into the area-too-large message', async () => {
    // DRF reports `max_digits` for an oversized decimal; showing that verbatim
    // would leak a serializer detail into the UI.
    const { result, harness } = setup();
    fieldUpdateMock.mockRejectedValue(
      validationError({ area_sqm: ['Ensure that there are no more than 10 digits'] }),
    );

    await act(async () => {
      await expect(result.current.processRowUpdate(fieldRow({}))).rejects.toThrow(
        'Die eingegebene Fläche ist zu groß. Bitte einen kleineren Wert eingeben.',
      );
    });
    expect(harness.setError).toHaveBeenCalledWith(
      'Die eingegebene Fläche ist zu groß. Bitte einen kleineren Wert eingeben.',
    );
  });

  it('leaves an unrelated backend error message intact', async () => {
    const { result } = setup();
    fieldUpdateMock.mockRejectedValue(
      validationError({ non_field_errors: ['Etwas ist schiefgelaufen'] }),
    );

    await act(async () => {
      await expect(result.current.processRowUpdate(fieldRow({})))
        .rejects.toThrow('Etwas ist schiefgelaufen');
    });
  });
});

describe('processRowUpdate — location rows', () => {
  it('merges the edit over the existing location instead of sending only the two edited fields', async () => {
    // locationAPI.update is a PUT: omitting the untouched fields would blank
    // them server-side, so the existing record is spread in first.
    const { result, harness } = setup({
      locations: [{ id: 1, name: 'Alt', notes: 'alt', address: 'Feldweg 1' } as Location],
    });
    locationUpdateMock.mockResolvedValue({ data: { id: 1, name: 'Neu', notes: 'neu' } });

    await act(async () => {
      await result.current.processRowUpdate({
        id: 'location-1', type: 'location', level: 0, locationId: 1, name: 'Neu', notes: 'neu',
      });
    });

    expect(locationUpdateMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ address: 'Feldweg 1', name: 'Neu', notes: 'neu' }),
    );
    expect(harness.locations[0]).toMatchObject({ name: 'Neu', notes: 'neu' });
  });
});

describe('discardRowEdit', () => {
  it('removes a new field row outright', () => {
    const { result, harness } = setup({ fields: [field({ id: -1 })] });
    harness.drafts.set('field--1', fieldRow({ isNew: true, fieldId: -1, id: 'field--1' }));

    act(() => result.current.discardRowEdit('field--1'));

    expect(harness.fields).toHaveLength(0);
    expect(harness.setDraftValidationWarning).toHaveBeenCalledWith('');
  });

  it('keeps a partially filled new bed and warns about the missing name', () => {
    const { result, harness } = setup({ beds: [bed({ id: -1, field: 1 })] });
    harness.drafts.set('-1', bedRow({ isNew: true, name: '', area_sqm: '5', bedId: -1, id: -1 }));

    act(() => result.current.discardRowEdit(-1));

    expect(harness.beds).toHaveLength(1);
    expect(harness.beds[0]).toMatchObject({ area_sqm: 5, name: '' });
    expect(harness.setDraftValidationWarning).toHaveBeenCalledWith(
      'Zeile wurde nicht gespeichert, da der Name fehlt.',
    );
  });

  it('drops a partially filled new bed anyway when forced', () => {
    const { result, harness } = setup({ beds: [bed({ id: -1, field: 1 })] });
    harness.drafts.set('-1', bedRow({ isNew: true, name: '', area_sqm: '5', bedId: -1, id: -1 }));

    act(() => result.current.discardRowEdit(-1, { force: true }));

    expect(harness.beds).toHaveLength(0);
  });

  it('leaves a saved row in place, only exiting edit mode', () => {
    const { result, harness } = setup({ beds: [bed({ id: 1, field: 1 })] });
    harness.drafts.set('1', bedRow({ isNew: false }));

    act(() => result.current.discardRowEdit(1));

    expect(harness.beds).toHaveLength(1);
    expect(harness.rowModesModel[1]).toEqual({
      mode: GridRowModes.View,
      ignoreModifications: true,
    });
  });

  it('clears the row snapshot so a later edit starts from current values', () => {
    const { result, harness } = setup();
    harness.rowSnapshotRef.current.set('1', bedRow());

    act(() => result.current.discardRowEdit(1));

    expect(harness.rowSnapshotRef.current.has('1')).toBe(false);
  });
});

describe('discardActiveRowEdit', () => {
  it('does nothing when no row is in edit mode', () => {
    const { result, harness } = setup({
      rowModesModel: { 1: { mode: GridRowModes.View } },
    });

    act(() => result.current.discardActiveRowEdit());

    expect(harness.setRowModesModel).not.toHaveBeenCalled();
  });

  it('discards the row that is actually being edited', () => {
    const { result, harness } = setup({
      rowModesModel: { 1: { mode: GridRowModes.View }, 2: { mode: GridRowModes.Edit } },
    });

    act(() => result.current.discardActiveRowEdit());

    expect(harness.rowModesModel[2]?.mode).toBe(GridRowModes.View);
    expect(harness.rowModesModel[1]?.mode).toBe(GridRowModes.View);
  });

  it('discards the same row whether or not rowsById knows it', () => {
    // `discardActiveRowEdit` looks the model key up in `rowsById` and prefers
    // that row's own `id`. The lookup cannot change the outcome: `rowsById` is
    // built as `new Map(rows.map(row => [String(row.id), row]))`, so the id it
    // returns is by construction the key that was used to find it, and every
    // consumer inside `discardRowEdit` stringifies its argument anyway — the
    // `setRowModesModel` object key included, since object keys coerce. This
    // asserts the equivalence rather than pretending the lookup matters.
    const run = (rowsById: Map<string, HierarchyRow>) => {
      const { result, harness } = setup({
        rowModesModel: { 1: { mode: GridRowModes.Edit } },
        rowsById,
        beds: [bed({ id: 1, field: 1 })],
      });
      harness.drafts.set('1', bedRow({ isNew: true, name: '', bedId: 1, id: 1 }));
      act(() => result.current.discardActiveRowEdit());
      return harness;
    };

    const known = run(new Map([['1', bedRow({ id: 1 })]]));
    const unknown = run(new Map());

    expect(known.beds).toHaveLength(0);
    expect(unknown.beds).toHaveLength(0);
    expect(unknown.rowModesModel).toEqual(known.rowModesModel);
  });
});

describe('exitToViewPreservingDraft', () => {
  it('writes the typed bed values back so continuing the edit resumes them', () => {
    const { result, harness } = setup({ beds: [bed({ id: 1, field: 1, name: 'Alt' })] });

    act(() => result.current.exitToViewPreservingDraft(
      1,
      bedRow({ name: 'Getippt', area_sqm: '3,5', length_m: '2,5' as never, notes: 'Notiz' }),
    ));

    // The comma decimal separator German users type has to survive the round
    // trip as a number.
    expect(harness.beds[0]).toMatchObject({
      name: 'Getippt', area_sqm: 3.5, length_m: 2.5, notes: 'Notiz',
    });
  });

  it('writes the typed field values back too', () => {
    const { result, harness } = setup({ fields: [field({ id: 1, name: 'Alt' })] });

    act(() => result.current.exitToViewPreservingDraft(
      'field-1',
      fieldRow({ name: 'Getippt', area_sqm: '20' }),
    ));

    expect(harness.fields[0]).toMatchObject({ name: 'Getippt', area_sqm: 20 });
  });

  it('leaves state alone for a location row, which has no draft mirror', () => {
    const { result, harness } = setup();

    act(() => result.current.exitToViewPreservingDraft('location-1', {
      id: 'location-1', type: 'location', level: 0, locationId: 1, name: 'Neu',
    }));

    expect(harness.setBeds).not.toHaveBeenCalled();
    expect(harness.setFields).not.toHaveBeenCalled();
    expect(harness.rowModesModel['location-1']?.mode).toBe(GridRowModes.View);
  });
});

describe('preservePartialNewBedDraft', () => {
  it('clears the warning once the row has a name again', () => {
    const { result, harness } = setup({ beds: [bed({ id: 1, field: 1 })] });

    act(() => result.current.preservePartialNewBedDraft(
      bedRow({ isNew: true, name: 'Benannt', area_sqm: '5' }),
    ));

    expect(harness.setDraftValidationWarning).toHaveBeenCalledWith('');
  });

  it('clears the error banner when it raises the softer warning', () => {
    // The two are alternatives: leaving a hard error on screen next to the
    // inline warning would show the same row failing twice.
    const { result, harness } = setup({ beds: [bed({ id: 1, field: 1 })] });

    act(() => result.current.preservePartialNewBedDraft(
      bedRow({ isNew: true, name: '', area_sqm: '5' }),
    ));

    expect(harness.setError).toHaveBeenCalledWith('');
  });

  it('ignores a field row', () => {
    const { result, harness } = setup();

    act(() => result.current.preservePartialNewBedDraft(fieldRow({ isNew: true })));

    expect(harness.setBeds).not.toHaveBeenCalled();
  });
});

describe('handleProcessRowUpdateError', () => {
  it('reverts the errored row when the user has already moved to another one', () => {
    const { result, harness } = setup();
    harness.selectedRowIdRef.current = 'field-2';
    const error = Object.assign(new Error('kaputt'), { hierarchyRowId: 'field-1' });

    act(() => result.current.handleProcessRowUpdateError(error));

    expect(harness.rowModesModel['field-1']).toEqual({
      mode: GridRowModes.View,
      ignoreModifications: true,
    });
    expect(harness.setError).toHaveBeenCalledWith('kaputt');
  });

  it('leaves the row in edit mode when it is still the selected one', () => {
    // The user is looking at this row — kicking it out of edit mode would throw
    // away what they typed just as they are being told to fix it.
    const { result, harness } = setup();
    harness.selectedRowIdRef.current = 'field-1';
    const error = Object.assign(new Error('kaputt'), { hierarchyRowId: 'field-1' });

    act(() => result.current.handleProcessRowUpdateError(error));

    expect(harness.setRowModesModel).not.toHaveBeenCalled();
  });

  it('compares the ids as strings, since the model and the row disagree on type', () => {
    const { result, harness } = setup();
    harness.selectedRowIdRef.current = 1;
    const error = Object.assign(new Error('kaputt'), { hierarchyRowId: '1' });

    act(() => result.current.handleProcessRowUpdateError(error));

    expect(harness.setRowModesModel).not.toHaveBeenCalled();
  });

  it('leaves the row alone when nothing is selected', () => {
    const { result, harness } = setup();
    harness.selectedRowIdRef.current = null;
    const error = Object.assign(new Error('kaputt'), { hierarchyRowId: 'field-1' });

    act(() => result.current.handleProcessRowUpdateError(error));

    expect(harness.setRowModesModel).not.toHaveBeenCalled();
  });

  it('falls back to the generic save message for an error with no message', () => {
    const { result, harness } = setup();

    act(() => result.current.handleProcessRowUpdateError(new Error('')));

    expect(harness.setError).toHaveBeenCalledWith('Fehler beim Speichern');
  });
});
