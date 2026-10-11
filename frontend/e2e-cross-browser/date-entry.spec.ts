import {
  expect,
  findPlantingPlan,
  getPlantingPlan,
  gotoAppPage,
  isMobileProject,
  loginToDemoProject,
  test,
} from './fixtures';

// Entering a Pflanztermin through the real UI must store exactly that ISO
// date. This is where engines differ: Safari and Firefox parse and format
// dates differently from Chrome, and a date picker shifted by the time zone
// lands one day off. The demo's Gurke (Arola) plan is planted on 10 May 2026.
const DEMO_PLANTING_DATE = '2026-05-10';

test('a Pflanztermin entered in the UI is stored as the same calendar day', async ({ page }, testInfo) => {
  await loginToDemoProject(page, testInfo);
  const plan = await findPlantingPlan(page, DEMO_PLANTING_DATE);
  await gotoAppPage(page, '/app/planting-plans', 'Anbaupläne');

  if (!isMobileProject(testInfo)) {
    const row = page.locator(`[role="row"][data-id="${plan.id}"]`);
    const cell = row.locator('[data-field="planting_date"]');
    await expect(cell).toContainText('10.5.2026');
    await cell.dblclick();
    const input = cell.locator('input[type="text"]');
    await expect(input).toBeFocused();
    await input.fill('15.06.2026');
    await input.press('Enter');
    await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(0);
    await expect(cell).toContainText('15.6.2026');
    await expect.poll(async () => (await getPlantingPlan(page, plan.id)).planting_date).toBe('2026-06-15');
    return;
  }

  const openEditDialog = async () => {
    await page.getByRole('button', { name: 'Aktionen für Anbauplan Gurke (Arola)' }).click();
    await page.getByRole('menuitem', { name: /Bearbeiten/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Anbauplan bearbeiten' });
    await expect(dialog).toBeVisible();
    return dialog;
  };

  // Typed text entry.
  let dialog = await openEditDialog();
  const plantingDate = dialog.getByRole('textbox', { name: 'Pflanztermin' });
  await expect(plantingDate).toHaveValue('10.05.2026');
  await plantingDate.fill('15.06.2026');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await getPlantingPlan(page, plan.id)).planting_date).toBe('2026-06-15');

  // The native date picker behind "Kalender öffnen" (each engine's own
  // input[type=date] value parsing).
  dialog = await openEditDialog();
  await expect(dialog.getByRole('textbox', { name: 'Pflanztermin' })).toHaveValue('15.06.2026');
  const nativePicker = dialog.getByRole('textbox', { name: 'Pflanztermin' })
    .locator('xpath=ancestor::div[contains(@class, "MuiFormControl-root")][1]/following-sibling::input[@type="date"][1]');
  await nativePicker.fill('2026-06-20');
  await expect(dialog.getByRole('textbox', { name: 'Pflanztermin' })).toHaveValue('20.06.2026');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await getPlantingPlan(page, plan.id)).planting_date).toBe('2026-06-20');
});
