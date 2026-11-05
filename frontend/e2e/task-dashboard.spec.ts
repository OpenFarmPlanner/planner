import { expect, test, type Page } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject } from './utils';

async function seedTasks(page: Page) {
  const season = await apiRequest<{ id: number }>(page, 'POST', '/seasons/', {
    start_date: '2026-01-01', end_date: '2026-12-31',
  });
  const projectId = await page.evaluate(() => localStorage.getItem('activeProjectId'));
  await page.evaluate(({ projectId, seasonId }) => {
    localStorage.setItem(`activeSeasonId:${projectId}`, String(seasonId));
  }, { projectId, seasonId: season.id });
  const location = await apiRequest<{ id: number }>(page, 'POST', '/locations/', { name: 'Hof' });
  const field = await apiRequest<{ id: number }>(page, 'POST', '/fields/', { name: 'Nordparzelle', location: location.id });
  const bed = await apiRequest<{ id: number }>(page, 'POST', '/beds/', { name: 'Beet A', field: field.id, area_sqm: 20 });
  const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', { name: 'Salat', variety: 'Maikönig' });
  const plan = await apiRequest<{ id: number }>(page, 'POST', '/planting-plans/', {
    crop: crop.id, bed: bed.id, season: season.id, planting_date: '2026-11-01',
  });
  for (const [title, status] of [['Jäten', 'pending'], ['Bewässerung kontrollieren', 'in_progress'], ['Werkzeuge reinigen', 'completed']]) {
    await apiRequest(page, 'POST', '/tasks/', {
      title, status, season: season.id, due_date: '2026-11-05', planting_plan: plan.id,
    });
  }
  await page.goto('/app/dashboard');
  await expect(page.getByRole('heading', { name: 'Aufgaben-Dashboard' })).toBeVisible();
}

async function dragTask(page: Page, title: string, status: string) {
  const handle = page.getByRole('button', { name: `Aufgabe verschieben: ${title}` });
  const target = page.locator(`[data-task-column="${status}"]`);
  const start = await handle.boundingBox();
  const end = await target.boundingBox();
  if (!start || !end) throw new Error('Missing task handle or column');
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + 12, start.y + start.height / 2, { steps: 4 });
  await page.mouse.move(end.x + end.width / 2, end.y + 50, { steps: 20 });
  await page.mouse.up();
}

test.beforeEach(async ({ page, request }, testInfo) => {
  await loginWithDeterministicProject(page, request, `task-board-${testInfo.workerIndex}`, { loginAsAdmin: true });
  await seedTasks(page);
});

test('drag persists to the API and a failed drop rolls back', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const moved = page.waitForResponse((response) => response.url().includes('/api/tasks/') && response.request().method() === 'PATCH');
  await dragTask(page, 'Jäten', 'completed');
  expect((await moved).ok()).toBeTruthy();
  await expect(page.getByRole('region', { name: 'Erledigt', exact: true }).getByRole('article', { name: 'Jäten', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Erledigt', exact: true }).getByRole('article', { name: 'Jäten', exact: true })).toBeVisible();
  await page.route('**/api/tasks/*/', async (route) => {
    if (route.request().method() === 'PATCH') await route.fulfill({ status: 500, body: 'Unavailable' });
    else await route.continue();
  });
  await dragTask(page, 'Jäten', 'pending');
  await expect(page.getByRole('alert')).toContainText('Die Änderung wurde zurückgenommen');
  await expect(page.getByRole('region', { name: 'Erledigt', exact: true }).getByRole('article', { name: 'Jäten', exact: true })).toBeVisible();
});

test('mobile list supports status changes with the keyboard and filters', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await expect(page.getByRole('button', { name: 'Aufgabe verschieben: Jäten' })).toHaveCount(0);
  const menu = page.getByRole('button', { name: 'Status ändern: Jäten' });
  await menu.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: 'In Arbeit', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'In Arbeit', exact: true }).getByRole('article', { name: 'Jäten', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Aufgaben filtern' }).click();
  await page.getByRole('combobox', { name: 'Zeitraum' }).click();
  await page.getByRole('option', { name: 'Eigener Zeitraum' }).click();
  await page.getByLabel('Von', { exact: true }).fill('2027-01-01');
  await expect(page.getByText('Keine Aufgaben passen zu diesen Filtern.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Filter zurücksetzen' }).click();
  await expect(page.getByRole('article', { name: 'Jäten', exact: true })).toBeVisible();
});

test('captures the populated dashboard at all breakpoints for visual review', async ({ page }, testInfo) => {
  for (const viewport of [{ width: 375, height: 800 }, { width: 768, height: 900 },
    { width: 1024, height: 900 }, { width: 1440, height: 900 }, { width: 800, height: 375 }]) {
    await page.setViewportSize(viewport);
    await page.screenshot({ path: testInfo.outputPath(`dashboard-${viewport.width}x${viewport.height}.png`), fullPage: true, animations: 'disabled' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('French labels and expanded mobile filters fit at 375px', async ({ page }, testInfo) => {
  const csrf = await page.evaluate(() => document.cookie.split('; ').find((row) => row.startsWith('csrftoken='))?.split('=')[1] ?? '');
  const response = await page.request.put('/api/auth/account/language/', {
    headers: { 'X-CSRFToken': csrf }, data: { ui_language: 'fr' },
  });
  expect(response.ok()).toBeTruthy();
  await page.evaluate(() => localStorage.setItem('ui.language', 'fr'));
  await page.setViewportSize({ width: 375, height: 800 });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tableau de bord des tâches' })).toBeVisible();
  await page.getByRole('button', { name: 'Filtrer les tâches' }).click();
  await page.getByRole('combobox', { name: 'Période', exact: true }).click();
  await page.getByRole('option', { name: 'Période personnalisée' }).click();
  await page.screenshot({ path: testInfo.outputPath('dashboard-fr-mobile-filters.png'), fullPage: true, animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Modifier le statut : Jäten' }).click();
  await expect(page.getByRole('menuitem', { name: 'Terminées' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('dashboard-fr-mobile-menu.png'), fullPage: true, animations: 'disabled' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Ajouter une tâche' }).click();
  await expect(page.getByRole('dialog', { name: 'Ajouter une tâche' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('task-editor-fr-mobile.png'), animations: 'disabled', fullPage: true });
});

test('manual tasks without a crop can be created, edited, completed and deleted', async ({ page }) => {
  await page.getByRole('button', { name: 'Aufgabe hinzufügen' }).click();
  let dialog = page.getByRole('dialog', { name: 'Aufgabe hinzufügen' });
  await dialog.getByRole('textbox', { name: 'Titel' }).fill('Zaun reparieren');
  await dialog.getByRole('textbox', { name: 'Beschreibung' }).fill('Nordseite');
  await dialog.getByRole('combobox', { name: 'Parzelle' }).click();
  await page.getByRole('option', { name: 'Nordparzelle' }).click();
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('article', { name: 'Zaun reparieren' })).toContainText('Nordparzelle');
  await page.reload();
  const card = page.getByRole('article', { name: 'Zaun reparieren' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Status ändern: Zaun reparieren' }).click();
  await page.getByRole('menuitem', { name: 'Aufgabe bearbeiten' }).click();
  dialog = page.getByRole('dialog', { name: 'Aufgabe bearbeiten' });
  await expect(dialog.getByRole('textbox', { name: 'Beschreibung' })).toHaveValue('Nordseite');
  await dialog.getByRole('textbox', { name: 'Titel' }).fill('Zaun repariert');
  await dialog.getByRole('combobox', { name: 'Status', exact: true }).click();
  await page.getByRole('option', { name: 'Erledigt' }).click();
  await dialog.getByLabel('Fälligkeit').fill('2026-11-06');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('region', { name: 'Erledigt', exact: true }).getByRole('article', { name: 'Zaun repariert' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Status ändern: Zaun repariert' }).click();
  await page.getByRole('menuitem', { name: 'Aufgabe löschen' }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Abbrechen' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Löschen' }).click();
  await expect(page.getByRole('article', { name: 'Zaun repariert' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('article', { name: 'Zaun repariert' })).toHaveCount(0);
});

test('task editor fits mobile, landscape and desktop', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: 'Aufgabe hinzufügen' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Titel' }).fill('Eine längere manuelle Aufgabe für die Nordparzelle');
  for (const viewport of [{ width: 375, height: 800 }, { width: 800, height: 375 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await expect(dialog.getByRole('button', { name: 'Speichern' })).toBeVisible();
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`task-editor-${viewport.width}x${viewport.height}.png`), animations: 'disabled', fullPage: true });
    if (viewport.height < 500) {
      await dialog.getByRole('combobox', { name: 'Parzelle' }).scrollIntoViewIfNeeded();
      await expect(dialog.getByRole('combobox', { name: 'Parzelle' })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Speichern' })).toBeVisible();
    }
  }
});

test('planting-plan creation persists localized automatic events without duplicate generation on reads', async ({ page }) => {
  const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: 'Tomato events', cultivation_type: 'pre_cultivation',
    cultivation_types: ['pre_cultivation'], propagation_duration_days: 20,
    growth_duration_days: 30, harvest_duration_days: 10,
  });
  const season = await page.evaluate(() => Number(localStorage.getItem(`activeSeasonId:${localStorage.getItem('activeProjectId')}`)));
  const plan = await apiRequest<{ id: number }>(page, 'POST', '/planting-plans/', {
    crop: crop.id, season, planting_date: '2026-06-01', cultivation_type: 'pre_cultivation',
  });
  await page.reload();
  const propagation = page.getByRole('article', { name: 'Anzucht beginnen' });
  await expect(propagation).toContainText('Automatisch');
  await expect(page.getByRole('article', { name: 'Pflanzen', exact: true }).filter({ hasText: 'Tomato events' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Ernte beginnen' }).filter({ hasText: 'Tomato events' })).toBeVisible();
  const before = await apiRequest<{ results: { id: number }[] }>(page, 'GET', `/tasks/?planting_plan=${plan.id}`);
  await page.reload();
  const after = await apiRequest<{ results: { id: number }[] }>(page, 'GET', `/tasks/?planting_plan=${plan.id}`);
  expect(after.results.map((task) => task.id)).toEqual(before.results.map((task) => task.id));
  expect(after.results).toHaveLength(3);
});

test('rescheduling keeps completed and overridden event tasks while moving open dates', async ({ page }, testInfo) => {
  const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: 'Sync crop', cultivation_type: 'pre_cultivation', cultivation_types: ['pre_cultivation'],
    propagation_duration_days: 20, growth_duration_days: 30,
  });
  const season = await page.evaluate(() => Number(localStorage.getItem(`activeSeasonId:${localStorage.getItem('activeProjectId')}`)));
  const plan = await apiRequest<{ id: number }>(page, 'POST', '/planting-plans/', {
    crop: crop.id, season, planting_date: '2026-06-01', cultivation_type: 'pre_cultivation',
  });
  type EventTask = { id: number; title: string; due_date: string; status: string };
  const initial = await apiRequest<{ results: EventTask[] }>(page, 'GET', `/tasks/?planting_plan=${plan.id}`);
  const propagation = initial.results.find((task) => task.title === 'Start propagation')!;
  const harvest = initial.results.find((task) => task.title === 'Start harvesting')!;
  await apiRequest(page, 'PATCH', `/tasks/${propagation.id}/`, { status: 'completed' });
  await apiRequest(page, 'PATCH', `/tasks/${harvest.id}/`, { due_date: '2026-09-01' });
  await apiRequest(page, 'PATCH', `/planting-plans/${plan.id}/`, { planting_date: '2026-07-01' });
  await page.reload();
  const plantingCard = page.getByRole('article', { name: 'Pflanzen', exact: true }).filter({ hasText: 'Sync crop' });
  await expect(plantingCard).toContainText('1.7.2026');
  await expect(page.getByRole('region', { name: 'Erledigt', exact: true }).getByRole('article', { name: 'Anzucht beginnen' })).toContainText('12.5.2026');
  await expect(page.getByRole('article', { name: 'Ernte beginnen' }).filter({ hasText: 'Sync crop' })).toContainText('1.9.2026');
  await plantingCard.getByRole('button', { name: 'Status ändern: Pflanzen' }).click();
  await page.getByRole('menuitem', { name: 'Aufgabe bearbeiten' }).click();
  const dialog = page.getByRole('dialog', { name: 'Aufgabe bearbeiten' });
  await expect(dialog.getByRole('combobox', { name: 'Anbauplan (optional)' })).toHaveAttribute('aria-disabled', 'true');
  await page.setViewportSize({ width: 375, height: 800 });
  await page.screenshot({ path: testInfo.outputPath('generated-task-editor-mobile.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  const after = await apiRequest<{ results: EventTask[] }>(page, 'GET', `/tasks/?planting_plan=${plan.id}`);
  expect(after.results.map((task) => task.id).sort()).toEqual(initial.results.map((task) => task.id).sort());
});
