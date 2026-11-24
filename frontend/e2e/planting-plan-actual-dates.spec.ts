import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject } from './utils';

test.use({ serviceWorkers: 'block', timezoneId: 'America/Los_Angeles' });

const table = '/app/planting-plans';

async function seedPlans(page: Page, request: APIRequestContext, scenario: string) {
  await loginWithDeterministicProject(page, request, scenario, { loginAsAdmin: true });
  const create = (path: string, data: Record<string, unknown>) => apiRequest<{ id: number }>(page, 'POST', path, data);
  const season = await create('/seasons/', { start_date: '2026-01-01', end_date: '2026-12-31' });
  const location = await create('/locations/', { name: 'Versuchshof' });
  const field = await create('/fields/', { location: location.id, name: 'Testparzelle' });
  const bed = await create('/beds/', { field: field.id, name: 'Versuchsbeet', length_m: 15, width_m: 1 });
  const crop = await create('/crops/', {
    name: 'Terminkohl', cultivation_type: 'pre_cultivation', cultivation_types: ['pre_cultivation', 'direct_sowing'],
    propagation_duration_days: 21, growth_duration_days: 30, harvest_duration_days: 10,
  });
  const seed = (plannedDate: string, actualDate: string | null, harvest: string | null) => create('/planting-plans/', {
    season: season.id, crop: crop.id, bed: bed.id, cultivation_type: 'pre_cultivation',
    planting_date: plannedDate, area_usage_sqm: 1, actual_transplanting_date: actualDate,
    actual_harvest_start_date: harvest,
  });
  const first = await seed('2026-04-04', '2026-07-11', '2026-09-07');
  const second = await seed('2026-05-09', '2026-03-20', null);
  const third = await seed('2026-06-01', null, null);
  return { first, second, third, season, bed, crop };
}

test('the grid sorts, filters and edits the displayed dates without writing planned values', async ({ page, request }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { first, second, third, season, bed, crop } = await seedPlans(page, request, 'actual-dates-grid');
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => window.sessionStorage.setItem('copiedPlan', text),
      },
    });
  });
  await page.goto(table);
  const project = await page.evaluate(() => Number(localStorage.getItem('activeProjectId')));
  const modes = page.getByRole('button', { name: /^Terminansicht / });
  const menu = page.getByRole('menu', { name: 'Terminansicht' });
  const selectMode = async (name: string) => {
    await modes.click();
    await menu.getByRole('menuitemradio', { name, exact: true }).click();
    await expect(modes.getByText(name, { exact: true })).toBeVisible();
  };
  const grid = page.getByRole('grid');
  const rows = grid.locator('[role="row"][data-id]');
  const rowIds = () => rows.evaluateAll(list => list.map(row => Number(row.getAttribute('data-id'))));
  const cell = (id: number) => grid.locator(`[role="row"][data-id="${id}"] [data-field="planting_date"]`);

  await expect(modes.getByText('Geplant', { exact: true })).toBeVisible();
  const toolbar = page.getByTestId('planting-plan-search-toolbar');
  const columns = toolbar.getByRole('button', { name: 'Spalten', exact: true });
  const filterBox = (await toolbar.getByRole('button', { name: 'Filter', exact: true }).boundingBox())!;
  const columnsBox = (await columns.boundingBox())!;
  const modeBox = (await modes.boundingBox())!;
  expect(Math.abs(columnsBox.y - filterBox.y)).toBeLessThan(2);
  expect(modeBox.x).toBeGreaterThan(columnsBox.x + columnsBox.width);
  expect(Math.abs(modeBox.y + modeBox.height / 2 - columnsBox.y - columnsBox.height / 2)).toBeLessThan(4);
  expect(Math.abs(modeBox.height - columnsBox.height)).toBeLessThanOrEqual(1);
  await expect(toolbar.getByRole('button', { name: 'Info zur Terminanzeige' })).toHaveCount(0);
  await modes.press('Enter');
  const combined = menu.getByRole('menuitemradio', { name: 'Plan mit Ist', exact: true });
  const planned = menu.getByRole('menuitemradio', { name: 'Geplant', exact: true });
  const actual = menu.getByRole('menuitemradio', { name: 'Tatsächlich', exact: true });
  await expect(planned).toHaveAttribute('aria-checked', 'true');
  await expect(planned).toBeFocused();
  await expect(planned).toHaveAccessibleDescription('Plantermine anzeigen und bearbeiten');
  await expect(actual).toHaveAccessibleDescription('Ist-Termine anzeigen und bearbeiten');
  await expect(combined).toHaveAccessibleDescription(/Ohne Ist-Termin erscheint der Plantermin/);
  await page.screenshot({ path: info.outputPath('date-mode-menu-desktop.png'), animations: 'disabled' });
  await planned.press('Escape');
  await expect(menu).toBeHidden();
  await expect(modes).toBeFocused();
  const pageHelp = page.getByRole('button', { name: 'Hilfe zu Anbauplänen öffnen' });
  await pageHelp.press('Enter');
  await expect(page.getByText(/Standardansicht.*Wechsle zu „Geplant“/)).toBeVisible();
  await page.keyboard.press('Escape');
  await modes.press('Enter');
  await planned.press('ArrowDown');
  await expect(actual).toBeFocused();
  await actual.press('ArrowDown');
  await expect(combined).toBeFocused();
  await combined.press('Enter');
  await expect(modes.getByText('Plan mit Ist', { exact: true })).toBeVisible();
  await page.reload();
  await expect(modes.getByText('Plan mit Ist', { exact: true })).toBeVisible();
  await expect.poll(rowIds).toEqual([second.id, third.id, first.id]);
  await expect(cell(first.id)).toHaveText('11.7.2026');
  await cell(first.id).click();
  const comparison = page.getByRole('tooltip', { name: /^Pflanztermin/ });
  await expect(comparison).toContainText('Tage später');
  await expect(comparison).toContainText('Hier bearbeitest du den Ist-Termin.');
  await modes.hover();
  await cell(third.id).focus();
  await expect(comparison).toContainText('Hier bearbeitest du den Ist-Termin.');

  await selectMode('Geplant');
  await expect.poll(rowIds).toEqual([first.id, second.id, third.id]);
  await expect(cell(first.id)).toHaveText('4.4.2026');
  await selectMode('Tatsächlich');
  await expect(cell(third.id)).toHaveText('—');
  await expect(cell(first.id)).toHaveText('11.7.2026');

  const missingDateCell = cell(third.id);
  const actualInput = missingDateCell.getByRole('textbox', { name: 'Ist-Pflanztermin', exact: true });
  const thirdDateWrites: unknown[] = [];
  page.on('request', request => {
    if (request.url().endsWith(`/api/planting-plans/${third.id}/`) && ['PUT', 'PATCH'].includes(request.method())) {
      thirdDateWrites.push(request.postDataJSON());
    }
  });
  await missingDateCell.click();
  await expect(actualInput).toHaveCount(0);
  await missingDateCell.press('Enter');
  await expect(actualInput).toBeFocused();
  await expect(actualInput).toHaveValue('01.06.2026');
  await expect(page.getByRole('dialog', { name: 'Ist-Pflanztermin' })).toHaveCount(0);
  await actualInput.press('Escape');
  await expect(missingDateCell).toBeFocused();
  await missingDateCell.press('Enter');
  await actualInput.press('Tab');
  await expect(actualInput).toHaveCount(0);
  expect(thirdDateWrites).toEqual([]);

  await missingDateCell.press('Enter');
  await actualInput.press('Enter');
  await expect(missingDateCell).toHaveText('1.6.2026');
  await expect(missingDateCell.getByText('1.6.2026')).toHaveCSS('font-weight', '400');
  await missingDateCell.press('Enter');
  await actualInput.fill('');
  await actualInput.press('Enter');
  await expect(missingDateCell).toHaveText('—');
  expect(thirdDateWrites).toEqual([
    { actual_transplanting_date: '2026-06-01', project }, { actual_transplanting_date: null, project },
  ]);
  expect(await apiRequest(page, 'GET', `/planting-plans/${third.id}/`)).toMatchObject({
    planting_date: '2026-06-01', actual_transplanting_date: null,
  });
  await selectMode('Plan mit Ist');
  await expect(missingDateCell).toHaveText('1.6.2026');
  await selectMode('Tatsächlich');
  await expect(missingDateCell).toHaveText('—');

  await cell(first.id).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Zeile kopieren' }).click();
  const copiedDates = await page.evaluate(() => sessionStorage.getItem('copiedPlan')?.split('\t').slice(4, 6));
  expect(copiedDates).toEqual(['11.7.2026', '7.9.2026']);

  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  const filter = page.getByRole('dialog', { name: 'Filter', exact: true });
  await filter.getByRole('group', { name: 'Erntebeginn' }).getByRole('combobox').first().click();
  await page.getByRole('option', { name: 'September' }).click();
  await page.keyboard.press('Escape');
  await expect.poll(rowIds).toEqual([first.id]);
  await selectMode('Geplant');
  await expect(rows).toHaveCount(0);
  await page.getByRole('button', { name: 'Filter Erntebeginn entfernen' }).click();

  await selectMode('Plan mit Ist');
  const writes: { method: string; body: unknown }[] = [];
  page.on('request', request => {
    if (request.url().endsWith(`/api/planting-plans/${first.id}/`) && ['PUT', 'PATCH'].includes(request.method())) {
      writes.push({ method: request.method(), body: request.postDataJSON() });
    }
  });
  const firstCell = cell(first.id);
  await expect(firstCell.getByText('11.7.2026')).toHaveCSS('font-weight', '700');
  const firstActual = firstCell.getByRole('textbox', { name: 'Ist-Pflanztermin', exact: true });
  await firstCell.dblclick();
  await expect(firstActual).toHaveValue('11.07.2026');
  await page.screenshot({ path: info.outputPath('actual-date-inline-desktop.png'), animations: 'disabled' });
  await firstActual.fill('06.04.2026');
  await selectMode('Tatsächlich');
  await expect(firstActual).toHaveValue('06.04.2026');
  await selectMode('Geplant');
  await expect(firstActual).toHaveCount(0);
  await expect(firstCell).toHaveText('4.4.2026');
  await selectMode('Plan mit Ist');
  await expect(firstActual).toHaveValue('06.04.2026');
  expect(writes).toEqual([]);

  await firstActual.fill('31.02.2026');
  await firstActual.press('Enter');
  await expect(firstActual).toHaveAttribute('aria-invalid', 'true');
  await expect(firstActual).toHaveAccessibleDescription('Gib ein gültiges Datum ein.');
  expect(writes).toEqual([]);
  await firstActual.press('Escape');
  await firstCell.press('1');
  await expect(firstActual).toBeFocused();
  await page.keyboard.type('5.04.2026');
  await expect(firstActual).toHaveValue('15.04.2026');
  await firstActual.press('Tab');
  await expect(firstCell).toHaveText('15.4.2026');
  await firstCell.dblclick();
  await firstActual.fill('');
  await firstActual.press('ControlOrMeta+s');
  await expect(firstCell).toHaveText('4.4.2026');
  expect(writes).toEqual([
    { method: 'PATCH', body: { actual_transplanting_date: '2026-04-15', project } },
    { method: 'PATCH', body: { actual_transplanting_date: null, project } },
  ]);
  expect(await apiRequest(page, 'GET', `/planting-plans/${first.id}/`)).toMatchObject({
    planting_date: '2026-04-04', actual_transplanting_date: null,
  });

  await selectMode('Geplant');
  await firstCell.dblclick();
  const plannedInput = firstCell.getByRole('textbox', { name: 'Plan Pflanztermin' });
  await plannedInput.fill('06.04.2026');
  await plannedInput.press('Enter');
  await expect(firstCell).toHaveText('6.4.2026');
  expect(writes.map(write => write.method)).toEqual(['PATCH', 'PATCH', 'PUT']);

  await selectMode('Tatsächlich');
  const secondRow = grid.locator(`[role="row"][data-id="${second.id}"]`);
  const editDate = async (field: string, label: string, typed: string, shown: string) => {
    const target = secondRow.locator(`[data-field="${field}"]`);
    await target.press('Enter');
    const input = target.getByRole('textbox', { name: label, exact: true });
    await expect(input).toBeFocused();
    await input.fill(typed);
    await input.press('Enter');
    await expect(target).toHaveText(shown);
  };
  await editDate('sowing_date', 'Ist-Anzuchtbeginn', '18.03.2026', '18.3.2026');
  await editDate('harvest_date', 'Ist-Erntebeginn', '05.06.2026', '5.6.2026');
  await editDate('harvest_end_date', 'Ist-Ernteende', '12.06.2026', '12.6.2026');
  expect(await apiRequest(page, 'GET', `/planting-plans/${second.id}/`)).toMatchObject({
    actual_propagation_start_date: '2026-03-18',
    harvest_date: '2026-06-08',
    actual_harvest_start_date: '2026-06-05',
    recorded_harvest_end_date: '2026-06-12',
  });

  const draftDate = secondRow.locator('[data-field="planting_date"]');
  await draftDate.dblclick();
  const transplantDraft = draftDate.getByRole('textbox', { name: 'Ist-Pflanztermin', exact: true });
  await transplantDraft.fill('17.04.2026');
  await selectMode('Geplant');
  await expect(transplantDraft).toHaveCount(0);
  const cultivationType = secondRow.locator('[data-field="cultivation_type"]');
  await cultivationType.dblclick();
  await page.getByRole('option', { name: 'Direktsaat', exact: true }).click();
  await expect(secondRow).toHaveClass(/MuiDataGrid-row--editing/);
  await selectMode('Tatsächlich');
  await expect(secondRow).toHaveClass(/MuiDataGrid-row--editing/);
  expect(await apiRequest(page, 'GET', `/planting-plans/${second.id}/`)).toMatchObject({
    cultivation_type: 'pre_cultivation',
  });
  const draftInput = draftDate.getByRole('textbox', { name: 'Ist-Aussaattermin' });
  await expect(draftInput).toHaveValue('17.04.2026');
  await draftInput.press('Enter');
  await expect(draftInput).toHaveCount(0);
  expect(await apiRequest(page, 'GET', `/planting-plans/${second.id}/`)).toMatchObject({
    cultivation_type: 'pre_cultivation', actual_sowing_date: '2026-04-17', actual_transplanting_date: '2026-03-20',
  });
  await draftDate.press('ControlOrMeta+s');
  await expect(secondRow).not.toHaveClass(/MuiDataGrid-row--editing/);
  expect(await apiRequest(page, 'GET', `/planting-plans/${second.id}/`)).toMatchObject({
    cultivation_type: 'direct_sowing', actual_sowing_date: '2026-04-17', actual_transplanting_date: '2026-03-20',
  });

  const directCrop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: 'Direktsaat-Demo', cultivation_type: 'direct_sowing', cultivation_types: ['direct_sowing'],
  });
  const direct = await apiRequest<{ id: number }>(page, 'POST', '/planting-plans/', {
    season: season.id, crop: directCrop.id, bed: bed.id, area_usage_sqm: 1,
    cultivation_type: 'direct_sowing', planting_date: '2026-07-01',
  });
  const purchased = await apiRequest<{ id: number }>(page, 'POST', '/planting-plans/', {
    season: season.id, crop: crop.id, bed: bed.id, area_usage_sqm: 1,
    cultivation_type: 'purchased_transplant', planting_date: '2026-07-15',
  });
  await page.reload();
  await expect(modes.getByText('Tatsächlich', { exact: true })).toBeVisible();
  const directSowing = grid.locator(`[role="row"][data-id="${direct.id}"] [data-field="sowing_date"]`);
  await directSowing.press('Enter');
  const sowingInput = directSowing.getByRole('textbox', { name: 'Ist-Aussaattermin' });
  await expect(sowingInput).toHaveValue('01.07.2026');
  await sowingInput.fill('03.07.2026');
  await sowingInput.press('Enter');
  await expect(directSowing).toHaveText('3.7.2026');
  expect(await apiRequest(page, 'GET', `/planting-plans/${direct.id}/`)).toMatchObject({
    planting_date: '2026-07-01', actual_sowing_date: '2026-07-03',
  });

  const purchasedRow = grid.locator(`[role="row"][data-id="${purchased.id}"]`);
  const lockedSowing = purchasedRow.locator('[data-field="sowing_date"]');
  const purchasedPlanting = cell(purchased.id);
  await expect(lockedSowing).toHaveAttribute('aria-readonly', 'true');
  await expect(purchasedPlanting).toHaveAttribute('aria-readonly', 'false');
  await purchasedPlanting.press('ArrowLeft');
  await expect(lockedSowing).toBeFocused();
  await expect(page.getByRole('tooltip').filter({ hasText: /keine eigene Anzucht/i })).toBeVisible();
  await lockedSowing.press('Enter');
  await expect(lockedSowing.getByRole('textbox')).toHaveCount(0);
  await purchasedPlanting.press('Enter');
  await purchasedPlanting.getByRole('textbox', { name: 'Ist-Pflanztermin' }).press('Shift+Tab');
  const purchasedBed = purchasedRow.locator('[data-field="bed"]');
  await expect.poll(() => purchasedBed.evaluate(bedCell => bedCell.contains(document.activeElement))).toBe(true);
});

test('keeps explanatory header help delayed and shows Add in keyboard help', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedPlans(page, request, 'planting-plan-tooltip-roles');
  await page.goto(table);

  const add = page.getByRole('button', { name: 'Anbauplan hinzufügen', exact: true });
  await add.hover();
  await page.waitForTimeout(700);
  await expect(page.getByRole('tooltip').filter({ hasText: 'Anbauplan hinzufügen' })).toHaveCount(0);

  const header = page.locator('[role="columnheader"][data-field="sowing_date"]');
  const label = header.locator('.MuiDataGrid-columnHeaderTitleContainerContent > span').first();
  const help = page.getByRole('tooltip').filter({ hasText: 'Bei Anzucht aus Pflanztermin' });
  await expect(header).toHaveAccessibleDescription(/Bei Anzucht.*Bei Direktsaat/);
  await expect(header).not.toHaveAccessibleName(/Bei Anzucht/);
  await label.hover();
  await page.waitForTimeout(200);
  await expect(help).toHaveCount(0);
  await expect(help).toBeVisible();
  await page.mouse.move(300, 63);
  await expect(help).toBeHidden();

  await page.keyboard.press('Tab');
  await header.focus();
  await expect(help).toBeVisible();
  await header.press('Escape');
  await expect(help).toBeHidden();
  await expect(header).toBeFocused();
  await header.press('Enter');
  await expect(header).toHaveAttribute('aria-sort', 'ascending');

  await label.dispatchEvent('touchstart');
  await expect(help).toBeVisible();
  await label.dispatchEvent('touchend');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Hilfe zu Anbauplänen öffnen' }).click();
  await expect(page.getByText(/ausdrücklich geplanter Anzuchtbeginn Vorrang/)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('?');
  const shortcuts = page.getByRole('dialog', { name: /Tastenkürzel/ });
  const shortcut = shortcuts.getByRole('listitem')
    .filter({ has: page.getByText('Anbauplan hinzufügen', { exact: true }) })
    .filter({ hasText: 'Alt+Shift+N' });
  await expect(shortcut).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Alt+Shift+N');
  await expect(page.locator('.MuiDataGrid-row--editing')).toBeInViewport();
});

test.describe('touch and French actual date labels', () => {
  test.use({ hasTouch: true, viewport: { width: 375, height: 800 } });

  test('records dates from the mobile edit form and compares them on the detail page', async ({ page, request }, info) => {
    const { first } = await seedPlans(page, request, 'actual-dates-french-mobile');
    await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: 'fr' });
    await page.setViewportSize({ width: 1280, height: 1125 });
    await page.goto(table);
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await page.evaluate(() => { document.body.style.zoom = '1.25'; });
    const modes = page.getByRole('button', { name: /^Affichage des dates / });
    await expect(modes.getByText('Prévues', { exact: true })).toBeVisible();
    await modes.tap();
    const frenchMenu = page.getByRole('menu', { name: 'Affichage des dates' });
    await expect(frenchMenu.getByRole('menuitemradio', { name: 'Réelles ou prévues', exact: true }))
      .toHaveAccessibleDescription(/la date prévue apparaît/);
    expect(await frenchMenu.evaluate(menu => menu.scrollWidth)).toBeLessThanOrEqual(
      await frenchMenu.evaluate(menu => menu.clientWidth),
    );
    await page.screenshot({ path: info.outputPath('date-mode-menu-french-tablet.png'), animations: 'disabled' });
    await frenchMenu.getByRole('menuitemradio', { name: 'Réelles', exact: true }).tap();
    await expect(frenchMenu).toBeHidden();
    const tabletCell = page.getByRole('grid').locator(`[role="row"][data-id="${first.id}"] [data-field="planting_date"]`);
    await tabletCell.scrollIntoViewIfNeeded();
    const box = (await tabletCell.boundingBox())!;
    const cellHeight = box.height;
    const touchPoint = { x: box.x + 8, y: box.y + box.height / 2 };
    await expect.poll(() => tabletCell.evaluate((cell, point) =>
      cell.contains(document.elementFromPoint(point.x, point.y)), touchPoint)).toBe(true);
    const touch = await page.context().newCDPSession(page);
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [touchPoint],
    });
    try {
      await expect(page.getByRole('tooltip').filter({ hasText: 'Modifie la date réelle.' })).toBeVisible();
      await page.screenshot({ path: info.outputPath('date-comparison-touch-tablet.png'), animations: 'disabled' });
    } finally {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await touch.detach();
    }
    await expect(tabletCell.getByRole('textbox')).toHaveCount(0);
    await tabletCell.tap();
    const tabletInput = tabletCell.getByRole('textbox', { name: 'Date réelle de plantation', exact: true });
    await expect(tabletInput).toHaveValue('11.07.2026');
    expect((await tabletCell.boundingBox())!.height).toBe(cellHeight);
    const editorFitsCell = await tabletInput.evaluate(input => {
      const editor = input.closest('.MuiOutlinedInput-root')!.getBoundingClientRect();
      const cell = input.closest('[role="gridcell"]')!.getBoundingClientRect();
      return editor.top >= cell.top && editor.bottom <= cell.bottom;
    });
    expect(editorFitsCell).toBe(true);
    await page.screenshot({ path: info.outputPath('actual-date-inline-touch-tablet.png'), animations: 'disabled' });
    await tabletInput.press('Escape');
    await page.evaluate(() => { document.body.style.zoom = ''; });
    await page.setViewportSize({ width: 800, height: 375 });
    await expect(modes).toHaveCount(0);
    await expect(page.locator(`[data-mobile-card-id="${first.id}"]`)).toBeVisible();
    await page.screenshot({ path: info.outputPath('french-planting-plans-landscape.png'), animations: 'disabled' });
    await page.setViewportSize({ width: 375, height: 800 });
    await expect(modes).toHaveCount(0);
    await page.getByRole('button', { name: 'Plus', exact: true }).tap();
    await page.getByRole('menuitem', { name: 'Aide sur cette page' }).tap();
    await expect(page.getByText(/laisse les valeurs manquantes vides.*à défaut, la date prévue/)).toBeVisible();
    await page.keyboard.press('Escape');
    const plan = page.locator(`[data-mobile-card-id="${first.id}"]`);
    await expect(plan).toContainText('Date de plantation prévue 04/04/2026');
    await expect(plan).not.toContainText('11/07/2026');
    await plan.getByRole('button', { name: /Actions pour la série/ }).tap();
    await page.getByRole('menuitem', { name: 'Modifier' }).tap();
    const edit = page.getByRole('dialog');
    await expect(edit.getByRole('button', { name: 'Saisir les dates réelles' })).toHaveCount(0);
    await edit.getByRole('button', { name: 'Annuler' }).tap();

    await plan.getByRole('button', { name: /^Terminkohl/ }).tap();
    await expect(page).toHaveURL(new RegExp(`${table}/${first.id}$`));
    await expect(page.getByRole('heading', { name: 'Terminkohl', level: 1 })).toBeVisible();
    const planting = page.getByRole('heading', { name: 'Semis et plantation' }).locator('..');
    const editActual = planting.getByRole('button', { name: 'Saisir les dates réelles' });
    await editActual.tap();
    const form = planting.locator('form');
    await form.getByLabel('Date réelle de début des semis en pépinière').fill('2026-03-14');
    await form.getByLabel('Date réelle de plantation', { exact: true }).fill('2026-04-07');
    await form.getByRole('button', { name: 'Enregistrer' }).tap();
    await expect(form).toHaveCount(0);
    await expect(planting.getByText('3 jours de retard', { exact: true })).toBeVisible();
    await expect(planting.getByText('À la date prévue', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.screenshot({ path: info.outputPath('french-mobile-actual-dates.png'), animations: 'disabled' });

    await page.getByRole('button', { name: 'Retour au tableau' }).tap();
    await expect(plan).toContainText('04/04/2026');
    await expect(plan).not.toContainText('07/04/2026');
    await plan.getByRole('button', { name: /^Terminkohl/ }).tap();

    await editActual.tap();
    await form.getByRole('button', { name: 'Effacer la date · Date réelle de plantation' }).tap();
    await form.getByRole('button', { name: 'Enregistrer' }).tap();
    await expect(planting.getByText('07/04/2026', { exact: true })).toHaveCount(0);
    await expect(planting.getByText('04/04/2026', { exact: true })).toBeVisible();
    await expect(planting.getByText('Aucune date', { exact: true })).toHaveCount(0);
    const saved = await apiRequest<{ planting_date: string; actual_transplanting_date: string | null }>(
      page, 'GET', `/planting-plans/${first.id}/`,
    );
    expect(saved).toMatchObject({ planting_date: '2026-04-04', actual_transplanting_date: null });
  });
});
