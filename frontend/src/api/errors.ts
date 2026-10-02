/**
 * API error handling utilities.
 *
 * Provides centralized functions to extract user-friendly error messages
 * from API responses, primarily from Django REST Framework validation errors.
 */

import axios, { AxiosError } from 'axios';

/**
 * Translation function type from i18n.
 */
type TFunction = (key: string, options?: Record<string, unknown>) => string;

/**
 * Backend field names the page namespaces do not label themselves.
 *
 * Resolved through `common:errorFieldLabels.*` so validation errors are shown
 * in the active UI language instead of hardcoded German.
 */
const FALLBACK_LABEL_FIELDS = [
  'area_input_value',
  'area_input_unit',
  'area_usage_sqm',
  'area_sqm',
  'planting_date',
  'harvest_date',
  'harvest_end_date',
  'quantity',
  'cultivation_type',
  'crop',
  'bed',
  'field',
  'location',
  'non_field_errors',
] as const;

/**
 * The translation of `key`, or undefined when it is missing or names a
 * section rather than a string.
 *
 * Backend field names are looked up as bare keys, and one like `detail` can
 * collide with a whole section of the caller's namespace. `returnObjects`
 * makes i18next hand back that section instead of its "returned an object
 * instead of string" warning text, so the collision is recognised and skipped.
 */
function translateLabel(t: TFunction, key: string): string | undefined {
  const translated: unknown = t(key, { returnObjects: true });
  return typeof translated === 'string' && translated && translated !== key ? translated : undefined;
}

function fieldLabelFallback(t: TFunction, field: string): string | undefined {
  if (!(FALLBACK_LABEL_FIELDS as readonly string[]).includes(field)) {
    return undefined;
  }
  return translateLabel(t, `common:errorFieldLabels.${field}`);
}

function translatedOrFallback(t: TFunction, key: string, fallback: string): string {
  return translateLabel(t, key) ?? fallback;
}


const AREA_INPUT_SPACING_MISSING_MESSAGE =
  'crop spacing data is missing or invalid. cannot calculate area from plant count.';

const backendMessageMap: Record<string, string> = {
  'this field is required.': 'validation.required',
  'a crop with this name already exists.': 'validation.cropNameUnique',
  'a crop with this name and variety already exists.': 'form.duplicateNameVariety',
  'enter a valid email address.': 'validation.invalidEmail',
  'no public crops found': 'errors.noPublicCrops',
  'bed not found.': 'errors.bedNotFound',
  'uploaded file exceeds the 10mb size limit.': 'errors.fileTooLarge',
  'uploaded file is not a valid image.': 'errors.invalidImage',
  'supplier_data_duplicate': 'errors.supplierDataDuplicate',
  'supplier data for this crop already exists.': 'errors.supplierDataDuplicate',
  'supplier_data_missing_supplier': 'errors.supplierDataMissingSupplier',
  'select a supplier or remove the supplier information.': 'errors.supplierDataMissingSupplier',
  'supplier_specific_tkg_unsupported': 'errors.supplierSpecificTkgUnsupported',
  'supplier-specific thousand-kernel weight is no longer supported.': 'errors.supplierSpecificTkgUnsupported',
  'supplier_project_mismatch': 'errors.supplierProjectMismatch',
  'supplier does not belong to the active project.': 'errors.supplierProjectMismatch',
  'selected_supplier_project_mismatch': 'errors.selectedSupplierProjectMismatch',
  'selected supplier does not belong to the active project.': 'errors.selectedSupplierProjectMismatch',
  'crop_project_mismatch': 'errors.cropProjectMismatch',
  'crop does not belong to the active project.': 'errors.cropProjectMismatch',
  'this crop species already exists or has already been proposed.': 'library.publishWizard.speciesAlreadyExists',
  'please enter a valid numeric value, e.g. 3.9.': 'validation.invalidNumberExample',
  // Namespaced explicitly: callers resolve `t` in their page namespace, which
  // does not carry these planting-plan area keys.
  'area input value must be greater than 0.': 'common:validation.areaInputPositive',
  'crop must be selected to input area as plant count.': 'common:validation.areaInputPlantsCropRequired',
  [AREA_INPUT_SPACING_MISSING_MESSAGE]: 'common:validation.areaInputPlantsSpacingMissing',
};

const authenticationExpiredDetails = new Set([
  'authentication credentials were not provided.',
  'not authenticated',
]);

function getResponseDetail(data: unknown): string | null {
  if (!data || typeof data !== 'object' || !('detail' in data)) {
    return null;
  }
  const detail = data.detail;
  return typeof detail === 'string' ? detail : null;
}

function isAuthenticationExpiredDetail(detail: string | null): boolean {
  if (!detail) {
    return false;
  }
  return authenticationExpiredDetails.has(detail.trim().toLowerCase());
}

function localizeBackendMessage(message: string, t: TFunction): string {
  const normalized = message.trim().toLowerCase();
  const key = backendMessageMap[normalized];
  if (key) {
    return translatedOrFallback(t, key, message);
  }
  if (/^ensure this field has at least (\d+) characters\.$/i.test(message)) {
    const count = Number(message.match(/(\d+)/)?.[1] ?? 0);
    return translatedOrFallback(t, 'validation.minLength', message).replace('{{count}}', String(count));
  }
  return message;
}

function formatServiceError(detail: string, t: TFunction, fallbackMessage: string): string {
  return localizeBackendMessage(detail || fallbackMessage, t);
}

/**
 * The `{code, detail, ...context}` envelope of `api_error_response`, or DRF's
 * own `{detail}`. Neither is a per-field validation error: its keys are not
 * form fields, and `detail` is English developer text, not UI copy.
 */
function isErrorEnvelope(data: object): data is { code?: unknown; detail?: unknown } {
  return (
    ('code' in data && typeof data.code === 'string')
    || (Object.keys(data).length === 1 && 'detail' in data && typeof data.detail === 'string')
  );
}

function localizeErrorEnvelope(
  data: { code?: unknown; detail?: unknown },
  t: TFunction,
  fallbackMessage: string,
): string {
  for (const candidate of [data.code, data.detail]) {
    if (typeof candidate !== 'string') continue;
    const key = backendMessageMap[candidate.trim().toLowerCase()];
    if (key) {
      return translatedOrFallback(t, key, fallbackMessage);
    }
  }
  return fallbackMessage;
}

/**
 * Extract user-friendly error message from Axios error response.
 *
 * Handles Django REST Framework validation errors (400 status) and converts
 * them to user-friendly messages with localized field names.
 *
 * @param error - The error object from API call.
 * @param t - Translation function for field names.
 * @param fallbackMessage - Fallback error message if extraction fails.
 * @returns User-friendly error message string.
 */
export function extractApiErrorMessage(
  error: unknown,
  t: TFunction,
  fallbackMessage: string
): string {

  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError;
    const status = axiosError.response?.status;
    const data = axiosError.response?.data;

    if (isAuthenticationExpiredError(error)) {
      return translatedOrFallback(
        t,
        'errors.sessionExpired',
        'Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.',
      );
    }

    if (typeof data === 'string') {
      const trimmed = data.trim();
      const contentType = axiosError.response?.headers?.['content-type'];
      const looksLikeHtml = trimmed.startsWith('<!DOCTYPE html') || trimmed.startsWith('<html');
      if (looksLikeHtml || (typeof contentType === 'string' && contentType.includes('text/html'))) {
        return translatedOrFallback(t, 'errors.generic', fallbackMessage);
      }
      return status === 503 ? formatServiceError(data, t, fallbackMessage) : localizeBackendMessage(data, t);
    }

    if (status === 503 && data && typeof data === 'object' && 'detail' in data && typeof data.detail === 'string') {
      return formatServiceError(data.detail, t, fallbackMessage);
    }

    if (
      status === 409
      && data
      && typeof data === 'object'
      && 'code' in data
      && data.code === 'crop_name_conflict'
    ) {
      return translatedOrFallback(
        t,
        'form.cropNameConflict',
        'Diese Kultur existiert bereits in diesem Projekt. Füge stattdessen eine neue Sorte hinzu oder wähle einen anderen Namen.',
      );
    }

    // Check if it's a 400 validation error
    if (status === 400) {
      if (data && typeof data === 'object' && isErrorEnvelope(data)) {
        return localizeErrorEnvelope(data, t, fallbackMessage);
      }
      // If data is an object with error fields
      if (data && typeof data === 'object') {
        const errors: string[] = [];

        // Extract field names dynamically from i18n
        Object.entries(data).forEach(([field, value]) => {
          const fieldName = translateLabel(t, `fields.${field}`)
            ?? translateLabel(t, `columns.${field}`)
            ?? translateLabel(t, field)
            ?? fieldLabelFallback(t, field)
            ?? field;
          if (Array.isArray(value)) {
            value.forEach((msg: unknown) => {
              if (typeof msg === 'string') {
                const errorMsg = `${fieldName}: ${localizeBackendMessage(msg, t)}`;
                errors.push(errorMsg);
                return;
              }
            });
          } else if (typeof value === 'string') {
            const errorMsg = `${fieldName}: ${localizeBackendMessage(value, t)}`;
            errors.push(errorMsg);
          }
        });

        if (errors.length > 0) {
          const result = errors.join('\n');
          return result;
        }
      }
    }
  }

  // Fallback to generic error message
  return translatedOrFallback(t, 'errors.generic', fallbackMessage);
}


/**
 * Whether a planting-plan save was rejected because the selected crop has no
 * usable spacing, so the area cannot be derived from a plant count.
 */
export function isAreaInputSpacingMissingError(error: unknown): boolean {
  if (!axios.isAxiosError(error) || error.response?.status !== 400) {
    return false;
  }
  const data: unknown = error.response.data;
  if (!data || typeof data !== 'object' || !('area_input_unit' in data)) {
    return false;
  }
  const messages = data.area_input_unit;
  const list = Array.isArray(messages) ? messages : [messages];
  return list.some((message) => (
    typeof message === 'string'
    && message.trim().toLowerCase() === AREA_INPUT_SPACING_MISSING_MESSAGE
  ));
}


/**
 * Extracts the stable `code` field OpenFarmPlanner's `api_error_response`
 * always attaches to a structured rejection (e.g. `crop_link_owned`,
 * `crop_species_unchanged`), or `undefined` for a non-Axios error or a
 * response with no such code.
 */
export function extractApiErrorCode(error: unknown): string | undefined {
  if (!axios.isAxiosError(error)) {
    return undefined;
  }
  const data = error.response?.data as { code?: string } | undefined;
  return data?.code;
}

/**
 * Detects whether an Axios request was canceled/aborted by the client.
 */
export function isApiRequestCanceled(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }
  const axiosError = error as AxiosError;
  return axiosError.code === 'ERR_CANCELED';
}

/**
 * Detects stale or missing browser sessions reported by Django REST Framework.
 */
export function isAuthenticationExpiredError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }
  const axiosError = error as AxiosError;
  const status = axiosError.response?.status;
  if (status !== 401 && status !== 403) {
    return false;
  }
  return isAuthenticationExpiredDetail(getResponseDetail(axiosError.response?.data));
}
