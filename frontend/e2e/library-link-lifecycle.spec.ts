import germanCrops from '../src/i18n/locales/de/crops.json' with { type: 'json' };
import frenchCrops from '../src/i18n/locales/fr/crops.json' with { type: 'json' };
import frenchNavigation from '../src/i18n/locales/fr/navigation.json' with { type: 'json' };
import { expect, test, type Page } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject, resetE2EScenario } from './utils';

// Functional assertions, not screenshots: these flows are about which control
// the crop offers per library state and that no expected state produces a
// failing request. The full state matrix is explored by
// e2e/library-matrix.explore.ts (dev tool).

interface CropSpecies { id: number; name: string }
interface CropRow { id: number; name: string; variety: string }
interface PublishResponse { public_crop: { id: number; name: string; variety: string } }
interface CarrotEntry extends CropRow {
  crop_species: number;
  version: number;
  notes: string;
  seed_type: string;
  growth_duration_days: number | null;
}

async function prepareCarrotEntry(page: Page): Promise<CarrotEntry> {
  const speciesList = await apiRequest<{ results: CropSpecies[] }>(page, 'GET', '/crop-species/?page_size=500');
  const species = speciesList.results.find(row => /^(carrot|karotte|möhre)$/i.test(row.name));
  expect(species, 'published Carrot species fixture').toBeTruthy();
  if (!species) throw new Error('Missing published Carrot species fixture');
  const catalog = await apiRequest<{ results: CarrotEntry[] }>(page, 'GET',
    '/public-crops/?q=' + encodeURIComponent(species.name) + '&page_size=500');
  const existing = catalog.results.find(row => !row.variety && row.crop_species === species.id);
  if (existing) return existing;
  const crop = await apiRequest<CropRow>(page, 'POST', '/crops/', {
    name: species.name, crop_species: species.id, variety: '',
    growth_duration_days: 78, harvest_duration_days: 21, notes: 'Shared synthetic Carrot note',
  });
  const published = await apiRequest<PublishResponse>(page, 'POST',
    '/crops/' + crop.id + '/publish-public/', {
      accepted_public_library_terms: true, crop_species_id: species.id,
      publish_as_general: true, original_language_code: 'de',
    });
  return apiRequest<CarrotEntry>(page, 'GET', '/public-crops/' + published.public_crop.id + '/');
}

function trackFailedApiCalls(page: Page): string[] {
  const failures: string[] = [];
  page.on('response', (response) => {
    // The session probe answers 401 before login; that is not a library state.
    if (response.status() >= 400 && response.url().includes('/api/') && !response.url().includes('/auth/me/')) {
      failures.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });
  return failures;
}

async function listSpecies(page: Page, count: number): Promise<CropSpecies[]> {
  const response = await apiRequest<{ results: CropSpecies[] }>(page, 'GET', '/crop-species/');
  expect(response.results.length).toBeGreaterThanOrEqual(count);
  return response.results.slice(0, count);
}

async function publishVariety(
  page: Page,
  species: CropSpecies,
  variety: string,
  originalLanguageCode: 'de' | 'en' = 'de',
): Promise<{ crop: CropRow; publicCropId: number }> {
  const crop = await apiRequest<CropRow>(page, 'POST', '/crops/', {
    name: species.name,
    variety,
    crop_species: species.id,
    cultivation_type: 'pre_cultivation',
    cultivation_types: ['pre_cultivation'],
    growth_duration_days: 42,
    harvest_duration_days: 14,
  });
  const published = await apiRequest<PublishResponse>(page, 'POST', `/crops/${crop.id}/publish-public/`, {
    accepted_public_library_terms: true,
    crop_species_id: species.id,
    original_language_code: originalLanguageCode,
  });
  return { crop, publicCropId: published.public_crop.id };
}

async function openCrop(page: Page, variety: string): Promise<void> {
  await page.goto('/app/crops');
  await page.getByLabel('Kultur suchen').first().fill(variety);
  await page.getByText(variety, { exact: true }).first().click();
}

test('a crop whose own library entry was withdrawn offers republishing and can be unlinked', async ({ page, request }) => {
  const failures = trackFailedApiCalls(page);
  await loginWithDeterministicProject(page, request, `library-withdrawn-${Date.now()}`, { loginAsAdmin: true });
  const [species] = await listSpecies(page, 1);
  const variety = `E2E Zurückgezogen ${Date.now()}`;
  const { publicCropId } = await publishVariety(page, species, variety);
  await apiRequest(page, 'POST', `/public-crops/${publicCropId}/remove/`, {});

  await openCrop(page, variety);

  await expect(page.getByTestId('crop-detail-publish-action')).toHaveText('Wieder veröffentlichen');

  await page.getByRole('button', { name: 'Weitere Aktionen' }).first().click();
  await page.getByRole('menuitem', { name: 'Verknüpfung aufheben' }).click();
  const dialog = page.getByRole('dialog', { name: 'Verknüpfung aufheben?' });
  await expect(dialog).toContainText(species.name);
  await expect(dialog).not.toContainText('öffentlicher Eintrag“');
  await dialog.getByRole('button', { name: 'Verknüpfung aufheben' }).click();

  await expect(page.getByRole('button', { name: 'In Bibliothek teilen' })).toBeVisible();
  expect(failures).toEqual([]);
});

test('an own withdrawn entry is republished with one confirmation, keeping its original language', async ({ page, request }) => {
  const failures = trackFailedApiCalls(page);
  await loginWithDeterministicProject(page, request, `library-republish-${Date.now()}`, { loginAsAdmin: true });
  const [species] = await listSpecies(page, 1);
  const variety = `E2E Wieder ${Date.now()}`;
  // Published in English while the suite runs in German (playwright.config.ts):
  // republishing must not silently retag the entry to the UI's language.
  const { publicCropId } = await publishVariety(page, species, variety, 'en');
  await apiRequest(page, 'POST', `/public-crops/${publicCropId}/remove/`, {});

  await openCrop(page, variety);
  await page.getByTestId('crop-detail-publish-action').click();
  await page.getByRole('dialog', { name: 'Wieder veröffentlichen?' })
    .getByRole('button', { name: 'Wieder veröffentlichen' }).click();

  await expect(page.getByTestId('crop-detail-library-status')).toHaveText('Aktuell');
  const republished = await apiRequest<{ original_language_code: string }>(
    page, 'GET', `/public-crops/${publicCropId}/`,
  );
  expect(republished.original_language_code).toBe('en');
  expect(failures).toEqual([]);
});

test('a linked crop with local changes is synced field by field with its entry', async ({ page, request }) => {
  const failures = trackFailedApiCalls(page);
  await loginWithDeterministicProject(page, request, `library-sync-${Date.now()}`, { loginAsAdmin: true });
  const [species] = await listSpecies(page, 1);
  const variety = `E2E Abgleich ${Date.now()}`;
  const { crop } = await publishVariety(page, species, variety);
  await apiRequest(page, 'PATCH', `/crops/${crop.id}/`, { growth_duration_days: 55 });

  await openCrop(page, variety);
  await page.getByTestId('crop-detail-publish-action').click();

  const dialog = page.getByRole('dialog', { name: 'Mit Kulturbibliothek abgleichen' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Abgleichen' }).click();

  await expect(page.getByTestId('crop-detail-library-status')).toHaveText('Aktuell');
  expect(failures).toEqual([]);
});

test('correcting the crop species to one that already has the variety shows the conflict inline', async ({ page, request }) => {
  await loginWithDeterministicProject(page, request, `library-relink-${Date.now()}`, {
    loginAsAdmin: true, libraryModerator: true,
  });
  const [first, second] = await listSpecies(page, 2);
  const variety = `E2E Konflikt ${Date.now()}`;
  await publishVariety(page, first, variety);
  const { publicCropId } = await publishVariety(page, second, variety);

  await page.goto(`/app/crop-library?cropId=${publicCropId}`);
  await page.getByRole('button', { name: /Moderation/ }).first().click();
  await page.getByRole('menuitem', { name: 'Kulturart korrigieren' }).click();
  const dialog = page.getByRole('dialog', { name: 'Kulturart korrigieren' });

  // Nothing changed yet: the submit is disabled and says why.
  await expect(dialog.getByRole('button', { name: 'Kulturart ändern' })).toBeDisabled();
  await expect(dialog.getByLabel('Wähle eine andere Kulturart oder Sorte aus.')).toBeVisible();

  const field = dialog.getByLabel(/Offizielle Kulturart/i);
  await field.click();
  await field.fill(first.name);
  await page.getByRole('option', { name: new RegExp(first.name) }).first().click();
  await dialog.getByRole('button', { name: 'Kulturart ändern' }).click();

  await expect(dialog.getByRole('alert')).toContainText(
    'Unter dieser Kulturart gibt es bereits einen veröffentlichten Eintrag mit dieser Sorte.',
  );
  await expect(dialog).toBeVisible();
});

for (const entryPoint of ['publish', 'import', 'copy', 'resolve', 'resolve-browser'] as const) {
  test(`existing culture imports through ${entryPoint} without replacing IDs or publishing local notes`, async ({ page, request }, testInfo) => {
    const resolvesDifferences = entryPoint === 'resolve' || entryPoint === 'resolve-browser';
    await loginWithDeterministicProject(page, request, `library-existing-${entryPoint}-${Date.now()}`, { loginAsAdmin: true, libraryModerator: true });
    const species = await apiRequest<CropSpecies>(page, 'POST', '/crop-species/', { name: `Synthetic Tomato ${entryPoint} ${Date.now()}` });
    await apiRequest(page, 'POST', `/crop-species/${species.id}/approve/`, {
      translations: ['de', 'en', 'fr', 'es'].map((language_code) => ({ language_code, common_name: species.name })),
    });
    const source = await apiRequest<CropRow>(page, 'POST', '/crops/', {
      name: species.name, variety: '', crop_species: species.id,
      growth_duration_days: 80, harvest_duration_days: 20,
      ...(resolvesDifferences ? { germination_temperature_requirement: 'cold_stratification', germination_light_requirement: 'light' } : {}),
    });
    const published = await apiRequest<PublishResponse>(page, 'POST', `/crops/${source.id}/publish-public/`, {
      accepted_public_library_terms: true, crop_species_id: species.id, publish_as_general: true,
      original_language_code: 'de',
    });
    // The target grower is a different contributor in a different project.
    // Their existing culture must link to this foreign library entry.
    await apiRequest(page, 'POST', '/auth/logout/', {});
    await loginWithDeterministicProject(page, request, `library-target-${entryPoint}-${Date.now()}`, { loginAsAdmin: true });
    const local = await apiRequest<CropRow>(page, 'POST', '/crops/', {
      name: species.name, variety: '', crop_species: species.id,
      growth_duration_days: 90, harvest_duration_days: entryPoint === 'copy' || resolvesDifferences ? 30 : 20, notes: 'Private synthetic note',
      ...(resolvesDifferences ? { germination_temperature_requirement: 'frost_treatment', germination_light_requirement: 'dark' } : {}),
    });
    const varieties: CropRow[] = [];
    for (let index = 0; index < 12; index++) varieties.push(await apiRequest<CropRow>(page, 'POST', '/crops/', {
      name: species.name, variety: `Synthetic Roma ${index}`, crop_species: species.id,
      growth_duration_days: index === 0 ? 40 : null,
    }));
    const variety = varieties[0];
    const location = await apiRequest<{ id: number }>(page, 'POST', '/locations/', { name: 'Synthetic farm' });
    const field = await apiRequest<{ id: number }>(page, 'POST', '/fields/', { name: 'Synthetic field', location: location.id });
    const bed = await apiRequest<{ id: number }>(page, 'POST', '/beds/', { name: 'Synthetic bed', field: field.id, area_sqm: 20 });
    const season = await apiRequest<{ id: number }>(page, 'POST', '/seasons/', { start_date: '2026-01-01', end_date: '2026-12-31' });
    const plan = await apiRequest<{ id: number; crop: number }>(page, 'POST', '/planting-plans/', {
      season: season.id, crop: variety.id, bed: bed.id, planting_date: '2026-03-01',
      cultivation_type: 'direct_sowing',
    });
    // The fixture switches accounts; old background requests correctly lose access.
    // Track the import flow after the new account and project have settled.
    await page.waitForLoadState('networkidle');
    const failures = trackFailedApiCalls(page);
    const labels = entryPoint !== 'publish' ? frenchCrops : germanCrops;
    if (entryPoint !== 'publish') {
      await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: 'fr' });
      await page.evaluate(() => localStorage.setItem('ui.language', 'fr'));
      if (entryPoint === 'resolve-browser') {
        await page.goto(`/app/crops?cropId=${local.id}`);
        await page.getByRole('button', { name: frenchNavigation.cropActions.openImportExport, exact: true }).click();
        await page.getByRole('menuitem', { name: labels.library.openButton, exact: true }).click();
        const browser = page.getByRole('dialog', { name: labels.library.dialogTitle, exact: true });
        await browser.getByRole('textbox').fill(species.name);
        await browser.getByRole('button', { name: labels.filters.openAdvanced, exact: true }).click();
        await page.getByLabel(labels.filters.growthDaysMin, { exact: true }).fill('1');
        await page.keyboard.press('Escape');
        await browser.getByRole('option', { name: species.name, exact: true }).click();
        await browser.getByRole('button', { name: labels.library.importButton, exact: true }).click();
      } else {
        await page.goto(`/app/crop-library?cropId=${published.public_crop.id}`);
        if (resolvesDifferences) await page.getByRole('textbox').first().fill(species.name);
        await page.getByRole('button', { name: labels.library.importButton }).first().click();
      }
      await page.getByRole('combobox', { name: labels.library.linkExisting.localTarget }).click();
      await page.getByRole('option', { name: species.name, exact: true }).click();
      if (entryPoint === 'copy') await page.getByRole('radio', { name: labels.library.importDecision.copy, exact: true }).click();
      else await expect(page.getByRole('radio', { name: labels.library.importDecision.link, exact: true })).toBeChecked();
    } else {
      await page.goto(`/app/crops?cropId=${local.id}`);
      await page.getByTestId('crop-detail-publish-action').click();
      await page.getByRole('combobox', { name: 'Eintrag der Kulturbibliothek' }).click();
      await page.getByRole('option', { name: species.name, exact: true }).click();
      await page.getByRole('button', { name: 'Mit vorhandenem Eintrag verknüpfen', exact: true }).click();
    }
    const confirm = page.getByRole('button', { name: entryPoint === 'publish' ? labels.library.linkExisting.confirm : entryPoint === 'copy' ? labels.library.importDecision.copy : labels.library.importDecision.link });
    await expect(confirm).toBeEnabled();
    const localChoice = page.getByTestId('public-crop-sync-row-notes').getByRole('radio', { name: entryPoint === 'copy' ? labels.library.linkExisting.keepLocal : labels.library.sync.chooseLocal });
    await localChoice.focus();
    await localChoice.press('Space');
    await expect(localChoice).toBeChecked();
    if (entryPoint === 'copy') {
      const choose = async (field: string, label: string) => {
        const option = page.getByTestId(`public-crop-sync-row-${field}`).getByRole('radio', { name: label, exact: true });
        await option.focus();
        await option.press('Space');
        return option;
      };
      await page.getByRole('radio', { name: labels.library.importDecision.link, exact: true }).click();
      const pinGrowth = await choose('growth_duration_days', labels.library.sync.chooseLocal);
      const pinNotes = await choose('notes', labels.library.sync.chooseLocal);
      await page.getByRole('radio', { name: labels.library.importDecision.copy, exact: true }).click();
      await choose('harvest_duration_days', labels.library.linkExisting.keepLocal);
      await page.getByRole('radio', { name: labels.library.importDecision.link, exact: true }).click();
      await expect(pinGrowth).toBeChecked();
      await expect(pinNotes).toBeChecked();
      await page.getByRole('radio', { name: labels.library.importDecision.copy, exact: true }).click();
      await choose('growth_duration_days', labels.library.linkExisting.takeLibrary);
    }
    if (resolvesDifferences) {
      await expect(page.getByTestId('public-crop-sync-row-germination_types')).toHaveCount(0);
      await expect(page.getByTestId('public-crop-sync-row-germination_temperature_requirement')).toContainText(labels.germination.fields.germination_temperature_requirement);
      await expect(page.getByTestId('public-crop-sync-row-germination_light_requirement')).toContainText(labels.germination.fields.germination_light_requirement);
      const privateRequirement = page.getByTestId('public-crop-sync-row-germination_temperature_requirement').getByRole('radio', { name: labels.library.sync.chooseLocal, exact: true });
      await privateRequirement.focus();
      await privateRequirement.press('Space');
      await expect(privateRequirement).toBeChecked();
      const share = page.getByTestId('public-crop-sync-row-harvest_duration_days').getByRole('radio', { name: labels.library.sync.chooseMine, exact: true });
      await share.focus();
      await share.press('Space');
      await expect(share).toBeChecked();
      await expect(confirm).toBeDisabled();
      await page.getByRole('checkbox', { name: labels.library.publishConfirm.acceptLicense, exact: true }).check();
      await expect(confirm).toBeEnabled();
    }
    for (const viewport of [{ width: 375, height: 800 }, { width: 768, height: 900 },
      { width: 1024, height: 900 }, { width: 1440, height: 900 }, { width: 800, height: 375 }]) {
      await page.setViewportSize(viewport);
      const dialog = page.getByRole('dialog');
      const bounds = await dialog.boundingBox();
      expect(bounds?.x).toBeGreaterThanOrEqual(0);
      expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
      const localOption = page.getByTestId('public-crop-sync-row-notes').locator(entryPoint === 'copy' ? '[data-choice="mine"]' : '[data-choice="local"]');
      await localOption.scrollIntoViewIfNeeded();
      await expect(localOption).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath(`${entryPoint}-${viewport.width}.png`) });
    }
    if (resolvesDifferences) {
      for (const viewport of [{ width: 375, height: 800 }, { width: 800, height: 375 }]) {
        await page.setViewportSize(viewport);
        await page.getByTestId('public-crop-sync-row-germination_temperature_requirement').scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`${entryPoint}-germination-${viewport.width}.png`) });
      }
    }
    await confirm.click();
    await expect(confirm).not.toBeVisible();
    if (resolvesDifferences) {
      await expect(page.getByRole('button', { name: labels.library.linkExisting.alreadyLinked, exact: true })).toBeDisabled();
      await page.setViewportSize({ width: 1440, height: 900 });
      if (entryPoint === 'resolve-browser') {
        const browser = page.getByRole('dialog', { name: labels.library.dialogTitle, exact: true });
        await expect(browser).toBeVisible();
        await expect(browser.getByRole('textbox')).toHaveValue(species.name);
        await browser.getByRole('button', { name: labels.filters.openAdvanced, exact: true }).click();
        await expect(page.getByLabel(labels.filters.growthDaysMin, { exact: true })).toHaveValue('1');
        await page.keyboard.press('Escape');
        await browser.getByRole('option', { name: species.name, exact: true }).click();
      } else {
        await expect(page.getByRole('textbox').first()).toHaveValue(species.name);
        await page.getByRole('option', { name: species.name, exact: true }).click();
      }
      await expect(page.getByRole('button', { name: labels.library.linkExisting.alreadyLinked, exact: true })).toBeDisabled();
      for (const viewport of [{ width: 375, height: 800 }, { width: 768, height: 900 },
        { width: 1024, height: 900 }, { width: 1440, height: 900 }, { width: 800, height: 375 }]) {
        await page.setViewportSize(viewport);
        await expect(page.getByRole('button', { name: labels.library.linkExisting.alreadyLinked, exact: true })).toBeDisabled();
        await page.screenshot({ path: testInfo.outputPath(`${entryPoint}-linked-${viewport.width}.png`) });
      }
      await page.goto(`/app/crops?cropId=${local.id}`);
      await expect(page.getByTestId('crop-detail-library-status')).toContainText(labels.library.publicUpdate.markerUpToDateLabel);
      await page.reload();
      await expect(page.getByTestId('crop-detail-library-status')).toContainText(labels.library.publicUpdate.markerUpToDateLabel);
    }
    const linked = await apiRequest<{ id: number; source_public_crop: number | null; growth_duration_days: number; harvest_duration_days: number; notes: string; library_pinned_fields: string[]; germination_temperature_requirement: string; germination_light_requirement: string }>(page, 'GET', `/crops/${local.id}/`);
    expect(linked.id).toBe(local.id);
    expect(linked.source_public_crop).toBe(entryPoint === 'copy' ? null : published.public_crop.id);
    expect(linked.notes).toBe('Private synthetic note');
    expect(linked.growth_duration_days).toBe(80);
    expect(linked.harvest_duration_days).toBe(entryPoint === 'copy' || resolvesDifferences ? 30 : 20);
    if (entryPoint === 'copy') expect(linked.library_pinned_fields).toEqual([]);
    else expect(linked.library_pinned_fields).toContain('notes');
    if (resolvesDifferences) {
      expect(linked.library_pinned_fields).toContain('germination_temperature_requirement');
      expect(linked.germination_temperature_requirement).toBe('frost_treatment');
      expect(linked.germination_light_requirement).toBe('light');
    }
    const savedRows = await apiRequest<{ results: (CropRow & { crop_species: number; source_public_crop: number | null })[] }>(page, 'GET', '/crops/?page_size=500');
    const group = savedRows.results.filter(crop => crop.crop_species === species.id);
    expect(group).toHaveLength(13);
    expect(group.filter(crop => crop.variety).map(crop => crop.id).sort()).toEqual(varieties.map(crop => crop.id).sort());
    expect(group.filter(crop => crop.variety).every(crop => crop.source_public_crop === null)).toBe(true);
    const preservedPlan = await apiRequest<{ crop: number }>(page, 'GET', `/planting-plans/${plan.id}/`);
    expect(preservedPlan.crop).toBe(variety.id);
    const entry = await apiRequest<{ notes: string; harvest_duration_days: number; germination_temperature_requirement: string; project_import_status: { is_up_to_date: boolean } }>(page, 'GET', `/public-crops/${published.public_crop.id}/`);
    expect(entry.notes).not.toContain('Private synthetic note');
    expect(entry.harvest_duration_days).toBe(resolvesDifferences ? 30 : 20);
    if (resolvesDifferences) {
      expect(entry.germination_temperature_requirement).toBe('cold_stratification');
      expect(entry.project_import_status.is_up_to_date).toBe(true);
      await apiRequest(page, 'PATCH', `/crops/${local.id}/`, { growth_duration_days: 81 });
      await page.reload();
      await expect(page.getByTestId('crop-detail-publish-action')).toBeVisible();
    }
    expect(failures).toEqual([]);
  });
}

for (const { width, surface } of [{ width: 375, surface: 'dialog' }, { width: 1440, surface: 'page' }] as const) {
  test(`new library varieties import and link directly in the ${surface} at ${width}px`, async ({ page, request }) => {
    await loginWithDeterministicProject(page, request, `library-new-source-${width}-${Date.now()}`, { loginAsAdmin: true, libraryModerator: true });
    const [species] = await listSpecies(page, 1);
    const source = await publishVariety(page, species, `New direct ${width} ${Date.now()}`);
    await apiRequest(page, 'POST', '/auth/logout/', {});
    await loginWithDeterministicProject(page, request, `library-new-target-${width}-${Date.now()}`, { loginAsAdmin: true });
    await page.setViewportSize({ width, height: width === 375 ? 800 : 900 });
    await page.goto(surface === 'page' ? `/app/crop-library?cropId=${source.publicCropId}` : '/app/crops?library=true');
    const browser = surface === 'dialog'
      ? page.getByRole('dialog', { name: germanCrops.library.dialogTitle }) : page;
    const search = browser.getByLabel(germanCrops.library.searchLabel, { exact: true });
    await search.fill(source.crop.variety);
    if (surface === 'dialog') await browser.getByRole('option', { name: new RegExp(source.crop.variety) }).click();
    await browser.getByRole('button', { name: germanCrops.filters.openAdvanced, exact: true }).click();
    await page.getByLabel(germanCrops.filters.growthDaysMin, { exact: true }).fill('1');
    await page.keyboard.press('Escape');
    let imports = 0;
    page.on('request', req => {
      if (req.method() === 'POST' && req.url().endsWith(`/public-crops/${source.publicCropId}/import/`)) imports++;
    });
    await browser.getByRole('button', { name: germanCrops.library.importButton, exact: true }).first().dblclick();
    await expect(browser.getByRole('button', { name: germanCrops.library.linkExisting.alreadyLinked, exact: true }).first()).toBeDisabled();
    await expect(search).toHaveValue(source.crop.variety);
    await browser.getByRole('button', { name: germanCrops.filters.openAdvanced, exact: true }).click();
    await expect(page.getByLabel(germanCrops.filters.growthDaysMin, { exact: true })).toHaveValue('1');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: germanCrops.library.importDecision.title })).toHaveCount(0);
    expect(imports).toBe(1);
    const after = await apiRequest<{ results: { crop_species: number; source_public_crop: number | null; derived_from_public_crop: number | null }[] }>(page, 'GET', '/crops/?page_size=500');
    const group = after.results.filter(crop => crop.crop_species === species.id);
    expect(group).toHaveLength(2);
    expect(group.every(crop => crop.source_public_crop !== null)).toBe(true);
    expect(group.every(crop => crop.derived_from_public_crop !== null)).toBe(true);
    if (surface === 'page') {
      await browser.getByRole('button', { name: germanCrops.filters.openAdvanced, exact: true }).click();
      await page.getByLabel(germanCrops.filters.growthDaysMin, { exact: true }).fill('');
      await page.keyboard.press('Escape');
      await search.fill('');
      await browser.getByRole('option', { name: species.name, exact: true }).click();
      await expect(browser.getByRole('button', { name: germanCrops.library.linkExisting.alreadyLinked, exact: true }).first()).toBeDisabled();
      await expect(page.getByRole('dialog', { name: germanCrops.library.importDecision.title })).toHaveCount(0);
    }
  });
}

test('a project change rejects a pending direct library import', async ({ page, request }) => {
  await loginWithDeterministicProject(page, request, `library-guard-source-${Date.now()}`, { loginAsAdmin: true, libraryModerator: true });
  const [species] = await listSpecies(page, 1);
  const source = await publishVariety(page, species, `Project guard ${Date.now()}`);
  await apiRequest(page, 'POST', '/auth/logout/', {});
  await loginWithDeterministicProject(page, request, `library-guard-target-${Date.now()}`, { loginAsAdmin: true });
  const intendedProject = await page.evaluate(() => localStorage.getItem('activeProjectId'));
  const other = await apiRequest<{ id: number }>(page, 'POST', '/projects/', { name: 'Other guarded project' });
  await apiRequest(page, 'POST', '/projects-switch/', { project_id: Number(intendedProject) });
  const before = await apiRequest<{ count: number }>(page, 'GET', '/crops/');
  await page.goto(`/app/crop-library?cropId=${source.publicCropId}`);
  // The request header can change after the action captured its active project.
  await page.route(`**/public-crops/${source.publicCropId}/import/`, route => route.continue({
    headers: { ...route.request().headers(), 'x-project-id': String(other.id) },
  }));
  await page.getByRole('button', { name: germanCrops.library.importButton, exact: true }).first().click();
  await expect(page.getByText(germanCrops.library.importProjectChanged)).toBeVisible();
  await expect(page.getByRole('dialog', { name: germanCrops.library.importDecision.title })).toHaveCount(0);
  const otherCrops = await page.request.get('/api/crops/', { headers: { 'X-Project-Id': String(other.id) } });
  expect(otherCrops.ok()).toBe(true);
  expect((await otherCrops.json()).count).toBe(0);
  expect((await apiRequest<{ count: number }>(page, 'GET', '/crops/')).count).toBe(before.count);
});


for (const surface of ['page', 'dialog'] as const) {
  test(`Carrot imports with one click from the ${surface}, unlinks without deletion, and then offers comparison`, async ({ page, request }) => {
    const scenario = `direct-carrot-${surface}-${Date.now()}`;
    const sourceScenario = `direct-carrot-source-${surface}-${Date.now()}`;
    try {
      await loginWithDeterministicProject(page, request, sourceScenario, { loginAsAdmin: true, libraryModerator: true });
      const entry = await prepareCarrotEntry(page);
      await apiRequest(page, 'POST', '/auth/logout/', {});
      await loginWithDeterministicProject(page, request, scenario, { loginAsAdmin: true });
      await page.setViewportSize({ width: surface === 'page' ? 375 : 1440, height: surface === 'page' ? 800 : 900 });
      const before = await apiRequest<{ results: (CropRow & { crop_species: number })[] }>(page, 'GET', '/crops/?page_size=500');
      expect(before.results.filter(crop => crop.crop_species === entry.crop_species)).toHaveLength(0);
      if (surface === 'page') {
        await page.goto(`/app/crop-library?cropId=${entry.id}`);
      } else {
        await page.goto('/app/crops?library=true');
      }
      const browser = surface === 'dialog'
        ? page.getByRole('dialog', { name: germanCrops.library.dialogTitle }) : page;
      const search = browser.getByLabel(germanCrops.library.searchLabel, { exact: true });
      if (surface === 'page') await page.getByRole('button', { name: germanCrops.selectCrop, exact: true }).click();
      await search.fill(entry.name);
      await browser.getByRole('option', { name: entry.name, exact: true }).click();
      await browser.getByRole('button', { name: germanCrops.library.importButton, exact: true }).first().click();
      await expect(browser.getByRole('button', { name: germanCrops.library.linkExisting.alreadyLinked, exact: true }).first()).toBeDisabled();
      if (surface === 'page') await page.getByRole('button', { name: germanCrops.selectCrop, exact: true }).click();
      await expect(search).toHaveValue(entry.name);
      if (surface === 'page') await page.getByRole('dialog', { name: germanCrops.selectCrop }).press('Escape');
      await expect(page.getByRole('dialog', { name: germanCrops.library.importDecision.title })).toHaveCount(0);
      if (surface === 'dialog') await expect(browser).toBeVisible();
      const imported = await apiRequest<{ results: (CropRow & { crop_species: number; source_public_crop: number | null })[] }>(page, 'GET', '/crops/?page_size=500');
      const rows = imported.results.filter(crop => crop.crop_species === entry.crop_species && !crop.variety);
      expect(rows).toHaveLength(1);
      expect(rows[0].source_public_crop).toBe(entry.id);
      const cropId = rows[0].id;
      const unchanged = await apiRequest<typeof entry>(page, 'GET', `/public-crops/${entry.id}/`);
      expect([unchanged.version, unchanged.notes, unchanged.growth_duration_days]).toEqual([
        entry.version, entry.notes, entry.growth_duration_days,
      ]);
      if (surface === 'dialog') await browser.getByRole('button', { name: germanCrops.form.cancel, exact: true }).click();
      await page.goto(`/app/crops?cropId=${cropId}`);
      await page.getByRole('button', { name: 'Weitere Aktionen', exact: true }).first().click();
      await page.getByRole('menuitem', { name: 'Verknüpfung aufheben', exact: true }).click();
      const unlink = page.getByRole('dialog', { name: 'Verknüpfung aufheben?' });
      await unlink.getByRole('button', { name: 'Verknüpfung aufheben', exact: true }).click();
      await expect(unlink).toBeHidden();
      const retained = await apiRequest<CropRow & { source_public_crop: number | null }>(page, 'GET', `/crops/${cropId}/`);
      expect(retained.id).toBe(cropId);
      expect(retained.source_public_crop).toBeNull();
      await page.goto(`/app/crop-library?cropId=${entry.id}`);
      await page.getByRole('button', { name: germanCrops.library.importButton, exact: true }).first().click();
      const comparison = page.getByRole('dialog', { name: germanCrops.library.importDecision.title });
      await expect(comparison.getByRole('radio', { name: germanCrops.library.importDecision.link, exact: true })).toBeChecked();
      await expect(comparison.getByRole('radio', { name: germanCrops.library.importDecision.copy, exact: true })).not.toBeChecked();
      await comparison.press('Escape');
      const stillUnlinked = await apiRequest<CropRow & { source_public_crop: number | null }>(page, 'GET', `/crops/${cropId}/`);
      expect(stillUnlinked.source_public_crop).toBeNull();
    } finally {
      if (!page.isClosed()) await page.goto('about:blank').catch(() => undefined);
      await resetE2EScenario(request, scenario);
      await resetE2EScenario(request, sourceScenario);
    }
  });
}
