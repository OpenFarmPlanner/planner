import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject } from './utils';

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

for (const viewport of [
  { width: 375, height: 800 }, { width: 768, height: 900 },
  { width: 1024, height: 900 }, { width: 1440, height: 900 }, { width: 800, height: 375 },
]) {
  test(`private note language edits preserve other versions at ${viewport.width}x${viewport.height}`, async ({ page, request }, testInfo) => {
    await page.setViewportSize(viewport);
    await loginWithDeterministicProject(page, request, `companion-notes-${viewport.width}`, { loginAsAdmin: true });
    const { crop, relation } = await createSource(page);
    await page.goto(`/app/crops?cropId=${crop.id}&action=edit`);
    const dialog = page.getByRole('dialog');
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
    await page.goto(`/app/crops?cropId=${crop.id}&action=edit`);
    const dialog = page.getByRole('dialog');
    const selector = dialog.getByRole('combobox', { name: label, exact: true });
    await expect(dialog.getByRole('textbox', { name: language === 'fr' ? 'Note' : 'Nota', exact: true })).toHaveValue(language === 'fr' ? 'Source FR' : '');
    await selector.scrollIntoViewIfNeeded();
    await expect(selector).toBeVisible();
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
  test(`spreadsheet import and export expose an explicit note language at ${viewport.width}`, async ({ page, request }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginWithDeterministicProject(page, request, 'companion-notes-exchange', { loginAsAdmin: true });
    await apiRequest<Crop>(page, 'POST', '/crops/', { name: 'Tomate' });
    await page.goto('/app/crops');
    await expect(page.getByRole('heading', { name: 'Kulturen', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tomate', exact: true })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Import/Export öffnen', exact: true }).click();
    await page.getByRole('menuitem', { name: /Aus Datei importieren/ }).click();
    let dialog = page.getByRole('dialog', { name: 'Kulturen importieren' });
    await expect(dialog).toBeVisible();
    await page.setViewportSize(viewport);
    await chooseLanguage(page, 'Sprache der Nachbarnotizen', 'Français');
    expect(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth + 1)).toBe(false);
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('import-note-language.png') });
    await dialog.locator('input[type=file]').setInputFiles({
      name: 'notes.csv', mimeType: 'text/csv', buffer: Buffer.from('Name,Gute Nachbarn\nGurke,"Tomate | Source FR 2025"\n'),
    });
    dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Import starten', exact: true })).toBeVisible();
    const [applied] = await Promise.all([
      page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes('/crops/import/apply/')),
      dialog.getByRole('button', { name: 'Import starten', exact: true }).click(),
    ]);
    expect(applied.ok()).toBe(true);
    expect(applied.request().postDataJSON().companion_note_language).toBe('fr');
    const relations = await apiRequest<Relation[]>(page, 'GET', '/crop-companions/');
    expect(relations[0].notes).toEqual({ fr: 'Source FR 2025' });
    await expect(dialog).toBeHidden();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Import/Export öffnen', exact: true }).click();
    await page.getByRole('menuitem', { name: /Alle Kulturen exportieren/ }).click();
    dialog = page.getByRole('dialog', { name: 'Kulturen exportieren' });
    await page.setViewportSize(viewport);
    await dialog.getByRole('radio', { name: 'CSV (.csv)', exact: true }).check();
    await chooseLanguage(page, 'Sprache der Nachbarnotizen', 'Français');
    expect(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth + 1)).toBe(false);
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('export-note-language.png') });
    const [download] = await Promise.all([
      page.waitForEvent('download'), dialog.getByRole('button', { name: 'Exportieren', exact: true }).click(),
    ]);
    const contents = await readFile((await download.path())!, 'utf8');
    expect(contents).toContain('Source FR 2025');
    expect(contents).toContain(' | ');
  });
}
