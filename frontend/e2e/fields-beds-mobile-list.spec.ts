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
 * Seeds a second location (so the hierarchy renders a Standort level at
 * all - a single location collapses straight to Parzelle as the top level,
 * same as desktop) plus a Parzelle/Beet pair with known dimensions under the
 * first one.
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
});
