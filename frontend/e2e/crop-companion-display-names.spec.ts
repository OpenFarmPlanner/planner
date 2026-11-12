import { expect, test } from '@playwright/test';
import type { Crop, CropSpecies } from '../src/api/types';
import de from '../src/i18n/locales/de/crops.json' with { type: 'json' };
import en from '../src/i18n/locales/en/crops.json' with { type: 'json' };
import fr from '../src/i18n/locales/fr/crops.json' with { type: 'json' };
import es from '../src/i18n/locales/es/crops.json' with { type: 'json' };
import { apiRequest, loginWithDeterministicProject } from './utils';

type SavedCrop = Crop & { id: number; crop_display_name: string };
const languages = { de, en, fr, es };
const viewports = [
  { language: 'en', width: 375, height: 800 },
  { language: 'en', width: 768, height: 900 },
  { language: 'en', width: 1024, height: 900 },
  { language: 'en', width: 1440, height: 900 },
  { language: 'en', width: 800, height: 375 },
  ...['de', 'fr', 'es'].map(language => ({ language, width: 375, height: 800 })),
] as const;

for (const { language, width, height } of viewports) {
  test(`resolved companion references agree in ${language} at ${width}x${height}`, async ({ page, request }, testInfo) => {
    test.setTimeout(120_000);
    const text = languages[language as keyof typeof languages];
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginWithDeterministicProject(page, request, `companion-display-${language}-${width}-${height}`, { loginAsAdmin: true });
    await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: language });
    await page.evaluate(choice => {
      localStorage.setItem('ui.language', choice);
      localStorage.setItem('ui.language.pendingChoice', choice);
    }, language);
    const catalog = await apiRequest<{ results: CropSpecies[] }>(page, 'GET', '/crop-species/?page_size=1000');
    const primary = catalog.results.find(species => species.specific_property_profile === 'solanum_tuberosum') ?? catalog.results[0];
    const neighborSpecies = catalog.results.find(species => species.id !== primary.id)!;
    expect(neighborSpecies).toBeDefined();
    // Persist historical project names; all rendered names still come from the
    // linked live catalog. This does not rename or seed any catalog species.
    const crop = await apiRequest<SavedCrop>(page, 'POST', '/crops/', {
      name: 'Legacy primary crop', crop_species: primary.id, growth_duration_days: 60, harvest_duration_days: 14,
    });
    const neighbor = await apiRequest<SavedCrop>(page, 'POST', '/crops/', {
      name: 'Legacy neighbor crop', crop_species: neighborSpecies.id, growth_duration_days: 60, harvest_duration_days: 14,
    });
    const variety = await apiRequest<SavedCrop>(page, 'POST', '/crops/', {
      name: crop.name, variety: 'Display test variety', crop_species: primary.id,
    });
    expect(crop.crop_display_name).toBeTruthy();
    expect(crop.crop_display_name).not.toBe(crop.name);
    expect(neighbor.crop_display_name).not.toBe(neighbor.name);
    expect(variety.general_crop).toBe(crop.id);
    const relation = await apiRequest<{ id: number }>(page, 'POST', '/crop-companions/', {
      crop: crop.id, companion_crop: neighbor.id, kind: 'good', reason: 'other',
    });
    await page.goto(`/app/crops?cropId=${variety.id}&action=edit`);
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    let dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.setViewportSize({ width, height });
    await expect(dialog.getByRole('combobox', { name: text.form.name, exact: true })).toHaveValue(crop.crop_display_name);
    const inherited = dialog.getByTestId('crop-companions-form-section');
    await expect(inherited).toContainText(text.companions.form.varietyReadOnly.replaceAll('{{name}}', crop.crop_display_name));
    await expect(inherited.getByText(neighbor.crop_display_name, { exact: true })).toBeVisible();
    await expect(inherited).not.toContainText(crop.name);
    await expect(inherited).not.toContainText(neighbor.name);
    await inherited.scrollIntoViewIfNeeded();
    expect(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`companion-variety-${language}-${width}.png`), animations: 'disabled' });

    await page.goto(`/app/crops?cropId=${variety.id}`);
    const detail = page.getByTestId('crop-companions-section');
    await expect(detail).toContainText(text.companions.sharedHint.replace('{{name}}', crop.crop_display_name));
    const link = detail.getByRole('button', { name: neighbor.crop_display_name, exact: true });
    await link.scrollIntoViewIfNeeded();
    await link.click({ trial: true });
    await page.screenshot({ path: testInfo.outputPath(`companion-detail-${language}-${width}.png`), animations: 'disabled' });
    await link.click();
    await expect(page).toHaveURL(new RegExp(`cropId=${neighbor.id}(?:&|$)`));
    await expect(page.getByTestId('crop-companions-section').getByRole('button', { name: crop.crop_display_name, exact: true })).toBeVisible();

    await page.goto(`/app/crops?cropId=${crop.id}&action=edit`);
    dialog = page.getByRole('dialog');
    const companionWrites: string[] = [];
    page.on('request', request => {
      if (request.url().includes('/api/crop-companions/') && request.method() !== 'GET') {
        companionWrites.push(request.url());
      }
    });
    const field = dialog.getByRole('combobox', { name: text.companions.form.neighbor, exact: true });
    await expect(field).toHaveValue(neighbor.crop_display_name);
    await field.scrollIntoViewIfNeeded();
    await field.click();
    const option = page.getByRole('option', { name: neighbor.crop_display_name, exact: true });
    await expect(option).toBeVisible();
    await option.click();
    expect(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`companion-picker-${language}-${width}.png`), animations: 'disabled' });
    await dialog.getByRole('textbox', { name: text.siteHealth.fields.pests_diseases, exact: true }).fill('Updated health note');
    await dialog.getByRole('button', { name: text.form.save, exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(companionWrites).toEqual([]);
    const saved = await apiRequest<SavedCrop>(page, 'GET', `/crops/${crop.id}/`);
    expect(saved.name).toBe(crop.name);
    expect(saved.crop_display_name).toBe(crop.crop_display_name);
    const savedRelation = await apiRequest<{ crop: number; companion_crop: number }>(page, 'GET', `/crop-companions/${relation.id}/`);
    expect(savedRelation).toMatchObject({ crop: crop.id, companion_crop: neighbor.id });
  });
}
