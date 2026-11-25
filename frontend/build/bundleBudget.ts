import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

export const ENTRY_CHUNK_BUDGET_BYTES = 1_500_000;
export const PRECACHE_ASSET_LIMIT_BYTES = 2 * 1024 * 1024;

export function bundleBudgetPlugin(
  precachedManifestFiles: readonly string[],
  entryBudgetBytes = ENTRY_CHUNK_BUDGET_BYTES,
): Plugin {
  return {
    name: 'openfarmplanner-bundle-budget',
    apply: 'build',
    writeBundle({ dir }, bundle) {
      if (!dir) this.error('Bundle size checks require a build output directory.');

      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk' || !output.isEntry) continue;
        const size = statSync(resolve(dir, output.fileName)).size;
        if (size > entryBudgetBytes) {
          this.error(`Entry chunk ${output.fileName} is ${size} bytes and exceeds the ${entryBudgetBytes}-byte budget.`);
        }
      }

      // Workbox limits files matched by its globs. The PWA plugin adds the
      // web manifest and its icons separately as additional manifest entries.
      for (const fileName of precachedManifestFiles) {
        const size = statSync(resolve(dir, fileName), { throwIfNoEntry: false })?.size;
        if (size !== undefined && size > PRECACHE_ASSET_LIMIT_BYTES) {
          this.error(`Precache asset ${fileName} is ${size} bytes and exceeds the ${PRECACHE_ASSET_LIMIT_BYTES}-byte limit.`);
        }
      }
    },
  };
}
