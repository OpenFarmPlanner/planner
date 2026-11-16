import { expect, test } from '@playwright/test';
import { apiRequest, expectNoHorizontalPageOverflow, loginWithDeterministicProject, resetE2EScenario } from './utils';
import { SUPPORTED_LANGUAGES } from '../src/i18n/languages';
import type { Crop, PublicCrop } from '../src/api/types';
import type { PlantHealthEntry } from '../src/crop-library/plant-health/types';
import de from '../src/i18n/locales/de/crops.json' with { type: 'json' };

test.use({ serviceWorkers: 'block' });

for (const width of [375, 1440]) {
  test(`explicit plant-health mapping, public editing and local pins at ${width}px`, async ({ page, request }, info) => {
    test.setTimeout(180_000);
    const scenario = `health-sharing-${width}-${Date.now()}`;
    try {
      await page.setViewportSize({ width, height: width === 375 ? 800 : 900 });
      await loginWithDeterministicProject(page, request, scenario, { demoProject: true, loginAsAdmin: true, libraryModerator: true });
      const createReference = async (suffix: string) => {
        const entry = await apiRequest<PlantHealthEntry>(page, 'POST', '/plant-health/entries/', {
          name: `Synthetic reference ${suffix} ${scenario}`, scientific_name: `Syntheticus ${suffix} ${scenario}`, kind: 'pathogen',
          sources: [{ url: 'https://example.org/synthetic-pathogen', title: 'Synthetic test data only' }],
          translations: SUPPORTED_LANGUAGES.map(({ code }) => ({ language_code: code, preferred_name: `Same label ${scenario}` })),
        });
        return apiRequest<PlantHealthEntry>(page, 'POST', `/plant-health/entries/${entry.id}/approve/`, {});
      };
      const [first, second] = [await createReference('first'), await createReference('second')];
      const species = (await apiRequest<{ results: Array<{ id: number; name: string }> }>(page, 'GET', '/crop-species/')).results[0];
      const privateName = 'Synthetic unresolved leaf spot';
      const retainedName = `Synthetic private note ${scenario}`;
      const notes = 'Early sowing protects against carrot fly. Repels aphids.';
      const crop = await apiRequest<Crop>(page, 'POST', '/crops/', {
        name: species.name, variety: `Synthetic sharing ${scenario}`, crop_species: species.id,
        growth_duration_days: 42, harvest_duration_days: 14, pests_diseases: notes,
        plant_health: { entries: [{ name: privateName }, { name: retainedName }, { name: first.name, catalogue_identity: first.identity_key }] },
      });
      await page.goto(`/app/crops?cropId=${crop.id}`);
      await page.getByTestId('crop-detail-badge-row').getByRole('button', { name: de.library.libraryAction.publish, exact: true }).click();
      const dialog = page.getByRole('dialog');
      const mapping = dialog.getByRole('group', { name: privateName, exact: true });
      await expect(mapping).toBeVisible();
      const retained = dialog.getByRole('group', { name: retainedName, exact: true });
      await retained.getByRole('button', { name: de.plantHealth.publication.propose, exact: true }).click();
      await expect(retained).toContainText(de.plantHealth.publication.proposed);
      expect((await apiRequest<Crop>(page, 'GET', `/crops/${crop.id}/`)).plant_health).toEqual(crop.plant_health);
      await mapping.getByRole('combobox').fill(scenario);
      const option = page.getByRole('option', { name: new RegExp(`Syntheticus second ${scenario}`) });
      await expect(option).toBeVisible();
      await expect(page.getByRole('option', { name: new RegExp(`Syntheticus first ${scenario}`) })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`mapping-options-${width}.png`), animations: 'disabled' });
      await option.click();
      await mapping.getByRole('button', { name: de.plantHealth.publication.map, exact: true }).click();
      await expect(dialog).toContainText(de.plantHealth.publication.saved);
      await expect(mapping).toHaveCount(0);
      await expectNoHorizontalPageOverflow(page);
      await page.screenshot({ path: info.outputPath(`mapping-saved-${width}.png`), animations: 'disabled' });
      await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
      const mapped = await apiRequest<Crop>(page, 'GET', `/crops/${crop.id}/`);
      expect(mapped.source_public_crop).toBeNull();
      expect(mapped.plant_health?.entries).toEqual(expect.arrayContaining([{ name: retainedName }, { name: second.name, catalogue_identity: second.identity_key }]));
      expect(mapped.pests_diseases).toBe(notes);
      const published = await apiRequest<{ public_crop: PublicCrop }>(page, 'POST', `/crops/${crop.id}/publish-public/`, {
        accepted_public_library_terms: true, crop_species_id: species.id, original_language_code: 'de',
      });
      const publicCrop = published.public_crop;
      expect(publicCrop.plant_health?.entries).toHaveLength(2);
      expect(publicCrop.plant_health?.entries.every(entry => entry.catalogue_identity)).toBe(true);
      await page.goto(`/app/crop-library?cropId=${publicCrop.id}`);
      await expect(page.getByText(de.plantHealth.label, { exact: true })).toBeVisible();
      await expect(page.getByText(retainedName, { exact: true })).toHaveCount(0);
      await page.getByText(de.plantHealth.label, { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`public-selections-${width}.png`), animations: 'disabled' });
      await page.getByTestId('public-crop-detail-header').getByRole('button', { name: 'Bearbeiten', exact: true }).click();
      const editor = page.getByRole('dialog', { name: 'Öffentliche Kultur bearbeiten' });
      const input = editor.getByRole('combobox', { name: de.plantHealth.label, exact: true });
      await input.click();
      const picker = editor.locator('.MuiAutocomplete-root').filter({ has: page.getByRole('combobox', { name: de.plantHealth.label, exact: true }) });
      await picker.getByRole('button', { name: 'Leeren', exact: true }).click();
      await input.fill(scenario);
      await page.getByRole('option', { name: new RegExp(`Syntheticus second ${scenario}`) }).click();
      await page.screenshot({ path: info.outputPath(`public-editor-${width}.png`), animations: 'disabled' });
      await editor.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(editor).toBeHidden();
      const edited = await apiRequest<PublicCrop>(page, 'GET', `/public-crops/${publicCrop.id}/`);
      expect(edited.plant_health?.entries).toEqual([{ name: second.name, catalogue_identity: second.identity_key }]);
      expect(edited.pests_diseases).toBe(notes);
      const preview = await apiRequest<{ public_version: number }>(page, 'GET', `/crops/${crop.id}/public-sync/?public_crop_id=${publicCrop.id}`);
      await apiRequest(page, 'POST', `/crops/${crop.id}/public-sync/`, { public_crop_id: publicCrop.id, base_version: preview.public_version, pull_fields: ['plant_health'], push_fields: [], pin_fields: [] });
      const pulled = await apiRequest<Crop>(page, 'GET', `/crops/${crop.id}/`);
      expect(pulled.plant_health?.entries).toContainEqual({ name: retainedName });
      await apiRequest(page, 'PATCH', `/crops/${crop.id}/`, { plant_health: { entries: [...pulled.plant_health!.entries, { name: first.name, catalogue_identity: first.identity_key }] } });
      await page.goto(`/app/crops?cropId=${crop.id}`);
      await page.getByTestId('crop-detail-badge-row').getByRole('button', { name: de.library.libraryAction.pushUpdate, exact: true }).click();
      const sync = page.getByRole('dialog');
      await sync.getByTestId('public-crop-sync-row-plant_health').locator('[data-testid^="public-crop-sync-option-local-"]').click();
      await page.screenshot({ path: info.outputPath(`sync-private-pin-${width}.png`), animations: 'disabled' });
      await sync.getByRole('button', { name: de.library.sync.submit, exact: true }).click();
      await expect(sync).toBeHidden();
      const pinned = await apiRequest<Crop>(page, 'GET', `/crops/${crop.id}/`);
      expect(pinned.library_pinned_fields).toContain('plant_health');
      expect(pinned.plant_health?.entries).toContainEqual({ name: retainedName });
      await page.goto(`/app/crops?cropId=${crop.id}&action=edit`);
      const cropEditor = page.getByRole('dialog', { name: 'Sorte bearbeiten', exact: true });
      await cropEditor.getByRole('combobox', { name: de.plantHealth.label, exact: true }).scrollIntoViewIfNeeded();
      await expect(cropEditor.getByTestId('crop-form-library-pin')).toBeVisible();
      await page.screenshot({ path: info.outputPath(`private-health-pin-${width}.png`), animations: 'disabled' });
      await cropEditor.getByTestId('crop-form-library-pin').click();
      await page.getByRole('button', { name: de.library.pin.unpin, exact: true }).click();
      await cropEditor.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(cropEditor).toBeHidden();
      expect((await apiRequest<Crop>(page, 'GET', `/crops/${crop.id}/`)).library_pinned_fields).not.toContain('plant_health');
    } finally { await resetE2EScenario(request, scenario); }
  });
}
