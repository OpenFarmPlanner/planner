import { expect, test, type Page } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject } from './utils';

type LocationResponse = { id: number };
type FieldResponse = { id: number; name: string };

async function createTwoParcelRows(page: Page, prefix: string): Promise<{
  firstField: FieldResponse;
  secondField: FieldResponse;
}> {
  const location = await apiRequest<LocationResponse>(page, 'POST', '/locations/', { name: `${prefix} Standort` });
  const firstField = await apiRequest<FieldResponse>(page, 'POST', '/fields/', {
    name: `${prefix} Parzelle A`,
    location: location.id,
  });
  const secondField = await apiRequest<FieldResponse>(page, 'POST', '/fields/', {
    name: `${prefix} Parzelle B`,
    location: location.id,
  });

  return { firstField, secondField };
}

async function replaceFocusedInputText(page: Page, value: string): Promise<void> {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.type(value);
}

// Below 600px (the `sm` breakpoint), FieldsBedsPage renders
// FieldsBedsHierarchyMobile instead of the DataGrid-based
// FieldsBedsHierarchy - so these tests target the create-mode
// HierarchyEditSheet rather than DataGrid row-editing DOM. They keep the
// original intent (the create-field deep link correctly focuses the name
// input, and per-row actions are reachable without hover/long-press) but
// retarget the DOM the new layout actually renders.
test.describe('fields-beds mobile create focus', () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });

  test('the add-parcel deep link opens the create sheet with the name field focused', async ({ page, request }) => {
    await loginWithDeterministicProject(page, request, 'fields-mobile-create-focus', { loginAsAdmin: true });
    await page.goto('/app/fields-beds?action=add-parcel');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const nameInput = dialog.getByLabel('Name', { exact: true });
    await expect(nameInput).toBeFocused({ timeout: 10_000 });
    await nameInput.fill('Mobile Fokus Parzelle');

    const lengthInput = dialog.getByLabel('Länge (m)', { exact: true });
    await lengthInput.fill('12');
    await expect(lengthInput).toHaveValue('12');
  });

  test('each row is edited and saved independently through its own sheet', async ({ page, request }) => {
    await loginWithDeterministicProject(page, request, 'fields-mobile-cross-row-edit', { loginAsAdmin: true });
    const { firstField, secondField } = await createTwoParcelRows(page, 'Mobile Cross Row');

    await page.goto('/app/fields-beds');
    // The fixture's default location plus the one just created makes this
    // "multiple locations" mode, so the two Parzellen are nested one level
    // down and only appear once their Standort row is expanded.
    await page.getByRole('button', { name: /^Aufklappen:/ }).click();
    const firstRow = page.locator(`[data-hierarchy-mobile-row-id="field-${firstField.id}"]`);
    const secondRow = page.locator(`[data-hierarchy-mobile-row-id="field-${secondField.id}"]`);
    await expect(firstRow).toBeVisible();
    await expect(secondRow).toBeVisible();

    await firstRow.getByRole('button', { name: new RegExp(`^${firstField.name}`) }).click();
    const dialog = page.getByRole('dialog');
    const nameInput = dialog.getByLabel('Name', { exact: true });
    await expect(nameInput).toHaveValue(firstField.name);
    await replaceFocusedInputText(page, 'Mobile Cross Row Parzelle A edited');

    const saveFirstRow = page.waitForResponse((response) => (
      response.url().includes(`/api/fields/${firstField.id}/`)
      && response.request().method() === 'PUT'
      && response.status() === 200
    ));
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await saveFirstRow;
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Editing the second row afterwards starts from its own, unaffected value.
    await secondRow.getByRole('button', { name: new RegExp(`^${secondField.name}`) }).click();
    const secondDialog = page.getByRole('dialog');
    const secondNameInput = secondDialog.getByLabel('Name', { exact: true });
    await expect(secondNameInput).toHaveValue(secondField.name);
  });

  test('the sheet overflow menu exposes the same per-row actions as desktop', async ({ page, request }) => {
    await loginWithDeterministicProject(page, request, 'fields-mobile-context-menu-button', { loginAsAdmin: true });
    const { secondField } = await createTwoParcelRows(
      page,
      'Mobile Context Menu Long Parcel Name',
    );

    await page.goto('/app/fields-beds');
    await page.getByRole('button', { name: /^Aufklappen:/ }).click();
    const secondRow = page.locator(`[data-hierarchy-mobile-row-id="field-${secondField.id}"]`);
    await expect(secondRow).toBeVisible();
    await secondRow.getByRole('button', { name: new RegExp(`^${secondField.name}`) }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Weitere Aktionen' }).click();

    await expect(page.getByRole('menuitem', { name: /^Beet hinzufügen/ })).toBeVisible();
  });
});

test.describe('fields-beds desktop cross-row editing', () => {
  test('clicking another row still saves the current row and immediately edits the clicked row', async ({ page, request }) => {
    await loginWithDeterministicProject(page, request, 'fields-desktop-cross-row-edit', { loginAsAdmin: true });
    const { firstField, secondField } = await createTwoParcelRows(page, 'Desktop Cross Row');

    await page.goto('/app/fields-beds');
    const firstNameCell = page.locator(`[role="row"][data-id="field-${firstField.id}"] [role="gridcell"][data-field="name"]`);
    const secondNameCell = page.locator(`[role="row"][data-id="field-${secondField.id}"] [role="gridcell"][data-field="name"]`);
    await expect(firstNameCell).toBeVisible();
    await expect(secondNameCell).toBeVisible();

    await firstNameCell.click();
    const firstInput = page.locator('.MuiDataGrid-row--editing [data-field="name"] input').first();
    await expect(firstInput).toBeFocused();
    await replaceFocusedInputText(page, 'Desktop Cross Row Parzelle A edited');
    await page.waitForTimeout(100);

    const saveFirstRow = page.waitForResponse((response) => (
      response.url().includes(`/api/fields/${firstField.id}/`)
      && response.request().method() === 'PUT'
      && response.status() === 200
    ));
    await secondNameCell.click();
    await saveFirstRow;

    const secondEditingRow = page.locator(`[role="row"][data-id="field-${secondField.id}"].MuiDataGrid-row--editing`);
    await expect(secondEditingRow).toBeVisible();
    const secondInput = secondEditingRow.locator('[data-field="name"] input');
    await expect(secondInput).toHaveValue(secondField.name);
  });
});
