import { expect, test, type Request } from '@playwright/test';
import common from '../src/i18n/locales/de/common.json' with { type: 'json' };
import calendar from '../src/i18n/locales/de/ganttChart.json' with { type: 'json' };
import navigation from '../src/i18n/locales/de/navigation.json' with { type: 'json' };
import plans from '../src/i18n/locales/de/plantingPlans.json' with { type: 'json' };
import calendarEn from '../src/i18n/locales/en/ganttChart.json' with { type: 'json' };
import calendarEs from '../src/i18n/locales/es/ganttChart.json' with { type: 'json' };
import calendarFr from '../src/i18n/locales/fr/ganttChart.json' with { type: 'json' };
import calendarIt from '../src/i18n/locales/it/ganttChart.json' with { type: 'json' };
import calendarNl from '../src/i18n/locales/nl/ganttChart.json' with { type: 'json' };
import calendarPt from '../src/i18n/locales/pt/ganttChart.json' with { type: 'json' };
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
    const earlierLabel = 'Test A – Wintergarten am nördlichen Rand des Gemeinschaftsprojekts';
    const earlier = await apiRequest<{ id: number }>(page, 'POST', '/seasons/', {
      start_date: '2026-01-01', end_date: '2026-12-31', custom_label: earlierLabel,
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
    await page.evaluate((id) => {
      localStorage.setItem(`activeSeasonId:${localStorage.getItem('activeProjectId')}`, String(id));
    }, later.id);
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
    const winterTask = task(winterPlan.id);
    const description = plans.carriedOver.description.replace('{{season}}', earlierLabel);
    await expect(winterTask).toHaveAccessibleName(`Test lettuce · ${description}`);
    await expect(winterTask.locator('.rmg-task-item-leading-icon')).toHaveCount(1);
    await expect(winterTask).not.toContainText(earlierLabel);
    await winterTask.focus();
    const tooltip = page.getByRole('tooltip').filter({ hasText: description });
    await expect(tooltip).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tooltip).toBeHidden();
    await expect(task(original.id)).toHaveCount(0);
    await expect(empty).toBeHidden();
  } finally {
    await resetE2EScenario(request, scenario);
  }
});

test.describe('recurring harvest dates', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('one perennial plan shows eligible harvest dates in each season', async ({ page, request }, info) => {
    const scenario = `recurring-harvest-scope-${Date.now()}`;
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await loginWithDeterministicProject(page, request, scenario, { loginAsAdmin: true });
      const create = (path: string, data: Record<string, unknown>) => apiRequest<{ id: number }>(page, 'POST', path, data);
      const seasons = [];
      for (const year of [2025, 2026, 2027, 2028]) {
        seasons.push(await create('/seasons/', {
          start_date: `${year}-01-01`, end_date: `${year}-12-31`, custom_label: `Obstjahr ${year}`,
        }));
      }
      const location = await create('/locations/', { name: 'Obstgarten' });
      const field = await create('/fields/', { location: location.id, name: 'Obstparzelle' });
      const bed = await create('/beds/', { field: field.id, name: 'Obstbeet', area_sqm: 12 });
      const crop = await create('/crops/', {
        name: 'Versuchsapfel', life_cycle: 'perennial', standing_time_years: 8,
        annual_harvest_window: '09-01/10-15', first_harvest_delay_years: 2,
        cultivation_type: 'direct_sowing', cultivation_types: ['direct_sowing'],
      });
      const plan = await create('/planting-plans/', {
        crop: crop.id, bed: bed.id, season: seasons[0].id, planting_date: '2025-03-15',
        area_usage_sqm: 8, cultivation_type: 'direct_sowing',
        clearing_date: '2028-09-10', actual_harvest_start_date: '2025-10-03',
      });

      await page.goto('/app/planting-plans');
      const switchSeason = async (year: number) => {
        await page.getByRole('button', { name: navigation.seasonSwitcher.ariaLabel }).click();
        await page.getByRole('menuitem', { name: new RegExp(`Obstjahr ${year}`) }).click();
        await expect(page.getByRole('button', { name: navigation.seasonSwitcher.ariaLabel }))
          .toContainText(`Obstjahr ${year}`);
      };
      const mode = page.getByRole('button', { name: new RegExp(`^${plans.actualDates.modeLabel} `) });
      const selectMode = async (value: keyof typeof plans.actualDates.displayModes) => {
        await mode.click();
        await page.getByRole('menuitemradio', { name: plans.actualDates.displayModes[value], exact: true }).click();
      };
      const row = page.locator(`[role="row"][data-id="${plan.id}"]`);
      const harvestStart = row.locator('[data-field="harvest_date"]');
      const harvestEnd = row.locator('[data-field="harvest_end_date"]');
      const plantingDate = row.locator('[data-field="planting_date"]');

      await switchSeason(2025);
      await selectMode('planned');
      await expect(harvestStart).toHaveText('—');
      await expect(plantingDate).toHaveText('15.3.2025');
      await selectMode('actual');
      await expect(harvestStart).toHaveText('3.10.2025');
      await selectMode('combined');
      await expect(harvestStart).toHaveText('3.10.2025');

      await switchSeason(2026);
      await selectMode('actual');
      await expect(harvestStart).toHaveText('—');
      await selectMode('combined');
      await expect(harvestStart).toHaveText('—');
      await expect(plantingDate).toHaveText('15.3.2025');
      await page.goto('/app/gantt-chart?view=field');
      const bar = page.getByTestId(`task-plan-${plan.id}-occupancy`);
      const phase = bar.locator('[data-rmg-component="task-phase-band"]');
      await expect(bar).toHaveAccessibleName(new RegExp(calendar.tooltip.noSeasonalHarvest.replace('.', '\\.')));
      await expect(phase).toHaveCount(0);

      await switchSeason(2027);
      await expect(bar).toHaveAccessibleName(/Versuchsapfel.*Obstjahr 2025.*Geplante Saisonernte.*1\.9\.2027.*15\.10\.2027/);
      await expect(phase).toHaveCount(1);
      const barBounds = (await bar.boundingBox())!;
      const phaseBounds = (await phase.boundingBox())!;
      expect(phaseBounds.x).toBeGreaterThan(barBounds.x);
      expect(phaseBounds.x + phaseBounds.width).toBeLessThan(barBounds.x + barBounds.width);
      const months = page.locator('[data-rmg-component="timeline-unit"]');
      const september = (await months.filter({ hasText: /^Sep.*2027$/ }).boundingBox())!;
      const october = (await months.filter({ hasText: /^Okt.*2027$/ }).boundingBox())!;
      expect(phaseBounds.x).toBeCloseTo(september.x, 0);
      expect(phaseBounds.x + phaseBounds.width).toBeCloseTo(october.x + 15 / 31 * october.width, 0);
      await bar.focus();
      const tooltip = page.getByRole('tooltip').filter({ hasText: calendar.tooltip.seasonalHarvest });
      await expect(tooltip).toBeVisible();
      await expect(tooltip).toContainText('15.10.2027');
      await expect(tooltip).toContainText('15.3.2025');
      await expect(tooltip).toContainText('10.9.2028');
      await page.keyboard.press('Escape');
      await expect(tooltip).toBeHidden();
      const calendarTaskPrefix = `[data-rmg-component="task"][data-task-id^="plan-${plan.id}-"]`;
      await expect(page.getByTestId('gantt-virtual-viewport').locator(calendarTaskPrefix)).toHaveCount(1);
      await phase.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath('recurring-calendar-desktop.png'), animations: 'disabled' });

      await page.goto('/app/planting-plans');
      await selectMode('planned');
      await expect(harvestStart).toHaveText('1.9.2027');
      await expect(harvestEnd).toHaveText('15.10.2027');
      await selectMode('actual');
      await expect(harvestStart).toHaveText('—');
      await harvestStart.press('Enter');
      const actualStart = harvestStart.getByRole('textbox', { name: 'Ist-Erntebeginn' });
      await expect(actualStart).toHaveValue('01.09.2027');
      await actualStart.press('Escape');
      await expect(harvestStart).toHaveText('—');
      await selectMode('combined');
      await expect(harvestStart).toHaveText('1.9.2027');
      await expect(plantingDate).toHaveText('15.3.2025');

      await switchSeason(2028);
      await expect(harvestEnd).toHaveText('10.9.2028');
      await page.setViewportSize({ width: 375, height: 800 });
      const card = page.locator(`[data-mobile-card-id="${plan.id}"]`);
      await card.getByRole('button', { name: /Details anzeigen/ }).click();
      await expect(card.getByText(`${plans.actualDates.activities.harvestStart} 1.9.2028`, { exact: true })).toBeVisible();
      await expect(card.getByText(`${plans.actualDates.activities.harvestEnd} 10.9.2028`, { exact: true })).toBeVisible();
      await expectNoHorizontalPageOverflow(page);
      await page.screenshot({ path: info.outputPath('recurring-card-mobile.png'), animations: 'disabled' });
      await card.getByRole('button', { name: /Aktionen für Anbauplan Versuchsapfel/ }).click();
      await expect(page.getByRole('menuitem', { name: 'Bearbeiten' })).toHaveCount(0);
      await page.getByRole('menuitem', { name: 'In ursprünglicher Saison öffnen' }).click();
      await expect(card.getByRole('button', { name: /Details ausblenden/ })).toBeVisible();
      await card.getByRole('button', { name: /Aktionen für Anbauplan Versuchsapfel/ }).click();
      await expect(page.getByRole('menuitem', { name: 'Bearbeiten' })).toBeVisible();
      expect(await apiRequest(page, 'GET', `/planting-plans/${plan.id}/`)).toMatchObject({
        id: plan.id, season: seasons[0].id, bed: bed.id, planting_date: '2025-03-15',
        clearing_date: '2028-09-10', actual_harvest_start_date: '2025-10-03',
      });

      await test.step('edit a single future harvest in origin details and reset it', async () => {
        const detailsUrl = `/app/planting-plans/${plan.id}`;
        await page.goto(detailsUrl);
        const heading = page.getByRole('heading', { name: plans.harvestWindows.title });
        const year = page.getByRole('combobox', { name: plans.harvestWindows.year });
        const edit = page.getByRole('button', { name: plans.harvestWindows.edit });
        const reset = page.getByRole('button', { name: plans.harvestWindows.reset });
        const start = page.getByLabel(plans.columns.harvestStartDate, { exact: true });
        const end = page.getByLabel(plans.columns.harvestEndDate, { exact: true });
        await expect(heading).toBeVisible();
        await year.selectOption('2027');
        await edit.press('Enter');
        await expect(start).toBeFocused();
        await start.fill('2027-09-10');
        await start.press('Escape');
        await expect(year).toBeFocused();
        await expect(reset).toHaveCount(0);

        await edit.click();
        await start.fill('2027-09-10');
        await end.fill('2027-10-20');
        for (const [width, height] of [[375, 800], [800, 375], [768, 900], [1024, 900], [1440, 900]]) {
          await page.setViewportSize({ width, height });
          await start.scrollIntoViewIfNeeded();
          await expectNoHorizontalPageOverflow(page);
          await page.screenshot({ path: info.outputPath(`harvest-window-editor-${width}.png`), animations: 'disabled' });
        }
        const refreshedDetail = page.waitForResponse(response => {
          const url = new URL(response.url());
          return response.request().method() === 'GET' && response.ok()
            && url.pathname.endsWith(`/planting-plans/${plan.id}/`)
            && url.searchParams.get('harvest_year') === '2027';
        });
        await page.getByRole('button', { name: common.actions.save, exact: true }).click();
        await refreshedDetail;
        await expect(reset).toBeVisible();
        await expect(page.getByText('10.9.2027 – 20.10.2027', { exact: true })).toBeVisible();

        await switchSeason(2027);
        await expect(page.getByText('10.9.2027 – 20.10.2027', { exact: true })).toBeVisible();
        await expect(edit).toHaveCount(0);
        await expect(reset).toHaveCount(0);
        await page.goto('/app/planting-plans');
        await selectMode('planned');
        await expect(harvestStart).toHaveText('10.9.2027');
        await expect(harvestEnd).toHaveText('20.10.2027');
        await page.goto('/app/gantt-chart?view=field');
        await expect(bar).toHaveAccessibleName(/Versuchsapfel.*10\.9\.2027.*20\.10\.2027/);

        await switchSeason(2028);
        await page.goto('/app/planting-plans');
        await expect(harvestEnd).toHaveText('10.9.2028');
        await page.goto(detailsUrl);
        await page.getByRole('button', { name: plans.carriedOver.openOrigin }).click();
        await expect(edit).toBeVisible();
        await year.selectOption('2027');
        await reset.click();
        await expect(reset).toHaveCount(0);
        await expect(page.getByText('1.9.2027 – 15.10.2027', { exact: true })).toBeVisible();
        await expect(year).toBeFocused();

        await apiRequest(page, 'PATCH', `/planting-plans/${plan.id}/`, { clearing_date: '2070-12-31' });
        await page.reload();
        await expect(year.locator('option')).toHaveCount(20);
        await page.getByRole('button', { name: plans.harvestWindows.nextYears }).click();
        await expect(year).toHaveValue('2047');
        await expect(year.locator('option')).toHaveCount(20);
        await page.getByRole('button', { name: plans.harvestWindows.previousYears }).click();
        await expect(year).toHaveValue('2046');
        await switchSeason(2027);
        await expect(year).toHaveValue('2027');
        await page.getByRole('button', { name: plans.carriedOver.openOrigin }).click();
        await expect(edit).toBeVisible();
        await apiRequest(page, 'PATCH', `/planting-plans/${plan.id}/`, { clearing_date: '2028-09-10' });
      });

      await test.step('moving the occupancy bar keeps the harvest band on its calendar dates', async () => {
        await apiRequest(page, 'PATCH', `/crops/${crop.id}/`, { first_harvest_delay_years: 0 });
        const earlierBed = await create('/beds/', { field: field.id, name: 'Frühes Obstbeet', area_sqm: 12 });
        await create('/planting-plans/', {
          crop: crop.id, bed: earlierBed.id, season: seasons[0].id, planting_date: '2025-01-01',
          area_usage_sqm: 8, cultivation_type: 'direct_sowing', clearing_date: '2025-02-28',
        });
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto('/app/gantt-chart?view=field');
        await page.getByRole('button', { name: /^Zeitraum verschieben/ }).click();
        await expect(phase).toHaveCount(1);
        await page.getByTestId('gantt-virtual-viewport').locator('.rmg-container').evaluate(element => {
          element.scrollTo({ left: 0, behavior: 'instant' });
        });
        const originalBar = (await bar.boundingBox())!;
        const originalPhase = (await phase.boundingBox())!;
        const x = originalBar.x + 50;
        const y = originalBar.y + originalBar.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x - 75, y, { steps: 8 });
        await expect.poll(async () => (await bar.boundingBox())!.x).toBeLessThan(originalBar.x - 35);
        expect((await phase.boundingBox())!.x).toBeCloseTo(originalPhase.x, 0);
        await page.keyboard.press('Escape');
        await page.mouse.up();
        await expect.poll(async () => (await bar.boundingBox())!.x).toBeCloseTo(originalBar.x, 0);

        const updatePath = new RegExp(`/planting-plans/${plan.id}/$`);
        let releaseWrite!: () => void;
        const writeHeld = new Promise<void>(resolve => { releaseWrite = resolve; });
        await page.route(updatePath, async route => {
          if (route.request().method() === 'PUT') await writeHeld;
          await route.continue();
        });
        const nextSave = page.waitForResponse(response => response.request().method() === 'PUT'
          && updatePath.test(response.url()));
        try {
          await page.mouse.move(x, y);
          await page.mouse.down();
          await page.mouse.move(x - 60, y, { steps: 8 });
          await expect.poll(async () => (await bar.boundingBox())!.x).toBeLessThan(originalBar.x - 35);
          const pendingWrite = page.waitForRequest(entry => entry.method() === 'PUT' && updatePath.test(entry.url()));
          await page.mouse.up();
          await pendingWrite;
          await expect(bar).toHaveAttribute('data-dragging', 'false');
          await expect.poll(async () => (await bar.boundingBox())!.x).toBeLessThan(originalBar.x - 35);
          expect((await phase.boundingBox())!.x).toBeCloseTo(originalPhase.x, 0);
        } finally {
          releaseWrite();
        }
        expect((await nextSave).ok()).toBe(true);
        await page.unroute(updatePath);
        await apiRequest(page, 'PATCH', `/planting-plans/${plan.id}/`, {
          planting_date: '2025-03-15', clearing_date: '2028-09-10',
        });
      });

      await test.step('earlier recorded sowing can start a zero-delay harvest before the planned date', async () => {
        await apiRequest(page, 'PATCH', `/crops/${crop.id}/`, { annual_harvest_window: '03-11/03-12' });
        await apiRequest(page, 'PATCH', `/planting-plans/${plan.id}/`, { actual_sowing_date: '2025-03-10' });
        await page.reload();
        await expect(bar).toHaveAccessibleName(/Geplante Saisonernte.*11\.3\.2025.*12\.3\.2025/);
        await expect(phase).toHaveCount(1);
        expect((await phase.boundingBox())!.x).toBeGreaterThan((await bar.boundingBox())!.x);
        expect((await phase.boundingBox())!.width).toBeGreaterThan(1);
        const moveMode = page.getByRole('button', { name: /^Zeitraum verschieben/ });
        if (await moveMode.getAttribute('aria-pressed') === 'false') await moveMode.click();
        await expect(moveMode).toHaveAttribute('aria-pressed', 'true');
        await expect(bar).toHaveCSS('cursor', 'default');
        await bar.focus();
        const earlyHarvest = page.getByRole('tooltip').filter({ hasText: '11.3.2025' });
        await expect(earlyHarvest).toContainText('15.3.2025');
        await expect(earlyHarvest).toContainText(calendar.tooltip.recordedPlantingEdit);
        await page.keyboard.press('Escape');
        await bar.click({ button: 'right' });
        await expect(page.getByRole('menuitem', { name: 'Bearbeiten' })).toBeVisible();
        await page.goto('/app/planting-plans');
        await selectMode('planned');
        await expect(plantingDate).toHaveText('15.3.2025');
        await expect(harvestStart).toHaveText('11.3.2025');
      });

      await test.step('an actual start in the preceding season keeps the original plan read-only there', async () => {
        await create('/seasons/', {
          start_date: '2024-01-01', end_date: '2024-12-31', custom_label: 'Obstjahr 2024',
        });
        await apiRequest(page, 'PATCH', `/crops/${crop.id}/`, { annual_harvest_window: '12-20/12-25' });
        await apiRequest(page, 'PATCH', `/planting-plans/${plan.id}/`, { actual_sowing_date: '2024-12-17' });
        await page.reload();
        await switchSeason(2024);
        await expect(harvestStart).toHaveText('20.12.2024');
        await expect(harvestEnd).toHaveText('25.12.2024');
        const sourceLabel = plans.carriedOver.otherSeasonDescription.replace('{{season}}', 'Obstjahr 2025');
        await expect(row.getByRole('button', { name: sourceLabel })).toBeVisible();
        await page.goto('/app/gantt-chart?view=field');
        await expect(bar).toHaveAccessibleName(/Obstjahr 2025.*20\.12\.2024.*25\.12\.2024/);
        await expect(phase).toHaveCount(1);
        await bar.click({ button: 'right' });
        await expect(page.getByRole('menuitem', { name: 'Bearbeiten' })).toHaveCount(0);
        await expect(page.getByRole('menuitem', { name: 'In ursprünglicher Saison öffnen' })).toBeVisible();
      });
    } finally {
      await resetE2EScenario(request, scenario);
    }
  });
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
  const indicator = page.getByRole('button', { name: /^Läuft weiter aus Saison .* Hier nur lesbar\.$/ });
  const carried = cards.filter({ has: indicator }).first();
  await expect(carried).toBeVisible();
  const planId = await carried.getAttribute('data-mobile-card-id');
  await carried.getByRole('button', { name: /Hier nur lesbar/ }).press('Space');
  const preview = page.getByRole('tooltip').filter({ hasText: /Läuft weiter aus Saison/ });
  await expect(preview).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(preview).toBeHidden();
  await carried.getByRole('button', { name: /Aktionen für Anbauplan Knoblauch/ }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Anbauplan-Details' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Bearbeiten' })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Duplizieren' })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Löschen' })).toHaveCount(0);
  await menu.getByRole('menuitem', { name: 'In ursprünglicher Saison öffnen' }).click();

  const originatingCard = page.locator(`[data-mobile-card-id="${planId}"]`);
  await expect(originatingCard.getByRole('button', { name: /Details ausblenden/ })).toBeVisible();
  await expect(originatingCard.getByRole('button', { name: /Hier nur lesbar/ })).toHaveCount(0);
  await originatingCard.getByRole('button', { name: /Aktionen für Anbauplan Knoblauch/ }).click();
  await expect(page.getByRole('menuitem', { name: 'Bearbeiten' })).toBeVisible();
});

test('overwintering garlic is selectable in the later table and read-only in the calendar', async ({ page, request }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, 'planting-plans-carry-over-calendar', {
    demoProject: true, loginAsAdmin: true,
  });
  await page.goto('/app/planting-plans');
  const search = page.getByRole('searchbox', { name: 'Anbaupläne durchsuchen' });
  await search.fill('Knoblauch');
  const tableRows = page.locator('[role="row"][data-id]');
  const beanBed = page.locator('[data-field="bed"]').getByText('Bohnen', { exact: true });
  const indicator = page.getByRole('button', { name: /^Läuft weiter aus Saison .* Hier nur lesbar\.$/ });
  const carried = tableRows.filter({ has: indicator }).filter({ has: beanBed });
  await expect(carried).toBeVisible();
  const planId = await carried.getAttribute('data-id');
  const cropCell = carried.locator('[data-field="crop"]');
  await cropCell.getByRole('button', { name: /Hier nur lesbar/ }).hover();
  await expect(page.getByRole('tooltip')).toContainText(/Läuft weiter aus Saison/);
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
  await expect(detail.getByText(plans.details.originReadOnly.replace('{{season}}', '2025'), { exact: true })).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Notiz oder Foto hinzufügen' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  const original = await apiRequest<Record<string, unknown>>(page, 'GET', `/planting-plans/${planId}/?across_seasons=true`);
  const dateMode = page.getByRole('button', { name: /^Terminansicht / });
  await dateMode.click();
  await page.getByRole('menuitemradio', { name: 'Tatsächlich', exact: true }).click();
  const harvestStart = carried.locator('[data-field="harvest_date"]');
  await expect(harvestStart).toHaveText('—');
  await expect(harvestStart).toHaveClass(/ofp-cell-calculated/);
  await harvestStart.press('Enter');
  const actualStart = harvestStart.getByRole('textbox', { name: 'Ist-Erntebeginn' });
  await expect(actualStart).toBeFocused();
  await actualStart.fill('11.07.2026');
  await actualStart.press('Enter');
  await expect(harvestStart).toHaveText('11.7.2026');
  await expect(harvestStart).toHaveClass(/ofp-cell-calculated/);
  await dateMode.focus();
  await page.screenshot({ path: info.outputPath('carried-harvest-grid.png'), animations: 'disabled' });
  await dateMode.click();
  await page.getByRole('menuitemradio', { name: 'Geplant', exact: true }).click();
  await harvestStart.press('Enter');
  await expect(actualStart).toHaveCount(0);

  await page.setViewportSize({ width: 375, height: 800 });
  await expect(dateMode).toHaveCount(0);
  const garlicCard = page.locator(`[data-mobile-card-id="${planId}"]`);
  await garlicCard.getByRole('button', { name: /^Knoblauch/ }).click();
  const harvestDates = page.getByRole('heading', { name: 'Erntetermine', exact: true }).locator('..');
  await expect(harvestDates.getByText('11.7.2026', { exact: true })).toBeVisible();
  await harvestDates.getByRole('button', { name: 'Ist-Termine erfassen' }).click();
  await harvestDates.getByLabel('Ist-Ernteende', { exact: true }).fill('2026-07-21');
  await harvestDates.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(harvestDates.getByText('21.7.2026', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('carried-harvest-details.png'), animations: 'disabled' });
  expect(await apiRequest(page, 'GET', `/planting-plans/${planId}/?across_seasons=true`)).toMatchObject({
    season: original.season, bed: original.bed, planting_date: original.planting_date,
    harvest_date: original.harvest_date, harvest_end_date: original.harvest_end_date,
    actual_harvest_start_date: '2026-07-11', recorded_harvest_end_date: '2026-07-21',
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/planting-plans');
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
  await garlicBar.focus();
  await expect(page.getByRole('tooltip').filter({ hasText: /Läuft weiter aus Saison/ })).toBeVisible();
  const moveMode = page.getByRole('button', { name: /^Zeitraum verschieben/ });
  await moveMode.click();
  await expect(moveMode).toHaveAttribute('aria-pressed', 'true');
  await expect(garlicBar).toHaveCSS('cursor', 'default');
  await garlicBar.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Bearbeiten' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Löschen' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'In ursprünglicher Saison öffnen' })).toBeVisible();
});

test.describe('recurring harvest across the calendar axis', () => {
  test.use({ hasTouch: true, timezoneId: 'America/Los_Angeles' });

  test('keeps the standing crop and its harvest phases visible into the next year', async ({ page, request }, info) => {
    const scenario = `perennial-calendar-axis-${Date.now()}`;
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await loginWithDeterministicProject(page, request, scenario, { loginAsAdmin: true });
      const create = (path: string, data: Record<string, unknown>) => apiRequest<{ id: number }>(page, 'POST', path, data);
      const origin = await create('/seasons/', { start_date: '2024-01-01', end_date: '2024-12-31' });
      const active = await create('/seasons/', { start_date: '2026-01-01', end_date: '2026-12-31' });
      const location = await create('/locations/', { name: 'Kalenderhof' });
      const field = await create('/fields/', { location: location.id, name: 'Kalenderparzelle' });
      const rhubarbBed = await create('/beds/', { field: field.id, name: 'Rhabarberbeet', area_sqm: 12 });
      const annualBed = await create('/beds/', { field: field.id, name: 'Überwinterung', area_sqm: 12 });
      const rhubarb = await create('/crops/', {
        name: 'Kalenderrhabarber', life_cycle: 'perennial', standing_time_years: 10,
        annual_harvest_window: '03-12/04-09', cultivation_types: ['direct_sowing'],
      });
      const annual = await create('/crops/', {
        name: 'Testwinterkohl', life_cycle: 'annual', growth_duration_days: 150, harvest_duration_days: 46,
        cultivation_types: ['direct_sowing'],
      });
      const standingPlan = await create('/planting-plans/', {
        crop: rhubarb.id, bed: rhubarbBed.id, season: origin.id,
        planting_date: '2024-05-01', clearing_date: '2030-09-30',
        area_usage_sqm: 8, cultivation_type: 'direct_sowing',
      });
      await create('/planting-plans/', {
        crop: annual.id, bed: annualBed.id, season: active.id,
        planting_date: '2026-10-01', area_usage_sqm: 8, cultivation_type: 'direct_sowing',
      });

      await page.goto('/app/gantt-chart?view=field');
      const season = page.getByRole('button', { name: navigation.seasonSwitcher.ariaLabel });
      await season.click();
      await page.getByRole('menuitem', { name: /^2026/ }).click();
      await expect(season).toContainText('2026');
      const scale = page.getByRole('group', { name: calendar.chartLocaleText.titleOccupancy });
      const bar = page.getByTestId(`task-plan-${standingPlan.id}-occupancy`);
      const bands = bar.locator('[data-rmg-component="task-phase-band"]');
      const units = page.locator('[data-rmg-component="timeline-unit"]');

      for (const zoom of ['month', 'week'] as const) {
        await scale.getByRole('button', { name: calendar.chartLocaleText.viewModes[zoom], exact: true }).click();
        await expect(bar).toHaveAccessibleName(/Kalenderrhabarber.*2024.*12\.3\.2027.*9\.4\.2027/);
        await expect(bands).toHaveCount(2);
        await expect.poll(async () => {
          const occupancy = (await bar.boundingBox())!;
          const lastColumn = (await units.last().boundingBox())!;
          return occupancy.x + occupancy.width - lastColumn.x - lastColumn.width;
        }).toBeCloseTo(0, 0);

        await bands.last().scrollIntoViewIfNeeded();
        await bar.focus();
        const tooltip = page.getByRole('tooltip').filter({ hasText: calendar.tooltip.seasonalHarvest });
        await expect(tooltip).toContainText('9.4.2027');
        await expect(tooltip).toContainText('1.5.2024');
        await expect(tooltip).toContainText('30.9.2030');
        await expect.poll(async () => {
          const preview = (await tooltip.boundingBox())!;
          const sidebar = (await page.locator('[data-rmg-component="task-list"]').boundingBox())!;
          return preview.x + preview.width / 2 - sidebar.x - sidebar.width;
        }).toBeGreaterThan(0);
        await page.screenshot({ path: info.outputPath(`perennial-axis-${zoom}-desktop.png`), animations: 'disabled' });
        await page.keyboard.press('Escape');
      }

      await page.setViewportSize({ width: 375, height: 800 });
      await bands.last().scrollIntoViewIfNeeded();
      const harvestBand = (await bands.last().boundingBox())!;
      await page.touchscreen.tap(harvestBand.x + harvestBand.width / 2, harvestBand.y + harvestBand.height / 2);
      await expect(page.getByRole('tooltip').filter({ hasText: calendar.tooltip.seasonalHarvest }))
        .toContainText('9.4.2027');
      await expectNoHorizontalPageOverflow(page);
      await page.screenshot({ path: info.outputPath('perennial-axis-mobile.png'), animations: 'disabled' });

      await apiRequest(page, 'PATCH', `/planting-plans/${standingPlan.id}/`, { clearing_date: '2027-03-20' });
      await page.reload();
      await expect(bar).toHaveAccessibleName(/12\.3\.2027.*20\.3\.2027/);
      const clearingWeek = units.and(page.locator('[data-timeunit^="2027-03-18"]'));
      await expect.poll(async () => {
        const shortened = (await bar.boundingBox())!;
        const week = (await clearingWeek.boundingBox())!;
        return shortened.x + shortened.width - week.x - week.width * 3 / 7;
      }).toBeCloseTo(0, 0);
      const saved = await apiRequest<{ results: Array<{ id: number; season: number; planting_date: string }> }>(
        page, 'GET', '/planting-plans/',
      );
      expect(saved.results.filter(row => row.id === standingPlan.id)).toEqual([
        expect.objectContaining({ id: standingPlan.id, season: origin.id, planting_date: '2024-05-01' }),
      ]);

      await apiRequest(page, 'PATCH', `/crops/${rhubarb.id}/`, { first_harvest_delay_years: 4 });
      const translations = { de: calendar, en: calendarEn, es: calendarEs, fr: calendarFr,
        it: calendarIt, nl: calendarNl, pt: calendarPt };
      for (const [language, text] of Object.entries(translations)) {
        if (language === 'fr') await page.setViewportSize({ width: 800, height: 375 });
        if (language === 'it') await page.setViewportSize({ width: 375, height: 800 });
        await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: language });
        await page.evaluate(code => {
          localStorage.setItem('ui.language', code);
          localStorage.setItem('ui.language.pendingChoice', code);
        }, language);
        await page.reload();
        await expect(page.locator('html')).toHaveAttribute('lang', language);
        await expect(bar).toHaveAccessibleName(new RegExp(text.tooltip.noSeasonalHarvest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        await expect(bands).toHaveCount(0);
        await bar.focus();
        await expect(page.getByRole('tooltip').filter({ hasText: text.tooltip.noSeasonalHarvest })).toBeInViewport({ ratio: 1 });
        await expectNoHorizontalPageOverflow(page);
        await page.screenshot({ path: info.outputPath(`perennial-no-harvest-${language}.png`), animations: 'disabled' });
      }
    } finally {
      await resetE2EScenario(request, scenario);
    }
  });
});
