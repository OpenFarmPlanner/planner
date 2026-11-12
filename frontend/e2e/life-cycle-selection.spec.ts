import { expect, test } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject } from './utils';

for (const viewport of [
  { width: 375, height: 800 }, { width: 768, height: 900 }, { width: 1024, height: 900 },
  { width: 1440, height: 900 }, { width: 800, height: 375 },
]) {
  test(`legacy life cycle survives unrelated edits at ${viewport.width}`, async ({ page, request }, testInfo) => {
    await page.setViewportSize(viewport);
    await loginWithDeterministicProject(page, request, `life-cycle-${viewport.width}`, { loginAsAdmin: true });
    const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
      name: 'Legacy life cycle crop', growth_duration_days: 60, harvest_duration_days: 14, life_cycle: 'biennial',
    });
    await page.goto(`/app/crops?cropId=${crop.id}&action=edit`);
    const dialog = page.getByRole('dialog');
    const lifeCycle = dialog.getByRole('combobox', { name: 'Lebensdauer', exact: true });
    await expect(lifeCycle).toHaveText('Zweijährig');
    await lifeCycle.click();
    await expect(page.getByRole('option', { name: 'Zweijährig (Bestandswert)', exact: true })).toBeDisabled();
    await expect(page.getByRole('option', { name: 'Einjährig', exact: true })).toBeEnabled();
    await expect(page.getByRole('option', { name: 'Mehrjährig', exact: true })).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toBeHidden();
    await dialog.getByText('Dieser vorhandene Wert bleibt erhalten, solange du keine andere Lebensdauer wählst.').scrollIntoViewIfNeeded();
    expect(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`legacy-life-cycle-${viewport.width}.png`), animations: 'disabled' });
    await dialog.getByRole('textbox', { name: 'Schädlinge und Krankheiten', exact: true }).fill('Updated plant health notes');
    const save = dialog.getByRole('button', { name: 'Speichern', exact: true });
    const [saved] = await Promise.all([
      page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith(`/crops/${crop.id}/`)),
      save.click(),
    ]);
    expect(saved.ok()).toBe(true);
    expect((await saved.json()).life_cycle).toBe('biennial');
    await expect(dialog).toBeHidden();
    await page.goto(`/app/crops?cropId=${crop.id}&action=edit`);
    await lifeCycle.click();
    await page.getByRole('option', { name: 'Einjährig', exact: true }).click();
    const [replaced] = await Promise.all([
      page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith(`/crops/${crop.id}/`)),
      save.click(),
    ]);
    expect(replaced.ok()).toBe(true);
    expect((await apiRequest<{ life_cycle: string }>(page, 'GET', `/crops/${crop.id}/`)).life_cycle).toBe('annual');
  });
}

for (const language of [
  { code: 'fr', label: 'Cycle de vie', value: 'Bisannuelle', hint: 'Cette valeur enregistrée est conservée tant que vous ne choisissez pas un autre cycle de vie.' },
  { code: 'es', label: 'Ciclo de vida', value: 'Bienal', hint: 'Este valor guardado se conserva hasta que elijas otro ciclo de vida.' },
]) {
  test(`legacy life cycle hint fits on a phone in ${language.code}`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await loginWithDeterministicProject(page, request, `life-cycle-${language.code}`, { loginAsAdmin: true });
    const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
      name: 'Legacy translated crop', growth_duration_days: 60, harvest_duration_days: 14, life_cycle: 'biennial',
    });
    await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: language.code });
    await page.evaluate(code => {
      localStorage.setItem('ui.language', code);
      localStorage.setItem('ui.language.pendingChoice', code);
    }, language.code);
    await page.goto(`/app/crops?cropId=${crop.id}&action=edit`);
    await expect(page.locator('html')).toHaveAttribute('lang', language.code);
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('combobox', { name: language.label, exact: true })).toHaveText(language.value);
    const hint = dialog.getByText(language.hint, { exact: true });
    await expect(hint).toBeVisible();
    await hint.scrollIntoViewIfNeeded();
    expect(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`legacy-life-cycle-${language.code}.png`), animations: 'disabled' });
  });
}


test('public library edits preserve a legacy life cycle', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, 'life-cycle-library', { loginAsAdmin: true });
  const available = await apiRequest<{ results: { id: number; name: string }[] }>(page, 'GET', '/crop-species/?page_size=1000');
  const library = await apiRequest<{ results: { crop_species: number; variety: string }[] }>(page, 'GET', '/public-crops/?page_size=1000');
  const publishedSpecies = new Set(library.results.filter(entry => !entry.variety).map(entry => entry.crop_species));
  const species = [...available.results].reverse().find(entry => !publishedSpecies.has(entry.id));
  expect(species, 'An official species without a public general entry is available').toBeDefined();
  const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: species!.name, crop_species: species!.id, growth_duration_days: 60, harvest_duration_days: 14, life_cycle: 'biennial',
  });
  const published = await apiRequest<{ public_crop: { id: number } }>(page, 'POST', `/crops/${crop.id}/publish-public/`, {
    accepted_public_library_terms: true, crop_species_id: species!.id, original_language_code: 'de', publish_as_general: true,
  });
  await page.goto(`/app/crop-library?cropId=${published.public_crop.id}`);
  await page.getByRole('button', { name: /^Bearbeiten/ }).click();
  const dialog = page.getByRole('dialog');
  const lifeCycle = dialog.getByRole('combobox', { name: 'Lebensdauer', exact: true });
  await expect(lifeCycle).toHaveText('Zweijährig');
  await lifeCycle.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('library-legacy-life-cycle.png'), animations: 'disabled' });
  await dialog.getByRole('textbox', { name: 'Schädlinge und Krankheiten', exact: true }).fill('Updated library health notes');
  await dialog.getByRole('button', { name: /Speichern/ }).click();
  await expect(dialog).toBeHidden();
  const saved = await apiRequest<{ life_cycle: string; pests_diseases: string }>(page, 'GET', `/public-crops/${published.public_crop.id}/`);
  expect(saved.life_cycle).toBe('biennial');
  expect(saved.pests_diseases).toBe('Updated library health notes');
});
