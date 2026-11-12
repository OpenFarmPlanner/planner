import { expect, test, type Page } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject, waitForPageStable } from './utils';

type Species = { id: number; name: string; display_name?: string; specific_property_profile?: string };
type Crop = { id: number; variety: string; crop_species: number; specific_properties: Record<string, string> };

async function speciesOptions(page: Page) {
  const response = await apiRequest<{ results: Species[] }>(page, 'GET', '/crop-species/?page_size=1000');
  const potato = response.results.find((species) => species.specific_property_profile === 'solanum_tuberosum');
  const ordinary = response.results.find((species) => !species.specific_property_profile);
  expect(potato).toBeDefined();
  expect(ordinary).toBeDefined();
  return { potato: potato!, ordinary: ordinary! };
}

async function chooseSpecies(page: Page, species: Species) {
  const name = species.display_name || species.name;
  await page.getByRole('dialog').getByLabel(/^Name/).fill(name);
  await page.getByRole('option').filter({ hasText: name }).first().click();
}

async function openCreate(page: Page) {
  await page.goto('/app/crops');
  await waitForPageStable(page, /Kulturbibliothek/i);
  await page.getByRole('button', { name: 'Kultur hinzufügen', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Kultur hinzufügen' })).toBeVisible();
}

for (const viewport of [
  { width: 375, height: 800 }, { width: 768, height: 900 },
  { width: 1024, height: 900 }, { width: 1440, height: 900 }, { width: 800, height: 375 },
]) {
  test(`potato properties save without a variety at ${viewport.width}x${viewport.height}`, async ({ page, request }, testInfo) => {
    await page.setViewportSize(viewport);
    await loginWithDeterministicProject(page, request, `specific-${viewport.width}`, { loginAsAdmin: true });
    const { potato } = await speciesOptions(page);
    await openCreate(page);
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('combobox', { name: 'Kochtyp', exact: true })).toHaveCount(0);
    await chooseSpecies(page, potato);
    const cooking = dialog.getByRole('combobox', { name: 'Kochtyp', exact: true });
    await expect(cooking).toBeVisible();
    await cooking.click();
    await page.getByRole('option', { name: 'Festkochend', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Reifegruppe', exact: true }).click();
    await page.getByRole('option', { name: 'Früh', exact: true }).click();
    await cooking.scrollIntoViewIfNeeded();
    expect(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth + 1)).toBe(false);
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`properties-${viewport.width}x${viewport.height}.png`) });
    const saved = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/crops/'));
    await dialog.getByRole('button', { name: 'Erstellen', exact: true }).click();
    const response = await saved;
    expect(response.ok()).toBe(true);
    const crop = await response.json() as Crop;
    expect(crop.variety).toBe('');
    expect(crop.specific_properties).toEqual({ cooking_type: 'waxy', maturity_group: 'early' });
    await expect(dialog).toBeHidden();
    await page.goto(`/app/crops?cropId=${crop.id}&action=edit`);
    await expect(page.getByRole('dialog').getByRole('combobox', { name: 'Kochtyp', exact: true })).toHaveText('Festkochend');
  });
}

test('species switching preserves values until the explicit clear action', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await loginWithDeterministicProject(page, request, 'specific-switch', { loginAsAdmin: true });
  const { potato, ordinary } = await speciesOptions(page);
  const crop = await apiRequest<Crop>(page, 'POST', '/crops/', {
    name: potato.name, crop_species: potato.id, specific_properties: { cooking_type: 'waxy' },
  });
  await page.goto(`/app/crops?cropId=${crop.id}&action=edit`);
  const dialog = page.getByRole('dialog');
  await chooseSpecies(page, ordinary);
  const clear = dialog.getByRole('button', { name: 'Nicht passende Werte entfernen', exact: true });
  await expect(clear).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Speichern', exact: true })).toBeDisabled();
  expect((await apiRequest<Crop>(page, 'GET', `/crops/${crop.id}/`)).specific_properties).toEqual({ cooking_type: 'waxy' });
  expect(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth + 1)).toBe(false);
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('species-switch-375.png') });
  await chooseSpecies(page, potato);
  await expect(dialog.getByRole('combobox', { name: 'Kochtyp', exact: true })).toHaveText('Festkochend');
  await chooseSpecies(page, ordinary);
  await clear.click();
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).toBeHidden();
  const saved = await apiRequest<Crop>(page, 'GET', `/crops/${crop.id}/`);
  expect(saved.crop_species).toBe(ordinary.id);
  expect(saved.specific_properties).toEqual({});
});

for (const [language, title] of [['fr', 'Propriétés propres à la culture'], ['es', 'Propiedades específicas del cultivo']] as const) {
  test(`property controls and scope warning fit a phone in ${language}`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await loginWithDeterministicProject(page, request, `specific-${language}`, { loginAsAdmin: true });
    const { potato } = await speciesOptions(page);
    const crop = await apiRequest<Crop>(page, 'POST', '/crops/', {
      name: potato.name, crop_species: potato.id,
      specific_properties: { cooking_type: 'mostly_waxy', maturity_group: 'medium_late' },
    });
    await page.evaluate((choice) => {
      localStorage.setItem('ui.language', choice);
      localStorage.setItem('ui.language.pendingChoice', choice);
    }, language);
    await page.goto(`/app/crops?cropId=${crop.id}&action=edit`);
    const dialog = page.getByRole('dialog');
    const heading = dialog.getByRole('heading', { name: title, exact: true });
    await heading.scrollIntoViewIfNeeded();
    await expect(heading).toBeVisible();
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`properties-${language}-375.png`) });
    await dialog.getByRole('combobox', { name: /^(Nom|Nombre)$/ }).fill('Different draft name');
    await expect(dialog.getByRole('alert')).toBeVisible();
    await dialog.getByRole('combobox', { name: /^(Nom|Nombre)$/ }).press('Escape');
    await heading.scrollIntoViewIfNeeded();
    expect(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth + 1)).toBe(false);
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`properties-warning-${language}-375.png`) });
  });
}

test('first-variety values publish, edit and import independently of the project copy', async ({ page, request, browser }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, 'specific-library', { loginAsAdmin: true });
  const { potato } = await speciesOptions(page);
  const variety = `Property browser ${Date.now()}`;
  await openCreate(page);
  await chooseSpecies(page, potato);
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Sorte (optional)', { exact: true }).fill(variety);
  await dialog.getByRole('spinbutton', { name: 'Wachstumszeit (Tage)', exact: true }).fill('90');
  await dialog.getByRole('spinbutton', { name: 'Erntezeit (Tage)', exact: true }).fill('14');
  await dialog.getByRole('combobox', { name: 'Kochtyp', exact: true }).click();
  await page.getByRole('option', { name: 'Festkochend', exact: true }).click();
  await dialog.getByRole('button', { name: 'Erstellen', exact: true }).click();
  await expect(dialog).toBeHidden();
  const rows = (await apiRequest<{ results: Crop[] }>(page, 'GET', '/crops/?page_size=1000')).results;
  const projectVariety = rows.find((row) => row.variety === variety)!;
  expect(projectVariety.specific_properties).toEqual({ cooking_type: 'waxy' });
  expect(rows.find((row) => !row.variety)?.specific_properties).toEqual({});
  const published = await apiRequest<{ public_crop: { id: number } }>(page, 'POST', `/crops/${projectVariety.id}/publish-public/`, {
    accepted_public_library_terms: true, crop_species_id: potato.id, original_language_code: 'de',
  });
  await page.goto(`/app/crop-library?cropId=${published.public_crop.id}`);
  await expect(page.getByText('Festkochend', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /bearbeiten/i }).first().click();
  const edit = page.getByRole('dialog');
  await edit.getByRole('combobox', { name: 'Kochtyp', exact: true }).click();
  await page.getByRole('option', { name: 'Mehligkochend', exact: true }).click();
  await edit.getByRole('button', { name: /Speichern/ }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByText('Mehligkochend', { exact: true })).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('properties-library-1440.png') });
  expect((await apiRequest<Crop>(page, 'GET', `/crops/${projectVariety.id}/`)).specific_properties).toEqual({ cooking_type: 'waxy' });
  const importContext = await browser.newContext({ baseURL: new URL(page.url()).origin, locale: 'de-DE' });
  try {
    const importPage = await importContext.newPage();
    await loginWithDeterministicProject(importPage, request, 'specific-library-import', { loginAsAdmin: true });
    const imported = await apiRequest<{ crop: Crop }>(importPage, 'POST', `/public-crops/${published.public_crop.id}/import/`, {});
    expect(imported.crop.specific_properties).toEqual({ cooking_type: 'floury' });
  } finally {
    await importContext.close();
  }
});
