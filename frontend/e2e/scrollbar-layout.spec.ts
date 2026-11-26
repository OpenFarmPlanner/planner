import { expect, test, type Locator, type Page } from '@playwright/test';
import { apiRequest, expectNoHorizontalPageOverflow, loginWithDeterministicProject, waitForPageStable } from './utils';

/**
 * Guards the interaction between MUI's modal scroll lock and the page's own
 * overflow rules. When a `Menu`/`Popover`/`Dialog` opens, MUI hides the page
 * scrollbar and compensates its width with `padding-right` on `<body>`. That
 * only nets out when `<body>` really is the element whose overflow the viewport
 * uses — an `overflow-x` on `<html>` silently breaks it, and the page then
 * shrinks by the scrollbar width on every menu open.
 *
 * Functional/geometric assertions rather than screenshots: what matters is that
 * boxes keep their exact coordinates, which a pixel diff would only cover
 * indirectly while needing a re-baseline for every unrelated visual tweak.
 *
 * Runs in the `chromium-scrollbars` project, which keeps the classic scrollbar
 * that the default headless run hides — without it there is no scrollbar to
 * compensate and the regression is invisible. See playwright.config.ts. The
 * same holds for the data-grid checks below, which depend on a real scrollbar
 * size.
 */

const AUTH_ROUTES = [
  { key: 'login', path: '/login', heading: /Anmelden/i },
  { key: 'register', path: '/register', heading: /Registrieren|Konto erstellen/i },
];

// Deliberately short: every page under test has to overflow vertically, or
// there is no scrollbar for the scroll lock to compensate.
const VIEWPORT = { width: 1280, height: 600 };

function languageButton(page: Page): Locator {
  return page.getByRole('button', { name: /Sprache|language/i }).first();
}

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  expect(value).not.toBeNull();
  return value!;
}

async function pageMetrics(page: Page) {
  return page.evaluate(() => ({
    innerWidth: window.innerWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyPaddingRight: getComputedStyle(document.body).paddingRight,
  }));
}

test.describe('scroll lock does not reshape the page', () => {
  test('the test environment actually renders a classic scrollbar', async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await page.goto('/register');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const metrics = await pageMetrics(page);
    // Without this the remaining assertions would pass vacuously.
    expect(metrics.innerWidth - metrics.clientWidth).toBeGreaterThan(0);
  });

  for (const route of AUTH_ROUTES) {
    test(`keeps the ${route.key} card and hero backdrop in place while the language menu is open`, async ({
      page,
    }) => {
      await page.setViewportSize(VIEWPORT);
      await page.goto(route.path);
      await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible();

      // CSS rather than a role query: an open Modal marks the whole app root
      // `aria-hidden`, so role-based locators stop resolving inside it exactly
      // when this test needs to measure.
      const card = page.locator('.MuiPaper-root:has(h1)').first();
      const before = await box(card);

      await languageButton(page).click();
      await expect(page.getByRole('menuitemradio', { name: 'English' })).toBeVisible();

      // The scroll lock has to remove the scrollbar it compensates for,
      // otherwise the compensation padding is pure loss and shifts the page.
      const open = await pageMetrics(page);
      expect(open.innerWidth - open.clientWidth).toBe(0);

      // No layout shift: the card must not move by so much as a pixel.
      const during = await box(card);
      expect(Math.abs(during.x - before.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(during.width - before.width)).toBeLessThanOrEqual(1);

      // No bare strip: the dimming overlay has to reach the viewport edges,
      // exactly like the hero image it sits on.
      const overlay = await box(page.getByTestId('hero-image-overlay'));
      expect(overlay.x).toBeLessThanOrEqual(1);
      expect(Math.abs(overlay.x + overlay.width - open.innerWidth)).toBeLessThanOrEqual(1);

      await page.keyboard.press('Escape');
      await expect(page.getByRole('menuitemradio', { name: 'English' })).toHaveCount(0);

      const after = await box(card);
      expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1);
    });
  }

  test('keeps the landing page header in place while the language menu is open', async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await page.goto('/');
    // CSS rather than a role query: an open Menu marks the whole app root
    // `aria-hidden`, so role-based locators stop resolving inside it exactly
    // when this test needs to measure (see the auth-route case above).
    const logo = page.locator('header a[aria-label="Zum Seitenanfang"]');
    await expect(logo).toHaveText('OpenFarmPlanner');

    const before = await box(logo);

    await languageButton(page).click();
    await expect(page.getByRole('menuitemradio', { name: 'English' })).toBeVisible();

    const during = await box(logo);
    expect(Math.abs(during.x - before.x)).toBeLessThanOrEqual(1);
  });
});

test('fits the crop split view without document scrolling and keeps both panes scrollable', async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  await loginWithDeterministicProject(page, request, `crop-scroll-${testInfo.workerIndex}`);
  const imported = await apiRequest<{ created_count: number; errors: unknown[] }>(page, 'POST', '/crops/import/apply/', {
    items: Array.from({ length: 45 }, (_, index) => ({ name: `Scroll crop ${String(index).padStart(2, '0')}` })),
  });
  expect(imported.errors).toEqual([]);
  expect(imported.created_count).toBe(45);
  const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: 'Long scroll details',
    notes: Array.from({ length: 40 }, (_, index) => `Paragraph ${index}: synthetic notes for scrolling.`).join('\n\n'),
  });

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 900 },
    { width: 1440, height: 450 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`/app/crops?cropId=${crop.id}`);
    await waitForPageStable(page, /Kulturbibliothek/i);
    const list = page.getByRole('listbox', { name: 'Kulturen', exact: true });
    const details = page.getByTestId('crop-detail-header').locator('xpath=ancestor::div[contains(@class, "MuiCard-root")][1]');
    await expect(list.getByRole('option')).toHaveCount(46);
    await expect(details.getByText('Paragraph 39:', { exact: false })).toHaveCount(1);

    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => window.innerWidth - document.documentElement.clientWidth)).toBe(0);
    for (const pane of [list, details]) {
      const otherPane = pane === list ? details : list;
      const otherScrollTop = await otherPane.evaluate(element => element.scrollTop);
      expect(await pane.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(100);
      await pane.hover();
      await page.mouse.wheel(0, 400);
      await expect.poll(() => pane.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      expect(await otherPane.evaluate(element => element.scrollTop)).toBe(otherScrollTop);
    }
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await details.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(details.getByRole('heading', { name: 'Lieferantendaten', exact: true })).toBeInViewport();
    const screenshot = testInfo.outputPath(`crop-scroll-${viewport.width}-${viewport.height}.png`);
    await page.screenshot({ path: screenshot, animations: 'disabled' });
    await testInfo.attach(`crop-scroll-${viewport.width}-${viewport.height}`, { path: screenshot, contentType: 'image/png' });
  }

  for (const viewport of [
    { width: 1440, height: 900, fontSize: '200%' },
    { width: 1440, height: 300, fontSize: '100%' },
    { width: 375, height: 800, fontSize: '100%' },
    { width: 800, height: 375, fontSize: '100%' },
    // A 200% browser zoom leaves this CSS viewport on a 1440x900 display.
    { width: 720, height: 450, fontSize: '100%' },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.evaluate(fontSize => { document.documentElement.style.fontSize = fontSize; }, viewport.fontSize);
    const header = page.getByTestId('crop-detail-header');
    await header.getByRole('button', { name: 'Bearbeiten', exact: true }).scrollIntoViewIfNeeded();
    await expect(header.getByRole('button', { name: 'Bearbeiten', exact: true })).toBeInViewport();
    const lastSection = page.getByRole('heading', { name: 'Lieferantendaten', exact: true });
    await lastSection.scrollIntoViewIfNeeded();
    await expect(lastSection).toBeInViewport();
    const screenshot = testInfo.outputPath(`crop-scroll-${viewport.width}-${viewport.height}-${viewport.fontSize}.png`);
    await page.screenshot({ path: screenshot, animations: 'disabled' });
    await testInfo.attach(`crop-scroll-${viewport.width}-${viewport.height}-${viewport.fontSize}`, { path: screenshot, contentType: 'image/png' });
  }

  // Return from a scrolled mobile/short view without reloading: document scroll
  // must not get added to the desktop height calculation.
  await page.setViewportSize({ width: 1440, height: 1600 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(1);
  const sparse = await apiRequest<{ id: number }>(page, 'POST', '/crops/', { name: 'Short details' });
  await page.goto(`/app/crops?cropId=${sparse.id}`);
  const details = page.getByTestId('crop-detail-header').locator('xpath=ancestor::div[contains(@class, "MuiCard-root")][1]');
  await expect(details.getByRole('heading', { name: 'Lieferantendaten', exact: true })).toBeVisible();
  expect(await details.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
});

// The growing-areas list hides MUI's vertical scrollbar for its own track. Hidden
// with display: none, MUI measured a 0px scrollbar and reserved no room for the
// horizontal one, which then covered the last row once the columns overflowed.
for (const bedCount of [4, 30]) {
  test(`keeps the last growing-area row above the horizontal scrollbar (${bedCount} beds)`, async ({ page, request }) => {
    await page.setViewportSize({ width: 1350, height: 810 });
    await loginWithDeterministicProject(page, request, `scrollbar-hierarchy-last-row-${bedCount}`, { loginAsAdmin: true });
    const location = await apiRequest<{ id: number }>(page, 'POST', '/locations/', { name: 'Acker' });
    const field = await apiRequest<{ id: number }>(page, 'POST', '/fields/', {
      name: 'Feld', location: location.id, length_m: 100, width_m: 50,
    });
    for (let index = 1; index <= bedCount; index += 1) {
      await apiRequest(page, 'POST', '/beds/', { name: `Beet ${index}`, field: field.id, length_m: 2, width_m: 1 });
    }
    await page.goto('/app/fields-beds');
    await expect(page.getByText('Beet 1', { exact: true })).toBeVisible();

    // The optional site-condition columns make the columns wider than the table.
    const toolbar = page.getByTestId('growing-area-search-toolbar');
    await toolbar.getByRole('button', { name: 'Spalten' }).click();
    for (const column of ['Licht', 'Feuchtigkeit', 'Bewässerung verfügbar']) {
      await page.getByRole('checkbox', { name: column }).check();
    }
    await page.keyboard.press('Escape');

    const scroller = page.locator('.MuiDataGrid-virtualScroller');
    await expect.poll(() => scroller.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await scroller.evaluate((element) => { element.scrollTop = element.scrollHeight; });

    await expect.poll(() => page.evaluate(() => {
      const scrollbar = document.querySelector('.MuiDataGrid-scrollbar--horizontal');
      const rowBottoms = Array.from(document.querySelectorAll('[role="row"][data-id]'))
        .map((row) => row.getBoundingClientRect().bottom);
      if (!scrollbar || rowBottoms.length === 0) return Number.NaN;
      return Math.round(Math.max(...rowBottoms) - scrollbar.getBoundingClientRect().top);
    })).toBeLessThanOrEqual(0);
  });
}

test('growing-area columns fit when there is room and preserve a manual width', async ({ page, request }) => {
  await page.setViewportSize({ width: 1585, height: 900 });
  await loginWithDeterministicProject(page, request, 'scrollbar-hierarchy-column-fit', {
    loginAsAdmin: true, demoProject: true, demoYear: 2026,
  });
  await page.goto('/app/fields-beds');
  const grid = page.getByRole('grid');
  const toolbar = page.getByTestId('growing-area-search-toolbar');
  const horizontal = grid.locator('.MuiDataGrid-scrollbar--horizontal');
  const header = (field: string) => grid.locator(`[role="columnheader"][data-field="${field}"]`);
  const setSiteColumns = async (visible: boolean) => {
    await toolbar.getByRole('button', { name: 'Spalten' }).click();
    for (const name of ['Licht', 'Feuchtigkeit', 'Bewässerung verfügbar']) {
      await page.getByRole('checkbox', { name, exact: true }).setChecked(visible);
    }
    await toolbar.getByRole('searchbox').click();
    await expect(page.getByRole('checkbox', { name: 'Licht', exact: true })).toBeHidden();
  };

  await expect(grid.getByText('Gründüngung Reserve', { exact: true })).toBeVisible();
  await expect(horizontal).toBeHidden();
  await setSiteColumns(true);
  await expect(header('irrigation')).toBeVisible();
  await expect(horizontal).toBeHidden();
  const irrigationLabel = header('irrigation').locator('.MuiDataGrid-columnHeaderTitle');
  await expect.poll(() => irrigationLabel.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 1350, height: 900 });
  await expect(horizontal).toBeVisible();
  const scroller = grid.locator('.MuiDataGrid-virtualScroller');
  await scroller.evaluate(el => { el.scrollLeft = el.scrollWidth; });
  await expect.poll(() => scroller.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  const note = grid.locator('[role="row"][data-id] [data-field="notes"]').first();
  await expect.poll(async () => Math.abs((await box(header('notes'))).x - (await box(note)).x)).toBeLessThanOrEqual(1);
  await expectNoHorizontalPageOverflow(page);
  await setSiteColumns(false);
  await expect(header('irrigation')).toHaveCount(0);
  await expect(horizontal).toBeHidden();
  await setSiteColumns(true);
  await expect(horizontal).toBeVisible();
  await page.setViewportSize({ width: 1585, height: 900 });
  await expect(horizontal).toBeHidden();

  const nameHeader = header('name');
  const before = (await box(nameHeader)).width;
  const grip = await box(nameHeader.locator('.MuiDataGrid-columnSeparator--resizable'));
  const x = grip.x + grip.width / 2;
  const y = grip.y + grip.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 430, y, { steps: 8 });
  await page.mouse.up();
  // An oversized drag stops at the desktop column limit. It must still
  // exceed the narrow viewport limit so the next resize exercises clamping.
  await expect.poll(async () => (await box(nameHeader)).width).toBeGreaterThanOrEqual(Math.min(720, before + 430) - 1);
  await expect.poll(async () => (await box(nameHeader)).width).toBeGreaterThan(680);
  const manualWidth = (await box(nameHeader)).width;
  await expect(horizontal).toBeVisible();
  await nameHeader.getByRole('button', { name: 'Eine Hierarchieebene ausblenden' }).click();
  await expect(grid.getByText('Gründüngung Reserve', { exact: true })).toHaveCount(0);
  await nameHeader.getByRole('button', { name: 'Eine Hierarchieebene mehr anzeigen' }).click();
  await expect(grid.getByText('Gründüngung Reserve', { exact: true })).toBeVisible();
  await expect.poll(async () => Math.abs((await box(nameHeader)).width - manualWidth)).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 768, height: 900 });
  await expect.poll(async () => (await box(nameHeader)).width).toBeLessThanOrEqual(680);
  const bedRow = grid.getByRole('row').filter({ hasText: 'Gründüngung Reserve' });
  const rowActions = bedRow.getByRole('button', { name: 'Aktionen', exact: true });
  await expect.poll(async () => {
    const actionBox = await box(rowActions);
    const gridBox = await box(grid);
    return actionBox.x + actionBox.width - (gridBox.x + gridBox.width);
  }).toBeLessThanOrEqual(0);
  await rowActions.click();
  const bedDetails = page.getByRole('menuitem', { name: 'Beetdetails', exact: true });
  await expect(bedDetails).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bedDetails).toBeHidden();

  await page.setViewportSize({ width: 1800, height: 900 });
  await expect.poll(async () => Math.abs((await box(nameHeader)).width - manualWidth)).toBeLessThanOrEqual(1);
  await expect(horizontal).toBeVisible();
  await setSiteColumns(false);
  await expect(horizontal).toBeHidden();
  await expect.poll(async () => Math.abs((await box(nameHeader)).width - manualWidth)).toBeLessThanOrEqual(1);
  await expectNoHorizontalPageOverflow(page);
});
