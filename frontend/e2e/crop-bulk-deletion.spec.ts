import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Crop, CropHistoryEntry, PaginatedResponse } from '../src/api/types';
import common from '../src/i18n/locales/de/common.json' with { type: 'json' };
import de from '../src/i18n/locales/de/crops.json' with { type: 'json' };
import { apiRequest, loginWithDeterministicProject, resetE2EScenario } from './utils';

test.use({ serviceWorkers: 'block' });

const selectedLabel = (name: string) => de.library.batchImport.selectNamed.replace('{{name}}', name);
const count = (dialog: Locator, label: string) =>
  dialog.getByText(label, { exact: true }).locator('xpath=following-sibling::dd[1]');

async function activeCropIds(page: Page) {
  const rows = await apiRequest<PaginatedResponse<Crop>>(page, 'GET', '/crops/');
  return rows.results.map(crop => crop.id);
}

async function filterByOrigin(page: Page, label: string) {
  await page.getByRole('button', { name: de.filters.openAdvanced }).click();
  await page.getByRole('combobox', { name: de.bulkDelete.origin.label }).click();
  await page.getByRole('option', { name: label, exact: true }).click();
  await page.keyboard.press('Escape');
}

test('project bulk deletion retains filtered selections, blocks plans and recovers a group', async ({ page, request }, info) => {
  test.setTimeout(100_000);
  const scenario = `crop-bulk-desktop-${randomUUID().slice(0, 12)}`;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginWithDeterministicProject(page, request, scenario, { loginAsAdmin: true });
    const general = await apiRequest<Crop>(page, 'POST', '/crops/', { name: 'Manual tomato' });
    const variety = await apiRequest<Crop>(page, 'POST', '/crops/', { name: general.name, variety: 'Roma' });
    const spare = await apiRequest<Crop>(page, 'POST', '/crops/', { name: 'Unselected chard' });
    await apiRequest(page, 'POST', '/crops/import/apply/', {
      items: [{ name: 'File basil' }], phase: 'crops',
    });
    const location = await apiRequest<{ id: number }>(page, 'POST', '/locations/', { name: 'Bulk garden' });
    const field = await apiRequest<{ id: number }>(page, 'POST', '/fields/', { location: location.id, name: 'Bulk field' });
    const bed = await apiRequest<{ id: number }>(page, 'POST', '/beds/', { field: field.id, name: 'Bulk bed', area_sqm: 12 });
    const season = await apiRequest<{ id: number }>(page, 'POST', '/seasons/', {
      start_date: '2030-01-01', end_date: '2030-12-31',
    });
    const before = await activeCropIds(page);
    await page.goto('/app/crops');
    const list = page.getByRole('listbox', { name: de.title, exact: true });
    const toggle = page.getByRole('button', { name: de.library.batchImport.selectCultures, exact: true });
    await expect(list.getByRole('checkbox')).toHaveCount(0);
    await toggle.press('Enter');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const selectionList = page.getByRole('list', { name: de.title, exact: true });
    const deleteSelection = page.getByRole('button', { name: common.actions.delete, exact: true });
    await expect(deleteSelection).toBeDisabled();

    const generalCheckbox = selectionList.getByRole('checkbox', { name: selectedLabel(general.name), exact: true });
    await generalCheckbox.focus();
    await page.keyboard.press('Space');
    await expect(generalCheckbox).toBeChecked();
    await selectionList.getByRole('button', { name: general.name, exact: true }).click();
    await expect(generalCheckbox).toBeChecked();
    await filterByOrigin(page, de.bulkDelete.origin.file_import);
    await expect(selectionList.getByRole('checkbox')).toHaveCount(1);
    await expect(selectionList.getByRole('checkbox', { name: selectedLabel('File basil'), exact: true })).toBeVisible();
    await page.getByRole('button', { name: de.library.batchImport.selectVisible.replace('{{count}}', '1'), exact: true }).click();
    await filterByOrigin(page, de.filters.all);
    await expect(generalCheckbox).toBeChecked();
    await expect(selectionList.getByRole('checkbox', { name: selectedLabel('File basil'), exact: true })).toBeChecked();
    await deleteSelection.click();

    const dialog = page.getByRole('dialog', { name: de.bulkDelete.title, exact: true });
    const confirm = dialog.getByRole('button', { name: de.bulkDelete.confirm, exact: true });
    const includeVarieties = dialog.getByRole('checkbox', { name: de.bulkDelete.deleteVarieties, exact: true });
    await expect(count(dialog, de.bulkDelete.counts.selected)).toHaveText('2');
    await expect(count(dialog, de.bulkDelete.counts.affected)).toHaveText('3');
    await includeVarieties.uncheck();
    await expect(dialog.getByText(de.bulkDelete.blockers.varieties_required)).toBeVisible();
    await expect(confirm).toBeDisabled();
    await includeVarieties.check();
    await expect(confirm).toBeEnabled();
    const plan = await apiRequest<{ id: number }>(page, 'POST', '/planting-plans/', {
      crop: variety.id, bed: bed.id, season: season.id, planting_date: '2030-05-15', area_usage_sqm: 2,
    });
    const [stale] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/crops/bulk-delete/')),
      confirm.click(),
    ]);
    expect(stale.status()).toBe(409);
    expect(await stale.json()).toMatchObject({ blocked_count: 1, skipped_count: 2, deleted_count: 0 });
    expect(await activeCropIds(page)).toEqual(before);
    const refresh = dialog.getByRole('button', { name: de.restoreDialog.preview.refresh, exact: true });
    await refresh.click();
    await expect(dialog.getByText(de.bulkDelete.blockers.planting_plans)).toBeVisible();
    await expect(count(dialog, de.bulkDelete.counts.plans)).toHaveText('1');
    await expect(confirm).toBeDisabled();
    await page.screenshot({ path: info.outputPath('blocked-by-plan.png'), animations: 'disabled' });

    await apiRequest(page, 'DELETE', `/planting-plans/${plan.id}/`);
    await dialog.getByRole('checkbox', { name: de.bulkDelete.deleteVarieties, exact: true }).uncheck();
    await expect(dialog.getByText(de.bulkDelete.blockers.varieties_required)).toBeVisible();
    await includeVarieties.check();
    await expect(confirm).toBeEnabled();
    const [deleted] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/crops/bulk-delete/')),
      confirm.click(),
    ]);
    expect(deleted.status()).toBe(200);
    const batch = await deleted.json() as { batch_id: number; deleted_count: number };
    expect(batch.deleted_count).toBe(3);
    await expect(list.getByText(spare.name, { exact: true })).toBeVisible();
    await expect(list.getByText(general.name, { exact: true })).toHaveCount(0);
    expect(await activeCropIds(page)).toEqual([spare.id]);

    const undo = page.getByTestId('bulk-crop-undo-snackbar').getByRole('button', { name: common.actions.undo });
    const [recovered] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/crops/bulk-delete/undo/')),
      undo.click(),
    ]);
    expect(recovered.status()).toBe(200);
    await expect(list.getByText(general.name, { exact: true })).toBeVisible();
    expect(await activeCropIds(page)).toEqual(before);
    const history = await apiRequest<CropHistoryEntry[]>(page, 'GET', '/history/project/');
    expect(history.filter(entry => entry.batch_id === batch.batch_id)).toHaveLength(1);
    expect(history.filter(entry => entry.batch_operation_type === 'crop_bulk_undelete')).toHaveLength(1);
  } finally {
    await resetE2EScenario(request, scenario);
  }
});

for (const [width, height] of [[375, 800], [800, 375]]) {
  test(`delete all includes filtered-out crops and requires explicit confirmation at ${width}x${height}`, async ({ page, request }, info) => {
    test.setTimeout(90_000);
    const scenario = `crop-bulk-phone-${width}-${randomUUID().slice(0, 8)}`;
    try {
      await page.setViewportSize({ width, height });
      await loginWithDeterministicProject(page, request, scenario, { loginAsAdmin: true });
      await apiRequest(page, 'POST', '/crops/', { name: 'Visible test herb' });
      await apiRequest(page, 'POST', '/crops/', { name: 'Hidden test herb' });
      await page.goto('/app/crops');
      await page.getByRole('button', { name: de.selectCrop, exact: true }).click();
      const picker = page.getByRole('dialog', { name: de.selectCrop, exact: true });
      const toggle = picker.getByRole('button', { name: de.library.batchImport.selectCultures, exact: true });
      await toggle.click();
      const input = picker.getByRole('textbox', { name: de.searchPlaceholder, exact: true });
      await input.fill('Visible test herb');
      await expect(picker.getByRole('checkbox')).toHaveCount(1);
      await page.screenshot({ path: info.outputPath('mobile-selection.png'), animations: 'disabled' });
      await picker.getByRole('button', { name: de.bulkDelete.menu, exact: true }).click();
      await page.getByRole('menuitem', { name: de.bulkDelete.allAction, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: de.bulkDelete.allAction, exact: true });
      await expect(count(dialog, de.bulkDelete.counts.affected)).toHaveText('2');
      const confirm = dialog.getByRole('button', { name: de.bulkDelete.allAction, exact: true });
      await expect(confirm).toBeDisabled();
      await expect(dialog.getByRole('button', { name: de.restoreDialog.cancel, exact: true })).toBeFocused();
      await dialog.getByRole('checkbox', { name: de.bulkDelete.confirmAll, exact: true }).check();
      await expect(confirm).toBeEnabled();
      await page.screenshot({ path: info.outputPath('mobile-delete-all.png'), animations: 'disabled' });
      await confirm.click();
      await expect(dialog).toHaveCount(0);
      expect(await activeCropIds(page)).toEqual([]);
      await expect(picker).toHaveCount(0);
      const undo = page.getByTestId('bulk-crop-undo-snackbar').getByRole('button', { name: common.actions.undo });
      const [recovered] = await Promise.all([
        page.waitForResponse(response => response.url().endsWith('/crops/bulk-delete/undo/')),
        undo.click(),
      ]);
      expect(recovered.status()).toBe(200);
      expect(await activeCropIds(page)).toHaveLength(2);
    } finally {
      await resetE2EScenario(request, scenario);
    }
  });
}
