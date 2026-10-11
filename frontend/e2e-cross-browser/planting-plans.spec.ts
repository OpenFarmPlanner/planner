import {
  boxOf,
  dynamicContentMasks,
  expect,
  expectNoBrokenValues,
  expectNoHorizontalPageOverflow,
  gotoAppPage,
  isMobileProject,
  LAYOUT_TOLERANCE_PX,
  loginToDemoProject,
  test,
} from './fixtures';

// The demo project's 2026 season holds twelve planting plans.
const CURRENT_SEASON_PLAN_COUNT = 12;

test.describe('Anbaupläne table', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await loginToDemoProject(page, testInfo);
    await gotoAppPage(page, '/app/planting-plans', 'Anbaupläne');
  });

  test('renders the season\'s plans without horizontal page overflow', async ({ page }, testInfo) => {
    await expect(page.getByRole('status').filter({ hasText: 'Anbaupläne' }))
      .toHaveText(`${CURRENT_SEASON_PLAN_COUNT} Anbaupläne`);

    if (isMobileProject(testInfo)) {
      // Phones get one card per plan instead of the grid.
      await expect(page.getByRole('button', { name: 'Details anzeigen' })).toHaveCount(CURRENT_SEASON_PLAN_COUNT);
    } else {
      const rows = page.locator('[role="row"][data-id]');
      await expect(rows.first()).toBeVisible();
      await expect(rows).toHaveCount(CURRENT_SEASON_PLAN_COUNT);
    }

    await expectNoHorizontalPageOverflow(page);
    await expectNoBrokenValues(page);
  });

  test('keeps the column headers visible while the grid scrolls', async ({ page }, testInfo) => {
    test.skip(isMobileProject(testInfo), 'Phones render plan cards without a grid header.');
    // All twelve plans fit the desktop viewport; a shorter window makes the
    // grid's own body scroll.
    const viewport = page.viewportSize()!;
    await page.setViewportSize({ width: viewport.width, height: 480 });

    const header = page.getByRole('columnheader', { name: 'Kultur (Sorte)' });
    await expect(header).toBeVisible();
    const before = await boxOf(header);

    const scroller = page.locator('.MuiDataGrid-virtualScroller');
    const scrolled = await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      return element.scrollTop;
    });
    expect(scrolled, 'the grid has nothing to scroll at this viewport').toBeGreaterThan(0);
    // The last plan must now be on screen, proving the grid itself scrolled.
    await expect(page.locator('[role="row"][data-id]').last()).toBeInViewport();

    await expect(header).toBeInViewport();
    const after = await boxOf(header);
    expect(Math.abs(after.y - before.y), 'column header moved with the rows').toBeLessThanOrEqual(LAYOUT_TOLERANCE_PX);
  });

  test('matches the per-browser screenshot', async ({ page }) => {
    await page.mouse.move(0, 0);
    await expect(page).toHaveScreenshot('planting-plans.png', { mask: dynamicContentMasks(page) });
  });
});
