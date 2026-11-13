import { expect, test } from '@playwright/test';
import de from '../src/i18n/locales/de/crops.json' with { type: 'json' };
import en from '../src/i18n/locales/en/crops.json' with { type: 'json' };
import fr from '../src/i18n/locales/fr/crops.json' with { type: 'json' };
import es from '../src/i18n/locales/es/crops.json' with { type: 'json' };
import deNavigation from '../src/i18n/locales/de/navigation.json' with { type: 'json' };
import enNavigation from '../src/i18n/locales/en/navigation.json' with { type: 'json' };
import frNavigation from '../src/i18n/locales/fr/navigation.json' with { type: 'json' };
import esNavigation from '../src/i18n/locales/es/navigation.json' with { type: 'json' };
import { apiRequest, loginWithDeterministicProject } from './utils';

const languages = {
  de: { text: de, navigation: deNavigation }, en: { text: en, navigation: enNavigation },
  fr: { text: fr, navigation: frNavigation }, es: { text: es, navigation: esNavigation },
};

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
