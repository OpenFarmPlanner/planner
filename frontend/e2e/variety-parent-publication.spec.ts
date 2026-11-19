import { expect, test, type Page } from '@playwright/test';
import type { Crop, CropSpecies, PublishPublicCropResponse } from '../src/api/types';
import { SUPPORTED_LANGUAGES } from '../src/i18n/languages';
import fr from '../src/i18n/locales/fr/crops.json' with { type: 'json' };
import pt from '../src/i18n/locales/pt/crops.json' with { type: 'json' };
import nl from '../src/i18n/locales/nl/crops.json' with { type: 'json' };
import { apiRequest, expectNoHorizontalPageOverflow, loginWithDeterministicProject, resetE2EScenario } from './utils';

test.use({ serviceWorkers: 'block' });

async function addSpecies(page: Page, name: string) {
  const result = await apiRequest<CropSpecies>(page, 'POST', '/crop-species/', { name });
  await apiRequest(page, 'POST', `/crop-species/${result.id}/approve/`, {
    translations: SUPPORTED_LANGUAGES.map(({ code }) => ({ language_code: code, common_name: name })),
  });
  return result;
}

for (const { language, text, height } of [
  { language: 'fr', text: fr, height: 800 },
  { language: 'pt', text: pt, height: 800 },
  { language: 'nl', text: nl, height: 800 },
]) {
  test(`variety publication confirms the parent link in ${language}`, async ({ browser, page, request }, testInfo) => {
    test.setTimeout(120_000);
    const scenario = `variety-parent-${language}-${Date.now()}`;
    const publicScenario = `${scenario}-publisher`;
    const contributor = await browser.newPage();
    try {
      await loginWithDeterministicProject(contributor, request, publicScenario, { loginAsAdmin: true, libraryModerator: true });
      const existing = await addSpecies(contributor, `Synthetic greenhouse crop ${scenario}`);
      const uncatalogued = await addSpecies(contributor, `Synthetic orchard crop ${scenario}`);
      const general = await apiRequest<Crop>(contributor, 'POST', '/crops/', {
        name: existing.name, crop_species: existing.id, growth_duration_days: 77, harvest_duration_days: 25,
        notes: 'Synthetic library notes',
      });
      const receipt = await apiRequest<PublishPublicCropResponse>(contributor, 'POST', `/crops/${general.id}/publish-public/`, {
        accepted_public_library_terms: true, crop_species_id: existing.id, original_language_code: 'en', publish_as_general: true,
      });
      expect(receipt.operation).toBe('created');
      const publicParent = receipt.public_crop!;

      await page.setViewportSize({ width: 375, height });
      await loginWithDeterministicProject(page, request, scenario, { loginAsAdmin: true });
      await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: language });
      await page.evaluate(code => {
        localStorage.setItem('ui.language', code);
        localStorage.setItem('ui.language.pendingChoice', code);
      }, language);
      const parent = await apiRequest<Crop>(page, 'POST', '/crops/', {
        name: existing.name, crop_species: existing.id, growth_duration_days: 60, harvest_duration_days: 25,
        notes: 'Synthetic private parent notes',
      });
      const addVariety = (suffix: string) => apiRequest<Crop>(page, 'POST', '/crops/', {
        name: existing.name, crop_species: existing.id, variety: suffix,
        growth_duration_days: 50, harvest_duration_days: 20,
      });
      const variety = await addVariety('Synthetic early variety');
      const wizardFor = (crop: Crop) => page.getByRole('dialog', {
        name: text.library.publishWizard.varietyTitle.replace('{{variety}}', crop.variety!), exact: true,
      });
      const openWizard = async (crop: Crop) => {
        await page.goto(`/app/crops?cropId=${crop.id}`);
        await page.getByTestId('crop-detail-publish-action').click();
        await expect(wizardFor(crop)).toBeVisible();
        return wizardFor(crop);
      };
      const dialog = await openWizard(variety);
      const picker = dialog.getByRole('combobox', { name: text.library.speciesPicker.label });
      const publish = dialog.getByRole('button', { name: text.library.publishWizard.publishNow, exact: true });
      const choose = async (name: string) => {
        await picker.fill(name);
        await dialog.getByRole('option', { name, exact: true }).click();
      };
      const linkNotice = dialog.getByText(text.library.publishWizard.parent.linkExisting.replace('{{name}}', parent.name), { exact: true });
      const createNotice = dialog.getByText(text.library.publishWizard.parent.create.replace('{{name}}', parent.name), { exact: true });
      await expect(linkNotice).toBeVisible();
      await expect(picker).toHaveValue(existing.name);
      await choose(uncatalogued.name);
      await expect(createNotice).toBeVisible();
      await expect(linkNotice).toHaveCount(0);
      await expect(publish).toBeEnabled();
      await expectNoHorizontalPageOverflow(page);
      await page.screenshot({ path: testInfo.outputPath('create-parent.png'), animations: 'disabled' });
      await choose(existing.name);
      await expect(linkNotice).toBeVisible();
      await expect(createNotice).toHaveCount(0);
      const useLibrary = dialog.getByTestId('public-crop-sync-row-growth_duration_days')
        .locator('[data-choice="library"]').getByRole('radio');
      const keepPrivate = dialog.getByTestId('public-crop-sync-row-notes').locator('[data-choice="local"]');
      await expect(dialog.getByTestId('public-crop-sync-row-notes').getByRole('radio')).toHaveCount(2);
      await expect(useLibrary).toBeAttached();
      await useLibrary.focus();
      await page.keyboard.press('Space');
      await keepPrivate.click();
      await expect(useLibrary).toBeChecked();
      await expect(keepPrivate.getByRole('radio')).toBeChecked();
      for (const viewport of language === 'fr' ? [
        { width: 375, height: 800 }, { width: 768, height: 900 }, { width: 1024, height: 900 },
        { width: 1440, height: 900 }, { width: 800, height: 375 },
      ] : [{ width: 375, height }]) {
        await page.setViewportSize(viewport);
        await expect(publish).toBeInViewport();
        await expectNoHorizontalPageOverflow(page);
        await page.screenshot({ path: testInfo.outputPath(`compare-parent-${viewport.width}.png`), animations: 'disabled' });
      }
      await publish.click();
      const consent = dialog.getByRole('checkbox', { name: text.library.publishConfirm.acceptLicense, exact: true });
      await expect(async () => {
        expect((await dialog.isVisible()) ? await consent.isVisible() : true).toBe(true);
      }).toPass({ timeout: 10_000 });
      if (await consent.isVisible()) {
        await consent.check();
        await publish.click();
      }
      await expect(dialog).toBeHidden();
      const linked = await apiRequest<Crop>(page, 'GET', `/crops/${parent.id}/`);
      expect(linked.source_public_crop).toBe(publicParent.id);
      expect(linked.growth_duration_days).toBe(77);
      expect(linked.notes).toBe('Synthetic private parent notes');
      expect(linked.library_pinned_fields).toContain('notes');
      const published = await apiRequest<Crop>(page, 'GET', `/crops/${variety.id}/`);
      expect(published.source_public_crop).toBeTruthy();
      expect(published.growth_duration_days).toBe(50);

      const otherVariety = await addVariety('Synthetic late variety');
      await page.setViewportSize({ width: 375, height });
      const fixed = await openWizard(otherVariety);
      await expect(fixed.getByText(text.library.publishWizard.parent.linkedSpecies.replace('{{name}}', publicParent.name), { exact: true })).toBeVisible();
      await expect(fixed.getByRole('combobox')).toHaveCount(0);
      await expect(fixed.getByRole('button', { name: text.library.publishWizard.publishNow, exact: true })).toBeEnabled();
      await expectNoHorizontalPageOverflow(page);
      await page.screenshot({ path: testInfo.outputPath('fixed-parent.png'), animations: 'disabled' });
    } finally {
      await contributor.close();
      await resetE2EScenario(request, scenario);
      await resetE2EScenario(request, publicScenario);
    }
  });
}
