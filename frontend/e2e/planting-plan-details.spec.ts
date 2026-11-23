import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiRequest, expectNoHorizontalPageOverflow, loginWithDeterministicProject, resetE2EScenario } from './utils';

test.use({ serviceWorkers: 'block' });

const cropName = 'Details-Kohl (Sorte Grün)';
const table = '/app/planting-plans';

test('keeps one perennial plan while switching its records between seasons', async ({ page, request }, info) => {
  const scenario = `perennial-details-${Date.now()}`;
  try {
    await page.setViewportSize({ width: 375, height: 800 });
    await loginWithDeterministicProject(page, request, scenario, { loginAsAdmin: true });
    const create = (path: string, data: Record<string, unknown>) => apiRequest<{ id: number }>(page, 'POST', path, data);
    const origin = await create('/seasons/', { start_date: '2024-01-01', end_date: '2024-12-31' });
    const earlier = await create('/seasons/', { start_date: '2025-01-01', end_date: '2025-12-31' });
    const active = await create('/seasons/', { start_date: '2026-01-01', end_date: '2026-12-31' });
    const location = await create('/locations/', { name: 'Rhabarberhof' });
    const field = await create('/fields/', { location: location.id, name: 'Rhabarberparzelle' });
    const bed = await create('/beds/', { field: field.id, name: 'Rhabarberbeet', area_sqm: 12 });
    const crop = await create('/crops/', {
      name: 'Detailrhabarber', life_cycle: 'perennial', standing_time_years: 10,
      annual_harvest_window: '03-12/04-09', cultivation_types: ['direct_sowing'],
    });
    const plan = await create('/planting-plans/', {
      crop: crop.id, bed: bed.id, season: origin.id, planting_date: '2024-05-01',
      actual_sowing_date: '2024-05-03', clearing_date: '2030-09-30', area_usage_sqm: 8,
      cultivation_type: 'direct_sowing',
    });
    await create('/tasks/', {
      title: 'Historischer Erntebeginn', planting_plan: plan.id, season: origin.id,
      due_date: '2025-03-12', status: 'completed',
    });
    await create('/harvests/', {
      date: '2026-04-22', crop: crop.id, quantity: '3.5', unit: 'kg',
      allocations: [{ planting_plan: plan.id, quantity: '3.5' }],
    });
    await create('/crop-losses/', {
      date: '2025-04-02', planting_plan: plan.id, loss_type: 'partial', cause: 'frost',
    });
    await page.evaluate(id => localStorage.setItem(`activeSeasonId:${localStorage.getItem('activeProjectId')}`, String(id)), active.id);
    await page.goto(`${table}/${plan.id}`);
    const chooser = page.getByRole('combobox', { name: 'Saison anzeigen' });
    const seasonRegion = page.getByRole('heading', { name: 'Saisondaten' }).locator('..');
    const harvestDates = seasonRegion.getByRole('heading', { name: 'Erntetermine' }).locator('..');
    await expect(chooser).toHaveValue(String(active.id));
    await expect(harvestDates.getByText('12.3.2026', { exact: true })).toBeVisible();
    await expect(harvestDates.getByText('9.4.2026', { exact: true })).toBeVisible();
    await expect(seasonRegion.getByText('Erste erfasste Ernte am 22.4.2026')).toBeVisible();
    await expect(seasonRegion.getByText('In dieser Saison zugeordnet · 3,5 kg')).toBeVisible();
    await expect(seasonRegion.getByText('Historischer Erntebeginn')).toHaveCount(0);
    await expect(page.getByText('3.5.2024', { exact: true })).toBeVisible();
    await expect(page.getByText('30.9.2030', { exact: true })).toBeVisible();
    await expect(page.getByText('Kein Datum', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Räumungsdatum ändern' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Ernte hinzufügen' })).toBeVisible();

    await seasonRegion.getByRole('button', { name: 'Aufgabe hinzufügen' }).click();
    const createTask = page.getByRole('dialog', { name: 'Aufgabe hinzufügen' });
    await createTask.getByRole('textbox', { name: 'Titel' }).fill('Aktuelle Beetkontrolle');
    await createTask.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(seasonRegion.getByText('Aktuelle Beetkontrolle', { exact: true })).toBeVisible();
    await seasonRegion.getByRole('button', { name: /Aufgabe bearbeiten.*Aktuelle Beetkontrolle/ }).click();
    const editTask = page.getByRole('dialog', { name: 'Aufgabe bearbeiten' });
    await editTask.getByRole('textbox', { name: 'Titel' }).fill('Aktuelle Beetkontrolle erledigt');
    await editTask.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(seasonRegion.getByText('Aktuelle Beetkontrolle erledigt', { exact: true })).toBeVisible();

    await seasonRegion.getByRole('button', { name: 'Ausfall erfassen' }).click();
    const loss = page.getByRole('dialog', { name: 'Ausfall erfassen' });
    await loss.getByLabel('Ausfalldatum').fill('2026-04-24');
    await loss.getByRole('combobox', { name: 'Ursache' }).click();
    await page.getByRole('option', { name: 'Staunässe' }).click();
    await loss.getByRole('button', { name: 'Speichern' }).click();
    await expect(seasonRegion.getByText('Teilausfall · Staunässe')).toBeVisible();

    await chooser.selectOption(String(earlier.id));
    await expect(harvestDates.getByText('12.3.2025', { exact: true })).toBeVisible();
    await expect(seasonRegion.getByText('Historischer Erntebeginn')).toBeVisible();
    await expect(seasonRegion.getByText('Teilausfall · Frost')).toBeVisible();
    await expect(seasonRegion.getByText('22.4.2026', { exact: true })).toHaveCount(0);
    await expect(seasonRegion.getByText('Aktuelle Beetkontrolle erledigt')).toHaveCount(0);
    await expect(page.getByText('3.5.2024', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(`${table}/${plan.id}`);
    expect(await page.evaluate(() => localStorage.getItem(`activeSeasonId:${localStorage.getItem('activeProjectId')}`)))
      .toBe(String(active.id));
    expect(await apiRequest(page, 'GET', `/planting-plans/${plan.id}/?across_seasons=true`)).toMatchObject({
      id: plan.id, season: origin.id, actual_harvest_start_date: null, recorded_harvest_end_date: null,
    });

    await chooser.selectOption(String(active.id));
    await expect(seasonRegion.getByText('Erste erfasste Ernte am 22.4.2026')).toBeVisible();
    for (const [width, height] of [[375, 800], [800, 375], [768, 900], [1024, 900], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      await expectNoHorizontalPageOverflow(page);
      await page.screenshot({ path: info.outputPath(`seasonal-details-${width}.png`), fullPage: true, animations: 'disabled' });
    }

    await page.setViewportSize({ width: 375, height: 800 });
    await page.getByRole('button', { name: 'In ursprünglicher Saison öffnen' }).click();
    const planting = page.getByRole('heading', { name: 'Aussaat und Pflanzung' }).locator('..');
    const editDates = planting.getByRole('button', { name: 'Ist-Termine erfassen' });
    await editDates.click();
    const sowing = planting.getByLabel('Ist-Aussaattermin', { exact: true });
    await expect(sowing).toHaveValue('2024-05-03');
    await expect(sowing).toBeFocused();
    await sowing.fill('2024-05-04');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await planting.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(planting.getByText('4.5.2024', { exact: true })).toBeVisible();
    await expect(editDates).toBeFocused();
  } finally {
    await resetE2EScenario(request, scenario);
  }
});

async function seedPlans(page: Page, request: APIRequestContext, scenario: string) {
  await loginWithDeterministicProject(page, request, scenario, { loginAsAdmin: true });
  const create = (path: string, data: Record<string, unknown>) => apiRequest<{ id: number }>(page, 'POST', path, data);
  const previous = await create('/seasons/', { start_date: '2025-01-01', end_date: '2025-12-31', custom_label: 'Vorjahr' });
  const season = await create('/seasons/', { start_date: '2026-01-01', end_date: '2026-12-31', custom_label: 'Saison für Details' });
  const location = await create('/locations/', { name: 'Details-Hof' });
  const field = await create('/fields/', { location: location.id, name: 'Details-Parzelle' });
  const bed = await create('/beds/', { field: field.id, name: 'Details-Beet', length_m: 10, width_m: 1 });
  const crop = await create('/crops/', {
    name: 'Details-Kohl', variety: 'Sorte Grün', cultivation_type: 'pre_cultivation',
    cultivation_types: ['pre_cultivation'], propagation_duration_days: 21, growth_duration_days: 30,
    harvest_duration_days: 14,
  });
  const secondCrop = await create('/crops/', { name: 'Andere Kultur' });
  const plan = await create('/planting-plans/', {
    crop: crop.id, bed: bed.id, season: season.id, planting_date: '2026-04-01',
    cultivation_type: 'pre_cultivation', area_usage_sqm: 0,
  });
  const noBed = await create('/planting-plans/', { crop: secondCrop.id, season: season.id });
  const oldPlan = await create('/planting-plans/', { crop: crop.id, bed: bed.id, season: previous.id, notes: 'Historische Notiz' });
  await create('/tasks/', { title: 'Historische Aufgabe', planting_plan: oldPlan.id });
  await page.evaluate(seasonId => {
    const projectId = window.localStorage.getItem('activeProjectId');
    window.localStorage.setItem(`activeSeasonId:${projectId}`, String(seasonId));
  }, season.id);
  return { bed, crop, noBed, oldPlan, plan, previous, season };
}

test('desktop details preserve the table, restoring row focus on Escape, Close and Back', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { plan, crop, bed } = await seedPlans(page, request, 'plan-details-desktop');
  await page.goto('/app/anbauplaene');
  const search = page.getByRole('searchbox', { name: 'Anbaupläne durchsuchen' });
  await search.fill('Details-Kohl');
  const cropHeader = page.locator('[role="columnheader"][data-field="crop"]');
  await cropHeader.click();
  await expect(cropHeader).toHaveAttribute('aria-sort', 'ascending');
  const row = page.locator(`[role="row"][data-id="${plan.id}"]`);
  const cell = row.locator('[data-field="crop"]');
  await cell.click();
  await expect(cell).toBeFocused();
  await expect(page).toHaveURL(url => url.pathname === '/app/anbauplaene' && url.searchParams.get('dir_plantingPlans') === 'asc');
  await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(0);
  await cell.press('ArrowRight');
  await expect(cell).not.toBeFocused();
  await cell.dblclick();
  await expect(row).toHaveClass(/MuiDataGrid-row--editing/);
  await row.locator('[data-field="planting_date"]').getByRole('textbox').press('Escape');
  await expect(row).not.toHaveClass(/MuiDataGrid-row--editing/);

  const menuButton = row.getByRole('button', { name: 'Aktionen', exact: true });
  const openMenu = async () => {
    await row.hover();
    await menuButton.focus();
    await menuButton.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
  };
  await openMenu();
  const menu = page.getByRole('menu');
  const menuItems = menu.getByRole('menuitem');
  await expect(menuItems.nth(0)).toHaveAccessibleName('Anbauplan-Details');
  await expect(menuItems.nth(1)).toHaveAccessibleName('Zur Kultur');
  await expect(menuItems.nth(2)).toHaveAccessibleName('Zur Beetfläche');
  await expect(menu.getByRole('separator').first()).toBeVisible();
  await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(0);
  await expect(menuItems.nth(0)).toBeFocused();
  await page.keyboard.press('Enter');

  const drawer = page.getByRole('dialog', { name: 'Anbauplan-Details' });
  await expect(page).toHaveURL(url => url.pathname === `/app/anbauplaene/${plan.id}`);
  await expect(drawer.getByRole('heading', { name: cropName })).toBeVisible();
  await expect(drawer.getByRole('link', { name: 'Zur Kultur' })).toHaveAttribute('href', `/app/crops?cropId=${crop.id}`);
  await expect(drawer.getByRole('link', { name: 'Zur Beetfläche' })).toHaveAttribute('href', `/app/fields-beds/beds/${bed.id}`);
  await expect(drawer.getByText('11.3.2026', { exact: true })).toBeVisible();
  await expect(drawer.getByText('0', { exact: true })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Notiz oder Foto hinzufügen' })).toBeVisible();

  await drawer.getByRole('button', { name: 'Notiz oder Foto hinzufügen' }).click();
  const notesEditor = page.getByRole('textbox', { name: 'Notizen' });
  await notesEditor.fill('Offene Notiz beim Größenwechsel');
  await page.setViewportSize({ width: 850, height: 900 });
  await expect(notesEditor).toHaveText('Offene Notiz beim Größenwechsel');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await page.getByRole('button', { name: 'Verwerfen', exact: true }).click();
  await expect(drawer.getByRole('heading', { name: cropName })).toBeVisible();

  const detailUrl = page.url();
  const addTask = drawer.getByRole('button', { name: 'Aufgabe hinzufügen' });
  const taskForm = page.getByRole('dialog', { name: 'Aufgabe hinzufügen' });
  await addTask.focus();
  await addTask.press('Enter');
  const taskTitle = taskForm.getByRole('textbox', { name: 'Titel' });
  await expect(taskTitle).toBeFocused();
  await taskTitle.fill('Nicht gespeicherter Entwurf');
  await taskTitle.press('Escape');
  await expect(taskForm).toHaveCount(0);
  await expect(addTask).toBeFocused();
  await expect(page).toHaveURL(detailUrl);
  await addTask.press('Enter');
  await expect(taskTitle).toHaveValue('');
  await taskForm.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(addTask).toBeFocused();
  await expect(page).toHaveURL(detailUrl);
  await addTask.press('Enter');
  await taskTitle.fill('Aufgabe in der Seitenleiste');
  await taskForm.getByRole('button', { name: 'Speichern' }).click();
  await expect(drawer.getByText('Aufgabe in der Seitenleiste', { exact: true })).toBeVisible();
  await expect(addTask).toBeFocused();
  await expect(page).toHaveURL(detailUrl);

  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(menuButton).toBeFocused();
  await expect(search).toHaveValue('Details-Kohl');
  await expect(cropHeader).toHaveAttribute('aria-sort', 'ascending');
  await openMenu();
  await menuItems.first().click();
  await drawer.getByRole('button', { name: 'Schließen' }).click();
  await expect(menuButton).toBeFocused();
  await openMenu();
  await menuItems.first().click();
  await page.goBack();
  await expect(drawer).toHaveCount(0);
  await expect(menuButton).toBeFocused();
  await expect(search).toHaveValue('Details-Kohl');

  await openMenu();
  await menuItems.first().click();
  await drawer.getByRole('button', { name: 'Als ganze Seite öffnen' }).click();
  await expect(drawer).toHaveCount(0);
  await expect(page.getByRole('heading', { name: cropName })).toBeVisible();
  await expect(page.getByRole('grid')).toBeHidden();
  await expect(page.getByRole('button', { name: /^Anbauplan hinzufügen/ })).toHaveCount(0);
  await page.keyboard.press('Alt+Shift+n');
  await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(0);
  await page.getByRole('button', { name: 'Zurück zur Tabelle' }).click();
  await expect(search).toHaveValue('Details-Kohl');
  await expect(menuButton).toBeFocused();

  await openMenu();
  await menuItems.first().click();
  await drawer.getByRole('link', { name: 'Zur Kultur' }).click();
  await expect(page).toHaveURL(url => url.pathname === '/app/crops');
  await page.goBack();
  await expect(drawer.getByRole('heading', { name: cropName })).toBeVisible();
  await drawer.getByRole('button', { name: 'Schließen' }).click();
  await expect(search).toHaveValue('Details-Kohl');
  await expect(cropHeader).toHaveAttribute('aria-sort', 'ascending');
});

test('direct links retain the original season and reuse the notes, task and area workflows', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { plan, bed, crop, oldPlan, previous, season } = await seedPlans(page, request, 'plan-details-direct');
  const existingTask = 'Bestehende Aufgabe für diesen Anbauplan';
  const newTask = 'Neue Aufgabe für diesen Anbauplan';
  await apiRequest(page, 'POST', '/tasks/', { title: existingTask, planting_plan: plan.id, season: season.id });
  await apiRequest(page, 'POST', '/tasks/', {
    title: 'Anzucht im Vorjahr', planting_plan: plan.id, season: season.id, due_date: '2025-12-31',
  });
  await page.goto(`${table}/${plan.id}`);
  await expect(page.getByRole('heading', { name: cropName })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Details-Hof', { exact: true })).toBeVisible();
  await expect(page.getByText('Details-Parzelle', { exact: true })).toBeVisible();
  await expect(page.getByText('Details-Beet', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Zur Beetfläche' }).click();
  await expect(page).toHaveURL(new RegExp(`/app/fields-beds/beds/${bed.id}$`));
  await expect(page.getByRole('link', { name: cropName, exact: true })).toHaveAttribute('href', `${table}?planId=${plan.id}`);
  await page.getByRole('link', { name: `Anbauplan-Details für ${cropName}` }).click();
  await expect(page).toHaveURL(new RegExp(`${table}/${plan.id}$`));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Notiz oder Foto hinzufügen' }).click();
  const editor = page.getByRole('textbox', { name: 'Notizen' });
  await editor.fill('Neue Notiz für diesen Anbauplan');
  const navigationDialog = page.waitForEvent('dialog');
  // The drawer traps focus while the editor is open, so trigger browser history.
  void page.evaluate(() => history.back());
  const unsaved = await navigationDialog;
  expect(unsaved.type()).toBe('confirm');
  await unsaved.dismiss();
  await expect(editor).toHaveText('Neue Notiz für diesen Anbauplan');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByText('Neue Notiz für diesen Anbauplan', { exact: true })).toBeVisible();

  await expect(page.getByText(existingTask, { exact: true })).toBeVisible();
  const detailUrl = page.url();
  await page.getByRole('button', { name: 'Aufgabe hinzufügen' }).click();
  const createTask = page.getByRole('dialog', { name: 'Aufgabe hinzufügen' });
  await expect(page).toHaveURL(detailUrl);
  await expect(createTask.getByRole('textbox', { name: 'Anbauplan', exact: true })).toHaveValue(/^Details-Kohl \(Sorte Grün\) · Details-Beet/);
  await expect(createTask.getByRole('textbox', { name: 'Parzelle' })).toHaveValue('Details-Parzelle');
  await expect(createTask.getByRole('textbox', { name: 'Saison' })).toHaveValue('Saison für Details');
  await createTask.getByRole('textbox', { name: 'Titel' }).fill(newTask);
  await createTask.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(createTask).toHaveCount(0);
  await expect(page).toHaveURL(detailUrl);
  await expect(page.getByText(newTask, { exact: true })).toBeVisible();
  await expect(page.getByText(existingTask, { exact: true })).toBeVisible();
  const { results } = await apiRequest<{ results: { title: string; planting_plan: number; season: number; crop: number; field: number | null }[] }>(
    page, 'GET', `/tasks/?planting_plan=${plan.id}&across_seasons=true`,
  );
  expect(results.filter(task => task.title === newTask)).toEqual([
    expect.objectContaining({ planting_plan: plan.id, season: season.id, crop: crop.id, field: null }),
  ]);
  await expect(page.getByText('Anzucht im Vorjahr', { exact: true })).toHaveCount(0);
  const recordSeason = page.getByRole('combobox', { name: 'Saison anzeigen' });
  await recordSeason.selectOption(String(previous.id));
  await expect(page.getByText('Anzucht im Vorjahr', { exact: true })).toBeVisible();
  await expect(page.getByText(newTask, { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(detailUrl);

  await page.goto(`${table}/${oldPlan.id}`);
  await expect(page.getByText('Vorjahr', { exact: true })).toBeVisible();
  await expect(page.getByText('Historische Notiz', { exact: true })).toBeVisible();
  await expect(page.getByText('Historische Aufgabe', { exact: true })).toBeVisible();
  await expect(page.getByText('Fläche (m²)', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Notizen und Fotos bearbeiten' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Aufgabe hinzufügen' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Ursprüngliche Saison öffnen' }).click();
  await expect(page.getByRole('button', { name: 'Notizen und Fotos bearbeiten' })).toBeVisible();
  await page.getByRole('button', { name: 'Zurück zur Tabelle' }).click();
  await expect(page).toHaveURL(new RegExp(`${table}$`));
});

test('a plan whose crop was archived still accepts a linked task', async ({ page, request }) => {
  const { crop, plan, season } = await seedPlans(page, request, 'plan-details-archived-crop-task');
  await apiRequest(page, 'DELETE', `/crops/${crop.id}/`);
  await page.goto(`${table}/${plan.id}`);
  await expect(page.getByRole('heading', { name: cropName })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Zur Kultur' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Aufgabe hinzufügen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Aufgabe hinzufügen' });
  const title = 'Beet nach archivierter Kultur prüfen';
  await dialog.getByRole('textbox', { name: 'Titel' }).fill(title);
  const saved = page.waitForResponse(response => response.url().endsWith('/api/tasks/') && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  expect((await saved).status()).toBe(201);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  const { results } = await apiRequest<{ results: { title: string; season: number; planting_plan: number; crop: number | null }[] }>(
    page, 'GET', `/tasks/?planting_plan=${plan.id}&across_seasons=true`,
  );
  expect(results.find(task => task.title === title)).toMatchObject({ season: season.id, planting_plan: plan.id, crop: null });
});

test('opening details keeps an edit visible if the grid cannot save it', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { noBed, plan } = await seedPlans(page, request, 'plan-details-failed-grid-save');
  await page.goto(table);
  const row = page.locator(`[role="row"][data-id="${plan.id}"]`);
  const plantingCell = row.locator('[data-field="planting_date"]');
  await plantingCell.dblclick();
  const input = plantingCell.getByRole('textbox');
  await input.fill('02.04.2026');

  const updatePath = `**/api/planting-plans/${plan.id}/`;
  await page.route(updatePath, route => route.request().method() === 'PUT'
    ? route.fulfill({ status: 400, json: { detail: 'Test write rejected' } }) : route.continue());
  const otherRow = page.locator(`[role="row"][data-id="${noBed.id}"]`);
  const menuTrigger = otherRow.getByRole('button', { name: 'Aktionen', exact: true });
  const openMenu = async () => {
    await otherRow.hover();
    await menuTrigger.click();
  };
  await openMenu();
  const failure = page.waitForResponse(response => response.status() === 400
    && response.url().endsWith(`/planting-plans/${plan.id}/`));
  await page.getByRole('menuitem', { name: 'Anbauplan-Details' }).click();
  await failure;
  await expect(page.getByRole('searchbox', { name: 'Anbaupläne durchsuchen' })).toBeVisible();
  await expect(input).toHaveValue('02.04.2026');
  await expect(page.getByRole('dialog', { name: 'Anbauplan-Details' })).toHaveCount(0);

  await page.unroute(updatePath);
  await input.press('Escape');
  await expect(row).not.toHaveClass(/MuiDataGrid-row--editing/);
  await openMenu();
  await page.getByRole('menuitem', { name: 'Anbauplan-Details' }).click();
  await expect(page.getByRole('dialog', { name: 'Anbauplan-Details' })).toBeVisible();
});

test.describe('touch details', () => {
  test.use({ hasTouch: true, viewport: { width: 375, height: 800 } });

  test('keeps the task draft after a failed save and retries from the direct detail page', async ({ page, request }) => {
    const { plan } = await seedPlans(page, request, 'plan-details-task-touch');
    await page.goto(`${table}/${plan.id}`);
    await page.getByRole('button', { name: 'Aufgabe hinzufügen' }).tap();
    const dialog = page.getByRole('dialog', { name: 'Aufgabe hinzufügen' });
    const planLabel = dialog.getByRole('textbox', { name: 'Anbauplan', exact: true });
    await expect(planLabel).toHaveValue(/Details-Kohl \(Sorte Grün\) · Details-Beet/);
    await expect.poll(() => planLabel.evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
    const title = dialog.getByRole('textbox', { name: 'Titel' });
    const description = dialog.getByRole('textbox', { name: 'Beschreibung' });
    const save = dialog.getByRole('button', { name: 'Speichern' });
    await title.fill('   ');
    await expect(save).toBeDisabled();
    await title.fill('Mobile Aufgabe');
    await description.fill('Vor der Ernte prüfen');

    const path = '**/api/tasks/';
    await page.route(path, route => route.request().method() === 'POST'
      ? route.fulfill({ status: 400, json: { detail: 'Test write rejected' } }) : route.continue());
    await save.tap();
    await expect(dialog.getByRole('alert')).toContainText('Die Aufgabe konnte nicht gespeichert werden');
    await expect(title).toHaveValue('Mobile Aufgabe');
    await expect(description).toHaveValue('Vor der Ernte prüfen');
    await expect(page).toHaveURL(new RegExp(`${table}/${plan.id}$`));

    await page.unroute(path);
    await save.tap();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Mobile Aufgabe', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${table}/${plan.id}$`));
  });

  test('uses the same three named actions and opens a full page', async ({ page, request }) => {
    const { noBed, crop, bed } = await seedPlans(page, request, 'plan-details-touch');
    await page.goto(table);
    const card = page.locator(`[data-mobile-card-id="${noBed.id}"]`);
    await card.getByRole('button', { name: /Aktionen für Anbauplan/ }).tap();

    const menuItems = page.getByRole('menu').getByRole('menuitem');
    await expect(menuItems.nth(0)).toHaveAccessibleName('Anbauplan-Details');
    await expect(menuItems.nth(1)).toHaveAccessibleName('Zur Kultur');
    await expect(menuItems.nth(2)).toHaveAccessibleName('Zur Beetfläche');
    await expect(menuItems.nth(2)).toBeDisabled();
    await expect(menuItems.nth(2)).toHaveAccessibleDescription('Das Beet fehlt oder wurde gelöscht.');
    await menuItems.first().tap();
    await expect(page).toHaveURL(new RegExp(`${table}/${noBed.id}$`));
    await expect(page.getByRole('heading', { name: 'Andere Kultur' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Zur Beetfläche' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Zurück zur Tabelle' }).tap();
    await expect(card).toBeVisible();
    const assigned = page.locator('[data-mobile-card-id]').filter({ hasText: cropName });
    await assigned.getByRole('button', { name: /Aktionen für Anbauplan/ }).tap();
    await page.getByRole('menuitem', { name: 'Zur Kultur' }).tap();
    await expect(page).toHaveURL(new RegExp(`/app/crops\\?cropId=${crop.id}$`));

    await page.goto(`${table}?bedId=${bed.id}&create=true`);
    const create = page.getByRole('dialog', { name: 'Anbauplan hinzufügen' });
    await expect(create.getByRole('combobox').nth(1)).toContainText('Details-Beet');
  });
});
