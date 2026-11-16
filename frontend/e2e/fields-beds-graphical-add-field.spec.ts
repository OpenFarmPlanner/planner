import { expect, test } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject, tabSaveHierarchyRow } from './utils';
import type Konva from 'konva';

// #903: a field added in the list view had no saved position and was placed in
// the middle of the 20 000 px workspace, far from the demo's saved positions,
// so fitting the graphical view zoomed out until fields and beds vanished.
test('adding a field in the list view keeps the graphical view zoomed to the fields', async ({ page, request }) => {
  await loginWithDeterministicProject(page, request, 'fields-graphical-add-field', { demoProject: true, loginAsAdmin: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/fields-beds');
  const zoomLabel = page.getByRole('region', { name: 'Standort: Acker am Bach', exact: true }).getByText(/^Zoom: /);
  // Read the automatic fit once the selected location's saved layout has arrived.
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
  // Turning the view changes which stage dimension limits the fit. Check
  // visibility and adjacency directly instead of assuming a landscape fit.
  await expect.poll(zoomOf).toBeGreaterThan(0.1);
  const fields = await apiRequest<{ results: Array<{ id: number; name: string }> }>(page, 'GET', '/fields/?search=Neue%20Parzelle');
  const addedId = fields.results.find(field => field.name === 'Neue Parzelle')!.id;
  const distanceToNeighbor = await page.evaluate(addedId => {
    const konva = (window as unknown as { Konva: { stages: Konva.Stage[] } }).Konva;
    const stage = konva.stages.find(stage => stage.container()?.isConnected &&
      stage.find('Rect').some(node => node.getAttr('data-testid') === `field-rect-${addedId}`))!;
    const rects = stage.find('Rect').filter(node => String(node.getAttr('data-testid')).startsWith('field-rect-'));
    const added = rects.find(node => node.getAttr('data-testid') === `field-rect-${addedId}`)!;
    return Math.min(...rects.filter(node => node !== added).map(other => Math.hypot(
      Math.max(0, other.x() - added.x() - added.width(), added.x() - other.x() - other.width()),
      Math.max(0, other.y() - added.y() - added.height(), added.y() - other.y() - other.height()),
    )));
  }, addedId);
  expect(distanceToNeighbor).toBeLessThanOrEqual(25);
});
