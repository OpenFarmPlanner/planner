import { expect, test } from '@playwright/test';
import { loginWithDeterministicProject, tabSaveHierarchyRow as tabSaveRow } from './utils';

test.describe('fields-beds Enter key behavior', () => {
  test.beforeEach(async ({ page, request }) => {
    await loginWithDeterministicProject(page, request, 'fields-enter-key-0');
    await page.goto('/app/fields-beds');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
  });

  test('Enter on new field (no beds, no dimensions) saves without opening next row', async ({ page }) => {
    await page.getByRole('button', { name: 'Parzelle hinzufügen' }).first().click();
    await page.waitForTimeout(400);

    const nameInput = page.locator('.MuiDataGrid-row--editing input[type="text"]').first();
    await expect(nameInput).toBeVisible({ timeout: 5000 });
    await nameInput.fill('Feld-Test-1');
    await page.waitForTimeout(100);

    expect(await page.locator('.MuiDataGrid-row--editing').count()).toBe(1);

    // Enter saves the new row and exits edit mode. A second Enter would act on
    // the newly focused persisted row and start a fresh edit.
    await nameInput.press('Enter');
    await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(0, { timeout: 5000 });
    await expect(page.getByText('Feld-Test-1')).toBeVisible({ timeout: 5000 });
  });

  test('Enter on existing field (no dimensions) saves without staying in edit mode', async ({ page }) => {
    // Create field with no dimensions using Tab-save
    await page.getByRole('button', { name: 'Parzelle hinzufügen' }).first().click();
    await page.waitForTimeout(400);
    const createInput = page.locator('.MuiDataGrid-row--editing input[type="text"]').first();
    await expect(createInput).toBeVisible({ timeout: 5000 });
    await createInput.fill('FeldOhneMasse');
    await tabSaveRow(page);
    await page.waitForTimeout(800);
    await expect(page.getByText('FeldOhneMasse')).toBeVisible({ timeout: 5000 });

    // Double-click the field name to edit it
    const fieldRow = page.locator('[role="row"][data-id]').filter({ hasText: 'FeldOhneMasse' }).first();
    await fieldRow.locator('[data-field="name"]').dblclick();
    await page.waitForTimeout(400);

    const editInput = page.locator('.MuiDataGrid-row--editing input[type="text"]').first();
    await expect(editInput).toBeVisible({ timeout: 3000 });

    // Press Enter — should save (Bug A was: throws "area must be positive")
    await editInput.press('Enter');
    await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(0, { timeout: 5000 });
  });

  test('Enter on field with dimensions and a bed below does not reopen field (ping-pong bug)', async ({ page }) => {
    // Create a field with dimensions using Tab-save
    await page.getByRole('button', { name: 'Parzelle hinzufügen' }).first().click();
    await page.waitForTimeout(400);
    const fieldInput = page.locator('.MuiDataGrid-row--editing input[type="text"]').first();
    await expect(fieldInput).toBeVisible({ timeout: 5000 });
    await fieldInput.fill('FeldMitMasse');
    // MUI's cell-edit commit is internally debounced; tabbing away immediately
    // (faster than a human would type/tab) can lose the name edit before it's
    // flushed into the row's tracked edit state.
    await page.waitForTimeout(100);
    // Tab to length
    await page.keyboard.press('Tab');
    await page.keyboard.press('1');
    // Tab to width
    await page.keyboard.press('Tab');
    await page.keyboard.press('1');
    // Tab past width (to the non-editable notes cell), then blur to actually commit the row
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    await page.locator('h1', { hasText: 'Anbauflächen' }).click();
    await expect(page.getByText('FeldMitMasse')).toBeVisible({ timeout: 5000 });

    // Add a bed via context menu
    const fieldRow = page.locator('[role="row"][data-id]').filter({ hasText: 'FeldMitMasse' }).first();
    await fieldRow.click({ button: 'right' });
    await page.waitForTimeout(300);
    await page.getByRole('menuitem', { name: /Beet/i }).first().click();
    await page.waitForTimeout(400);

    const bedInput = page.locator('.MuiDataGrid-row--editing input[type="text"]').first();
    await expect(bedInput).toBeVisible({ timeout: 5000 });
    await bedInput.fill('TestBeet');
    await tabSaveRow(page);
    await page.waitForTimeout(800);
    await expect(page.getByText('TestBeet')).toBeVisible({ timeout: 5000 });

    // Confirm the hierarchy: 2 data rows (field + bed)
    const totalRows = await page.locator('[role="row"][data-id]').count();
    console.log('Total data rows:', totalRows);
    expect(totalRows).toBe(2);

    // Double-click the field's name cell to enter edit mode
    await page.locator('[role="row"][data-id]').filter({ hasText: 'FeldMitMasse' }).first()
      .locator('[data-field="name"]').dblclick();
    await page.waitForTimeout(400);

    const editInput = page.locator('.MuiDataGrid-row--editing input[type="text"]').first();
    await expect(editInput).toBeVisible({ timeout: 3000 });
    expect(await editInput.inputValue()).toBe('FeldMitMasse');

    // First Enter: should save field and move focus to bed (but NOT open bed for editing)
    await editInput.press('Enter');
    await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(0, { timeout: 5000 });

    // Second Enter (on focused bed cell in view mode):
    // Bug B was: areas.edit shortcut fired → field re-opened for editing (ping-pong)
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);

    const afterSecondEnter = await page.locator('.MuiDataGrid-row--editing').count();
    console.log('Editing rows after 2nd Enter (on focused bed):', afterSecondEnter);

    // After the second Enter the bed should be in edit mode (MUI native behavior), not the field
    if (afterSecondEnter > 0) {
      const editingInput = page.locator('.MuiDataGrid-row--editing input[type="text"]').first();
      const value = await editingInput.inputValue();
      console.log('Editing row value:', value);
      // If a row entered edit mode, it must be the BED (not the field)
      expect(value).toBe('TestBeet');
    }
  });
});
