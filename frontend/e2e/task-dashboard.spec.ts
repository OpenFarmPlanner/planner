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
  await expect(page.getByRole('heading', { name: 'Aufgaben', exact: true })).toBeVisible();
}

// Grabs the card at its title text: the whole card is the drag activator.
async function dragTask(page: Page, title: string, status: string) {
  const handle = page.getByRole('article', { name: title, exact: true }).getByText(title, { exact: true });
  const target = page.locator(`[data-task-column="${status}"]`);
  const start = await handle.boundingBox();
  const end = await target.boundingBox();
  if (!start || !end) throw new Error('Missing task card or column');
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

test('card links open crop and field without dragging; the menu never starts a drag', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const card = page.getByRole('article', { name: 'Jäten', exact: true });
  await expect(card.getByRole('button', { name: /Aufgabe verschieben/ })).toHaveCount(0);
  const menu = card.getByRole('button', { name: 'Status ändern: Jäten' });
  const box = await menu.boundingBox();
  if (!box) throw new Error('Missing card menu');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 20, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByRole('region', { name: 'Offen', exact: true }).getByRole('article', { name: 'Jäten', exact: true })).toBeVisible();
  await card.getByRole('link', { name: 'Nordparzelle' }).click();
  await expect(page).toHaveURL(/\/app\/fields-beds\?highlight=field:\d+/);
  await page.goBack();
  await page.getByRole('article', { name: 'Jäten', exact: true }).getByRole('link', { name: /Salat/ }).click();
  await expect(page).toHaveURL(/\/app\/crops\?cropId=\d+/);
});

test.describe('on a touch tablet', () => {
  test.use({ hasTouch: true, viewport: { width: 1024, height: 900 } });

  test('a quick swipe over a card scrolls instead of dragging and a link tap navigates', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 500 });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const card = page.getByRole('article', { name: 'Jäten', exact: true });
    await card.scrollIntoViewIfNeeded();
    const box = await card.getByText('Jäten', { exact: true }).boundingBox();
    if (!box) throw new Error('Missing task card');
    const before = await page.evaluate(() => window.scrollY);
    expect(before).toBeGreaterThan(0);
    const touch = await page.context().newCDPSession(page);
    const x = box.x + 5;
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: box.y + 5 }] });
    for (const offset of [40, 80, 120, 160]) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: box.y + 5 + offset }] });
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(before);
    await expect(page.getByRole('region', { name: 'Offen', exact: true }).getByRole('article', { name: 'Jäten', exact: true })).toBeVisible();
    await touch.detach();
    await card.getByRole('link', { name: 'Nordparzelle' }).tap();
    await expect(page).toHaveURL(/\/app\/fields-beds\?highlight=field:\d+/);
  });
});

test('mobile list supports status changes with the keyboard and filters', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const menu = page.getByRole('button', { name: 'Status ändern: Jäten' });
  await menu.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: 'In Arbeit', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'In Arbeit', exact: true }).getByRole('article', { name: 'Jäten', exact: true })).toBeVisible();
  await expect(page.getByTestId('task-drag-hint')).toBeVisible();
  expect(await apiRequest(page, 'GET', '/auth/account/task-drag-hint/')).toEqual({ done: false });
  await page.getByRole('button', { name: 'Aufgaben filtern' }).click();
  await page.getByRole('combobox', { name: 'Zeitraum' }).click();
  await page.getByRole('option', { name: 'Eigener Zeitraum' }).click();
  await page.getByLabel('Von', { exact: true }).fill('2027-01-01');
  await expect(page.getByText('Keine Aufgaben passen zu diesen Filtern.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Filter zurücksetzen' }).click();
  await expect(page.getByRole('article', { name: 'Jäten', exact: true })).toBeVisible();
});

test('mobile board keeps a 16px inset to both viewport edges', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const heading = await page.getByRole('heading', { name: 'Aufgaben', exact: true }).boundingBox();
  const button = await page.getByRole('button', { name: 'Aufgabe hinzufügen' }).boundingBox();
  const column = await page.getByRole('region', { name: 'Offen', exact: true }).boundingBox();
  if (!heading || !button || !column) throw new Error('Missing board element');
  expect(heading.x).toBe(16);
  expect(button.x).toBe(16);
  expect(button.x + button.width).toBe(375 - 16);
  expect(column.x).toBe(16);
  expect(column.x + column.width).toBe(375 - 16);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
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
  await expect(page.getByRole('heading', { name: 'Tâches', exact: true })).toBeVisible();
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
  await expect(propagation).toContainText('Tomato events');
  await expect(propagation).not.toContainText('Automatisch');
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

test('moving hint persists dismissal per account', async ({ page }) => {
  const hint = page.getByTestId('task-drag-hint');
  await expect(hint).toBeVisible();
  const saved = page.waitForResponse((response) => response.url().includes('/auth/account/task-drag-hint/') && response.request().method() === 'POST');
  await hint.getByRole('button', { name: 'Schließen' }).click();
  expect((await saved).ok()).toBeTruthy();
  await expect(hint).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Aufgaben', exact: true })).toBeVisible();
  await expect(hint).not.toBeVisible();
});

test('only a successfully saved drag retires the hint and empty columns accept tasks', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const tasks = await apiRequest<{ results: { id: number }[] }>(page, 'GET', '/tasks/');
  for (const task of tasks.results) await apiRequest(page, 'PATCH', `/tasks/${task.id}/`, { status: 'completed' });
  await page.reload();
  const hint = page.getByTestId('task-drag-hint');
  await expect(hint).toBeVisible();
  await page.route('**/api/tasks/*/', async (route) => {
    if (route.request().method() === 'PATCH') await route.fulfill({ status: 500, body: 'Unavailable' });
    else await route.continue();
  });
  await dragTask(page, 'Jäten', 'pending');
  await expect(page.getByRole('alert').filter({ hasText: 'Die Änderung wurde zurückgenommen' })).toBeVisible();
  await expect(hint).toBeVisible();
  expect(await apiRequest(page, 'GET', '/auth/account/task-drag-hint/')).toEqual({ done: false });
  await page.unroute('**/api/tasks/*/');
  await dragTask(page, 'Jäten', 'pending');
  await expect(page.getByRole('region', { name: 'Offen', exact: true }).getByRole('article', { name: 'Jäten', exact: true })).toBeVisible();
  await expect(hint).not.toBeVisible();
  expect(await apiRequest(page, 'GET', '/auth/account/task-drag-hint/')).toEqual({ done: true });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Aufgaben', exact: true })).toBeVisible();
  await expect(hint).not.toBeVisible();
});

test('touch dragging supports empty targets and announces the move', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const tasks = await apiRequest<{ results: { id: number }[] }>(page, 'GET', '/tasks/');
  for (const task of tasks.results) await apiRequest(page, 'PATCH', `/tasks/${task.id}/`, { status: 'pending' });
  await page.reload();
  const handle = page.getByRole('article', { name: 'Jäten', exact: true }).getByText('Jäten', { exact: true });
  const target = page.locator('[data-task-column="completed"]');
  const start = await handle.boundingBox();
  const end = await target.boundingBox();
  if (!start || !end) throw new Error('Missing touch target');
  const client = await page.context().newCDPSession(page);
  const x = start.x + start.width / 2;
  const y = start.y + start.height / 2;
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  // The existing TouchSensor intentionally requires a 250 ms hold to preserve scrolling.
  await page.waitForTimeout(300);
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: end.x + end.width / 2, y: end.y + 50 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByRole('region', { name: 'Erledigt', exact: true }).getByRole('article', { name: 'Jäten', exact: true })).toBeVisible();
  await expect(page.locator('[id^="DndLiveRegion"]')).toContainText('Jäten');
  await page.setViewportSize({ width: 375, height: 800 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 650 }] });
  for (const y of [550, 450, 350, 250, 150]) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y }] });
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await client.detach();
});
