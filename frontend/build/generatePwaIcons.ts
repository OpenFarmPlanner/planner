/**
 * Regenerates the PWA app icons in `public/icons/` from `public/favicon.png`.
 *
 * Run manually after the brand mark or the brand colours change:
 *
 *   node --experimental-strip-types build/generatePwaIcons.ts
 *
 * This is not wired into the build. The icons are committed assets, and a
 * build step that silently rewrote them would make an unreviewed brand change
 * ship unnoticed.
 *
 * Playwright (already a devDependency for the e2e tests and the prerender
 * step) does the rasterizing, so no image-processing dependency is added for
 * three files. Two variants are produced:
 *
 *   * `any` — the mark on a transparent ground, inset slightly so platforms
 *     that draw their own container do not clip it.
 *   * `maskable` — the mark at 60% of the canvas on the brand background, so
 *     it survives Android's adaptive-icon crop, which may keep as little as
 *     the centre 80% circle.
 */

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

import { BRAND_ROOT_BACKGROUND } from '../src/brandColors.ts';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(projectRoot, '..', 'public');
const iconsDir = path.join(publicDir, 'icons');

interface IconVariant {
  filename: string;
  size: number;
  /** Fraction of the canvas the mark occupies. */
  scale: number;
  background: string;
}

const VARIANTS: readonly IconVariant[] = [
  { filename: 'pwa-192x192.png', size: 192, scale: 0.92, background: 'transparent' },
  { filename: 'pwa-512x512.png', size: 512, scale: 0.92, background: 'transparent' },
  { filename: 'pwa-maskable-512x512.png', size: 512, scale: 0.6, background: BRAND_ROOT_BACKGROUND },
];

function buildMarkup(source: string, variant: IconVariant): string {
  return `<!doctype html>
<html>
  <body style="margin:0">
    <div style="
      width:${variant.size}px;
      height:${variant.size}px;
      background:${variant.background};
      display:flex;
      align-items:center;
      justify-content:center;
    ">
      <img src="${source}" style="
        max-width:${variant.scale * 100}%;
        max-height:${variant.scale * 100}%;
        object-fit:contain;
      " />
    </div>
  </body>
</html>`;
}

async function main(): Promise<void> {
  const favicon = await readFile(path.join(publicDir, 'favicon.png'));
  const source = `data:image/png;base64,${favicon.toString('base64')}`;

  await mkdir(iconsDir, { recursive: true });

  // Same "chrome" channel binary build/prerender.ts and the e2e workflow use,
  // rather than the separately downloaded bundled Chromium.
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    for (const variant of VARIANTS) {
      const page = await browser.newPage({
        viewport: { width: variant.size, height: variant.size },
        deviceScaleFactor: 1,
      });
      await page.setContent(buildMarkup(source, variant), { waitUntil: 'load' });
      const png = await page.screenshot({ omitBackground: variant.background === 'transparent' });
      await writeFile(path.join(iconsDir, variant.filename), png);
      await page.close();
      console.log(`Wrote icons/${variant.filename} (${variant.size}x${variant.size})`);
    }
  } finally {
    await browser.close();
  }
}

await main();
