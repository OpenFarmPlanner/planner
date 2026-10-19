import { expect, test, type Page } from '@playwright/test';
import { loginWithDeterministicProject } from './utils';

// "Beet hinzufügen" prefills a new bed from the field's last bed (name
// counted up, length and width). These specs are about empty/nameless
// drafts, so they clear the prefilled values first.
const clearPrefilledBedDraft = async (page: Page, fields: readonly string[]): Promise<void> => {
  for (const field of fields) {
    const input = page.locator(`.MuiDataGrid-row--editing [data-field="${field}"] input`);
    await input.click();
    await input.fill('');
  }
  // MUI's default edit cell debounces committing keystrokes (~200ms).
  await page.waitForTimeout(300);
};

test.describe('fields-beds row edit exit behavior', () => {
  test.beforeEach(async ({ page, request }) => {
    await loginWithDeterministicProject(page, request, 'fields-click-outside-0', { loginAsAdmin: true });
    await page.goto('/app/fields-beds');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
  });

  test('Escape on an empty new field removes it immediately, no reload needed', async ({ page }) => {
    const rowCountBefore = await page.locator('[role="row"][data-id]').count();

    await page.getByRole('button', { name: 'Parzelle hinzufügen' }).first().click();
    await page.waitForTimeout(400);
    await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(1);

    await page.keyboard.press('Escape');
    await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator('[role="row"][data-id]')).toHaveCount(rowCountBefore);
  });

  test('clicking outside the grid commits a valid new field instead of discarding it', async ({ page }) => {
    await page.getByRole('button', { name: 'Parzelle hinzufügen' }).first().click();
    await page.waitForTimeout(400);

    const nameInput = page.locator('.MuiDataGrid-row--editing input[type="text"]').first();
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    await nameInput.fill('KlickAusserhalbParzelle');
    // MUI's default edit cell debounces committing keystrokes into its internal
    // edit state by ~200ms; clicking away sooner reads a stale (empty) draft.
    await page.waitForTimeout(300);

    // Click outside the grid entirely (not a Tab/blur within the grid) - simulates
    // a user clicking the page heading while a row is still being edited.
    await page.locator('h1', { hasText: 'Anbauflächen' }).click();
    await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(0, { timeout: 5000 });
    await expect(page.getByText('KlickAusserhalbParzelle')).toBeVisible({ timeout: 5000 });

    // Reload to confirm the row was actually persisted to the backend, not just
    // visually retained in the grid's local state.
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('KlickAusserhalbParzelle')).toBeVisible({ timeout: 5000 });
  });

  test('clicking outside the grid on a completely empty new field discards it', async ({ page }) => {
    const rowCountBefore = await page.locator('[role="row"][data-id]').count();

    await page.getByRole('button', { name: 'Parzelle hinzufügen' }).first().click();
    await page.waitForTimeout(400);
    await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(1);

    await page.locator('h1', { hasText: 'Anbauflächen' }).click();
    await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator('[role="row"][data-id]')).toHaveCount(rowCountBefore);
  });

  test('clicking outside the grid on a partially filled, nameless new field shows a confirm dialog', async ({ page }) => {
    const rowCountBefore = await page.locator('[role="row"][data-id]').count();

    await page.getByRole('button', { name: 'Parzelle hinzufügen' }).first().click();
    await page.waitForTimeout(400);

    const lengthCell = page.locator('.MuiDataGrid-row--editing [role="gridcell"][data-field="length_m"]');
    await lengthCell.click();
    const lengthInput = page.locator('.MuiDataGrid-row--editing [data-field="length_m"] input');
    await lengthInput.fill('4');
    await page.waitForTimeout(300);

    await page.locator('h1', { hasText: 'Anbauflächen' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByRole('heading', { name: 'Zeile nicht gespeichert' })).toBeVisible();
    await expect(dialog.getByText('Name ist ein Pflichtfeld', { exact: false })).toBeVisible();
    // The row cleanly exits edit mode before the dialog opens (an editable
    // input fighting the dialog's focus trap causes it to be torn down
    // again) - "Weiter bearbeiten" resumes editing with the typed values.
    await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Verwerfen' }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('[role="row"][data-id]')).toHaveCount(rowCountBefore);
  });

});

test.describe('fields-beds row edit exit behavior with existing rows', () => {
  test.beforeEach(async ({ page, request }) => {
    await loginWithDeterministicProject(page, request, 'fields-click-outside-1', { loginAsAdmin: true, demoProject: true });
    await page.goto('/app/fields-beds');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
  });

  test('clicking into a different row discards a completely empty new bed, without a validation error', async ({ page }) => {
    const rows = page.locator('[role="row"][data-id]');
    const rowCountBefore = await rows.count();
    const existingFieldRow = rows.filter({ has: page.getByRole('button', { name: /^Beet.*hinzufügen/ }) }).first();
    const existingRowId = await existingFieldRow.getAttribute('data-id');

    await existingFieldRow.click({ button: 'right' });
    await page.getByRole('menuitem', { name: /^Beet hinzufügen/ }).click();
    await page.waitForTimeout(400);
    await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(1);
    await clearPrefilledBedDraft(page, ['name', 'length_m', 'width_m']);

    // Click a cell in a DIFFERENT, existing row - not a click outside the grid
    // entirely (already covered above), but MUI's own row-to-row edit switch,
    // which commits the abandoned draft through processRowUpdate instead of
    // the app's separate "click outside the grid" handler.
    await page.locator(`[role="row"][data-id="${existingRowId}"] [data-field="name"]`).click();

    await expect(page.getByText('Name ist ein Pflichtfeld')).not.toBeVisible();
    await expect(rows).toHaveCount(rowCountBefore, { timeout: 5000 });
  });

  test('clicking into a different row shows the unsaved-row dialog for a partially filled new bed', async ({ page }) => {
    const rows = page.locator('[role="row"][data-id]');
    const existingFieldRow = rows.filter({ has: page.getByRole('button', { name: /^Beet.*hinzufügen/ }) }).first();
    const existingRowId = await existingFieldRow.getAttribute('data-id');

    await existingFieldRow.click({ button: 'right' });
    await page.getByRole('menuitem', { name: /^Beet hinzufügen/ }).click();
    await page.waitForTimeout(400);
    await clearPrefilledBedDraft(page, ['name', 'length_m', 'width_m']);

    const lengthCell = page.locator('.MuiDataGrid-row--editing [role="gridcell"][data-field="length_m"]');
    await lengthCell.click();
    const lengthInput = page.locator('.MuiDataGrid-row--editing [data-field="length_m"] input');
    await lengthInput.fill('4');
    await page.waitForTimeout(300);

    // MUI's own row-to-row edit switch (stopRowEditMode), not a click outside
    // the grid - the name column's required-field validation blocks MUI from
    // ever reaching processRowUpdate here, so the app has to detect and
    // handle this itself before asking MUI to save.
    await page.locator(`[role="row"][data-id="${existingRowId}"] [data-field="name"]`).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByRole('heading', { name: 'Zeile nicht gespeichert' })).toBeVisible();

    await dialog.getByRole('button', { name: 'Weiter bearbeiten' }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
    const resumedInput = page.locator('.MuiDataGrid-row--editing [data-field="length_m"] input');
    await expect(resumedInput).toHaveValue('4', { timeout: 5000 });
  });
});
