import {
  boxOf,
  dynamicContentMasks,
  expect,
  expectNoBrokenValues,
  expectNoHorizontalPageOverflow,
  gotoAppPage,
  LAYOUT_TOLERANCE_PX,
  loginToDemoProject,
  test,
} from './fixtures';

// The Gantt view of the planting plans (Anbaukalender, bed occupancy).
test.describe('Anbaukalender (Gantt)', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await loginToDemoProject(page, testInfo);
    await gotoAppPage(page, '/app/gantt-chart', 'Anbaukalender');
  });

  test('renders bars inside the timeline with correct dates', async ({ page }) => {
    const bars = page.locator('[data-rmg-component="task"]');
    await expect(bars.first()).toBeVisible();
    expect(await bars.count()).toBeGreaterThan(5);

    const timeline = await boxOf(page.locator('[data-rmg-component="timeline-content"]').first());
    for (const bar of await bars.all()) {
      const box = await boxOf(bar);
      const label = (await bar.innerText()).trim() || 'bar';
      expect(box.width, `${label}: zero width`).toBeGreaterThan(0);
      expect(box.height, `${label}: zero height`).toBeGreaterThan(0);
      expect(box.x, `${label}: starts before the timeline`).toBeGreaterThanOrEqual(timeline.x - LAYOUT_TOLERANCE_PX);
      expect(box.x + box.width, `${label}: ends after the timeline`)
        .toBeLessThanOrEqual(timeline.x + timeline.width + LAYOUT_TOLERANCE_PX);
      expect(box.y, `${label}: above the timeline`).toBeGreaterThanOrEqual(timeline.y - LAYOUT_TOLERANCE_PX);
      expect(box.y + box.height, `${label}: below the timeline`)
        .toBeLessThanOrEqual(timeline.y + timeline.height + LAYOUT_TOLERANCE_PX);
    }

    // Date math cross-check: with the clock fixed on 15 May 2026, the today
    // marker must sit inside the "Mai 2026" column, roughly at its middle.
    const may = await boxOf(page.locator('[data-rmg-component="timeline-unit-higher"], [data-rmg-component="timeline-unit"]')
      .filter({ hasText: /^Mai 2026$/ }).first());
    const marker = await boxOf(page.getByTestId('today-marker'));
    const markerX = marker.x + marker.width / 2;
    const expectedX = may.x + may.width * (14.4 / 31);
    expect(Math.abs(markerX - expectedX), 'today marker is not on 15 May 2026').toBeLessThanOrEqual(may.width * 0.05);

    await expectNoHorizontalPageOverflow(page);
    await expectNoBrokenValues(page);
  });

  test('matches the per-browser screenshot', async ({ page }) => {
    await page.mouse.move(0, 0);
    await expect(page).toHaveScreenshot('gantt-chart.png', { mask: dynamicContentMasks(page) });
  });
});
