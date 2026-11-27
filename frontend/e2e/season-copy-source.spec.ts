import { expect, test, type Locator, type Page } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject } from './utils';
import type { ParcelRotationSummary, SeasonCopyPreview, SeasonCreationOptions } from '../src/api/types';
import deNavigation from '../src/i18n/locales/de/navigation.json' with { type: 'json' };
import frNavigation from '../src/i18n/locales/fr/navigation.json' with { type: 'json' };
import deHierarchy from '../src/i18n/locales/de/hierarchy.json' with { type: 'json' };
import frHierarchy from '../src/i18n/locales/fr/hierarchy.json' with { type: 'json' };

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
  await expect(preview.getByTestId('season-copy-rotation-summary')).toHaveCount(0);
  const mappings = preview.getByRole('button', { name: '2 Parzellenzuordnungen für kopierte Anbaupläne' });
  await expect(mappings).toHaveAttribute('aria-expanded', 'false');
  await expect(preview.getByText('Nord → Süd', { exact: true })).toBeHidden();
  await mappings.click();
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
  const mappings = dialog.getByRole('button', { name: '2 Parzellenzuordnungen für kopierte Anbaupläne' });
  await expect(mappings).toHaveAttribute('aria-expanded', 'false');
  const creationDetails = dialog.getByRole('button', { name: 'Details zu 1 verschobenen Anbauplan' });
  await creationDetails.click();
  await expect(dialog.getByText('Belegte Fläche 5 → 4 m²')).toBeVisible();
  await actual.check();
  await select.click();
  await page.getByRole('option', { name: 'Frühere Saison' }).click();
  await expect(rotate).toBeDisabled();
  await expect(rotate).not.toBeChecked();
  await expect(mappings).toHaveCount(0);
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

const longParcel = (row: number) => `Parcelle-${row}-${'approvisionnementpédagogique'.repeat(4)}`;
const longCrop = (row: number) => `Chou-fleur ${row} · Sélection tardive du jardin maraîcher expérimental`;
const longBed = (row: number) => `Planche de démonstration pour les variétés anciennes ${row}`;

function largeRotationPreview(count: number) {
  const items: SeasonCopyPreview['items'] = Array.from({ length: count }, (_, index) => {
    const row = index + 1;
    return {
      source_plan_id: row, crop_label: longCrop(row), bed_id: row, bed_name: longBed(row), status: 'conflict',
      findings: [{
        kind: 'family_conflict', crop_label: longCrop(row), family_key: 'Brassicaceae', family_name: 'Brassicaceae',
        previous_plan_id: 100 + row, previous_crop_label: 'Chou', previous_family_key: 'Brassicaceae',
        previous_family_name: 'Brassicaceae', year: 2026, break_years: 4, earliest_year: 2031,
        break_source: 'family_default', settings_crop_id: row, settings_crop_label: longCrop(row),
      }],
    };
  });
  const mappings = items.map((_, index) => ({
    group: 'Jardin de la vallée', source_parcel_id: index + 1, source_parcel: longParcel(index + 1),
    target_parcel_id: index + 101, target_parcel: longParcel(index + 101),
  }));
  const cropRotation = { total: count + 4, conflict_count: count, conflict_free_count: 4, hint_count: 0, items };
  return { cropRotation, mappings };
}

function previewWithLongLists(rotation: ParcelRotationSummary, count: number): ParcelRotationSummary {
  const { mappings, cropRotation } = largeRotationPreview(count);
  return { ...rotation, mappings, crop_rotation: cropRotation, unchanged_count: 4 };
}

async function expectDialogFits(dialog: Locator, cancel: Locator, confirm: Locator) {
  await expect(cancel).toBeInViewport({ ratio: 1 });
  await expect(confirm).toBeInViewport({ ratio: 1 });
  const dimensions = await dialog.evaluate(node => {
    const box = node.getBoundingClientRect();
    const content = node.querySelector('.MuiDialogContent-root');
    return {
      top: box.top,
      belowViewport: box.bottom - window.innerHeight,
      horizontalOverflow: Math.max(node.scrollWidth - node.clientWidth, content ? content.scrollWidth - content.clientWidth : 0),
    };
  });
  expect(dimensions.top).toBeGreaterThanOrEqual(0);
  expect(dimensions.belowViewport).toBeLessThanOrEqual(1);
  expect(dimensions.horizontalOverflow).toBeLessThanOrEqual(1);
}

test.describe('compact season copy previews', () => {
  test.use({ hasTouch: true });

  for (const flow of ['copy', 'create'] as const) {
    test(`${flow} keeps the actions reachable with independent long preview lists`, async ({ page, request }, testInfo) => {
      test.setTimeout(100_000);
      await page.setViewportSize({ width: 1440, height: 900 });
      await loginWithDeterministicProject(page, request, `bounded-season-copy-${flow}`, { loginAsAdmin: true });
      const { north, south } = await seedRotationParcels(page);
      const source = await createSeason(page, '2025-09-01', '2026-08-31', 'Jardin avant le réaménagement de l’irrigation');
      const targetLabel = 'Jardin pédagogique après le réaménagement de l’irrigation';
      const target = flow === 'copy' ? await createSeason(page, '2026-09-01', '2027-08-31', targetLabel) : undefined;
      await apiRequest(page, 'PATCH', '/season-pattern/', { start_day: 1, start_month: 9 });
      await seedRotationSourcePlan(page, source.id, north.beds[0].id, 2026);
      await apiRequest(page, 'POST', '/parcel-rotation-groups/', {
        name: 'Nord–Sud', parcels: [north, south].map(parcel => ({ id: parcel.id, bed_ids: parcel.beds.map(bed => bed.id) })),
      });

      const french = flow === 'create';
      const copyText = (french ? frNavigation : deNavigation).seasonSwitcher;
      const parcelText = (french ? frHierarchy : deHierarchy).parcelRotation;
      const cancelText = french ? 'Annuler' : 'Abbrechen';
      if (french) {
        await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: 'fr' });
        await page.evaluate(() => localStorage.setItem('ui.language', 'fr'));
      }

      // Exercise both entry points with the genuine eligible preview and a
      // synthetic list size. The real copy operation is covered above.
      let count = 1;
      if (target) {
        await page.route(url => url.pathname.endsWith(`/seasons/${target.id}/copy-preview/`), async route => {
          const response = await route.fetch();
          const preview = await response.json() as SeasonCopyPreview;
          if (!preview.parcel_rotation?.enabled) {
            await route.fulfill({ response });
            return;
          }
          const rotation = previewWithLongLists(preview.parcel_rotation, count);
          await route.fulfill({ response, json: { ...preview, ...rotation.crop_rotation, parcel_rotation: rotation } });
        });
      } else {
        await page.route(url => url.pathname.endsWith('/seasons/creation-options/'), async route => {
          const response = await route.fetch();
          const options = await response.json() as SeasonCreationOptions;
          const reports = options.parcel_rotation;
          if (reports?.adopt?.enabled) reports.adopt = previewWithLongLists(reports.adopt, count);
          await route.fulfill({ response, json: options });
        });
      }
      await page.goto(plansPage);
      const open = async () => {
        await page.getByRole('button', { name: copyText.ariaLabel }).tap();
        if (target) {
          await page.getByRole('menuitem').filter({ hasText: targetLabel }).getByRole('button', { name: copyText.menu.openAria }).tap();
          await page.getByRole('menuitem', { name: copyText.menu.copyData, exact: true }).tap();
        } else {
          await page.getByRole('menuitem').filter({ hasText: copyText.suggestion.title.replace('{{label}}', '26/27') }).tap();
        }
        const title = target ? copyText.copyDialog.title : copyText.suggestion.confirmTitle.replace('{{label}}', '26/27');
        return page.getByRole('dialog', { name: title });
      };
      const warningLabel = (size: number) => (size === 1 ? copyText.copyDialog.rotation.conflictCount_one
        : copyText.copyDialog.rotation.conflictCount_other).replace('{{count}}', String(size));
      const mappingLabel = (size: number) => (size === 1 ? parcelText.mappingCount_one : parcelText.mappingCount_other)
        .replace('{{formatted}}', String(size));
      let dialog = await open();
      const mapping = (size: number) => dialog.getByRole('button', { name: mappingLabel(size), exact: true });
      const warnings = (size: number) => dialog.getByRole('button', { name: warningLabel(size), exact: true });
      const cancel = () => dialog.getByRole('button', { name: cancelText, exact: true });
      const confirm = (size: number) => dialog.getByRole('button', { name: target
        ? copyText.copyDialog.confirmCount_other.replace('{{count}}', String(size + 4)) : copyText.suggestion.create, exact: true });

      await expect(mapping(1)).toHaveAttribute('aria-expanded', 'false');
      await expect(warnings(1)).toHaveAttribute('aria-expanded', 'false');
      await expect(dialog.getByTestId('season-copy-rotation-summary').getByRole('alert')).toHaveClass(/Warning/);
      await warnings(1).focus();
      await page.keyboard.press('Enter');
      await expect(warnings(1)).toBeFocused();
      await expect(dialog.getByText(`${longCrop(1)} · ${longBed(1)}`, { exact: true })).toBeVisible();
      await expect(mapping(1)).toHaveAttribute('aria-expanded', 'false');
      const shortList = dialog.getByRole('list', { name: warningLabel(1) });
      await expect.poll(() => shortList.evaluate(list => list.scrollHeight - list.clientHeight)).toBeLessThanOrEqual(1);
      await expectDialogFits(dialog, cancel(), confirm(1));
      await cancel().tap();
      await expect(dialog).toBeHidden();

      count = 18;
      dialog = await open();
      await expect(mapping(count)).toHaveAttribute('aria-expanded', 'false');
      await expect(warnings(count)).toHaveAttribute('aria-expanded', 'false');
      await mapping(count).tap();
      await expect(warnings(count)).toHaveAttribute('aria-expanded', 'false');
      await warnings(count).tap();
      await expect(mapping(count)).toHaveAttribute('aria-expanded', 'true');
      await expect(warnings(count)).toHaveAttribute('aria-expanded', 'true');
      await expect(dialog.getByText(parcelText.unchangedBeds_other.replace('{{count}}', '4'))).toBeVisible();

      for (const viewport of [
        { width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 768, height: 580 },
        { width: 375, height: 600 }, { width: 800, height: 375 },
      ]) {
        await page.setViewportSize(viewport);
        for (const label of [mappingLabel(count), warningLabel(count)]) {
          const list = dialog.getByRole('list', { name: label, exact: true });
          await expect(list.getByRole('listitem')).toHaveCount(count);
          await expect.poll(() => list.evaluate(node => node.scrollHeight - node.clientHeight)).toBeGreaterThan(0);
          await list.evaluate(node => { node.scrollTop = 0; });
          await list.focus();
          await page.keyboard.press('End');
          await expect.poll(() => list.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(2);
        }
        await expectDialogFits(dialog, cancel(), confirm(count));
        await dialog.screenshot({ animations: 'disabled', path: testInfo.outputPath(`${flow}-preview-${viewport.width}.png`) });
      }
      await mapping(count).tap();
      await expect(mapping(count)).toHaveAttribute('aria-expanded', 'false');
      await expect(warnings(count)).toHaveAttribute('aria-expanded', 'true');
      await cancel().tap();
      await expect(dialog).toBeHidden();
    });
  }
});
