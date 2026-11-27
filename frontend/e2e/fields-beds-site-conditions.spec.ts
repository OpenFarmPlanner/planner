import { expect, test, type Page } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject } from './utils';

type Entity = { id: number; name: string };

/** Location (sunny) → field → two beds, one overriding the light with shade (#1075). */
async function seedConditions(page: Page, prefix: string): Promise<{ location: Entity; field: Entity; sunnyBed: Entity; shadyBed: Entity }> {
  const location = await apiRequest<Entity>(page, 'POST', '/locations/', {
    name: `${prefix} Standort`, light_condition: 'sunny', irrigation: 'unavailable',
  });
  const field = await apiRequest<Entity>(page, 'POST', '/fields/', {
    name: `${prefix} Parzelle`, location: location.id, length_m: 10, width_m: 5, cultivation_environment: 'polytunnel',
  });
  const sunnyBed = await apiRequest<Entity>(page, 'POST', '/beds/', {
    name: `${prefix} Sonnenbeet`, field: field.id, length_m: 2, width_m: 1,
  });
  const shadyBed = await apiRequest<Entity>(page, 'POST', '/beds/', {
    name: `${prefix} Schattenbeet`, field: field.id, length_m: 2, width_m: 1, light_condition: 'shade',
  });
  return { location, field, sunnyBed, shadyBed };
}

/**
 * Picks an option of a row's site-condition edit cell with the mouse (#1237) and
 * saves the row by clicking outside the grid; Enter on the select reopens its menu.
 */
async function pickWithMouse(page: Page, rowId: string, field: string, option: string): Promise<void> {
  const row = page.locator(`[role="row"][data-id="${rowId}"]`);
  const cell = row.locator(`[data-field="${field}"]`);
  await cell.dblclick();
  const combobox = cell.getByRole('combobox');
  await combobox.click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(combobox).toHaveText(option);
  await expect(row).toHaveClass(/MuiDataGrid-row--editing/);
  await page.getByRole('heading', { level: 1 }).click();
  await expect(row).not.toHaveClass(/MuiDataGrid-row--editing/);
}

test.describe('related planting plans', () => {
  test.use({ serviceWorkers: 'block' });

  test('retries from the mobile detail with the keyboard and preserves an unsaved draft', async ({ page, request }, testInfo) => {
    await loginWithDeterministicProject(page, request, 'growing-area-related-plans-retry', {
      loginAsAdmin: true,
      demoProject: true,
    });
    const { results } = await apiRequest<{ results: { id: number; bed: number | null }[] }>(page, 'GET', '/planting-plans/');
    const plan = results.find(item => item.bed !== null);
    expect(plan).toBeDefined();
    const bed = await apiRequest<Entity>(page, 'GET', `/beds/${plan!.bed}/`);
    await page.evaluate(() => localStorage.setItem('ui.language', 'fr'));
    await page.setViewportSize({ width: 375, height: 800 });

    let failPlans = true;
    await page.route(url => url.pathname.endsWith('/planting-plans/') && url.searchParams.has('page_size'), route =>
      failPlans ? route.fulfill({ status: 503, json: { detail: 'Temporary test failure' } }) : route.continue(),
    );
    const detailPath = `/app/fields-beds/beds/${bed.id}`;
    await page.goto(detailPath);
    await expect(page.getByRole('heading', { level: 1, name: bed.name })).toBeVisible();
    const section = page.getByTestId('detail-section-plans');
    const error = section.getByRole('alert');
    const retry = error.getByRole('button', { name: 'Réessayer' });
    await expect(error).toContainText('Impossible de charger les séries');
    for (const viewport of [
      { width: 1440, height: 900 }, { width: 800, height: 375 }, { width: 375, height: 800 },
    ]) {
      await page.setViewportSize(viewport);
      await retry.scrollIntoViewIfNeeded();
      await expect(retry).toBeInViewport();
      await expect.poll(async () => {
        const bounds = await error.boundingBox();
        return Boolean(bounds && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width);
      }).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`plan-retry-fr-${viewport.width}x${viewport.height}.png`), animations: 'disabled' });
    }

    await page.getByRole('button', { name: 'Modifier', exact: true }).click();
    const name = page.getByRole('textbox', { name: /^Nom\b/ });
    await name.fill('Brouillon de planche');
    await retry.focus();
    await expect(retry).toBeFocused();
    failPlans = false;
    await page.keyboard.press('Enter');

    await expect(section.locator(`a[href="/app/planting-plans?planId=${plan!.id}"]`)).toBeVisible();
    await expect(error).toHaveCount(0);
    await expect(name).toHaveValue('Brouillon de planche');
    await expect(page).toHaveURL(new RegExp(`${detailPath}$`));
  });
});

test.describe('growing-area details on a phone', () => {
  test.use({ viewport: { width: 375, height: 620 }, hasTouch: true, serviceWorkers: 'block' });

  test('scopes tasks through the hierarchy and returns to the filtered list', async ({ page, request }, testInfo) => {
    await loginWithDeterministicProject(page, request, 'growing-area-detail-tasks-phone', {
      loginAsAdmin: true, demoProject: true, demoYear: 2026,
    });
    const { results: locations } = await apiRequest<{ results: Entity[] }>(page, 'GET', '/locations/');
    const site = locations.find(location => location.name === 'Hofgarten')!;
    const { results: beds } = await apiRequest<{ results: (Entity & { field: number })[] }>(page, 'GET', '/beds/');
    const bed = beds.find(item => item.name === 'Salat 1')!;
    const field = await apiRequest<Entity>(page, 'GET', `/fields/${bed.field}/`);
    const { results: bedPlans } = await apiRequest<{ results: { id: number; season: number }[] }>(page, 'GET',
      `/planting-plans/?bed=${bed.id}`);
    const { results: individualPlans } = await apiRequest<{ results: { id: number; site: number | null }[] }>(
      page, 'GET', `/planting-plans/?individual_location=${site.id}`,
    );
    const sitePlan = individualPlans.find(plan => plan.site === site.id)!;
    const { id: planId, season } = bedPlans[0];
    const bedTask = 'Beet auf Schnecken prüfen';
    const parcelTask = 'Parzellenzugang kontrollieren';
    const siteTask = 'Apfelstamm kontrollieren';
    await apiRequest(page, 'POST', '/tasks/', { title: bedTask, season, planting_plan: planId, due_date: '2026-05-14' });
    await apiRequest(page, 'POST', '/tasks/', { title: parcelTask, season, field: field.id, due_date: null });
    await apiRequest(page, 'POST', '/tasks/', { title: siteTask, season, planting_plan: sitePlan.id, due_date: null });
    await apiRequest(page, 'POST', '/tasks/', { title: 'Nicht zugeordnete Erinnerung', season, due_date: null });
    const sortedList = '/app/fields-beds?sort_fieldsBedsHierarchy=name&dir_fieldsBedsHierarchy=desc';
    await page.goto(sortedList);
    const toolbar = page.getByTestId('growing-area-search-toolbar');
    await toolbar.getByRole('searchbox').fill('Hofgarten');
    const row = page.locator(`[data-hierarchy-mobile-row-id="${bed.id}"]`);
    const individualRow = page.locator('[data-hierarchy-mobile-row-type="individualPlan"]').first();
    await expect(row).toBeVisible();
    await expect(individualRow).toBeVisible();
    await page.evaluate(() => window.scrollTo({ top: 150, behavior: 'instant' }));
    await row.scrollIntoViewIfNeeded();
    const scroll = await page.evaluate(() => window.scrollY);
    expect(scroll).toBeGreaterThan(0);
    await row.getByRole('button', { name: /Salat 1/ }).tap();
    await page.getByRole('dialog').getByRole('button', { name: 'Weitere Aktionen', exact: true }).tap();
    await page.getByRole('menuitem', { name: 'Beetdetails', exact: true }).tap();
    await expect(page).toHaveURL(new RegExp(`/fields-beds/beds/${bed.id}$`));
    const detail = page.getByTestId('growing-area-detail');
    const tasks = detail.getByRole('region', { name: 'Aufgaben', exact: true });
    const back = detail.getByRole('button', { name: 'Zurück zur Liste', exact: true });
    const heading = detail.getByRole('heading', { level: 1 });
    await expect(heading).toHaveText(bed.name);
    await expect(back).toBeInViewport();
    expect((await back.boundingBox())!.y).toBeLessThan((await heading.boundingBox())!.y);
    await expect(tasks.getByText(bedTask, { exact: true })).toBeVisible();
    await expect(tasks.getByText(parcelTask, { exact: true })).toHaveCount(0);
    await expect(tasks.getByText(siteTask, { exact: true })).toHaveCount(0);

    const breadcrumb = detail.getByRole('navigation', { name: 'Navigationspfad' });
    await breadcrumb.getByRole('link', { name: field.name, exact: true }).tap();
    await expect(heading).toHaveText(field.name);
    await expect(back).toBeVisible();
    await expect(tasks.getByText(bedTask, { exact: true })).toBeVisible();
    await expect(tasks.getByText(parcelTask, { exact: true })).toBeVisible();
    await expect(tasks.getByText(siteTask, { exact: true })).toHaveCount(0);
    await breadcrumb.getByRole('link', { name: site.name, exact: true }).tap();
    await expect(heading).toHaveText(site.name);
    await expect(back).toBeVisible();
    await expect(detail.getByTestId('detail-section-individual-plans')).toBeVisible();
    await expect(detail.getByRole('img', { name: /Freifläche außerhalb der Parzellen.*m²/ })).toBeVisible();
    await expect(detail.getByTestId('detail-section-children').getByRole('link', { name: field.name })).toBeVisible();
    await expect(tasks.getByText(bedTask, { exact: true })).toHaveCount(1);
    await expect(tasks.getByText(parcelTask, { exact: true })).toBeVisible();
    await expect(tasks.getByText(siteTask, { exact: true })).toBeVisible();
    await expect(tasks.getByText('Nicht zugeordnete Erinnerung')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('growing-area-detail-phone.png'), animations: 'disabled' });
    const status = tasks.getByRole('status');
    const before = Number((await status.textContent())?.match(/(\d+) offene Aufgabe/)?.[1]);
    expect(before).toBeGreaterThan(1);
    await tasks.getByRole('button', { name: new RegExp(`${bedTask}.*als erledigt markieren`) }).tap();
    await expect(status).toContainText(`${before - 1} offene Aufgabe`);
    await expect(tasks.getByRole('button', { name: new RegExp(`${bedTask}.*als erledigt markieren`) })).toHaveCount(0);
    let releasePlans = () => {};
    const delayedPlans = new Promise<void>(resolve => { releasePlans = resolve; });
    let plansRequested = false;
    await page.route(url => url.pathname.endsWith('/planting-plans/') && url.searchParams.get('individual_only') === 'true',
      async route => {
        plansRequested = true;
        await delayedPlans;
        await route.continue();
      }, { times: 1 });
    try {
      await back.tap();
      await expect(page).toHaveURL(new RegExp(sortedList.replace('?', '\\?') + '$'));
      await expect(toolbar.getByRole('searchbox')).toHaveValue('Hofgarten');
      await expect.poll(() => plansRequested).toBe(true);
      await expect(row).toBeAttached();
    } finally {
      releasePlans();
    }
    await expect(individualRow).toBeVisible();
    await expect(row).toBeInViewport();
    await expect.poll(async () => Math.abs(await page.evaluate(() => window.scrollY) - scroll)).toBeLessThanOrEqual(5);
    await expect(page.getByRole('dialog', { name: 'Beet bearbeiten', exact: true })).toHaveCount(0);
  });
});

test.describe('growing areas site conditions', () => {
  test('filters on inherited light and shows the optional column', async ({ page, request }) => {
    await loginWithDeterministicProject(page, request, 'fields-site-conditions-filter', { loginAsAdmin: true });
    const { sunnyBed, shadyBed } = await seedConditions(page, 'SC Filter');
    await page.goto('/app/fields-beds');

    const toolbar = page.getByTestId('growing-area-search-toolbar');
    await expect(toolbar.getByRole('searchbox', { name: 'Anbauflächen durchsuchen' })).toBeVisible();
    await expect(page.locator(`[role="row"][data-id="${shadyBed.id}"]`)).toBeVisible();
    // Hidden by default.
    await expect(page.getByRole('columnheader', { name: 'Licht' })).toHaveCount(0);

    await toolbar.getByRole('button', { name: 'Filter' }).click();
    // The moisture filter explains that it means the typical long-term moisture.
    await expect(page.getByRole('dialog').getByRole('img', { name: /langfristig üblicherweise/ })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Sonnig' }).click();
    await page.keyboard.press('Escape');

    await expect(page.locator(`[role="row"][data-id="${shadyBed.id}"]`)).toHaveCount(0);
    await expect(page.locator(`[role="row"][data-id="${sunnyBed.id}"]`)).toBeVisible();
    await expect(toolbar.getByText('Licht: Sonnig')).toBeVisible();

    await toolbar.getByRole('button', { name: 'Spalten' }).click();
    await page.getByRole('checkbox', { name: 'Licht' }).check();
    await page.keyboard.press('Escape');
    const lightCell = page.locator(`[role="row"][data-id="${sunnyBed.id}"] [data-field="light_condition"]`);
    await expect(lightCell).toHaveText('Sonnig');
    await expect(lightCell.getByTestId('site-condition-light_condition')).toHaveAttribute('data-inherited', 'true');
  });

  test('opens bed details from the row menu and returns to the list', async ({ page, request }) => {
    await loginWithDeterministicProject(page, request, 'fields-site-conditions-details', { loginAsAdmin: true });
    const { shadyBed } = await seedConditions(page, 'SC Details');
    const sortedList = '/app/fields-beds?sort_fieldsBedsHierarchy=name&dir_fieldsBedsHierarchy=desc';
    await page.goto(sortedList);
    const toolbar = page.getByTestId('growing-area-search-toolbar');
    await toolbar.getByRole('searchbox').fill('SC Details');
    await toolbar.getByRole('button', { name: 'Filter' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Schattig', exact: true }).click();
    await page.keyboard.press('Escape');

    const row = page.locator(`[role="row"][data-id="${shadyBed.id}"]`);
    await row.click({ button: 'right' });
    const menuItems = page.getByRole('menu').getByRole('menuitem');
    await expect(menuItems.first()).toHaveText('Beetdetails');
    await menuItems.first().click();

    await expect(page).toHaveURL(new RegExp(`/app/fields-beds/beds/${shadyBed.id}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'SC Details Schattenbeet' })).toBeVisible();
    await expect(page.getByTestId('detail-light_condition')).toHaveText(/Schattig/);
    await expect(page.getByTestId('detail-irrigation')).toHaveText(/Übernommen vom Standort/);

    const heading = page.getByRole('heading', { level: 1, name: 'SC Details Schattenbeet' });
    const edit = page.getByRole('button', { name: 'Bearbeiten', exact: true });
    const back = page.getByRole('button', { name: 'Zurück zur Liste', exact: true });
    await edit.click();
    await page.getByRole('textbox', { name: /^Name\b/ }).fill('Nicht gespeichert');
    const pendingConfirmation = page.waitForEvent('dialog');
    const attemptedReturn = back.click();
    const confirmation = await pendingConfirmation;
    expect(confirmation.type()).toBe('confirm');
    await confirmation.dismiss();
    await attemptedReturn;
    await expect(page.getByRole('textbox', { name: /^Name\b/ })).toHaveValue('Nicht gespeichert');
    await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
    await expect(heading).toBeVisible();
    await edit.click();
    await page.getByRole('textbox', { name: /^Name\b/ }).fill('SC Details Schattenbeet neu');
    await page.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'SC Details Schattenbeet neu' })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/app/fields-beds/beds/${shadyBed.id}$`));
    await back.click();
    await expect(page).toHaveURL(new RegExp(sortedList.replace('?', '\\?') + '$'));
    await expect(toolbar.getByRole('searchbox')).toHaveValue('SC Details');
    await expect(toolbar.getByText('Licht: Schattig')).toBeVisible();
    await expect(row).toBeVisible();
    await expect(row).toContainText('SC Details Schattenbeet neu');

    await page.getByRole('button', { name: 'Grafik', exact: true }).click();
    await page.goto(`/app/fields-beds/beds/${shadyBed.id}`);
    await page.getByRole('button', { name: 'Zurück zur Liste', exact: true }).click();
    await expect(row).toBeVisible();
  });

  test('keeps a value picked with the mouse in the inline select', async ({ page, request }) => {
    await loginWithDeterministicProject(page, request, 'fields-site-conditions-inline', { loginAsAdmin: true });
    const { location, field, sunnyBed, shadyBed } = await seedConditions(page, 'SC Inline');
    await page.goto('/app/fields-beds');
    await expect(page.locator(`[role="row"][data-id="${shadyBed.id}"]`)).toBeVisible();

    const toolbar = page.getByTestId('growing-area-search-toolbar');
    await toolbar.getByRole('button', { name: 'Spalten' }).click();
    await page.getByRole('checkbox', { name: 'Licht' }).check();
    await page.getByRole('checkbox', { name: 'Feuchtigkeit' }).check();
    await page.getByRole('checkbox', { name: 'Bewässerung verfügbar' }).check();
    await page.keyboard.press('Escape');

    await pickWithMouse(page, String(sunnyBed.id), 'irrigation', 'Verfügbar');
    await expect(page.locator(`[role="row"][data-id="${sunnyBed.id}"] [data-field="irrigation"]`)).toHaveText('Verfügbar');
    await expect.poll(async () => (await apiRequest<{ irrigation: string | null }>(page, 'GET', `/beds/${sunnyBed.id}/`)).irrigation)
      .toBe('available');

    await pickWithMouse(page, `field-${field.id}`, 'soil_moisture', 'Feucht');
    await expect.poll(async () => (await apiRequest<{ soil_moisture: string | null }>(page, 'GET', `/fields/${field.id}/`)).soil_moisture)
      .toBe('moist');

    // "Übernehmen (…)" clears the bed's own override, so the location's value shows again.
    await pickWithMouse(page, String(shadyBed.id), 'light_condition', 'Übernehmen (Sonnig)');
    const shadyLight = page.locator(`[role="row"][data-id="${shadyBed.id}"] [data-field="light_condition"]`);
    await expect(shadyLight).toHaveText('Sonnig');
    await expect(shadyLight.getByTestId('site-condition-light_condition')).toHaveAttribute('data-inherited', 'true');
    await expect.poll(async () => (await apiRequest<{ light_condition: string | null }>(page, 'GET', `/beds/${shadyBed.id}/`)).light_condition)
      .toBeNull();

    await pickWithMouse(page, `location-${location.id}`, 'light_condition', 'Schattig');
    const locationLight = page.locator(`[role="row"][data-id="location-${location.id}"] [data-field="light_condition"]`);
    await expect(locationLight).toHaveText('Schattig');
    await expect(shadyLight).toHaveText('Schattig');
    await expect(shadyLight.getByTestId('site-condition-light_condition')).toHaveAttribute('data-inherited', 'true');
  });
  test('opens the inline select on Enter without saving the row', async ({ page, request }) => {
    await loginWithDeterministicProject(page, request, 'fields-site-conditions-enter', { loginAsAdmin: true });
    const { sunnyBed } = await seedConditions(page, 'SC Enter');
    await page.goto('/app/fields-beds');
    const row = page.locator(`[role="row"][data-id="${sunnyBed.id}"]`);
    await expect(row).toBeVisible();

    const toolbar = page.getByTestId('growing-area-search-toolbar');
    await toolbar.getByRole('button', { name: 'Spalten' }).click();
    await page.getByRole('checkbox', { name: 'Licht' }).check();
    await page.keyboard.press('Escape');

    const lightCell = row.locator('[data-field="light_condition"]');
    await lightCell.dblclick();
    await expect(row).toHaveClass(/MuiDataGrid-row--editing/);
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await lightCell.getByRole('combobox').focus();

    await page.keyboard.press('Enter');
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.waitForTimeout(500);
    await expect(row).toHaveClass(/MuiDataGrid-row--editing/);

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(lightCell.getByRole('combobox')).toHaveText('Halbschattig');
    await expect(row).toHaveClass(/MuiDataGrid-row--editing/);

    await page.getByRole('heading', { level: 1 }).click();
    await expect(row).not.toHaveClass(/MuiDataGrid-row--editing/);
    await expect.poll(async () => (await apiRequest<{ light_condition: string | null }>(page, 'GET', `/beds/${sunnyBed.id}/`)).light_condition)
      .toBe('partial_shade');
  });
  test('closes an open select menu on a click in the same row without saving it', async ({ page, request }) => {
    // Wide enough that the Feuchtigkeit column is not scrolled out of view.
    await page.setViewportSize({ width: 1600, height: 900 });
    await loginWithDeterministicProject(page, request, 'fields-site-conditions-menu-row', { loginAsAdmin: true });
    const { sunnyBed } = await seedConditions(page, 'SC Menu Row');
    await page.goto('/app/fields-beds');
    const row = page.locator(`[role="row"][data-id="${sunnyBed.id}"]`);
    await expect(row).toBeVisible();

    const toolbar = page.getByTestId('growing-area-search-toolbar');
    await toolbar.getByRole('button', { name: 'Spalten' }).click();
    await page.getByRole('checkbox', { name: 'Licht' }).check();
    await page.getByRole('checkbox', { name: 'Feuchtigkeit' }).check();
    await page.keyboard.press('Escape');

    const lightCell = row.locator('[data-field="light_condition"]');
    const moistureCell = row.locator('[data-field="soil_moisture"]');
    await lightCell.dblclick();
    await lightCell.getByRole('combobox').click();
    await expect(page.getByRole('listbox')).toBeVisible();

    // The menu's backdrop covers the next select; this click only closes the menu (as in the planting plans).
    const moistureBox = await moistureCell.boundingBox();
    if (!moistureBox) throw new Error('soil moisture cell not rendered');
    await page.mouse.click(moistureBox.x + moistureBox.width / 2, moistureBox.y + moistureBox.height / 2);
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(row).toHaveClass(/MuiDataGrid-row--editing/);

    await moistureCell.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Feucht', exact: true }).click();
    await expect(row).toHaveClass(/MuiDataGrid-row--editing/);

    // A click outside the row while a menu is open still saves the row. The open
    // menu's backdrop covers the page (and hides it from role queries), so click
    // the heading's position like a user would.
    const headingBox = await page.getByRole('heading', { level: 1 }).boundingBox();
    if (!headingBox) throw new Error('page heading not rendered');
    await lightCell.getByRole('combobox').click();
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.mouse.click(headingBox.x + headingBox.width / 2, headingBox.y + headingBox.height / 2);
    await expect(row).not.toHaveClass(/MuiDataGrid-row--editing/);
    await expect.poll(async () => (await apiRequest<{ soil_moisture: string | null }>(page, 'GET', `/beds/${sunnyBed.id}/`)).soil_moisture)
      .toBe('moist');
  });
});
