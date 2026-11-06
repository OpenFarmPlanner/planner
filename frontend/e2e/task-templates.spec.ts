import { test, expect } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject } from './utils';

test('template sections and dialogs support all UI languages and compact viewports', async ({ page, request }, testInfo) => {
  await loginWithDeterministicProject(page, request, `template-languages-${testInfo.workerIndex}`);
  const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', { name: 'Template language example' });
  await apiRequest(page, 'POST', '/crop-task-templates/', {
    crop: crop.id, title: 'Recurring check', reference_event: 'planting', day_offset: -3,
    repeat_interval_days: 7, repeat_until: 'count', repeat_count: 3,
  });
  for (const language of [
    { code: 'de', title: 'Aufgabenvorlagen', add: 'Vorlage hinzufügen', field: 'Titel' },
    { code: 'en', title: 'Task templates', add: 'Add template', field: 'Title' },
    { code: 'fr', title: 'Modèles de tâches', add: 'Ajouter un modèle', field: 'Titre' },
    { code: 'es', title: 'Plantillas de tareas', add: 'Añadir plantilla', field: 'Título' },
  ]) {
    await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: language.code });
    await page.goto(`/app/crops?cropId=${crop.id}`);
    const section = page.getByRole('region', { name: language.title, exact: true });
    await expect(section.getByText('Recurring check', { exact: true })).toBeVisible();
    for (const viewport of [{ width: 375, height: 800 }, { width: 800, height: 375 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      expect(await section.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    }
    await section.getByRole('button', { name: language.add, exact: true }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: language.add, exact: true });
    await expect(dialog.getByRole('textbox', { name: language.field, exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  }
});

test('crop details save templates independently and instantiate plan tasks', async ({ page, request }, testInfo) => {
  await loginWithDeterministicProject(page, request, `task-template-${testInfo.workerIndex}`, { loginAsAdmin: true });
  const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: 'Template crop', cultivation_type: 'direct_sowing', cultivation_types: ['direct_sowing'],
  });
  const season = await apiRequest<{ id: number }>(page, 'POST', '/seasons/', { start_date: '2026-01-01', end_date: '2026-12-31' });
  const plan = await apiRequest<{ id: number }>(page, 'POST', '/planting-plans/', {
    crop: crop.id, season: season.id, planting_date: '2026-05-01', cultivation_type: 'direct_sowing',
  });
  await page.goto(`/app/crops?cropId=${crop.id}`);
  await page.getByRole('button', { name: 'Vorlage hinzufügen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Vorlage hinzufügen' });
  await dialog.getByRole('textbox', { name: 'Titel' }).fill('Beet abdecken');
  await dialog.getByRole('combobox', { name: 'Referenzereignis' }).click();
  await page.getByRole('option', { name: 'Direktsaat', exact: true }).click();
  await dialog.getByRole('spinbutton', { name: 'Abstand in Tagen' }).fill('-3');
  for (const size of [{ width: 375, height: 800 }, { width: 800, height: 375 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size);
    await page.screenshot({ path: testInfo.outputPath(`template-editor-${size.width}.png`), fullPage: true });
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(page.getByText('Beet abdecken', { exact: true })).toBeVisible();
  const tasks = await apiRequest<{ results: { title: string; due_date: string; template: number | null }[] }>(page, 'GET', `/tasks/?planting_plan=${plan.id}`);
  expect(tasks.results.find((task) => task.title === 'Beet abdecken')).toMatchObject({ due_date: '2026-04-28', template: expect.any(Number) });
  await page.getByRole('button', { name: 'Vorlage löschen: Beet abdecken' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Löschen' }).click();
  await expect(page.getByText('Beet abdecken', { exact: true })).not.toBeVisible();
});

test('recurring templates create independently completable occurrences', async ({ page, request }, testInfo) => {
  await loginWithDeterministicProject(page, request, `task-recurrence-${testInfo.workerIndex}`, { loginAsAdmin: true });
  const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: 'Repeat crop', cultivation_type: 'direct_sowing', cultivation_types: ['direct_sowing'],
  });
  const season = await apiRequest<{ id: number }>(page, 'POST', '/seasons/', { start_date: '2026-01-01', end_date: '2026-12-31' });
  const plan = await apiRequest<{ id: number }>(page, 'POST', '/planting-plans/', {
    crop: crop.id, season: season.id, planting_date: '2026-05-01', cultivation_type: 'direct_sowing',
  });
  await page.goto(`/app/crops?cropId=${crop.id}`);
  await page.getByRole('button', { name: 'Vorlage hinzufügen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Vorlage hinzufügen' });
  await dialog.getByRole('textbox', { name: 'Titel' }).fill('Gießen');
  await dialog.getByRole('combobox', { name: 'Referenzereignis' }).click();
  await page.getByRole('option', { name: 'Direktsaat', exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'Wiederholen' }).check();
  await dialog.getByRole('spinbutton', { name: 'Intervall in Tagen' }).fill('5');
  await dialog.getByRole('spinbutton', { name: 'Anzahl Aufgaben' }).fill('3');
  for (const size of [{ width: 375, height: 800 }, { width: 800, height: 375 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size);
    if (size.height < 500) {
      await dialog.getByRole('spinbutton', { name: 'Anzahl Aufgaben' }).scrollIntoViewIfNeeded();
      await expect(dialog.getByRole('spinbutton', { name: 'Anzahl Aufgaben' })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Speichern' })).toBeVisible();
    }
    await page.screenshot({ path: testInfo.outputPath(`recurring-editor-${size.width}.png`), fullPage: true });
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).not.toBeVisible();
  type Occurrence = { id: number; title: string; status: string; occurrence_index: number; due_date: string };
  const initial = await apiRequest<{ results: Occurrence[] }>(page, 'GET', `/tasks/?planting_plan=${plan.id}&origin=template`);
  expect(initial.results).toHaveLength(3);
  const first = initial.results.find((task) => task.occurrence_index === 0)!;
  await apiRequest(page, 'PATCH', `/tasks/${first.id}/`, { status: 'completed' });
  await apiRequest(page, 'PATCH', `/planting-plans/${plan.id}/`, { planting_date: '2026-06-01' });
  const changed = await apiRequest<{ results: Occurrence[] }>(page, 'GET', `/tasks/?planting_plan=${plan.id}&origin=template`);
  expect(changed.results.map((task) => task.id).sort()).toEqual(initial.results.map((task) => task.id).sort());
  expect(changed.results.find((task) => task.id === first.id)).toMatchObject({ status: 'completed', due_date: '2026-05-01' });
  expect(changed.results.find((task) => task.occurrence_index === 2)).toMatchObject({ status: 'pending', due_date: '2026-06-11' });
});
