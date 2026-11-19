import { expect, test } from '@playwright/test';
import { SUPPORTED_LANGUAGES } from '../src/i18n/languages';
import common from '../src/i18n/locales/de/common.json' with { type: 'json' };
import crops from '../src/i18n/locales/de/crops.json' with { type: 'json' };
import { apiRequest, expectNoHorizontalPageOverflow, loginWithDeterministicProject, resetE2EScenario } from './utils';

test.use({ hasTouch: true, serviceWorkers: 'block' });

for (const { width, height } of [
  { width: 375, height: 800 }, { width: 800, height: 375 }, { width: 1440, height: 900 },
]) {
  test(`the host species popup closes after focus moves away at ${width}x${height}`, async ({ page, request }, testInfo) => {
    const scenario = `host-species-popup-${width}-${Date.now()}`;
    const name = `Synthetic host popup ${scenario}`;
    const text = crops.plantHealthCatalogue;
    await page.setViewportSize({ width, height });
    await loginWithDeterministicProject(page, request, scenario, { loginAsAdmin: true, libraryModerator: true });
    try {
      const entry = await apiRequest<{ id: number }>(page, 'POST', '/plant-health/entries/', {
        name, kind: 'group', sources: [{ url: 'https://example.org/synthetic-host-evidence' }],
        translations: SUPPORTED_LANGUAGES.map(({ code }) => ({ language_code: code, preferred_name: name })),
      });
      await apiRequest(page, 'POST', `/plant-health/entries/${entry.id}/approve/`, {});
      const available = await apiRequest<{ results: { id: number; name: string }[] }>(page, 'GET', '/crop-species/?page_size=1');
      const officialName = available.results[0].name;
      await page.goto('/app/public-library-moderation');
      const catalog = page.getByRole('region', { name: text.title });
      await catalog.getByRole('combobox', { name: text.status, exact: true }).click();
      await page.getByRole('option', { name: text.statuses.published, exact: true }).click();
      await catalog.getByLabel(text.search).fill(name);
      await catalog.getByRole('article', { name, exact: true })
        .getByRole('button', { name: text.addHost, exact: true }).click();

      const host = page.getByRole('dialog', { name: text.addHost, exact: true });
      const content = host.locator('.MuiDialogContent-root');
      const picker = host.getByRole('combobox', { name: text.species, exact: true });
      const popup = host.locator('.MuiAutocomplete-popper');
      const noOptions = popup.getByText(crops.library.speciesPicker.noOptions, { exact: true });
      const variety = host.getByRole('textbox', { name: text.variety, exact: true });
      const qualification = host.getByRole('textbox', { name: text.qualification, exact: true });
      const save = host.getByRole('button', { name: common.actions.save, exact: true });
      const expectClosed = async () => {
        await expect(picker).toHaveAttribute('aria-expanded', 'false');
        await expect(popup).toBeHidden();
        await expect(host).toBeVisible();
      };

      await expect(noOptions).toBeVisible();
      await expect(picker).toBeFocused();
      await picker.press('Escape');
      await expectClosed();
      await expect(picker).toBeFocused();

      await picker.press('ArrowDown');
      await expect(noOptions).toBeVisible();
      await page.keyboard.press('Tab');
      await expect(variety).toBeFocused();
      await expectClosed();
      await variety.fill('Synthetic host variety');

      await picker.focus();
      await expect(noOptions).toBeVisible();
      await qualification.tap();
      await expect(qualification).toBeFocused();
      await expectClosed();

      for (let index = 0; index < 5; index++) {
        await host.getByRole('button', { name: text.addSource, exact: true }).click();
      }
      await picker.focus();
      await expect(noOptions).toBeVisible();
      await content.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await expect(popup).toHaveAttribute('data-popper-reference-hidden', '');
      await expect(popup).toBeHidden();
      await save.focus();
      await page.keyboard.press('Enter');
      const error = host.getByRole('alert').filter({ hasText: text.hostError });
      await expect(error).toBeFocused();
      await expectClosed();
      await expect(variety).toHaveValue('Synthetic host variety');
      await expectNoHorizontalPageOverflow(page);
      await page.screenshot({ path: testInfo.outputPath('host-validation-without-popup.png'), animations: 'disabled' });

      await picker.fill(officialName);
      await expect(picker).toHaveAttribute('aria-expanded', 'true');
      const option = popup.getByRole('option').filter({ hasText: officialName }).first();
      await expect(option).toBeInViewport();
      await option.tap();
      await expect(picker).toHaveValue(officialName);
      await expectClosed();
      await qualification.focus();
      await expect(picker).toHaveValue(officialName);
    } finally {
      await resetE2EScenario(request, scenario);
    }
  });
}
