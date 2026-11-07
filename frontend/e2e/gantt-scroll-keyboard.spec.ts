import { expect, test, type Page } from '@playwright/test';
import { loginWithDeterministicProject } from './utils';

// #906: the arrow keys round-tripped scroll → date → next date → scroll and
// fell back into the same period (every other press barely moved, the end of
// the range was out of reach), and the windowed rows were pinned to the scroll
// position (content froze, then jumped; the last row stayed cut off).

const timelineScrollLeft = (page: Page): Promise<number> => page.evaluate(
  () => (document.querySelector('[data-testid="gantt-virtual-viewport"] .rmg-container') as HTMLElement).scrollLeft,
);

async function openCalendar(page: Page, viewShortcut: string): Promise<void> {
  await page.goto('/app/gantt-chart?view=field');
  const viewport = page.getByTestId('gantt-virtual-viewport');
  await expect(viewport.locator('.rmg-container')).toBeVisible();
  await page.locator('h1').first().click();
  await page.keyboard.press(viewShortcut);
  await page.waitForLoadState('networkidle');
}

async function scrollTimelineTo(page: Page, left: number): Promise<void> {
  await page.evaluate((target) => {
    const container = document.querySelector('[data-testid="gantt-virtual-viewport"] .rmg-container') as HTMLElement;
    container.style.scrollBehavior = 'auto';
    container.scrollLeft = target;
    container.style.scrollBehavior = '';
  }, left);
  await expect.poll(() => timelineScrollLeft(page)).toBe(left);
}

test.beforeEach(async ({ page, request }, testInfo) => {
  await loginWithDeterministicProject(page, request, `gantt-scroll-keyboard-${testInfo.workerIndex}`, {
    demoProject: true, loginAsAdmin: true,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
});

test('every arrow press moves the month view by one month and reaches the end of the range', async ({ page }) => {
  await openCalendar(page, '3');
  await scrollTimelineTo(page, 0);
  for (const expected of [150, 300, 450]) {
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => timelineScrollLeft(page)).toBe(expected);
  }
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => timelineScrollLeft(page)).toBe(300);
  const max = await page.evaluate(() => {
    const container = document.querySelector('[data-testid="gantt-virtual-viewport"] .rmg-container') as HTMLElement;
    return container.scrollWidth - container.clientWidth;
  });
  for (let press = 0; press < 20; press += 1) await page.keyboard.press('ArrowRight');
  await expect.poll(() => timelineScrollLeft(page)).toBe(max);
});

test('the right arrow moves the day view forward one day per press', async ({ page }) => {
  await openCalendar(page, '1');
  await scrollTimelineTo(page, 5000);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => timelineScrollLeft(page)).toBe(5050);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => timelineScrollLeft(page)).toBe(5100);
});

test('rows scroll with the viewport and the last row can be reached', async ({ page }) => {
  await openCalendar(page, '3');
  const viewport = page.getByTestId('gantt-virtual-viewport');
  const rowTop = async (name: string): Promise<number> => (await viewport.getByText(name, { exact: true }).first().boundingBox())!.y;

  const before = await rowTop('Kohlquartier');
  await viewport.evaluate((element) => { element.scrollTop = 120; });
  await expect.poll(() => rowTop('Kohlquartier')).toBe(before - 120);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await viewport.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await page.waitForTimeout(200);
  }
  const viewportBox = (await viewport.boundingBox())!;
  const lastRow = (await viewport.getByText('Zuckermais', { exact: true }).last().boundingBox())!;
  expect(lastRow.y + lastRow.height).toBeLessThanOrEqual(viewportBox.y + viewportBox.height);
});
