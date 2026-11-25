import { expect, test, type Page } from '@playwright/test';
import { apiRequest, expectNoHorizontalPageOverflow, loginWithDeterministicProject } from './utils';

test.use({ serviceWorkers: 'block' });

test('offers guidance when a season has no planting plans or recorded harvests', async ({ page, request }) => {
  await loginWithDeterministicProject(page, request, 'yield-comparison-empty-catalog', { loginAsAdmin: true });
  await apiRequest(page, 'POST', '/seasons/', { start_date: '2026-01-01', end_date: '2026-12-31' });
  await page.goto('/app/yield-overview');
  const topbar = page.getByTestId('topbar-workspace-controls');
  await topbar.getByRole('button', { name: 'Saisonen vergleichen' }).click();

  await expect(page.getByText('Lege einen Anbauplan an oder erfasse eine Ernte, um eine Kultur über mehrere Saisonen zu vergleichen.'))
    .toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
});

async function compareCrop(page: Page, crop: string) {
  await page.goto('/app/yield-overview');
  const topbar = page.getByTestId('topbar-workspace-controls');
  await expect(topbar.getByRole('button', { name: 'Prognosekalender' })).toHaveAttribute('aria-pressed', 'true');
  const compare = topbar.getByRole('button', { name: 'Saisonen vergleichen' });
  await compare.click();
  await expect(compare).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('table', { name: 'Alle Kulturen' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Saisonen' })).toHaveText('Letzte 3 Saisonen');
  await page.getByRole('combobox', { name: 'Saisonen' }).click();
  await page.getByRole('option', { name: 'Alle Saisonen', exact: true }).click();
  await page.getByRole('combobox', { name: 'Kultur' }).click();
  await page.getByRole('option', {
    name: crop === 'Tomate (Roma)' ? 'Tomate' : crop, exact: true,
  }).click();
  await page.getByRole('combobox', { name: 'Kultur' }).press('Escape');
  if (crop === 'Tomate (Roma)') {
    await page.getByRole('button', { name: 'Weitere Filter' }).click();
    await page.getByRole('combobox', { name: 'Sorte' }).click();
    await page.getByRole('option', { name: crop, exact: true }).click();
  }
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
  await expect(results.getByText('Nicht erfasst', { exact: true })).toHaveCount(3);

  const group = page.getByRole('figure', { name: 'Erntemengen nach Saison' });
  const values = group.getByRole('button', { name: /^Ertrag für 2026/ });
  await values.press('Enter');
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip.getByText('Erntemenge · 88,5 kg', { exact: true })).toBeVisible();
  await values.press('Escape');
  await expect(tooltip).toHaveCount(0);

  await results.locator('summary[aria-label="Termine und Beobachtungen · 2026"]').press('Enter');
  await expect(results.getByRole('heading', { name: 'Termine in der Anbausaison' })).toBeVisible();
  await expect(results.getByText('2 Tage später', { exact: true }).first()).toBeVisible();
  await expect(results.getByRole('heading', { name: 'Ertrag pro m² beernteter Fläche' })).toBeVisible();
  await expect(results.getByText(/16,5 m²/)).toBeVisible();

  const forecast = page.getByTestId('topbar-workspace-controls').getByRole('button', { name: 'Prognosekalender' });
  await forecast.press('Enter');
  await expect(forecast).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Monat', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Monat', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await expect(page.getByRole('heading', { name: 'Ertragsverteilung' })).toBeVisible();
  await expect(page.getByRole('main').getByText(/Prognose aus den Anbauplänen der aktiven Saison/)).toHaveCount(0);
  const help = page.getByRole('button', { name: 'Hilfe zu Ertragsübersicht öffnen' });
  await help.press('Enter');
  await expect(page.getByText('Hilfe: Ertragsübersicht', { exact: true })).toBeVisible();
  await expect(page.getByText(/Ertrag pro m².*geplanten Fläche.*berechneten Pflanzenzahl.*Erntezeitraums/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(help).toBeFocused();

  const segment = page.getByTestId('yield-chart-plot').getByRole('button', { name: /^Kartoffel,.*kg$/ }).first();
  await segment.press('Space');
  await expect(page.getByRole('tooltip').getByText('Erwarteter Ertrag', { exact: false })).toBeVisible();
});

test('combines searchable crop groups and preserves season and site filters when switching views', async ({ page, request }) => {
  await loginWithDeterministicProject(page, request, 'yield-comparison-filter-groups', {
    loginAsAdmin: true, demoProject: true, demoYear: 2026,
  });
  await apiRequest(page, 'POST', '/locations/', { name: 'Standort ohne Anbau' });
  await page.goto('/app/yield-overview');
  const topbar = page.getByTestId('topbar-workspace-controls');
  await topbar.getByRole('button', { name: 'Saisonen vergleichen' }).click();
  await expect(page.getByRole('table', { name: 'Alle Kulturen' }).locator('th[scope="row"]')).toHaveCount(3);
  await expect(page.getByText('Summe aus 3 Saisonen')).toBeVisible();
  const chart = page.getByRole('figure', { name: 'Erntemengen nach Saison' });
  await expect(chart.getByRole('button', { name: /^Ertrag für / })).toHaveCount(3);
  const matrix = page.getByRole('table', { name: 'Ertrag pro m² nach Kultur' });
  const potatoRow = matrix.getByRole('row', { name: /^Kartoffel/ });
  await expect(potatoRow.getByText('Nicht erfasst', { exact: true })).toHaveCount(2);
  await page.getByRole('combobox', { name: 'Saisonen' }).click();
  await page.getByRole('option', { name: 'Letzte 5 Saisonen', exact: true }).click();
  await expect(potatoRow.getByText('2024 → 2026')).toBeVisible();
  await expect(potatoRow.getByText('Nicht erfasst', { exact: true })).toHaveCount(3);
  const trend = matrix.getByRole('button', { name: 'Entwicklung', exact: true });
  await trend.click();
  await expect(matrix.getByRole('columnheader', { name: 'Entwicklung' })).toHaveAttribute('aria-sort', 'descending');
  await expect(matrix.locator('tbody tr').first()).toContainText('Kartoffel');
  const potato = potatoRow.getByRole('button', { name: 'Kartoffel', exact: true });
  await potato.press('Enter');
  const drilldown = page.getByRole('dialog', { name: 'Kartoffel' });
  await expect(drilldown.getByText('88,5 kg', { exact: true })).toBeVisible();
  await drilldown.locator('summary[aria-label="Termine und Beobachtungen · 2026"]').press('Enter');
  await expect(drilldown.getByRole('heading', { name: 'Termine in der Anbausaison' })).toBeVisible();
  await expect(drilldown.getByRole('link').first()).toHaveAttribute('href', /^\/app\/planting-plans\/\d+$/);
  await page.keyboard.press('Escape');
  await expect(drilldown).toBeHidden();
  await expect(potato).toBeFocused();
  const crops = page.getByRole('combobox', { name: 'Kultur' });
  await crops.fill('kartoff');
  await crops.press('ArrowDown');
  await crops.press('Enter');
  await expect(page.getByRole('table', { name: 'Kartoffel' })).toBeVisible();
  await crops.fill('roma tom');
  await page.getByRole('option', { name: 'Tomate', exact: true }).click();
  await crops.press('Escape');
  await expect(page.getByRole('table', { name: 'Ausgewählte Kulturen' })).toBeVisible();
  await expect(page.getByRole('meter', { name: 'Kulturen mit erfasster Ernte' })).toHaveAttribute('aria-valuetext', '2 von 2');
  await page.getByRole('combobox', { name: 'Standort' }).click();
  await page.getByRole('option', { name: 'Hofgarten', exact: true }).click();
  await page.getByRole('combobox', { name: 'Saisonen' }).click();
  await page.getByRole('option', { name: 'Letzte 5 Saisonen', exact: true }).click();
  await topbar.getByRole('button', { name: 'Prognosekalender' }).click();
  await topbar.getByRole('button', { name: 'Saisonen vergleichen' }).click();
  await expect(page.getByRole('combobox', { name: 'Standort' })).toHaveText('Hofgarten');
  await expect(page.getByRole('combobox', { name: 'Saisonen' })).toHaveText('Letzte 5 Saisonen');
  await expect(page.getByRole('table', { name: 'Ausgewählte Kulturen' })).toBeVisible();
  for (const [width, height] of [[375, 800], [800, 375], [768, 900], [1024, 900], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await expectNoHorizontalPageOverflow(page);
    if (width === 375) {
      const region = page.getByRole('region', { name: 'Ertrag pro m² nach Kultur' });
      await expect.poll(() => region.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
    }
    await page.screenshot({ path: test.info().outputPath(`yield-comparison-filters-${width}.png`) });
  }
  await page.getByRole('combobox', { name: 'Standort' }).click();
  await page.getByRole('option', { name: 'Standort ohne Anbau', exact: true }).click();
  await expect(chart.getByText('Für diese Auswahl sind keine Erntemengen oder Prognosen verfügbar.')).toBeVisible();
  await expect(chart.getByRole('button')).toHaveCount(0);
});

test.describe('touch comparison', () => {
  test.use({ hasTouch: true });

  test('opens forecast diagnostics by touch and returns to the warning when closed', async ({ page, request }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await loginWithDeterministicProject(page, request, 'yield-forecast-warning-touch', {
      loginAsAdmin: true, demoProject: true, demoYear: 2026,
    });
    await page.goto('/app/yield-overview');

    const warning = page.getByRole('button', { name: '1 ohne Prognose' });
    await expect(warning).toHaveAttribute('aria-expanded', 'false');
    await warning.tap();
    const details = page.getByRole('dialog', { name: 'Anbauplan ohne Prognose (1)' });
    await expect(details).toBeInViewport({ ratio: 1 });
    await expect(details).toHaveClass(/MuiDialog-paperFullScreen/);
    const plan = details.getByRole('link');
    await expect(plan).toHaveAttribute('href', /^\/app\/planting-plans\/\d+$/);
    await details.getByRole('button', { name: 'Schließen' }).tap();
    await expect(warning).toHaveAttribute('aria-expanded', 'false');
    await expect(details).toBeHidden();

    await page.setViewportSize({ width: 800, height: 375 });
    await warning.tap();
    await expect(details).toBeInViewport({ ratio: 1 });
    await expect(details).toHaveClass(/MuiDialog-paperFullScreen/);
    await plan.tap();
    await expect(page).toHaveURL(/\/app\/planting-plans\/\d+$/);
  });

  test('shows separate unit groups, estimated weight, unassigned harvest and losses', async ({ page, request }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await loginWithDeterministicProject(page, request, 'season-yield-compare-touch', {
      loginAsAdmin: true, demoProject: true, demoYear: 2026,
    });
    const results = await compareCrop(page, 'Tomate (Roma)');
    const summary = page.getByRole('main').locator('dl').filter({ hasText: 'Erfasste Erntemenge' });
    await expect(page.getByTestId('topbar-workspace-row').getByRole('button', { name: 'Saisonen vergleichen' })).toBeVisible();
    await expect(results.getByText('15,8 kg + 8 Stück', { exact: true })).toBeVisible();
    await expect(summary.getByText('15,8 kg + 8 Stück', { exact: true })).toBeVisible();
    await expect(results.getByText('0,88 kg geschätzt', { exact: true })).toBeVisible();
    await expect(results.getByText('3 kg ohne Zuordnung', { exact: true })).toBeVisible();
    const chart = page.getByRole('figure', { name: 'Erntemengen nach Saison' });
    const unit = chart.getByRole('combobox', { name: 'Einheit' });
    const current = chart.getByRole('button', { name: /^Ertrag für 2026/ });
    const tooltip = page.getByRole('tooltip');
    await current.tap();
    await expect(tooltip.getByText('Erntemenge · 15,8 kg · Teilwert', { exact: true })).toBeVisible();
    await expect(tooltip.getByText('Geschätztes Gewicht · 0,88 kg', { exact: true })).toBeVisible();
    await unit.tap();
    await page.getByRole('option', { name: 'Stück', exact: true }).tap();
    await expect(chart.getByText('Prognose nur in kg', { exact: true })).toBeVisible();
    await current.tap();
    await expect(tooltip.getByText(/^Erntemenge · 8 Stück/)).toBeVisible();
    await chart.getByRole('button', { name: /^Ertrag für 2025/ }).tap();
    await expect(tooltip.getByText('Erntemenge · Nicht erfasst', { exact: true })).toBeVisible();

    await results.locator('summary').first().tap();
    await expect(results.getByRole('heading', { name: 'Ausfälle', exact: true })).toBeVisible();
    await expect(results.getByText(/Totalausfall.*Krankheit/)).toBeVisible();
    expect(await results.evaluate(table => table.scrollWidth <= table.clientWidth + 1)).toBeTruthy();

    await page.getByRole('combobox', { name: 'Standort' }).tap();
    await page.getByRole('option', { name: 'Hofgarten', exact: true }).tap();
    await expect(results.getByText(/Anteile ohne Flächenzuordnung ausgeblendet/).first()).toBeVisible();
    await expect(summary.getByText('12,8 kg + 8 Stück', { exact: true })).toBeVisible();
    await expect(summary.getByText('Anteile ohne Flächenzuordnung ausgeblendet (2 Ernten)')).toBeVisible();
    await expect(unit).toHaveText('Stück');
    await expect(results.getByText('3 kg ohne Zuordnung', { exact: true })).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Standort' }).tap();
    await page.getByRole('option', { name: 'Alle Standorte', exact: true }).tap();
    await page.getByRole('button', { name: 'Kulturauswahl leeren' }).tap();
    await page.getByRole('combobox', { name: 'Kultur' }).tap();
    await page.getByRole('option', { name: 'Kartoffel', exact: true }).tap();
    await page.getByRole('combobox', { name: 'Kultur' }).press('Escape');
    await page.getByRole('figure').getByRole('button', { name: /^Ertrag für 2026/ }).tap();
    await expect(page.getByRole('tooltip').getByText('Erntemenge · 88,5 kg', { exact: true })).toBeVisible();
  });
});
