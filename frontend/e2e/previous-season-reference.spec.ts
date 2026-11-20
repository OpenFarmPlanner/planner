import { expect, test } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject } from './utils';

test.use({ serviceWorkers: 'block' });

test('opens a read-only reference in the desktop drawer and follows its source season', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, 'copied-plan-reference-drawer', {
    loginAsAdmin: true, demoProject: true, demoYear: 2026,
  });
  await page.goto('/app/planting-plans');
  await page.getByRole('searchbox', { name: 'Anbaupläne durchsuchen' }).fill('Karotte');
  const row = page.locator('[role="row"][data-id]').filter({ hasText: 'Karotten 2' });
  await expect(row).toHaveCount(1);
  const crop = row.locator('[data-field="crop"]');
  await crop.click();
  await crop.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Anbauplan-Details' }).click();

  const drawer = page.getByRole('dialog', { name: 'Anbauplan-Details' });
  const heading = drawer.getByRole('button', { name: 'Vorherige Saison: 2025' });
  const region = drawer.getByRole('region', { name: 'Vorherige Saison: 2025' });
  await expect(heading).toHaveAttribute('aria-expanded', 'true');
  await expect(region.getByText('Referenz', { exact: true })).toBeVisible();
  await expect(region.getByText('Ist-Aussaattermin', { exact: true })).toBeVisible();
  await expect(region.getByText('17.3.2025', { exact: true })).toBeVisible();
  await expect(region.getByText('2,75 kg + 6 Bunde', { exact: true })).toBeVisible();
  await expect(region.getByText('1 Ausfall', { exact: true })).toBeVisible();
  await expect(region.getByRole('textbox')).toHaveCount(0);
  await expect(drawer.getByText('Diesem Anbauplan sind keine Ernten zugeordnet.')).toBeVisible();
  await expect(drawer.getByText('Keine Ausfälle erfasst.')).toBeVisible();

  await heading.press('Space');
  await expect(heading).toHaveAttribute('aria-expanded', 'false');
  await expect(region).toHaveCount(0);
  await heading.press('Enter');
  const source = region.getByRole('link', { name: 'Ursprünglichen Anbauplan öffnen' });
  await expect(source).toHaveAttribute('href', /\/app\/planting-plans\/\d+$/);
  const sourceId = (await source.getAttribute('href'))!.split('/').at(-1);
  await source.press('Enter');

  await expect(page).toHaveURL(new RegExp('/app/planting-plans/' + sourceId + '$'));
  await expect(page.getByRole('heading', { name: 'Karotte (Nantaise 2)', level: 1 })).toBeVisible();
  await expect(page.getByText('Salat 2', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aktive Saison wechseln' })).toContainText('2025');
  await expect(page.getByRole('button', { name: /^Vorherige Saison/ })).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Ausfälle' }).getByText(/Trockenheit/)).toBeVisible();
});

test.describe('touch reference', () => {
  test.use({ hasTouch: true });

  test('shows an empty then unavailable source on a mobile direct link', async ({ page, request }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await loginWithDeterministicProject(page, request, 'copied-plan-reference-empty', { loginAsAdmin: true });
    const longLabel = 'SehrLangeAnbausaisonMitEinemUnunterbrochenenNamen · September bis August';
    const source = await apiRequest<{ id: number }>(page, 'POST', '/seasons/', {
      start_date: '2025-09-01', end_date: '2026-08-31', custom_label: longLabel,
    });
    const target = await apiRequest<{ id: number }>(page, 'POST', '/seasons/', {
      start_date: '2026-09-01', end_date: '2027-08-31', custom_label: 'Zielsaison',
    });
    const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', { name: 'Referenz-Karotte' });
    const original = await apiRequest<{ id: number }>(page, 'POST', '/planting-plans/', {
      crop: crop.id, planting_date: '2026-03-20', season: source.id,
    });
    await apiRequest(page, 'POST', `/seasons/${target.id}/copy-from/`, { source_season_id: source.id });
    const plans = await apiRequest<{ results: Array<{ id: number; season: number }> }>(page, 'GET', '/planting-plans/');
    const copy = plans.results.find(plan => plan.season === target.id)!;
    await page.goto(`/app/planting-plans/${copy.id}`);

    const toggle = page.getByRole('button', { name: `Vorherige Saison: ${longLabel}` });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.tap();
    await expect(page.getByText('Für den ursprünglichen Anbauplan sind keine Ist-Daten erfasst.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ursprünglichen Anbauplan öffnen' })).toBeVisible();
    expect(await toggle.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBeTruthy();

    await apiRequest(page, 'DELETE', `/planting-plans/${original.id}/`);
    await page.reload();
    const unavailable = page.getByRole('button', { name: 'Vorherige Saison', exact: true });
    await expect(unavailable).toHaveAttribute('aria-expanded', 'false');
    await unavailable.tap();
    await expect(page.getByText('Die Referenzdaten sind nicht verfügbar.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ursprünglichen Anbauplan öffnen' })).toHaveCount(0);
  });
});
