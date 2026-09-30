import { computeBaseURL } from './httpClient';

/** Public API reference (Redoc) served by the backend under the API prefix. */
export const API_DOCS_URL = `${computeBaseURL(import.meta.env.PROD, import.meta.env.VITE_API_BASE_URL, import.meta.env.BASE_URL)}/docs/`;
