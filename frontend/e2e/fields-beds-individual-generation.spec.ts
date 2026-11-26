import { expect, test, type Locator, type Page } from '@playwright/test';
import type { PlantingPlan } from '../src/api/types';
import { apiRequest, loginWithDeterministicProject } from './utils';

test.use({ serviceWorkers: 'block' });

const generationTitle = 'Pflanzen automatisch platzieren';
const panel = (page: Page) => page.getByRole('region', { name: 'Einzelpflanzen', exact: true });

async function choose(page: Page, control: Locator, option: string) {
  await control.click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function configureBedPreview(page: Page) {
  await panel(page).getByRole('button', { name: generationTitle, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: generationTitle });
  await expect(dialog.getByRole('textbox', { name: 'Pflanzabstand in der Reihe (m)' })).toHaveValue('0,5');
  await expect(dialog.getByRole('textbox', { name: 'Reihenabstand (m)' })).toHaveValue('1,5');
  await choose(page, dialog.getByRole('combobox', { name: 'Reihenrichtung' }), 'Entlang der Breite');
  await dialog.getByRole('textbox', { name: 'Seitlicher Rand (m)' }).fill('0,5');
  await dialog.getByRole('textbox', { name: 'Rand an den Kopfenden (m)' }).fill('0,5');
  await choose(page, dialog.getByRole('combobox', { name: 'Anzahl festlegen' }), 'Maximal mögliche Anzahl');
  await expect(dialog.getByTestId('individual-generation-preview')).toHaveAttribute('data-position-count', '8');
  await expect(dialog.getByText('Reihen 3 · Neue Pflanzen 8 · Insgesamt 8')).toBeVisible();
  await expect(dialog.getByText('1 Position liegt zu nah an vorhandenen Stämmen.')).toBeVisible();
  return dialog;
}

test('previews and saves the same bed grid alongside area and individual plans', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.setFixedTime(new Date(2026, 4, 15, 12));
  await loginWithDeterministicProject(page, request, 'generate-bed-plants', { loginAsAdmin: true });
  const { results: [site] } = await apiRequest<{ results: { id: number }[] }>(page, 'GET', '/locations/');
  const plot = await apiRequest<{ id: number }>(page, 'POST', '/fields/', {
    name: 'Marktgarten', location: site.id, width_m: 12, length_m: 18,
  });
  const bed = await apiRequest<{ id: number }>(page, 'POST', '/beds/', {
    name: 'Mischbeet', field: plot.id, width_m: 2, length_m: 4,
  });
  const season = await apiRequest<{ id: number }>(page, 'POST', '/seasons/', {
    start_date: '2026-01-01', end_date: '2026-12-31',
  });
  const beans = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: 'Stangenbohne', life_cycle: 'annual', cultivation_types: ['direct_sowing'],
    distance_within_row_cm: 50, row_spacing_cm: 150, growth_duration_days: 50,
  });
  const carrots = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: 'Karotte', life_cycle: 'annual', cultivation_types: ['direct_sowing'],
  });
  const planting = {
    season: season.id, crop: carrots.id, bed: bed.id, planting_date: '2026-05-15', cultivation_type: 'direct_sowing',
  };
  const areaPlan = await apiRequest<PlantingPlan>(page, 'POST', '/planting-plans/', {
    ...planting, area_usage_sqm: 5,
  });
  const existing = await apiRequest<PlantingPlan>(page, 'POST', '/planting-plans/', {
    ...planting, placement_mode: 'individual_bed', individual_positions: [{ x_m: 0.5, y_m: 0.5 }],
  });

  await page.goto('/app/fields-beds');
  await page.getByRole('button', { name: 'Grafik', exact: true }).click();
  await page.locator(`[data-graphical-object-target="bed:${bed.id}"]`).press('Enter');
  await page.getByRole('button', { name: 'Neuer Einzelpflanzenplan', exact: true }).click();
  await choose(page, panel(page).getByRole('combobox', { name: 'Kultur (Sorte)', exact: true }), 'Stangenbohne');

  const dialog = await configureBedPreview(page);
  await testInfo.attach('bed-grid-preview', { body: await dialog.screenshot(), contentType: 'image/png' });
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).press('Enter');
  await expect(panel(page).getByText('0 Einzelpflanzen', { exact: true })).toBeVisible();

  await configureBedPreview(page);
  await dialog.getByRole('button', { name: 'Positionen übernehmen', exact: true }).press('Enter');
  await expect(dialog).toBeHidden();
  await expect(panel(page).getByText('8 Einzelpflanzen', { exact: true })).toBeVisible();
  const [response] = await Promise.all([
    page.waitForResponse(candidate => candidate.request().method() === 'POST'
      && new URL(candidate.url()).pathname === '/api/planting-plans/'),
    panel(page).getByRole('button', { name: 'Speichern', exact: true }).click(),
  ]);
  expect(response.status()).toBe(201);
  const saved = await response.json() as PlantingPlan;
  const expected = [
    { x_m: 1, y_m: 0.5 }, { x_m: 1.5, y_m: 0.5 },
    { x_m: 0.5, y_m: 2 }, { x_m: 1, y_m: 2 }, { x_m: 1.5, y_m: 2 },
    { x_m: 0.5, y_m: 3.5 }, { x_m: 1, y_m: 3.5 }, { x_m: 1.5, y_m: 3.5 },
  ];
  expect(saved).toMatchObject({ crop: beans.id, bed: bed.id, area_usage_sqm: null, plants_count: 8 });
  expect(saved.individual_positions).toMatchObject(expected);
  await page.goto(`/app/fields-beds?individualPlan=${saved.id}&locationId=${site.id}`);
  await expect(panel(page).getByText('8 Einzelpflanzen', { exact: true })).toBeVisible();
  const { results } = await apiRequest<{ results: PlantingPlan[] }>(page, 'GET', `/planting-plans/?bed=${bed.id}`);
  expect(results.find(plan => plan.id === saved.id)?.individual_positions).toEqual(saved.individual_positions);
  expect(results.find(plan => plan.id === existing.id)?.individual_positions).toEqual(existing.individual_positions);
  expect(Number(results.find(plan => plan.id === areaPlan.id)?.area_usage_sqm)).toBe(5);
});

test.describe('orchard generation on a phone', () => {
  test.use({ viewport: { width: 375, height: 800 }, hasTouch: true, isMobile: true });

  test('loads the orchard crop spacing and enforces the cap before confirmation', async ({ page, request }, testInfo) => {
    await page.clock.setFixedTime(new Date(2026, 4, 15, 12));
    await loginWithDeterministicProject(page, request, 'generate-orchard-plants-phone', {
      demoProject: true, demoYear: 2026, loginAsAdmin: true,
    });
    const { results: locations } = await apiRequest<{ results: { id: number; name: string }[] }>(page, 'GET', '/locations/');
    const site = locations.find(location => location.name === 'Hofgarten')!;
    const { results: [orchard] } = await apiRequest<{ results: PlantingPlan[] }>(
      page, 'GET', `/planting-plans/?individual_location=${site.id}`,
    );
    await page.goto(`/app/fields-beds?individualPlan=${orchard.id}&locationId=${site.id}`);
    const cropPath = `/api/crops/${orchard.crop}/`;
    await page.route(url => url.pathname === cropPath, route => route.fulfill({ status: 500, json: {} }), { times: 1 });
    await panel(page).getByRole('button', { name: 'Positionen bearbeiten' }).tap();
    const generate = panel(page).getByRole('button', { name: generationTitle });
    const retry = panel(page).getByRole('button', { name: 'Erneut versuchen' });
    await expect(panel(page).getByText('Kulturen konnten nicht geladen werden.')).toBeVisible();
    await expect(generate).toBeDisabled();
    const [cropDetails] = await Promise.all([
      page.waitForResponse(response => response.request().method() === 'GET'
        && new URL(response.url()).pathname === cropPath),
      retry.tap(),
    ]);
    expect(cropDetails.ok()).toBeTruthy();
    await generate.tap();
    const dialog = page.getByRole('dialog', { name: generationTitle });
    const count = dialog.getByRole('textbox', { name: 'Zusätzliche Pflanzen' });
    await expect(dialog.getByRole('textbox', { name: 'Pflanzabstand in der Reihe (m)' })).toHaveValue('4');
    await expect(dialog.getByRole('textbox', { name: 'Reihenabstand (m)' })).toHaveValue('4,5');
    await count.fill('1000');
    await expect(dialog.getByText(/Pro Plan sind höchstens 1.000 Stämme möglich/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Positionen übernehmen' })).toBeDisabled();
    await count.fill('2');
    await expect(dialog.getByTestId('individual-generation-preview')).toHaveAttribute('data-position-count', '2');
    await expect(dialog.getByText(/Neue Pflanzen 2 · Insgesamt 5/)).toBeVisible();
    await testInfo.attach('orchard-grid-phone', { body: await dialog.screenshot(), contentType: 'image/png' });
    await dialog.getByRole('button', { name: 'Positionen übernehmen' }).tap();
    await expect(panel(page).getByText('5 Einzelpflanzen', { exact: true })).toBeVisible();
    await panel(page).getByRole('button', { name: 'Abbrechen', exact: true }).tap();
    await expect(panel(page).getByText('3 Einzelpflanzen', { exact: true })).toBeVisible();
    await page.reload();
    await expect(panel(page).getByText('3 Einzelpflanzen', { exact: true })).toBeVisible();
  });
});
