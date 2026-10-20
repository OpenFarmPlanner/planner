import { expect, test, type Page } from '@playwright/test';
import { fillLoginForm, setupUserWithoutProjects, submitLoginFormAndAwaitApp } from './utils';

// The UI language must survive a reload and a new tab no matter where it was
// switched. Asserted against the real backend because the bug lived in how
// the stored choice, the account value and the public pages (which skip the
// /auth/me/ probe) interact across page loads, which unit tests only model.

async function signIn(page: Page, request: Parameters<typeof setupUserWithoutProjects>[0], scenarioId: string) {
  const credentials = await setupUserWithoutProjects(request, scenarioId);
  await page.goto('/login');
  await fillLoginForm(page, credentials);
  await submitLoginFormAndAwaitApp(page, credentials);
}

const documentLanguage = (page: Page) => page.locator('html');

test('a language picked in the account settings survives a reload', async ({ page, request }) => {
  await signIn(page, request, 'language-persistence-settings');
  await page.goto('/app/account-settings');

  await page.getByRole('combobox', { name: 'Sprache' }).click();
  const saved = page.waitForResponse((response) => response.url().includes('/auth/account/language/'));
  await page.getByRole('option', { name: 'English' }).click();
  expect((await saved).ok()).toBe(true);
  await expect(documentLanguage(page)).toHaveAttribute('lang', 'en');

  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Language' })).toBeVisible();
  await expect(documentLanguage(page)).toHaveAttribute('lang', 'en');
});

test('a language picked on the landing page while signed in survives a new tab', async ({ page, context, request }) => {
  await signIn(page, request, 'language-persistence-landing');
  // An explicit account language is what used to win over the landing-page
  // choice; a fresh account ("auto") lets the local value through anyway.
  await page.goto('/app/account-settings');
  await page.getByRole('combobox', { name: 'Sprache' }).click();
  const saved = page.waitForResponse((response) => response.url().includes('/auth/account/language/'));
  await page.getByRole('option', { name: 'Deutsch' }).click();
  expect((await saved).ok()).toBe(true);

  await page.goto('/');
  await page.getByRole('button', { name: /^Sprache ändern/ }).click();
  await page.getByRole('menu').locator('[hreflang="fr"]').click();
  await expect(page).toHaveURL(/\/fr$/);
  await page.close();

  // A new tab has empty session storage; only what is in local storage and
  // the account carries over.
  const nextTab = await context.newPage();
  await nextTab.goto('/app/account-settings');
  await expect(nextTab.getByRole('combobox', { name: 'Langue' })).toBeVisible();
  await expect(documentLanguage(nextTab)).toHaveAttribute('lang', 'fr');

  const laterTab = await context.newPage();
  await nextTab.close();
  await laterTab.goto('/app/account-settings');
  await expect(laterTab.getByRole('combobox', { name: 'Langue' })).toBeVisible();
  await expect(documentLanguage(laterTab)).toHaveAttribute('lang', 'fr');
});
