import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject } from './utils';
import de from '../src/i18n/locales/de/crops.json' with { type: 'json' };
import deCommon from '../src/i18n/locales/de/common.json' with { type: 'json' };
import deNavigation from '../src/i18n/locales/de/navigation.json' with { type: 'json' };
import fr from '../src/i18n/locales/fr/crops.json' with { type: 'json' };
import frCommon from '../src/i18n/locales/fr/common.json' with { type: 'json' };
import frNavigation from '../src/i18n/locales/fr/navigation.json' with { type: 'json' };
import es from '../src/i18n/locales/es/crops.json' with { type: 'json' };
import esCommon from '../src/i18n/locales/es/common.json' with { type: 'json' };
import esNavigation from '../src/i18n/locales/es/navigation.json' with { type: 'json' };

type Crop = { id: number; name: string };
type Relation = { id: number; notes: Record<string, string> };

async function createSource(page: Page, species?: { id: number; name: string }) {
  const crop = await apiRequest<Crop>(page, 'POST', '/crops/', {
    name: species?.name ?? 'Companion notes crop', crop_species: species?.id,
    growth_duration_days: 60, harvest_duration_days: 14,
  });
  const relation = await apiRequest<Relation>(page, 'POST', '/crop-companions/', {
    crop: crop.id, companion_family: 'Brassicaceae', kind: 'bad', reason: 'competition',
    notes: { de: 'Quelle DE', en: 'Source EN', fr: 'Source FR' },
  });
  return { crop, relation };
}

async function chooseLanguage(page: Page, label: string, language: string) {
  await page.getByRole('dialog').getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: language, exact: true }).click();
}

async function setUiLanguage(page: Page, language: 'de' | 'fr' | 'es') {
  await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: language });
  await page.evaluate(choice => {
    localStorage.setItem('ui.language', choice);
    localStorage.setItem('ui.language.pendingChoice', choice);
  }, language);
}

async function openExport(page: Page, language: 'de' | 'fr' | 'es') {
  const text = { de, fr, es }[language];
  const navigation = { de: deNavigation, fr: frNavigation, es: esNavigation }[language];
  await page.getByRole('button', { name: navigation.cropActions.openImportExport, exact: true }).click();
  await page.getByRole('menuitem', { name: navigation.commandPalette.allPageShortcuts.crops.exportAll }).click();
  const dialog = page.getByRole('dialog', { name: text.export.dialogTitle, exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('combobox')).toHaveCount(0);
  return dialog;
}

async function openProjectCompanions(page: Page, cropId: number, language: 'de' | 'fr' | 'es' = 'de') {
  const text = { de, fr, es }[language];
  const common = { de: deCommon, fr: frCommon, es: esCommon }[language];
  await page.goto(`/app/crops?cropId=${cropId}`);
  await page.getByTestId('crop-companions-section').getByRole('button', { name: common.actions.edit, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: text.companions.editTitle, exact: true });
  const row = dialog.getByTestId('companion-compact-row');
  // Each compact row exposes Edit, followed by Delete.
  await row.getByRole('button').first().click();
  return dialog;
}

for (const viewport of [
  { width: 375, height: 800 }, { width: 768, height: 900 },
  { width: 1024, height: 900 }, { width: 1440, height: 900 }, { width: 800, height: 375 },
]) {
  test(`private note language edits preserve other versions at ${viewport.width}x${viewport.height}`, async ({ page, request }, testInfo) => {
    await page.setViewportSize(viewport);
    await loginWithDeterministicProject(page, request, `companion-notes-${viewport.width}`, { loginAsAdmin: true });
    const { crop, relation } = await createSource(page);
    const dialog = await openProjectCompanions(page, crop.id);
    await chooseLanguage(page, 'Sprache der Nachbarnotizen', 'English');
    const note = dialog.getByRole('textbox', { name: 'Notiz', exact: true });
    await expect(note).toHaveValue('Source EN');
    await note.fill('Source EN updated\n2025; page 12 | annex');
    await note.scrollIntoViewIfNeeded();
    expect(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth + 1)).toBe(false);
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`companion-notes-${viewport.width}.png`) });
    const [saved] = await Promise.all([
      page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().endsWith('/crop-companions/replace/')),
      dialog.getByRole('button', { name: 'Speichern', exact: true }).click(),
    ]);
    expect(saved.ok()).toBe(true);
    await expect(dialog).toBeHidden();
    const stored = await apiRequest<Relation>(page, 'GET', `/crop-companions/${relation.id}/`);
    expect(stored.notes).toEqual({ de: 'Quelle DE', en: 'Source EN updated\n2025; page 12 | annex', fr: 'Source FR' });
  });
}

for (const [language, label] of [['fr', 'Langue des notes de voisinage'], ['es', 'Idioma de las notas de asociación']] as const) {
  test(`note language controls fit a phone in ${language}`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await loginWithDeterministicProject(page, request, `companion-notes-${language}`, { loginAsAdmin: true });
    const { crop } = await createSource(page);
    await page.evaluate((choice) => {
      localStorage.setItem('ui.language', choice);
      localStorage.setItem('ui.language.pendingChoice', choice);
    }, language);
    const dialog = await openProjectCompanions(page, crop.id, language);
    const selector = dialog.getByRole('combobox', { name: label, exact: true });
    await expect(dialog.getByRole('textbox', { name: language === 'fr' ? 'Note' : 'Nota', exact: true })).toHaveValue(language === 'fr' ? 'Source FR' : '');
    await selector.scrollIntoViewIfNeeded();
    await expect(selector).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    expect(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth + 1)).toBe(false);
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`companion-notes-${language}-375.png`) });
  });
}

test('library note editing preserves other languages and missing versions stay hidden', async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, 'companion-notes-library', { loginAsAdmin: true });
  const available = await apiRequest<{ results: { id: number; name: string }[] }>(page, 'GET', '/crop-species/?page_size=1000');
  const library = await apiRequest<{ results: { crop_species: number; variety: string }[] }>(page, 'GET', '/public-crops/?page_size=1000');
  const publishedSpecies = new Set(library.results.filter((entry) => !entry.variety).map((entry) => entry.crop_species));
  const species = [...available.results].reverse().find((entry) => !publishedSpecies.has(entry.id));
  expect(species, 'An official species without an existing public general entry is available').toBeDefined();
  const { crop } = await createSource(page, species!);
  const published = await apiRequest<{ public_crop: { id: number } }>(page, 'POST', `/crops/${crop.id}/publish-public/`, {
    accepted_public_library_terms: true, crop_species_id: species!.id, original_language_code: 'de', publish_as_general: true,
  });
  await page.goto(`/app/crop-library?cropId=${published.public_crop.id}`);
  await expect(page.getByTestId('library-companions-section')).toContainText('Quelle DE');
  await expect(page.getByTestId('library-companions-section').getByRole('button', { name: /^Bearbeiten/ })).toHaveCount(0);
  await page.getByRole('button', { name: /^Bearbeiten/ }).click();
  await chooseLanguage(page, 'Sprache der Nachbarnotizen', 'English');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Notiz', exact: true }).fill('Updated English source\nStudy 2025');
  await dialog.getByRole('button', { name: /Speichern/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('library-companions-section')).toContainText('Quelle DE');
  for (const [language, expected] of [['en', 'Updated English source'], ['fr', 'Source FR'], ['es', '']] as const) {
    await page.evaluate((choice) => {
      localStorage.setItem('ui.language', choice);
      localStorage.setItem('ui.language.pendingChoice', choice);
    }, language);
    await page.reload();
    const section = page.getByTestId('library-companions-section');
    await expect(section).toBeVisible();
    if (expected) await expect(section).toContainText(expected);
    else {
      await expect(section).not.toContainText('Updated English source');
      await expect(section).not.toContainText('Quelle DE');
      await expect(section).not.toContainText('Source FR');
    }
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`library-notes-${language}.png`) });
  }
});

for (const viewport of [{ width: 375, height: 800 }, { width: 800, height: 375 }, { width: 1440, height: 900 }]) {
  test(`spreadsheet import and export use the UI language at ${viewport.width}`, async ({ page, request }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginWithDeterministicProject(page, request, 'companion-notes-exchange', { loginAsAdmin: true });
    await apiRequest<Crop>(page, 'POST', '/crops/', { name: 'Tomate' });
    await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: 'fr' });
    await page.evaluate(() => {
      localStorage.setItem('ui.language', 'fr');
      localStorage.setItem('ui.language.pendingChoice', 'fr');
    });
    await page.goto('/app/crops');
    await expect(page.getByRole('heading', { name: fr.title, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tomate', exact: true })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: frNavigation.cropActions.openImportExport, exact: true }).click();
    await page.getByRole('menuitem', { name: fr.import.menuLabel, exact: true }).click();
    let dialog = page.getByRole('dialog', { name: fr.import.selectFileTitle });
    await expect(dialog).toBeVisible();
    await page.setViewportSize(viewport);
    await expect(dialog.getByRole('combobox')).toHaveCount(0);
    await expect(dialog.getByRole('checkbox')).toHaveCount(0);
    expect(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth + 1)).toBe(false);
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('import-note-language.png') });
    await dialog.locator('input[type=file]').setInputFiles({
      name: 'notes.csv', mimeType: 'text/csv', buffer: Buffer.from('Name,Gute Nachbarn\nGurke,"Tomate | Source FR 2025"\n'),
    });
    dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: fr.import.start, exact: true })).toBeVisible();
    const [applied] = await Promise.all([
      page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes('/crops/import/apply/')),
      dialog.getByRole('button', { name: fr.import.start, exact: true }).click(),
    ]);
    expect(applied.ok()).toBe(true);
    expect(applied.request().postDataJSON().companion_note_language).toBe('fr');
    expect(applied.request().postDataJSON()).not.toHaveProperty('replace_companion_notes');
    await expect(dialog).toBeHidden();
    const relations = await apiRequest<Relation[]>(page, 'GET', '/crop-companions/');
    expect(relations[0].notes).toEqual({ fr: 'Source FR 2025' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    // The shell language is ready before the lazy crop page registers its actions.
    await expect(page.getByRole('heading', { name: 'Tomate', exact: true })).toBeVisible();
    await page.waitForLoadState('networkidle');
    dialog = await openExport(page, 'fr');
    await page.setViewportSize(viewport);
    await dialog.getByRole('radio', { name: 'CSV (.csv)', exact: true }).check();
    expect(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth + 1)).toBe(false);
    await dialog.locator('.MuiDialogContent-root').evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('export-note-language.png') });
    const [download] = await Promise.all([
      page.waitForEvent('download'), dialog.getByRole('button', { name: fr.export.submit, exact: true }).click(),
    ]);
    const contents = await readFile((await download.path())!, 'utf8');
    expect(contents).toContain('Source FR 2025');
    expect(contents).toContain(' | ');
  });
}

for (const format of ['csv', 'xlsx', 'ods'] as const) {
  test(`exports French companion notes through the actual ${format} download`, async ({ page, request }, testInfo) => {
    await loginWithDeterministicProject(page, request, `export-notes-${format}`, { loginAsAdmin: true });
    const { crop } = await createSource(page);
    await setUiLanguage(page, 'fr');
    await page.goto(`/app/crops?cropId=${crop.id}`);
    await expect(page.getByRole('heading', { name: crop.name, exact: true })).toBeVisible();
    await page.waitForLoadState('networkidle');
    let dialog = await openExport(page, 'fr');
    const label = { csv: fr.export.formatCsv, xlsx: fr.export.formatXlsx, ods: fr.export.formatOds }[format];
    await dialog.getByRole('radio', { name: label, exact: true }).check();
    const [download] = await Promise.all([
      page.waitForEvent('download'), dialog.getByRole('button', { name: fr.export.submit, exact: true }).click(),
    ]);
    const path = testInfo.outputPath(`export.${format}`);
    await download.saveAs(path);
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: frNavigation.cropActions.openImportExport, exact: true }).click();
    await page.getByRole('menuitem', { name: fr.import.menuLabel, exact: true }).click();
    dialog = page.getByRole('dialog', { name: fr.import.selectFileTitle, exact: true });
    const [preview] = await Promise.all([
      page.waitForResponse(response => response.request().method() === 'POST' && response.url().includes('/crops/import/preview/')),
      dialog.locator('input[type=file]').setInputFiles(path),
    ]);
    expect(preview.ok()).toBe(true);
    const body = preview.request().postDataJSON();
    const items = Array.isArray(body) ? body : body.items;
    expect(items.find((item: Crop) => item.name === crop.name).bad_companions[0].note).toBe('Source FR');
    await page.getByRole('dialog').getByRole('button', { name: fr.import.close, exact: true }).click();
  });
}

test('JSON keeps every companion note version when the UI language has no note', async ({ page, request }) => {
  await loginWithDeterministicProject(page, request, 'export-notes-json', { loginAsAdmin: true });
  const { crop, relation } = await createSource(page);
  await setUiLanguage(page, 'es');
  await page.goto(`/app/crops?cropId=${crop.id}`);
  await expect(page.getByRole('heading', { name: crop.name, exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  const dialog = await openExport(page, 'es');
  await dialog.getByRole('radio', { name: es.export.formatJson, exact: true }).check();
  const [download] = await Promise.all([
    page.waitForEvent('download'), dialog.getByRole('button', { name: es.export.submit, exact: true }).click(),
  ]);
  const contents = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(contents.crops.find((item: Crop) => item.name === crop.name).bad_companions[0].notes)
    .toEqual({ de: 'Quelle DE', en: 'Source EN', fr: 'Source FR' });
  expect((await apiRequest<Relation>(page, 'GET', `/crop-companions/${relation.id}/`)).notes)
    .toEqual({ de: 'Quelle DE', en: 'Source EN', fr: 'Source FR' });
});

test.describe('export failure recovery', () => {
  // Browser routing cannot intercept requests handled by a service worker.
  test.use({ serviceWorkers: 'block' });

  test('failed exports and cancellation preserve the successful format across reloads', async ({ page, request }, testInfo) => {
    await loginWithDeterministicProject(page, request, 'export-format-preference', { loginAsAdmin: true });
    const { crop } = await createSource(page);
    await page.evaluate(() => localStorage.setItem('ofp.crops.exportFormat', 'xlsx'));
    // Fail list loading before navigation so no warm response cache can hide the error.
    const companionList = /\/api\/crop-companions\/(?:\?.*)?$/;
    await page.route(companionList, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
    await page.goto(`/app/crops?cropId=${crop.id}`);
    await expect(page.getByRole('heading', { name: crop.name, exact: true })).toBeVisible();
    await page.waitForLoadState('networkidle');
    let dialog = await openExport(page, 'de');
    await page.setViewportSize({ width: 375, height: 800 });
    await expect(dialog.getByRole('radio', { name: de.export.formatXlsx, exact: true })).toBeChecked();
    await dialog.getByRole('radio', { name: de.export.formatCsv, exact: true }).check();
    const [failed] = await Promise.all([
      page.waitForResponse(response => response.url().includes('/api/crop-companions/') && response.status() === 503),
      dialog.getByRole('button', { name: de.export.submit, exact: true }).click(),
    ]);
    expect(failed.status()).toBe(503);
    await expect(page.getByRole('alert', { includeHidden: true }).filter({ hasText: de.messages.fetchError })).toBeVisible();
    await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('ofp.crops.exportFormat'))).toBe('xlsx');
    await page.unroute(companionList);
    const [download] = await Promise.all([
      page.waitForEvent('download'), dialog.getByRole('button', { name: de.export.submit, exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    await expect(dialog).toBeHidden();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await expect(page.getByRole('heading', { name: crop.name, exact: true })).toBeVisible();
    await page.waitForLoadState('networkidle');
    dialog = await openExport(page, 'de');
    await expect(dialog.getByRole('radio', { name: de.export.formatCsv, exact: true })).toBeChecked();
    await dialog.getByRole('radio', { name: de.export.formatJson, exact: true }).check();
    await dialog.getByRole('button', { name: de.export.cancel, exact: true }).click();
    dialog = await openExport(page, 'de');
    await page.setViewportSize({ width: 375, height: 800 });
    await expect(dialog.getByRole('radio', { name: de.export.formatCsv, exact: true })).toBeChecked();
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('export-format-preference-375.png') });
  });
});
