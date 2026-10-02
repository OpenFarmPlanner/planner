import { computeBaseURL } from './httpClient';

/** Public API reference (Redoc) served by the backend under the API prefix. */
export const API_DOCS_URL = `${computeBaseURL(import.meta.env.PROD, import.meta.env.VITE_API_BASE_URL, import.meta.env.BASE_URL)}/docs/`;

/**
 * Docs for the crop-library token specifically. This token's endpoints are
 * deliberately not published in the generated reference at `API_DOCS_URL`
 * (it is filtered to the `ProjectApiToken` allowlist — see
 * `docs/crop-library-api-tokens.md`'s "Known limitations"), so it needs its
 * own link rather than reusing that one.
 */
export const CROP_LIBRARY_TOKEN_DOCS_URL =
  'https://github.com/OpenFarmPlanner/planner/blob/main/docs/crop-library-api-tokens.md';
