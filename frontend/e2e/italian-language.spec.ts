import { expect, test } from '@playwright/test';
import { apiRequest, expectNoHorizontalPageOverflow, loginWithDeterministicProject, waitForPageStable } from './utils';

const routes = [
  ['/app/dashboard', 'Panoramica'],
  ['/app/fields-beds', 'Superfici coltivate'],
  ['/app/crops', 'Colture'],
  ['/app/anbauplaene', 'Piano colturale'],
  ['/app/gantt-chart', 'Calendario colturale'],
  ['/app/yield-overview', 'Panoramica delle rese'],
  ['/app/seed-demand', 'Fabbisogno di sementi'],
  ['/app/young-plant-demand', 'Fabbisogno di piantine'],
  ['/app/suppliers', 'Fornitori'],
] as const;

for (const width of [375, 1024, 1440]) {
  test(`Italian persists and the main views fit at ${width}px`, async ({ page, request }, testInfo) => {
    test.setTimeout(120_000);
    const serverErrors: string[] = [];
    page.on('response', response => {
      if (response.url().includes('/api/') && response.status() >= 500) serverErrors.push(response.url());
    });
    await page.setViewportSize({ width, height: width === 375 ? 800 : 900 });
    // Project content stays English; only the account's interface language changes.
    await loginWithDeterministicProject(page, request, `italian-${width}`, {
      demoProject: true, loginAsAdmin: true, languageCode: 'en',
    });
    await page.goto('/app/account-settings');
    await page.getByRole('combobox', { name: /^(Sprache|Language)$/ }).click();
    const saved = page.waitForResponse(response => response.url().includes('/auth/account/language/') && response.request().method() === 'PUT');
    await page.getByRole('option', { name: 'Italiano', exact: true }).click();
    expect((await saved).ok()).toBe(true);
    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Lingua', exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'it');
    for (const [path, heading] of routes) {
      await page.goto(path);
      await waitForPageStable(page);
      await expect(page.getByRole('banner').getByRole('heading', { level: 1 })).toHaveText(heading);
      await expect(page.locator('html')).toHaveAttribute('lang', 'it');
      await expectNoHorizontalPageOverflow(page);
      await expect(page.locator('main').getByRole('progressbar')).toHaveCount(0);
      if (path === '/app/crops') await expect(page.getByText('Beetroot', { exact: true }).first()).toBeVisible();
      if (path === '/app/gantt-chart') {
        const title = page.getByRole('banner').getByRole('heading', { level: 1 });
        expect(await title.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
        expect(await page.locator('.rmg-title').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      }
      await page.screenshot({ path: testInfo.outputPath(`italian-${width}-${path.split('/').pop()}.png`), animations: 'disabled' });
    }
    if (width === 1440 || width === 375) {
      if (width === 375) await page.getByRole('button', { name: 'Apri menu', exact: true }).click();
      const labels = width === 375
        ? page.locator('.MuiDrawer-paper:visible .MuiListItemText-primary')
        : page.getByRole('complementary').locator('.MuiListItemText-primary');
      expect(await labels.count()).toBeGreaterThan(5);
      for (const label of await labels.all()) {
        expect(await label.evaluate(node => node.scrollWidth <= node.clientWidth &&
          node.getBoundingClientRect().height <= Number.parseFloat(getComputedStyle(node).lineHeight) + 1)).toBe(true);
      }
      await page.screenshot({ path: testInfo.outputPath(`italian-${width}-navigation.png`), animations: 'disabled' });
    }
    if (width === 375) {
      await page.keyboard.press('Escape');
      await page.setViewportSize({ width: 800, height: 375 });
      await page.goto('/app/gantt-chart');
      await waitForPageStable(page);
      const title = page.getByRole('banner').getByRole('heading', { level: 1 });
      expect(await title.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      await expectNoHorizontalPageOverflow(page);
      await page.screenshot({ path: testInfo.outputPath('italian-landscape-calendar.png'), animations: 'disabled' });
    }
    expect(serverErrors).toEqual([]);
  });
}

test('Italian public pages use their own URLs and complete legal texts', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ locale: 'it-IT', viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto('/ueber?ref=italian');
  await expect(page).toHaveURL(/\/it\/chi-siamo\?ref=italian$/);
  for (const path of ['/it', '/it/chi-siamo', '/it/note-legali', '/it/privacy', '/it/termini']) {
    await page.goto(path);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('html')).toHaveAttribute('lang', 'it');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://openfarmplanner.org${path}`);
    await expectNoHorizontalPageOverflow(page);
    if (path === '/it/privacy' || path === '/it/termini') {
      await expect(page.locator('body')).toContainText('tedesco, inglese, francese, spagnolo e italiano');
      await expect(page.locator('body')).toContainText('prevale la versione inglese');
    }
    await page.screenshot({ path: testInfo.outputPath(`italian-public-${path.split('/').pop()}.png`), animations: 'disabled' });
    await page.setViewportSize({ width: 375, height: 800 });
    await expectNoHorizontalPageOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`italian-public-mobile-${path.split('/').pop()}.png`), animations: 'disabled' });
    if (path === '/it/privacy' || path === '/it/termini') {
      await page.getByText(/Il presente documento è fornito in tedesco/).scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`italian-legal-clause-${path.split('/').pop()}.png`), animations: 'disabled' });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  await context.close();
});

test('Italian library translations save without replacing the original description', async ({ page, request }, testInfo) => {
  await loginWithDeterministicProject(page, request, 'italian-library-translation', { loginAsAdmin: true });
  const species = await apiRequest<{ results: { id: number; name: string }[] }>(page, 'GET', '/crop-species/?page_size=1');
  const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: species.results[0].name, crop_species: species.results[0].id,
    variety: `Italian translation acceptance ${Date.now()}`, notes: 'Original English growing notes.',
    cultivation_types: ['direct_sowing'], growth_duration_days: 42, harvest_duration_days: 14,
  });
  const published = await apiRequest<{ public_crop: { id: number } }>(page, 'POST', `/crops/${crop.id}/publish-public/`, {
    accepted_public_library_terms: true, crop_species_id: species.results[0].id, original_language_code: 'en',
  });
  await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: 'it' });
  await page.evaluate(() => {
    localStorage.setItem('ui.language', 'it');
    localStorage.setItem('ui.language.pendingChoice', 'it');
  });
  await page.goto(`/app/crop-library?cropId=${published.public_crop.id}`);
  await page.getByRole('button', { name: /Aggiungi traduzione in italiano/i }).click();
  const dialog = page.getByRole('dialog', { name: 'Modifica traduzione', exact: true });
  const editor = dialog.getByRole('textbox', { name: /italiano – Traduzione/i });
  await expect(editor).toHaveAttribute('lang', 'it');
  await expect(editor).toHaveValue('');
  await expect(dialog).toContainText('Original English growing notes.');
  await editor.fill('Note colturali italiane di esempio.');
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: width === 375 ? 800 : 900 });
    await expectNoHorizontalPageOverflow(page);
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`italian-library-translation-${width}.png`), animations: 'disabled' });
  }
  const saved = page.waitForResponse(response => response.url().endsWith(`/public-crops/${published.public_crop.id}/translations/`) && response.request().method() === 'PUT');
  await dialog.getByRole('button', { name: 'Salva', exact: true }).click();
  expect((await saved).ok()).toBe(true);
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.getByText('Note colturali italiane di esempio.', { exact: true })).toBeVisible();
  const stored = await apiRequest<{ translations: Record<string, string> }>(page, 'GET', `/public-crops/${published.public_crop.id}/translations/`);
  expect(stored.translations).toEqual({ en: 'Original English growing notes.', it: 'Note colturali italiane di esempio.' });
});
