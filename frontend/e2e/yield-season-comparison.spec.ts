import { expect, test, type Page } from '@playwright/test';
import { loginWithDeterministicProject } from './utils';

test.use({ serviceWorkers: 'block' });

async function compareCrop(page: Page, crop: string) {
  await page.goto('/app/yield-overview');
  const topbar = page.getByTestId('topbar-workspace-controls');
  await expect(topbar.getByRole('button', { name: 'Prognosekalender' })).toHaveAttribute('aria-pressed', 'true');
  const compare = topbar.getByRole('button', { name: 'Saisonen vergleichen' });
  await compare.click();
  await expect(compare).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('combobox', { name: 'Kultur' }).click();
  await page.getByRole('option', { name: crop, exact: true }).click();
  return page.getByRole('table', { name: crop });
}

test('compares measured yields and exposes a table and actual date deviations with the keyboard', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, 'season-yield-compare-desktop', {
    loginAsAdmin: true, demoProject: true, demoYear: 2026,
  });
  const results = await compareCrop(page, 'Kartoffel');
  await expect(results.getByText('Ertragsprognose', { exact: true })).toBeVisible();
  await expect(results.getByText('88,5 kg', { exact: true })).toBeVisible();
  await expect(results.getByText('91,75 kg', { exact: true })).toBeVisible();
  await expect(results.getByText('Nicht erfasst', { exact: true })).toHaveCount(2);

  const group = page.getByRole('figure', { name: 'Vergleichbarer Ertrag' });
  const values = group.getByRole('button', { name: /^Ertrag für 2026/ });
  await values.press('Enter');
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip.getByText('Erntemenge · 88,5 kg', { exact: true })).toBeVisible();
  await values.press('Escape');
  await expect(tooltip).toHaveCount(0);

  await results.locator('summary').first().press('Enter');
  await expect(results.getByRole('heading', { name: 'Termine in der Anbausaison' })).toBeVisible();
  await expect(results.getByText('2 Tage später', { exact: true }).first()).toBeVisible();
  await expect(results.getByRole('heading', { name: 'Ertrag pro m² beernteter Fläche' })).toBeVisible();
  await expect(results.getByText(/16,5 m²/)).toBeVisible();

  const forecast = page.getByTestId('topbar-workspace-controls').getByRole('button', { name: 'Prognosekalender' });
  await forecast.press('Enter');
  await expect(forecast).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Monat', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Monat', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test.describe('touch comparison', () => {
  test.use({ hasTouch: true });

  test('shows mixed units, estimated weight, unassigned harvest, and losses without a paired chart', async ({ page, request }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await loginWithDeterministicProject(page, request, 'season-yield-compare-touch', {
      loginAsAdmin: true, demoProject: true, demoYear: 2026,
    });
    const results = await compareCrop(page, 'Tomate (Roma)');
    await expect(page.getByTestId('topbar-workspace-row').getByRole('button', { name: 'Saisonen vergleichen' })).toBeVisible();
    await expect(results.getByText('15,8 kg + 8 Stück', { exact: true })).toBeVisible();
    await expect(results.getByText('0,88 kg geschätzt', { exact: true })).toBeVisible();
    await expect(results.getByText('3 kg ohne Zuordnung', { exact: true })).toBeVisible();
    await expect(page.getByRole('figure').getByRole('button')).toHaveCount(0);
    await expect(page.getByText(/Für keine Saison liegen gewogene Ernten/)).toBeVisible();

    await results.locator('summary').first().tap();
    await expect(results.getByRole('heading', { name: 'Ausfälle', exact: true })).toBeVisible();
    await expect(results.getByText(/Totalausfall.*Krankheit/)).toBeVisible();
    expect(await results.evaluate(table => table.scrollWidth <= table.clientWidth + 1)).toBeTruthy();

    await page.getByRole('combobox', { name: 'Kultur' }).tap();
    await page.getByRole('option', { name: 'Kartoffel', exact: true }).tap();
    await page.getByRole('figure').getByRole('button', { name: /^Ertrag für 2026/ }).tap();
    await expect(page.getByRole('tooltip').getByText('Erntemenge · 88,5 kg', { exact: true })).toBeVisible();
  });
});
