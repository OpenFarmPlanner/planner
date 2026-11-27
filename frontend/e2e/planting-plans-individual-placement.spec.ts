import { expect, test, type Page } from '@playwright/test';
import type { Bed, Crop, Field, PlantingPlan, Season } from '../src/api/types';
import { apiRequest, loginWithDeterministicProject } from './utils';

test.use({ serviceWorkers: 'block' });

const ITEM = 'Stangenbohne für Einzelpflanzung';
const PREVIEW = 'Pflanzen automatisch platzieren';
const PLANS = '/app/planting-plans';
const AREAS = '/app/fields-beds';

async function seedMixedBed(page: Page) {
  const { results: fields } = await apiRequest<{ results: Field[] }>(page, 'GET', '/fields/');
  const field = fields.find(item => item.name === 'Frühbeete Nord')!;
  const { results: seasons } = await apiRequest<{ results: Season[] }>(page, 'GET', '/seasons/');
  const season = seasons.find(item => item.start_date <= '2026-05-15' && item.end_date >= '2026-05-15')!;
  const bed = await apiRequest<Bed>(page, 'POST', '/beds/', {
    name: 'Mischbeet aus dem Demoprojekt', field: field.id, length_m: 4, width_m: 2,
  });
  const beans = await apiRequest<Crop>(page, 'POST', '/crops/', {
    name: ITEM, life_cycle: 'annual', cultivation_types: ['direct_sowing'],
    row_spacing_cm: 150, distance_within_row_cm: 50, growth_duration_days: 50,
  });
  const carrots = await apiRequest<Crop>(page, 'POST', '/crops/', {
    name: 'Karotte für das Mischbeet', life_cycle: 'annual', cultivation_types: ['direct_sowing'],
  });
  const area = await apiRequest<PlantingPlan>(page, 'POST', '/planting-plans/', {
    season: season.id, crop: carrots.id, bed: bed.id, planting_date: '2026-05-15', cultivation_type: 'direct_sowing', area_usage_sqm: 2,
  });
  return { field, bed, beans, area, season };
}

const planCreate = (page: Page) => page.waitForResponse(response =>
  response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/planting-plans/');

async function openDesktopDraft(page: Page, bedName: string, choice: RegExp) {
  await page.goto(PLANS);
  await expect(page.getByRole('grid').getByRole('gridcell').first()).toBeVisible();
  await page.getByRole('button', { name: 'Anbauplan hinzufügen', exact: true }).click();
  const draft = page.getByRole('grid').locator('[role="row"][data-id^="-"]');
  const cell = (field: string) => draft.locator(`[data-field="${field}"]`);
  await expect(draft).toBeVisible();
  const crop = cell('crop').getByRole('combobox');
  await crop.fill(ITEM);
  await page.getByRole('option', { name: ITEM, exact: true }).click();
  await cell('cultivation_type').getByRole('combobox').click();
  await page.getByRole('option', { name: 'Direktsaat', exact: true }).click();
  await cell('bed').dblclick();
  await page.getByRole('combobox', { name: 'Standort, Parzelle, Beet suchen' }).fill(bedName);
  await page.getByRole('option', { name: choice }).click();
  await cell('planting_date').getByRole('textbox').fill('15.05.2026');
  return { draft, cell };
}

test('records an exact location count from the table before any position is chosen', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, 'inline-count-only-at-location', {
    demoProject: true, demoYear: 2026, loginAsAdmin: true,
  });
  const { beans } = await seedMixedBed(page);
  const { results: sites } = await apiRequest<{ results: { id: number; name: string }[] }>(page, 'GET', '/locations/');
  const site = sites.find(site => site.name === 'Hofgarten')!;
  const { cell } = await openDesktopDraft(page, 'Hofgarten', /Einzelpflanzen am Standort.*Hofgarten/);
  await expect(cell('area_m2')).toHaveAttribute('aria-readonly', 'true');
  const count = cell('plants_count').getByRole('textbox');
  await count.fill('3');
  const save = planCreate(page);
  await count.press('Enter');
  const response = await save;
  expect(response.status(), await response.text()).toBe(201);
  const saved = await response.json() as PlantingPlan;
  expect(saved).toMatchObject({ crop: beans.id, site: site.id, bed: null, parcel: null,
    placement_mode: 'individual_site', plants_count: 3, positioned_plants_count: 0, pending_plants_count: 3,
    individual_positions: [], area_usage_sqm: null });
  await page.reload();
  await expect(page.locator(`[role="row"][data-id="${saved.id}"] [data-field="plants_count"]`)).toHaveText('3');
  await page.goto(`/app/planting-plans/${saved.id}`);
  await expect(page.getByText('3 noch nicht positioniert', { exact: true })).toBeVisible();
});

test('previews a bed plan, cancels without writing, and saves exact stems beside an area plan', async ({ page, request }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, 'plans-inline-individual-bed', {
    demoProject: true, demoYear: 2026, loginAsAdmin: true,
  });
  const { bed, beans, area } = await seedMixedBed(page);
  const { draft, cell } = await openDesktopDraft(page, bed.name, /Einzelpflanzen im Beet.*Mischbeet/);
  await expect(cell('area_m2')).toHaveAttribute('aria-readonly', 'true');
  await expect(cell('area_m2').getByRole('textbox')).toHaveCount(0);
  const count = cell('plants_count').getByRole('textbox');
  await count.fill('max');
  const preview = page.getByRole('dialog', { name: PREVIEW });
  const previewCanvas = preview.getByTestId('individual-generation-preview');
  const writes: number[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/planting-plans/') writes.push(1);
  });
  await count.press('Enter');
  await preview.getByRole('combobox', { name: 'Anzahl festlegen' }).click();
  await page.getByRole('option', { name: 'Genaue Anzahl' }).click();
  await preview.getByRole('textbox', { name: 'Zusätzliche Pflanzen' }).fill('3');
  await expect(previewCanvas).toHaveAttribute('data-position-count', '3');
  await preview.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(preview).toBeHidden();
  await expect(draft).toBeVisible();
  expect(writes).toHaveLength(0);

  await count.fill('max');
  await count.press('Enter');
  await preview.getByRole('combobox', { name: 'Anzahl festlegen' }).click();
  await page.getByRole('option', { name: 'Genaue Anzahl' }).click();
  await preview.getByRole('textbox', { name: 'Zusätzliche Pflanzen' }).fill('999');
  await expect(preview.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled();
  expect(writes).toHaveLength(0);
  await preview.getByRole('textbox', { name: 'Zusätzliche Pflanzen' }).fill('3');
  await expect(previewCanvas).toHaveAttribute('data-position-count', '3');
  await page.screenshot({ path: info.outputPath('inline-bed-generation.png'), animations: 'disabled' });
  const responsePromise = planCreate(page);
  await preview.getByRole('button', { name: 'Speichern', exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const saved = await response.json() as PlantingPlan;
  expect(saved).toMatchObject({ crop: beans.id, bed: bed.id, parcel: null, area_usage_sqm: null,
    plants_count: 3, placement_mode: 'individual_bed' });
  expect(saved.individual_positions).toHaveLength(3);
  expect(writes).toHaveLength(1);
  expect(await apiRequest(page, 'GET', `/planting-plans/${area.id}/`)).toMatchObject({ area_usage_sqm: area.area_usage_sqm, placement_mode: 'area' });

  await page.reload();
  const row = page.getByRole('grid').locator(`[data-id="${saved.id}"]`);
  await expect(row.locator('[data-field="plants_count"]')).toHaveText('3');
  await expect(row.getByRole('img', { name: 'Einzelpflanzen im Beet' })).toBeVisible();
  await row.locator('[data-field="crop"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Einzelpflanzen bearbeiten' }).click();
  const panel = page.getByRole('region', { name: 'Einzelpflanzen' });
  await expect(panel.getByTestId('individual-plants-parcel')).toContainText(bed.name);
  await expect(panel.getByText('3 Einzelpflanzen', { exact: true })).toBeVisible();
});

test('projects a direct orchard and an annual bed plan with exact ancestor counts', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, 'plans-individual-list-counts', {
    demoProject: true, demoYear: 2026, loginAsAdmin: true,
  });
  const { field, bed, beans, season } = await seedMixedBed(page);
  const annual = await apiRequest<PlantingPlan>(page, 'POST', '/planting-plans/', {
    season: season.id, crop: beans.id, bed: bed.id, placement_mode: 'individual_bed', cultivation_type: 'direct_sowing',
    planting_date: '2026-05-15', individual_positions: [{ x_m: 0, y_m: 1 }, { x_m: 1, y_m: 1 }],
  });
  await page.goto(AREAS);
  const grid = page.getByRole('grid');
  const search = page.getByRole('searchbox', { name: 'Anbauflächen durchsuchen' });
  await search.fill(ITEM);
  const plan = grid.locator(`[data-id="individual-plan-${annual.id}"]`);
  await expect(plan).toContainText('2 Einzelpflanzen');
  for (const dim of ['length_m', 'width_m', 'area_sqm']) await expect(plan.locator(`[data-field="${dim}"]`)).toHaveText('');
  await page.getByRole('button', { name: 'Spalten', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Einzelpflanzen', exact: true }).check();
  await search.click();
  const count = (rowId: string | number) => grid.locator(`[data-id="${rowId}"] [data-field="individualPlantCount"]`);
  await expect(count(bed.id!)).toHaveText('2');
  await expect(count(`field-${field.id}`)).toHaveText('5');
  await expect(count(`location-${field.location}`)).toHaveText('6');
  await expect(count(`individual-plan-${annual.id}`)).toHaveText('2');

  await plan.locator('[data-field="name"]').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Einzelpflanzen bearbeiten' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Löschen', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await search.fill('Topaz');
  await expect(grid.getByText('Apfel (Topaz)', { exact: true })).toHaveCount(2);
  await expect(plan).toHaveCount(0);
  await expect(count(`field-${field.id}`)).toHaveText('5');

  await search.clear();
  await grid.locator(`[data-id="${bed.id}"] [data-field="name"]`).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Einzelpflanzen hinzufügen' }).click();
  const panel = page.getByRole('region', { name: 'Einzelpflanzen' });
  await expect(panel.getByTestId('individual-plants-parcel')).toContainText(bed.name);
  await expect(panel.getByRole('combobox', { name: 'Kultur (Sorte)' })).toBeVisible();
  await panel.getByRole('button', { name: 'Schließen', exact: true }).click();
  await page.locator(`[data-graphical-object-target="field:${field.id}"]`).press('Shift+F10');
  const add = page.getByRole('menuitem', { name: 'Einzelpflanzen hinzufügen' });
  await expect(add).toHaveCount(1);
  await add.click();
  await expect(panel.getByTestId('individual-plants-parcel')).toHaveText(`Parzelle${field.name}`);
  await expect(panel.getByRole('combobox', { name: 'Kultur (Sorte)' })).toBeVisible();
});

test('mobile creation previews a parcel maximum and opens the saved planting plan', async ({ page, request }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await loginWithDeterministicProject(page, request, 'plans-mobile-individual-maximum', {
    demoProject: true, demoYear: 2026, loginAsAdmin: true,
  });
  const { field, beans } = await seedMixedBed(page);
  await page.goto(PLANS);
  await page.getByRole('button', { name: 'Anbauplan hinzufügen', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Anbauplan hinzufügen' });
  await form.getByRole('combobox').first().click();
  await page.getByRole('option', { name: ITEM, exact: true }).click();
  await form.getByRole('combobox').nth(1).click();
  await page.getByRole('option', { name: /Einzelpflanzen auf der Parzelle.*Frühbeete Nord/ }).click();
  await expect(form.getByRole('textbox', { name: 'Fläche (m²)' })).toBeDisabled();
  await form.getByRole('textbox', { name: 'Anzahl oder max' }).fill('max');
  await form.getByRole('textbox', { name: 'Pflanztermin', exact: true }).fill('15.05.2026');
  await form.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
  const preview = page.getByRole('dialog', { name: PREVIEW });
  await expect(preview.getByText('Maximal mögliche Anzahl', { exact: true })).toBeVisible();
  const canvas = preview.getByTestId('individual-generation-preview');
  await expect(canvas).not.toHaveAttribute('data-position-count', '0');
  const expected = Number(await canvas.getAttribute('data-position-count'));
  expect(expected).toBeGreaterThan(0);
  const pending = planCreate(page);
  await preview.getByRole('button', { name: 'Speichern', exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(201);
  const saved = await response.json() as PlantingPlan;
  expect(saved).toMatchObject({ crop: beans.id, parcel: field.id, bed: null, placement_mode: 'individual_parcel',
    plants_count: expected, area_usage_sqm: null });
  expect(saved.individual_positions).toHaveLength(expected);
  const card = page.locator(`[data-mobile-card-id="${saved.id}"]`);
  await expect(card).toBeInViewport();
  await card.getByRole('button', { name: /^Aktionen/ }).click();
  await page.getByRole('menuitem', { name: 'Einzelpflanzen bearbeiten' }).click();
  await expect(page.getByRole('region', { name: 'Einzelpflanzen' }).getByTestId('individual-plants-parcel')).toContainText(field.name);
});
