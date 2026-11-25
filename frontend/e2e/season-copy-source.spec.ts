import { expect, test, type Page } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject } from './utils';

test.use({ serviceWorkers: 'block' });

const plansPage = '/app/planting-plans';

function createSeason(page: Page, start: string, end: string, label: string) {
  return apiRequest<{ id: number }>(page, 'POST', '/seasons/', {
    start_date: start, end_date: end, custom_label: label,
  });
}

async function createPlan(page: Page, season: number, plantingDate: string, actualSowingDate?: string, growthDuration = 30) {
  const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: 'Kopiersalat', cultivation_type: 'direct_sowing', growth_duration_days: growthDuration,
  });
  return apiRequest<{ id: number }>(page, 'POST', '/planting-plans/', {
    season, crop: crop.id, planting_date: plantingDate, cultivation_type: 'direct_sowing',
    actual_sowing_date: actualSowingDate,
  });
}

test.describe('season copy on a French phone', () => {
  test.use({ hasTouch: true, viewport: { width: 375, height: 800 } });

  test('selects a historical season with keyboard and touch and copies its actual dates', async ({ page, request }) => {
    await loginWithDeterministicProject(page, request, 'season-copy-preceding-french', { loginAsAdmin: true });
    const targetLabel = 'Nouveau jardin pédagogique et parcelle de démonstration du quartier';
    const sourceLabel = 'Jardin pédagogique avant la rénovation du système d’irrigation';
    const source = await createSeason(page, '2024-09-01', '2025-08-31', sourceLabel);
    const target = await createSeason(page, '2026-09-01', '2027-08-31', targetLabel);
    await createSeason(page, '2027-09-01', '2028-08-31', 'Saison future');
    const original = await createPlan(page, source.id, '2025-04-01', '2025-04-06');
    await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: 'fr' });

    const openCopyDialog = async (label = targetLabel) => {
      await page.getByRole('button', { name: 'Changer de saison active' }).tap();
      await page.getByRole('menuitem').filter({ hasText: label })
        .getByRole('button', { name: 'Ouvrir les actions de la saison' }).tap();
      await page.getByRole('menuitem', { name: 'Copier les données', exact: true }).tap();
      return page.getByRole('dialog', { name: 'Copier les données' });
    };

    await page.goto(plansPage);
    let dialog = await openCopyDialog(sourceLabel);
    await expect(dialog.getByRole('alert')).toContainText('Aucune saison antérieure');
    await expect(dialog.getByRole('button', { name: 'Copier', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    dialog = await openCopyDialog();
    await expect(dialog.getByRole('combobox', { name: 'Saison source' })).toHaveText(sourceLabel);
    await expect(dialog.getByText(/La rotation entre parcelles est possible uniquement/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    const precedingLabel = 'Saison intermédiaire';
    await createSeason(page, '2025-09-01', '2026-08-31', precedingLabel);
    await page.goto(plansPage);
    dialog = await openCopyDialog();
    const select = dialog.getByRole('combobox', { name: 'Saison source' });
    await expect(select).toHaveText(precedingLabel);
    await expect(dialog.getByText(targetLabel, { exact: true })).toBeVisible();
    await select.focus();
    await page.keyboard.press('ArrowDown');
    const choices = page.getByRole('listbox').getByRole('option');
    await expect(choices).toHaveText([precedingLabel, sourceLabel]);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(select).toHaveText(sourceLabel);
    await expect(select).toHaveCSS('white-space', 'normal');
    await expect(select).toHaveAccessibleDescription(/La rotation entre parcelles est possible uniquement/);
    expect(await dialog.evaluate(node => node.scrollWidth)).toBeLessThanOrEqual(375);

    const dateBasis = dialog.getByRole('checkbox', { name: 'Utiliser les dates réelles pour la planification' });
    await expect(dateBasis).not.toBeChecked();
    await dateBasis.focus();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('img', { name: /saison sélectionnée.*date prévue/ })).toBeFocused();
    await expect(page.getByRole('tooltip')).toContainText(/saison sélectionnée.*date prévue/);
    await expect(dateBasis).not.toBeChecked();
    const freshPreview = page.waitForResponse(response => (
      response.url().includes(`/seasons/${target.id}/copy-preview/`) && response.url().includes('use_actual_dates=true')
    ));
    await dateBasis.tap();
    const preview = await freshPreview;
    expect(preview.ok()).toBeTruthy();
    expect(new URL(preview.url()).searchParams.get('source_season_id')).toBe(String(source.id));
    await expect(dialog.getByRole('button', { name: 'Copier 1 série', exact: true })).toBeEnabled();
    await expect(dialog.getByTestId('season-copy-totals')).toContainText('0 existante(s) + 1 nouvelle(s) = 1 série');
    const copying = page.waitForResponse(response => (
      response.url().endsWith(`/seasons/${target.id}/copy-from/`) && response.request().method() === 'POST'
    ));
    await dialog.getByRole('button', { name: 'Copier 1 série', exact: true }).focus();
    await page.keyboard.press('Enter');
    const response = await copying;
    expect(response.request().postDataJSON()).toEqual({ source_season_id: source.id, use_actual_dates: true });
    expect(await response.json()).toMatchObject({ copied_count: 1, target_planting_plan_count: 1 });
    await expect(dialog).toHaveCount(0);
    const { results } = await apiRequest<{ results: Array<{
      id: number; season: number; planting_date: string; actual_sowing_date: string | null;
    }> }>(
      page, 'GET', '/planting-plans/',
    );
    expect(results.find(plan => plan.id === original.id)).toMatchObject({
      season: source.id, planting_date: '2025-04-01', actual_sowing_date: '2025-04-06',
    });
    expect(results.filter(plan => plan.season === target.id)).toMatchObject([{
      planting_date: '2027-04-06', actual_sowing_date: null,
    }]);
  });
});

for (const basis of ['planned', 'actual'] as const) {
  test(`the suggested season copies ${basis} dates from the selected historical source`, async ({ page, request }) => {
    await page.setViewportSize(basis === 'actual' ? { width: 375, height: 800 } : { width: 1440, height: 900 });
    await loginWithDeterministicProject(page, request, `season-suggestion-source-${basis}`, { loginAsAdmin: true });
    await createSeason(page, '2023-09-01', '2024-08-31', 'Alter Garten');
    const older = await createSeason(page, '2024-09-01', '2025-08-31', 'Historische Saison');
    const newest = await createSeason(page, '2025-09-01', '2026-08-31', 'Jüngste Saison');
    await apiRequest(page, 'PATCH', '/season-pattern/', { start_day: 1, start_month: 9 });
    const source = basis === 'actual' ? older : newest;
    const year = basis === 'actual' ? 2025 : 2026;
    const original = await createPlan(page, source.id, `${year}-04-01`, `${year}-04-06`, 32);

    await page.goto(plansPage);
    const switcher = page.getByRole('button', { name: 'Aktive Saison wechseln' });
    await switcher.click();
    await page.getByRole('menuitem').filter({ hasText: 'Historische Saison' }).click();
    await expect(switcher).toContainText('Historische Saison');
    await switcher.click();
    await page.getByRole('menuitem').filter({ hasText: 'Saison 26/27 anlegen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Saison 26/27 anlegen?' });
    await expect(dialog.getByRole('checkbox', { name: /Anbaupläne übernehmen/ })).toBeChecked();
    const sourceSelect = dialog.getByRole('combobox', { name: 'Ausgangssaison' });
    await expect(sourceSelect).toHaveText('Jüngste Saison');

    const dateBasis = dialog.getByRole('checkbox', { name: 'Ist-Termine als Plantermine verwenden' });
    await expect(dateBasis).not.toBeChecked();
    await dialog.getByRole('img', { name: /ausgewählten Saison.*Plantermin/ }).hover();
    await expect(page.getByRole('tooltip')).toContainText(/ausgewählten Saison.*Plantermin/);
    await page.mouse.move(0, 0);
    const patternHint = dialog.getByRole('button', { name: 'Hinweis zum Saisonzeitraum' });
    await patternHint.focus();
    await page.keyboard.press('Enter');
    const patternPopover = page.getByRole('dialog', { name: 'Hinweis zum Saisonzeitraum' });
    await expect(patternPopover.getByRole('button', { name: 'Projekteinstellungen' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(patternPopover).toHaveCount(0);
    await expect(dialog).toBeVisible();
    if (basis === 'actual') {
      await sourceSelect.focus();
      await page.keyboard.press('Enter');
      const list = page.getByRole('listbox');
      await expect(list.getByRole('option')).toHaveText(['Jüngste Saison', 'Historische Saison', 'Alter Garten']);
      await list.getByRole('option', { name: 'Historische Saison' }).focus();
      await page.keyboard.press('Enter');
      await expect(sourceSelect).toHaveText('Historische Saison');
      const preview = page.waitForResponse(response => (
        response.url().includes('/seasons/creation-options/') && response.url().includes('use_actual_dates=true')
        && new URL(response.url()).searchParams.get('source_season_id') === String(older.id)
      ));
      await dateBasis.check();
      expect((await preview).ok()).toBe(true);
      await expect(dialog.getByText(/Der Anbauplan aus .*Historische Saison.* wird übernommen/)).toBeVisible();
    }
    expect(await dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
    await test.info().attach(`create-season-${basis}`, {
      body: await dialog.screenshot({ animations: 'disabled' }), contentType: 'image/png',
    });
    const copying = page.waitForResponse(response => response.url().endsWith('/seasons/create-and-copy/'));
    await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
    const response = await copying;
    expect(response.request().postDataJSON()).toEqual({
      start_date: '2026-09-01', end_date: '2027-08-31', source_season_id: source.id,
      ...(basis === 'actual' ? { use_actual_dates: true } : {}),
    });
    const created = await response.json();
    expect(created).toMatchObject({ planting_plan_count: 1 });
    await expect(switcher).toContainText('26/27');
    const { results } = await apiRequest<{ results: Array<{ id: number; planting_plan_count: number }> }>(page, 'GET', '/seasons/');
    expect(results.find(season => season.id === source.id)?.planting_plan_count).toBe(1);
    expect(results.find(season => season.id === (source.id === older.id ? newest.id : older.id))
      ?.planting_plan_count).toBe(0);
    type Dates = { id: number; season: number; planting_date: string; harvest_date: string; actual_sowing_date: string | null };
    const { results: rows } = await apiRequest<{ results: Dates[] }>(page, 'GET', '/planting-plans/');
    expect(rows.filter(plan => plan.season === created.id)).toMatchObject([{
      planting_date: basis === 'actual' ? '2027-04-06' : '2027-04-01',
      harvest_date: '2027-05-03', actual_sowing_date: null,
    }]);
    expect(await apiRequest<Dates>(page, 'GET', `/planting-plans/${original.id}/`)).toMatchObject({
      planting_date: `${year}-04-01`, harvest_date: `${year}-05-03`, actual_sowing_date: `${year}-04-06`,
    });
  });
}

async function seedRotationParcels(page: Page) {
  const location = await apiRequest<{ id: number }>(page, 'POST', '/locations/', { name: 'Versuchsgarten' });
  const createParcel = async (name: string, length: number) => {
    const parcel = await apiRequest<{ id: number }>(page, 'POST', '/fields/', {
      name, location: location.id, length_m: 20, width_m: 10,
    });
    const beds = [];
    for (const suffix of ['1', '2']) {
      beds.push(await apiRequest<{ id: number }>(page, 'POST', '/beds/', {
        name: `${name}beet ${suffix}`, field: parcel.id, length_m: length, width_m: 1,
      }));
    }
    return { ...parcel, beds };
  };
  return { north: await createParcel('Nord', 10), south: await createParcel('Süd', 8) };
}

async function seedRotationSourcePlan(page: Page, season: number, bed: number, year: number) {
  const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: `Rotationssalat ${year}`, cultivation_type: 'direct_sowing', growth_duration_days: 30,
    row_spacing_m: 0.5, distance_within_row_m: 0.2,
    seed_rate_direct_value: 2, seed_rate_direct_unit: 'g_per_m2',
    sowing_calculation_safety_percent_direct: 25,
  });
  return apiRequest<{ id: number }>(page, 'POST', '/planting-plans/', {
    season, bed, crop: crop.id, planting_date: `${year}-04-01`, cultivation_type: 'direct_sowing',
    actual_sowing_date: `${year}-04-06`, area_usage_sqm: 5, quantity: 25,
  });
}

test('a phone configures parcel and bed order and copies a reviewed rotation', async ({ page, request }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await loginWithDeterministicProject(page, request, 'parcel-rotation-phone', { loginAsAdmin: true });
  const { north, south } = await seedRotationParcels(page);
  const source = await createSeason(page, '2026-01-01', '2026-12-31', 'Ursprung');
  const target = await createSeason(page, '2027-01-01', '2027-12-31', 'Ziel');
  await seedRotationSourcePlan(page, source.id, north.beds[0].id, 2026);

  await page.goto('/app/fields-beds');
  const northRow = page.locator(`[data-hierarchy-mobile-row-id="field-${north.id}"]`);
  if (!(await northRow.isVisible())) {
    await page.getByRole('button', { name: /^Aufklappen:.*Versuchsgarten/ }).click();
  }
  // Rotation groups are project-wide: the list toolbar opens their management (#1576).
  await page.getByRole('button', { name: 'Rotationsgruppen verwalten' }).click();
  const settings = page.getByRole('dialog', { name: 'Rotationsgruppen verwalten' });
  await settings.getByRole('textbox', { name: 'Gruppenname' }).fill('Nord–Süd');
  for (const name of ['Nord', 'Süd']) {
    await settings.getByRole('combobox', { name: 'Parzelle hinzufügen' }).click();
    await page.getByRole('option', { name, exact: true }).click();
  }
  await settings.getByRole('button', { name: 'Süd nach oben verschieben' }).click();
  await settings.getByText('Beetreihenfolge', { exact: true }).first().click();
  await settings.getByRole('button', { name: 'Südbeet 2 nach oben verschieben' }).click();
  expect(await settings.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  await test.info().attach('parcel-order-phone', {
    body: await settings.screenshot({ animations: 'disabled' }), contentType: 'image/png',
  });
  await settings.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(settings).toHaveCount(0);
  await expect(northRow.getByRole('img', { name: 'Rotationsgruppe Nord–Süd, Parzelle 2 von 2' })).toBeVisible();
  await page.reload();
  await expect(northRow.getByText('Nord–Süd · 2/2')).toBeVisible();

  await page.goto(plansPage);
  await page.getByRole('button', { name: 'Aktive Saison wechseln' }).click();
  await page.getByRole('menuitem').filter({ hasText: 'Ziel' })
    .getByRole('button', { name: 'Saison-Aktionen öffnen' }).click();
  await page.getByRole('menuitem', { name: 'Daten übernehmen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Daten übernehmen' });
  const rotate = dialog.getByRole('checkbox', { name: 'Parzellenrotation anwenden' });
  const actual = dialog.getByRole('checkbox', { name: 'Ist-Termine als Plantermine verwenden' });
  await expect(rotate).toBeChecked();
  const preview = dialog.getByRole('region', { name: 'Vorschau' });
  await expect(preview.getByText('Nord → Süd', { exact: true })).toBeVisible();
  const moveDetails = preview.getByRole('button', { name: 'Details zu 1 verschobenen Anbauplan' });
  await expect(moveDetails).toHaveAttribute('aria-expanded', 'false');
  await expect(dialog.getByText('Belegte Fläche 5 → 4 m²')).toBeHidden();
  await moveDetails.focus();
  await page.keyboard.press('Enter');
  await expect(dialog.getByText('Belegte Fläche 5 → 4 m²')).toBeVisible();
  await expect(dialog.getByText('Berechnete Pflanzenzahl 50 → 40')).toBeVisible();
  await expect(dialog.getByText('Saatgutbedarf 10 g')).toBeVisible();
  await actual.check();
  await expect(rotate).toBeChecked();
  await rotate.uncheck();
  await expect(actual).toBeChecked();
  await expect(rotate).not.toBeChecked();
  await expect(dialog.getByText('Belegte Fläche 5 → 4 m²')).toHaveCount(0);
  await rotate.check();
  await preview.getByRole('button', { name: 'Details zu 1 verschobenen Anbauplan' }).click();
  await expect(dialog.getByText('Belegte Fläche 5 → 4 m²')).toBeVisible();
  await expect(preview.getByTestId('season-copy-totals')).toContainText('0 bestehend + 1 neu = 1 Anbauplan');
  expect(await dialog.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  await test.info().attach('rotation-copy-phone', {
    body: await dialog.screenshot({ animations: 'disabled' }), contentType: 'image/png',
  });
  const copying = page.waitForResponse(response => response.url().endsWith(`/seasons/${target.id}/copy-from/`));
  await dialog.getByRole('button', { name: '1 Anbauplan übernehmen', exact: true }).click();
  const response = await copying;
  expect(response.request().postDataJSON()).toMatchObject({
    source_season_id: source.id, use_actual_dates: true, rotate_parcels: true,
    parcel_rotation_fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
  });
  expect(await response.json()).toMatchObject({ copied_count: 1 });
  const { results } = await apiRequest<{ results: Array<{ season: number }> }>(page, 'GET', '/planting-plans/');
  expect(results.filter(plan => plan.season === target.id)).toMatchObject([{
    bed: south.beds[1].id, area_usage_sqm: '4.00', quantity: 25, planting_date: '2027-04-06',
  }]);
});

test('guided creation refreshes the rotated preview before accepting changed dates', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, 'parcel-rotation-creation', { loginAsAdmin: true });
  const { north, south } = await seedRotationParcels(page);
  const source = await createSeason(page, '2025-09-01', '2026-08-31', 'Letzte Saison');
  const older = await createSeason(page, '2024-09-01', '2025-08-31', 'Frühere Saison');
  await apiRequest(page, 'PATCH', '/season-pattern/', { start_day: 1, start_month: 9 });
  await seedRotationSourcePlan(page, source.id, north.beds[0].id, 2026);
  await seedRotationSourcePlan(page, older.id, north.beds[1].id, 2025);

  await page.goto('/app/fields-beds');
  await page.getByTestId('growing-area-search-toolbar').getByRole('button', { name: 'Rotationsgruppen verwalten' }).click();
  const groups = page.getByRole('dialog', { name: 'Rotationsgruppen verwalten' });
  await groups.getByRole('textbox', { name: 'Gruppenname' }).fill('Nord–Süd');
  for (const name of ['Süd', 'Nord']) {
    await groups.getByRole('combobox', { name: 'Parzelle hinzufügen' }).click();
    await page.getByRole('option', { name, exact: true }).click();
  }
  const order = groups.getByRole('list', { name: 'Parzellenreihenfolge' });
  await order.locator('[draggable="true"]').nth(1).dragTo(order.getByText('1. Süd', { exact: true }));
  await expect(order.getByText('1. Nord', { exact: true })).toBeVisible();
  await groups.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(groups).toHaveCount(0);
  await page.getByRole('link', { name: 'Anbaupläne', exact: true }).first().click();
  const switcher = page.getByRole('button', { name: 'Aktive Saison wechseln' });
  await switcher.click();
  await page.getByRole('menuitem').filter({ hasText: 'Saison 26/27 anlegen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Saison 26/27 anlegen?' });
  const select = dialog.getByRole('combobox', { name: 'Ausgangssaison' });
  const rotate = dialog.getByRole('checkbox', { name: 'Parzellenrotation anwenden' });
  const actual = dialog.getByRole('checkbox', { name: 'Ist-Termine als Plantermine verwenden' });
  await expect(select).toHaveText('Letzte Saison');
  await expect(rotate).toBeChecked();
  const creationDetails = dialog.getByRole('button', { name: 'Details zu 1 verschobenen Anbauplan' });
  await creationDetails.click();
  await expect(dialog.getByText('Belegte Fläche 5 → 4 m²')).toBeVisible();
  await actual.check();
  await select.click();
  await page.getByRole('option', { name: 'Frühere Saison' }).click();
  await expect(rotate).toBeDisabled();
  await expect(rotate).not.toBeChecked();
  await expect(actual).toBeChecked();
  await select.click();
  await page.getByRole('option', { name: 'Letzte Saison' }).click();
  await expect(rotate).toBeChecked();
  await creationDetails.click();
  await expect(dialog.getByText('Belegte Fläche 5 → 4 m²')).toBeVisible();
  await test.info().attach('rotation-creation-desktop', {
    body: await dialog.screenshot({ animations: 'disabled' }), contentType: 'image/png',
  });
  const copying = page.waitForResponse(response => response.url().endsWith('/seasons/create-and-copy/'));
  const activated = page.waitForEvent('load');
  await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
  const response = await copying;
  expect(response.request().postDataJSON()).toMatchObject({
    source_season_id: source.id, use_actual_dates: true, rotate_parcels: true,
    parcel_rotation_fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
  });
  expect(response.status()).toBe(201);
  const target = await response.json();
  await activated;
  await expect(switcher).toContainText('26/27');
  const { results } = await apiRequest<{ results: Array<{ season: number }> }>(page, 'GET', '/planting-plans/');
  expect(results.filter(plan => plan.season === target.id)).toMatchObject([{
    bed: south.beds[0].id, area_usage_sqm: '4.00', quantity: 25, planting_date: '2027-04-06',
  }]);
});
