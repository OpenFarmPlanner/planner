import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractApiErrorMessage, isAreaInputSpacingMissingError, isAuthenticationExpiredError } from '../api/errors';
import i18n from '../i18n/config';

const fallbackMessage = 'Ein Fehler ist aufgetreten';

type TranslationMap = Record<string, string>;

function createT(translations: TranslationMap) {
  return (key: string) => translations[key] ?? key;
}

function createAxiosError(status: number, data: unknown) {
  return {
    isAxiosError: true,
    response: {
      status,
      data,
    },
  };
}

describe('extractApiErrorMessage', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns fallback message for non-axios errors', () => {
    const t = createT({});

    const result = extractApiErrorMessage(new Error('boom'), t, fallbackMessage);

    expect(result).toBe(fallbackMessage);
  });

  it('returns fallback message for axios errors with non-400 status', () => {
    const t = createT({});
    const error = createAxiosError(500, { detail: 'Serverfehler' });

    const result = extractApiErrorMessage(error, t, fallbackMessage);

    expect(result).toBe(fallbackMessage);
  });

  it('returns a session-expired message for missing authentication credentials', () => {
    const t = createT({
      'errors.sessionExpired': 'Ihre Sitzung ist abgelaufen.',
    });
    const error = createAxiosError(403, {
      detail: 'Authentication credentials were not provided.',
    });

    const result = extractApiErrorMessage(error, t, fallbackMessage);

    expect(result).toBe('Ihre Sitzung ist abgelaufen.');
  });

  it('detects stale authenticated sessions', () => {
    expect(isAuthenticationExpiredError(createAxiosError(403, {
      detail: 'Authentication credentials were not provided.',
    }))).toBe(true);
    expect(isAuthenticationExpiredError(createAxiosError(401, {
      detail: 'Not authenticated',
    }))).toBe(true);
    expect(isAuthenticationExpiredError(createAxiosError(403, {
      detail: 'You do not have permission to perform this action.',
    }))).toBe(false);
  });



  it('returns 503 detail unchanged when no special mapping applies', () => {
    const t = createT({});

    const error = createAxiosError(503, {
      detail: 'Temporärer Dienstfehler',
    });

    const result = extractApiErrorMessage(error, t, fallbackMessage);

    expect(result).toBe('Temporärer Dienstfehler');
  });
  it('returns server message directly when 400 data is a string', () => {
    const t = createT({});
    const error = createAxiosError(400, 'Ungültige Anfrage');

    const result = extractApiErrorMessage(error, t, fallbackMessage);

    expect(result).toBe('Ungültige Anfrage');
  });

  it('formats 400 validation object errors with translated field names', () => {
    const t = createT({
      'fields.name': 'Name',
      'columns.category': 'Kategorie',
      description: 'Beschreibung',
    });

    const error = createAxiosError(400, {
      name: ['Darf nicht leer sein'],
      category: ['Ist ungültig'],
      description: 'Zu lang',
    });

    const result = extractApiErrorMessage(error, t, fallbackMessage);

    expect(result).toBe([
      'Name: Darf nicht leer sein',
      'Kategorie: Ist ungültig',
      'Beschreibung: Zu lang',
    ].join('\n'));
  });

  it('maps duplicate crop-name backend errors to user-friendly localized text', () => {
    const t = createT({
      'fields.name': 'Name',
      'validation.cropNameUnique': 'Eine Kultur mit diesem Namen existiert bereits.',
    });

    const error = createAxiosError(400, {
      name: ['A crop with this name already exists.'],
    });

    const result = extractApiErrorMessage(error, t, fallbackMessage);

    expect(result).toBe('Name: Eine Kultur mit diesem Namen existiert bereits.');
  });

  it('maps crop name conflict responses to the crop form hint', () => {
    const t = createT({
      'form.cropNameConflict': 'Diese Kultur existiert bereits in diesem Projekt. Füge stattdessen eine neue Sorte hinzu oder wähle einen anderen Namen.',
    });

    const error = createAxiosError(409, {
      code: 'crop_name_conflict',
      detail: 'A general crop with this name already exists in this project.',
    });

    const result = extractApiErrorMessage(error, t, fallbackMessage);

    expect(result).toBe('Diese Kultur existiert bereits in diesem Projekt. Füge stattdessen eine neue Sorte hinzu oder wähle einen anderen Namen.');
  });

  it('maps duplicate supplier-data backend codes to localized text', () => {
    const t = createT({
      'fields.supplier_id': 'Lieferant',
      'errors.supplierDataDuplicate': 'Für diesen Lieferanten sind bereits Daten für diese Kultur vorhanden.',
    });

    const error = createAxiosError(400, {
      supplier_id: ['supplier_data_duplicate'],
    });

    const result = extractApiErrorMessage(error, t, fallbackMessage);

    expect(result).toBe('Lieferant: Für diesen Lieferanten sind bereits Daten für diese Kultur vorhanden.');
  });

  it('keeps old duplicate supplier-data backend messages localized', () => {
    const t = createT({
      'fields.supplier_id': 'Lieferant',
      'errors.supplierDataDuplicate': 'Für diesen Lieferanten sind bereits Daten für diese Kultur vorhanden.',
    });

    const error = createAxiosError(400, {
      supplier_id: ['Supplier data for this crop already exists.'],
    });

    const result = extractApiErrorMessage(error, t, fallbackMessage);

    expect(result).toBe('Lieferant: Für diesen Lieferanten sind bereits Daten für diese Kultur vorhanden.');
  });



  it('returns fallback when 400 object has no string or array messages', () => {
    const t = createT({});
    const error = createAxiosError(400, {
      amount: 123,
      active: false,
    });

    const result = extractApiErrorMessage(error, t, fallbackMessage);

    expect(result).toBe(fallbackMessage);
  });

  it('falls back to raw field name when translation is empty', () => {
    const t = createT({
      'messages.error': '',
      'common:errorFieldLabels.non_field_errors': 'Fehler',
    });

    const error = createAxiosError(400, {
      non_field_errors: ['Unbekannter Validierungsfehler'],
    });

    const result = extractApiErrorMessage(error, t, fallbackMessage);

    expect(result).toBe('Fehler: Unbekannter Validierungsfehler');
  });
  it('uses generic error translation for non_field_errors and raw field as final fallback', () => {
    const t = createT({
      'messages.error': 'Allgemeiner Fehler',
      'common:errorFieldLabels.non_field_errors': 'Fehler',
    });

    const error = createAxiosError(400, {
      non_field_errors: ['Kombination ist nicht erlaubt'],
      unknown_field: ['Ungültiger Wert'],
    });

    const result = extractApiErrorMessage(error, t, fallbackMessage);

    expect(result).toBe([
      'Fehler: Kombination ist nicht erlaubt',
      'unknown_field: Ungültiger Wert',
    ].join('\n'));
  });

  it('translates the fallback labels for known backend fields', () => {
    const t = createT({
      'common:errorFieldLabels.area_usage_sqm': 'Fläche (m²)',
      'common:errorFieldLabels.planting_date': 'Pflanzdatum',
    });
    const error = createAxiosError(400, {
      area_usage_sqm: ['Zu groß'],
      planting_date: ['Ungültiges Datum'],
    });

    const result = extractApiErrorMessage(error, t, fallbackMessage);

    expect(result).toBe([
      'Fläche (m²): Zu groß',
      'Pflanzdatum: Ungültiges Datum',
    ].join('\n'));
  });

  it('localizes planting plan area input validation errors', () => {
    const t = createT({
      'common:validation.areaInputPositive': 'Der Wert muss größer als 0 sein.',
      'common:validation.areaInputPlantsSpacingMissing': 'Für diese Kultur fehlen gültige Pflanzabstände. Die Fläche kann nicht aus der Pflanzenanzahl berechnet werden.',
      'common:errorFieldLabels.area_input_value': 'Fläche',
      'common:errorFieldLabels.area_input_unit': 'Flächeneingabe',
    });
    const error = createAxiosError(400, {
      area_input_value: ['Area input value must be greater than 0.'],
      area_input_unit: ['Crop spacing data is missing or invalid. Cannot calculate area from plant count.'],
    });

    const result = extractApiErrorMessage(error, t, fallbackMessage);

    expect(result).toBe([
      'Fläche: Der Wert muss größer als 0 sein.',
      'Flächeneingabe: Für diese Kultur fehlen gültige Pflanzabstände. Die Fläche kann nicht aus der Pflanzenanzahl berechnet werden.',
    ].join('\n'));
  });

  it('localizes the missing-spacing error with a page-namespace t (planting plans)', () => {
    // Regression: the planting-plans page resolves keys in its own namespace,
    // which left this message in English on the mobile dialog.
    const t = i18n.getFixedT('de', ['plantingPlans', 'common']) as (key: string) => string;
    const error = createAxiosError(400, {
      area_input_unit: ['Crop spacing data is missing or invalid. Cannot calculate area from plant count.'],
    });

    expect(extractApiErrorMessage(error, t, fallbackMessage)).toBe(
      'Flächeneingabe: Für diese Kultur fehlen Pflanz- oder Reihenabstand. '
      + 'Wir können die Fläche daher nicht aus der Pflanzenanzahl berechnen.',
    );
  });


});

describe('isAreaInputSpacingMissingError', () => {
  it('detects the backend missing-spacing rejection', () => {
    const error = createAxiosError(400, {
      area_input_unit: ['Crop spacing data is missing or invalid. Cannot calculate area from plant count.'],
    });
    expect(isAreaInputSpacingMissingError(error)).toBe(true);
  });

  it('ignores other area input errors and non-axios errors', () => {
    expect(isAreaInputSpacingMissingError(createAxiosError(400, {
      area_input_unit: ['Crop must be selected to input area as plant count.'],
    }))).toBe(false);
    expect(isAreaInputSpacingMissingError(new Error('boom'))).toBe(false);
  });
});
