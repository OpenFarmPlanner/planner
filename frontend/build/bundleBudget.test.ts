import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bundleBudgetPlugin, PRECACHE_ASSET_LIMIT_BYTES } from './bundleBudget.ts';

describe('production bundle budget', () => {
  const icon = 'icons/pwa.png';
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ofp-bundle-budget-'));
    writeFileSync(join(root, 'index.html'), '<script type="module" src="/index.js"></script>');
    writeFileSync(join(root, 'index.js'), 'console.log("OpenFarmPlanner");');
    mkdirSync(join(root, 'public/icons'), { recursive: true });
  });

  afterEach(() => rmSync(root, { force: true, recursive: true }));

  function buildFixture(entryBudgetBytes?: number) {
    return build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [bundleBudgetPlugin([icon], entryBudgetBytes)],
      build: { modulePreload: false },
    });
  }

  it('fails with the emitted entry filename and its budget', async () => {
    await expect(buildFixture(10)).rejects.toThrow(
      /Entry chunk assets\/index-[\w-]+\.js is \d+ bytes and exceeds the 10-byte budget/,
    );
  });

  it('accepts a precached icon at the Workbox limit', async () => {
    writeFileSync(join(root, 'public', icon), Buffer.alloc(PRECACHE_ASSET_LIMIT_BYTES));
    await expect(buildFixture()).resolves.toBeDefined();
  });

  it('fails when a manifest icon exceeds the Workbox limit', async () => {
    writeFileSync(join(root, 'public', icon), Buffer.alloc(PRECACHE_ASSET_LIMIT_BYTES + 1));
    await expect(buildFixture()).rejects.toThrow(
      `Precache asset ${icon} is ${PRECACHE_ASSET_LIMIT_BYTES + 1} bytes and exceeds the ${PRECACHE_ASSET_LIMIT_BYTES}-byte limit.`,
    );
  });
});
