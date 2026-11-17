import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject, resetE2EScenario } from './utils';
import de from '../src/i18n/locales/de/crops.json' with { type: 'json' };
import navigation from '../src/i18n/locales/de/navigation.json' with { type: 'json' };
import type { Crop, CropHistoryEntry } from '../src/api/types';

async function history(page: Page) {
  await page.getByRole('button', { name: navigation.globalMenu.moreActions, exact: true }).click();
  await page.getByRole('menuitem', { name: navigation.commandPalette.commands.openVersionHistory, exact: true }).click();
  return page.getByRole('dialog', { name: navigation.commandPalette.versionHistoryTitle, exact: true });
}

async function crops(page: Page): Promise<Crop[]> {
  const data = await apiRequest<Crop[] | { results: Crop[] }>(page, 'GET', '/crops/');
  return Array.isArray(data) ? data : data.results;
}

for (const [width, height] of [[375, 800], [768, 900], [1024, 900], [1440, 900], [800, 375]]) {
  test(`grouped import, selective undo and full restore at ${width}x${height}`, async ({ page, request }, info) => {
    test.setTimeout(180_000);
    const scenario = `import-history-${width}-${Date.now()}`;
    try {
      await page.setViewportSize({ width, height });
      await loginWithDeterministicProject(page, request, scenario, { loginAsAdmin: true });
      await page.goto('/app/crops');
      const original = await apiRequest<Crop>(page, 'POST', '/crops/', { name: 'Existing history crop', notes: 'Before import' });
      const operation = randomUUID();
      for (const items of [
        [{ name: original.name, notes: 'Imported notes' }, { name: 'Created history crop' }],
        [{ name: 'Created history crop', variety: 'Synthetic variety' }],
      ]) {
        await apiRequest(page, 'POST', '/crops/import/apply/', { items, phase: 'crops', confirm_updates: true, import_operation_id: operation });
      }
      await apiRequest(page, 'POST', '/crops/import/apply/', { items: [], phase: 'finalize', import_operation_id: operation });
      const entries = await apiRequest<CropHistoryEntry[]>(page, 'GET', '/history/project/');
      const imported = entries.find(entry => entry.batch_operation_type === 'crop_import')!;
      expect(entries.filter(entry => entry.batch_operation_type === 'crop_import')).toHaveLength(1);
      const later = await apiRequest<Crop>(page, 'POST', '/crops/', { name: 'Later independent crop' });
      const location = await apiRequest<{ id: number }>(page, 'POST', '/locations/', { name: 'Later history location' });
      const field = await apiRequest<{ id: number }>(page, 'POST', '/fields/', { name: 'Later history field', location: location.id });
      const bed = await apiRequest<{ id: number }>(page, 'POST', '/beds/', { name: 'Later history bed', field: field.id, area_sqm: 2 });
      let dialog = await history(page);
      const row = dialog.getByRole('listitem').filter({ hasText: '3 Kulturen importiert' }).first();
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: de.history.import.details, exact: true }).click();
      await expect(row.getByText(/Synthetic variety/)).toBeVisible();
      await page.screenshot({ path: info.outputPath('expanded-import.png'), animations: 'disabled' });
      await row.getByRole('button', { name: de.history.import.actions, exact: true }).click();
      await page.screenshot({ path: info.outputPath('import-menu.png'), animations: 'disabled' });
      await page.getByRole('menuitem', { name: de.history.import.undo, exact: true }).click();
      let confirmation = page.getByRole('dialog', { name: de.history.import.undo, exact: true });
      await expect(confirmation.getByText(de.history.import.selectiveNotice)).toBeVisible();
      await expect(confirmation.getByRole('button', { name: de.history.import.undo, exact: true })).toBeEnabled();
      await page.screenshot({ path: info.outputPath('selective-confirmation.png'), animations: 'disabled' });
      await confirmation.getByRole('button', { name: de.restoreDialog.cancel, exact: true }).click();
      expect((await crops(page)).some(crop => crop.name === 'Created history crop')).toBe(true);
      await row.getByRole('button', { name: de.history.import.actions, exact: true }).click();
      await page.getByRole('menuitem', { name: de.history.import.undo, exact: true }).click();
      confirmation = page.getByRole('dialog', { name: de.history.import.undo, exact: true });
      await Promise.all([
        page.waitForResponse(response => response.url().includes('/revert/') && response.status() === 200),
        confirmation.getByRole('button', { name: de.history.import.undo, exact: true }).click(),
      ]);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      let current = await crops(page);
      expect(current.find(crop => crop.id === original.id)?.notes).toBe('Before import');
      expect(current.some(crop => crop.name === 'Created history crop')).toBe(false);
      expect(current.some(crop => crop.id === later.id)).toBe(true);
      await apiRequest(page, 'GET', `/beds/${bed.id}/`);
      dialog = await history(page);
      await dialog.getByRole('listitem').filter({ hasText: '3 Kulturen importiert' }).first()
        .getByRole('button', { name: navigation.commandPalette.restoreVersion, exact: true }).click();
      const restore = page.getByRole('dialog', { name: de.restoreDialog.title, exact: true });
      await expect(restore.getByText(de.restoreDialog.versionDescription)).toBeVisible();
      await page.screenshot({ path: info.outputPath('full-restore-confirmation.png'), animations: 'disabled' });
      await Promise.all([
        page.waitForResponse(response => response.url().includes('/history/project/restore/') && response.status() === 200),
        restore.getByRole('button', { name: de.restoreDialog.confirm, exact: true }).click(),
      ]);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      current = await crops(page);
      expect(current.some(crop => crop.id === later.id)).toBe(false);
      expect(current.filter(crop => crop.name === 'Created history crop')).toHaveLength(2);
      const beds = await apiRequest<Array<{ id: number }> | { results: Array<{ id: number }> }>(page, 'GET', '/beds/');
      expect((Array.isArray(beds) ? beds : beds.results).some(item => item.id === bed.id)).toBe(false);
      // A later edit blocks the same import's inverse rather than discarding new work.
      const changed = current.find(crop => crop.id === original.id)!;
      await apiRequest(page, 'PATCH', `/crops/${changed.id}/`, { notes: 'Later private edit' });
      dialog = await history(page);
      await dialog.getByRole('listitem').filter({ hasText: '3 Kulturen importiert' }).first()
        .getByRole('button', { name: de.history.import.actions, exact: true }).click();
      await page.getByRole('menuitem', { name: de.history.import.undo, exact: true }).click();
      confirmation = page.getByRole('dialog', { name: de.history.import.undo, exact: true });
      // A previously undone import remains closed even when its historical data is restored.
      await expect(confirmation.getByRole('button', { name: de.history.import.undo, exact: true })).toBeDisabled();
      await expect(confirmation.getByText(de.history.import.alreadyUndone)).toBeVisible();
      await page.screenshot({ path: info.outputPath('closed-import.png'), animations: 'disabled' });
      await confirmation.getByRole('button', { name: de.restoreDialog.cancel, exact: true }).click();
      await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
      const fresh = randomUUID();
      await apiRequest(page, 'POST', '/crops/import/apply/', { items: [{ name: 'Conflict import crop' }], phase: 'crops', import_operation_id: fresh });
      await apiRequest(page, 'POST', '/crops/import/apply/', { items: [], phase: 'finalize', import_operation_id: fresh });
      const conflicting = (await crops(page)).find(crop => crop.name === 'Conflict import crop')!;
      await apiRequest(page, 'PATCH', `/crops/${conflicting.id}/`, { notes: 'Later edit must survive' });
      dialog = await history(page);
      await dialog.getByRole('listitem').filter({ hasText: '1 Kultur importiert' }).first()
        .getByRole('button', { name: de.history.import.actions, exact: true }).click();
      await page.getByRole('menuitem', { name: de.history.import.undo, exact: true }).click();
      confirmation = page.getByRole('dialog', { name: de.history.import.undo, exact: true });
      await expect(confirmation.getByText(de.history.import.laterEdit)).toBeVisible();
      await expect(confirmation.getByRole('button', { name: de.history.import.undo, exact: true })).toBeDisabled();
      await page.screenshot({ path: info.outputPath('later-edit-conflict.png'), animations: 'disabled' });
      expect(imported.history_id).toBeGreaterThan(0);
    } finally {
      await resetE2EScenario(request, scenario);
    }
  });
}

for (const [width, height] of [[375, 800], [1440, 900]]) {
  test(`full restore and restoring its automatic backup at ${width}x${height}`, async ({ page, request }, info) => {
    // The backup of a restore that re-created a deleted row is refused today.
    test.fail(true, 'Restoring the automatic backup is refused until #1194 is fixed.');
    test.setTimeout(120_000);
    const scenario = `history-backup-${width}-${Date.now()}`;
    try {
      await page.setViewportSize({ width, height });
      await loginWithDeterministicProject(page, request, scenario, { loginAsAdmin: true });
      await page.goto('/app/crops');
      const name = `Doomed history location ${width}`;
      const location = await apiRequest<{ id: number }>(page, 'POST', '/locations/', { name });
      await apiRequest(page, 'DELETE', `/locations/${location.id}/`);
      const locationIds = async () => {
        const data = await apiRequest<Array<{ id: number }> | { results: Array<{ id: number }> }>(page, 'GET', '/locations/');
        return (Array.isArray(data) ? data : data.results).map(item => item.id);
      };

      let dialog = await history(page);
      await dialog.getByRole('listitem').filter({ hasText: name }).last()
        .getByRole('button', { name: navigation.commandPalette.restoreVersion, exact: true }).click();
      let confirmation = page.getByRole('dialog', { name: de.restoreDialog.title, exact: true });
      await page.screenshot({ path: info.outputPath('restore-confirmation.png'), animations: 'disabled' });
      const [restored] = await Promise.all([
        page.waitForResponse(response => response.url().includes('/history/project/restore/')),
        confirmation.getByRole('button', { name: de.restoreDialog.confirm, exact: true }).click(),
      ]);
      expect(restored.status()).toBe(200);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(await locationIds()).toContain(location.id);

      // The newest entry is the restore result; the automatic backup sits directly below it.
      dialog = await history(page);
      await dialog.getByRole('listitem').nth(1)
        .getByRole('button', { name: navigation.commandPalette.restoreVersion, exact: true }).click();
      confirmation = page.getByRole('dialog', { name: de.restoreDialog.title, exact: true });
      const [backup] = await Promise.all([
        page.waitForResponse(response => response.url().includes('/history/project/restore/')),
        confirmation.getByRole('button', { name: de.restoreDialog.confirm, exact: true }).click(),
      ]);
      await page.screenshot({ path: info.outputPath('backup-restore-result.png'), animations: 'disabled' });
      expect(backup.status()).toBe(200);
      expect(await locationIds()).not.toContain(location.id);
    } finally {
      await resetE2EScenario(request, scenario);
    }
  });
}
