import { expect, test } from '@playwright/test';
import { loginWithDeterministicProject } from './utils';

test('keeps the original perennial visible and edits its removal date in the planting season', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, 'perennial-plan-occupancy', {
    demoProject: true, loginAsAdmin: true, demoYear: 2026,
  });

  await page.goto('/app/planting-plans');
  const search = page.getByRole('searchbox', { name: 'Anbaupläne durchsuchen' });
  const rows = page.locator('[role="row"][data-id]');
  await search.fill('Rhabarber');
  const rhubarb = rows.filter({ hasText: 'Rhabarber' });
  await expect(rhubarb.getByText('Aus Saison 2024')).toBeVisible();
  const planId = await rhubarb.getAttribute('data-id');
  await expect(page.getByRole('columnheader', { name: 'Saisonstatus' })).toHaveCount(0);

  await search.fill('');
  await page.getByRole('button', { name: 'Filter' }).click();
  await page.getByRole('group', { name: 'Belegung' })
    .getByRole('button', { name: 'Weiterlaufende Kulturen' }).click();
  await page.keyboard.press('Escape');
  await expect(rows.filter({ hasText: 'Knoblauch' }).first()).toBeVisible();
  await expect(rhubarb).toBeVisible();
  await expect(rows.filter({ hasText: 'Tomate' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Spalten', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Saisonstatus' }).check();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('columnheader', { name: 'Saisonstatus' })).toHaveCount(1);

  await page.goto('/app/gantt-chart?view=field');
  await page.getByRole('textbox', { name: 'Suche nach Kultur, Beet, Parzelle oder Standort…' }).fill('Rhabarber');
  const bar = page.getByTestId(`task-plan-${planId}-occupancy`);
  await expect(bar).toHaveAttribute('aria-label', /Rhabarber.*Läuft weiter aus Saison 2024/);
  await expect(page.getByTestId(`task-plan-${planId}-harvest`)).toHaveCount(0);
  await bar.hover();
  await expect(page.getByText('Räumungsdatum: 12.3.2030', { exact: true })).toBeVisible();

  await page.goto(`/app/planting-plans/${planId}`);
  await expect(page.getByText('Standzeit und Räumung', { exact: true })).toBeVisible();
  await expect(page.getByText('6 Jahre', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Räumungsdatum ändern' })).toHaveCount(0);
  await page.getByRole('button', { name: 'In ursprünglicher Saison öffnen' }).click();
  await expect(page.getByRole('button', { name: 'Aktive Saison wechseln' })).toContainText('2024');
  await expect(page).toHaveURL(new RegExp(`/planting-plans/${planId}$`));
  await page.getByRole('button', { name: 'Räumungsdatum ändern' }).click();
  await page.getByLabel('Räumungsdatum', { exact: true }).fill('2029-03-16');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByText(/16\.0?3\.2029/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/16\.0?3\.2029/)).toBeVisible();
});
