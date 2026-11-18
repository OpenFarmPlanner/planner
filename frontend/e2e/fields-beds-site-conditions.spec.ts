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
    await page.goto('/app/fields-beds');

    const row = page.locator(`[role="row"][data-id="${shadyBed.id}"]`);
    await row.click({ button: 'right' });
    const menuItems = page.getByRole('menu').getByRole('menuitem');
    await expect(menuItems.first()).toHaveText('Beetdetails');
    await menuItems.first().click();

    await expect(page).toHaveURL(new RegExp(`/app/fields-beds/beds/${shadyBed.id}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'SC Details Schattenbeet' })).toBeVisible();
    await expect(page.getByTestId('detail-light_condition')).toHaveText(/Schattig/);
    await expect(page.getByTestId('detail-irrigation')).toHaveText(/Übernommen vom Standort/);

    await page.getByRole('button', { name: 'Zurück zu den Anbauflächen' }).click();
    await expect(page).toHaveURL(/\/app\/fields-beds/);
    await expect(row).toBeVisible();
  });
});
