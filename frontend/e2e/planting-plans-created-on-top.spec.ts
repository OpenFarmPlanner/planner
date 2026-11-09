import { expect, test } from '@playwright/test';
import { loginWithDeterministicProject } from './utils';

// Functional checks, not screenshots: a newly created planting plan is listed
// first (whatever the sort), is brought into view and keeps its place.

test('mobile: a new plan is listed first, scrolled into view and focused, even with a filter that hides it', async ({ page, request }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await loginWithDeterministicProject(page, request, `plans-created-on-top-${test.info().workerIndex}`, {
    demoProject: true,
    loginAsAdmin: true,
  });
  await page.goto('/app/planting-plans');
  const cards = page.locator('[data-mobile-card-id]');
  await expect(cards.first()).toBeVisible();
  const firstCardBefore = await cards.first().getAttribute('data-mobile-card-id');

  // A search the new plan will not match, and the end of the list in view.
  await page.getByRole('searchbox').first().fill(await cards.first().locator('h6, .MuiTypography-subtitle1').first().innerText());
  await cards.last().scrollIntoViewIfNeeded();

  await page.getByRole('button', { name: /^Anbauplan hinzufügen/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Anbauplan hinzufügen' });
  await dialog.getByRole('combobox').first().click();
  await page.getByRole('option').last().click();
  await dialog.getByRole('combobox').nth(1).click();
  await page.getByRole('option').first().click();
  await dialog.getByRole('textbox', { name: 'Pflanztermin', exact: true }).fill('20.12.2026');
  const created = page.waitForResponse((response) => response.url().endsWith('/api/planting-plans/') && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
  const createdId = String((await (await created).json()).id);

  await expect(cards.first()).toHaveAttribute('data-mobile-card-id', createdId);
  await expect(cards.first()).toHaveAttribute('data-flashing', 'true');
  await expect(cards.first()).toBeInViewport();
  await expect(cards.first().getByRole('button', { name: /^Aktionen/ })).toBeFocused();
  // The search the user typed is still applied.
  await expect(page.getByRole('searchbox').first()).not.toHaveValue('');

  // The flash ends; the position does not.
  await expect(cards.first()).not.toHaveAttribute('data-flashing', 'true', { timeout: 5000 });
  await expect(cards.first()).toHaveAttribute('data-mobile-card-id', createdId);

  // A reload sorts it back in.
  await page.reload();
  await expect(cards.first()).toBeVisible();
  await expect(cards.first()).toHaveAttribute('data-mobile-card-id', firstCardBefore ?? '');
});
