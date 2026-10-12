import { expect, test as base, type Locator, type Page, type TestInfo } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject } from '../e2e/utils';

// Every page sees the same "today": mid-May of the demo project's current
// 2026 season, so season defaults, today markers and relative dates render
// identically on every run. Timers keep running (setFixedTime, not install),
// so debounces, transitions and polling behave like in a real browser.
export const FIXED_NOW = new Date('2026-05-15T10:00:00+02:00');

// Sub-pixel rounding differs between engines; anything larger is a real overflow.
export const LAYOUT_TOLERANCE_PX = 1;

export const test = base.extend<{ fixedClock: void }>({
  fixedClock: [async ({ page }, provide) => {
    await page.clock.setFixedTime(FIXED_NOW);
    await provide();
  }, { auto: true }],
});

export { expect };

export function isMobileProject(testInfo: TestInfo): boolean {
  return testInfo.project.name.startsWith('mobile-');
}

export function scenarioId(testInfo: TestInfo): string {
  const slug = testInfo.titlePath.slice(1).join('-').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `xb-${testInfo.project.name}-${slug}`.slice(0, 90);
}

/**
 * Logs in as the admin of a freshly seeded demo project (three seasons, crops
 * with varieties, planting plans) and waits until the app has finished
 * bootstrapping: project and season resolved and persisted, no requests in
 * flight.
 */
export async function loginToDemoProject(page: Page, testInfo: TestInfo): Promise<void> {
  await loginWithDeterministicProject(page, page.request, scenarioId(testInfo), {
    demoProject: true,
    loginAsAdmin: true,
    // The demo seeds its seasons relative to the server date; pin them to the
    // browser's fixed clock so screenshots stay stable across years.
    demoYear: FIXED_NOW.getFullYear(),
  });
  await page.waitForURL(/\/app\/dashboard/);
  await expect.poll(() => page.evaluate(
    () => Object.keys(window.localStorage).some((key) => key.startsWith('activeSeasonId:')),
  )).toBe(true);
  await page.waitForLoadState('networkidle');
}

/** Navigates to an app page and waits for its topbar heading and for the network to settle. */
export async function gotoAppPage(page: Page, path: string, heading: string): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole('banner').getByRole('heading', { name: heading, level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
}

/** Topbar elements whose content is not part of the layout under test. */
export function dynamicContentMasks(page: Page): Locator[] {
  return [page.getByRole('button', { name: 'Benachrichtigungen' })];
}

export async function expectNoHorizontalPageOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.document, 'document scrolls horizontally').toBeLessThanOrEqual(LAYOUT_TOLERANCE_PX);
  expect(overflow.body, 'body scrolls horizontally').toBeLessThanOrEqual(LAYOUT_TOLERANCE_PX);
}

/** Catches date and number formatting that broke in one engine (e.g. Safari's stricter Date parsing). */
export async function expectNoBrokenValues(page: Page): Promise<void> {
  const text = await page.locator('body').innerText();
  expect(text).not.toContain('Invalid Date');
  expect(text).not.toMatch(/\bNaN\b/);
  expect(text).not.toContain('undefined');
}

export async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  expect(box, 'element has no bounding box (not rendered)').not.toBeNull();
  return box!;
}

/** Asserts that the box lies inside the viewport. */
export async function expectWithinViewport(page: Page, locator: Locator, label: string): Promise<void> {
  const box = await boxOf(locator);
  const viewport = page.viewportSize()!;
  expect(box.x, `${label} starts left of the viewport`).toBeGreaterThanOrEqual(-LAYOUT_TOLERANCE_PX);
  expect(box.y, `${label} starts above the viewport`).toBeGreaterThanOrEqual(-LAYOUT_TOLERANCE_PX);
  expect(box.x + box.width, `${label} ends right of the viewport`).toBeLessThanOrEqual(viewport.width + LAYOUT_TOLERANCE_PX);
  expect(box.y + box.height, `${label} ends below the viewport`).toBeLessThanOrEqual(viewport.height + LAYOUT_TOLERANCE_PX);
}

type ListResponse<T> = T[] | { results: T[] };

async function listAll<T>(page: Page, path: string): Promise<T[]> {
  const response = await apiRequest<ListResponse<T>>(page, 'GET', path);
  return Array.isArray(response) ? response : response.results;
}

export interface CropSummary {
  id: number;
  name: string;
  variety: string | null;
}

export async function findCrop(page: Page, name: string, variety: string | null): Promise<CropSummary> {
  const crops = await listAll<CropSummary>(page, '/crops/?page_size=500');
  const crop = crops.find((candidate) => candidate.name === name && (candidate.variety || null) === variety);
  expect(crop, `demo crop ${name} / ${variety ?? '-'} not found`).toBeTruthy();
  return crop!;
}

export interface PlantingPlanSummary {
  id: number;
  planting_date: string;
}

export async function findPlantingPlan(page: Page, plantingDate: string): Promise<PlantingPlanSummary> {
  const plans = await listAll<PlantingPlanSummary>(page, '/planting-plans/?page_size=500');
  const matches = plans.filter((plan) => plan.planting_date === plantingDate);
  expect(matches, `expected exactly one demo plan planted on ${plantingDate}`).toHaveLength(1);
  return matches[0];
}

export async function getPlantingPlan(page: Page, id: number): Promise<PlantingPlanSummary> {
  return apiRequest<PlantingPlanSummary>(page, 'GET', `/planting-plans/${id}/`);
}

/** Opens "Kultur bearbeiten" / "Sorte bearbeiten" from the crop's detail page and returns the dialog. */
export async function openCropEditDialog(page: Page, cropId: number): Promise<Locator> {
  await gotoAppPage(page, `/app/crops?cropId=${cropId}`, 'Kulturen');
  await page.getByTestId('crop-detail-header').getByRole('button', { name: 'Bearbeiten' }).click();
  const dialog = page.getByRole('dialog').filter({ has: page.locator('#crop-form-dialog-title') });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#crop-form-dialog-title')).toHaveText(/(Kultur|Sorte) bearbeiten/);
  // The open transition and the async species/variety lookups settle the layout.
  await page.waitForLoadState('networkidle');
  return dialog;
}
