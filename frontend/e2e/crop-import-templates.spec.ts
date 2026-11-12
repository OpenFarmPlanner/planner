import { expect, test } from '@playwright/test';
import type { Crop } from '../src/api/types';
import type { ImportPreviewResult } from '../src/pages/cropsPageUtils';
import de from '../src/i18n/locales/de/crops.json' with { type: 'json' };
import en from '../src/i18n/locales/en/crops.json' with { type: 'json' };
import fr from '../src/i18n/locales/fr/crops.json' with { type: 'json' };
import es from '../src/i18n/locales/es/crops.json' with { type: 'json' };
import deNavigation from '../src/i18n/locales/de/navigation.json' with { type: 'json' };
import enNavigation from '../src/i18n/locales/en/navigation.json' with { type: 'json' };
import frNavigation from '../src/i18n/locales/fr/navigation.json' with { type: 'json' };
import esNavigation from '../src/i18n/locales/es/navigation.json' with { type: 'json' };
import { apiRequest, loginWithDeterministicProject } from './utils';

const languages = { de: { text: de, navigation: deNavigation }, en: { text: en, navigation: enNavigation },
  fr: { text: fr, navigation: frNavigation }, es: { text: es, navigation: esNavigation } };

for (const [language, { text, navigation }] of Object.entries(languages)) {
  for (const format of ['ods', 'xlsx'] as const) {
    test(`${language} ${format} template previews and imports every example without silently overwriting`, async ({ page, request }, testInfo) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 1440, height: 900 });
      await loginWithDeterministicProject(page, request, `import-template-${language}-${format}`, { loginAsAdmin: true });
      await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: language });
      await page.evaluate(code => {
        localStorage.setItem('ui.language', code);
        localStorage.setItem('ui.language.pendingChoice', code);
      }, language);
      const existing = await apiRequest<Crop>(page, 'POST', '/crops/', {
        name: text.import.template.speciesName, growth_duration_days: 11, harvest_duration_days: 3, notes: 'Keep original notes',
      });
      await page.goto('/app/crops');
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await expect(page.getByRole('heading', { name: text.import.template.speciesName, exact: true }).first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      await page.getByRole('button', { name: navigation.cropActions.openImportExport, exact: true }).click();
      await page.getByRole('menuitem', { name: text.import.menuLabel, exact: true }).click();
      const start = page.getByRole('dialog', { name: text.import.selectFileTitle, exact: true });
      await expect(start).toBeVisible();
      const viewport = language === 'fr' || language === 'es' || language === 'de' && format === 'ods'
        ? { width: 375, height: 800 } : language === 'en' && format === 'ods'
          ? { width: 800, height: 375 } : { width: 1440, height: 900 };
      await page.setViewportSize(viewport);
      const button = start.getByRole('button', { name: format === 'ods' ? text.import.help.templateButton : text.import.help.templateButtonXlsx, exact: true });
      await button.scrollIntoViewIfNeeded();
      const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
      expect(download.suggestedFilename()).toBe(`kulturen_vorlage.${format}`);
      const path = testInfo.outputPath(`template-${language}.${format}`);
      await download.saveAs(path);
      const hint = start.getByText(text.import.help.templateSamples, { exact: true });
      await hint.scrollIntoViewIfNeeded();
      await expect(hint).toBeVisible();
      expect(await start.evaluate(element => element.scrollWidth > element.clientWidth + 1)).toBe(false);
      await page.screenshot({ path: testInfo.outputPath(`template-help-${language}-${format}.png`), animations: 'disabled' });
      const [preview] = await Promise.all([
        page.waitForResponse(response => response.request().method() === 'POST' && response.url().includes('/crops/import/preview/')),
        start.locator('input[type=file]').setInputFiles(path),
      ]);
      expect(preview.ok()).toBe(true);
      const body = await preview.json() as { results: ImportPreviewResult[] };
      expect(body.results).toHaveLength(3);
      for (const result of body.results) {
        expect(result.error).toBeUndefined();
        expect(result.timing_window_issues ?? []).toEqual([]);
      }
      expect(body.results[0]).toMatchObject({ status: 'update_candidate', matched_crop_id: existing.id });
      expect((await apiRequest<Crop>(page, 'GET', `/crops/${existing.id}/`)).notes).toBe('Keep original notes');
      expect((await apiRequest<{ count: number }>(page, 'GET', '/crops/')).count).toBe(1);
      const skipped = await apiRequest<{ updated_count: number; errors: unknown[] }>(page, 'POST', '/crops/import/apply/', {
        items: preview.request().postDataJSON(), confirm_updates: false, companion_note_language: language,
      });
      expect(skipped.errors).toEqual([]);
      expect(skipped.updated_count).toBe(0);
      expect((await apiRequest<Crop>(page, 'GET', `/crops/${existing.id}/`)).notes).toBe('Keep original notes');
      const dialog = page.getByRole('dialog');
      const confirm = dialog.getByRole('checkbox', { name: text.import.confirmUpdates, exact: true });
      await expect(confirm).not.toBeChecked();
      await confirm.check();
      const [applied] = await Promise.all([
        page.waitForResponse(response => response.request().method() === 'POST' && response.url().includes('/crops/import/apply/')),
        dialog.getByRole('button', { name: text.import.start, exact: true }).click(),
      ]);
      expect(applied.ok()).toBe(true);
      expect((await applied.json()).errors).toEqual([]);
      await expect(dialog).toBeHidden();
      const saved = await apiRequest<Crop>(page, 'GET', `/crops/${existing.id}/`);
      expect(saved.growth_duration_days).toBe(75);
      expect(saved.notes).toContain(text.import.template.sampleNote);
      const crops = await apiRequest<{ results: Crop[]; count: number }>(page, 'GET', '/crops/');
      const variety = crops.results.find(crop => crop.name === text.import.template.directSownName && crop.variety === text.import.template.varietyName);
      expect(variety).toBeDefined();
      // Only a catalog-linked variety creates an automatic general crop.
      expect(crops.count).toBe(variety?.crop_species ? 4 : 3);
      if (variety?.crop_species) {
        expect(crops.results.some(crop => crop.crop_species === variety.crop_species && !crop.variety)).toBe(true);
      }
      const potato = crops.results.find(crop => crop.specific_property_profile === 'solanum_tuberosum');
      expect(potato?.specific_properties).toEqual({ cooking_type: 'waxy', maturity_group: 'early' });
      expect(potato?.stratification_days_min).toBe(28);
      await page.goto(`/app/crops?cropId=${existing.id}`);
      const timing = page.getByTestId('crop-timing-windows-detail');
      await expect(timing).toBeVisible();
      const laneLabel = page.getByTestId('timing-window-lane-pre_cultivation').getByText(text.timingWindows.kinds.pre_cultivation, { exact: true });
      await laneLabel.scrollIntoViewIfNeeded();
      expect(await laneLabel.evaluate(element => element.scrollWidth > element.clientWidth + 1)).toBe(false);
      await page.screenshot({ path: testInfo.outputPath(`template-timing-${language}-${format}.png`), animations: 'disabled' });
      if (format === 'ods') {
        await page.goto(`/app/crops?cropId=${existing.id}&action=edit`);
        const group = page.getByRole('dialog').getByRole('group', { name: text.timingWindows.kinds.direct_sowing, exact: true });
        await group.scrollIntoViewIfNeeded();
        await expect(group).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(`template-form-${language}.png`), animations: 'disabled' });
      }
    });
  }
}

test.describe('catalog download retry', () => {
  // Network fault injection needs page.route to receive the request.
  test.use({ serviceWorkers: 'block' });

test('a catalog failure stays readable on a French phone and the download can be retried', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, 'template-catalog-retry', { loginAsAdmin: true });
  await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: 'fr' });
  await page.evaluate(() => {
    localStorage.setItem('ui.language', 'fr');
    localStorage.setItem('ui.language.pendingChoice', 'fr');
  });
  await page.goto('/app/crops');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: frNavigation.cropActions.openImportExport, exact: true }).click();
  await page.getByRole('menuitem', { name: fr.import.menuLabel, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: fr.import.selectFileTitle, exact: true });
  await expect(dialog).toBeVisible();
  await page.setViewportSize({ width: 375, height: 800 });
  const endpoint = '**/api/crop-species/?page_size=1000';
  await page.route(endpoint, route => route.fulfill({ status: 503, contentType: 'text/plain', body: 'Unavailable' }));
  await dialog.getByRole('button', { name: fr.import.help.templateButton, exact: true }).click();
  const error = dialog.getByRole('alert');
  await expect(error).toContainText(fr.import.help.templateError);
  await error.scrollIntoViewIfNeeded();
  expect(await error.evaluate(element => element.scrollWidth > element.clientWidth + 1)).toBe(false);
  await error.getByRole('button', { name: 'Réessayer', exact: true }).click({ trial: true });
  await page.screenshot({ path: testInfo.outputPath('template-retry-fr-375.png'), animations: 'disabled' });
  await page.unroute(endpoint);
  const [download] = await Promise.all([
    page.waitForEvent('download'), error.getByRole('button', { name: 'Réessayer', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('kulturen_vorlage.ods');
  await expect(error).toBeHidden();
});

});
