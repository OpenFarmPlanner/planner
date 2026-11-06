import { test, expect } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject } from './utils';

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
