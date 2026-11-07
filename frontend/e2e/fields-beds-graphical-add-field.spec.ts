import { expect, test } from '@playwright/test';
import { loginWithDeterministicProject, tabSaveHierarchyRow } from './utils';

// #903: a field added in the list view had no saved position and was placed in
// the middle of the 20 000 px workspace, far from the demo's saved positions,
// so fitting the graphical view zoomed out until fields and beds vanished.
test('adding a field in the list view keeps the graphical view zoomed to the fields', async ({ page, request }) => {
  await loginWithDeterministicProject(page, request, 'fields-graphical-add-field', { demoProject: true, loginAsAdmin: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/fields-beds');
  // The innermost element holding both the location heading and its zoom
  // read-out is that location's card.
  const zoomLabel = page.locator('div')
    .filter({ has: page.getByRole('heading', { name: 'Standort: Acker am Bach' }) })
    .filter({ has: page.getByText(/^Zoom: /) })
    .last()
    .getByText(/^Zoom: /);
  // The view fits itself live until the user zooms, so read it only once the
  // saved layouts of every location have arrived.
  const showGraphicalView = async (): Promise<void> => {
    const layouts = page.waitForResponse((response) => /\/locations\/\d+\/layouts\/$/.test(new URL(response.url()).pathname));
    await page.getByRole('button', { name: 'Grafik', exact: true }).click();
    await layouts;
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: 'Grafik', exact: true })).toBeEnabled();
    await expect(zoomLabel).toBeVisible();
  };
  const zoomOf = async (): Promise<number> => Number.parseFloat((await zoomLabel.innerText()).replace('Zoom: ', ''));

  await showGraphicalView();
  const zoomBefore = await zoomOf();
  expect(zoomBefore).toBeGreaterThan(0.1);

  await page.getByRole('button', { name: 'Liste', exact: true }).click();
  const row = page.getByRole('gridcell', { name: /Acker am Bach/ });
  await row.hover();
  await row.getByRole('button', { name: 'Parzelle', exact: true }).click({ force: true });
  await page.locator('.MuiDataGrid-row--editing input[type="text"]').first().fill('Neue Parzelle');
  await tabSaveHierarchyRow(page);
  await expect(page.getByRole('gridcell', { name: /Neue Parzelle/ })).toBeVisible();

  await showGraphicalView();
  // The new field widens the content a little; before the fix the view
  // zoomed out by a factor of about ten.
  await expect.poll(zoomOf).toBeGreaterThan(zoomBefore * 0.6);
});
