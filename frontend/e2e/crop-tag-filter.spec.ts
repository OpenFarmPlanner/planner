import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';
import de from '../src/i18n/locales/de/crops.json' with { type: 'json' };
import en from '../src/i18n/locales/en/crops.json' with { type: 'json' };
import fr from '../src/i18n/locales/fr/crops.json' with { type: 'json' };
import es from '../src/i18n/locales/es/crops.json' with { type: 'json' };
import { apiRequest, loginWithDeterministicProject } from './utils';

const languages = { de, en, fr, es };
type Language = keyof typeof languages;
const tagA = 'Aromatic';
const tagB = 'Flowering';
const longTag = 'A deliberately long project tag that wraps on narrow screens';

async function checkTagFilter(
  page: Page,
  request: APIRequestContext,
  testInfo: TestInfo,
  language: Language,
  width: number,
  height: number,
  touch = false,
): Promise<void> {
  const text = languages[language];
  await loginWithDeterministicProject(page, request, `tag-filter-${language}-${width}-${height}-${touch}`, { loginAsAdmin: true });
  await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: language });
  await page.evaluate(choice => {
    localStorage.setItem('ui.language', choice);
    localStorage.setItem('ui.language.pendingChoice', choice);
  }, language);
  const both = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: 'Both tags', tags: [tagA, tagB],
  });
  for (const [name, tags] of [
    ['First tag only', [tagA]], ['Second tag only', [tagB]], ['Long tag only', [longTag]],
  ] as const) {
    await apiRequest(page, 'POST', '/crops/', { name, tags });
  }
  await page.setViewportSize({ width, height });
  await page.goto(`/app/crops?cropId=${both.id}`);
  await expect(page.locator('html')).toHaveAttribute('lang', language);
  if (width < 600 || (width < 900 && height <= 560)) {
    await page.getByRole('button', { name: text.selectCrop, exact: true }).click();
  }
  const openFilters = page.getByRole('button', { name: text.filters.openAdvanced, exact: true });
  const tags = page.getByRole('combobox', { name: text.filters.tag, exact: true });
  const choose = async (label: string): Promise<void> => {
    const option = page.getByRole('option', { name: label, exact: true });
    if (touch) await option.tap();
    else if (width === 1440) await option.press('Enter');
    else await option.click();
  };
  const openTagMenu = async (): Promise<void> => {
    if (touch) {
      await openFilters.tap();
      await tags.tap();
    } else {
      await openFilters.click();
      await tags.click();
    }
  };

  await openTagMenu();
  await choose(tagA);
  await choose(tagB);
  const menu = page.getByRole('listbox', { name: text.filters.tag, exact: true });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute('aria-multiselectable', 'true');
  for (const name of [tagA, tagB]) {
    await expect(menu.getByRole('option', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
  }
  expect(await menu.evaluate(element => element.scrollWidth > element.clientWidth + 1)).toBe(false);
  const bounds = await menu.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height);
  await page.screenshot({ path: testInfo.outputPath('tag-menu.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(tags).toHaveText(text.filters.tagsSelected_other.replace('{{count}}', '2'));
  await page.screenshot({ path: testInfo.outputPath('tag-summary.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('option', { name: 'Both tags', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'First tag only', exact: true })).toHaveCount(0);
  await expect(page.getByRole('option', { name: 'Second tag only', exact: true })).toHaveCount(0);

  await openTagMenu();
  await choose(tagB);
  await expect(menu.getByRole('option', { name: tagB, exact: true })).toHaveAttribute('aria-selected', 'false');
  await choose(text.filters.clearSelection);
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('option', { name: 'First tag only', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Second tag only', exact: true })).toBeVisible();

  await openTagMenu();
  await choose(tagA);
  await choose(tagB);
  await page.keyboard.press('Escape');
  const reset = page.getByRole('button', { name: text.filters.reset, exact: true });
  if (touch) await reset.tap();
  else await reset.click();
  await expect(page.getByRole('option', { name: 'First tag only', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Second tag only', exact: true })).toBeVisible();
}

for (const [language, width, height] of [
  ['en', 375, 800], ['en', 768, 900], ['en', 1024, 900], ['en', 1440, 900], ['en', 800, 375],
  ['de', 375, 800], ['fr', 375, 800], ['es', 375, 800],
] as const) {
  test(`AND tag filter in ${language} at ${width}x${height}`, async ({ page, request }, testInfo) => {
    await checkTagFilter(page, request, testInfo, language, width, height);
  });
}

test.describe('touch tag filtering', () => {
  test.use({ hasTouch: true });
  test('selects, deselects, clears and resets tags by touch', async ({ page, request }, testInfo) => {
    await checkTagFilter(page, request, testInfo, 'en', 375, 800, true);
  });
});
