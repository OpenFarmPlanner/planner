import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import calendar from '../src/i18n/locales/de/ganttChart.json' with { type: 'json' };
import { apiRequest, expectNoHorizontalPageOverflow, loginWithDeterministicProject, resetE2EScenario, submitLoginFormAndAwaitApp } from './utils';

const backendPort = process.env.BACKEND_PORT ?? '8000';
const e2eToken = process.env.E2E_TEST_TOKEN || 'openfarmplanner-e2e-token';
const apiBase = `http://127.0.0.1:${backendPort}/api`;

test('shows a location-direct plan in the calendar before any parcels or beds exist', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.setFixedTime(new Date(2026, 4, 15, 12));
  await loginWithDeterministicProject(page, request, 'calendar-individual-location', { loginAsAdmin: true });
  const { results: [site] } = await apiRequest<{ results: { id: number }[] }>(page, 'GET', '/locations/');
  expect(await apiRequest(page, 'GET', '/fields/')).toMatchObject({ results: [] });
  expect(await apiRequest(page, 'GET', '/beds/')).toMatchObject({ results: [] });
  const season = await apiRequest<{ id: number }>(page, 'POST', '/seasons/', {
    start_date: '2026-01-01', end_date: '2026-12-31',
  });
  const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: 'Johannisbeere am Standort', life_cycle: 'perennial', standing_time_years: 4,
    cultivation_types: ['pre_cultivation'],
  });
  const plan = await apiRequest<{ id: number }>(page, 'POST', '/planting-plans/', {
    season: season.id, crop: crop.id, site: site.id, planting_date: '2026-04-01',
    clearing_date: '2030-04-01', cultivation_type: 'purchased_transplant', individual_count: 2,
  });
  await page.goto('/app/gantt-chart');
  const row = page.getByTestId(`task-group-individual-location-${site.id}`);
  await expect(row).toContainText('Einzelpflanzen');
  await expect(page.getByTestId(`task-plan-${plan.id}-occupancy`)).toBeVisible();
});

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

test.describe('Gantt free bed area', () => {
  test.use({ hasTouch: true, serviceWorkers: 'block', timezoneId: 'America/Los_Angeles' });

  test('shows day-level capacity without covering the crop bars', async ({ page, request }, info) => {
    const scenario = `gantt-bed-capacity-${Date.now()}`;
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await loginWithDeterministicProject(page, request, scenario, { loginAsAdmin: true });
      const season = await apiRequest<{ id: number }>(page, 'POST', '/seasons/', {
        start_date: '2026-03-18', end_date: '2026-10-23',
      });
      const location = await apiRequest<{ id: number }>(page, 'POST', '/locations/', { name: 'Test garden' });
      const field = await apiRequest<{ id: number }>(page, 'POST', '/fields/', { name: 'Test field', location: location.id });
      const beds = await Promise.all(['Test bed', 'Free bed', 'Unknown bed', 'Full bed', 'Succession bed'].map(name => (
        apiRequest<{ id: number; name: string }>(page, 'POST', '/beds/', { field: field.id, name, area_sqm: 10 })
      )));
      const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
        name: 'Test carrot', growth_duration_days: 35, harvest_duration_days: 15, cultivation_type: 'direct_sowing',
      });
      const create = (bed: number, date: string, area_usage_sqm?: number) => apiRequest<{ id: number }>(page, 'POST', '/planting-plans/', {
        season: season.id, crop: crop.id, bed, planting_date: date, area_usage_sqm, cultivation_type: 'direct_sowing',
      });
      const first = await create(beds[0].id, '2026-04-01', 5);
      await create(beds[0].id, '2026-04-15', 3);
      await create(beds[2].id, '2026-04-05');
      await create(beds[3].id, '2026-04-05', 10);
      await create(beds[4].id, '2026-04-01', 6);
      await create(beds[4].id, '2026-05-20', 6); // The predecessor is in its soft harvest stage.
      await page.goto('/app/gantt-chart');

      const toggle = page.getByRole('checkbox', { name: calendar.capacity.show, exact: true });
      const bandName = (name: string) => calendar.capacity.details.replace('{{bed}}', name);
      const band = page.getByRole('button', { name: bandName(beds[0].name), exact: true });
      const freeBand = page.getByRole('button', { name: bandName(beds[1].name), exact: true });
      const unknownBand = page.getByRole('button', { name: bandName(beds[2].name), exact: true });
      const fullBand = page.getByRole('button', { name: bandName(beds[3].name), exact: true });
      const overlapBand = page.getByRole('button', { name: bandName(beds[4].name), exact: true });
      const legend = page.getByRole('list').filter({ has: page.getByText(calendar.capacity.status.free, { exact: true }) });
      const cropBar = page.locator(`[data-task-id="plan-${first.id}-growth"]`);
      const firstUsedInterval = band.locator('[data-capacity-status="partial"]').first();
      await expect(toggle).not.toBeChecked();
      await expect(legend).toHaveCount(0);
      await expect(band).toHaveCount(0);
      await expect(cropBar).toBeVisible();
      await toggle.check();
      await expect(legend.getByRole('listitem')).toHaveText(Object.values(calendar.capacity.status));
      await expect(band).toBeVisible();
      await expect(firstUsedInterval).toBeVisible();
      await expect(freeBand).toHaveCount(0);
      await page.getByRole('checkbox', { name: calendar.treeFilters.onlyOccupiedBeds, exact: true }).uncheck();
      const freeMarker = freeBand.locator('[data-capacity-status="free"] > span');
      const partialMarkers = band.locator('[data-capacity-status="partial"] > span');
      const fullMarker = fullBand.locator('[data-capacity-status="occupied"] > span');
      const unknownMarker = unknownBand.locator('[data-capacity-status="unknown"] > span');
      const overlapInterval = overlapBand.locator('[data-capacity-status="overallocated"]');
      await expect(freeMarker).toHaveCSS('background-image', 'none');
      await expect(freeMarker).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(freeMarker).toHaveCSS('border-top-width', '1px');
      await expect(partialMarkers.nth(0)).toHaveCSS('background-image', /repeating-linear-gradient/);
      await expect(partialMarkers.nth(1)).toHaveCSS('background-image', await partialMarkers.nth(0).evaluate(
        node => getComputedStyle(node).backgroundImage,
      ));
      await expect(fullMarker).toHaveCSS('background-image', 'none');
      await expect(fullMarker).toHaveCSS('background-color', 'rgb(117, 117, 117)');
      await expect(unknownMarker).toHaveCSS('border-top-style', 'dotted');
      await expect(overlapInterval.locator('span')).toHaveCSS('background-image', /repeating-linear-gradient.*repeating-linear-gradient/);

      for (const mode of ['day', 'week', 'month', 'quarter', 'year'] as const) {
        const selector = page.getByRole('button', { name: calendar.chartLocaleText.viewModes[mode], exact: true });
        await selector.click();
        await expect(selector).toHaveAttribute('aria-pressed', 'true');
        await expect(band).toBeVisible();
        await expect(cropBar).toBeVisible();
        const [barBox, bandBox] = await Promise.all([cropBar.boundingBox(), band.boundingBox()]);
        expect(barBox!.y + barBox!.height).toBeLessThanOrEqual(bandBox!.y);
        await expect.poll(async () => {
          const [bar, interval] = await Promise.all([cropBar.boundingBox(), firstUsedInterval.boundingBox()]);
          return Math.abs(bar!.x - interval!.x);
        }).toBeLessThan(1);
        await expectNoHorizontalPageOverflow(page);
      }
      await page.getByRole('button', { name: calendar.chartLocaleText.viewModes.month, exact: true }).click();
      const harvestBar = page.locator(`[data-task-id="plan-${first.id}-harvest"]`);
      const afterHarvest = band.locator('[data-capacity-status="partial"]').nth(2);
      await expect.poll(async () => {
        const [bar, interval] = await Promise.all([harvestBar.boundingBox(), afterHarvest.boundingBox()]);
        return Math.abs(bar!.x + bar!.width - interval!.x);
      }).toBeLessThan(1);
      await firstUsedInterval.hover();
      const capacityTooltip = page.getByRole('tooltip').filter({ hasText: '5 m² frei von 10 m²' });
      await expect(capacityTooltip).toBeVisible();
      await expect(capacityTooltip).toContainText('2026');
      await page.keyboard.press('Escape');
      await expect(capacityTooltip).toBeHidden();
      await band.focus();
      await expect(band).toBeFocused();
      await band.press('Enter');
      const details = page.getByRole('dialog', { name: bandName(beds[0].name), exact: true });
      await expect(details.getByText('10 m² frei von 10 m² · 0 m² belegt').first()).toBeVisible();
      await expect(details.getByText('5 m² frei von 10 m² · 5 m² belegt')).toBeVisible();
      await expect(details.getByText('2 m² frei von 10 m² · 8 m² belegt')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(details).toBeHidden();
      await expect(band).toBeFocused();
      await overlapInterval.hover();
      const overlapTooltip = page.getByRole('tooltip').filter({ hasText: '12 m² belegt bei 10 m² Beetfläche' });
      await expect(overlapTooltip).toContainText(calendar.capacity.successionOverlap);
      await overlapBand.press('Enter');
      const overlapDetails = page.getByRole('dialog', { name: bandName(beds[4].name), exact: true });
      await expect(overlapDetails.getByText(calendar.capacity.successionOverlap, { exact: false })).toContainText('12 m² belegt bei 10 m² Beetfläche');
      await page.keyboard.press('Escape');
      await expect(overlapDetails).toBeHidden();
      await fullBand.press('Enter');
      const fullDetails = page.getByRole('dialog', { name: bandName(beds[3].name), exact: true });
      await expect(fullDetails.getByText('0 m² frei von 10 m² · 10 m² belegt')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(fullDetails).toBeHidden();
      await page.screenshot({ path: info.outputPath('free-areas-desktop.png'), animations: 'disabled' });

      const edit = page.getByRole('button', { name: calendar.moveModeOption, exact: true });
      await edit.click();
      await cropBar.scrollIntoViewIfNeeded();
      const cropBox = (await cropBar.boundingBox())!;
      const x = cropBox.x + cropBox.width / 2;
      const y = cropBox.y + cropBox.height / 2;
      const saved = page.waitForResponse(response => response.request().method() === 'PUT'
        && new URL(response.url()).pathname.endsWith(`/planting-plans/${first.id}/`));
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 10, y, { steps: 5 }); // Two days in a 150 px April column.
      await page.mouse.up();
      const response = await saved;
      expect(response.ok()).toBe(true);
      expect(await response.json()).toMatchObject({ planting_date: '2026-04-03' });
      await edit.click();

      for (const [width, height] of [[1024, 768], [768, 1024], [375, 800], [800, 375]]) {
        await page.setViewportSize({ width, height });
        await expect(toggle).toBeInViewport({ ratio: 1 });
        await expectNoHorizontalPageOverflow(page);
        await page.screenshot({ path: info.outputPath(`free-areas-${width}.png`), animations: 'disabled' });
      }
      await unknownBand.locator('[data-capacity-status="unknown"]').tap();
      const unknown = page.getByRole('dialog', { name: bandName(beds[2].name), exact: true });
      await expect(unknown.getByText(/Freie Fläche unbekannt/)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(unknown).toBeHidden();
      await toggle.uncheck();
      await expect(band).toHaveCount(0);
      await expect(cropBar).toBeVisible();
    } finally {
      await resetE2EScenario(request, scenario);
    }
  });
});

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
