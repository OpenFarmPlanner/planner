import { expect, test } from '@playwright/test';
import { apiRequest, expectNoHorizontalPageOverflow, loginWithDeterministicProject, waitForPageStable } from './utils';

const languages = [
  {
    code: 'it', name: 'Italian', label: 'Italiano', browserLocale: 'it-IT', accountLabel: 'Lingua',
    menuLabel: 'Apri menu', cropSelectorLabel: 'Seleziona coltura', dialogTitle: 'Modifica traduzione', saveLabel: 'Salva',
    translationAction: /Aggiungi traduzione in italiano/i, editorLabel: /italiano – Traduzione/i,
    description: 'Note colturali italiane di esempio.',
    languageClause: 'tedesco, inglese, francese, spagnolo, italiano, portoghese e olandese',
    authoritativeClause: 'prevale la versione inglese',
    publicPaths: ['/it', '/it/chi-siamo', '/it/note-legali', '/it/privacy', '/it/termini'],
    routes: {
      dashboard: 'Panoramica', 'fields-beds': 'Superfici coltivate', crops: 'Colture',
      anbauplaene: 'Piano colturale', 'gantt-chart': 'Calendario colturale',
      'yield-overview': 'Panoramica delle rese', 'seed-demand': 'Fabbisogno di sementi',
      'young-plant-demand': 'Fabbisogno di piantine', suppliers: 'Fornitori',
    },
  },
  {
    code: 'pt', name: 'Portuguese', label: 'Português', browserLocale: 'pt-BR', accountLabel: 'Idioma',
    menuLabel: 'Abrir menu', cropSelectorLabel: 'Selecionar cultura', dialogTitle: 'Editar tradução', saveLabel: 'Guardar',
    translationAction: /Adicionar tradução em português/i, editorLabel: /português – Tradução/i,
    description: 'Notas de cultivo portuguesas de exemplo.',
    languageClause: 'alemão, inglês, francês, espanhol, italiano, português e neerlandês',
    authoritativeClause: 'prevalece a versão inglesa',
    publicPaths: ['/pt', '/pt/sobre', '/pt/aviso-legal', '/pt/privacidade', '/pt/termos'],
    routes: {
      dashboard: 'Visão geral', 'fields-beds': 'Áreas de cultivo', crops: 'Culturas',
      anbauplaene: 'Plano de cultivo', 'gantt-chart': 'Calendário de cultivo',
      'yield-overview': 'Visão geral dos rendimentos', 'seed-demand': 'Necessidades de sementes',
      'young-plant-demand': 'Necessidades de plantas de viveiro', suppliers: 'Fornecedores',
    },
  },
  {
    code: 'nl', name: 'Dutch', label: 'Nederlands', browserLocale: 'nl-BE', accountLabel: 'Taal',
    menuLabel: 'Menu openen', cropSelectorLabel: 'Gewas kiezen', dialogTitle: 'Vertaling bewerken', saveLabel: 'Opslaan',
    translationAction: /Vertaling in het Nederlands toevoegen/i, editorLabel: /Nederlands – Vertaling/i,
    description: 'Nederlandse voorbeeldnotities over de teelt.',
    languageClause: 'Duits, Engels, Frans, Spaans, Italiaans, Portugees en Nederlands',
    authoritativeClause: 'de Engelse versie doorslaggevend',
    publicPaths: ['/nl', '/nl/over', '/nl/juridische-informatie', '/nl/privacy', '/nl/voorwaarden'],
    routes: {
      dashboard: 'Overzicht', 'fields-beds': 'Teeltoppervlakken', crops: 'Gewassen',
      anbauplaene: 'Teeltplan', 'gantt-chart': 'Teeltkalender',
      'yield-overview': 'Opbrengstoverzicht', 'seed-demand': 'Zaadbehoefte',
      'young-plant-demand': 'Plantgoedbehoefte', suppliers: 'Leveranciers',
    },
  },
] as const;

for (const language of languages) {
  for (const width of [375, 1024, 1440]) {
    test(`${language.name} persists and the main views fit at ${width}px`, async ({ page, request }, testInfo) => {
      test.setTimeout(120_000);
      const serverErrors: string[] = [];
      page.on('response', response => {
        if (response.url().includes('/api/') && response.status() >= 500) serverErrors.push(response.url());
      });
      await page.setViewportSize({ width, height: width === 375 ? 800 : 900 });
      // Project content stays English; only the account's interface language changes.
      await loginWithDeterministicProject(page, request, `locale-${language.code}-${width}`, {
        demoProject: true, loginAsAdmin: true, languageCode: 'en',
      });
      await page.goto('/app/account-settings');
      await page.getByRole('combobox', { name: /^(Sprache|Language)$/ }).click();
      const saved = page.waitForResponse(response => response.url().includes('/auth/account/language/') && response.request().method() === 'PUT');
      await page.getByRole('option', { name: language.label, exact: true }).click();
      expect((await saved).ok()).toBe(true);
      await page.reload();
      await expect(page.getByRole('combobox', { name: language.accountLabel, exact: true })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', language.code);
      for (const [route, heading] of Object.entries(language.routes)) {
        const path = `/app/${route}`;
        await page.goto(path);
        await waitForPageStable(page);
        await expect(page.getByRole('banner').getByRole('heading', { level: 1 })).toHaveText(heading);
        await expect(page.locator('html')).toHaveAttribute('lang', language.code);
        await expectNoHorizontalPageOverflow(page);
        await expect(page.locator('main').getByRole('progressbar')).toHaveCount(0);
        if (path === '/app/crops') {
          if (width === 375) {
            const selector = page.getByRole('button', { name: language.cropSelectorLabel });
            await selector.click();
            await page.getByRole('option', { name: 'Beetroot', exact: true }).click();
            await expect(selector).toHaveText('Beetroot');
          } else {
            await expect(page.getByText('Beetroot', { exact: true }).first()).toBeVisible();
          }
        }
        if (path === '/app/gantt-chart') {
          const title = page.getByRole('banner').getByRole('heading', { level: 1 });
          expect(await title.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
          expect(await page.locator('.rmg-title').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
        }
        await page.screenshot({ path: testInfo.outputPath(`locale-${language.code}-${width}-${route}.png`), animations: 'disabled' });
      }
      if (width === 1440 || width === 375) {
        if (width === 375) await page.getByRole('button', { name: language.menuLabel, exact: true }).click();
        const labels = width === 375
          ? page.locator('.MuiDrawer-paper:visible .MuiListItemText-primary')
          : page.getByRole('complementary').locator('.MuiListItemText-primary');
        expect(await labels.count()).toBeGreaterThan(5);
        for (const label of await labels.all()) {
          expect(await label.evaluate(node => node.scrollWidth <= node.clientWidth &&
            node.getBoundingClientRect().height <= Number.parseFloat(getComputedStyle(node).lineHeight) + 1)).toBe(true);
        }
        await page.screenshot({ path: testInfo.outputPath(`locale-${language.code}-${width}-navigation.png`), animations: 'disabled' });
      }
      if (width === 375) {
        await page.keyboard.press('Escape');
        await page.setViewportSize({ width: 800, height: 375 });
        await page.goto('/app/gantt-chart');
        await waitForPageStable(page);
        const title = page.getByRole('banner').getByRole('heading', { level: 1 });
        expect(await title.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
        await expectNoHorizontalPageOverflow(page);
        await page.screenshot({ path: testInfo.outputPath(`locale-${language.code}-landscape-calendar.png`), animations: 'disabled' });
      }
      expect(serverErrors).toEqual([]);
    });
  }

  test(`${language.name} public pages use their own URLs and complete legal texts`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ locale: language.browserLocale, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto('/ueber?ref=localization');
    await expect.poll(() => new URL(page.url()).pathname).toBe(language.publicPaths[1]);
    expect(new URL(page.url()).search).toBe('?ref=localization');
    for (const path of language.publicPaths) {
      await page.goto(path, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator('html')).toHaveAttribute('lang', language.code);
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://openfarmplanner.org${path}`);
      await expectNoHorizontalPageOverflow(page);
      if (path === language.publicPaths[3] || path === language.publicPaths[4]) {
        await expect(page.locator('body')).toContainText(language.languageClause);
        await expect(page.locator('body')).toContainText(language.authoritativeClause);
      }
      await page.screenshot({ path: testInfo.outputPath(`locale-${language.code}-public-${path.split('/').pop()}.png`), animations: 'disabled' });
      await page.setViewportSize({ width: 375, height: 800 });
      await expectNoHorizontalPageOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`locale-${language.code}-public-mobile-${path.split('/').pop()}.png`), animations: 'disabled' });
      if (path === language.publicPaths[3] || path === language.publicPaths[4]) {
        const clause = page.getByText(language.languageClause, { exact: false });
        await clause.scrollIntoViewIfNeeded();
        await expect(clause).toBeInViewport({ ratio: 1 });
        await page.screenshot({ path: testInfo.outputPath(`locale-${language.code}-legal-clause-${path.split('/').pop()}.png`), animations: 'disabled' });
      }
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    await context.close();
  });

  test(`${language.name} library translations save without replacing the original description`, async ({ page, request }, testInfo) => {
    await loginWithDeterministicProject(page, request, `locale-${language.code}-library-translation`, { loginAsAdmin: true });
    const species = await apiRequest<{ results: { id: number; name: string }[] }>(page, 'GET', '/crop-species/?page_size=1');
    const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
      name: species.results[0].name, crop_species: species.results[0].id,
      variety: `${language.name} translation acceptance ${Date.now()}`, notes: 'Original English growing notes.',
      cultivation_types: ['direct_sowing'], growth_duration_days: 42, harvest_duration_days: 14,
    });
    const published = await apiRequest<{ public_crop: { id: number } }>(page, 'POST', `/crops/${crop.id}/publish-public/`, {
      accepted_public_library_terms: true, crop_species_id: species.results[0].id, original_language_code: 'en',
    });
    await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: language.code });
    await page.evaluate(code => {
      localStorage.setItem('ui.language', code);
      localStorage.setItem('ui.language.pendingChoice', code);
    }, language.code);
    await page.goto(`/app/crop-library?cropId=${published.public_crop.id}`);
    await page.getByRole('button', { name: language.translationAction }).click();
    const dialog = page.getByRole('dialog', { name: language.dialogTitle, exact: true });
    const editor = dialog.getByRole('textbox', { name: language.editorLabel });
    await expect(editor).toHaveAttribute('lang', language.code);
    await expect(editor).toHaveValue('');
    await expect(dialog).toContainText('Original English growing notes.');
    await editor.fill(language.description);
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: width === 375 ? 800 : 900 });
      await expectNoHorizontalPageOverflow(page);
      expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`locale-${language.code}-library-translation-${width}.png`), animations: 'disabled' });
    }
    const saved = page.waitForResponse(response => response.url().endsWith(`/public-crops/${published.public_crop.id}/translations/`) && response.request().method() === 'PUT');
    await dialog.getByRole('button', { name: language.saveLabel, exact: true }).click();
    expect((await saved).ok()).toBe(true);
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect(page.getByText(language.description, { exact: true })).toBeVisible();
    const stored = await apiRequest<{ translations: Record<string, string> }>(page, 'GET', `/public-crops/${published.public_crop.id}/translations/`);
    expect(stored.translations).toEqual({ en: 'Original English growing notes.', [language.code]: language.description });
  });

}

// The shared language-version sentence also grows in existing legal translations.
test('existing legal clauses fit on phones after adding languages', async ({ browser }, testInfo) => {
  for (const language of [
    { code: 'fr', clause: 'allemand, anglais, français, espagnol, italien, portugais et néerlandais', paths: ['/fr/confidentialite', '/fr/conditions-utilisation'] },
    { code: 'es', clause: 'alemán, inglés, francés, español, italiano, portugués y neerlandés', paths: ['/es/privacidad', '/es/terminos'] },
  ]) {
    const context = await browser.newContext({ locale: language.code, viewport: { width: 375, height: 800 } });
    const page = await context.newPage();
    for (const path of language.paths) {
      // The prerendered paragraph is replaced when the React app takes over.
      await page.goto(path, { waitUntil: 'networkidle' });
      const clause = page.getByText(language.clause, { exact: false });
      await clause.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      await expect(clause).toBeInViewport({ ratio: 1 });
      await expectNoHorizontalPageOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`locale-${language.code}-legal-clause-${path.split('/').pop()}.png`), animations: 'disabled' });
    }
    await context.close();
  }
});
