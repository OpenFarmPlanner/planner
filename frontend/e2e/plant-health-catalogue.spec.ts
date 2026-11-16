import { expect, test } from '@playwright/test';
import { apiRequest, expectNoHorizontalPageOverflow, loginWithDeterministicProject, resetE2EScenario } from './utils';
import { SUPPORTED_LANGUAGES } from '../src/i18n/languages';
import de from '../src/i18n/locales/de/crops.json' with { type: 'json' };
import en from '../src/i18n/locales/en/crops.json' with { type: 'json' };
import fr from '../src/i18n/locales/fr/crops.json' with { type: 'json' };
import es from '../src/i18n/locales/es/crops.json' with { type: 'json' };
import it from '../src/i18n/locales/it/crops.json' with { type: 'json' };
import pt from '../src/i18n/locales/pt/crops.json' with { type: 'json' };
import nl from '../src/i18n/locales/nl/crops.json' with { type: 'json' };

const source = { url: 'https://example.org/synthetic-plant-health', title: 'Synthetic evidence, not production data' };
const bundles = { de, en, fr, es, it, pt, nl };
type Entry = { id: number; status: string; identity_key: string; translations: { language_code: string; synonyms: string[] }[] };

for (const width of [375, 800, 1440]) {
  test(`plant-health proposal, approval and sourced host moderation at ${width}px`, async ({ page, request }, testInfo) => {
    test.setTimeout(120_000);
    const scenario = `plant-health-flow-${width}-${Date.now()}`;
    await page.setViewportSize({ width, height: width === 800 ? 375 : width === 375 ? 800 : 900 });
    try {
      await loginWithDeterministicProject(page, request, scenario, { loginAsAdmin: true, libraryModerator: true });
      await page.goto('/app/public-library-moderation');
      const panel = page.getByRole('region', { name: de.plantHealthCatalogue.title });
      await panel.getByRole('button', { name: de.plantHealthCatalogue.add, exact: true }).click();
      const proposal = page.getByRole('dialog', { name: de.plantHealthCatalogue.add, exact: true });
      const name = `Synthetic catalogue ${scenario}`;
      await proposal.getByLabel('Name (Deutsch)', { exact: true }).fill(name);
      await proposal.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(proposal).not.toBeVisible();
      await panel.getByLabel(de.plantHealthCatalogue.search).fill(name);
      const card = panel.getByRole('article', { name, exact: true });
      await expect(card).toContainText(de.plantHealthCatalogue.statuses.proposed);
      const initial = await apiRequest<{ results: Entry[] }>(page, 'GET', `/plant-health/entries/?include_proposed=true&q=${encodeURIComponent(name)}`);
      const entry = initial.results[0];
      expect(entry.status).toBe('proposed');
      await apiRequest(page, 'PATCH', `/plant-health/entries/${entry.id}/`, {
        kind: 'pathogen', scientific_name: `Syntheticus ${scenario}`, sources: [source],
        translations: SUPPORTED_LANGUAGES.map(({ code }) => ({ language_code: code, preferred_name: name,
          synonyms: [`Alias ${scenario}`], regional_names: code === 'de' ? { AT: `Regional ${scenario}` } : {} })),
      });
      await page.reload();
      await panel.getByLabel(de.plantHealthCatalogue.search).fill(name);
      await card.getByRole('button', { name: de.plantHealthCatalogue.review, exact: true }).click();
      const review = page.getByRole('dialog', { name: de.plantHealthCatalogue.review, exact: true });
      await expect(review.getByRole('textbox', { name: de.plantHealthCatalogue.scientificName, exact: true })).toHaveValue(`Syntheticus ${scenario}`);
      await expectNoHorizontalPageOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`locale-plant-health-approval-${width}.png`), animations: 'disabled' });
      await review.getByRole('button', { name: de.plantHealthCatalogue.approve, exact: true }).click();
      await expect(review).not.toBeVisible();
      await panel.getByRole('combobox', { name: de.plantHealthCatalogue.status, exact: true }).click();
      await page.getByRole('option', { name: de.plantHealthCatalogue.statuses.published, exact: true }).click();
      await expect(card).toContainText(de.plantHealthCatalogue.statuses.published);
      await card.getByRole('button', { name: de.plantHealthCatalogue.addHost, exact: true }).click();
      const host = page.getByRole('dialog', { name: de.plantHealthCatalogue.addHost, exact: true });
      const species = await apiRequest<{ results: { id: number; name: string }[] }>(page, 'GET', '/crop-species/?page_size=1');
      await host.getByRole('combobox', { name: de.plantHealthCatalogue.species, exact: true }).fill(species.results[0].name);
      await page.getByRole('option').first().click();
      await host.getByLabel(de.plantHealthCatalogue.variety, { exact: true }).fill('Synthetic variety only');
      await host.getByLabel(de.plantHealthCatalogue.qualification, { exact: true }).fill('Synthetic evidence with a qualified scope.');
      await host.getByLabel(de.plantHealthCatalogue.confirmed, { exact: true }).check();
      await host.getByLabel(de.plantHealthCatalogue.sourceUrl, { exact: true }).fill(source.url);
      await page.screenshot({ path: testInfo.outputPath(`locale-plant-health-host-${width}.png`), animations: 'disabled' });
      await host.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(host).not.toBeVisible();
      await expect(card).toContainText('Synthetic variety only');
      await expect(card).toContainText(de.plantHealthCatalogue.confirmed);
      await panel.getByLabel(de.plantHealthCatalogue.search).fill(`Alias ${scenario}`);
      await expect(card).toBeVisible();
      await expectNoHorizontalPageOverflow(page);
      await page.mouse.move(1, 1);
      await expect(page.getByText(de.plantHealthCatalogue.saved, { exact: true })).not.toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`locale-plant-health-published-${width}.png`), animations: 'disabled' });
      await card.getByRole('button', { name: de.plantHealthCatalogue.history, exact: true }).click();
      const history = page.getByRole('dialog', { name: de.plantHealthCatalogue.history });
      await expect(history).toContainText(de.plantHealthCatalogue.historyActions.approve);
      await expect(history).toContainText(de.plantHealthCatalogue.historyActions.update_host);
      await expect(history).toContainText(de.library.anonymousAuthorNumbered.replace('{{number}}', '1'));
      await page.screenshot({ path: testInfo.outputPath(`locale-plant-health-history-${width}.png`), animations: 'disabled' });
      await history.getByRole('button', { name: 'Schließen', exact: true }).click();
      await card.getByRole('button', { name: de.plantHealthCatalogue.archive, exact: true }).click();
      const archive = page.getByRole('dialog', { name: de.plantHealthCatalogue.archive, exact: true });
      await archive.getByRole('button', { name: de.plantHealthCatalogue.archive, exact: true }).click();
      await expect(archive).not.toBeVisible();
      const final = await apiRequest<Entry>(page, 'GET', `/plant-health/entries/${entry.id}/`);
      expect(final.identity_key).toBe(entry.identity_key);
      expect(final.status).toBe('archived');
      expect(final.translations).toHaveLength(7);
      expect(final.translations.every(row => row.synonyms.includes(`Alias ${scenario}`))).toBe(true);
      await panel.getByRole('combobox', { name: de.plantHealthCatalogue.status, exact: true }).click();
      await page.getByRole('option', { name: de.plantHealthCatalogue.statuses.archived, exact: true }).click();
      await card.getByRole('button', { name: de.plantHealthCatalogue.archiveHost, exact: true }).click();
      const archiveHost = page.getByRole('dialog', { name: de.plantHealthCatalogue.archiveHost, exact: true });
      await expect(archiveHost).toContainText(name);
      await expect(archiveHost).toContainText('Synthetic variety only');
      await page.screenshot({ path: testInfo.outputPath(`locale-plant-health-archive-host-${width}.png`), animations: 'disabled' });
      await archiveHost.getByRole('button', { name: de.plantHealthCatalogue.archiveHost, exact: true }).click();
      await expect(archiveHost).not.toBeVisible();
      await expect(card).toContainText(de.plantHealthCatalogue.noHosts);
      const hosts = await apiRequest<{ results: { is_active: boolean }[] }>(page, 'GET', `/plant-health/hosts/?entry=${entry.id}`);
      expect(hosts.results).toHaveLength(1);
      expect(hosts.results[0].is_active).toBe(false);

    } finally { await resetE2EScenario(request, scenario); }
  });
}

for (const { code } of SUPPORTED_LANGUAGES) {
  for (const width of [375, 1440]) {
    test(`plant-health ${code} proposal editor fits at ${width}px`, async ({ page, request }, testInfo) => {
      const scenario = `plant-health-${code}-${width}-${Date.now()}`;
      const text = bundles[code].plantHealthCatalogue;
      await page.setViewportSize({ width, height: width === 375 ? 800 : 900 });
      try {
        await loginWithDeterministicProject(page, request, scenario, { loginAsAdmin: true, libraryModerator: true });
        await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: code });
        await page.evaluate(language => { localStorage.setItem('ui.language', language); }, code);
        await page.goto('/app/public-library-moderation');
        await expect(page.locator('html')).toHaveAttribute('lang', code);
        const panel = page.getByRole('region', { name: text.title });
        const status = panel.getByRole('combobox', { name: text.status, exact: true });
        await expect(status).toBeVisible();
        expect(await status.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
        if (width === 1440 && (code === 'nl' || code === 'es')) {
          await status.scrollIntoViewIfNeeded();
          await page.screenshot({ path: testInfo.outputPath(`locale-plant-health-${code}-status-${width}.png`), animations: 'disabled' });
        }
        await panel.getByRole('button', { name: text.add, exact: true }).click();
        const editor = page.getByRole('dialog', { name: text.add, exact: true });
        await expect(editor).toContainText(text.proposalHint);
        await expectNoHorizontalPageOverflow(page);
        expect(await editor.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`locale-plant-health-${code}-editor-${width}.png`), animations: 'disabled' });
        if (width === 375) {
          await editor.locator(`input[lang="${code}"]`).fill('Synthetic regional-name fixture');
          await editor.getByRole('button', { name: text.addRegion, exact: true }).click();
          await editor.getByRole('textbox', { name: text.countryCode, exact: true }).fill('AT');
          await editor.getByRole('textbox', { name: text.regionalName, exact: true }).fill('Synthetic regional label');
          await expectNoHorizontalPageOverflow(page);
          await page.screenshot({ path: testInfo.outputPath(`locale-plant-health-${code}-regional-${width}.png`), animations: 'disabled' });
        }

      } finally { await resetE2EScenario(request, scenario); }
    });
  }
}

for (const width of [375, 1440]) {
  test(`plant-health moderation returns from an emptied second page at ${width}px`, async ({ page, request }, testInfo) => {
    test.setTimeout(120_000);
    const scenario = `plant-health-pagination-${width}-${Date.now()}`;
    const prefix = `Synthetic pagination ${scenario}`;
    await page.setViewportSize({ width, height: width === 375 ? 800 : 900 });
    try {
      await loginWithDeterministicProject(page, request, scenario, { loginAsAdmin: true, libraryModerator: true });
      for (let index = 0; index < 21; index++) {
        const name = `${prefix} ${String(index).padStart(2, '0')}`;
        await apiRequest(page, 'POST', '/plant-health/entries/', {
          name, kind: 'group', translations: [{ language_code: 'de', preferred_name: name }],
        });
      }
      await page.goto('/app/public-library-moderation');
      const panel = page.getByRole('region', { name: de.plantHealthCatalogue.title });
      await panel.getByLabel(de.plantHealthCatalogue.search).fill(prefix);
      await expect(panel.getByRole('article')).toHaveCount(20);
      await panel.getByRole('navigation').getByRole('button', { name: /2/ }).click();
      await expect(panel.getByRole('article')).toHaveCount(1);
      const card = panel.getByRole('article');
      const removedName = await card.getAttribute('aria-label');
      await card.getByRole('button', { name: de.plantHealthCatalogue.reject, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: de.plantHealthCatalogue.reject, exact: true });
      await dialog.getByRole('button', { name: de.plantHealthCatalogue.reject, exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect(panel.getByRole('article')).toHaveCount(20);
      await expect(panel.getByRole('article', { name: removedName!, exact: true })).toHaveCount(0);
      await expect(panel.getByLabel(de.plantHealthCatalogue.search)).toHaveValue(prefix);
      await expect(panel.getByRole('combobox', { name: de.plantHealthCatalogue.status, exact: true })).toContainText(de.plantHealthCatalogue.statuses.proposed);
      await expect(panel.getByRole('navigation')).toHaveCount(0);
      await panel.getByRole('article').first().scrollIntoViewIfNeeded();
      await expectNoHorizontalPageOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`plant-health-pagination-${width}.png`), animations: 'disabled' });
    } finally { await resetE2EScenario(request, scenario); }
  });
}

for (const { width, language } of [{ width: 375, language: 'de' }, { width: 800, language: 'de' }, { width: 1440, language: 'de' }, { width: 375, language: 'fr' }] as const) {
  test(`plant-health approval reveals repeated validation and server feedback in ${language} at ${width}px`, async ({ page, request }, testInfo) => {
    test.setTimeout(120_000);
    const scenario = `plant-health-feedback-${language}-${width}-${Date.now()}`;
    const name = `Synthetic feedback ${scenario}`;
    const text = bundles[language].plantHealthCatalogue;
    await page.setViewportSize({ width, height: width === 800 ? 375 : width === 375 ? 800 : 900 });
    try {
      await loginWithDeterministicProject(page, request, scenario, { loginAsAdmin: true, libraryModerator: true });
      await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: language });
      await page.evaluate(code => localStorage.setItem('ui.language', code), language);
      const entry = await apiRequest<Entry>(page, 'POST', '/plant-health/entries/', {
        name, kind: 'group', sources: [source], translations: [{ language_code: 'de', preferred_name: name }],
      });
      await page.goto('/app/public-library-moderation');
      const panel = page.getByRole('region', { name: text.title });
      await panel.getByLabel(text.search).fill(name);
      await panel.getByRole('article', { name, exact: true }).getByRole('button', { name: text.review, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: text.review, exact: true });
      const content = dialog.locator('.MuiDialogContent-root');
      const approve = dialog.getByRole('button', { name: text.approve, exact: true });
      const error = dialog.getByRole('alert').filter({ hasText: text.saveError });
      const guidance = dialog.getByText(text.approvalHint, { exact: true });
      const backgroundScroll = () => page.evaluate(() => ({
        window: window.scrollY,
        containers: Array.from(document.querySelectorAll('main, [role="main"]')).map(node => node.scrollTop),
      }));
      const initialScroll = await backgroundScroll();
      const submitFromBottom = async () => {
        await content.evaluate(node => { node.scrollTop = node.scrollHeight; });
        expect(await content.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
        const hiddenGuidance = await guidance.boundingBox();
        const viewport = await content.boundingBox();
        expect(hiddenGuidance!.y + hiddenGuidance!.height).toBeLessThanOrEqual(viewport!.y);
        await approve.focus();
        await page.keyboard.press('Enter');
        await expect(error).toBeFocused();
        await expect(error).toHaveAttribute('aria-atomic', 'true');
        await expect(error).toHaveAccessibleDescription(text.approvalHint);
        const bounds = await error.boundingBox();
        const title = await dialog.locator('.MuiDialogTitle-root').boundingBox();
        const actions = await dialog.locator('.MuiDialogActions-root').boundingBox();
        expect(bounds!.y).toBeGreaterThanOrEqual(viewport!.y);
        expect(bounds!.y).toBeGreaterThanOrEqual(title!.y + title!.height);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(Math.min(viewport!.y + viewport!.height, actions!.y));
        expect(await backgroundScroll()).toEqual(initialScroll);
        await expect(dialog.locator('input[lang="de"]')).toHaveValue(name);
        await expect(dialog.getByLabel(text.sourceUrl, { exact: true })).toHaveValue(source.url);
      };
      await submitFromBottom();
      await submitFromBottom();
      await expectNoHorizontalPageOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`plant-health-feedback-${width}.png`), animations: 'disabled' });
      for (const { code, label } of SUPPORTED_LANGUAGES) {
        if (code === 'de') continue;
        const section = dialog.getByRole('button', { name: label, exact: true });
        if (await section.getAttribute('aria-expanded') !== 'true') await section.click();
        await dialog.locator(`input[lang="${code}"]`).fill(`${name} ${code}`);
      }
      const approvalUrl = `**/api/plant-health/entries/${entry.id}/approve/`;
      let failedRequests = 0;
      await page.route(approvalUrl, route => {
        failedRequests++;
        return route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"Synthetic failure"}' });
      });
      await submitFromBottom();
      expect(failedRequests).toBe(1);
      await submitFromBottom();
      expect(failedRequests).toBe(2);
      for (const { code } of SUPPORTED_LANGUAGES) {
        await expect(dialog.locator(`input[lang="${code}"]`)).toHaveValue(code === 'de' ? name : `${name} ${code}`);
      }
      await page.unroute(approvalUrl);
      await content.evaluate(node => { node.scrollTop = node.scrollHeight; });
      await approve.click();
      await expect(dialog).not.toBeVisible();
      await expect(page.getByText(text.saved, { exact: true })).toBeVisible();
      const published = await apiRequest<Entry>(page, 'GET', `/plant-health/entries/${entry.id}/`);
      expect(published.status).toBe('published');
      expect(published.translations).toHaveLength(SUPPORTED_LANGUAGES.length);
    } finally { await resetE2EScenario(request, scenario); }
  });
}
