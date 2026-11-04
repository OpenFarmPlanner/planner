/**
 * Tests for httpClient
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { API_REQUEST_TIMEOUT_MS } from '../api/requestTimeout';
import { computeBaseURL, computeProdApiPath, normalizeDevApiBaseURL, validateBaseURL } from '../api/httpClient';

describe('httpClient', () => {
  describe('computeBaseURL', () => {
    it('should return PROD_API_PATH when in production with no VITE_API_BASE_URL', () => {
      const baseUrl = computeBaseURL(true, undefined);
      expect(baseUrl).toBe('/api');
    });

    it('should always return PROD_API_PATH in production regardless of VITE_API_BASE_URL', () => {
      const baseUrl = computeBaseURL(true, 'https://api.example.com');
      expect(baseUrl).toBe('/api');
    });

    it('should use base path prefix in production when app is hosted under subpath', () => {
      const baseUrl = computeBaseURL(true, undefined, '/openfarmplanner/');
      expect(baseUrl).toBe('/openfarmplanner/api');
    });

    it('should return VITE_API_BASE_URL in development when set on localhost', () => {
      const baseUrl = computeBaseURL(false, 'http://localhost:8000/api');
      expect(baseUrl).toBe('http://localhost:8000/api');
    });

    it('should map localhost API overrides to the LAN host in development', () => {
      const baseUrl = computeBaseURL(false, 'http://localhost:8000/api', '/', '192.168.178.125');
      expect(baseUrl).toBe('http://192.168.178.125:8000/api');
    });

    it('should map 127.0.0.1 API overrides to the LAN host in development', () => {
      const baseUrl = computeBaseURL(false, 'http://127.0.0.1:8000/api', '/', '192.168.178.125');
      expect(baseUrl).toBe('http://192.168.178.125:8000/api');
    });

    it('should return PROD_API_PATH in development when VITE_API_BASE_URL is not set', () => {
      const baseUrl = computeBaseURL(false, undefined);
      expect(baseUrl).toBe('/api');
    });

    it('should return PROD_API_PATH in development when VITE_API_BASE_URL is empty', () => {
      const baseUrl = computeBaseURL(false, '');
      expect(baseUrl).toBe('/api');
    });
  });

  describe('normalizeDevApiBaseURL', () => {
    it('should leave relative URLs unchanged', () => {
      expect(normalizeDevApiBaseURL('/api', '192.168.178.125')).toBe('/api');
    });

    it('should leave non-localhost absolute URLs unchanged', () => {
      expect(normalizeDevApiBaseURL('http://api.example.test/api', '192.168.178.125')).toBe('http://api.example.test/api');
    });
  });

  describe('computeProdApiPath', () => {
    it('should return /api for root base path', () => {
      expect(computeProdApiPath('/')).toBe('/api');
    });

    it('should return prefixed api path for subpath base', () => {
      expect(computeProdApiPath('/openfarmplanner/')).toBe('/openfarmplanner/api');
    });
  });

  describe('validateBaseURL', () => {
    it('should not throw when localhost is used in development', () => {
      expect(() => {
        validateBaseURL(false, 'http://localhost:8000/api');
      }).not.toThrow();
    });

    it('should not throw when localhost is NOT in baseURL in production', () => {
      expect(() => {
        validateBaseURL(true, 'https://api.example.com');
      }).not.toThrow();
    });

    it('should throw error when localhost is used in production', () => {
      expect(() => {
        validateBaseURL(true, 'http://localhost:8000/api');
      }).toThrow(/FATAL: baseURL must not contain "localhost" in production/);
    });

    it('should throw error when localhost appears anywhere in production URL', () => {
      expect(() => {
        validateBaseURL(true, 'https://localhost-production.com/api');
      }).toThrow(/FATAL: baseURL must not contain "localhost" in production/);
    });

    it('should not throw when not in production even with localhost in URL', () => {
      expect(() => {
        validateBaseURL(false, 'http://localhost-machine.com/api');
      }).not.toThrow();
    });
  });

  describe('httpClient module', () => {
    it('should export default httpClient with axios instance', async () => {
      // Import the real httpClient to verify it exports correctly
      const httpClientModule = await import('../api/httpClient');
      expect(httpClientModule.default).toBeDefined();
      expect(httpClientModule.default.defaults).toBeDefined();
      expect(httpClientModule.default.defaults.headers['Content-Type']).toBe('application/json');
    });

    it('should set correct baseURL in httpClient', async () => {
      const httpClientModule = await import('../api/httpClient');
      expect(httpClientModule.default.defaults.baseURL).toBeDefined();
      expect(typeof httpClientModule.default.defaults.baseURL).toBe('string');
    });

    it('should have Content-Type application/json header configured', async () => {
      const httpClientModule = await import('../api/httpClient');
      expect(httpClientModule.default.defaults.headers['Content-Type']).toBe('application/json');
    });
  });

  describe('axios instance behavior', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    it('should have axios instance with request and response methods', async () => {
      const httpClientModule = await import('../api/httpClient');
      const httpClient = httpClientModule.default;
      
      // Verify axios instance methods exist
      expect(typeof httpClient.get).toBe('function');
      expect(typeof httpClient.post).toBe('function');
      expect(typeof httpClient.put).toBe('function');
      expect(typeof httpClient.delete).toBe('function');
      expect(typeof httpClient.patch).toBe('function');
    });

    it('should time out API requests but not uploads', async () => {
      const { default: httpClient } = await import('../api/httpClient');
      const adapter = vi.fn(async (config) => ({ data: {}, status: 200, statusText: 'OK', headers: {}, config }));

      await httpClient.get('/fields/', { adapter });
      await httpClient.post('/notes/attachments/', new FormData(), { adapter });

      expect(adapter.mock.calls[0][0].timeout).toBe(API_REQUEST_TIMEOUT_MS);
      expect(adapter.mock.calls[1][0].timeout).toBe(0);
    });

    it('should have interceptors object', async () => {
      const httpClientModule = await import('../api/httpClient');
      const httpClient = httpClientModule.default;
      
      expect(httpClient.interceptors).toBeDefined();
      expect(httpClient.interceptors.request).toBeDefined();
      expect(httpClient.interceptors.response).toBeDefined();
    });
  });
});
