import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from '../registerServiceWorker';

const registerMock = vi.fn();

function stubServiceWorkerSupport(): void {
  Object.defineProperty(window.navigator, 'serviceWorker', {
    configurable: true,
    value: { register: registerMock },
  });
}

function removeServiceWorkerSupport(): void {
  Reflect.deleteProperty(window.navigator, 'serviceWorker');
}

/**
 * Captures the handler `registerServiceWorker` puts on `load` and runs it,
 * rather than dispatching a real event: a dispatched event would also reach
 * the handlers earlier tests in this file left on `window`.
 */
function captureLoadHandlers(): () => void {
  const handlers: EventListener[] = [];
  vi.spyOn(window, 'addEventListener').mockImplementation(((type: string, handler: EventListener) => {
    if (type === 'load') {
      handlers.push(handler);
    }
  }) as typeof window.addEventListener);

  return () => handlers.forEach((handler) => handler(new Event('load')));
}

beforeEach(() => {
  registerMock.mockReset();
  registerMock.mockResolvedValue({});
  stubServiceWorkerSupport();
  vi.stubEnv('PROD', true);
});

afterEach(() => {
  removeServiceWorkerSupport();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('registerServiceWorker', () => {
  it('registers the generated worker under the configured base path', () => {
    const fireLoad = captureLoadHandlers();

    registerServiceWorker('/');
    fireLoad();

    expect(registerMock).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('keeps the worker inside a sub-path deployment', () => {
    const fireLoad = captureLoadHandlers();

    registerServiceWorker('/planner/');
    fireLoad();

    expect(registerMock).toHaveBeenCalledWith('/planner/sw.js', { scope: '/planner/' });
  });

  it('waits for load so registration does not compete with the app start', () => {
    captureLoadHandlers();

    registerServiceWorker('/');

    expect(registerMock).not.toHaveBeenCalled();
  });

  it('does not register in development, where no worker is generated', () => {
    vi.stubEnv('PROD', false);
    const fireLoad = captureLoadHandlers();

    registerServiceWorker('/');
    fireLoad();

    expect(registerMock).not.toHaveBeenCalled();
  });

  it('does nothing when the browser has no service worker support', () => {
    removeServiceWorkerSupport();
    const fireLoad = captureLoadHandlers();

    registerServiceWorker('/');
    fireLoad();

    expect(registerMock).not.toHaveBeenCalled();
  });

  it('swallows a failed registration so the app still boots', async () => {
    registerMock.mockRejectedValue(new Error('blocked'));
    const fireLoad = captureLoadHandlers();

    registerServiceWorker('/');
    expect(() => fireLoad()).not.toThrow();

    await expect(registerMock.mock.results[0]?.value).rejects.toThrow('blocked');
  });
});
