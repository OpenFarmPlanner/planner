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
