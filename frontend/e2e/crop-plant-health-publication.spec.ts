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
      await expect(sync.getByTestId('public-crop-sync-row-plant_health')).toContainText(de.plantHealth.label);
      await sync.getByTestId('public-crop-sync-row-plant_health').locator('[data-testid^="public-crop-sync-option-local-"]').click();
      const expand = sync.getByTestId('public-crop-sync-toggle-plant_health');
      await expect(expand).toBeVisible();
      await page.screenshot({ path: info.outputPath(`sync-private-pin-${width}.png`), animations: 'disabled' });
      await expand.click();
      await expect(expand).toHaveText(de.library.sync.showLessValue);
      await expand.click();
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

for (const width of [375, 1440]) {
  test(`mapping an inherited name keeps the variety live at ${width}px`, async ({ page, request }, info) => {
    test.setTimeout(120_000);
    const scenario = `health-inherited-${width}-${Date.now()}`;
    try {
      await page.setViewportSize({ width, height: width === 375 ? 800 : 900 });
      await loginWithDeterministicProject(page, request, scenario, { demoProject: true, loginAsAdmin: true, libraryModerator: true });
      const parent = (await apiRequest<{ results: Crop[] }>(page, 'GET', '/crops/?page_size=200')).results.find(crop => crop.name === 'Gurke' && !crop.variety)!;
      const name = `Synthetic inherited reference ${scenario}`;
      const entry = await apiRequest<PlantHealthEntry>(page, 'POST', '/plant-health/entries/', {
        name, kind: 'group', sources: [{ url: 'https://example.org/synthetic-inheritance', title: 'Synthetic test only' }],
        translations: SUPPORTED_LANGUAGES.map(({ code }) => ({ language_code: code, preferred_name: name })),
      });
      await apiRequest(page, 'POST', `/plant-health/entries/${entry.id}/approve/`, {});
      const privateName = 'Synthetic inherited private name';
      await apiRequest(page, 'PATCH', `/crops/${parent.id}/`, { plant_health: { entries: [{ name: privateName }] } });
      const child = await apiRequest<Crop>(page, 'POST', '/crops/', {
        name: parent.name, variety: `Synthetic inherited ${scenario}`, crop_species: parent.crop_species,
        plant_health: null, growth_duration_days: 42, harvest_duration_days: 14,
      });
      expect(child.general_crop).toBe(parent.id);
      await page.goto(`/app/crops?cropId=${child.id}`);
      await page.getByTestId('crop-detail-badge-row').getByRole('button', { name: de.library.libraryAction.publish, exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(`Diese Sorte übernimmt die Einträge von „${parent.name}“.`);
      await expect(dialog).toContainText('sie gilt für alle erbenden Sorten');
      const row = dialog.getByRole('group', { name: privateName, exact: true });
      await row.getByRole('combobox').fill(name);
      await page.getByRole('option').filter({ hasText: name }).click();
      await page.screenshot({ path: info.outputPath(`inherited-mapping-${width}.png`), animations: 'disabled' });
      const requestMapping = page.waitForRequest(request => request.method() === 'POST' && request.url().includes('/plant-health/mappings/'));
      await row.getByRole('button', { name: de.plantHealth.publication.map, exact: true }).click();
      expect((await requestMapping).url()).toContain(`/crops/${parent.id}/plant-health/mappings/`);
      await expect(dialog).toContainText(de.plantHealth.publication.saved);
      await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
      const mapped = await apiRequest<Crop>(page, 'GET', `/crops/${child.id}/`);
      expect(mapped.plant_health).toBeNull();
      expect(mapped.effective_values?.plant_health?.entries).toContainEqual({ name, catalogue_identity: entry.identity_key });
      await apiRequest(page, 'PATCH', `/crops/${parent.id}/`, { plant_health: { entries: [{ name, catalogue_identity: entry.identity_key }, { name: 'Later parent change' }] } });
      const later = await apiRequest<Crop>(page, 'GET', `/crops/${child.id}/`);
      expect(later.plant_health).toBeNull();
      expect(later.effective_values?.plant_health?.entries).toContainEqual({ name: 'Later parent change' });
    } finally { await resetE2EScenario(request, scenario); }
  });
}

test('public variety resolves a health-only species fallback and honors an explicit empty override', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const scenario = `health-public-fallback-${Date.now()}`;
  try {
    await loginWithDeterministicProject(page, request, scenario, { demoProject: true, loginAsAdmin: true, libraryModerator: true });
    const speciesName = `Synthetic fallback species ${Date.now()}`;
    const species = await apiRequest<{ id: number }>(page, 'POST', '/crop-species/', { name: speciesName });
    await apiRequest(page, 'POST', `/crop-species/${species.id}/approve/`, {
      translations: SUPPORTED_LANGUAGES.map(({ code }) => ({ language_code: code, common_name: speciesName })),
    });
    const name = `Synthetic inherited public entry ${Date.now()}`;
    const entry = await apiRequest<PlantHealthEntry>(page, 'POST', '/plant-health/entries/', {
      name, kind: 'group', sources: [{ url: 'https://example.org/synthetic-public-fallback', title: 'Synthetic test only' }],
      translations: SUPPORTED_LANGUAGES.map(({ code }) => ({ language_code: code, preferred_name: name })),
    });
    await apiRequest(page, 'POST', `/plant-health/entries/${entry.id}/approve/`, {});
    const general = await apiRequest<Crop>(page, 'POST', '/crops/', {
      name: speciesName, crop_species: species.id, growth_duration_days: 42, harvest_duration_days: 14,
      plant_health: { entries: [{ name, catalogue_identity: entry.identity_key }] },
    });
    await apiRequest(page, 'POST', `/crops/${general.id}/publish-public/`, {
      accepted_public_library_terms: true, crop_species_id: species.id, original_language_code: 'de', publish_as_general: true,
    });
    const variety = await apiRequest<Crop>(page, 'POST', '/crops/', {
      name: speciesName, variety: `Synthetic variety ${Date.now()}`, crop_species: species.id, plant_health: null,
      growth_duration_days: 42, harvest_duration_days: 14,
    });
    const published = await apiRequest<{ public_crop: PublicCrop }>(page, 'POST', `/crops/${variety.id}/publish-public/`, {
      accepted_public_library_terms: true, crop_species_id: species.id, original_language_code: 'de',
    });
    const id = published.public_crop.id;
    await apiRequest(page, 'PATCH', `/public-crops/${id}/`, { plant_health: null });
    for (const size of [{ width: 375, height: 800 }, { width: 768, height: 900 }, { width: 1024, height: 900 }, { width: 1440, height: 900 }, { width: 800, height: 375 }]) {
      await page.setViewportSize(size);
      await page.goto(`/app/crop-library?cropId=${id}`);
      const chip = page.getByText(`${name} · ${de.plantHealth.catalogue}`, { exact: true });
      await chip.scrollIntoViewIfNeeded();
      await expect(chip).toBeVisible();
      await expect(page.getByRole('heading', { name: de.siteHealth.title, exact: true })).toBeVisible();
      await expectNoHorizontalPageOverflow(page);
      await page.screenshot({ path: info.outputPath(`public-health-fallback-${size.width}.png`), animations: 'disabled' });
    }
    await apiRequest(page, 'PATCH', `/public-crops/${id}/`, { plant_health: { entries: [] } });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Allgemeine Informationen', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: de.siteHealth.title, exact: true })).toHaveCount(0);
    await expect(page.getByText(`${name} · ${de.plantHealth.catalogue}`, { exact: true })).toHaveCount(0);
  } finally { await resetE2EScenario(request, scenario); }
});
