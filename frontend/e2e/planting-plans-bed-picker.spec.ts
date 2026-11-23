import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject } from './utils';

test.use({ serviceWorkers: 'block' });

const cell = (page: Page, field: string) => page.locator(`[role="gridcell"][data-field="${field}"]`).first();
const picker = (page: Page) => page.getByRole('combobox', { name: 'Standort, Parzelle, Beet suchen' });
const beds = (page: Page) => page.getByRole('listbox', { name: 'Anbauflächen' });
const activeResult = (page: Page) => beds(page).locator('[data-highlighted="true"]');
const searchField = (page: Page) => page.getByTestId('inline-bed-picker');
const removeScope = (page: Page, name: string) => searchField(page).getByRole('button', { name: `Filter „${name}“ entfernen` });

async function seedBeds(page: Page, request: APIRequestContext, scenario: string, longPath = false) {
  await loginWithDeterministicProject(page, request, scenario, { loginAsAdmin: true });
  const { id: season } = await apiRequest<{ id: number }>(page, 'POST', '/seasons/', {
    start_date: '2026-01-01', end_date: '2026-12-31',
  });
  const location = longPath
    ? 'Sonnenacker mit sehr langer Standortbezeichnung am Nordhang und schmalem Zugang'
    : 'Hofgarten';
  const field = longPath
    ? 'Folientunnel Süd mit langer Parzellenbezeichnung und mehreren getrennten Abschnitten'
    : 'Frühbeete Nord';
  const name = longPath ? 'Tomatenreihe West 2026' : 'Salat 1';
  const createBed = async (bedName: string, fieldId: number) => (await apiRequest<{ id: number }>(
    page, 'POST', '/beds/', { name: bedName, field: fieldId, area_sqm: 18.8 },
  )).id;
  const createLocation = async (locationName: string) => (await apiRequest<{ id: number }>(
    page, 'POST', '/locations/', { name: locationName },
  )).id;
  const createField = async (fieldName: string, locationId: number) => (await apiRequest<{ id: number }>(
    page, 'POST', '/fields/', { name: fieldName, location: locationId },
  )).id;
  const home = await createLocation(location);
  const north = await createField(field, home);
  const south = await createField('Sommerbeete', home);
  const remote = await createLocation('Wiesenacker');
  const west = await createField('Westparzelle', remote);
  if (longPath) {
    const duplicate = await createField(field, remote);
    await createBed(name, duplicate);
  }
  const original = await createBed(name, north);
  const nearby = await createBed('Salat 2', north);
  await createBed('Kohl 1', south);
  const alternative = await createBed('Salat 3', west);

  const { id: crop } = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: 'Salat', propagation_duration_days: 21,
    cultivation_type: 'pre_cultivation', cultivation_types: ['pre_cultivation'], plants_per_m2: 4,
    crop_family: 'Asteraceae', rotation_break_years: 3,
  });
  const { id: plan } = await apiRequest<{ id: number }>(page, 'POST', '/planting-plans/', {
    bed: original, crop, season, cultivation_type: 'pre_cultivation',
    planting_date: '2026-04-10', area_input_value: 2, area_input_unit: 'M2',
  });
  await page.goto('/app/planting-plans');
  await expect(page.getByRole('heading', { name: 'Anbaupläne' })).toBeVisible();
  return { location, field, name, original, nearby, alternative, plan, crop };
}

test.describe('inline bed picker', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('opens by double click, Enter, F2 and typing, with focus returned on cancel', async ({ page, request }) => {
    await seedBeds(page, request, 'bed-picker-entry');
    const bedCell = cell(page, 'bed');
    await bedCell.click();
    await expect(picker(page)).toHaveCount(0);
    await expect(page.locator('.MuiDataGrid-row.ofp-row-editing')).toHaveCount(0);

    await bedCell.dblclick();
    await expect(picker(page)).toBeFocused();
    await expect(beds(page).getByRole('option', { selected: true })).toContainText('Salat 1');
    await expect(beds(page).getByRole('option', { name: /Salat 2/ })).toContainText(/18,80\s*m²/);
    await page.keyboard.press('Escape');
    await expect(bedCell.locator('span[tabindex]')).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(cell(page, 'sowing_date')).toHaveAttribute('tabindex', '0');
    await page.keyboard.press('Shift+Tab');
    await expect(picker(page)).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(picker(page)).toBeFocused();
    await page.keyboard.press('Escape');

    await page.keyboard.press('F2');
    await expect(picker(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await page.keyboard.press('s');
    await expect(picker(page)).toHaveValue('s');
    await page.keyboard.press('Escape');
    await expect(picker(page)).toHaveCount(0);
  });

  test('moves between location, plot and bed results and only assigns beds', async ({ page, request }, testInfo) => {
    const { plan, original, nearby, alternative } = await seedBeds(page, request, 'bed-picker-scope');
    const bedCell = cell(page, 'bed');
    const search = picker(page);
    const results = beds(page).getByRole('option');
    await bedCell.dblclick();
    const plotBadge = removeScope(page, 'Frühbeete Nord');
    await expect(plotBadge).toBeVisible();
    expect(await plotBadge.locator('span').first().evaluate((label) => label.scrollWidth <= label.clientWidth)).toBe(true);
    await expect(beds(page).getByRole('option')).toHaveCount(2);
    await search.press('Backspace');
    await expect(results).toHaveCount(5);
    await expect(removeScope(page, 'Hofgarten')).toBeVisible();
    await search.press('Backspace');
    await expect(results).toHaveCount(10);
    await expect(search).toHaveAttribute('placeholder', 'Standort, Parzelle, Beet suchen');
    await search.fill('Hofg');
    await expect(results.first()).toHaveAccessibleName('Hofgarten Standort');
    await expect(results.nth(1)).toHaveAccessibleName('Frühbeete Nord Hofgarten Parzelle');
    await expect(activeResult(page)).toHaveCount(1);
    await expect(search).toHaveAttribute('aria-activedescendant', (await results.first().getAttribute('id'))!);
    await search.press('ArrowLeft');
    expect(await search.evaluate((input: HTMLInputElement) => input.selectionStart)).toBe(3);
    await search.press('ArrowRight');
    expect(await search.evaluate((input: HTMLInputElement) => input.selectionStart)).toBe(4);
    await expect(activeResult(page)).toHaveAccessibleName('Hofgarten Standort');
    await expect(page.getByText(/Enter Bereich eingrenzen/)).toBeVisible();
    await expect(beds(page)).toHaveAttribute('aria-busy', 'false');
    await page.screenshot({ path: testInfo.outputPath('locale-de-bed-picker-1440-unscoped.png'), animations: 'disabled' });
    await search.press('ArrowDown');
    await expect(activeResult(page)).toHaveAccessibleName('Frühbeete Nord Hofgarten Parzelle');
    await search.press('ArrowUp');
    await expect(activeResult(page)).toHaveAccessibleName('Hofgarten Standort');
    await search.press('Enter');
    await expect(removeScope(page, 'Hofgarten')).toBeVisible();
    await expect(search).toBeFocused();
    await expect(search).toHaveValue('');
    await expect(results).toHaveCount(5);
    await search.fill('früh');
    await expect(results.first()).toHaveAccessibleName('Frühbeete Nord Parzelle');
    await search.press('Enter');
    await expect(removeScope(page, 'Frühbeete Nord')).toBeVisible();
    await expect(search).toBeFocused();
    await expect(search).toHaveValue('');
    await expect(page.getByText(/Enter Aktuelles Beet behalten/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('locale-de-bed-picker-1440-scoped.png'), animations: 'disabled' });

    await search.fill('wiesen sal');
    await expect(results).toHaveCount(0);
    await expect(page.getByText('Keine Treffer in Frühbeete Nord', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '1 Treffer außerhalb anzeigen' }).click();
    await expect(results).toHaveCount(1);
    await search.fill('hof fruh sal');
    await expect(results).toHaveCount(2);
    await expect(beds(page).locator('mark')).toHaveCount(6);
    expect(await beds(page).locator('mark').allTextContents()).toEqual(expect.arrayContaining(['Hof', 'Früh', 'Sal']));
    await search.press('Escape');
    expect(await apiRequest(page, 'GET', `/planting-plans/${plan}/`)).toMatchObject({ bed: original });

    await bedCell.dblclick();
    await expect(beds(page).getByRole('option', { name: /Salat 2/ })).toBeEnabled();
    await search.press('ArrowDown');
    await expect(activeResult(page)).toContainText('Salat 2');
    await expect(page.getByText(/Enter Beet zuweisen/)).toBeVisible();
    await search.press('Enter');
    await expect(bedCell).toContainText('Salat 2');
    expect(await apiRequest(page, 'GET', `/planting-plans/${plan}/`)).toMatchObject({ bed: nearby });

    await bedCell.dblclick();
    await page.getByRole('button', { name: 'An allen Standorten suchen' }).click();
    await search.fill('wiesen');
    await beds(page).getByRole('option', { name: 'Wiesenacker Standort' }).click();
    await expect(removeScope(page, 'Wiesenacker')).toBeVisible();
    await expect(search).toBeFocused();
    await beds(page).getByRole('option', { name: 'Westparzelle Parzelle', exact: true }).click();
    await expect(removeScope(page, 'Westparzelle')).toBeVisible();
    await expect(search).toBeFocused();
    await search.fill('sal');
    await beds(page).getByRole('option', { name: /Salat 3/ }).click();
    await expect(bedCell).toContainText('Salat 3');
    expect(await apiRequest(page, 'GET', `/planting-plans/${plan}/`)).toMatchObject({ bed: alternative });
  });

  test('truncates the ancestors and exposes the full path on focus and hover', async ({ page, request }) => {
    const { location, field, name } = await seedBeds(page, request, 'bed-picker-path', true);
    const bedCell = cell(page, 'bed');
    const prefix = bedCell.getByText(`${location} › ${field}`, { exact: true });
    await expect(prefix).toBeVisible();
    expect(await prefix.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    expect(await bedCell.getByText(name, { exact: true }).evaluate((element) => {
      const cellBox = element.closest('[role="gridcell"]')!.getBoundingClientRect();
      return element.getBoundingClientRect().right <= cellBox.right;
    })).toBe(true);
    const path = `${location} › ${field} › ${name}`;
    await prefix.hover();
    await expect(page.getByRole('tooltip')).toHaveText(path);
    await page.mouse.move(2, 2);
    await expect(page.getByRole('tooltip')).toBeHidden();
    await cell(page, 'cultivation_type').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('tooltip')).toHaveText(path);
  });

  test('keeps the saved bed and allows retry after a failed change', async ({ page, request }) => {
    const { plan, original, nearby } = await seedBeds(page, request, 'bed-picker-retry');
    const path = `/planting-plans/${plan}/`;
    let saveAttempts = 0;
    await page.route(`**/api${path}`, (route) => {
      if (route.request().method() === 'PUT' && ++saveAttempts === 1) {
        return route.fulfill({ status: 500, json: { detail: 'Simulated save error' } });
      }
      return route.continue();
    });
    await cell(page, 'bed').dblclick();
    const option = beds(page).getByRole('option', { name: /Salat 2/ });
    await option.click();
    await expect.poll(() => saveAttempts).toBe(1);
    await expect(picker(page)).toBeEditable();
    await expect(beds(page).getByRole('option', { selected: true })).toContainText('Salat 1');
    expect(await apiRequest(page, 'GET', path)).toMatchObject({ bed: original });

    await option.click();
    await expect(cell(page, 'bed')).toContainText('Salat 2');
    expect(await apiRequest(page, 'GET', path)).toMatchObject({ bed: nearby });
  });

  test('waits for capacity before allowing a different bed to be chosen', async ({ page, request }, testInfo) => {
    const { plan, original, nearby, crop } = await seedBeds(page, request, 'bed-picker-capacity');
    await apiRequest(page, 'PATCH', `/beds/${nearby}/`, { area_sqm: 0.5 });
    const { id: priorSeason } = await apiRequest<{ id: number }>(page, 'POST', '/seasons/', {
      start_date: '2025-01-01', end_date: '2025-12-31',
    });
    await apiRequest(page, 'POST', '/planting-plans/', {
      bed: nearby, crop, season: priorSeason, cultivation_type: 'pre_cultivation', planting_date: '2025-04-10',
      area_input_value: 0.5, area_input_unit: 'M2',
    });
    let releaseCheck = () => {};
    const capacityPending = new Promise<void>((resolve) => { releaseCheck = resolve; });
    let capacityRequested = false;
    await page.route(/\/planting-plans\/bed-suggestions\//, async (route) => {
      capacityRequested = true;
      await capacityPending;
      await route.continue();
    });
    await cell(page, 'bed').dblclick();
    const fullBed = beds(page).getByRole('option', { name: /Salat 2/ });
    try {
      await expect.poll(() => capacityRequested).toBe(true);
      await expect(beds(page)).toHaveAttribute('aria-busy', 'true');
      await expect(fullBed).toBeDisabled();
      await picker(page).fill('Salat 2');
      await picker(page).press('Enter');
      await expect(picker(page)).toBeVisible();
    } finally {
      releaseCheck();
    }
    await expect(beds(page)).toHaveAttribute('aria-busy', 'false');
    await expect(fullBed).toBeDisabled();
    await expect(fullBed).toContainText('0,5 m² frei · 2 m² benötigt');
    await expect(fullBed).toContainText('Korbblütler, frühestens 2029');
    await expect(activeResult(page)).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('locale-de-bed-picker-capacity.png'), animations: 'disabled' });
    expect(await apiRequest(page, 'GET', `/planting-plans/${plan}/`)).toMatchObject({ bed: original });
  });

  test('prevents a second selection during a save and preserves focus if the user moves on', async ({ page, request }) => {
    const { plan, nearby } = await seedBeds(page, request, 'bed-picker-save-in-flight');
    let releaseSave = () => {};
    const savePending = new Promise<void>((resolve) => { releaseSave = resolve; });
    let saveAttempts = 0;
    await page.route(`**/api/planting-plans/${plan}/`, async (route) => {
      if (route.request().method() === 'PUT') {
        saveAttempts += 1;
        await savePending;
      }
      await route.continue();
    });
    try {
      await cell(page, 'bed').dblclick();
      await beds(page).getByRole('option', { name: /Salat 2/ }).click();
      await expect.poll(() => saveAttempts).toBe(1);
      await expect(picker(page)).toHaveAttribute('readonly', '');
      await page.getByRole('heading', { name: 'Anbaupläne' }).click();
      await expect(picker(page)).toHaveCount(0);
      await cell(page, 'bed').dblclick();
      await expect(picker(page)).toHaveCount(0);
      await cell(page, 'sowing_date').click();
    } finally {
      releaseSave();
    }
    await expect(cell(page, 'bed')).toContainText('Salat 2');
    await expect(cell(page, 'sowing_date')).toHaveAttribute('tabindex', '0');
    expect(saveAttempts).toBe(1);
    expect(await apiRequest(page, 'GET', `/planting-plans/${plan}/`)).toMatchObject({ bed: nearby });
  });

  test('can keep the current bed when it no longer has enough area', async ({ page, request }) => {
    const { plan, original } = await seedBeds(page, request, 'bed-picker-current-capacity');
    await apiRequest(page, 'PATCH', `/beds/${original}/`, { area_sqm: 0.5 });
    const bedCell = cell(page, 'bed');
    await bedCell.dblclick();
    await expect(beds(page)).toHaveAttribute('aria-busy', 'false');
    await expect(activeResult(page)).toContainText('0,5 m² frei · 2 m² benötigt');
    await expect(activeResult(page)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText(/Enter Aktuelles Beet behalten/)).toBeVisible();
    await picker(page).press('Enter');
    await expect(picker(page)).toHaveCount(0);
    expect(await apiRequest(page, 'GET', `/planting-plans/${plan}/`)).toMatchObject({ bed: original });
  });
});

test('keeps long scopes inside an editable field at a narrow grid width', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 920, height: 850 });
  const { field, location, name, plan, original } = await seedBeds(page, request, 'bed-picker-narrow', true);
  await cell(page, 'bed').dblclick();
  const search = picker(page);
  const badge = removeScope(page, field);
  await expect(search).toBeFocused();
  await expect(search).toHaveAccessibleDescription(new RegExp(field));
  await expect(badge).toBeVisible();
  await expect(beds(page)).toHaveAttribute('aria-busy', 'false');
  await search.fill('Tomaten');
  await expect(beds(page).getByRole('option')).toHaveCount(1);
  const [boundary, input, chip] = await Promise.all([searchField(page).boundingBox(), search.boundingBox(), badge.boundingBox()]);
  expect(boundary && input && chip).toBeTruthy();
  expect(chip!.x).toBeGreaterThan(boundary!.x);
  expect(input!.x).toBeGreaterThanOrEqual(chip!.x + chip!.width);
  expect(input!.x + input!.width).toBeLessThanOrEqual(boundary!.x + boundary!.width);
  expect(input!.width).toBeGreaterThan(75);
  await page.screenshot({ path: testInfo.outputPath('locale-de-bed-picker-920-scoped.png'), animations: 'disabled' });

  await search.press('Tab');
  await expect(badge).toBeFocused();
  await badge.press('Enter');
  await expect(removeScope(page, location)).toBeVisible();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('Tomaten');
  await removeScope(page, location).click();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('Tomaten');
  await expect(beds(page).getByRole('option', { name: new RegExp(name) })).toHaveCount(2);
  await search.fill('Folientunnel');
  const plots = beds(page).getByRole('option', { name: /Parzelle$/ });
  await expect(plots).toHaveCount(2);
  await expect(plots.first()).toContainText(location);
  await expect(plots.last()).toContainText('Wiesenacker');
  await page.screenshot({ path: testInfo.outputPath('locale-de-bed-picker-920-unscoped.png'), animations: 'disabled' });
  await search.press('Escape');
  expect(await apiRequest(page, 'GET', `/planting-plans/${plan}/`)).toMatchObject({ bed: original });
});

test.describe('touch tablet bed picker', () => {
  test.use({ hasTouch: true, viewport: { width: 1024, height: 768 } });

  test('opens with a tap and commits via a full-sized option', async ({ page, request }) => {
    const { plan, nearby } = await seedBeds(page, request, 'bed-picker-touch');
    await cell(page, 'bed').tap();
    await removeScope(page, 'Frühbeete Nord').tap();
    await expect(removeScope(page, 'Hofgarten')).toBeVisible();
    await beds(page).getByRole('option', { name: 'Frühbeete Nord Parzelle', exact: true }).tap();
    await expect(removeScope(page, 'Frühbeete Nord')).toBeVisible();
    const option = beds(page).getByRole('option', { name: /Salat 2/ });
    await expect(option).toBeVisible();
    expect((await option.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await option.tap();
    await expect(cell(page, 'bed')).toContainText('Salat 2');
    expect(await apiRequest(page, 'GET', `/planting-plans/${plan}/`)).toMatchObject({ bed: nearby });
  });
});

test('preserves the mobile bed assignment when creating a plan', async ({ page, request }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const { alternative, plan } = await seedBeds(page, request, 'bed-picker-mobile');
  await page.locator(`[data-mobile-card-id="${plan}"]`).getByRole('button', { name: /Aktionen für Anbauplan/ }).click();
  await page.getByRole('menuitem', { name: 'Duplizieren' }).click();
  const form = page.getByRole('dialog', { name: 'Anbauplan hinzufügen' });
  await form.getByRole('combobox').filter({ hasText: 'Salat 1' }).click();
  await page.getByRole('option', { name: /Salat 3/ }).click();
  await expect(picker(page)).toHaveCount(0);
  const created = page.waitForResponse(response => (
    new URL(response.url()).pathname === '/api/planting-plans/' && response.request().method() === 'POST'
  ));
  await form.getByRole('button', { name: 'Hinzufügen' }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  expect(await response.json()).toMatchObject({ bed: alternative });
  await expect(form).toBeHidden();
});
