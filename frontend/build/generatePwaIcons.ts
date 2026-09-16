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
 *   * `any` — the flat favicon mark (its own rounded-square background baked
 *     in) inset slightly so platforms that draw their own container do not
 *     clip it.
 *   * `maskable` — the motif alone (background chroma-keyed out in-browser
 *     via Canvas, see `extractMotif`), redrawn full-bleed on the mark's own
 *     background colour at a large scale. Android's adaptive-icon mask can
 *     crop a maskable icon down to a circle inscribed in the canvas — the
 *     scale is tuned so the motif fills that circle generously without any
 *     content (the barn roof peak, the leaf tips, the field lines) falling
 *     outside it. A naive "shrink the whole flat favicon onto a background"
 *     approach (the previous version of this script) produces a small
 *     rounded-square sticker floating in the middle of the canvas instead —
 *     technically inside the safe zone, but mostly empty margin.
 */

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import type { Page } from '@playwright/test';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(projectRoot, '..', 'public');
const iconsDir = path.join(publicDir, 'icons');

interface AnyIconVariant {
  filename: string;
  size: number;
  /** Fraction of the canvas the flat mark occupies. */
  scale: number;
}

const ANY_VARIANTS: readonly AnyIconVariant[] = [
  { filename: 'pwa-192x192.png', size: 192, scale: 0.92 },
  { filename: 'pwa-512x512.png', size: 512, scale: 0.92 },
];

const MASKABLE_FILENAME = 'pwa-maskable-512x512.png';
const MASKABLE_SIZE = 512;
// How much of the canvas's longer dimension the isolated motif's bounding
// box fills. Checked against both a full circular mask and a squircle mask
// with no clipping up to ~0.90; kept a margin below that for safety since a
// future edit to the mark could shift the balance.
const MASKABLE_MOTIF_SCALE = 0.85;

function buildAnyIconMarkup(source: string, variant: AnyIconVariant): string {
  return `<!doctype html>
<html>
  <body style="margin:0">
    <div style="
      width:${variant.size}px;
      height:${variant.size}px;
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

/**
 * Isolates the motif from the flat favicon and redraws it full-bleed on its
 * own background colour, in-browser via the Canvas 2D API.
 *
 * The flat favicon is a rounded square: a solid background colour, an
 * antialiased transparent corner cutout, and the white/light-green motif on
 * top. There is no separate "motif only" source asset, so this chroma-keys
 * the background out:
 *
 *   1. Sample the background colour from four points a small inset in from
 *      each edge, at the shape's own mid-lines — safely inside the flat
 *      fill and clear of both the rounded corners and the motif for any
 *      icon in this style.
 *   2. Find the motif's actual colours: the dominant colour clusters among
 *      pixels that are fully opaque and clearly far from the background
 *      colour, keeping only clusters holding at least 5% of the weight of
 *      the largest one (rejects the thin antialiased blend pixels along
 *      every edge, which would otherwise show up as a faint halo tracing
 *      the whole motif).
 *   3. Classify every fully-opaque pixel close to one of those motif colours
 *      as foreground (snapped to that exact colour, for crisp edges); every
 *      other pixel — background fill, the transparent corners, and the
 *      antialiased blend band along every edge — becomes transparent.
 *   4. Crop to the foreground's bounding box (ignoring isolated noise
 *      pixels, via a small neighbour-count filter) and return it alongside
 *      the sampled background colour.
 */
async function extractMotif(
  page: Page,
  source: string,
): Promise<{ dataUrl: string; width: number; height: number; background: string }> {
  return page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();

    const { naturalWidth: w, naturalHeight: h } = img;
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = w;
    srcCanvas.height = h;
    const srcCtx = srcCanvas.getContext('2d')!;
    srcCtx.drawImage(img, 0, 0);
    const { data } = srcCtx.getImageData(0, 0, w, h);

    function pixelAt(x: number, y: number): [number, number, number, number] {
      const i = (y * w + x) * 4;
      return [data[i], data[i + 1], data[i + 2], data[i + 3]];
    }

    function dist2(a: readonly number[], b: readonly number[]): number {
      return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
    }

    // 1. Background colour, averaged from four edge-midline samples.
    const insetX = Math.round(w * 0.02);
    const insetY = Math.round(h * 0.02);
    const edgeSamples = [
      pixelAt(insetX, Math.floor(h / 2)),
      pixelAt(w - 1 - insetX, Math.floor(h / 2)),
      pixelAt(Math.floor(w / 2), insetY),
      pixelAt(Math.floor(w / 2), h - 1 - insetY),
    ].filter((p) => p[3] >= 250);
    const background = [0, 1, 2].map(
      (i) => edgeSamples.reduce((sum, p) => sum + p[i], 0) / edgeSamples.length,
    );

    // 2. Dominant foreground colour clusters.
    const STRICT_FG_DIST2 = 100 * 100;
    const clusterWeights = new Map<string, number>();
    const clusterReps = new Map<string, { color: [number, number, number]; weight: number }>();
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const [r, g, b, a] = pixelAt(x, y);
        if (a < 250 || dist2([r, g, b], background) <= STRICT_FG_DIST2) continue;
        const key = `${r >> 4},${g >> 4},${b >> 4}`;
        const nextWeight = (clusterWeights.get(key) ?? 0) + 1;
        clusterWeights.set(key, nextWeight);
        const rep = clusterReps.get(key);
        if (!rep || nextWeight > rep.weight) {
          clusterReps.set(key, { color: [r, g, b], weight: nextWeight });
        }
      }
    }
    const ranked = [...clusterWeights.entries()].sort((a, b) => b[1] - a[1]);
    const topWeight = ranked[0]?.[1] ?? 0;
    const fgRefs: [number, number, number][] = [];
    for (const [key, weight] of ranked) {
      if (weight < topWeight * 0.05) continue;
      const rep = clusterReps.get(key)!.color;
      if (fgRefs.some((existing) => dist2(rep, existing) < 30 * 30)) continue;
      fgRefs.push(rep);
    }

    // 3. Classify every pixel against the discovered foreground colours.
    const TOL2 = 40 * 40;
    const outCanvas = document.createElement('canvas');
    outCanvas.width = w;
    outCanvas.height = h;
    const outCtx = outCanvas.getContext('2d')!;
    const outData = outCtx.createImageData(w, h);
    const keep = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [r, g, b, a] = pixelAt(x, y);
        const i = (y * w + x) * 4;
        if (a < 150) continue;
        let best = fgRefs[0];
        let bestDist = Infinity;
        for (const ref of fgRefs) {
          const d = dist2([r, g, b], ref);
          if (d < bestDist) {
            bestDist = d;
            best = ref;
          }
        }
        if (bestDist < TOL2) {
          outData.data[i] = best[0];
          outData.data[i + 1] = best[1];
          outData.data[i + 2] = best[2];
          outData.data[i + 3] = 255;
          keep[y * w + x] = 1;
        }
      }
    }
    outCtx.putImageData(outData, 0, 0);

    // Soften the hard-classified edges slightly.
    outCtx.filter = 'blur(0.6px)';
    outCtx.drawImage(outCanvas, 0, 0);
    outCtx.filter = 'none';

    // 4. Bounding box, ignoring isolated noise pixels.
    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!keep[y * w + x]) continue;
        let neighbours = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < w && ny < h && keep[ny * w + nx]) neighbours++;
          }
        }
        if (neighbours < 8) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    const cropWidth = maxX - minX;
    const cropHeight = maxY - minY;
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = cropWidth;
    cropCanvas.height = cropHeight;
    cropCanvas.getContext('2d')!.drawImage(outCanvas, minX, minY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

    const toHex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
    return {
      dataUrl: cropCanvas.toDataURL('image/png'),
      width: cropWidth,
      height: cropHeight,
      background: `#${toHex(background[0])}${toHex(background[1])}${toHex(background[2])}`,
    };
  }, source);
}

async function composeMaskableIcon(
  page: Page,
  motif: { dataUrl: string; width: number; height: number; background: string },
): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    async ({ motif, canvasSize, motifScale }) => {
      const img = new Image();
      img.src = motif.dataUrl;
      await img.decode();

      const canvas = document.createElement('canvas');
      canvas.width = canvasSize;
      canvas.height = canvasSize;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = motif.background;
      ctx.fillRect(0, 0, canvasSize, canvasSize);

      const scale = (canvasSize * motifScale) / Math.max(motif.width, motif.height);
      const drawWidth = motif.width * scale;
      const drawHeight = motif.height * scale;
      ctx.drawImage(
        img,
        (canvasSize - drawWidth) / 2,
        (canvasSize - drawHeight) / 2,
        drawWidth,
        drawHeight,
      );

      return canvas.toDataURL('image/png');
    },
    { motif, canvasSize: MASKABLE_SIZE, motifScale: MASKABLE_MOTIF_SCALE },
  );

  return Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
}

async function main(): Promise<void> {
  const favicon = await readFile(path.join(publicDir, 'favicon.png'));
  const source = `data:image/png;base64,${favicon.toString('base64')}`;

  await mkdir(iconsDir, { recursive: true });

  // Same "chrome" channel binary build/prerender.ts and the e2e workflow use,
  // rather than the separately downloaded bundled Chromium.
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    for (const variant of ANY_VARIANTS) {
      const page = await browser.newPage({
        viewport: { width: variant.size, height: variant.size },
        deviceScaleFactor: 1,
      });
      await page.setContent(buildAnyIconMarkup(source, variant), { waitUntil: 'load' });
      const png = await page.screenshot({ omitBackground: true });
      await writeFile(path.join(iconsDir, variant.filename), png);
      await page.close();
      console.log(`Wrote icons/${variant.filename} (${variant.size}x${variant.size})`);
    }

    const page = await browser.newPage();
    const motif = await extractMotif(page, source);
    const maskablePng = await composeMaskableIcon(page, motif);
    await writeFile(path.join(iconsDir, MASKABLE_FILENAME), maskablePng);
    await page.close();
    console.log(
      `Wrote icons/${MASKABLE_FILENAME} (${MASKABLE_SIZE}x${MASKABLE_SIZE}, `
      + `motif ${motif.width}x${motif.height} on ${motif.background})`,
    );
  } finally {
    await browser.close();
  }
}

await main();
