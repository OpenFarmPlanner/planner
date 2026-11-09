import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

/** Served without a refresh while younger than this. */
export const RESPONSE_FRESH_MS = 10_000;
/** Never served when older than this, so other members' edits show up quickly. */
export const RESPONSE_MAX_AGE_MS = 60_000;
const MAX_ENTRIES = 100;
const INVALIDATION_CHANNEL = 'ofp-api-response-cache';

// Lists that several pages load. Auth, notifications and anything derived from
// the clock stay out: they must always be current.
const CACHEABLE_LIST = new RegExp(
  '^/(seasons|seasons/creation-options|season-setup/status|projects|locations|fields|beds|crops'
  + '|planting-plans|crop-companions|crop-task-templates|suppliers|plant-families)/(\\?|$)',
);

interface CacheEntry {
  response: AxiosResponse;
  storedAt: number;
}

const entries = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<AxiosResponse>>();
// Bumped by every invalidation, so a response requested before a write can
// never be stored after it.
let generation = 0;

function invalidate(): void {
  generation += 1;
  entries.clear();
  inFlight.clear();
}

const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(INVALIDATION_CHANNEL);
if (channel) {
  channel.onmessage = invalidate;
}

/** Drops all cached responses in this tab and in the user's other tabs. */
export function clearApiResponseCache(): void {
  invalidate();
  channel?.postMessage('invalidate');
}

function isRead(config: InternalAxiosRequestConfig): boolean {
  return ['get', 'head', 'options'].includes((config.method ?? 'get').toLowerCase());
}

function cacheKey(config: InternalAxiosRequestConfig): string | null {
  const url = config.url ?? '';
  if ((config.method ?? 'get').toLowerCase() !== 'get' || config.signal || !CACHEABLE_LIST.test(url)) {
    return null;
  }
  return JSON.stringify([
    url,
    config.params ?? null,
    config.headers.get('X-Project-Id') ?? null,
    config.headers.get('X-Season-Id') ?? null,
    config.headers.get('Accept-Language') ?? null,
  ]);
}

function copyFor(response: AxiosResponse, config: InternalAxiosRequestConfig): AxiosResponse {
  return { ...response, data: structuredClone(response.data), config };
}

function fetchAndStore(key: string, network: AxiosAdapter, config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
  const startedIn = generation;
  const request = Promise.resolve(network(config))
    .then((response) => {
      if (startedIn === generation) {
        entries.delete(key);
        entries.set(key, { response: copyFor(response, config), storedAt: Date.now() });
        if (entries.size > MAX_ENTRIES) {
          entries.delete(entries.keys().next().value as string);
        }
      }
      return response;
    })
    .finally(() => {
      if (inFlight.get(key) === request) {
        inFlight.delete(key);
      }
    });
  inFlight.set(key, request);
  return request;
}

/**
 * Wraps an axios adapter so that navigating between pages reuses recent list
 * responses. Memory only, see docs/architecture-overview.md.
 */
export function createCachingAdapter(network: AxiosAdapter): AxiosAdapter {
  return async (config) => {
    if (!isRead(config)) {
      clearApiResponseCache();
      try {
        return await network(config);
      } finally {
        clearApiResponseCache();
      }
    }

    const key = cacheKey(config);
    if (key === null) {
      return network(config);
    }

    const entry = entries.get(key);
    const age = entry ? Date.now() - entry.storedAt : Infinity;
    if (entry && age < RESPONSE_MAX_AGE_MS) {
      if (age >= RESPONSE_FRESH_MS && !inFlight.has(key)) {
        // A failed refresh keeps the entry until it expires.
        fetchAndStore(key, network, config).catch(() => undefined);
      }
      return copyFor(entry.response, config);
    }

    const pending = inFlight.get(key) ?? fetchAndStore(key, network, config);
    return copyFor(await pending, config);
  };
}
