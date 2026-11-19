import { expect, test, type Page } from '@playwright/test';
import italian from '../src/i18n/locales/it/crops.json' with { type: 'json' };
import portuguese from '../src/i18n/locales/pt/crops.json' with { type: 'json' };
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../src/i18n/languages';
import { apiRequest, expectNoHorizontalPageOverflow, loginWithDeterministicProject, resetE2EScenario } from './utils';

test.use({ serviceWorkers: 'block', hasTouch: true });

async function addSpecies(
  page: Page, ids: number[], name: string, language: SupportedLanguage,
  commonName: string, synonyms: string[] = [],
) {
  const translations = SUPPORTED_LANGUAGES.map(({ code }) => ({
    language_code: code, common_name: code === language ? commonName : name,
    synonyms: code === language ? synonyms : [],
  }));
  const species = await apiRequest<{ id: number }>(page, 'POST', '/crop-species/', { name, translations });
  ids.push(species.id);
  await apiRequest(page, 'POST', `/crop-species/${species.id}/approve/`, { translations });
}

for (const scenario of [
  {
    language: 'it', phrase: 'Cavolo di Milano', official: 'Cavolo verza campione',
    alternative: 'Verza alternativa', text: italian, width: 1440, height: 900, touch: false,
  },
  {
    language: 'pt', phrase: 'Tomate de carne', official: 'Tomate carnudo amostra',
    alternative: 'Tomate alternativo', text: portuguese, width: 375, height: 800, touch: true,
  },
] as const) {
  test(`exact ${scenario.language} synonyms remain selectable through the capped publishing picker`, async ({ page, request }, testInfo) => {
    test.setTimeout(90_000);
    const { language, phrase, official, alternative, text, width, height, touch } = scenario;
    const stamp = Date.now();
    const scenarioId = `species-exact-synonym-${language}-${stamp}`;
    const query = `${phrase} 1159 ${stamp}`;
    const speciesIds: number[] = [];
    await loginWithDeterministicProject(page, request, scenarioId, { loginAsAdmin: true, libraryModerator: true });
    try {
      await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: language });
      await page.evaluate(choice => {
        localStorage.setItem('ui.language', choice);
        localStorage.setItem('ui.language.pendingChoice', choice);
      }, language);
      for (let index = 0; index < 21; index++) {
        await addSpecies(page, speciesIds, `Fixture ${stamp} partial ${index}`, language,
          `${query} ${index}`);
      }
      const firstOfficialName = `${official} ${stamp}`;
      const secondOfficialName = `${alternative} ${stamp}`;
      await addSpecies(page, speciesIds, `Fixture ${stamp} alias A`, language, firstOfficialName, [query]);
      await addSpecies(page, speciesIds, `Fixture ${stamp} alias B`, language, secondOfficialName, [query]);
      const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
        name: query, growth_duration_days: 60, harvest_duration_days: 20,
      });

      await page.setViewportSize({ width, height });
      await page.goto(`/app/crops?cropId=${crop.id}`);
      await page.getByTestId('crop-detail-publish-action').click();
      const wizard = page.getByRole('dialog', { name: text.library.publishWizard.title, exact: true });
      const picker = wizard.getByRole('combobox', { name: text.library.speciesPicker.label });
      const publish = wizard.getByRole('button', { name: text.library.publishWizard.publishNow, exact: true });
      await expect(picker).toHaveValue(query);
      const options = wizard.getByRole('listbox').getByRole('option');
      await expect(options).toHaveCount(20);
      const first = options.filter({ hasText: firstOfficialName });
      const second = options.filter({ hasText: secondOfficialName });
      const explanation = text.library.speciesPicker.matchSynonym
        .replace('<synonym>{{synonym}}</synonym>', query);
      await expect(first).toContainText(explanation);
      await expect(second).toContainText(explanation);
      await expect(first).toBeInViewport();
      await expect(second).toBeInViewport();
      await expect(wizard.getByTestId('propose-species-option')).toHaveCount(0);
      await expect(publish).toBeDisabled();
      await expectNoHorizontalPageOverflow(page);
      await page.screenshot({ path: testInfo.outputPath('capped-exact-synonyms.png'), animations: 'disabled' });

      if (touch) {
        await page.setViewportSize({ width: 800, height: 375 });
        await expect(first).toBeInViewport();
        await expectNoHorizontalPageOverflow(page);
        await page.screenshot({ path: testInfo.outputPath('capped-exact-synonyms-landscape.png'), animations: 'disabled' });
        await page.setViewportSize({ width, height });
        await second.tap();
      } else {
        await picker.press('ArrowDown');
        await expect(picker).toHaveAttribute('aria-activedescendant', (await first.getAttribute('id'))!);
        await picker.press('Enter');
      }
      const selectedName = touch ? secondOfficialName : firstOfficialName;
      await expect(wizard.getByText(text.library.speciesPicker.publishAsHelp
        .replace('{{localName}}', query).replace('{{officialName}}', selectedName), { exact: true })).toBeVisible();
      await expect(publish).toBeEnabled();
      await expect(wizard.getByRole('listbox')).toHaveCount(0);
    } finally {
      try {
        for (const id of speciesIds) {
          await apiRequest(page, 'DELETE', `/crop-species/${id}/?include_proposed=true`);
        }
      } finally {
        await resetE2EScenario(request, scenarioId);
      }
    }
  });
}
