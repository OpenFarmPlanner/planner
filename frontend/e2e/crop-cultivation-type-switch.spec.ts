import { expect, test, type Page } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject } from './utils';

type CropRow = { id: number; name: string; variety: string; cultivation_types: string[]; seed_rate_direct_value: number | null };

async function findCrop(page: Page, name: string, variety: string): Promise<CropRow> {
  const crops = await apiRequest<{ results: CropRow[] }>(page, 'GET', '/crops/?page_size=200');
  const crop = crops.results.find((row) => row.name === name && (row.variety ?? '') === variety);
  if (!crop) throw new Error(`Missing demo crop ${name} ${variety}`);
  return crop;
}

// #905: removing "Pflanzung" (transplanting) left the loaded seed requirements and, on Sorten,
// inherited tags in the save payload, so the API rejected the edit.
async function switchToDirectSowingOnly(page: Page, crop: CropRow): Promise<void> {
  await page.goto(`/app/crops?cropId=${crop.id}&action=edit`);
  const dialog = page.getByRole('dialog', { name: crop.variety ? 'Sorte bearbeiten' : 'Kultur bearbeiten' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Anbauart' }).click();
  if (!crop.cultivation_types.includes('direct_sowing')) {
    await page.getByRole('option', { name: 'Direktsaat' }).click();
  }
  await page.getByRole('option', { name: 'Pflanzung' }).click();
  await page.keyboard.press('Escape');
  const saved = page.waitForResponse((response) => response.url().includes(`/api/crops/${crop.id}/`)
    && response.request().method() === 'PUT');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(dialog).toBeHidden();
}

test.beforeEach(async ({ page, request }, testInfo) => {
  await loginWithDeterministicProject(page, request, `crop-cultivation-switch-${testInfo.workerIndex}`, {
    demoProject: true, loginAsAdmin: true,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
});

test('a Kultur with stored seed rates switches from transplanting to direct sowing', async ({ page }) => {
  const crop = await findCrop(page, 'Gurke', '');
  expect(crop.cultivation_types).toEqual(expect.arrayContaining(['pre_cultivation', 'direct_sowing']));
  await switchToDirectSowingOnly(page, crop);
  const updated = await findCrop(page, 'Gurke', '');
  expect(updated.cultivation_types).toEqual(['direct_sowing']);
  expect(updated.seed_rate_direct_value).toBe(crop.seed_rate_direct_value);
});

test('a Sorte with inherited tags switches from transplanting to direct sowing', async ({ page }) => {
  const crop = await findCrop(page, 'Gurke', 'Arola');
  expect(crop.cultivation_types).toEqual(['pre_cultivation']);
  await switchToDirectSowingOnly(page, crop);
  expect((await findCrop(page, 'Gurke', 'Arola')).cultivation_types).toEqual(['direct_sowing']);
});
