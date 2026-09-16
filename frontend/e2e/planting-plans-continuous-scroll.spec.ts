import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { loginWithDeterministicProject } from './utils';

const backendPort = process.env.BACKEND_PORT ?? '8000';
const apiBase = `http://127.0.0.1:${backendPort}/api`;

async function createPlantingPlanFixtures(
  page: Page,
  request: APIRequestContext,
  scenario: string,
  rowCount: number,
): Promise<void> {
  await loginWithDeterministicProject(page, request, scenario, { loginAsAdmin: true });

  const activeProjectId = await page.evaluate(() => window.localStorage.getItem('activeProjectId'));
  const projectId = Number(activeProjectId);
  const csrfToken = await page.evaluate(() =>
    document.cookie.split('; ').find((row) => row.startsWith('csrftoken='))?.split('=')[1] ?? '');

  const api = async <T,>(path: string, data: Record<string, unknown>): Promise<T> => {
    const response = await page.request.post(`${apiBase}${path}`, {
      headers: {
        'X-CSRFToken': csrfToken,
        'Content-Type': 'application/json',
        'X-Project-Id': String(projectId),
      },
      data: { ...data, project: projectId },
    });
    expect(response.ok(), `${path} -> ${response.status()}: ${await response.text()}`).toBeTruthy();
    return response.json() as Promise<T>;
  };

  const season = await api<{ id: number }>('/seasons/', { start_date: '2026-01-01', end_date: '2026-12-31' });
  const location = await api<{ id: number }>('/locations/', { name: 'Scrollhof' });
  const field = await api<{ id: number }>('/fields/', { name: 'Scrollfeld', location: location.id });
  const bed = await api<{ id: number }>('/beds/', { name: 'Scrollbeet', field: field.id, area_sqm: 10_000 });
  const crop = await api<{ id: number }>('/crops/', {
    name: 'Scrollkultur',
    variety: 'Sorte A',
    propagation_duration_days: 21,
    cultivation_type: 'pre_cultivation',
    cultivation_types: ['pre_cultivation'],
    plants_per_m2: 4,
  });

  const batchSize = 20;
  for (let batchStart = 0; batchStart < rowCount; batchStart += batchSize) {
    const batchEnd = Math.min(batchStart + batchSize, rowCount);
    await Promise.all(Array.from({ length: batchEnd - batchStart }, (_, offset) => {
      const index = batchStart + offset;
      const day = String((index % 28) + 1).padStart(2, '0');
      return api('/planting-plans/', {
        bed: bed.id,
        crop: crop.id,
        season: season.id,
        cultivation_type: 'pre_cultivation',
        planting_date: `2026-04-${day}`,
        harvest_date: `2026-05-${day}`,
        area_usage_sqm: 1,
      });
    }));
  }
}

async function getVirtualScrollerMetrics(page: Page, options: { attemptScroll?: boolean } = {}): Promise<{
  clientHeight: number;
  firstRenderedRowId: string | null;
  scrollHeight: number;
  scrollTopAfterScrollAttempt: number;
}> {
  const virtualScroller = page.locator('.MuiDataGrid-virtualScroller').first();
  await expect(virtualScroller).toBeVisible();

  return virtualScroller.evaluate(async (element, attemptScroll) => {
    if (attemptScroll) {
      element.scrollTop = 32;
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    }
    return {
      clientHeight: element.clientHeight,
      firstRenderedRowId: element.querySelector('[role="row"][data-id]')?.getAttribute('data-id') ?? null,
      scrollHeight: element.scrollHeight,
      scrollTopAfterScrollAttempt: element.scrollTop,
    };
  }, Boolean(options.attemptScroll));
}

async function getDesktopGridLayoutMetrics(page: Page): Promise<{
  footerContainerCount: number;
  gridLeft: number;
  gridWidth: number;
  hasVisibleMuiHorizontalScrollbar: boolean;
  notesHeaderWidth: number;
  outerScrollClientWidth: number;
  outerScrollWidth: number;
  viewportWidth: number;
}> {
  const grid = page.locator('.MuiDataGrid-root').first();
  await expect(grid).toBeVisible();

  return grid.evaluate((element) => {
    const gridRect = element.getBoundingClientRect();
    const notesHeader = Array.from(element.querySelectorAll<HTMLElement>('[role="columnheader"]'))
      .find((header) => header.textContent?.includes('Notizen'));
    const horizontalScrollbars = Array.from(element.querySelectorAll<HTMLElement>('.MuiDataGrid-scrollbar--horizontal'));
    const hasVisibleMuiHorizontalScrollbar = horizontalScrollbars.some((scrollbar) => {
      const styles = window.getComputedStyle(scrollbar);
      const rect = scrollbar.getBoundingClientRect();
      return styles.display !== 'none' && styles.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    });
    let outerScrollContainer: HTMLElement = element;
    let ancestor = element.parentElement;
    while (ancestor) {
      const overflowX = window.getComputedStyle(ancestor).overflowX;
      if (overflowX === 'auto' || overflowX === 'scroll') {
        outerScrollContainer = ancestor;
        break;
      }
      ancestor = ancestor.parentElement;
    }
    return {
      footerContainerCount: element.querySelectorAll('.MuiDataGrid-footerContainer').length,
      gridLeft: gridRect.left,
      gridWidth: gridRect.width,
      hasVisibleMuiHorizontalScrollbar,
      notesHeaderWidth: notesHeader?.getBoundingClientRect().width ?? 0,
      outerScrollClientWidth: outerScrollContainer.clientWidth,
      outerScrollWidth: outerScrollContainer.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });
}

test.describe('planting plans continuous scroll', () => {
  test('does not leave a vertical scroll range when all rows fit', async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await createPlantingPlanFixtures(page, request, 'planting-plans-short-scroll', 3);

    await page.goto('/app/planting-plans');
    await expect(page.getByText('Scrollkultur (Sorte A)').first()).toBeVisible({ timeout: 10_000 });

    const metrics = await getVirtualScrollerMetrics(page, { attemptScroll: true });
    expect(metrics.scrollHeight - metrics.clientHeight).toBeLessThanOrEqual(1);
    expect(metrics.scrollTopAfterScrollAttempt).toBe(0);
    await expect(page.getByTestId('continuous-scrollbar-thumb')).toHaveCount(0);
  });

  test('keeps the virtual scroller active when rows exceed the available height', async ({ page, request }) => {
    await page.setViewportSize({ width: 2048, height: 900 });
    await createPlantingPlanFixtures(page, request, 'planting-plans-long-scroll', 120);

    await page.goto('/app/planting-plans');
    await expect(page.getByText('Scrollkultur (Sorte A)').first()).toBeVisible({ timeout: 10_000 });
    await page.evaluate(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });

    const beforeScroll = await getVirtualScrollerMetrics(page);
    await expect(page.getByTestId('continuous-scrollbar-thumb')).toBeVisible();
    // On slower CI runners the DataGrid columns are not measured yet at this
    // point, so the notes column header briefly reports a width of 0. Wait for
    // the layout to settle before reading the metrics used by the assertions.
    await expect
      .poll(async () => (await getDesktopGridLayoutMetrics(page)).notesHeaderWidth)
      .toBeGreaterThan(0);
    const layout = await getDesktopGridLayoutMetrics(page);
    expect(layout.footerContainerCount).toBe(0);
    expect(layout.hasVisibleMuiHorizontalScrollbar).toBe(false);
    expect(layout.notesHeaderWidth).toBeGreaterThanOrEqual(56);
    expect(layout.notesHeaderWidth).toBeLessThanOrEqual(90);
    expect(layout.gridWidth).toBeLessThan(1400);
    expect(layout.gridLeft).toBeGreaterThan(350);

    // On a wide screen the table is narrower than its (centered) container,
    // so the scrollbar track must hug the table's own right edge — not the
    // container's — or it visibly floats off in the empty space beside the
    // table.
    const gridRight = layout.gridLeft + layout.gridWidth;
    const wideTrackBox = await page.getByTestId('continuous-scrollbar-track').boundingBox();
    expect(wideTrackBox).not.toBeNull();
    expect(wideTrackBox!.x + wideTrackBox!.width).toBeGreaterThan(gridRight - 5);
    expect(wideTrackBox!.x + wideTrackBox!.width).toBeLessThan(gridRight + 5);

    await page.setViewportSize({ width: 1000, height: 900 });
    const narrowLayout = await getDesktopGridLayoutMetrics(page);
    expect(narrowLayout.hasVisibleMuiHorizontalScrollbar).toBe(false);
    expect(narrowLayout.outerScrollWidth).toBeGreaterThan(narrowLayout.outerScrollClientWidth);

    await page.locator('.MuiDataGrid-virtualScroller').first().hover();
    await page.mouse.wheel(0, 1400);

    await expect.poll(async () => {
      const afterScroll = await getVirtualScrollerMetrics(page);
      return afterScroll.scrollTopAfterScrollAttempt;
    }).toBeGreaterThan(beforeScroll.scrollTopAfterScrollAttempt);
  });

  test('keeps the scrollbar thumb inside its track after scrolling to the last internal page', async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    // More than the 100-row internal page size, so the end of the list is a
    // short last page — where the thumb used to overflow past the bottom of
    // its track by the height of the column header row.
    await createPlantingPlanFixtures(page, request, 'planting-plans-end-of-list', 120);

    await page.goto('/app/planting-plans');
    await expect(page.getByText('Scrollkultur (Sorte A)').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('continuous-scrollbar-thumb')).toBeVisible();

    const gridHeightAtTop = await page.locator('.MuiDataGrid-root').first().evaluate(
      (element) => element.getBoundingClientRect().height,
    );

    await page.locator('.MuiDataGrid-virtualScroller').first().hover();
    await expect.poll(async () => {
      await page.mouse.wheel(0, 1200);
      return page.evaluate(() => {
        const rows = document.querySelectorAll('.MuiDataGrid-row');
        return rows[rows.length - 1]?.getAttribute('data-rowindex') ?? null;
      });
    }, { timeout: 20_000 }).toBe('119');

    // The grid sizes itself to the rows its current internal page holds, so an
    // unbalanced last page (100/100/... plus a remainder) collapsed the table
    // to a fraction of its height as soon as the user reached the end.
    const gridHeightAtEnd = await page.locator('.MuiDataGrid-root').first().evaluate(
      (element) => element.getBoundingClientRect().height,
    );
    expect(Math.abs(gridHeightAtEnd - gridHeightAtTop)).toBeLessThanOrEqual(32);

    const track = await page.getByTestId('continuous-scrollbar-track').boundingBox();
    const thumb = await page.getByTestId('continuous-scrollbar-thumb').boundingBox();
    expect(track).not.toBeNull();
    expect(thumb).not.toBeNull();
    expect(thumb!.y).toBeGreaterThanOrEqual(track!.y - 1);
    expect(thumb!.y + thumb!.height).toBeLessThanOrEqual(track!.y + track!.height + 1);
  });

  test('Ctrl+End/Ctrl+Home jump to the actual start/end of the complete dataset, not just the internal page', async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    // More than the 100-row internal page size, so the dataset's real last
    // row lives on a second internal page that isn't mounted yet when the
    // grid first renders.
    await createPlantingPlanFixtures(page, request, 'planting-plans-keyboard-paging', 120);

    await page.goto('/app/planting-plans');
    await expect(page.getByText('Scrollkultur (Sorte A)').first()).toBeVisible({ timeout: 10_000 });

    const firstCell = page.locator('[role="row"][data-rowindex="0"] [role="gridcell"][data-field="planting_date"]');
    await firstCell.click();

    await page.keyboard.press('Control+End');
    await expect.poll(async () => page.evaluate(() => {
      const rows = document.querySelectorAll('.MuiDataGrid-row');
      return rows[rows.length - 1]?.getAttribute('data-rowindex') ?? null;
    }), { timeout: 20_000 }).toBe('119');
    const lastRow = page.locator('[role="row"][data-rowindex="119"]');
    await expect(lastRow.locator('[role="gridcell"][data-field="planting_date"]')).toHaveAttribute('tabindex', '0');

    await page.keyboard.press('Control+Home');
    await expect.poll(async () => page.evaluate(() => {
      const rows = document.querySelectorAll('.MuiDataGrid-row');
      return rows[0]?.getAttribute('data-rowindex') ?? null;
    }), { timeout: 20_000 }).toBe('0');
    const firstRow = page.locator('[role="row"][data-rowindex="0"]');
    await expect(firstRow.locator('[role="gridcell"][data-field="planting_date"]')).toHaveAttribute('tabindex', '0');
  });

  test('PageDown/PageUp move a full visible page of rows, not a single row', async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    // More than the 100-row internal page size, so a PageDown chain has to
    // cross the internal row-window boundary before reaching the end.
    await createPlantingPlanFixtures(page, request, 'planting-plans-page-keys', 120);

    await page.goto('/app/planting-plans');
    await expect(page.getByText('Scrollkultur (Sorte A)').first()).toBeVisible({ timeout: 10_000 });

    const getFocusedRowIndex = (): Promise<number> => page.evaluate(() => {
      const cell = document.querySelector('[role="gridcell"][tabindex="0"]');
      const row = cell?.closest('[role="row"]');
      return Number(row?.getAttribute('data-rowindex') ?? '-1');
    });

    const firstCell = page.locator('[role="row"][data-rowindex="0"] [role="gridcell"][data-field="planting_date"]');
    await firstCell.click();
    expect(await getFocusedRowIndex()).toBe(0);

    await page.keyboard.press('PageDown');
    await expect.poll(getFocusedRowIndex, { timeout: 20_000 }).toBeGreaterThan(1);
    const rowIndexAfterOnePageDown = await getFocusedRowIndex();

    // A second PageDown must move at least as far again, proving the step is
    // a repeatable "screenful" rather than a one-off jump, and must cross
    // into the second internal ~100-row page once it goes far enough.
    await page.keyboard.press('PageDown');
    await expect.poll(getFocusedRowIndex, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(Math.min(119, rowIndexAfterOnePageDown * 2 - 1));

    // Repeated PageDown clamps at the real last row instead of overshooting.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await page.keyboard.press('PageDown');
    }
    await expect.poll(getFocusedRowIndex, { timeout: 20_000 }).toBe(119);

    // PageUp mirrors the same full-page step back toward the start.
    await page.keyboard.press('PageUp');
    await expect.poll(getFocusedRowIndex, { timeout: 20_000 }).toBeLessThan(118);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await page.keyboard.press('PageUp');
    }
    await expect.poll(getFocusedRowIndex, { timeout: 20_000 }).toBe(0);
  });

  test('keeps the vertical scrollbar track on-screen after scrolling horizontally on a narrow viewport', async ({ page, request }) => {
    const viewportWidth = 1000;
    await page.setViewportSize({ width: viewportWidth, height: 900 });
    await createPlantingPlanFixtures(page, request, 'planting-plans-horizontal-scroll', 120);

    await page.goto('/app/planting-plans');
    await expect(page.getByText('Scrollkultur (Sorte A)').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('continuous-scrollbar-track')).toBeVisible();

    await page.locator('.MuiDataGrid-root').first().evaluate((element) => {
      let ancestor = element.parentElement;
      while (ancestor) {
        const overflowX = window.getComputedStyle(ancestor).overflowX;
        if (overflowX === 'auto' || overflowX === 'scroll') {
          ancestor.scrollLeft = ancestor.scrollWidth;
          return;
        }
        ancestor = ancestor.parentElement;
      }
      throw new Error('outer horizontal scroll container not found');
    });

    // The track must stay pinned to the right edge of the visible viewport,
    // not scroll away with the (wider than viewport) table content.
    const trackBox = await page.getByTestId('continuous-scrollbar-track').boundingBox();
    expect(trackBox).not.toBeNull();
    expect(trackBox!.x).toBeGreaterThanOrEqual(0);
    expect(trackBox!.x + trackBox!.width).toBeLessThanOrEqual(viewportWidth);
  });
});
