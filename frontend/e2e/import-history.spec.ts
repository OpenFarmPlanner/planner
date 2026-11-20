import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject, resetE2EScenario } from './utils';
import de from '../src/i18n/locales/de/crops.json' with { type: 'json' };
import navigation from '../src/i18n/locales/de/navigation.json' with { type: 'json' };
import type { Crop, CropHistoryEntry, CropSpecies, PublicCrop, PublishPublicCropResponse } from '../src/api/types';
import { SUPPORTED_LANGUAGES } from '../src/i18n/languages';

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

test('full restore before spreadsheet and library imports refreshes the crop grid', async ({ baseURL, browser, page, request }) => {
  test.setTimeout(120_000);
  const scenario = `history-restore-imports-${randomUUID().slice(0, 12)}`;
  const publisherScenario = `${scenario}-publisher`;
  const publisher = await browser.newPage({ baseURL, locale: 'de-DE' });

  try {
    await loginWithDeterministicProject(publisher, request, publisherScenario, {
      loginAsAdmin: true, libraryModerator: true,
    });
    const libraryName = `Synthetic library crop ${scenario}`;
    const species = await apiRequest<CropSpecies>(publisher, 'POST', '/crop-species/', { name: libraryName });
    await apiRequest(publisher, 'POST', `/crop-species/${species.id}/approve/`, {
      translations: SUPPORTED_LANGUAGES.map(({ code }) => ({ language_code: code, common_name: libraryName })),
    });
    const publicIds: number[] = [];
    for (const variety of ['', 'Synthetic library variety']) {
      const source = await apiRequest<Crop>(publisher, 'POST', '/crops/', {
        name: libraryName, crop_species: species.id, variety, growth_duration_days: 60, harvest_duration_days: 20,
      });
      const receipt = await apiRequest<PublishPublicCropResponse>(publisher, 'POST', `/crops/${source.id}/publish-public/`, {
        accepted_public_library_terms: true, crop_species_id: species.id, original_language_code: 'de',
        publish_as_general: variety === '',
      });
      expect(receipt.operation).toBe('created');
      publicIds.push(receipt.public_crop!.id!);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await loginWithDeterministicProject(page, request, scenario, { loginAsAdmin: true });
    const marker = await apiRequest<Crop>(page, 'POST', '/crops/', { name: 'Synthetic before-import target' });
    const target = (await apiRequest<CropHistoryEntry[]>(page, 'GET', '/history/project/'))
      .find(entry => entry.object_type === 'crop' && entry.object_id === marker.id && !entry.is_batch);
    expect(target).toBeTruthy();
    const original = (await crops(page)).map(crop => crop.id);
    const operation = randomUUID();
    for (const [phase, items] of [
      ['crops', [{ name: 'Synthetic spreadsheet crop' }, { name: 'Synthetic spreadsheet crop', variety: 'Synthetic sheet variety' }]],
      ['finalize', []],
    ] as const) {
      await apiRequest(page, 'POST', '/crops/import/apply/', { items, phase, import_operation_id: operation });
    }
    for (const id of publicIds) await apiRequest(page, 'POST', `/public-crops/${id}/import/`, {});
    const readLibrary = () => Promise.all(publicIds.map(async id => {
      const { name, variety, version } = await apiRequest<PublicCrop>(page, 'GET', `/public-crops/${id}/`);
      return { id, name, variety, version };
    }));
    const libraryBeforeRestore = await readLibrary();
    const imported = await crops(page);
    expect(imported.filter(crop => crop.crop_species === species.id)).toHaveLength(2);
    expect(imported.filter(crop => crop.name === 'Synthetic spreadsheet crop')).toHaveLength(2);

    await page.goto('/app/crops');
    const cropList = page.getByRole('listbox', { name: 'Kulturen' });
    const sheetRow = cropList.getByText('Synthetic spreadsheet crop', { exact: true });
    const libraryRow = cropList.getByText(libraryName, { exact: true });
    await expect(sheetRow).toBeVisible();
    await expect(libraryRow).toBeVisible();
    const dialog = await history(page);
    await dialog.getByRole('listitem').filter({ hasText: marker.name })
      .getByRole('button', { name: navigation.commandPalette.restoreVersion, exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: de.restoreDialog.title, exact: true });
    const [response] = await Promise.all([
      page.waitForResponse(result => result.url().includes('/history/project/restore/')),
      confirmation.getByRole('button', { name: de.restoreDialog.confirm, exact: true }).click(),
    ]);
    expect(response.request().postDataJSON()).toEqual({ history_id: target!.history_id });
    expect(response.status()).toBe(200);
    await expect(dialog).toHaveCount(0);
    await expect(cropList.getByText(marker.name, { exact: true })).toBeVisible();
    await expect(sheetRow).toHaveCount(0);
    await expect(libraryRow).toHaveCount(0);
    expect((await crops(page)).map(crop => crop.id)).toEqual(original);
    expect(await readLibrary()).toEqual(libraryBeforeRestore);
  } finally {
    await publisher.close();
    await resetE2EScenario(request, scenario);
    await resetE2EScenario(request, publisherScenario);
  }
});

for (const [width, height] of [[375, 800], [1440, 900]]) {
  test(`full restore and restoring its automatic backup at ${width}x${height}`, async ({ page, request }, info) => {
    test.setTimeout(120_000);
    const scenario = `history-backup-${width}-${Date.now()}`;
    try {
      await page.setViewportSize({ width, height });
      await loginWithDeterministicProject(page, request, scenario, { loginAsAdmin: true });
      await page.goto('/app/crops');
      const location = await apiRequest<{ id: number }>(page, 'POST', '/locations/', {
        name: `Doomed history location ${width}`,
      });
      const field = await apiRequest<{ id: number }>(page, 'POST', '/fields/', {
        name: `Doomed history field ${width}`, location: location.id,
      });
      const bedName = `Doomed history bed ${width}`;
      const bed = await apiRequest<{ id: number }>(page, 'POST', '/beds/', {
        name: bedName, field: field.id, area_sqm: 5,
      });
      await apiRequest(page, 'DELETE', `/locations/${location.id}/`);
      const getIds = async (path: string) => {
        const data = await apiRequest<Array<{ id: number }> | { results: Array<{ id: number }> }>(page, 'GET', path);
        return (Array.isArray(data) ? data : data.results).map(item => item.id);
      };
      const geometry = () => Promise.all(['/locations/', '/fields/', '/beds/'].map(getIds));
      const before = await geometry();
      for (const [index, item] of [location, field, bed].entries()) {
        expect(before[index]).not.toContain(item.id);
      }

      let dialog = await history(page);
      await dialog.getByRole('listitem').filter({ hasText: bedName }).last()
        .getByRole('button', { name: navigation.commandPalette.restoreVersion, exact: true }).press('Enter');
      let confirmation = page.getByRole('dialog', { name: de.restoreDialog.title, exact: true });
      await page.screenshot({ path: info.outputPath('restore-confirmation.png'), animations: 'disabled' });
      const [restored] = await Promise.all([
        page.waitForResponse(response => response.url().includes('/history/project/restore/')),
        confirmation.getByRole('button', { name: de.restoreDialog.confirm, exact: true }).click(),
      ]);
      expect(restored.status()).toBe(200);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const restoredGeometry = await geometry();
      for (const [index, item] of [location, field, bed].entries()) {
        expect(restoredGeometry[index]).toContain(item.id);
      }

      dialog = await history(page);
      const backupEntry = dialog.getByRole('listitem').filter({ hasText: de.history.automaticBackup });
      await expect(backupEntry).toHaveCount(1);
      await page.screenshot({ path: info.outputPath('history-list.png'), animations: 'disabled' });
      await backupEntry.getByRole('button', { name: navigation.commandPalette.restoreVersion, exact: true }).press('Enter');
      confirmation = page.getByRole('dialog', { name: de.restoreDialog.title, exact: true });
      await expect(confirmation.getByText(de.history.automaticBackup, { exact: true })).toBeVisible();
      await page.screenshot({ path: info.outputPath('backup-confirmation.png'), animations: 'disabled' });
      const [backup] = await Promise.all([
        page.waitForResponse(response => response.url().includes('/history/project/restore/')),
        confirmation.getByRole('button', { name: de.restoreDialog.confirm, exact: true }).press('Enter'),
      ]);
      expect(backup.status()).toBe(200);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(await geometry()).toEqual(before);
    } finally {
      await resetE2EScenario(request, scenario);
    }
  });
}
