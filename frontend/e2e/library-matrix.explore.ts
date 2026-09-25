/**
 * Dev tool, not part of the CI suite: walks every seeded cell of the crop
 * library state matrix (docs/crop-library-state-matrix.md) on localhost and
 * reports console errors and failed requests per cell and viewport.
 *
 *   cd backend && DEBUG=True DJANGO_ENV=development pdm run runserver   # or daphne
 *   cd frontend && npm run dev -- --port 4173
 *   cd frontend && node --experimental-strip-types e2e/library-matrix.explore.ts
 *
 * Refuses any base URL that is not loopback. Reseeds the cells before each
 * viewport pass, so unlinking during the pass does not leak into the next one.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, type Page } from '@playwright/test';

const BASE_URL = process.env.EXPLORE_BASE_URL ?? 'http://127.0.0.1:4173';
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE_URL)) {
  throw new Error(`Refusing to explore non-local URL ${BASE_URL}`);
}
const VIEWPORTS = [
  { name: '375x800', width: 375, height: 800 },
  { name: '1440x900', width: 1440, height: 900 },
];

interface Cell {
  key: string;
  email: string;
  cropId: number;
  publicCropId: number | null;
  entryStatus: string | null;
}

interface Finding {
  cell: string;
  viewport: string;
  step: string;
  kind: 'console' | 'network' | 'pageerror';
  detail: string;
}

function seed(): { password: string; cells: Cell[] } {
  const output = execFileSync(
    'python', ['manage.py', 'seed_library_state_matrix', '--json'],
    { cwd: '../backend', env: { ...process.env, DEBUG: 'True', DJANGO_ENV: 'development' } },
  ).toString();
  return JSON.parse(output.trim().split('\n').pop() as string);
}

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await page.waitForURL(/\/app\//, { timeout: 20_000 });
}

async function selectCrop(page: Page, cropId: number): Promise<void> {
  await page.goto(`/app/crops?cropId=${cropId}`);
}

async function main(): Promise<void> {
  const findings: Finding[] = [];
  const visited: string[] = [];
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  for (const viewport of VIEWPORTS) {
    const { password, cells } = seed();
    for (const cell of cells) {
      const context = await browser.newContext({
        baseURL: BASE_URL, locale: 'de-DE', viewport: { width: viewport.width, height: viewport.height },
      });
      const page = await context.newPage();
      let step = 'login';
      let armed = false; // pre-login 401s (session probe, wrong-form loads) are expected
      const record = (kind: Finding['kind'], detail: string): void => {
        if (!armed) return;
        findings.push({ cell: cell.key, viewport: viewport.name, step, kind, detail });
      };
      page.on('console', (message) => {
        if (message.type() === 'error') record('console', message.text());
      });
      page.on('pageerror', (error) => record('pageerror', error.message));
      page.on('response', (response) => {
        if (response.status() >= 400 && response.url().includes('/api/')) {
          record('network', `${response.status()} ${response.request().method()} ${response.url()}`);
        }
      });
      try {
        await login(page, cell.email, password);
        armed = true;
        step = 'open crop';
        await selectCrop(page, cell.cropId);
        await page.waitForTimeout(800);

        step = 'library control';
        const control = page.locator(
          '[data-testid="crop-detail-publish-action"], [data-testid="crop-detail-library-status"]',
        ).first();
        if (await control.isVisible().catch(() => false)) {
          if (await control.isEnabled().catch(() => false)) {
            await control.click({ timeout: 3_000 }).catch(() => undefined);
            await page.waitForTimeout(800);
            await page.keyboard.press('Escape');
          }
        }

        step = 'overflow menu';
        const overflow = page.getByRole('button', { name: 'Weitere Aktionen' }).first();
        if (await overflow.isVisible().catch(() => false)) {
          await overflow.click();
          const unlink = page.getByRole('menuitem', { name: 'Verknüpfung aufheben' });
          if (await unlink.isVisible().catch(() => false)) {
            await unlink.click();
            step = 'unlink dialog';
            await page.waitForTimeout(500);
            if (viewport.name === '1440x900') {
              await page.getByRole('button', { name: 'Verknüpfung aufheben' }).last().click();
              await page.waitForTimeout(1_000);
            } else {
              await page.getByRole('button', { name: 'Abbrechen' }).click();
            }
          } else {
            await page.keyboard.press('Escape');
          }
        }

        if (cell.publicCropId !== null && cell.entryStatus === 'published') {
          step = 'library page';
          await page.goto(`/app/crop-library?cropId=${cell.publicCropId}`);
          await page.waitForTimeout(1_000);
        }
        visited.push(`${cell.key}@${viewport.name}`);
      } catch (error) {
        record('pageerror', `explore step failed: ${(error as Error).message}`);
      } finally {
        await context.close().catch(() => undefined);
      }
    }
  }
  await browser.close().catch(() => undefined);
  const summary = { visited: visited.length, errors: findings.length, findings };
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/library-matrix.json', JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ visited: visited.length, errors: findings.length }, null, 2));
  for (const finding of findings) {
    console.log(`${finding.cell} @ ${finding.viewport} [${finding.step}] ${finding.kind}: ${finding.detail}`);
  }
}

void main();
