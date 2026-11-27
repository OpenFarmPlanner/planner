import { expect, test, type Page } from '@playwright/test';
import type { PaginatedResponse, Season, SeasonCreationOptions, SeasonPattern } from '../src/api/types';
import { apiRequest, loginWithDeterministicProject } from './utils';

const optionsAt = (page: Page) => apiRequest<SeasonCreationOptions>(page, 'GET', '/seasons/creation-options/');
const seasonsAt = async (page: Page) => (await apiRequest<PaginatedResponse<Season>>(page, 'GET', '/seasons/')).results;
const firstSeasonPath = '/api/seasons/create-first/';

test('chooses the first season year from planning, cancels, then retries from the season menu', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, 'first-season-planning', { loginAsAdmin: true });
  const options = await optionsAt(page);
  expect(options).toMatchObject({ first_season: true, start_day: 1, start_month: 1 });
  const defaultYear = options.due_period!.start_date.slice(0, 4);
  await page.goto('/app/anbauplaene');
  const dialog = page.getByRole('dialog', { name: 'Erste Saison anlegen', exact: true });
  const year = dialog.getByRole('textbox', { name: 'Startjahr', exact: true });
  await page.getByRole('button', { name: 'Saison anlegen', exact: true }).click();
  await expect(year).toHaveValue(defaultYear);
  await expect(year).toBeFocused();
  await year.fill('2027');
  const month = dialog.getByRole('combobox', { name: 'Jährlicher Saisonbeginn', exact: true });
  await month.press('Enter');
  await expect(page.getByRole('option')).toHaveCount(12);
  await page.getByRole('option', { name: 'Oktober', exact: true }).click();
  await expect(dialog.getByText('27/28 · 1.10.2027 – 30.9.2028', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await seasonsAt(page)).toHaveLength(0);
  expect(await optionsAt(page)).toMatchObject({ first_season: true, start_day: 1, start_month: 1 });

  const seasonSwitcher = page.getByRole('button', { name: 'Aktive Saison wechseln', exact: true });
  await seasonSwitcher.press('Enter');
  await page.getByRole('menuitem', { name: /Erste Saison anlegen/ }).click();
  await expect(year).toHaveValue(defaultYear);
  await year.fill('2027');
  await expect(dialog.getByText('2027 · 1.1.2027 – 31.12.2027', { exact: true })).toBeVisible();
  await page.route(url => url.pathname === firstSeasonPath, route => route.fulfill({ status: 503 }), { times: 1 });
  await year.press('Enter');
  await expect(dialog.getByRole('alert')).toBeVisible();
  expect(await seasonsAt(page)).toHaveLength(0);
  expect(await optionsAt(page)).toMatchObject({ first_season: true, start_day: 1, start_month: 1 });
  const created = page.waitForResponse(response => new URL(response.url()).pathname === firstSeasonPath
    && response.request().method() === 'POST');
  await year.press('Enter');
  const response = await created;
  expect(response.status()).toBe(201);
  await expect(seasonSwitcher.getByText('2027', { exact: true })).toBeVisible();
  expect(await seasonsAt(page)).toMatchObject([{ label: '2027', start_date: '2027-01-01', end_date: '2027-12-31' }]);
  expect(await apiRequest<SeasonPattern>(page, 'GET', '/season-pattern/')).toMatchObject({ start_day: 1, start_month: 1 });
  await page.reload();
  await expect(seasonSwitcher.getByText('2027', { exact: true })).toBeVisible();
});

test.describe('first season on a phone', () => {
  test.use({ viewport: { width: 375, height: 800 }, hasTouch: true });

  test('creates the cross-year period shown in the crop calendar preview', async ({ page, request }, testInfo) => {
    await loginWithDeterministicProject(page, request, 'first-season-calendar', { loginAsAdmin: true });
    await page.goto('/app/gantt-chart');
    await page.getByRole('button', { name: 'Saison anlegen', exact: true }).tap();
    const dialog = page.getByRole('dialog', { name: 'Erste Saison anlegen', exact: true });
    await dialog.getByRole('textbox', { name: 'Startjahr', exact: true }).fill('2026');
    await dialog.getByRole('combobox', { name: 'Jährlicher Saisonbeginn', exact: true }).tap();
    await page.getByRole('option', { name: 'Oktober', exact: true }).tap();
    await expect(dialog.getByText('26/27 · 1.10.2026 – 30.9.2027', { exact: true })).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds?.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
    const save = dialog.getByRole('button', { name: 'Anlegen', exact: true });
    await expect(save).toBeInViewport();
    await testInfo.attach('first-season-phone', { body: await page.screenshot(), contentType: 'image/png' });
    await save.tap();
    const activeSeason = page.getByRole('button', { name: 'Aktive Saison wechseln', exact: true });
    await expect(activeSeason.getByText('26/27', { exact: true })).toBeVisible();
    expect(await seasonsAt(page)).toMatchObject([{ label: '26/27', start_date: '2026-10-01', end_date: '2027-09-30' }]);
    expect(await apiRequest<SeasonPattern>(page, 'GET', '/season-pattern/')).toMatchObject({ start_day: 1, start_month: 10 });
  });
});
