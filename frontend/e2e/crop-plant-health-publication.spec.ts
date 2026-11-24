import { expect, test, type Locator, type Page } from '@playwright/test';
import { apiRequest, expectNoHorizontalPageOverflow, loginWithDeterministicProject, resetE2EScenario } from './utils';
import { SUPPORTED_LANGUAGES } from '../src/i18n/languages';
import type { Crop, PublicCrop } from '../src/api/types';
import type { PlantHealthEntry } from '../src/crop-library/plant-health/types';
import de from '../src/i18n/locales/de/crops.json' with { type: 'json' };
import fr from '../src/i18n/locales/fr/crops.json' with { type: 'json' };

test.use({ serviceWorkers: 'block' });

async function finishPublication(page: Page, dialog: Locator, speciesName: string) {
  await dialog.getByRole('combobox', { name: /Offizielle Kulturart/ }).fill(speciesName);
  await page.getByRole('option', { name: speciesName, exact: true }).click();
  const submit = dialog.getByRole('button', { name: de.library.publishWizard.publishNow, exact: true });
  await submit.click();
  const consent = dialog.getByRole('checkbox', { name: de.library.publishConfirm.acceptLicense, exact: true });
  await expect(async () => {
    expect((await dialog.isVisible()) ? await consent.isVisible() : true).toBe(true);
  }).toPass({ timeout: 10_000 });
  if (await consent.isVisible()) {
    await consent.check();
    await submit.click();
  }
  await expect(dialog).toBeHidden();
}

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
      await retained.getByRole('combobox').click();
      await page.getByRole('button', { name: de.plantHealth.publication.proposeName.replace('{{name}}', retainedName), exact: true }).click();
      await expect(retained).toContainText(de.plantHealth.publication.proposed);
      expect((await apiRequest<Crop>(page, 'GET', `/crops/${crop.id}/`)).plant_health).toEqual(crop.plant_health);
      await mapping.getByRole('combobox').fill(scenario);
      const option = page.getByRole('option', { name: new RegExp(`Syntheticus second ${scenario}`) });
      await expect(option).toBeVisible();
      await expect(page.getByRole('option', { name: new RegExp(`Syntheticus first ${scenario}`) })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`mapping-options-${width}.png`), animations: 'disabled' });
      await option.click();
      await expect(mapping.getByRole('button', { name: de.plantHealth.publication.map, exact: true })).toHaveCount(0);
      expect((await apiRequest<Crop>(page, 'GET', `/crops/${crop.id}/`)).plant_health).toEqual(crop.plant_health);
      await expectNoHorizontalPageOverflow(page);
      await page.screenshot({ path: info.outputPath(`mapping-saved-${width}.png`), animations: 'disabled' });
      await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
      const mapped = await apiRequest<Crop>(page, 'GET', `/crops/${crop.id}/`);
      expect(mapped.source_public_crop).toBeNull();
      expect(mapped.plant_health).toEqual(crop.plant_health);
      expect(mapped.pests_diseases).toBe(notes);
      await page.getByTestId('crop-detail-badge-row').getByRole('button', { name: de.library.libraryAction.publish, exact: true }).click();
      await mapping.getByRole('combobox').fill(scenario);
      await page.getByRole('option', { name: new RegExp(`Syntheticus second ${scenario}`) }).click();
      await finishPublication(page, dialog, species.name);
      const committed = await apiRequest<Crop>(page, 'GET', `/crops/${crop.id}/`);
      expect(committed.plant_health?.entries).toEqual(expect.arrayContaining([{ name: retainedName }, { name: second.name, catalogue_identity: second.identity_key }]));
      const publicCrop = await apiRequest<PublicCrop>(page, 'GET', `/public-crops/${committed.source_public_crop}/`);
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
      await expect(dialog).toContainText('gilt für alle erbenden Sorten');
      const row = dialog.getByRole('group', { name: privateName, exact: true });
      await row.getByRole('combobox').fill(name);
      await page.getByRole('option').filter({ hasText: name }).click();
      await page.screenshot({ path: info.outputPath(`inherited-mapping-${width}.png`), animations: 'disabled' });
      await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
      expect((await apiRequest<Crop>(page, 'GET', `/crops/${parent.id}/`)).plant_health?.entries).toEqual([{ name: privateName }]);
      await page.getByTestId('crop-detail-badge-row').getByRole('button', { name: de.library.libraryAction.publish, exact: true }).click();
      await row.getByRole('combobox').fill(name);
      await page.getByRole('option').filter({ hasText: name }).click();
      const finalRequest = page.waitForRequest(request => request.method() === 'POST' && request.url().includes(`/crops/${child.id}/publish-public/`));
      await finishPublication(page, dialog, parent.name);
      expect((await finalRequest).postDataJSON().plant_health_mappings[0].crop_id).toBe(parent.id);
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
    const emptyVariety = await apiRequest<Crop>(page, 'POST', '/crops/', {
      name: speciesName, variety: `Synthetic published empty ${Date.now()}`, crop_species: species.id,
      plant_health: { entries: [] }, growth_duration_days: 42, harvest_duration_days: 14,
    });
    const emptyPublication = await apiRequest<{ public_crop: PublicCrop }>(page, 'POST', `/crops/${emptyVariety.id}/publish-public/`, {
      accepted_public_library_terms: true, crop_species_id: species.id, original_language_code: 'de',
    });
    expect(emptyPublication.public_crop.plant_health).toEqual({ entries: [] });
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`/app/crop-library?cropId=${emptyPublication.public_crop.id}`);
    await expect(page.getByRole('heading', { name: 'Allgemeine Informationen', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: de.siteHealth.title, exact: true })).toHaveCount(0);
    await expect(page.getByText(`${name} · ${de.plantHealth.catalogue}`, { exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('published-empty-override-375.png'), animations: 'disabled' });
  } finally { await resetE2EScenario(request, scenario); }
});

test.describe('plant-health hierarchy, order and contextual help', () => {
  test.use({ hasTouch: true });
  for (const width of [375, 1440]) test(`four crop surfaces retain form order and accessible help at ${width}px`, async ({ page, request }, info) => {
    test.setTimeout(180_000);
    const scenario = `health-order-${width}-${Date.now()}`;
    await page.setViewportSize({ width, height: width === 375 ? 800 : 900 });
    const precedes = async (container: Locator, labels: string[]) => {
      for (let index = 1; index < labels.length; index++) {
        const first = container.getByText(labels[index - 1], { exact: true }).first();
        const second = container.getByText(labels[index], { exact: true }).first();
        await expect(first).toBeAttached();
        await expect(second).toBeAttached();
        expect(await first.evaluate((node, other) => Boolean(node.compareDocumentPosition(other!) & Node.DOCUMENT_POSITION_FOLLOWING), await second.elementHandle()), labels.join(' → ')).toBe(true);
      }
    };
    const sectionOrder = [de.form.generalInfoSectionTitle, de.form.sectionCropRotation, de.form.sectionTiming,
      de.form.sectionPlanting, de.form.sectionYield, de.form.seedRateSectionTitle, de.germination.title,
      de.siteHealth.title, de.companions.title, de.form.notes];
    const checkOrder = async (container: Locator) => {
      const headings = (await container.getByRole('heading', { level: 6 }).allTextContents()).map(value => value.trim()).filter(value => sectionOrder.includes(value));
      expect(headings).toEqual(expect.arrayContaining(sectionOrder.slice(0, 8)));
      expect(headings).toEqual([...headings].sort((a, b) => sectionOrder.indexOf(a) - sectionOrder.indexOf(b)));
      expect(headings).not.toContain(de.plantHealth.label);
      await precedes(container, [de.siteHealth.fields.life_cycle, de.form.sectionTiming, de.form.cultivationType,
        de.form.growthDurationDays, de.form.harvestDurationDays]);
      await precedes(container, [de.siteHealth.fields.light_requirement, de.siteHealth.fields.water_requirement,
        de.siteHealth.fields.winter_hardiness, de.plantHealth.label, de.plantHealth.notes]);
      await expect(container.getByText(de.plantHealth.associationHint, { exact: true })).toHaveCount(0);
      await expect(container.getByText(de.plantHealth.relationshipsActionHint, { exact: true })).toHaveCount(0);
    };
    const helpName = (field: string) => de.form.fieldInfoAriaLabel.replace('{{field}}', field);
    const helpBounds = async (targetPage: Page) => {
      const tooltip = targetPage.getByRole('tooltip');
      await expect(tooltip).toBeVisible();
      const box = await tooltip.boundingBox();
      const viewport = targetPage.viewportSize()!;
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    };
    try {
      await loginWithDeterministicProject(page, request, scenario, { loginAsAdmin: true, libraryModerator: true });
      const species = await apiRequest<{ id: number; name: string }>(page, 'POST', '/crop-species/', { name: `Synthetic order species ${scenario}` });
      await apiRequest(page, 'POST', `/crop-species/${species.id}/approve/`, {
        translations: SUPPORTED_LANGUAGES.map(({ code }) => ({ language_code: code, common_name: species.name })),
      });
      const entry = await apiRequest<PlantHealthEntry>(page, 'POST', '/plant-health/entries/', {
        name: `Synthetic documented ${scenario}`, scientific_name: `Syntheticus ${scenario}`, kind: 'pathogen',
        sources: [{ url: 'https://example.org/synthetic-identity', title: 'Synthetic identity evidence' }],
        translations: SUPPORTED_LANGUAGES.map(({ code }) => ({ language_code: code, preferred_name: `Synthetic documented ${scenario}` })),
      });
      await apiRequest(page, 'POST', `/plant-health/entries/${entry.id}/approve/`, {});
      await apiRequest(page, 'POST', '/plant-health/hosts/', { entry: entry.id, species: species.id, variety_name: 'Synthetic qualified variety',
        qualification: 'Only the documented synthetic conditions.', is_confirmed: true,
        sources: [{ url: 'https://example.org/synthetic-host', title: 'Synthetic host source', evidence: 'Synthetic evidence only.' }] });
      const values = {
        botanical_name: `Syntheticus crop ${scenario}`, crop_family: 'Fabaceae', nutrient_demand: 'medium', cultivation_types: ['direct_sowing', 'pre_cultivation'],
        growth_duration_days: 42, harvest_duration_days: 14, distance_within_row_cm: 20, row_spacing_cm: 40,
        sowing_depth_cm: 1, sowing_depth_max_cm: 2, harvest_method: 'per_plant', expected_yield: 1,
        seed_rate_direct_value: 1, seed_rate_direct_unit: 'g_per_m2', seed_rate_pre_cultivation_value: 1, seed_rate_pre_cultivation_unit: 'seeds_per_plant',
        seed_rate_by_cultivation: { direct_sowing: { value: 1, unit: 'g_per_m2' }, pre_cultivation: { value: 1, unit: 'seeds_per_plant' } },
        thousand_kernel_weight_g: 1.2, germination_days_min: 7, germination_days_max: 10, propagation_duration_days: 20,
        light_requirement: 'full_sun', water_requirement: 'medium', life_cycle: 'annual', winter_hardiness: 'not_hardy',
        pests_diseases: 'Synthetic prevention prose, not an agronomic claim.',
        plant_health: { entries: [{ name: entry.name, catalogue_identity: entry.identity_key }] },
      };
      const parent = await apiRequest<Crop>(page, 'POST', '/crops/', { name: species.name, crop_species: species.id, ...values });
      const child = await apiRequest<Crop>(page, 'POST', '/crops/', { name: species.name, crop_species: species.id,
        variety: `Synthetic order ${scenario}`, seed_type: 'open_pollinated', ...values });
      const publications: PublicCrop[] = [];
      for (const crop of [parent, child]) {
        const published = await apiRequest<{ public_crop: PublicCrop }>(page, 'POST', `/crops/${crop.id}/publish-public/`, {
          accepted_public_library_terms: true, crop_species_id: species.id, original_language_code: 'de', publish_as_general: !crop.variety,
        });
        publications.push(published.public_crop);
      }
      await apiRequest(page, 'PATCH', `/crops/${parent.id}/`, { plant_health: { entries: [...values.plant_health.entries, { name: 'Synthetic private entry' }] } });
      // Exercise actual inheritance and explicit overrides as well as filled general values.
      await apiRequest(page, 'PATCH', `/crops/${child.id}/`, { light_requirement: '', plant_health: null, water_requirement: 'high' });
      for (const [index, crop] of [parent, child].entries()) {
        await page.goto(`/app/crops?cropId=${crop.id}`);
        const details = page.getByTestId('crop-detail-sections');
        await expect(details.getByRole('heading', { name: de.siteHealth.title, exact: true })).toBeVisible();
        await checkOrder(details);
        const official = details.getByRole('button', { name: new RegExp(`Synthetic documented ${scenario}.*${de.plantHealth.catalogue}`) });
        await expect(official).toBeVisible();
        await expect(details.getByRole('button', { name: /Synthetic private entry/ })).toHaveCount(0);
        await details.getByRole('heading', { name: de.siteHealth.title, exact: true }).scrollIntoViewIfNeeded();
        if (index === 1) await page.screenshot({ path: info.outputPath(`ordered-private-detail-${width}.png`), animations: 'disabled' });
        await page.goto(`/app/crops?cropId=${crop.id}&action=edit`);
        const editor = page.getByRole('dialog', { name: crop.variety ? 'Sorte bearbeiten' : 'Kultur bearbeiten', exact: true });
        await expect(editor).toBeVisible();
        await checkOrder(editor);
        await editor.getByRole('combobox', { name: de.plantHealth.label, exact: true }).scrollIntoViewIfNeeded();
        const help = editor.getByRole('button', { name: helpName(de.plantHealth.label), exact: true });
        await expect(help).toHaveCount(0);
        await editor.getByRole('heading', { name: de.siteHealth.title, exact: true }).scrollIntoViewIfNeeded();
        if (index === 1) await page.screenshot({ path: info.outputPath(`ordered-private-form-${width}.png`), animations: 'disabled' });
        await page.goto(`/app/crop-library?cropId=${publications[index].id}`);
        const publicDetails = page.getByRole('main');
        await expect(publicDetails.getByRole('heading', { name: de.siteHealth.title, exact: true })).toBeVisible();
        await checkOrder(publicDetails);
        await publicDetails.getByRole('heading', { name: de.siteHealth.title, exact: true }).scrollIntoViewIfNeeded();
        if (index === 1) await page.screenshot({ path: info.outputPath(`ordered-public-detail-${width}.png`), animations: 'disabled' });
        await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
        const publicEditor = page.getByRole('dialog', { name: 'Öffentliche Kultur bearbeiten', exact: true });
        await expect(publicEditor).toBeVisible();
        await checkOrder(publicEditor);
        await publicEditor.getByRole('combobox', { name: de.plantHealth.label, exact: true }).scrollIntoViewIfNeeded();
        await publicEditor.getByRole('heading', { name: de.siteHealth.title, exact: true }).scrollIntoViewIfNeeded();
        if (index === 1) await page.screenshot({ path: info.outputPath(`ordered-public-form-${width}.png`), animations: 'disabled' });
      }
      await page.goto(`/app/crops?cropId=${child.id}`);
      const details = page.getByTestId('crop-detail-sections');
      const help = details.getByRole('button', { name: helpName(de.plantHealth.label), exact: true });
      await expect(help).toHaveCount(0);
      const catalogueChip = details.getByRole('button', { name: new RegExp(`Synthetic documented ${scenario}.*${de.plantHealth.catalogue}`) });
      await catalogueChip.focus();
      await expect(catalogueChip).toBeFocused();
      await page.keyboard.press('Enter');
      const relationships = page.getByRole('dialog', { name: de.plantHealth.relationshipsTitle, exact: true });
      await expect(relationships.getByText('Synthetic qualified variety', { exact: false })).toBeVisible();
      await expect(relationships.getByText('Only the documented synthetic conditions.', { exact: true })).toBeVisible();
      await expect(relationships.getByRole('link', { name: 'Synthetic host source', exact: true })).toBeVisible();
      await expect(relationships.getByText(de.plantHealth.relationshipsHint, { exact: true })).toHaveCount(0);
      const relationshipHelp = relationships.getByRole('button', { name: helpName(de.plantHealth.relationshipsTitle), exact: true });
      await relationshipHelp.tap();
      await expect(page.getByRole('tooltip')).toContainText(de.plantHealth.relationshipsHint);
      await helpBounds(page);
      await page.screenshot({ path: info.outputPath(`relationships-help-${width}.png`), animations: 'disabled' });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('tooltip')).not.toBeVisible();
      await expect(relationships).toBeVisible();
      await expect(relationshipHelp).toBeFocused();
      if (width === 375) {
        const enlargedText = await page.addStyleTag({ content: 'html { font-size: 200%; }' });
        await relationshipHelp.tap();
        await helpBounds(page);
        await expectNoHorizontalPageOverflow(page);
        const titleBounds = await relationships.getByRole('heading', { level: 2 }).boundingBox();
        expect(titleBounds!.x).toBeGreaterThanOrEqual(0);
        expect(titleBounds!.x + titleBounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
        await page.getByRole('tooltip').evaluate(node => { node.scrollTop = node.scrollHeight; });
        await page.screenshot({ path: info.outputPath('relationships-help-enlarged-text.png'), animations: 'disabled' });
        await page.keyboard.press('Escape');
        await enlargedText.evaluate(node => node.remove());
      } else {
        await page.setViewportSize({ width: 800, height: 375 });
        await relationshipHelp.tap();
        await helpBounds(page);
        await page.screenshot({ path: info.outputPath('relationships-help-landscape.png'), animations: 'disabled' });
        await page.keyboard.press('Escape');
      }
      await relationships.getByRole('button', { name: 'Schließen', exact: true }).click();
      await expect(relationships).not.toBeVisible();
      await expectNoHorizontalPageOverflow(page);
      if (width === 375) {
        await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: 'fr' });
        await page.evaluate(() => localStorage.setItem('ui.language', 'fr'));
        await page.reload();
        await page.getByRole('button', { name: new RegExp(`Synthetic documented ${scenario}.*${fr.plantHealth.catalogue}`) }).click();
        const translated = page.getByRole('dialog', { name: fr.plantHealth.relationshipsTitle, exact: true });
        await translated.getByRole('button', { name: fr.form.fieldInfoAriaLabel.replace('{{field}}', fr.plantHealth.relationshipsTitle), exact: true }).tap();
        await expect(page.getByRole('tooltip')).toContainText(fr.plantHealth.relationshipsHint);
        await helpBounds(page);
        await page.screenshot({ path: info.outputPath('relationships-help-french.png'), animations: 'disabled' });
        await page.keyboard.press('Escape');
        await translated.getByRole('button', { name: 'Fermer', exact: true }).click();
        await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: 'de' });
        await page.evaluate(() => localStorage.setItem('ui.language', 'de'));
      }
      // A sparse explicit override omits only the empty content, preserving the remaining order.
      await apiRequest(page, 'PATCH', `/crops/${parent.id}/`, { plant_health: { entries: [] }, pests_diseases: '', light_requirement: '', water_requirement: '', life_cycle: '', winter_hardiness: '' });
      await apiRequest(page, 'PATCH', `/crops/${child.id}/`, { plant_health: { entries: [] }, pests_diseases: '', light_requirement: '', water_requirement: '', life_cycle: '', winter_hardiness: '' });
      await page.goto(`/app/crops?cropId=${child.id}`);
      const headings = await page.getByTestId('crop-detail-sections').getByRole('heading', { level: 6 }).allTextContents();
      expect(headings).not.toContain(de.siteHealth.title);
      expect(headings.filter(value => sectionOrder.includes(value))).toEqual(headings.filter(value => sectionOrder.includes(value)).sort((a, b) => sectionOrder.indexOf(a) - sectionOrder.indexOf(b)));
      await page.goto(`/app/crops?cropId=${child.id}&action=edit`);
      const emptyEditor = page.getByRole('dialog', { name: 'Sorte bearbeiten', exact: true });
      await expect(emptyEditor.getByRole('combobox', { name: de.plantHealth.label, exact: true })).toBeAttached();
      await expect(emptyEditor.getByRole('heading', { name: de.siteHealth.title, exact: true })).toBeAttached();
      await precedes(emptyEditor, [de.siteHealth.fields.light_requirement, de.siteHealth.fields.water_requirement, de.plantHealth.label, de.plantHealth.notes]);
    } finally { await resetE2EScenario(request, scenario); }
  });
});
