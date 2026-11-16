import { expect, test } from '@playwright/test';
import { apiRequest, expectNoHorizontalPageOverflow, loginWithDeterministicProject, resetE2EScenario } from './utils';
import { SUPPORTED_LANGUAGES } from '../src/i18n/languages';
import de from '../src/i18n/locales/de/crops.json' with { type: 'json' };
import type { Crop, PlantHealthSelections } from '../src/api/types';

test.use({ serviceWorkers: 'block' });

for (const width of [375, 1440]) {
  test(`private plant-health selection and variety inheritance at ${width}px`, async ({ page, request }, testInfo) => {
    test.setTimeout(120_000);
    const scenario = `private-health-${width}-${Date.now()}`;
    try {
      await page.setViewportSize({ width, height: width === 375 ? 800 : 900 });
      await loginWithDeterministicProject(page, request, scenario, { demoProject: true, loginAsAdmin: true, libraryModerator: true });
      const name = `Synthetic official ${scenario}`;
      const entry = await apiRequest<{ id: number; identity_key: string }>(page, 'POST', '/plant-health/entries/', {
        name, kind: 'group', sources: [{ url: 'https://example.org/synthetic-health', title: 'Synthetic test only' }],
        translations: SUPPORTED_LANGUAGES.map(({ code }) => ({ language_code: code, preferred_name: name, synonyms: [`Alias ${scenario}`] })),
      });
      await apiRequest(page, 'POST', `/plant-health/entries/${entry.id}/approve/`, {});
      const crops = await apiRequest<{ results: Crop[] }>(page, 'GET', '/crops/?page_size=200');
      const parent = crops.results.find(crop => crop.name === 'Gurke' && !crop.variety)!;
      const variety = crops.results.find(crop => crop.crop_species === parent.crop_species && crop.variety)!;
      expect(parent).toBeTruthy();
      expect(variety).toBeTruthy();
      const notes = 'Early sowing protects against carrot fly. Repels aphids.';
      await apiRequest(page, 'PATCH', `/crops/${parent.id}/`, { plant_health: null, pests_diseases: notes });
      await page.goto(`/app/crops?cropId=${parent.id}&action=edit`);
      const dialog = page.getByRole('dialog', { name: 'Kultur bearbeiten', exact: true });
      const input = dialog.getByRole('combobox', { name: de.plantHealth.label, exact: true });
      await input.fill(name);
      await input.press('Enter');
      await input.fill(`Alias ${scenario}`);
      await page.getByRole('option', { name, exact: true }).click();
      await expect(dialog.locator('.MuiAutocomplete-root').filter({ has: page.getByRole('combobox', { name: de.plantHealth.label, exact: true }) }).locator('.MuiChip-root')).toHaveCount(2);
      await input.scrollIntoViewIfNeeded();
      await expectNoHorizontalPageOverflow(page);
      await page.mouse.move(1, 1);
      await page.screenshot({ path: testInfo.outputPath(`private-health-selected-${width}.png`), animations: 'disabled' });
      await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(dialog).toBeHidden();
      const saved = await apiRequest<Crop>(page, 'GET', `/crops/${parent.id}/`);
      expect(saved.plant_health).toEqual({ entries: [{ name }, { name, catalogue_identity: entry.identity_key }] });
      expect(saved.pests_diseases).toBe(notes);

      await apiRequest(page, 'PATCH', `/crops/${variety.id}/`, { plant_health: null });
      await page.goto(`/app/crops?cropId=${variety.id}&action=edit`);
      const varietyDialog = page.getByRole('dialog', { name: 'Sorte bearbeiten', exact: true });
      const inheritedInput = varietyDialog.getByRole('combobox', { name: de.plantHealth.label, exact: true });
      const picker = varietyDialog.locator('.MuiAutocomplete-root').filter({ has: page.getByRole('combobox', { name: de.plantHealth.label, exact: true }) });
      await inheritedInput.scrollIntoViewIfNeeded();
      await expect(picker.locator('.MuiChip-root')).toHaveCount(2);
      await inheritedInput.click();
      await picker.getByRole('button', { name: 'Leeren', exact: true }).click();
      await inheritedInput.press('Escape');
      await varietyDialog.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(varietyDialog).toBeHidden();
      expect((await apiRequest<Crop>(page, 'GET', `/crops/${variety.id}/`)).plant_health).toEqual({ entries: [] });
      await apiRequest(page, 'PATCH', `/crops/${parent.id}/`, { plant_health: { entries: [{ name: 'Synthetic changed parent' }] } });
      const empty = await apiRequest<Crop>(page, 'GET', `/crops/${variety.id}/`);
      expect((empty.effective_values?.plant_health as PlantHealthSelections).entries).toEqual([]);

      await page.goto(`/app/crops?cropId=${variety.id}&action=edit`);
      await inheritedInput.scrollIntoViewIfNeeded();
      await expect(picker.locator('.MuiChip-root')).toHaveCount(0);
      await varietyDialog.getByRole('button', { name: de.plantHealth.inherit, exact: true }).click();
      await expect(picker).toContainText('Synthetic changed parent');
      await varietyDialog.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(varietyDialog).toBeHidden();
      const inherited = await apiRequest<Crop>(page, 'GET', `/crops/${variety.id}/`);
      expect(inherited.plant_health).toBeNull();
      expect(inherited.effective_values?.plant_health).toEqual({ entries: [{ name: 'Synthetic changed parent' }] });
    } finally { await resetE2EScenario(request, scenario); }
  });
}
