import { expect, test, type Locator, type Page } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject } from './utils';

test.use({ serviceWorkers: 'block' });

type Entity = { id: number; name: string };

// Long, but within the auto-sized name column's maximum width.
const LONG_NAME = 'Nordparzelle am langen Heckenrand';

/** Two parcels in one rotation group; the first has a long name (#1576). */
async function seedRotation(page: Page) {
  const location = await apiRequest<Entity>(page, 'POST', '/locations/', { name: 'Rotationsgarten' });
  const parcel = async (name: string) => {
    const field = await apiRequest<Entity>(page, 'POST', '/fields/', {
      name, location: location.id, length_m: 20, width_m: 10,
    });
    const bed = await apiRequest<Entity>(page, 'POST', '/beds/', {
      name: `${name.slice(0, 4)} Beet`, field: field.id, length_m: 10, width_m: 1,
    });
    return { field, bed };
  };
  const north = await parcel(LONG_NAME);
  const south = await parcel('Süd');
  await apiRequest(page, 'POST', '/parcel-rotation-groups/', {
    name: 'Nord–Süd',
    parcels: [{ id: south.field.id, bed_ids: [south.bed.id] }, { id: north.field.id, bed_ids: [north.bed.id] }],
  });
  return { north, south };
}

async function box(locator: Locator) {
  const result = await locator.boundingBox();
  expect(result).not.toBeNull();
  return result!;
}

test('keeps parcel names clear of the row actions and moves rotation into a column, toolbar and details', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, 'growing-area-rotation-list', { loginAsAdmin: true });
  const { north } = await seedRotation(page);
  await page.goto('/app/fields-beds');

  const row = page.locator(`[role="row"][data-id="field-${north.field.id}"]`);
  const name = row.getByTestId('hierarchy-name-text');
  await expect(name).toHaveText(LONG_NAME);
  // No badge beside the name, and the full name fits in the auto-sized column.
  await expect(row.getByText(/Nord–Süd/)).toHaveCount(0);
  expect(await name.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);

  const before = await box(name);
  await row.hover();
  const actions = row.getByTestId('hierarchy-name-actions-overlay');
  await expect(actions).toHaveCSS('opacity', '1');
  const after = await box(name);
  const actionsBox = await box(actions);
  expect(after).toEqual(before);
  expect(actionsBox.x).toBeGreaterThanOrEqual(after.x + after.width);
  // The quick actions are identified by their icons; no tooltip appears over them.
  for (const label of ['Beet für diese Parzelle hinzufügen', 'Löschen', 'Aktionen']) {
    await actions.getByRole('button', { name: label }).hover();
    await page.waitForTimeout(400);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  }
  await testInfo.attach('rotation-list-hover-1440', {
    body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png',
  });

  // The parcel menu keeps its groups but no longer configures rotation.
  await actions.getByRole('button', { name: 'Aktionen' }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem').first()).toHaveText('Parzellendetails');
  await expect(menu.getByRole('menuitem', { name: /Parzellenrotation/ })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: /Rotationsgruppen/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // The optional column is hidden until enabled and remembered across reloads.
  const toolbar = page.getByTestId('growing-area-search-toolbar');
  await expect(page.getByRole('columnheader', { name: 'Rotationsgruppe' })).toHaveCount(0);
  await toolbar.getByRole('button', { name: 'Spalten' }).click();
  await page.getByRole('checkbox', { name: 'Rotationsgruppe' }).check();
  await page.keyboard.press('Escape');
  const cell = row.locator('[data-field="rotation_group"]');
  await expect(cell).toHaveText('Nord–Süd · 2/2');
  await page.reload();
  await expect(cell).toHaveText('Nord–Süd · 2/2');
  await testInfo.attach('rotation-list-column-1440', {
    body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png',
  });

  // Project-level management from the toolbar; reordering updates the column.
  await toolbar.getByRole('button', { name: 'Rotationsgruppen verwalten' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rotationsgruppen verwalten' });
  await dialog.getByRole('combobox', { name: 'Rotationsgruppe' }).click();
  await page.getByRole('option', { name: 'Nord–Süd' }).click();
  await dialog.getByRole('button', { name: `${LONG_NAME} nach oben verschieben` }).click();
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(cell).toHaveText('Nord–Süd · 1/2');

  // Parcel details show membership and reach the same dialog.
  await page.goto(`/app/fields-beds/fields/${north.field.id}`);
  const section = page.getByTestId('detail-section-rotation');
  await expect(section.getByTestId('detail-rotation-group')).toContainText('Nord–Süd');
  await expect(section.getByTestId('detail-rotation-group')).toContainText('Parzelle 1 von 2');
  await testInfo.attach('rotation-details-1440', {
    body: await page.screenshot({ animations: 'disabled', fullPage: true }), contentType: 'image/png',
  });
  await section.getByRole('button', { name: 'Rotationsgruppen verwalten' }).click();
  await expect(page.getByRole('dialog', { name: 'Rotationsgruppen verwalten' })
    .getByRole('textbox', { name: 'Gruppenname' })).toHaveValue('Nord–Süd');
});

test('reaches rotation management from the phone list toolbar', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await loginWithDeterministicProject(page, request, 'growing-area-rotation-phone', { loginAsAdmin: true });
  await seedRotation(page);
  await page.goto('/app/fields-beds');

  const manage = page.getByTestId('growing-area-search-toolbar').getByRole('button', { name: 'Rotationsgruppen verwalten' });
  await expect(manage).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await testInfo.attach('rotation-list-375', {
    body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png',
  });
  await manage.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Rotationsgruppen verwalten' })).toBeVisible();
});
