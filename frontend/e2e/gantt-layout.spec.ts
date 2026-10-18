import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { submitLoginFormAndAwaitApp } from './utils';

const backendPort = process.env.BACKEND_PORT ?? '8000';
const e2eToken = process.env.E2E_TEST_TOKEN || 'openfarmplanner-e2e-token';
const apiBase = `http://127.0.0.1:${backendPort}/api`;

type LayoutMetrics = {
  bodyOverflowX: number;
  documentOverflowX: number;
  wrapperOverflowX: number;
  timelineOverflowX: number;
  viewportBottomGap: number;
  viewportHeight: number;
  viewportOverflowY: number;
  pageOverflowY: number;
  wrapperOverflowStyleX: string;
  timelineOverflowStyleX: string;
  timelineOverflowStyleY: string;
  timelineScrollbarWidth: string;
};

function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') {
      return;
    }
    const text = message.text();
    if (text.includes('Failed to load resource')) {
      return;
    }
    errors.push(`console.error: ${text}`);
  });
  page.on('pageerror', (error) => {
    errors.push(`pageerror: ${error.message}`);
  });
  return errors;
}

async function loginWithFreshProject(page: Page, request: APIRequestContext, scenarioPrefix: string): Promise<void> {
  const scenario = `${scenarioPrefix}-${Date.now()}`;
  const setupResponse = await request.post(`${apiBase}/__e2e__/invite-flow/`, {
    headers: { 'X-E2E-Token': e2eToken },
    data: { action: 'setup', scenario_id: scenario, invitation_state: 'pending' },
  });
  const setupText = await setupResponse.text();
  expect(setupResponse.ok(), `fixture setup -> ${setupResponse.status()}: ${setupText}`).toBeTruthy();
  const setup = JSON.parse(setupText) as { admin: { email: string; password: string } };

  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(setup.admin.email);
  await page.locator('input[type="password"]').fill(setup.admin.password);
  await submitLoginFormAndAwaitApp(page);
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem('activeProjectId'))).toBeTruthy();
}

async function createCalendarFixture(page: Page, options: { bedCount?: number } = {}): Promise<void> {
  const activeProjectId = await page.evaluate(() => window.localStorage.getItem('activeProjectId'));
  expect(activeProjectId).toBeTruthy();
  const projectId = Number(activeProjectId);
  const csrfToken = await page.evaluate(() =>
    document.cookie.split('; ').find((row) => row.startsWith('csrftoken='))?.split('=')[1] ?? '');

  const api = async <T,>(path: string, data: Record<string, unknown>): Promise<T> => {
    const result = await page.evaluate(async ({ requestPath, requestData, requestProjectId, requestCsrfToken }) => {
      const response = await fetch(`/api${requestPath}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'X-CSRFToken': requestCsrfToken,
          'Content-Type': 'application/json',
          'X-Project-Id': String(requestProjectId),
        },
        body: JSON.stringify({ ...requestData, project: requestProjectId }),
      });
      const text = await response.text();
      return {
        ok: response.ok,
        status: response.status,
        text,
      };
    }, {
      requestPath: path,
      requestData: data,
      requestProjectId: projectId,
      requestCsrfToken: csrfToken,
    });
    expect(result.ok, `${path} -> ${result.status}: ${result.text}`).toBeTruthy();
    return JSON.parse(result.text) as T;
  };

  const season = await api<{ id: number }>('/seasons/', { start_date: '2026-01-01', end_date: '2026-12-31' });
  const location = await api<{ id: number }>('/locations/', { name: 'Layout Testhof' });
  const field = await api<{ id: number }>('/fields/', { name: 'Layout Testfeld', location: location.id });
  // The Gantt timeline spans the actual data range of the season's plans, so
  // these durations are deliberately long: the occupancy range (planting ->
  // harvest end) and the seedling range (propagation start -> planting) each
  // need to be wide enough that the timeline overflows its viewport and stays a
  // horizontal scroll container at every tested width, up to 1920px.
  const crop = await api<{ id: number }>('/crops/', {
    name: 'Layout Kultur',
    growth_duration_days: 380,
    harvest_duration_days: 20,
    propagation_duration_days: 380,
    cultivation_type: 'pre_cultivation',
    cultivation_types: ['pre_cultivation'],
    plants_per_m2: 4,
  });
  const bedCount = options.bedCount ?? 1;
  for (let index = 0; index < bedCount; index += 1) {
    const bed = await api<{ id: number }>('/beds/', {
      name: index === 0 ? 'Layout Testbeet' : `Layout Testbeet ${index + 1}`,
      field: field.id,
      length_m: 10,
      width_m: 1,
      area_sqm: 10,
    });
    await api('/planting-plans/', {
      bed: bed.id,
      crop: crop.id,
      season: season.id,
      cultivation_type: 'pre_cultivation',
      planting_date: '2026-04-01',
      harvest_date: '2026-05-01',
      area_usage_sqm: 2,
    });
  }
}

async function readLayoutMetrics(page: Page): Promise<LayoutMetrics> {
  await expect(page.locator('.gantt-container-wrapper .rmg-container')).toBeVisible({ timeout: 10_000 });

  return page.evaluate(() => {
    const wrapper = document.querySelector<HTMLElement>('.gantt-container-wrapper');
    const viewport = document.querySelector<HTMLElement>('[data-testid="gantt-virtual-viewport"]');
    const timeline = document.querySelector<HTMLElement>('.gantt-container-wrapper .rmg-container');
    if (!wrapper || !viewport || !timeline) {
      throw new Error('Missing Gantt layout elements');
    }

    const rowElements = [
      ...wrapper.querySelectorAll<HTMLElement>('[data-rmg-component="task-group"]'),
      ...wrapper.querySelectorAll<HTMLElement>('[data-rmg-component="task-row"]'),
    ];
    const lastRowBottom = rowElements.length > 0
      ? Math.max(...rowElements.map((element) => element.getBoundingClientRect().bottom))
      : viewport.getBoundingClientRect().top;
    const viewportRect = viewport.getBoundingClientRect();
    const timelineStyle = getComputedStyle(timeline);

    return {
      bodyOverflowX: document.body.scrollWidth - window.innerWidth,
      documentOverflowX: document.documentElement.scrollWidth - window.innerWidth,
      wrapperOverflowX: wrapper.scrollWidth - wrapper.clientWidth,
      timelineOverflowX: timeline.scrollWidth - timeline.clientWidth,
      viewportBottomGap: viewportRect.bottom - lastRowBottom,
      viewportHeight: viewportRect.height,
      viewportOverflowY: viewport.scrollHeight - viewport.clientHeight,
      pageOverflowY: document.documentElement.scrollHeight - window.innerHeight,
      wrapperOverflowStyleX: getComputedStyle(wrapper).overflowX,
      timelineOverflowStyleX: timelineStyle.overflowX,
      timelineOverflowStyleY: timelineStyle.overflowY,
      timelineScrollbarWidth: timelineStyle.scrollbarWidth,
    };
  });
}

async function expectCalendarLayout(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.getByText(/Feldplanung|Anzuchtplanung/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Layout Kultur').first()).toBeVisible({ timeout: 10_000 });

  const metrics = await readLayoutMetrics(page);
  expect(metrics.documentOverflowX).toBeLessThanOrEqual(1);
  expect(metrics.bodyOverflowX).toBeLessThanOrEqual(1);
  expect(metrics.wrapperOverflowX).toBeLessThanOrEqual(1);
  expect(metrics.timelineOverflowX).toBeGreaterThan(0);
  expect(metrics.viewportBottomGap).toBeLessThan(96);
  expect(metrics.viewportHeight).toBeLessThan(360);
  expect(metrics.viewportOverflowY).toBeLessThanOrEqual(1);
  expect(metrics.wrapperOverflowStyleX).toBe('hidden');
  expect(metrics.timelineOverflowStyleX).toBe('auto');
  expect(metrics.timelineOverflowStyleY).toBe('hidden');
}

async function readTaskListWidth(page: Page): Promise<number> {
  return page.evaluate(() => {
    const taskList = document.querySelector<HTMLElement>('.gantt-container-wrapper .rmg-task-list');
    if (!taskList) {
      throw new Error('Missing Gantt task list');
    }
    return taskList.getBoundingClientRect().width;
  });
}

async function readStoredLeftColumnWidth(page: Page, storageField: 'leftColumnWidthDesktop' | 'leftColumnWidthMobile'): Promise<number | null> {
  return page.evaluate(() => {
    const activeProjectId = window.localStorage.getItem('activeProjectId');
    if (!activeProjectId) {
      throw new Error('Missing active project id');
    }
    const rawState = window.localStorage.getItem(`openfarmplanner:gantt:${activeProjectId}:state`);
    if (!rawState) {
      return null;
    }
    return JSON.parse(rawState) as Record<string, unknown>;
  }).then((parsed) => (typeof parsed[storageField] === 'number' ? parsed[storageField] : null));
}

async function expectResizeHandleStartsAtTimelineBody(page: Page): Promise<void> {
  const bounds = await page.evaluate(() => {
    const handle = document.querySelector<HTMLElement>('[role="separator"][aria-orientation="vertical"]');
    const body = document.querySelector<HTMLElement>('.gantt-container-wrapper .rmg-container');
    const chart = document.querySelector<HTMLElement>('.gantt-container-wrapper .rmg-gantt-chart');
    if (!handle || !body || !chart) {
      throw new Error('Missing resize handle or Gantt body');
    }
    const handleRect = handle.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const chartRect = chart.getBoundingClientRect();
    return {
      handleTop: handleRect.top,
      handleBottom: handleRect.bottom,
      bodyTop: bodyRect.top,
      bodyBottom: bodyRect.bottom,
      chartTop: chartRect.top,
    };
  });

  expect(bounds.handleTop).toBeGreaterThan(bounds.chartTop + 8);
  expect(Math.abs(bounds.handleTop - bounds.bodyTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(bounds.handleBottom - bounds.bodyBottom)).toBeLessThanOrEqual(1);
}

async function expectResizeHandleIsVisuallySubtle(page: Page): Promise<void> {
  const styles = await page.evaluate(() => {
    const handle = document.querySelector<HTMLElement>('[role="separator"][aria-orientation="vertical"]');
    const marker = document.querySelector<HTMLElement>('[data-testid="gantt-sidebar-resize-line"]');
    const grip = document.querySelector<HTMLElement>('[data-testid="gantt-sidebar-resize-grip"]');
    if (!handle || !marker || !grip) {
      throw new Error('Missing resize handle');
    }
    const computedStyle = window.getComputedStyle(handle);
    const markerStyle = window.getComputedStyle(marker);
    const gripStyle = window.getComputedStyle(grip);
    return {
      backgroundColor: computedStyle.backgroundColor,
      hitboxWidth: computedStyle.width,
      markerWidth: markerStyle.width,
      gripOpacity: gripStyle.opacity,
    };
  });

  expect(styles.backgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(Number.parseFloat(styles.hitboxWidth)).toBeGreaterThan(2);
  expect(Number.parseFloat(styles.markerWidth)).toBeLessThanOrEqual(2);
  expect(Number.parseFloat(styles.gripOpacity)).toBe(0);
}

async function expectDesktopResizeHandleHoverIsVisible(page: Page): Promise<void> {
  const handle = page.getByRole('separator', { name: 'Seitenleiste verbreitern oder verkleinern' });
  await handle.hover();

  await expect.poll(() => page.evaluate(() => {
    const handleElement = document.querySelector<HTMLElement>('[role="separator"][aria-orientation="vertical"]');
    const marker = document.querySelector<HTMLElement>('[data-testid="gantt-sidebar-resize-line"]');
    const grip = document.querySelector<HTMLElement>('[data-testid="gantt-sidebar-resize-grip"]');
    if (!handleElement || !marker || !grip) {
      throw new Error('Missing resize handle');
    }
    const handleStyle = window.getComputedStyle(handleElement);
    const markerStyle = window.getComputedStyle(marker);
    const gripStyle = window.getComputedStyle(grip);
    return {
      cursor: handleStyle.cursor,
      backgroundColor: handleStyle.backgroundColor,
      markerWidth: Number.parseFloat(markerStyle.width),
      markerOpacity: Number.parseFloat(markerStyle.opacity),
      gripOpacity: Number.parseFloat(gripStyle.opacity),
    };
  })).toMatchObject({
    cursor: 'col-resize',
    backgroundColor: 'rgba(0, 0, 0, 0)',
    markerWidth: 2,
    markerOpacity: 1,
    gripOpacity: 1,
  });
}

async function expectResizeHandleDraggingIsVisible(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const handle = document.querySelector<HTMLElement>('[role="separator"][aria-orientation="vertical"]');
    const marker = document.querySelector<HTMLElement>('[data-testid="gantt-sidebar-resize-line"]');
    const grip = document.querySelector<HTMLElement>('[data-testid="gantt-sidebar-resize-grip"]');
    if (!handle || !marker || !grip) {
      throw new Error('Missing resize handle');
    }
    const handleStyle = window.getComputedStyle(handle);
    const markerStyle = window.getComputedStyle(marker);
    const gripStyle = window.getComputedStyle(grip);
    return {
      isResizing: handle.dataset.resizing === 'true',
      backgroundColor: handleStyle.backgroundColor,
      markerWidth: Number.parseFloat(markerStyle.width),
      markerOpacity: Number.parseFloat(markerStyle.opacity),
      gripOpacity: Number.parseFloat(gripStyle.opacity),
    };
  })).toMatchObject({
    isResizing: true,
    backgroundColor: 'rgba(0, 0, 0, 0)',
    markerWidth: 2,
    markerOpacity: 1,
    gripOpacity: 1,
  });
}

async function expectMobilePageScrollsCalendar(page: Page, viewport: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto('/app/gantt-chart');
  await expect(page.getByText('Layout Kultur').first()).toBeVisible({ timeout: 10_000 });

  const metrics = await readLayoutMetrics(page);
  expect(metrics.documentOverflowX).toBeLessThanOrEqual(1);
  expect(metrics.bodyOverflowX).toBeLessThanOrEqual(1);
  expect(metrics.wrapperOverflowX).toBeLessThanOrEqual(1);
  expect(metrics.timelineOverflowX).toBeGreaterThan(0);
  expect(metrics.viewportOverflowY).toBeLessThanOrEqual(1);
  expect(metrics.pageOverflowY).toBeGreaterThan(80);
  expect(metrics.timelineOverflowStyleX).toBe('auto');
  expect(metrics.timelineOverflowStyleY).toBe('hidden');

  await page.evaluate(() => window.scrollTo(0, 0));
  const filters = page.getByTestId('occupancy-tree-filters');
  const initialTop = await filters.evaluate((element) => element.getBoundingClientRect().top);
  await page.mouse.wheel(0, 220);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(80);
  const scrolledTop = await filters.evaluate((element) => element.getBoundingClientRect().top);
  expect(scrolledTop).toBeLessThan(initialTop - 80);
  if (viewport.width > viewport.height) {
    expect(scrolledTop).toBeLessThan(0);
  }
}

test.describe('Gantt calendar layout', () => {
  test('keeps horizontal scrolling on the timeline and short calendars sized to content', async ({ page, request }) => {
    await loginWithFreshProject(page, request, 'gantt-layout-desktop');
    await createCalendarFixture(page);

    for (const viewport of [
      { width: 390, height: 844 },
      { width: 600, height: 900 },
      { width: 768, height: 900 },
      { width: 1024, height: 900 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      await expectCalendarLayout(page, '/app/gantt-chart');
      await expectCalendarLayout(page, '/app/gantt-chart?view=seedlings');
    }
  });

  test('toggles a Standort or Parzelle row by clicking anywhere on it', async ({ page, request }) => {
    await loginWithFreshProject(page, request, 'gantt-layout-row-toggle');
    await createCalendarFixture(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app/gantt-chart');

    const taskList = page.locator('.gantt-container-wrapper .rmg-task-list');
    const locationRow = taskList.getByRole('button', { name: 'Layout Testhof' });
    const fieldRow = taskList.getByRole('button', { name: 'Layout Testfeld' });
    const bedName = taskList.getByText('Layout Testbeet', { exact: true });
    await expect(bedName).toBeVisible({ timeout: 10_000 });
    await expect(fieldRow).toHaveAttribute('aria-expanded', 'true');
    await expect(fieldRow).toHaveCSS('cursor', 'pointer');
    await expect(taskList.locator('[data-group-id^="bed-"]').first()).toHaveCSS('cursor', 'default');

    await fieldRow.getByText('Layout Testfeld').click();
    await expect(fieldRow).toHaveAttribute('aria-expanded', 'false');
    await expect(bedName).toBeHidden();

    await fieldRow.press('Enter');
    await expect(fieldRow).toHaveAttribute('aria-expanded', 'true');
    await expect(bedName).toBeVisible();

    await locationRow.hover();
    await locationRow.getByRole('button', { name: 'Aktionen' }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(locationRow).toHaveAttribute('aria-expanded', 'true');

    await locationRow.focus();
    await page.keyboard.press('Space');
    await expect(locationRow).toHaveAttribute('aria-expanded', 'false');
    await expect(fieldRow).toBeHidden();

    // The global level controls in the column header share the same state.
    await page.getByRole('button', { name: 'Eine Hierarchieebene mehr anzeigen' }).click();
    await expect(locationRow).toHaveAttribute('aria-expanded', 'true');
    await expect(fieldRow).toBeVisible();
    await page.getByRole('button', { name: 'Eine Hierarchieebene ausblenden' }).click();
    await expect(locationRow).toHaveAttribute('aria-expanded', 'false');
  });

  test('persists a resized desktop sidebar across reloads', async ({ page, request }) => {
    const consoleErrors = trackConsoleErrors(page);
    await loginWithFreshProject(page, request, 'gantt-layout-sidebar-resize');
    await createCalendarFixture(page);
    await page.setViewportSize({ width: 1024, height: 900 });
    await expectCalendarLayout(page, '/app/gantt-chart');

    await expect.poll(() => readTaskListWidth(page)).toBeCloseTo(240, 0);
    const handle = page.getByRole('separator', { name: 'Seitenleiste verbreitern oder verkleinern' });
    await expect(handle).toBeVisible();
    await expectResizeHandleStartsAtTimelineBody(page);
    await expectResizeHandleIsVisuallySubtle(page);
    await expectDesktopResizeHandleHoverIsVisible(page);

    const handleBox = await handle.boundingBox();
    expect(handleBox).not.toBeNull();
    if (!handleBox) {
      throw new Error('Missing sidebar resize handle bounds');
    }

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 30);
    await page.mouse.down();
    await expectResizeHandleDraggingIsVisible(page);
    await page.mouse.move(handleBox.x + handleBox.width / 2 + 90, handleBox.y + 30, { steps: 6 });
    await page.mouse.up();

    await expect.poll(() => readTaskListWidth(page)).toBeCloseTo(330, 0);
    await expect.poll(() => readStoredLeftColumnWidth(page, 'leftColumnWidthDesktop')).toBe(330);

    await page.reload();
    await expect(page.getByText('Layout Kultur').first()).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => readTaskListWidth(page)).toBeCloseTo(330, 0);
    await expectResizeHandleStartsAtTimelineBody(page);
    expect(consoleErrors).toEqual([]);
  });

  test('persists a resized mobile sidebar independently from desktop', async ({ page, request }) => {
    const consoleErrors = trackConsoleErrors(page);
    await loginWithFreshProject(page, request, 'gantt-layout-mobile-sidebar-resize');
    await createCalendarFixture(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await expectCalendarLayout(page, '/app/gantt-chart');

    await expect.poll(() => readTaskListWidth(page)).toBeCloseTo(132, 0);
    const handle = page.getByRole('separator', { name: 'Seitenleiste verbreitern oder verkleinern' });
    await expect(handle).toBeVisible();
    await expectResizeHandleStartsAtTimelineBody(page);
    await expectResizeHandleIsVisuallySubtle(page);

    const handleBox = await handle.boundingBox();
    expect(handleBox).not.toBeNull();
    if (!handleBox) {
      throw new Error('Missing mobile sidebar resize handle bounds');
    }

    const dragY = handleBox.y + 48;
    await page.mouse.move(handleBox.x + handleBox.width / 2, dragY);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + handleBox.width / 2 - 28, dragY, { steps: 4 });
    await page.mouse.up();

    await expect.poll(() => readTaskListWidth(page)).toBeCloseTo(104, 0);
    await expect.poll(() => readStoredLeftColumnWidth(page, 'leftColumnWidthMobile')).toBe(104);
    await expect.poll(() => readStoredLeftColumnWidth(page, 'leftColumnWidthDesktop')).toBe(null);

    await page.reload();
    await expect(page.getByText('Layout Kultur').first()).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => readTaskListWidth(page)).toBeCloseTo(104, 0);

    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto('/app/gantt-chart');
    await expect(page.getByText('Layout Kultur').first()).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => readTaskListWidth(page)).toBeCloseTo(240, 0);
    expect(consoleErrors).toEqual([]);
  });
});

test.describe('Gantt calendar layout on touch devices', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('hides the mobile timeline scrollbar while keeping touch scrolling available', async ({ page, request }) => {
    const consoleErrors = trackConsoleErrors(page);
    await loginWithFreshProject(page, request, 'gantt-layout-mobile-touch');
    await createCalendarFixture(page);
    await expectCalendarLayout(page, '/app/gantt-chart');

    const metrics = await readLayoutMetrics(page);
    expect(metrics.timelineScrollbarWidth).toBe('none');
    expect(consoleErrors).toEqual([]);
  });
});

test.describe('Gantt calendar mobile page scrolling', () => {
  test.use({ isMobile: true, hasTouch: true });

  test('uses the page as the vertical scroller in portrait and landscape', async ({ page, request }) => {
    const consoleErrors = trackConsoleErrors(page);
    await loginWithFreshProject(page, request, 'gantt-layout-mobile-page-scroll');
    await createCalendarFixture(page, { bedCount: 16 });

    for (const viewport of [
      { width: 320, height: 568 },
      { width: 568, height: 320 },
      { width: 844, height: 390 },
      { width: 768, height: 900 },
    ]) {
      await expectMobilePageScrollsCalendar(page, viewport);
    }
    expect(consoleErrors).toEqual([]);
  });
});
