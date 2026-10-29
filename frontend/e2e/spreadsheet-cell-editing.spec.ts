import { expect, test, type Locator, type Page } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject } from './utils';

// The desktop spreadsheet edit model shared by the Anbauflächen and
// Anbaupläne tables (docs/datagrid-architecture.md, "Spreadsheet edit model").
// Unit tests cover the branches with mocked grids; this spec pins what only
// a real browser shows: native focus moves on a mouse press, so the
// post-save focus restore of the hierarchy could pull it back.

const EDIT_HINT = 'Doppelklick, Enter oder einfach lostippen zum Bearbeiten';
// The hint waits out the double-click interval before it shows.
const HINT_DELAY_MS = 700;

const editingRows = (page: Page): Locator => page.locator('.MuiDataGrid-row--editing');
const nameCell = (page: Page, rowName: string): Locator =>
  page.locator('[role="row"][data-id]').filter({ hasText: rowName }).locator('[role="gridcell"][data-field="name"]');

const focusedRowText = (page: Page): Promise<string> =>
  page.evaluate(() => document.activeElement?.closest('[role="row"]')?.textContent ?? '');

async function seedBeds(page: Page): Promise<void> {
  const locations = await apiRequest<{ results: Array<{ id: number }> }>(page, 'GET', '/locations/');
  const locationId = locations.results[0]?.id
    ?? (await apiRequest<{ id: number }>(page, 'POST', '/locations/', { name: 'Hof' })).id;
  const field = await apiRequest<{ id: number }>(page, 'POST', '/fields/', {
    name: 'Tabellenparzelle',
    location: locationId,
  });
  for (const name of ['Tabellenbeet Eins', 'Tabellenbeet Zwei']) {
    await apiRequest(page, 'POST', '/beds/', { name, field: field.id, length_m: 10, width_m: 1.2 });
  }
}

test.describe('spreadsheet edit model in the Anbauflächen table', () => {
  test.beforeEach(async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginWithDeterministicProject(page, request, 'spreadsheet-cell-editing-0', { loginAsAdmin: true });
    await page.goto('/app/fields-beds');
    await page.waitForLoadState('networkidle');
    await seedBeds(page);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(nameCell(page, 'Tabellenbeet Zwei')).toBeVisible();
  });

  test('a single click selects, a double click edits', async ({ page }) => {
    await nameCell(page, 'Tabellenbeet Eins').click();
    await expect(editingRows(page)).toHaveCount(0);
    expect(await focusedRowText(page)).toContain('Tabellenbeet Eins');

    await nameCell(page, 'Tabellenbeet Eins').dblclick();
    await expect(editingRows(page)).toHaveCount(1);
    await expect(editingRows(page).locator('[data-field="name"] input')).toBeFocused();
  });

  test('a click into another row saves without pulling focus back', async ({ page }) => {
    await nameCell(page, 'Tabellenbeet Eins').dblclick();
    const input = editingRows(page).locator('[data-field="name"] input');
    await expect(input).toBeFocused();
    await input.fill('Tabellenbeet Eins neu');
    // MUI's edit cell commits keystrokes after a short debounce.
    await page.waitForTimeout(300);

    await nameCell(page, 'Tabellenbeet Zwei').click();

    await expect(editingRows(page)).toHaveCount(0);
    await expect(nameCell(page, 'Tabellenbeet Eins neu')).toBeVisible();
    // The save resolves asynchronously; the focus must still be where the user clicked afterwards.
    await page.waitForTimeout(800);
    expect(await focusedRowText(page)).toContain('Tabellenbeet Zwei');
  });

  test('Enter edits, and Enter again saves', async ({ page }) => {
    await nameCell(page, 'Tabellenbeet Zwei').click();
    await page.keyboard.press('Enter');
    await expect(editingRows(page)).toHaveCount(1);

    await page.keyboard.press('Enter');
    await expect(editingRows(page)).toHaveCount(0);
  });

  test('typing replaces the value', async ({ page }) => {
    await nameCell(page, 'Tabellenbeet Zwei').click();
    await page.keyboard.type('Hochbeet');
    await expect(editingRows(page).locator('[data-field="name"] input')).toHaveValue('Hochbeet');
  });

  test('a single click on a bed cell shows the edit hint until it is dismissed', async ({ page }) => {
    const cell = nameCell(page, 'Tabellenbeet Eins');
    await cell.click();

    const hint = page.getByRole('status').filter({ hasText: EDIT_HINT });
    await expect(hint).toBeVisible();
    await expect(editingRows(page)).toHaveCount(0);
    // The hint points at the clicked cell instead of sitting at the page bottom.
    const cellBox = await cell.boundingBox();
    const hintBox = await hint.boundingBox();
    expect(cellBox && hintBox).toBeTruthy();
    expect(Math.abs(hintBox!.x - cellBox!.x)).toBeLessThan(40);
    expect(hintBox!.y - (cellBox!.y + cellBox!.height)).toBeGreaterThanOrEqual(0);
    expect(hintBox!.y - (cellBox!.y + cellBox!.height)).toBeLessThan(24);

    await page.getByRole('button', { name: 'Hinweis schließen' }).click();
    await expect(hint).toHaveCount(0);

    await page.reload();
    await page.waitForLoadState('networkidle');
    await nameCell(page, 'Tabellenbeet Zwei').click();
    await page.waitForTimeout(HINT_DELAY_MS);
    await expect(page.getByText(EDIT_HINT)).toHaveCount(0);
  });

  test('a double click edits without flashing the edit hint', async ({ page }) => {
    await nameCell(page, 'Tabellenbeet Eins').dblclick();
    await expect(editingRows(page)).toHaveCount(1);
    await page.waitForTimeout(HINT_DELAY_MS);
    await expect(page.getByText(EDIT_HINT)).toHaveCount(0);
  });
});
