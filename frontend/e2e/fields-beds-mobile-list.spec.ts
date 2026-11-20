import { expect, test, type Page } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject } from './utils';

type LocationResponse = { id: number; name: string };
type FieldResponse = { id: number; name: string };
type BedResponse = { id: number; name: string };

interface SeededHierarchy {
  location: LocationResponse;
  field: FieldResponse;
  bed: BedResponse;
}

/**
 * Seeds two locations next to the project's own first one, plus a
 * Parzelle/Beet pair with known dimensions under the first seeded one.
 */
async function seedHierarchy(page: Page, prefix: string): Promise<SeededHierarchy> {
  const location = await apiRequest<LocationResponse>(page, 'POST', '/locations/', { name: `${prefix} Standort` });
  await apiRequest<LocationResponse>(page, 'POST', '/locations/', { name: `${prefix} Standort Zwei` });
  const field = await apiRequest<FieldResponse>(page, 'POST', '/fields/', {
    name: `${prefix} Parzelle`,
    location: location.id,
    length_m: 10,
    width_m: 5,
  });
  const bed = await apiRequest<BedResponse>(page, 'POST', '/beds/', {
    name: `${prefix} Beet`,
    field: field.id,
    length_m: 2,
    width_m: 3,
  });
  return { location, field, bed };
}

test.describe('fields-beds mobile list', () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 375, height: 800 },
  });

  test('collapsed render shows no children and no sheet', async ({ page, request }) => {
    await loginWithDeterministicProject(page, request, 'fields-mobile-list-collapsed', { loginAsAdmin: true });
    const { location, field } = await seedHierarchy(page, 'Mobile List Collapsed');
    await page.goto('/app/fields-beds');

    const locationRow = page.locator(`[data-hierarchy-mobile-row-id="location-${location.id}"]`);
    await expect(locationRow).toBeVisible();
    await expect(page.locator(`[data-hierarchy-mobile-row-id="field-${field.id}"]`)).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('expanding a chevron reveals children without opening a sheet', async ({ page, request }) => {
    await loginWithDeterministicProject(page, request, 'fields-mobile-list-expand', { loginAsAdmin: true });
    const { location, field } = await seedHierarchy(page, 'Mobile List Expand');
    await page.goto('/app/fields-beds');

    const locationRow = page.locator(`[data-hierarchy-mobile-row-id="location-${location.id}"]`);
    await locationRow.getByRole('button', { name: /^Aufklappen:/ }).click();

    await expect(page.locator(`[data-hierarchy-mobile-row-id="field-${field.id}"]`)).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('tapping a Standort row opens the sheet with the right breadcrumb and title', async ({ page, request }) => {
    await loginWithDeterministicProject(page, request, 'fields-mobile-list-location-sheet', { loginAsAdmin: true });
    const { location } = await seedHierarchy(page, 'Mobile List Location Sheet');
    await page.goto('/app/fields-beds');

    const locationRow = page.locator(`[data-hierarchy-mobile-row-id="location-${location.id}"]`);
    await locationRow.getByRole('button', { name: new RegExp(`^${location.name}`) }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Oberste Ebene')).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Standort bearbeiten' })).toBeVisible();

    // Locations have optional outer dimensions (#1190): positive values only.
    const length = dialog.getByLabel('Länge (m)', { exact: true });
    const width = dialog.getByLabel('Breite (m)', { exact: true });
    await length.fill('0');
    await width.fill('12');
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(dialog.getByText('Länge und Breite des Standorts müssen größer als 0 sein.')).toBeVisible();
    await length.fill('30,5');
    await expect(dialog.getByText(/366/)).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('location-sheet-dimensions.png'), animations: 'disabled' });
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(dialog).toBeHidden();
    const saved = await apiRequest<{ length_m: number; width_m: number; area_sqm: number }>(page, 'GET', `/locations/${location.id}/`);
    expect([saved.length_m, saved.width_m, saved.area_sqm]).toEqual([30.5, 12, 366]);
  });

  test('tapping a Parzelle row opens the sheet with the right breadcrumb and title', async ({ page, request }) => {
    await loginWithDeterministicProject(page, request, 'fields-mobile-list-field-sheet', { loginAsAdmin: true });
    const { location, field } = await seedHierarchy(page, 'Mobile List Field Sheet');
    await page.goto('/app/fields-beds');

    const locationRow = page.locator(`[data-hierarchy-mobile-row-id="location-${location.id}"]`);
    await locationRow.getByRole('button', { name: /^Aufklappen:/ }).click();

    const fieldRow = page.locator(`[data-hierarchy-mobile-row-id="field-${field.id}"]`);
    await fieldRow.getByRole('button', { name: new RegExp(`^${field.name}`) }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(location.name)).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Parzelle bearbeiten' })).toBeVisible();
  });

  test('discarding an edit asks for confirmation and leaves the row unchanged', async ({ page, request }) => {
    await loginWithDeterministicProject(page, request, 'fields-mobile-list-discard', { loginAsAdmin: true });
    const { location, field } = await seedHierarchy(page, 'Mobile List Discard');
    await page.goto('/app/fields-beds');

    const locationRow = page.locator(`[data-hierarchy-mobile-row-id="location-${location.id}"]`);
    await locationRow.getByRole('button', { name: /^Aufklappen:/ }).click();
    const fieldRow = page.locator(`[data-hierarchy-mobile-row-id="field-${field.id}"]`);
    await fieldRow.getByRole('button', { name: new RegExp(`^${field.name}`) }).click();

    const dialog = page.getByRole('dialog');
    const nameInput = dialog.getByLabel('Name', { exact: true });
    await nameInput.fill(`${field.name} geändert`);

    await dialog.getByRole('button', { name: 'Abbrechen' }).click();

    const discardDialog = page.getByRole('dialog', { name: 'Änderungen verwerfen?' });
    await expect(discardDialog).toBeVisible();
    await discardDialog.getByRole('button', { name: 'Weiter bearbeiten' }).click();

    await expect(dialog).toBeVisible();
    await expect(nameInput).toHaveValue(`${field.name} geändert`);

    await dialog.getByRole('button', { name: 'Abbrechen' }).click();
    await page.getByRole('dialog', { name: 'Änderungen verwerfen?' }).getByRole('button', { name: 'Verwerfen' }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(fieldRow.getByText(field.name, { exact: false })).toBeVisible();
  });

  test('editing dimensions updates the live area readout and the saved row', async ({ page, request }) => {
    await loginWithDeterministicProject(page, request, 'fields-mobile-list-save-dimensions', { loginAsAdmin: true });
    const { location, field } = await seedHierarchy(page, 'Mobile List Save Dimensions');
    await page.goto('/app/fields-beds');

    const locationRow = page.locator(`[data-hierarchy-mobile-row-id="location-${location.id}"]`);
    await locationRow.getByRole('button', { name: /^Aufklappen:/ }).click();
    const fieldRow = page.locator(`[data-hierarchy-mobile-row-id="field-${field.id}"]`);
    await fieldRow.getByRole('button', { name: new RegExp(`^${field.name}`) }).click();

    const dialog = page.getByRole('dialog');
    const lengthInput = dialog.getByLabel('Länge (m)', { exact: true });
    const widthInput = dialog.getByLabel('Breite (m)', { exact: true });
    await lengthInput.fill('4');
    await widthInput.fill('3');

    await expect(dialog.getByText(/Fläche \(berechnet\).*12/)).toBeVisible();

    const saveResponse = page.waitForResponse((response) => (
      response.url().includes(`/api/fields/${field.id}/`)
      && response.request().method() === 'PUT'
      && response.status() === 200
    ));
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await saveResponse;

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(fieldRow.getByText(/4.*×.*3.*12/)).toBeVisible();
  });

  test('duplicating a bed from its row sheet copies the dimensions under the next free name', async ({ page, request }) => {
    await loginWithDeterministicProject(page, request, 'fields-mobile-list-duplicate-bed', { loginAsAdmin: true });
    const { location, field, bed } = await seedHierarchy(page, 'Mobile List Duplicate Bed');
    await page.goto('/app/fields-beds');

    const locationRow = page.locator(`[data-hierarchy-mobile-row-id="location-${location.id}"]`);
    await locationRow.getByRole('button', { name: /^Aufklappen:/ }).click();
    const fieldRow = page.locator(`[data-hierarchy-mobile-row-id="field-${field.id}"]`);
    await fieldRow.getByRole('button', { name: /^Aufklappen:/ }).click();

    const bedRow = page.locator(`[data-hierarchy-mobile-row-id="${bed.id}"]`);
    await expect(bedRow).toBeVisible();
    await bedRow.getByRole('button', { name: new RegExp(`^${bed.name}`) }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Beet bearbeiten' })).toBeVisible();

    const createResponsePromise = page.waitForResponse((response) => (
      response.url().includes('/api/beds/') && response.request().method() === 'POST' && response.status() === 201
    ));
    await dialog.getByRole('button', { name: 'Weitere Aktionen' }).click();
    await page.getByRole('menuitem', { name: /^Beet duplizieren/ }).click();
    const createdBed = await createResponsePromise;
    const created = await createdBed.json() as { id: number };

    // The sheet closes so the created bed is visible in the list.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText(`Beet „${bed.name} 2“ angelegt`)).toBeVisible();
    // Bed rows carry their bare numeric id, unlike location-/field-prefixed rows.
    const duplicateRow = page.locator(`[data-hierarchy-mobile-row-id="${created.id}"]`);
    await expect(duplicateRow).toBeVisible();
    await expect(duplicateRow.getByText(`${bed.name} 2`)).toBeVisible();

    // The copy carries the source dimensions and derived area.
    await duplicateRow.getByRole('button', { name: new RegExp(`^${bed.name} 2`) }).click();
    const editDialog = page.getByRole('dialog');
    await expect(editDialog.getByLabel('Länge (m)', { exact: true })).toHaveValue('2');
    await expect(editDialog.getByLabel('Breite (m)', { exact: true })).toHaveValue('3');
    await page.screenshot({ path: test.info().outputPath('duplicate-bed-dimensions.png'), animations: 'disabled' });
  });
});
