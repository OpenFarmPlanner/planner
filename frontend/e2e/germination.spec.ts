import { expect, test } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject } from './utils';

for (const viewport of [
  { width: 375, height: 800 }, { width: 768, height: 900 },
  { width: 1024, height: 900 }, { width: 1440, height: 900 }, { width: 800, height: 375 },
]) {
  test(`germination fields save and reopen at ${viewport.width}x${viewport.height}`, async ({ page, request }) => {
    await page.setViewportSize(viewport);
    await loginWithDeterministicProject(page, request, `germination-${viewport.width}`, { loginAsAdmin: true });
    const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
      name: 'Germination test', cultivation_types: ['pre_cultivation'], cultivation_type: 'pre_cultivation',
      growth_duration_days: 60, propagation_duration_days: 5,
      germination_temperature_optimal_min_c: 18, germination_temperature_optimal_max_c: 25,
      germination_temperature_min_c: 5, germination_days_min: 7, germination_days_max: 14,
      germination_temperature_requirement: 'cold_stratification', germination_light_requirement: 'light',
      stratification_days_min: 14, stratification_days_max: 28,
      stratification_temperature_min_c: -5, stratification_temperature_max_c: 5,
      germination_pretreatment: 'Chill four weeks.',
    });
    await page.goto(`/app/crops?cropId=${crop.id}&action=edit`);
    const dialog = page.getByRole('dialog', { name: 'Kultur bearbeiten' });
    await expect(dialog).toBeVisible();
    const minimum = dialog.getByLabel('Keimdauer von (Tage)', { exact: true });
    await minimum.scrollIntoViewIfNeeded();
    await expect(minimum).toHaveValue('7');
    await expect(dialog.getByText('Anzuchtdauer kürzer als die Keimdauer.', { exact: true })).toBeVisible();
    const temperatureRequirement = dialog.getByRole('combobox', { name: 'Temperaturvorbehandlung', exact: true });
    const lightRequirement = dialog.getByRole('combobox', { name: 'Lichtbedarf bei der Keimung', exact: true });
    await expect(temperatureRequirement).toHaveText('Kaltstratifikation');
    await expect(lightRequirement).toHaveText('Lichtkeimer');
    const stratificationMinimum = dialog.getByLabel('Stratifikationsdauer von (Tage)', { exact: true });
    await expect(stratificationMinimum).toHaveValue('14');
    await temperatureRequirement.click();
    await page.getByRole('option', { name: 'Keine Vorbehandlung', exact: true }).click();
    await expect(stratificationMinimum).toHaveCount(0);
    await temperatureRequirement.click();
    await page.getByRole('option', { name: 'Frostbehandlung', exact: true }).click();
    await expect(stratificationMinimum).toHaveValue('14');
    await expect(lightRequirement).toHaveText('Lichtkeimer');
    await dialog.getByLabel('Stratifikationsdauer bis (Tage)', { exact: true }).fill('');
    await dialog.getByLabel('Stratifikationstemperatur von (°C)', { exact: true }).fill('-6,5');
    await dialog.getByLabel('Stratifikationstemperatur bis (°C)', { exact: true }).fill('');
    await minimum.fill('8');
    await dialog.getByRole('button', { name: /Speichern/ }).click();
    await expect(dialog).toBeHidden();
    const saved = await apiRequest<{ germination_days_min: number; germination_types: string[]; germination_temperature_requirement: string; germination_light_requirement: string; stratification_days_max: number | null; stratification_temperature_min_c: number; stratification_temperature_max_c: number | null }>(page, 'GET', `/crops/${crop.id}/`);
    expect(saved.germination_days_min).toBe(8);
    expect([...saved.germination_types].sort()).toEqual(['frost', 'light']);
    expect(saved.germination_temperature_requirement).toBe('frost_treatment');
    expect(saved.germination_light_requirement).toBe('light');
    expect(saved.stratification_days_max).toBeNull();
    expect(saved.stratification_temperature_min_c).toBe(-6.5);
    expect(saved.stratification_temperature_max_c).toBeNull();
    await page.goto(`/app/crops?cropId=${crop.id}&action=edit`);
    await expect(minimum).toHaveValue('8');
    await minimum.scrollIntoViewIfNeeded();
    await dialog.getByRole('heading', { name: 'Keimung', exact: true }).evaluate((element) => element.scrollIntoView({ block: 'start', behavior: 'instant', inline: 'nearest' }));
    // Review artifacts only: functional assertions above cover persistence.
    await page.screenshot({ animations: 'disabled', path: `../work/germination-${viewport.width}x${viewport.height}.png` });
    const overflow = await dialog.evaluate((element) => element.scrollWidth > element.clientWidth + 1);
    expect(overflow).toBe(false);
  });
}

for (const [language, title] of [['fr', 'Germination'], ['es', 'Germinación']] as const) {
  test(`germination labels fit a phone in ${language}`, async ({ page, request }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await loginWithDeterministicProject(page, request, `germination-${language}`, { loginAsAdmin: true });
    const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
      name: 'Germination localized', cultivation_types: ['pre_cultivation'],
      growth_duration_days: 60, propagation_duration_days: 5,
      germination_temperature_optimal_min_c: 18.5, germination_temperature_optimal_max_c: 25,
      germination_days_min: 7, germination_days_max: 14,
      germination_temperature_requirement: 'cold_stratification', germination_light_requirement: 'light',
      stratification_days_min: 14, stratification_days_max: 28,
      stratification_temperature_min_c: -5.5, stratification_temperature_max_c: 5,
    });
    await page.evaluate((choice) => {
      localStorage.setItem('ui.language', choice);
      localStorage.setItem('ui.language.pendingChoice', choice);
    }, language);
    await page.goto(`/app/crops?cropId=${crop.id}&action=edit`);
    const dialog = page.getByRole('dialog');
    const heading = dialog.getByRole('heading', { name: title, exact: true });
    await expect(heading).toBeVisible();
    await heading.evaluate((element) => element.scrollIntoView({ block: 'start', behavior: 'instant', inline: 'nearest' }));
    expect(await dialog.locator('input').evaluateAll((inputs) => inputs.some((input) => input.value === '18,5'))).toBe(true);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ animations: 'disabled', path: `../work/germination-${language}-375.png` });
    expect(await dialog.locator('.MuiDialogContent-root').evaluate((element) => element.scrollWidth > element.clientWidth + 1)).toBe(false);
  });
}

test('germination hints and emergence appear in the plan dialog and published library', async ({ page, request }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await loginWithDeterministicProject(page, request, 'germination-planning', { loginAsAdmin: true, demoProject: true, demoYear: 2026 });
  const species = await apiRequest<{ results: { id: number; name: string }[] }>(page, 'GET', '/crop-species/');
  const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: species.results[0].name, crop_species: species.results[0].id,
    variety: `Germination browser ${Date.now()}`, cultivation_types: ['pre_cultivation'],
    growth_duration_days: 60, harvest_duration_days: 14, propagation_duration_days: 5,
    germination_days_min: 7, germination_days_max: 14, germination_types: ['cold', 'light'],
    germination_pretreatment: 'Chill four weeks.',
  });
  const published = await apiRequest<{ public_crop: { id: number; variety: string } }>(page, 'POST', `/crops/${crop.id}/publish-public/`, {
    accepted_public_library_terms: true, crop_species_id: species.results[0].id, original_language_code: 'de',
  });
  await page.goto(`/app/crop-library?cropId=${published.public_crop.id}`);
  const germination = page.getByRole('heading', { name: 'Keimung', exact: true });
  await expect(germination).toBeVisible();
  await germination.evaluate((element) => element.scrollIntoView({ block: 'start', behavior: 'instant', inline: 'nearest' }));
  await expect(page.getByText('Chill four weeks.', { exact: true })).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: '../work/germination-library-375.png' });

  await page.goto('/app/planting-plans');
  await page.getByRole('button', { name: /^Anbauplan hinzufügen/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Anbauplan hinzufügen' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox').first().click();
  await page.getByRole('option', { name: new RegExp(published.public_crop.variety) }).click();
  await dialog.getByRole('textbox', { name: 'Pflanztermin', exact: true }).fill('1.6.2026');
  await expect(dialog.getByText('Das Saatgut benötigt eine Kälteperiode.', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Anzuchtdauer kürzer als die Keimdauer.', { exact: true })).toBeVisible();
  const emergence = dialog.getByText(/Auflaufen ca\./);
  await expect(emergence).toBeVisible();
  await emergence.scrollIntoViewIfNeeded();
  await page.screenshot({ animations: 'disabled', path: '../work/germination-plan-375.png' });
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  const season = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((name) => name.startsWith('activeSeasonId:'));
    return key ? Number(localStorage.getItem(key)) : null;
  });
  await apiRequest(page, 'POST', '/planting-plans/', {
    crop: crop.id, season, planting_date: '2026-06-01', cultivation_type: 'pre_cultivation',
    area_usage_sqm: 1,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await expect(page.getByRole('img', { name: 'Hinweise zur Keimung' }).first()).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: '../work/germination-plan-table-1440.png' });
});
