import germanCrops from '../src/i18n/locales/de/crops.json' with { type: 'json' };
import frenchCrops from '../src/i18n/locales/fr/crops.json' with { type: 'json' };
import frenchNavigation from '../src/i18n/locales/fr/navigation.json' with { type: 'json' };
import { expect, test, type Page } from '@playwright/test';
import { apiRequest, expectNoHorizontalPageOverflow, loginWithDeterministicProject, resetE2EScenario, waitForPageStable } from './utils';

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

  const field = dialog.getByRole('combobox', { name: /Offizielle Kulturart/i });
  await field.click();
  await field.fill(first.name);
  await page.getByRole('option', { name: new RegExp(first.name) }).first().click();
  await dialog.getByRole('button', { name: 'Kulturart ändern' }).click();

  await expect(dialog.getByRole('alert')).toContainText(
    'Unter dieser Kulturart gibt es bereits einen veröffentlichten Eintrag mit dieser Sorte.',
  );
  await expect(dialog).toBeVisible();
});

for (const entryPoint of ['publish', 'import', 'copy', 'resolve', 'resolve-browser', 'unclassified-picker', 'unclassified-page'] as const) {
  test(`existing culture imports through ${entryPoint} without replacing IDs or publishing local notes`, async ({ page, request }, testInfo) => {
    const unclassified = entryPoint.startsWith('unclassified-');
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
      name: species.name, variety: '', ...(unclassified ? {} : { crop_species: species.id }),
      growth_duration_days: 90, harvest_duration_days: entryPoint === 'copy' || resolvesDifferences ? 30 : 20, notes: 'Private synthetic note',
      ...(resolvesDifferences ? { germination_temperature_requirement: 'frost_treatment', germination_light_requirement: 'dark' } : {}),
    });
    if (unclassified) expect((await apiRequest<{ crop_species: number | null }>(page, 'GET', `/crops/${local.id}/`)).crop_species).toBeNull();
    const varieties: CropRow[] = [];
    for (let index = 0; index < 12; index++) varieties.push(await apiRequest<CropRow>(page, 'POST', '/crops/', {
      name: species.name, variety: `Synthetic Roma ${index}`, ...(unclassified ? {} : { crop_species: species.id }),
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
      if (entryPoint === 'resolve-browser' || entryPoint === 'unclassified-picker') {
        await page.goto(`/app/crops?cropId=${local.id}`);
        await waitForPageStable(page);
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
      if (unclassified) await expect(page.getByRole('button', { name: labels.library.importDecision.link, exact: true })).toBeDisabled();
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

test.describe('direct linked library imports', () => {
  // Service workers bypass page routes; these cases control refresh failures.
  test.use({ serviceWorkers: 'block' });
  for (const { width, surface } of [{ width: 375, surface: 'dialog' }, { width: 1440, surface: 'page' }] as const) {
    test(`new library varieties import and link directly in the ${surface} at ${width}px`, async ({ page, request }, testInfo) => {
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
      if (surface === 'page') {
        await page.waitForLoadState('networkidle');
        let failedRefreshes = 0;
        await page.route('**/api/public-crops/**', route => {
          if (route.request().method() === 'GET'
            && new URL(route.request().url()).pathname.endsWith('/public-crops/')
            && failedRefreshes++ < 2) {
            return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
          }
          return route.continue();
        });
      }
      let imports = 0;
      page.on('request', req => {
        if (req.method() === 'POST' && req.url().endsWith(`/public-crops/${source.publicCropId}/import/`)) imports++;
      });
      await browser.getByRole('button', { name: germanCrops.library.importButton, exact: true }).first().dblclick();
      await expect(browser.getByRole('button', { name: germanCrops.library.linkExisting.alreadyLinked, exact: true }).first()).toBeDisabled();
      if (surface === 'page') {
        const refreshError = page.getByText(germanCrops.library.loadError, { exact: true });
        await expect(refreshError).toBeVisible();
        await expect(search).toHaveValue(source.crop.variety);
        await page.screenshot({ path: testInfo.outputPath('import-refresh-error-desktop.png'), animations: 'disabled' });
        await page.setViewportSize({ width: 375, height: 800 });
        await expect(refreshError).toBeVisible();
        await expect(page.getByRole('button', { name: germanCrops.library.linkExisting.alreadyLinked, exact: true }).first()).toBeDisabled();
        await page.screenshot({ path: testInfo.outputPath('import-refresh-error-mobile.png'), animations: 'disabled' });
        await page.setViewportSize({ width, height: 900 });
        for (const status of [503, 200]) {
          await Promise.all([
            page.waitForResponse(response => response.request().method() === 'GET'
              && new URL(response.url()).pathname.endsWith('/public-crops/') && response.status() === status),
            page.getByRole('button', { name: 'Erneut versuchen', exact: true }).click(),
          ]);
          await expect(browser.getByRole('button', { name: germanCrops.library.linkExisting.alreadyLinked, exact: true }).first()).toBeDisabled();
          await expect(search).toHaveValue(source.crop.variety);
        }
        await expect(refreshError).toHaveCount(0);
      }
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

});

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

for (const width of [375, 1440]) {
  test(`library sync name conflicts preserve decisions and rows until explicit correction at ${width}px`, async ({ page, request }, testInfo) => {
    test.setTimeout(120_000);
    const scenario = `library-name-conflict-${width}-${Date.now()}`;
    await page.setViewportSize({ width, height: width === 375 ? 800 : 900 });
    try {
      await loginWithDeterministicProject(page, request, `${scenario}-source`, { loginAsAdmin: true });
      const entry = await prepareCarrotEntry(page);
      await apiRequest(page, 'POST', '/auth/logout/', {});
      await loginWithDeterministicProject(page, request, scenario, { loginAsAdmin: true });
      const manual = await apiRequest<CropRow>(page, 'POST', '/crops/', {
        name: entry.name, notes: 'Private manual culture kept intact', growth_duration_days: 95,
        cultivation_type: 'direct_sowing', cultivation_types: ['direct_sowing'],
      });
      const projectId = await page.evaluate(() => Number(localStorage.getItem('activeProjectId')));
      const imported = await apiRequest<{ crop: CropRow }>(page, 'POST', `/public-crops/${entry.id}/import/`, {
        mode: 'new', link_to_library: true, base_version: entry.version, expected_project_id: projectId,
      });
      expect(imported.crop.id).not.toBe(manual.id);
      expect(imported.crop.name).toBe(`${entry.name} (2)`);
      type State = CropRow & { crop_species: number | null; source_public_crop: number | null; source_public_version: number | null; library_pinned_fields: string[]; notes: string; growth_duration_days: number | null; updated_at: string };
      const original = await apiRequest<State>(page, 'GET', `/crops/${manual.id}/`);
      const copy = await apiRequest<State>(page, 'GET', `/crops/${imported.crop.id}/`);
      await page.goto(`/app/crops?cropId=${copy.id}`);
      await page.getByTestId('crop-detail-publish-action').click();
      const dialog = page.getByRole('dialog', { name: germanCrops.library.sync.dialogTitle });
      await dialog.getByRole('button', { name: 'Alle aus Bibliothek', exact: true }).click();
      const selections = () => dialog.locator('input[type="radio"]').evaluateAll(nodes =>
        nodes.map(node => ({ value: (node as HTMLInputElement).value, checked: (node as HTMLInputElement).checked })));
      const choices = await selections();
      const rejected = page.waitForResponse(response => response.request().method() === 'POST'
        && response.url().endsWith(`/crops/${copy.id}/public-sync/`));
      await dialog.getByRole('button', { name: 'Abgleichen', exact: true }).click();
      const failure = await rejected;
      expect(failure.status()).toBe(409);
      expect((await failure.json()).code).toBe('crop_name_conflict');
      await expect(dialog.getByText(germanCrops.form.cropNameConflict)).toBeVisible();
      expect(await selections()).toEqual(choices);
      const unchanged = (row: State) => ({ id: row.id, name: row.name, variety: row.variety,
        crop_species: row.crop_species, source: row.source_public_crop, version: row.source_public_version,
        pins: row.library_pinned_fields, notes: row.notes, growth: row.growth_duration_days, updated: row.updated_at });
      expect(unchanged(await apiRequest<State>(page, 'GET', `/crops/${manual.id}/`))).toEqual(unchanged(original));
      expect(unchanged(await apiRequest<State>(page, 'GET', `/crops/${copy.id}/`))).toEqual(unchanged(copy));
      await expect(dialog.getByRole('button', { name: 'Abbrechen', exact: true })).toBeInViewport();
      await expectNoHorizontalPageOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`library-sync-name-conflict-${width}.png`), animations: 'disabled' });
      await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
      await expect(dialog).not.toBeVisible();
      // An explicit local correction, representing a separate deliberate edit.
      await apiRequest(page, 'PATCH', `/crops/${manual.id}/`, { name: `Synthetic corrected manual ${scenario}` });
      await page.goto(`/app/crops?cropId=${copy.id}`);
      await page.getByTestId('crop-detail-publish-action').click();
      await dialog.getByRole('button', { name: 'Alle aus Bibliothek', exact: true }).click();
      await dialog.getByRole('button', { name: 'Abgleichen', exact: true }).click();
      await expect(dialog).not.toBeVisible();
      const resolved = await apiRequest<State>(page, 'GET', `/crops/${copy.id}/`);
      expect(resolved.id).toBe(copy.id);
      expect(resolved.name).toBe(entry.name);
      expect(resolved.source_public_crop).toBe(entry.id);
      const retained = await apiRequest<State>(page, 'GET', `/crops/${manual.id}/`);
      expect(retained.id).toBe(manual.id);
      expect(retained.notes).toBe(original.notes);
      expect(retained.source_public_crop).toBeNull();
    } finally {
      await resetE2EScenario(request, scenario);
      await resetE2EScenario(request, `${scenario}-source`);
    }
  });
}

async function prepareSelectedVarietyParent(page: Page, scenario: string): Promise<CarrotEntry> {
  const name = `Synthetic Carrot ${scenario}`;
  const translations = ['de', 'en', 'fr', 'es', 'it', 'pt', 'nl'].map(language_code => ({ language_code, common_name: name }));
  const species = await apiRequest<CropSpecies>(page, 'POST', '/crop-species/', { name, translations });
  await apiRequest(page, 'POST', `/crop-species/${species.id}/approve/`, { translations });
  const crop = await apiRequest<CropRow>(page, 'POST', '/crops/', {
    name, crop_species: species.id, variety: '', growth_duration_days: 78,
    harvest_duration_days: 21, notes: 'Isolated synthetic selection fixture',
  });
  const published = await apiRequest<PublishResponse>(page, 'POST', `/crops/${crop.id}/publish-public/`, {
    accepted_public_library_terms: true, crop_species_id: species.id,
    publish_as_general: true, original_language_code: 'de',
  });
  return apiRequest<CarrotEntry>(page, 'GET', `/public-crops/${published.public_crop.id}/`);
}

test.describe('selected library varieties', () => {
  test.use({ serviceWorkers: 'block' });
  for (const { width, surface } of [{ width: 375, surface: 'dialog' }, { width: 1440, surface: 'page' }] as const) {
    test(`selected varieties import atomically and complete existing links in the ${surface} at ${width}px`, async ({ page, request }, testInfo) => {
      const scenario = `selected-varieties-${surface}-${Date.now()}`;
      await loginWithDeterministicProject(page, request, `${scenario}-source`, { loginAsAdmin: true, libraryModerator: true });
      const parent = await prepareSelectedVarietyParent(page, scenario);
      const species = { id: parent.crop_species, name: parent.name };
      const published = [];
      for (const name of ['Nantaise 2', 'Nantaise 2-Milan', 'Rodelika']) {
        published.push(await publishVariety(page, species, `${name} ${scenario}`));
      }
      await apiRequest(page, 'POST', '/auth/logout/', {});
      await loginWithDeterministicProject(page, request, scenario, { loginAsAdmin: true });
      try {
        await page.setViewportSize({ width, height: width === 375 ? 800 : 900 });
        await page.goto(surface === 'page' ? `/app/crop-library?cropId=${parent.id}` : '/app/crops?library=true');
        const browser = surface === 'dialog' ? page.getByRole('dialog', { name: germanCrops.library.dialogTitle }) : page;
        const search = browser.getByLabel(germanCrops.library.searchLabel, { exact: true });
        await search.fill(parent.name);
        if (surface === 'dialog') await browser.getByRole('option', { name: parent.name, exact: true }).click();
        await browser.getByRole('button', { name: germanCrops.library.importButton, exact: true }).first().click();
        const selector = page.getByRole('dialog', { name: germanCrops.library.varietyImport.title });
        await expect(selector.getByRole('checkbox', { name: published[2].crop.variety, exact: true })).toBeChecked();
        await selector.getByRole('button', { name: 'Abbrechen', exact: true }).click();
        expect((await apiRequest<{ results: CropRow[] }>(page, 'GET', '/crops/?page_size=500')).results).toHaveLength(0);
        await browser.getByRole('button', { name: germanCrops.library.importButton, exact: true }).first().click();
        const selectAll = selector.getByRole('checkbox').first();
        await selectAll.uncheck();
        for (const child of published.slice(0, 2)) await selector.getByRole('checkbox', { name: child.crop.variety, exact: true }).check();
        for (const viewport of [{ width: 375, height: 800 }, { width: 768, height: 900 }, { width: 1024, height: 900 }, { width: 1440, height: 900 }, { width: 800, height: 375 }]) {
          await page.setViewportSize(viewport);
          await page.mouse.move(0, 0);
          await expect(page.getByRole('tooltip')).toHaveCount(0);
          await expect(selector.getByRole('button', { name: 'Kultur und 2 Sorten importieren', exact: true })).toBeInViewport();
          await expectNoHorizontalPageOverflow(page);
          await page.screenshot({ path: testInfo.outputPath(`variety-selector-${viewport.width}-${viewport.height}.png`), animations: 'disabled' });
        }
        await page.setViewportSize({ width, height: width === 375 ? 800 : 900 });
        // A rejected request saves nothing and preserves the scope for retry.
        let attempts = 0;
        await page.route(`**/api/public-crops/${parent.id}/import-selection/`, route => {
          if (attempts++ === 0) return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
          return route.continue();
        });
        await selector.getByRole('button', { name: 'Kultur und 2 Sorten importieren', exact: true }).click();
        await expect(selector.getByText(germanCrops.library.varietyImport.failed, { exact: true })).toBeVisible();
        expect((await apiRequest<{ results: CropRow[] }>(page, 'GET', '/crops/?page_size=500')).results).toHaveLength(0);
        await selector.getByRole('button', { name: 'Kultur und 2 Sorten importieren', exact: true }).click();
        await expect(selector).not.toBeVisible();
        await expect(search).toHaveValue(parent.name);
        interface LinkedCrop extends CropRow { source_public_crop: number | null; updated_at: string; notes: string; growth_duration_days: number | null }
        const first = (await apiRequest<{ results: LinkedCrop[] }>(page, 'GET', '/crops/?page_size=500')).results;
        expect(first).toHaveLength(3);
        const general = first.find(row => row.source_public_crop === parent.id)!;
        expect(first.filter(row => row.source_public_crop !== parent.id).map(row => row.source_public_crop).sort()).toEqual(published.slice(0, 2).map(row => row.publicCropId).sort());
        // The last missing variety already exists privately and must keep its ID and plan.
        const local = await apiRequest<LinkedCrop>(page, 'POST', '/crops/', { name: parent.name, crop_species: species.id,
          variety: published[2].crop.variety, notes: 'Private selected variety note', growth_duration_days: 105 });
        const season = await apiRequest<{ id: number }>(page, 'POST', '/seasons/', { start_date: '2026-01-01', end_date: '2026-12-31' });
        const plan = await apiRequest<{ id: number; crop: number }>(page, 'POST', '/planting-plans/', {
          season: season.id, crop: local.id, planting_date: '2026-05-15', cultivation_type: 'direct_sowing', quantity: 8 });
        await browser.getByRole('button', { name: germanCrops.library.varietyImport.action, exact: true }).click();
        await expect(selector.getByText(germanCrops.library.varietyImport.parentLinked, { exact: true })).toBeVisible();
        await expect(selector.getByRole('checkbox', { name: new RegExp(published[0].crop.variety) })).toBeDisabled();
        await selector.getByRole('checkbox').first().uncheck();
        await selector.getByRole('checkbox', { name: published[2].crop.variety, exact: true }).check();
        await selector.getByRole('button', { name: '1 Sorte importieren', exact: true }).click();
        const comparison = page.getByRole('dialog', { name: germanCrops.library.importDecision.title });
        await expect(comparison).toBeVisible();
        await comparison.getByRole('button', { name: 'Abbrechen', exact: true }).click();
        expect((await apiRequest<LinkedCrop>(page, 'GET', `/crops/${local.id}/`)).source_public_crop).toBeNull();
        await browser.getByRole('button', { name: germanCrops.library.varietyImport.action, exact: true }).click();
        await selector.getByRole('checkbox').first().uncheck();
        await selector.getByRole('checkbox', { name: published[2].crop.variety, exact: true }).check();
        await selector.getByRole('button', { name: '1 Sorte importieren', exact: true }).click();
        await comparison.getByRole('button', { name: 'Alle nur lokal', exact: true }).click();
        await comparison.getByRole('button', { name: germanCrops.library.varietyImport.continue, exact: true }).click();
        await expect(comparison).not.toBeVisible();
        const after = (await apiRequest<{ results: LinkedCrop[] }>(page, 'GET', '/crops/?page_size=500')).results;
        expect(after).toHaveLength(4);
        const kept = after.find(row => row.id === local.id)!;
        expect(kept.source_public_crop).toBe(published[2].publicCropId);
        expect(kept.notes).toBe(local.notes); expect(kept.growth_duration_days).toBe(105);
        expect(after.find(row => row.id === general.id)?.updated_at).toBe(general.updated_at);
        expect((await apiRequest<{ crop: number }>(page, 'GET', `/planting-plans/${plan.id}/`)).crop).toBe(local.id);
        await expect(search).toHaveValue(parent.name);
      } finally {
        await resetE2EScenario(request, scenario);
        await resetE2EScenario(request, `${scenario}-source`);
      }
    });
  }
});

test('the variety selector supports French labels, keyboard selection and cancellation on a phone', async ({ page, request }, testInfo) => {
  const scenario = `selected-varieties-fr-${Date.now()}`;
  await loginWithDeterministicProject(page, request, `${scenario}-source`, { loginAsAdmin: true, libraryModerator: true });
  const parent = await prepareSelectedVarietyParent(page, scenario);
  const child = await publishVariety(page, { id: parent.crop_species, name: parent.name }, `Synthetic phone variety ${scenario}`);
  await apiRequest(page, 'POST', '/auth/logout/', {});
  await loginWithDeterministicProject(page, request, scenario, { loginAsAdmin: true });
  try {
    await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: 'fr' });
    await page.evaluate(() => localStorage.setItem('ui.language', 'fr'));
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`/app/crop-library?cropId=${parent.id}`);
    await page.getByRole('button', { name: frenchCrops.library.importButton, exact: true }).first().click();
    const selector = page.getByRole('dialog', { name: frenchCrops.library.varietyImport.title });
    const all = selector.getByRole('checkbox').first();
    await all.uncheck();
    const checkbox = selector.getByRole('checkbox', { name: child.crop.variety, exact: true });
    await checkbox.focus(); await page.keyboard.press('Space');
    await expect(checkbox).toBeChecked();
    await expect(selector.getByRole('button', { name: 'Importer la culture et 1 variété', exact: true })).toBeVisible();
    for (const viewport of [{ width: 375, height: 800 }, { width: 800, height: 375 }]) {
      await page.setViewportSize(viewport);
      await expectNoHorizontalPageOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`variety-selector-fr-${viewport.width}.png`), animations: 'disabled' });
    }
    await page.keyboard.press('Escape');
    await expect(selector).not.toBeVisible();
    expect((await apiRequest<{ results: CropRow[] }>(page, 'GET', '/crops/?page_size=500')).results).toHaveLength(0);
  } finally {
    await resetE2EScenario(request, scenario);
    await resetE2EScenario(request, `${scenario}-source`);
  }
});

test.describe('bounded variety selection', () => {
  test.use({ serviceWorkers: 'block' });
test('a variety selection over the import limit is explained before any preview request', async ({ page, request }, testInfo) => {
  const scenario = `selected-varieties-limit-${Date.now()}`;
  await loginWithDeterministicProject(page, request, `${scenario}-source`, { loginAsAdmin: true, libraryModerator: true });
  const parent = await prepareSelectedVarietyParent(page, scenario);
  await apiRequest(page, 'POST', '/auth/logout/', {});
  await loginWithDeterministicProject(page, request, scenario, { loginAsAdmin: true });
  try {
    const unlinked = { ...parent, project_import_status: undefined };
    const varieties = Array.from({ length: 501 }, (_, index) => ({ ...unlinked, id: 100000 + index, variety: `Bounded ${index + 1}` }));
    await page.route('**/api/public-crops/**', route => {
      if (route.request().method() === 'GET' && new URL(route.request().url()).searchParams.get('crop_species') === String(parent.crop_species)) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 502, next: null, previous: null, results: [unlinked, ...varieties] }) });
      }
      return route.continue();
    });
    let previews = 0;
    page.on('request', req => { if (req.url().includes('/import-preview/')) previews++; });
    for (const language of ['de', 'fr'] as const) {
      await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: language });
      await page.evaluate(code => localStorage.setItem('ui.language', code), language);
      await page.setViewportSize({ width: 375, height: 800 });
      await page.goto(`/app/crop-library?cropId=${parent.id}`);
      const labels = language === 'de' ? germanCrops : frenchCrops;
      await page.getByRole('button', { name: labels.library.importButton, exact: true }).first().click();
      const dialog = page.getByRole('dialog', { name: labels.library.varietyImport.title });
      const confirm = dialog.getByRole('button', { name: labels.library.varietyImport.importWithVarieties_other.replace('{{count}}', '501'), exact: true });
      await expect(confirm).toBeDisabled();
      await expect(dialog.getByText(labels.library.varietyImport.selectionLimit.replace('{{limit}}', '500'), { exact: true })).toBeVisible();
      await expectNoHorizontalPageOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`variety-selection-limit-${language}-375.png`), animations: 'disabled' });
      await dialog.getByRole('checkbox', { name: 'Bounded 501', exact: true }).uncheck();
      await expect(dialog.getByRole('button', { name: labels.library.varietyImport.importWithVarieties_other.replace('{{count}}', '500'), exact: true })).toBeEnabled();
      expect(previews).toBe(0);
      await page.keyboard.press('Escape');
    }
  } finally {
    await resetE2EScenario(request, scenario);
    await resetE2EScenario(request, `${scenario}-source`);
  }
});

});
