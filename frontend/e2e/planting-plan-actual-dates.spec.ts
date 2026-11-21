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
    name: 'Terminkohl', cultivation_type: 'pre_cultivation', cultivation_types: ['pre_cultivation'],
    propagation_duration_days: 21, growth_duration_days: 30, harvest_duration_days: 10,
  });
  const seed = (plannedDate: string, actualDate: string | null, harvest: string | null) => create('/planting-plans/', {
    season: season.id, crop: crop.id, bed: bed.id, cultivation_type: 'pre_cultivation',
    planting_date: plannedDate, area_usage_sqm: 0, actual_transplanting_date: actualDate,
    actual_harvest_start_date: harvest,
  });
  const first = await seed('2026-04-04', '2026-07-11', '2026-09-07');
  const second = await seed('2026-05-09', '2026-03-20', null);
  const third = await seed('2026-06-01', null, null);
  return { first, second, third };
}

test('the grid sorts, filters and edits the displayed dates without writing planned values', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { first, second, third } = await seedPlans(page, request, 'actual-dates-grid');
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => window.sessionStorage.setItem('copiedPlan', text),
      },
    });
  });
  await page.goto(table);
  const modes = page.getByRole('group', { name: 'Terminanzeige' });
  const grid = page.getByRole('grid');
  const rows = grid.locator('[role="row"][data-id]');
  const rowIds = () => rows.evaluateAll(list => list.map(row => Number(row.getAttribute('data-id'))));
  const cell = (id: number) => grid.locator(`[role="row"][data-id="${id}"] [data-field="planting_date"]`);

  await expect(modes.getByRole('button', { name: 'Beides' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(rowIds).toEqual([second.id, third.id, first.id]);
  await expect(cell(first.id)).toHaveText('11.7.2026');
  await cell(first.id).click();
  await expect(page.getByRole('tooltip')).toContainText('Tage später');

  await modes.getByRole('button', { name: 'Plan', exact: true }).click();
  await expect.poll(rowIds).toEqual([first.id, second.id, third.id]);
  await expect(cell(first.id)).toHaveText('4.4.2026');
  await modes.getByRole('button', { name: 'Ist', exact: true }).click();
  await expect(cell(third.id)).toHaveText('');
  await expect(cell(first.id)).toHaveText('11.7.2026');

  const missingDateCell = cell(third.id);
  const actualDateAction = missingDateCell.getByRole('button', { name: 'Ist-Pflanztermin' });
  const missingDateEditor = page.getByRole('dialog', { name: 'Ist-Pflanztermin' });
  const actualInput = missingDateEditor.getByLabel('Ist-Pflanztermin', { exact: true });
  const thirdDateWrites: (string | null)[] = [];
  page.on('request', request => {
    if (request.url().endsWith(`/api/planting-plans/${third.id}/`) && request.method() === 'PATCH') {
      thirdDateWrites.push(request.postDataJSON().actual_transplanting_date);
    }
  });
  await missingDateCell.press('Enter');
  await actualDateAction.press('Enter');
  await expect(actualInput).toHaveValue('2026-06-01');
  await expect(missingDateEditor.getByText('Plan', { exact: true }).locator('..')).toHaveText('Plan 1.6.2026');
  await actualInput.press('Escape');
  await expect(missingDateEditor).toHaveCount(0);
  expect(thirdDateWrites).toEqual([]);

  await actualDateAction.press('Enter');
  await missingDateEditor.getByRole('button', { name: 'Speichern' }).click();
  await expect(missingDateEditor).toHaveCount(0);
  await expect(missingDateCell).toHaveText('1.6.2026');
  await missingDateCell.press('Enter');
  await expect(actualDateAction).toHaveText('1.6.2026');
  await actualDateAction.press('Enter');
  await missingDateEditor.getByRole('button', { name: 'Datum löschen' }).click();
  await missingDateEditor.getByRole('button', { name: 'Speichern' }).click();
  await expect(missingDateEditor).toHaveCount(0);
  expect(thirdDateWrites).toEqual(['2026-06-01', null]);
  expect(await apiRequest(page, 'GET', `/planting-plans/${third.id}/`)).toMatchObject({
    planting_date: '2026-06-01', actual_transplanting_date: null,
  });
  await missingDateCell.press('Escape');
  await modes.getByRole('button', { name: 'Beides' }).click();
  await expect(missingDateCell).toHaveText('1.6.2026');
  await modes.getByRole('button', { name: 'Ist', exact: true }).click();
  await expect(missingDateCell).toHaveText('');

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
  await modes.getByRole('button', { name: 'Plan', exact: true }).click();
  await expect(rows).toHaveCount(0);
  await page.getByRole('button', { name: 'Filter Erntebeginn entfernen' }).click();

  await modes.getByRole('button', { name: 'Beides' }).click();
  const writes: string[] = [];
  page.on('request', request => {
    if (request.url().endsWith(`/api/planting-plans/${first.id}/`) && ['PUT', 'PATCH'].includes(request.method())) {
      writes.push(request.method());
    }
  });
  await cell(first.id).dblclick();
  const plannedInput = cell(first.id).getByRole('textbox', { name: 'Plan Pflanztermin' });
  await plannedInput.fill('06.04.2026');
  await modes.getByRole('button', { name: 'Ist', exact: true }).click();
  await modes.getByRole('button', { name: 'Beides' }).click();
  await expect(plannedInput).toHaveValue('06.04.2026');
  expect(writes).toEqual([]);
  await plannedInput.press('Escape');

  const openActual = async () => {
    await cell(first.id).dblclick();
    await expect(cell(first.id).getByRole('textbox', { name: 'Plan Pflanztermin' })).toHaveValue('04.04.2026');
    await cell(first.id).getByRole('button', { name: /Terminart wählen/ }).click();
    return page.getByRole('dialog', { name: 'Ist-Pflanztermin' });
  };
  let actualEditor = await openActual();
  await actualEditor.getByLabel('Ist-Pflanztermin').fill('2026-04-05');
  await actualEditor.getByRole('button', { name: 'Speichern' }).click();
  await expect(actualEditor).toHaveCount(0);
  await expect(cell(first.id)).toHaveText('5.4.2026');

  actualEditor = await openActual();
  await actualEditor.getByRole('button', { name: 'Datum löschen' }).click();
  await actualEditor.getByRole('button', { name: 'Speichern' }).click();
  await expect(actualEditor).toHaveCount(0);
  await expect(cell(first.id)).toHaveText('4.4.2026');
  await modes.getByRole('button', { name: 'Ist', exact: true }).click();
  await expect(cell(first.id)).toHaveText('');
  expect(writes).toEqual(['PATCH', 'PATCH']);
  const saved = await apiRequest<{ planting_date: string; actual_transplanting_date: string | null }>(
    page, 'GET', `/planting-plans/${first.id}/`,
  );
  expect(saved).toMatchObject({ planting_date: '2026-04-04', actual_transplanting_date: null });

  const harvestCell = grid.locator(`[role="row"][data-id="${second.id}"] [data-field="harvest_date"]`);
  await harvestCell.click();
  await harvestCell.press('Enter');
  await harvestCell.getByRole('button', { name: 'Ist-Erntebeginn' }).click();
  const harvestEditor = page.getByRole('dialog', { name: 'Ist-Erntebeginn' });
  await harvestEditor.getByLabel('Ist-Erntebeginn', { exact: true }).fill('2026-06-05');
  await harvestEditor.getByRole('button', { name: 'Speichern' }).click();
  await expect(harvestCell).toHaveText('5.6.2026');
  const harvest = await apiRequest<{ harvest_date: string; actual_harvest_start_date: string }>(
    page, 'GET', `/planting-plans/${second.id}/`,
  );
  expect(harvest).toMatchObject({ harvest_date: '2026-06-08', actual_harvest_start_date: '2026-06-05' });
});

test.describe('touch and French actual date labels', () => {
  test.use({ hasTouch: true, viewport: { width: 375, height: 800 } });

  test('records dates from the mobile edit form and compares them on the detail page', async ({ page, request }) => {
    const { first } = await seedPlans(page, request, 'actual-dates-french-mobile');
    await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: 'fr' });
    await page.goto(table);
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    const modes = page.getByRole('group', { name: 'Dates à afficher' });
    await modes.getByRole('button', { name: 'Réalisé' }).tap();
    const plan = page.locator(`[data-mobile-card-id="${first.id}"]`);
    await expect(plan).toContainText('11/07/2026');
    await plan.getByRole('button', { name: /Actions pour la série/ }).tap();
    await page.getByRole('menuitem', { name: 'Modifier' }).tap();
    const edit = page.getByRole('dialog');
    await edit.getByRole('button', { name: 'Saisir les dates réelles' }).tap();
    const form = edit.locator('form');
    await form.getByLabel('Date réelle de début des semis en pépinière').fill('2026-03-14');
    await form.getByLabel('Date réelle de plantation', { exact: true }).fill('2026-04-07');
    await form.getByRole('button', { name: 'Enregistrer' }).tap();
    await expect(form).toHaveCount(0);
    await edit.getByRole('button', { name: 'Annuler' }).tap();
    await expect(plan).toContainText('07/04/2026');

    await plan.getByRole('button', { name: /Actions pour la série/ }).tap();
    await page.getByRole('menuitem', { name: 'Détails de la série' }).tap();
    await expect(page).toHaveURL(new RegExp(`${table}/${first.id}$`));
    await expect(page.getByRole('heading', { name: 'Terminkohl', level: 1 })).toBeVisible();
    await expect(page.getByText('3 jours de retard', { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(page.getByText('À la date prévue', { exact: true }).filter({ visible: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

    await page.getByRole('button', { name: 'Saisir les dates réelles' }).tap();
    await page.getByRole('button', { name: 'Effacer la date · Date réelle de plantation' }).tap();
    await page.locator('form').getByRole('button', { name: 'Enregistrer' }).tap();
    await expect(page.getByText('Aucune date', { exact: true }).filter({ visible: true }).first()).toBeVisible();
    const saved = await apiRequest<{ planting_date: string; actual_transplanting_date: string | null }>(
      page, 'GET', `/planting-plans/${first.id}/`,
    );
    expect(saved).toMatchObject({ planting_date: '2026-04-04', actual_transplanting_date: null });
  });
});
