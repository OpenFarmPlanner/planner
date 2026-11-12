import { expect, test } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject } from './utils';

type Crop = { id: number; name: string };

for (const viewport of [{ width: 375, height: 800 }, { width: 1440, height: 900 }]) {
  test(`a conflicting variety rename stays editable and can be corrected at ${viewport.width}`, async ({ page, request }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    await loginWithDeterministicProject(page, request, `rename-conflict-${viewport.width}`, { loginAsAdmin: true });
    const base = { name: 'Source crop', growth_duration_days: 60, harvest_duration_days: 14 };
    const general = await apiRequest<Crop>(page, 'POST', '/crops/', base);
    const variety = await apiRequest<Crop>(page, 'POST', '/crops/', { ...base, variety: 'Source variety' });
    const sibling = await apiRequest<Crop>(page, 'POST', '/crops/', { ...base, variety: 'Sibling variety' });
    const existing = await apiRequest<Crop>(page, 'POST', '/crops/', { ...base, name: 'Existing crop' });
    await page.goto(`/app/crops?cropId=${variety.id}&action=edit`);
    const dialog = page.getByRole('dialog');
    const name = dialog.getByRole('combobox', { name: 'Name', exact: true });
    await name.fill(existing.name);
    await name.press('Tab');
    const save = dialog.getByRole('button', { name: 'Speichern', exact: true });
    await expect(save).toBeEnabled();
    const [rejected] = await Promise.all([
      page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().endsWith(`/crops/${variety.id}/`)),
      save.click(),
    ]);
    expect(rejected.status()).toBe(409);
    expect((await rejected.json()).code).toBe('crop_name_conflict');
    const hint = dialog.getByText(/Diese Kultur existiert bereits in diesem Projekt/);
    await expect(hint).toBeVisible();
    await expect(name).toHaveValue(existing.name);
    await hint.scrollIntoViewIfNeeded();
    expect(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth + 1)).toBe(false);
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`rename-conflict-${viewport.width}.png`) });
    for (const crop of [general, variety, sibling]) {
      expect((await apiRequest<Crop>(page, 'GET', `/crops/${crop.id}/`)).name).toBe(base.name);
    }
    expect((await apiRequest<Crop>(page, 'GET', `/crops/${existing.id}/`)).name).toBe(existing.name);

    await name.fill('Corrected crop');
    await name.press('Tab');
    await expect(save).toBeEnabled();
    const [accepted] = await Promise.all([
      page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().endsWith(`/crops/${variety.id}/`)),
      save.click(),
    ]);
    expect(accepted.ok()).toBe(true);
    await expect(dialog).toBeHidden();
    for (const crop of [general, variety, sibling]) {
      expect((await apiRequest<Crop>(page, 'GET', `/crops/${crop.id}/`)).name).toBe('Corrected crop');
    }
  });
}
