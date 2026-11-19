/**
 * Verify hover icon behavior across tables:
 * - Icons appear on mouse hover
 * - Icons disappear when mouse leaves
 * - Icons do NOT appear on keyboard-only navigation (Tab, Arrow keys)
 *
 * Note: during row edit mode MUI DataGrid renders editCell instead of renderCell,
 * so the overlay is not in the DOM at all during editing (naturally hidden).
 */
import { expect, test, type Page } from '@playwright/test';
import { loginWithDeterministicProject, startNewFieldFromLocationRow, tabSaveHierarchyRow } from './utils';

async function getOverlayOpacity(locator: ReturnType<Page['locator']>): Promise<number> {
  return locator.evaluate((el: HTMLElement) => parseFloat(window.getComputedStyle(el).opacity));
}

test.describe('hover icons – keyboard must not trigger visibility', () => {
  test.describe('FieldsBeds hierarchy', () => {
    test.beforeEach(async ({ page, request }) => {
      await loginWithDeterministicProject(page, request, 'hover-hierarchy-0');
      await page.goto('/app/fields-beds');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(500);
    });

    test('hierarchy name overlay: hover shows, mouse-leave hides, keyboard Tab never shows', async ({ page }) => {
      // Create a field so there's at least one row
      await startNewFieldFromLocationRow(page);
      await page.waitForTimeout(400);
      const input = page.locator('.MuiDataGrid-row--editing input[type="text"]').first();
      await expect(input).toBeVisible({ timeout: 5000 });
      await input.fill('HoverTestParzelle');
      await tabSaveHierarchyRow(page);
      await page.waitForTimeout(800);
      await expect(page.getByText('HoverTestParzelle')).toBeVisible({ timeout: 5000 });

      // Capture stable row ID for re-lookup during/after interactions
      const row = page.locator('[role="row"][data-id]').filter({ hasText: 'HoverTestParzelle' }).first();
      const rowDataId = await row.getAttribute('data-id');
      const rowById = page.locator(`[role="row"][data-id="${rowDataId}"]`);
      const overlay = rowById.locator('[data-testid="hierarchy-name-actions-overlay"]').first();
      await expect(overlay).toHaveCount(1);

      // 1. Move mouse far away — overlay must be invisible
      await page.mouse.move(10, 10);
      await page.waitForTimeout(200);
      const opacityInit = await getOverlayOpacity(overlay);
      console.log('[hierarchy] opacity before hover:', opacityInit);
      expect(opacityInit, 'Icons must be invisible before hover').toBe(0);

      // 2. Hover over the row — overlay must become visible
      await rowById.hover();
      await page.waitForTimeout(200);
      const opacityHover = await getOverlayOpacity(overlay);
      console.log('[hierarchy] opacity on hover:', opacityHover);
      expect(opacityHover, 'Icons must be visible on mouse hover').toBe(1);

      // 3. Move mouse away — overlay must hide again
      await page.mouse.move(10, 10);
      await page.waitForTimeout(200);
      const opacityLeave = await getOverlayOpacity(overlay);
      console.log('[hierarchy] opacity after mouse leave:', opacityLeave);
      expect(opacityLeave, 'Icons must hide when mouse leaves').toBe(0);

      // 4. Tab key (keyboard-only navigation) — overlay must NOT appear
      await page.keyboard.press('Tab');
      await page.waitForTimeout(200);
      const opacityTab = await getOverlayOpacity(overlay);
      console.log('[hierarchy] opacity after Tab key:', opacityTab);
      expect(opacityTab, 'Icons must NOT show on keyboard Tab navigation').toBe(0);

      // 5. Arrow key navigation — overlay must NOT appear
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(200);
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(200);
      const opacityArrow = await getOverlayOpacity(overlay);
      console.log('[hierarchy] opacity after Arrow key navigation:', opacityArrow);
      expect(opacityArrow, 'Icons must NOT show on keyboard Arrow navigation').toBe(0);
    });
  });
});
