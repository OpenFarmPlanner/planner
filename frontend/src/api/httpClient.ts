import axios from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';
import i18n from 'i18next';
import { isAuthenticationExpiredError, isMissingProjectHeaderError } from './errors';
import { createAuthenticationExpiredEvent } from '../auth/authEvents';
import { FALLBACK_LANGUAGE } from '../i18n/languages';
import { normalizeBasePath } from '../utils/basePath';
import { readCookie } from '../utils/cookies';

const PROD_API_PATH = '/api';

export function computeProdApiPath(viteBasePath?: string): string {
  const normalizedBasePath = normalizeBasePath(viteBasePath);
  if (normalizedBasePath === '/') {
    return PROD_API_PATH;
  }
  return `${normalizedBasePath.slice(0, -1)}${PROD_API_PATH}`;
}

function isLoopbackHostname(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname.toLowerCase());
}

function getBrowserHostname(): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return window.location.hostname;
}

export function normalizeDevApiBaseURL(viteApiBaseUrl: string, browserHostname?: string): string {
  if (!viteApiBaseUrl) {
    return PROD_API_PATH;
  }

  try {
    const parsed = new URL(viteApiBaseUrl);
    const currentHostname = browserHostname ?? getBrowserHostname();
    if (currentHostname && !isLoopbackHostname(currentHostname) && isLoopbackHostname(parsed.hostname)) {
      parsed.hostname = currentHostname;
      return parsed.toString().replace(/\/$/, '');
    }
  } catch {
    return viteApiBaseUrl;
  }

  return viteApiBaseUrl;
}

/**
 * Computes the baseURL based on environment flags and API base URL configuration.
 *
 * In production, always uses PROD_API_PATH to prevent accidental server misconfiguration.
 * In development, allows VITE_API_BASE_URL to override for flexibility. When the frontend
 * is opened from another LAN device, localhost overrides are mapped to that LAN host.
 *
 * @param isProd - Whether the build is production.
 * @param viteApiBaseUrl - Base URL from VITE_API_BASE_URL environment variable (dev only).
 * @param viteBasePath - Base path from Vite (import.meta.env.BASE_URL), used in production.
 * @param browserHostname - Browser hostname override, primarily for tests.
 * @returns The computed base URL.
 */
export function computeBaseURL(
  isProd: boolean,
  viteApiBaseUrl?: string,
  viteBasePath?: string,
  browserHostname?: string,
): string {
  if (isProd) {
    return computeProdApiPath(viteBasePath);
  }
  return normalizeDevApiBaseURL(viteApiBaseUrl || PROD_API_PATH, browserHostname);
}

export function validateBaseURL(isProd: boolean, baseURL: string): void {
  if (isProd && baseURL.includes('localhost')) {
    throw new Error(
      `[httpClient] FATAL: baseURL must not contain "localhost" in production! Current baseURL: ${baseURL}`
    );
  }
}

const baseURL = computeBaseURL(import.meta.env.PROD, import.meta.env.VITE_API_BASE_URL, import.meta.env.BASE_URL);
validateBaseURL(import.meta.env.PROD, baseURL);

const httpClient = axios.create({
  baseURL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

const requestStartedAt = new WeakMap<InternalAxiosRequestConfig, number>();

httpClient.interceptors.request.use((config) => {
  requestStartedAt.set(config, Date.now());

  if (config.data instanceof FormData) {
    if (config.headers && typeof config.headers === 'object') {
      delete config.headers['Content-Type'];
    }
  }

  // Read fresh from localStorage on every request (not from React state) so a
  // project switch takes effect immediately for any request in flight, and so
  // this stays correct across the full-page reload that AuthContext triggers
  // after switchActiveProject(). See docs/architecture-overview.md
  // ("Project, user, and permission model").
  const activeProjectId = window.localStorage.getItem('activeProjectId');
  if (activeProjectId) {
    config.headers = config.headers ?? {};
    config.headers['X-Project-Id'] = activeProjectId;

    // Namespaced per project (see `activeSeasonStorage.ts`) so switching
    // projects never leaks a stale season id from a previous project.
    const activeSeasonId = window.localStorage.getItem(`activeSeasonId:${activeProjectId}`);
    if (activeSeasonId) {
      config.headers['X-Season-Id'] = activeSeasonId;
    }
  }


  // Tell the API which language to resolve public crop-library content in.
  // Read fresh per request (like X-Project-Id above) so a language switch
  // applies to everything fetched afterwards without a reload. Only public
  // library text is affected — user-entered project content is always served
  // exactly as it was typed.
  config.headers = config.headers ?? {};
  config.headers['Accept-Language'] = i18n.resolvedLanguage ?? i18n.language ?? FALLBACK_LANGUAGE;

  const method = (config.method ?? 'get').toLowerCase();
  if (['post', 'put', 'patch', 'delete'].includes(method)) {
    const csrfToken = readCookie('csrftoken');
    if (csrfToken) {
      config.headers = config.headers ?? {};
      config.headers['X-CSRFToken'] = csrfToken;
    }
  }

  return config;
});

interface RetriableRequestConfig extends InternalAxiosRequestConfig {
  _retriedMissingProjectHeader?: boolean;
}

httpClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (isAuthenticationExpiredError(error) && typeof window !== 'undefined') {
      const startedAt = error.config
        ? requestStartedAt.get(error.config as InternalAxiosRequestConfig)
        : undefined;
      window.dispatchEvent(createAuthenticationExpiredEvent(startedAt ?? Date.now()));
    }

    // See isMissingProjectHeaderError: this specific 400 is transient
    // whenever it races a concurrent change to the shared `activeProjectId`
    // localStorage value (e.g. another browser tab for this origin starting
    // or ending its own session). Retry once, after a short delay to let
    // that concurrent write land, but only while localStorage currently has
    // a project id to retry with — otherwise this genuinely has none and the
    // retry would just fail the same way.
    const config = error.config as RetriableRequestConfig | undefined;
    if (
      config
      && !config._retriedMissingProjectHeader
      && isMissingProjectHeaderError(error)
      && typeof window !== 'undefined'
      && window.localStorage.getItem('activeProjectId')
    ) {
      config._retriedMissingProjectHeader = true;
      await new Promise((resolve) => window.setTimeout(resolve, 150));
      return httpClient(config);
    }

    return Promise.reject(error);
  },
);

export default httpClient;
