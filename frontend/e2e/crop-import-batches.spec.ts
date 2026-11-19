import { expect, test, type Page } from '@playwright/test';
import de from '../src/i18n/locales/de/crops.json' with { type: 'json' };
import en from '../src/i18n/locales/en/crops.json' with { type: 'json' };
import fr from '../src/i18n/locales/fr/crops.json' with { type: 'json' };
import es from '../src/i18n/locales/es/crops.json' with { type: 'json' };
import deNavigation from '../src/i18n/locales/de/navigation.json' with { type: 'json' };
import enNavigation from '../src/i18n/locales/en/navigation.json' with { type: 'json' };
import frNavigation from '../src/i18n/locales/fr/navigation.json' with { type: 'json' };
import esNavigation from '../src/i18n/locales/es/navigation.json' with { type: 'json' };
import { apiRequest, loginWithDeterministicProject } from './utils';

test.use({ serviceWorkers: 'block' });

const languages = {
  de: { text: de, navigation: deNavigation }, en: { text: en, navigation: enNavigation },
  fr: { text: fr, navigation: frNavigation }, es: { text: es, navigation: esNavigation },
};

async function chooseImportFile(page: Page, language: keyof typeof languages, payload: unknown) {
  const { text, navigation } = languages[language];
  await page.getByRole('button', { name: navigation.cropActions.openImportExport, exact: true }).click();
  await page.getByRole('menuitem', { name: text.import.menuLabel, exact: true }).click();
  await page.getByRole('dialog', { name: text.import.selectFileTitle }).locator('input[type=file]').setInputFiles({
    name: 'recovery-crops.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)),
  });
  return page.getByRole('dialog', { name: text.import.title, exact: true });
}

for (const [language, width, height] of [
  ['en', 1440, 900], ['en', 1024, 900], ['de', 768, 900], ['fr', 375, 800], ['es', 800, 375],
] as const) {
  test(`refresh failure after saved import ${language} ${width}x${height}`, async ({ page, request }, testInfo) => {
    const { text, navigation } = languages[language];
    const scenario = `import-refresh-${language}-${width}`;
    const cropName = 'Confirmed recovery carrot';
    await loginWithDeterministicProject(page, request, scenario, { loginAsAdmin: true });
    await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: language });
    await page.evaluate(choice => {
      localStorage.setItem('ui.language', choice);
      localStorage.setItem('ui.language.pendingChoice', choice);
    }, language);
    await apiRequest(page, 'POST', '/crops/', { name: 'Existing recovery crop' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app/crops');
    await expect(page.getByRole('button', { name: navigation.projectSwitcher.ariaLabel, exact: true }))
      .toContainText(`E2E Project ${scenario}`);
    await expect(page.getByText('Existing recovery crop', { exact: true }).first()).toBeVisible();
    await expect(page.locator('header').getByRole('button', { name: text.buttons.addNew })).toBeVisible();

    let finalizationCompleted = false;
    let cropListReads = 0;
    const phases: string[] = [];
    await page.route('**/crops/import/apply/**', async route => {
      const { phase } = route.request().postDataJSON();
      phases.push(phase);
      if (phase !== 'finalize') {
        await route.fallback();
        return;
      }
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      finalizationCompleted = true;
      await route.fulfill({ response });
    });
    await page.route(/\/api\/crops\/(?:\?.*)?$/, async route => {
      if (finalizationCompleted && route.request().method() === 'GET' && ++cropListReads === 1) {
        await route.fulfill({ status: 503, json: { detail: 'Synthetic crop list failure' } });
        return;
      }
      await route.fallback();
    });

    const dialog = await chooseImportFile(page, language, [null, { name: cropName }, { name: 'Confirmed recovery bean' }]);
    await expect(dialog).toBeVisible();
    await page.setViewportSize({ width, height });
    await dialog.getByRole('button', { name: text.import.start, exact: true }).click();

    const warning = dialog.getByRole('alert');
    await expect(warning).toHaveText(text.import.errors.refresh);
    await expect(warning).toBeFocused();
    await expect(warning).toBeInViewport();
    const savedSummary = text.import.created_other.replace('{{count}}', '2');
    await expect(dialog.getByRole('status')).toHaveText(savedSummary);
    await expect(dialog.getByText(text.import.confirmedRows.replace('{{rows}}', '2–3'))).toBeInViewport();
    await expect(dialog.getByRole('button', { name: text.import.start, exact: true })).toHaveCount(0);
    await expect(page.locator('.MuiSnackbar-root')).toHaveCount(0);
    expect(cropListReads).toBe(1);
    expect(phases).toEqual(['crops', 'finalize']);
    expect(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('refresh-failure.png'), animations: 'disabled' });

    const close = dialog.getByRole('button', { name: text.import.close, exact: true });
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    const usesCropPicker = width === 375 || height === 375;
    const cropPicker = page.getByRole('button', { name: text.selectCrop, exact: true });
    if (usesCropPicker) await cropPicker.click();
    await expect(page.getByText(cropName, { exact: true })).toHaveCount(0);
    await page.reload();
    if (usesCropPicker) await cropPicker.click();
    await expect(page.getByText(cropName, { exact: true }).first()).toBeVisible();
    expect(cropListReads).toBeGreaterThan(1);
    expect(phases).toEqual(['crops', 'finalize']);
  });
}

test('a preview correction can proceed, and an unknown first apply cannot be replayed', async ({ page, request }, testInfo) => {
  const { text } = languages.en;
  await loginWithDeterministicProject(page, request, 'import-unknown-first-apply', { loginAsAdmin: true });
  await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: 'en' });
  await page.evaluate(() => {
    localStorage.setItem('ui.language', 'en');
    localStorage.setItem('ui.language.pendingChoice', 'en');
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/crops');
  await expect(page.locator('header').getByRole('button', { name: text.buttons.addNew })).toBeVisible();
  const dialog = await chooseImportFile(page, 'en', [null]);
  await expect(dialog.getByRole('alert')).toHaveText(text.import.errors.noValidEntries);
  await expect(dialog.getByRole('button', { name: text.import.start, exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: text.import.close, exact: true }).click();
  await expect(dialog).toBeHidden();

  const phases: string[] = [];
  await page.route('**/crops/import/apply/**', async route => {
    phases.push(route.request().postDataJSON().phase);
    await route.abort('failed');
  });
  await chooseImportFile(page, 'en', [{ name: 'Unknown recovery crop' }]);
  await expect(dialog).toBeVisible();
  await page.setViewportSize({ width: 375, height: 800 });
  await dialog.getByRole('button', { name: text.import.start, exact: true }).click();
  const alert = dialog.getByRole('alert');
  await expect(alert).toHaveText(text.import.errors.unconfirmed);
  await expect(alert).toBeFocused();
  await expect(dialog.getByText(text.import.errors.unknown, { exact: true })).toBeVisible();
  await expect(dialog.getByRole('status')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: text.import.start, exact: true })).toHaveCount(0);
  await expect(page.locator('.MuiSnackbar-root')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('unknown-first-apply.png'), animations: 'disabled' });
  await dialog.getByRole('button', { name: text.import.close, exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(phases).toEqual(['crops']);
});

for (const [language, width, height, interrupted] of [
  ['en', 1440, 900, false], ['en', 768, 900, true], ['en', 1024, 900, true],
  ['en', 800, 375, true], ['de', 375, 800, true], ['en', 375, 800, true],
  ['fr', 375, 800, true], ['es', 375, 800, true],
] as const) {
  test(`batched import ${language} ${width}x${height} ${interrupted ? 'interrupted' : 'complete'}`, async ({ page, request }, testInfo) => {
    test.setTimeout(150_000);
    const { text, navigation } = languages[language];
    const scenarioId = `import-batches-${language}-${width}`;
    await loginWithDeterministicProject(page, request, scenarioId, { loginAsAdmin: true });
    await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: language });
    await page.evaluate(choice => {
      localStorage.setItem('ui.language', choice);
      localStorage.setItem('ui.language.pendingChoice', choice);
    }, language);
    await apiRequest(page, 'POST', '/crops/', { name: 'Existing crop' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app/crops');
    // Project data and the lazy route's registered action both change header geometry.
    await expect(page.getByRole('button', { name: navigation.projectSwitcher.ariaLabel, exact: true }))
      .toContainText(`E2E Project ${scenarioId}`);
    await expect(page.locator('header').getByRole('button', { name: text.buttons.addNew }))
      .toBeVisible();
    await page.getByRole('button', { name: navigation.cropActions.openImportExport, exact: true }).click();
    await page.getByRole('menuitem', { name: text.import.menuLabel, exact: true }).click();
    await page.setViewportSize({ width, height });
    const start = page.getByRole('dialog', { name: text.import.selectFileTitle, exact: true });
    const payload = Array.from({ length: 201 }, (_, index) => ({
      name: `Imported crop ${index}`, notes: 'A note preserved across batches',
      ...(index === 0 ? { good_companions: [{ name: 'Imported crop 200', note: 'Across batches' }] } : {}),
    }));
    const observed: { phase: string; count: number; bytes: number }[] = [];
    const projectId = await page.evaluate(() => Number(localStorage.getItem('activeProjectId')));
    let resumePreview = () => {};
    let previewSeen = () => {};
    const previewStarted = new Promise<void>(resolve => { previewSeen = resolve; });
    const previewRelease = new Promise<void>(resolve => { resumePreview = resolve; });
    let previewCount = 0;
    await page.route('**/crops/import/preview/**', async route => {
      const body = route.request().postDataJSON();
      expect(body.expected_project_id).toBe(projectId);
      expect(body.items.length).toBeLessThanOrEqual(200);
      expect(Buffer.byteLength(route.request().postData()!, 'utf8')).toBeLessThanOrEqual(1024 * 1024);
      if (++previewCount === 1) { previewSeen(); await previewRelease; }
      await route.fallback();
    });
    let resumeApply = () => {};
    let applySeen = () => {};
    const applyStarted = new Promise<void>(resolve => { applySeen = resolve; });
    const applyRelease = new Promise<void>(resolve => { resumeApply = resolve; });
    let cropBatches = 0;
    await page.route('**/crops/import/apply/**', async route => {
      const body = route.request().postDataJSON();
      expect(body.expected_project_id).toBe(projectId);
      observed.push({ phase: body.phase, count: body.items.length,
        bytes: Buffer.byteLength(route.request().postData()!, 'utf8') });
      if (body.phase === 'crops') {
        cropBatches++;
        if (cropBatches === 1) { applySeen(); await applyRelease; }
        else if (interrupted) { await route.abort('failed'); return; }
      }
      await route.fallback();
    });
    await start.getByRole('button', { name: text.import.selectFileButton, exact: true }).scrollIntoViewIfNeeded();
    await start.locator('input[type=file]').setInputFiles({ name: 'batch-crops.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify([null, ...payload, { ...payload[0], notes: 'Duplicate must not overwrite' }])) });
    await previewStarted;
    await expect(start.getByRole('status')).toContainText(text.import.progress.preview.replace('{{completed}}', '0').replace('{{total}}', '202'));
    await page.screenshot({ path: testInfo.outputPath('preview-progress.png'), animations: 'disabled' });
    resumePreview();
    const dialog = page.getByRole('dialog', { name: text.import.title, exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(text.import.duplicatePolicy)).toBeVisible();
    await dialog.getByRole('button', { name: text.import.start, exact: true }).click();
    await applyStarted;
    await expect(dialog.getByRole('status')).toContainText(text.import.progress.crops.replace('{{completed}}', '0').replace('{{total}}', '201'));
    await page.screenshot({ path: testInfo.outputPath('apply-progress.png'), animations: 'disabled' });
    resumeApply();
    if (interrupted) {
      await expect(dialog.getByText(text.import.incompleteEntries, { exact: false })).toBeVisible({ timeout: 60_000 });
      await expect(dialog.getByText(text.import.errors.unknown, { exact: true })).toBeVisible();
      await expect(dialog.getByText(text.import.errors.companionsNotSent, { exact: true })).toBeVisible();
      await expect(dialog.getByText(text.import.rowLabel.replace('{{row}}', '202') + ': Imported crop 200')).toBeVisible();
      await expect(dialog.getByRole('button', { name: text.import.start, exact: true })).toHaveCount(0);
      expect(observed.map(item => item.phase)).toEqual(['crops', 'crops']);
      await page.screenshot({ path: testInfo.outputPath('partial-result.png'), animations: 'disabled' });
      const unknown = dialog.getByText(text.import.errors.unknown, { exact: true });
      await unknown.scrollIntoViewIfNeeded();
      await expect(unknown).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath('partial-details.png'), animations: 'disabled' });
      expect(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1)).toBe(false);
      const saved = await apiRequest<{ count: number }>(page, 'GET', '/crops/');
      expect(saved.count).toBe(201);
    } else {
      await expect(dialog).toBeHidden({ timeout: 60_000 });
      expect(observed.map(item => item.phase)).toEqual(['crops', 'crops', 'companions', 'finalize']);
      const saved = await apiRequest<{ count: number; results: { id: number; name: string; notes: string }[] }>(page, 'GET', '/crops/?page_size=500');
      expect(saved.count).toBe(202);
      expect(saved.results.find(crop => crop.name === 'Imported crop 0')?.notes).toBe('A note preserved across batches');
      const companions = await apiRequest<{ companion_crop: number }[]>(page, 'GET', '/crop-companions/');
      expect(companions).toHaveLength(1);
      expect(companions[0].companion_crop).toBeTruthy();
      const history = await apiRequest<Array<{
        batch_operation_type?: string; batch_context?: { created_count?: number; updated_count?: number };
      }>>(page, 'GET', '/history/project/');
      const imports = history.filter(entry => entry.batch_operation_type === 'crop_import');
      expect(imports).toHaveLength(1);
      expect(imports[0].batch_context).toMatchObject({ created_count: 201, updated_count: 0 });
    }
    for (const item of observed) {
      expect(item.count).toBeLessThanOrEqual(200);
      expect(item.bytes).toBeLessThanOrEqual(1024 * 1024);
    }

  });
}

for (const [language, width, height] of [
  ['de', 375, 800], ['en', 1440, 900], ['fr', 375, 800], ['es', 800, 375],
] as const) {
  test(`oversized import ${language} ${width}x${height}`, async ({ page, request }, testInfo) => {
    const { text, navigation } = languages[language];
    const scenarioId = `oversized-import-${language}`;
    await loginWithDeterministicProject(page, request, scenarioId, { loginAsAdmin: true });
    await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: language });
    await page.evaluate(choice => {
      localStorage.setItem('ui.language', choice);
      localStorage.setItem('ui.language.pendingChoice', choice);
    }, language);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app/crops');
    await expect(page.getByRole('button', { name: navigation.projectSwitcher.ariaLabel, exact: true }))
      .toContainText(`E2E Project ${scenarioId}`);
    await expect(page.locator('header').getByRole('button', { name: text.buttons.addNew }))
      .toBeVisible();
    await page.getByRole('button', { name: navigation.cropActions.openImportExport, exact: true }).click();
    await page.getByRole('menuitem', { name: text.import.menuLabel, exact: true }).click();
    await page.setViewportSize({ width, height });
    let previewRequests = 0;
    page.on('request', request => { if (request.url().includes('/crops/import/preview/')) previewRequests++; });
    await page.getByRole('dialog').locator('input[type=file]').setInputFiles({
      name: 'oversized.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify([{ name: 'Oversized crop', notes: 'é'.repeat(600000) }])),
    });
    const dialog = page.getByRole('dialog', { name: text.import.title, exact: true });
    await expect(dialog.getByText(text.import.errors.bodyLimit, { exact: true })).toBeVisible();
    expect(previewRequests).toBe(0);
    await page.screenshot({ path: testInfo.outputPath('body-limit.png'), animations: 'disabled' });
    expect(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1)).toBe(false);
  });
}
