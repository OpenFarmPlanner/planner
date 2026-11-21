import { expect, test, type Request } from '@playwright/test';
import common from '../src/i18n/locales/de/common.json' with { type: 'json' };
import calendar from '../src/i18n/locales/de/ganttChart.json' with { type: 'json' };
import navigation from '../src/i18n/locales/de/navigation.json' with { type: 'json' };
import plans from '../src/i18n/locales/de/plantingPlans.json' with { type: 'json' };
import { apiRequest, expectNoHorizontalPageOverflow, loginWithDeterministicProject, resetE2EScenario } from './utils';

// The PWA service worker answers fetches itself, and page.route() never sees a
// request a service worker handled — blocking it is what lets this spec hold
// the season responses back.
test.use({ serviceWorkers: 'block' });

test('an empty project opens season creation directly from the Crop Calendar', async ({ page, request }, info) => {
  const scenario = `calendar-no-season-${Date.now()}`;
  try {
    await loginWithDeterministicProject(page, request, scenario, { loginAsAdmin: true });
    for (const [width, height] of [[1440, 900], [375, 800], [800, 375]]) {
      await page.setViewportSize({ width, height });
      await page.goto('/app/gantt-chart');
      await expect(page.getByText(plans.emptyStates.states.seasons.title, { exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: common.setupActions.createPlan, exact: true })).toHaveCount(0);
      const create = page.getByRole('button', { name: plans.emptyStates.actions.createSeason, exact: true });
      await expect(create).toBeInViewport({ ratio: 1 });
      await expectNoHorizontalPageOverflow(page);
      await page.screenshot({ path: info.outputPath(`no-season-${width}.png`), animations: 'disabled' });
      await create.focus();
      await expect(create).toBeFocused();
      await create.press('Enter');
      const dialog = page.getByRole('dialog', { name: /^Saison .* anlegen\?$/ });
      await expect(dialog).toBeVisible();
      await expect(page).toHaveURL(/\/app\/gantt-chart(?:\?|$)/);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    }
  } finally {
    await resetE2EScenario(request, scenario);
  }
});

test('the Crop Calendar follows the selected season and includes carried plans', async ({ page, request }, info) => {
  const scenario = `calendar-season-setup-${Date.now()}`;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginWithDeterministicProject(page, request, scenario, { loginAsAdmin: true });
    const earlier = await apiRequest<{ id: number }>(page, 'POST', '/seasons/', {
      start_date: '2026-01-01', end_date: '2026-12-31', custom_label: 'Test A',
    });
    const later = await apiRequest<{ id: number }>(page, 'POST', '/seasons/', {
      start_date: '2027-01-01', end_date: '2027-12-31', custom_label: 'Test B',
    });
    const location = await apiRequest<{ id: number }>(page, 'POST', '/locations/', { name: 'Test garden' });
    const field = await apiRequest<{ id: number }>(page, 'POST', '/fields/', { location: location.id, name: 'Test field' });
    const bed = await apiRequest<{ id: number }>(page, 'POST', '/beds/', { field: field.id, name: 'Test bed', area_sqm: 12 });
    const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
      name: 'Test lettuce', growth_duration_days: 40, harvest_duration_days: 14,
      cultivation_type: 'direct_sowing', cultivation_types: ['direct_sowing'],
    });
    const createPlan = (date: string) => apiRequest<{ id: number }>(page, 'POST', '/planting-plans/', {
      season: earlier.id, crop: crop.id, bed: bed.id, planting_date: date,
      cultivation_type: 'direct_sowing', area_usage_sqm: 2,
    });
    const original = await createPlan('2026-04-01');
    const scopeHeaders: Array<string | undefined> = [];
    page.on('request', (entry) => {
      if (entry.method() === 'GET'
        && new URL(entry.url()).pathname.endsWith('/planting-plans/')
        && entry.frame().url().includes('/app/gantt-chart')) {
        scopeHeaders.push(entry.headers()['x-season-id']);
      }
    });
    await page.goto('/app/gantt-chart');
    const empty = page.getByText(calendar.emptyStates.states.plans.title, { exact: true });
    const add = page.getByRole('link', { name: common.setupActions.createPlan, exact: true });
    const timeline = page.getByTestId('gantt-virtual-viewport');
    const task = (id: number) => timeline.locator(`[data-task-id^="plan-${id}-"]`).first();
    await expect(empty).toBeVisible();
    await expect(timeline).toHaveCount(0);
    expect(scopeHeaders).toContain(String(later.id));
    expect(scopeHeaders.every(scope => scope === String(later.id))).toBe(true);
    await expect(add).toHaveAttribute('href', '/app/planting-plans?create=true');
    await page.screenshot({ path: info.outputPath('empty-season-desktop.png'), animations: 'disabled' });
    const freeAreas = page.getByRole('checkbox', { name: calendar.capacity.show, exact: true });
    await expect(freeAreas).not.toBeChecked();
    await freeAreas.check();
    await expect(timeline).toBeVisible();
    await expect(timeline.locator('[data-capacity-status="free"]')).toHaveCount(1);
    await expect(add).toBeVisible();
    const propagation = page.getByRole('button', { name: calendar.modes.seedlings, exact: true });
    const occupancy = page.getByRole('button', { name: calendar.modes.occupancy, exact: true });
    await propagation.click();
    await expect(timeline).toHaveCount(0);
    await expect(add).toBeVisible();
    await occupancy.click();
    await expect(timeline).toBeVisible();
    await propagation.click();
    await page.reload();
    await expect(propagation).toHaveAttribute('aria-pressed', 'true');
    await occupancy.click();
    await expect(freeAreas).not.toBeChecked();
    await freeAreas.check();
    await expect(timeline).toBeVisible();
    await freeAreas.uncheck();
    await expect(timeline).toHaveCount(0);

    const switchSeason = async (label: string) => {
      await page.getByRole('button', { name: navigation.seasonSwitcher.ariaLabel }).click();
      await page.getByRole('menuitem', { name: new RegExp(label) }).click();
    };
    await switchSeason('Test A');
    await expect(timeline).toBeVisible();
    await expect(task(original.id)).toBeVisible();
    await expect(empty).toBeHidden();
    await switchSeason('Test B');
    await expect(empty).toBeVisible();

    await page.setViewportSize({ width: 375, height: 800 });
    await expectNoHorizontalPageOverflow(page);
    await expect(add).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: info.outputPath('empty-season-mobile.png'), animations: 'disabled' });
    await add.click();
    await expect(page).toHaveURL(/\/app\/planting-plans(?:\?|$)/);
    await expect(page.getByRole('dialog', { name: plans.mobile.createTitle })).toBeVisible();
    await page.keyboard.press('Escape');

    const winterPlan = await createPlan('2026-12-18');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app/gantt-chart');
    await expect(timeline).toBeVisible();
    await expect(task(winterPlan.id)).toBeVisible();
    await expect(task(original.id)).toHaveCount(0);
    await expect(empty).toBeHidden();
  } finally {
    await resetE2EScenario(request, scenario);
  }
});

// Regression for a CI flake (OpenFarmPlanner/planner#742, e2e shard 2/3, run
// 36989707245): the demo project has a 2025 and a 2026 season, and a page that
// mounted before the season list had loaded fetched its plans without
// X-Season-Id, so it kept showing both seasons (17 plans, three tomato rows).
test('a first visit without a stored season only loads the active season', async ({ page, request }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await loginWithDeterministicProject(page, request, 'planting-plans-season-scope', {
    demoProject: true,
    loginAsAdmin: true,
  });
  // Cleared as the next document starts, before the app boots: clearing it
  // under the already-running landing page would race that page's own loads.
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('tested-initial-season')) return;
    window.sessionStorage.setItem('tested-initial-season', 'true');
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith('activeSeasonId:'))
      .forEach((key) => window.localStorage.removeItem(key));
  });
  // Let the page's own data (crops, beds) win the race against the seasons.
  await page.route(/\/api\/seasons\//, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.continue();
  });
  const planRequests: Request[] = [];
  page.on('request', (planRequest) => {
    if (/\/api\/planting-plans\//.test(planRequest.url())) {
      planRequests.push(planRequest);
    }
  });

  await page.goto('/app/planting-plans');
  const cards = page.locator('[data-mobile-card-id]');
  await expect(cards.first()).toBeVisible({ timeout: 10000 });

  expect(planRequests.length).toBeGreaterThan(0);
  for (const planRequest of planRequests) {
    expect(planRequest.headers()['x-season-id'], planRequest.url()).toBeTruthy();
  }
  await page.unroute(/\/api\/seasons\//);
  // Only the current season's two tomato rows; earlier seasons' tomatoes are excluded.
  await page.getByRole('searchbox', { name: 'Anbaupläne durchsuchen' }).fill('Paradeiser');
  await expect(cards).toHaveCount(2);

  await page.getByRole('searchbox', { name: 'Anbaupläne durchsuchen' }).fill('Knoblauch');
  const carried = cards.filter({ has: page.getByText(/^Aus Saison /) }).first();
  await expect(carried).toBeVisible();
  const planId = await carried.getAttribute('data-mobile-card-id');
  await carried.getByRole('button', { name: /Aktionen für Anbauplan Knoblauch/ }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Anbauplan-Details' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Bearbeiten' })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Duplizieren' })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Löschen' })).toHaveCount(0);
  await menu.getByRole('menuitem', { name: 'In ursprünglicher Saison öffnen' }).click();

  const originatingCard = page.locator(`[data-mobile-card-id="${planId}"]`);
  await expect(originatingCard.getByRole('button', { name: /Details ausblenden/ })).toBeVisible();
  await expect(originatingCard.getByText(/^Aus Saison /)).toHaveCount(0);
  await originatingCard.getByRole('button', { name: /Aktionen für Anbauplan Knoblauch/ }).click();
  await expect(page.getByRole('menuitem', { name: 'Bearbeiten' })).toBeVisible();
});

test('overwintering garlic is selectable in the later table and read-only in the calendar', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, 'planting-plans-carry-over-calendar', {
    demoProject: true, loginAsAdmin: true,
  });
  await page.goto('/app/planting-plans');
  const search = page.getByRole('searchbox', { name: 'Anbaupläne durchsuchen' });
  await search.fill('Knoblauch');
  const tableRows = page.locator('[role="row"][data-id]');
  const beanBed = page.locator('[data-field="bed"]').getByText('Bohnen', { exact: true });
  const carried = tableRows.filter({ has: page.getByText(/^Aus Saison /) }).filter({ has: beanBed });
  await expect(carried).toBeVisible();
  const planId = await carried.getAttribute('data-id');
  const cropCell = carried.locator('[data-field="crop"]');
  await cropCell.click();
  await expect.poll(() => cropCell.evaluate(cell => cell.contains(document.activeElement))).toBe(true);
  await cropCell.dblclick();
  await cropCell.press('Enter');
  await expect(carried).not.toHaveClass(/MuiDataGrid-row--editing/);
  await cropCell.click({ button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'In ursprünglicher Saison öffnen' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Duplizieren' })).toHaveCount(0);
  await menu.getByRole('menuitem', { name: 'Anbauplan-Details' }).click();
  const detail = page.getByRole('dialog', { name: 'Anbauplan-Details' });
  await expect(detail.getByText(/Läuft weiter aus Saison .* Hier nur lesbar/)).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Notiz oder Foto hinzufügen' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await search.fill('Buschbohne');
  const bean = tableRows.filter({ hasText: 'Buschbohne' }).filter({ has: beanBed });
  const companionWarning = bean.getByRole('img', { name: 'Schlechte Nachbarn auf dem Beet' });
  await expect(companionWarning).toBeVisible();
  await companionWarning.hover();
  await expect(page.getByRole('tooltip')).toContainText('Schlechter Nachbar auf dem Beet: Knoblauch');
  const ownPlanId = await bean.getAttribute('data-id');
  const own = tableRows.and(page.locator(`[data-id="${ownPlanId}"]`));
  const ownCell = own.locator('[data-field="crop"]');
  await ownCell.click();
  await expect(own).not.toHaveClass(/MuiDataGrid-row--editing/);
  await ownCell.dblclick();
  await expect(own).toHaveClass(/MuiDataGrid-row--editing/);
  await page.keyboard.press('Escape');

  await page.goto('/app/gantt-chart?view=field');
  await page.getByRole('textbox', { name: 'Suche nach Kultur, Beet, Parzelle oder Standort…' }).fill('Knoblauch');
  const garlicBar = page.getByTestId(`task-plan-${planId}-growth`);
  await expect(garlicBar).toHaveAttribute('aria-label', /Knoblauch.*Läuft weiter aus Saison/);
  const moveMode = page.getByRole('button', { name: 'Zeitraum verschieben', exact: true });
  await moveMode.click();
  await expect(moveMode).toHaveAttribute('aria-pressed', 'true');
  await expect(garlicBar).toHaveCSS('cursor', 'default');
  await garlicBar.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Bearbeiten' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Löschen' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'In ursprünglicher Saison öffnen' })).toBeVisible();
});
