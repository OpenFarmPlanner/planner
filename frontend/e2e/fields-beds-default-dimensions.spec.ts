import { expect, test, type Page } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject } from './utils';

type SavedBed = { id: number; length_m: number | null; width_m: number | null; area_sqm: string | null };

async function seedBed(page: Page) {
  const projectId = Number(await page.evaluate(() => localStorage.getItem('activeProjectId')));
  expect(projectId).toBeGreaterThan(0);
  const { results: [location] } = await apiRequest<{ results: { id: number }[] }>(page, 'GET', '/locations/');
  const field = await apiRequest<{ id: number }>(page, 'POST', '/fields/', {
    name: 'Standardmaß-Testparzelle', location: location.id, length_m: 20, width_m: 12,
  });
  const source = await apiRequest<SavedBed>(page, 'POST', '/beds/', {
    name: 'Vorhandenes Beet', field: field.id, length_m: 5, width_m: 0.8,
  });
  return { projectId, field, source };
}

function nextBedCreate(page: Page) {
  return page.waitForResponse(response =>
    response.url().endsWith('/beds/') && response.request().method() === 'POST' && response.status() === 201,
  );
}

test('desktop drafts use the configured side and preserve a cleared side and duplicated dimensions', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, 'bed-defaults-desktop', { loginAsAdmin: true });
  const { projectId, field, source } = await seedBed(page);
  await apiRequest(page, 'PATCH', `/projects/${projectId}/`, {
    default_bed_length_m: 10.12345678, default_bed_width_m: 1.2,
  });
  await page.goto('/app/project-settings');
  const general = page.getByRole('region', { name: 'Allgemein' });
  const widthSetting = general.getByRole('textbox', { name: 'Breite (m)' });
  await expect(widthSetting).toHaveValue('1,2');
  await widthSetting.press('ControlOrMeta+a');
  await widthSetting.press('Backspace');
  await general.getByRole('button', { name: 'Speichern' }).press('Enter');
  await expect(page.getByText('Projekteinstellungen gespeichert.')).toBeVisible();
  await page.goto('/app/fields-beds');

  const fieldRow = page.locator(`[role="row"][data-id="field-${field.id}"]`);
  await fieldRow.hover();
  await fieldRow.getByRole('button', { name: 'Beet für diese Parzelle hinzufügen' }).click();
  const draft = page.locator('.MuiDataGrid-row--editing');
  const name = draft.locator('[data-field="name"] input');
  const length = draft.locator('[data-field="length_m"] input');
  const width = draft.locator('[data-field="width_m"] input');
  await expect(name).toBeFocused();
  await expect(length).toHaveValue('10,12345678');
  await expect(width).toHaveValue('0,8');
  await name.fill('Tastaturbeet');
  await name.press('Tab');
  await expect(length).toBeFocused();
  await length.fill('');
  const created = nextBedCreate(page);
  await length.press('Enter');
  expect(await (await created).json()).toMatchObject({ length_m: null, width_m: 0.8, area_sqm: null });

  await fieldRow.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Mehrere Beete anlegen' }).click();
  const bulk = page.getByRole('dialog', { name: /Mehrere Beete anlegen in/ });
  await expect(bulk.getByRole('textbox', { name: 'Länge (m)' })).toHaveValue('10,12345678');
  await expect(bulk.getByRole('textbox', { name: 'Breite (m)' })).toHaveValue('0,8');
  await page.keyboard.press('Escape');
  await expect(bulk).toHaveCount(0);

  const sourceRow = page.locator(`[role="row"][data-id="${source.id}"]`);
  await sourceRow.click({ button: 'right' });
  const duplicated = nextBedCreate(page);
  await page.getByRole('menuitem', { name: /^Beet duplizieren/ }).click();
  expect(await (await duplicated).json()).toMatchObject({ length_m: 5, width_m: 0.8 });
  expect(await apiRequest(page, 'GET', `/beds/${source.id}/`)).toMatchObject({ length_m: 5, width_m: 0.8 });
});

test.describe('mobile bed defaults', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('prefills both dimensions for touch creation and saves an edited dimension', async ({ page, request }) => {
    await loginWithDeterministicProject(page, request, 'bed-defaults-mobile', { loginAsAdmin: true });
    const { projectId } = await seedBed(page);
    await apiRequest(page, 'PATCH', `/projects/${projectId}/`, {
      default_bed_length_m: 10, default_bed_width_m: 1.23456789,
    });
    await page.goto('/app/fields-beds?createBed=true');

    const sheet = page.getByRole('dialog');
    const length = sheet.getByRole('textbox', { name: 'Länge (m)' });
    const width = sheet.getByRole('textbox', { name: 'Breite (m)' });
    await expect(length).toHaveValue('10');
    await expect(width).toHaveValue('1,23456789');
    await sheet.getByLabel('Name', { exact: true }).fill('Touchbeet');
    const save = sheet.getByRole('button', { name: 'Speichern' });
    await width.fill('keine Zahl');
    await save.tap();
    await expect(sheet.getByText('Breite muss eine gültige Zahl sein.')).toBeVisible();
    await width.fill('1,4');
    const created = nextBedCreate(page);
    await save.tap();
    const bed = await (await created).json() as SavedBed;
    expect([bed.length_m, bed.width_m, Number(bed.area_sqm)]).toEqual([10, 1.4, 14]);
    await expect(sheet).toHaveCount(0);

    await page.goto('/app/project-settings');
    const general = page.getByRole('region', { name: 'Allgemein' });
    const lengthSetting = general.getByRole('textbox', { name: 'Länge (m)' });
    await expect(lengthSetting).toHaveValue('10');
    await lengthSetting.tap();
    await lengthSetting.fill('');
    await general.getByRole('button', { name: 'Speichern' }).tap();
    await expect(page.getByText('Projekteinstellungen gespeichert.')).toBeVisible();
    await page.goto('/app/fields-beds?createBed=true');
    await expect(length).toHaveValue('');
    await expect(width).toHaveValue('1,23456789');
  });
});

test('localized settings fit and retain cleared values after reload', async ({ page, request }, testInfo) => {
  await loginWithDeterministicProject(page, request, 'bed-defaults-settings', { loginAsAdmin: true });
  const { projectId, source } = await seedBed(page);
  await apiRequest(page, 'PATCH', `/projects/${projectId}/`, {
    default_bed_length_m: 10, default_bed_width_m: 1.2,
  });

  await page.setViewportSize({ width: 375, height: 800 });
  for (const [locale, title] of [
    ['de', 'Standardmaße für Beete'],
    ['en', 'Default bed dimensions'],
    ['fr', 'Dimensions des planches par défaut'],
    ['es', 'Medidas predeterminadas de bancales'],
    ['it', 'Dimensioni predefinite delle aiuole'],
    ['pt', 'Dimensões predefinidas dos canteiros'],
    ['nl', 'Standaardafmetingen van bedden'],
  ]) {
    await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: locale });
    await page.goto('/app/project-settings');
    const defaults = page.getByRole('group', { name: title });
    await expect(defaults).toBeVisible();
    await defaults.scrollIntoViewIfNeeded();
    const dimensions = defaults.getByRole('textbox');
    await expect(dimensions).toHaveCount(2);
    await expect(dimensions.nth(0)).toHaveValue('10');
    await expect(dimensions.nth(1)).toHaveValue(locale === 'en' ? '1.2' : '1,2');
    const bounds = await defaults.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
    await page.screenshot({ path: testInfo.outputPath(`bed-defaults-${locale}.png`), animations: 'disabled' });
  }

  const defaults = page.getByRole('group', { name: 'Standaardafmetingen van bedden' });
  for (const viewport of [{ width: 800, height: 375 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await defaults.scrollIntoViewIfNeeded();
    await expect(defaults.getByRole('textbox', { name: 'Breedte (m)' })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`bed-defaults-${viewport.width}x${viewport.height}.png`), animations: 'disabled' });
  }
  const length = defaults.getByRole('textbox', { name: 'Lengte (m)' });
  const width = defaults.getByRole('textbox', { name: 'Breedte (m)' });
  const general = page.getByRole('region', { name: 'Algemeen' });
  const save = general.getByRole('button', { name: 'Opslaan' });
  const saveAndReadProject = async () => {
    const updated = page.waitForResponse(response =>
      response.url().endsWith(`/projects/${projectId}/`) && response.request().method() === 'PATCH',
    );
    await save.click();
    const response = await updated;
    expect(response.ok()).toBe(true);
    return response.json();
  };
  await expect(length).toHaveValue('10');
  await expect(width).toHaveValue('1,2');
  await length.fill('11,5');
  await width.fill('');
  expect(await saveAndReadProject()).toMatchObject({ default_bed_length_m: 11.5, default_bed_width_m: null });
  await expect(save).toBeDisabled();
  await page.reload();
  await expect(length).toHaveValue('11,5');
  await expect(width).toHaveValue('');
  await length.fill('');
  await general.getByRole('button', { name: 'Annuleren' }).click();
  await expect(length).toHaveValue('11,5');
  await length.fill('');
  expect(await saveAndReadProject()).toMatchObject({ default_bed_length_m: null, default_bed_width_m: null });
  await expect(save).toBeDisabled();
  await page.reload();
  await expect(length).toHaveValue('');
  await expect(width).toHaveValue('');
  expect(await apiRequest(page, 'GET', `/beds/${source.id}/`)).toMatchObject({ length_m: 5, width_m: 0.8 });
});
