import { AxiosHeaders } from 'axios';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearApiResponseCache,
  createCachingAdapter,
  RESPONSE_FRESH_MS,
  RESPONSE_MAX_AGE_MS,
} from '../api/responseCache';

function config(url: string, options: { method?: string; project?: string; season?: string; language?: string; signal?: AbortSignal } = {}): InternalAxiosRequestConfig {
  const headers = new AxiosHeaders();
  if (options.project) headers.set('X-Project-Id', options.project);
  if (options.season) headers.set('X-Season-Id', options.season);
  if (options.language) headers.set('Accept-Language', options.language);
  return { url, method: options.method ?? 'get', headers, signal: options.signal };
}

function ok(data: unknown, requestConfig: InternalAxiosRequestConfig): AxiosResponse {
  return { data, status: 200, statusText: 'OK', headers: {}, config: requestConfig };
}

describe('API response cache', () => {
  let counter: number;
  const network = vi.fn(async (requestConfig: InternalAxiosRequestConfig) => {
    counter += 1;
    return ok({ version: counter }, requestConfig);
  });
  const adapter = createCachingAdapter(network);

  beforeEach(() => {
    vi.useFakeTimers();
    clearApiResponseCache();
    counter = 0;
    network.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('serves a shared list from memory while it is fresh', async () => {
    const first = await adapter(config('/crops/?page_size=1000'));
    const second = await adapter(config('/crops/?page_size=1000'));

    expect(network).toHaveBeenCalledTimes(1);
    expect(second.data).toEqual(first.data);
  });

  it('never caches endpoints outside the allowlist', async () => {
    for (const url of ['/notifications/', '/crops/42/', '/seasons/due-suggestion/', '/tasks/']) {
      await adapter(config(url));
      await adapter(config(url));
    }

    expect(network).toHaveBeenCalledTimes(8);
  });

  it('keeps projects, seasons and languages apart', async () => {
    await adapter(config('/crops/', { project: '1', season: '1', language: 'de' }));
    await adapter(config('/crops/', { project: '2', season: '1', language: 'de' }));
    await adapter(config('/crops/', { project: '1', season: '2', language: 'de' }));
    await adapter(config('/crops/', { project: '1', season: '1', language: 'en' }));

    expect(network).toHaveBeenCalledTimes(4);
  });

  it('returns the cached list and refreshes it in the background once it is older than the fresh window', async () => {
    await adapter(config('/fields/'));
    vi.advanceTimersByTime(RESPONSE_FRESH_MS + 1);

    const stale = await adapter(config('/fields/'));
    await vi.advanceTimersByTimeAsync(0);
    const refreshed = await adapter(config('/fields/'));

    expect(stale.data).toEqual({ version: 1 });
    expect(refreshed.data).toEqual({ version: 2 });
    expect(network).toHaveBeenCalledTimes(2);
  });

  it('does not serve anything older than the maximum age', async () => {
    await adapter(config('/beds/'));
    vi.advanceTimersByTime(RESPONSE_MAX_AGE_MS + 1);

    expect((await adapter(config('/beds/'))).data).toEqual({ version: 2 });
  });

  it.each(['post', 'put', 'patch', 'delete'])('a %s clears every cached list', async (method) => {
    await adapter(config('/crops/'));
    await adapter(config('/planting-plans/'));

    await adapter(config('/crops/42/', { method }));
    await adapter(config('/crops/'));
    await adapter(config('/planting-plans/'));

    expect(network).toHaveBeenCalledTimes(5);
  });

  it('clears the cache when a write fails, because the server may have applied it', async () => {
    await adapter(config('/crops/'));
    network.mockRejectedValueOnce(new Error('Gateway time-out'));

    await expect(adapter(config('/crops/42/', { method: 'patch' }))).rejects.toThrow();
    await adapter(config('/crops/'));

    expect(network).toHaveBeenCalledTimes(3);
  });

  it('does not store a list requested before a write that finishes after it', async () => {
    let release: (response: AxiosResponse) => void = () => undefined;
    const slowConfig = config('/crops/');
    network.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));

    const slowRead = adapter(slowConfig);
    await adapter(config('/crops/42/', { method: 'delete' }));
    release(ok({ version: 'before the write' }, slowConfig));
    await slowRead;

    expect((await adapter(config('/crops/'))).data).not.toEqual({ version: 'before the write' });
  });

  it('shares one network request between identical concurrent reads', async () => {
    await Promise.all([adapter(config('/locations/')), adapter(config('/locations/'))]);

    expect(network).toHaveBeenCalledTimes(1);
  });

  it('does not cache failures', async () => {
    network.mockRejectedValueOnce(new Error('Gateway time-out'));

    await expect(adapter(config('/crops/'))).rejects.toThrow();

    expect((await adapter(config('/crops/'))).data).toEqual({ version: 1 });
  });

  it('keeps the entry when a background refresh fails', async () => {
    await adapter(config('/fields/'));
    vi.advanceTimersByTime(RESPONSE_FRESH_MS + 1);
    network.mockRejectedValueOnce(new Error('Gateway time-out'));

    await adapter(config('/fields/'));
    await vi.advanceTimersByTimeAsync(0);

    expect((await adapter(config('/fields/'))).data).toEqual({ version: 1 });
  });

  it('hands out independent copies', async () => {
    const first = await adapter(config('/suppliers/'));
    first.data.version = 'changed by the caller';

    expect((await adapter(config('/suppliers/'))).data).toEqual({ version: 1 });
  });

  it('leaves requests that can be aborted alone', async () => {
    const { signal } = new AbortController();
    await adapter(config('/crops/', { signal }));
    await adapter(config('/crops/', { signal }));

    expect(network).toHaveBeenCalledTimes(2);
  });
});
