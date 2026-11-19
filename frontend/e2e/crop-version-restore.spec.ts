import { expect, test, type Page } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject } from './utils';
import de from '../src/i18n/locales/de/crops.json' with { type: 'json' };

type Id = { id: number };
type Crop = Id & { notes: string; crop_species: number; supplier: Id; image_file: Id | null };

const imageFixture = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAFElEQVR4nGMUqdBggAEmBiSAmwMAJBgAvGvjdH4AAAAASUVORK5CYII=';

async function uploadImage(page: Page) {
  return page.evaluate(async (encodedImage) => {
    const bytes = Uint8Array.from(atob(encodedImage), character => character.charCodeAt(0));
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'image/png' }), 'crop-restore.png');
    const csrf = document.cookie.split('; ').find(value => value.startsWith('csrftoken='))?.slice(10) ?? '';
    const response = await fetch('/api/media-files/upload/', {
      method: 'POST', body: form,
      headers: { 'X-CSRFToken': csrf, 'X-Project-Id': localStorage.getItem('activeProjectId') ?? '' },
    });
    if (!response.ok) throw new Error(`Image upload returned HTTP ${response.status}`);
    return await response.json() as Id;
  }, imageFixture);
}

async function openVersions(page: Page) {
  await page.getByRole('button', { name: de.buttons.moreActions, exact: true }).click();
  await page.getByRole('menuitem', { name: de.buttons.versions, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: de.history.titles.crop, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('crop versions restore their references and explain a missing supplier on mobile', async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 800 });
  await loginWithDeterministicProject(page, request, 'crop-version-references', { loginAsAdmin: true });
  const species = await apiRequest<{ results: Id[] }>(page, 'GET', '/crop-species/?page_size=10');
  const [firstSpecies, secondSpecies] = species.results;
  const image = await uploadImage(page);
  const firstSupplier = await apiRequest<Id>(page, 'POST', '/suppliers/', { name: 'Earlier supplier' });
  const secondSupplier = await apiRequest<Id>(page, 'POST', '/suppliers/', { name: 'Later supplier' });
  const name = 'Crop version references';
  const crop = await apiRequest<Crop>(page, 'POST', '/crops/', {
    name, notes: 'Earlier sample note', crop_species: firstSpecies.id,
    image_file_id: image.id, supplier_id: firstSupplier.id,
  });
  await apiRequest(page, 'PATCH', `/crops/${crop.id}/`, {
    notes: 'Later sample note', crop_species: secondSpecies.id, image_file_id: null,
    supplier_id: secondSupplier.id,
  });

  await page.goto(`/app/crops?cropId=${crop.id}`);
  await expect(page.getByText('Later sample note', { exact: true })).toBeVisible();
  let dialog = await openVersions(page);
  await expect(dialog.getByText(de.history.fieldLabels.cropSpecies, { exact: true })).toBeVisible();
  await expect(dialog.getByText(de.history.fieldLabels.image, { exact: true })).toBeVisible();
  await expect(dialog.getByText(de.history.fieldLabels.supplier, { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: de.history.restoreButton, exact: true }).click();
  await expect(dialog).toBeHidden();
  const restored = await apiRequest<Crop>(page, 'GET', `/crops/${crop.id}/`);
  expect(restored).toMatchObject({
    notes: 'Earlier sample note', crop_species: firstSpecies.id, supplier: { id: firstSupplier.id },
    image_file: { id: image.id },
  });

  await apiRequest(page, 'DELETE', `/suppliers/${secondSupplier.id}/`);
  dialog = await openVersions(page);
  const unavailable = dialog.getByRole('listitem')
    .filter({ hasText: 'Later sample note' })
    .getByRole('button', { name: de.history.restoreButton, exact: true });
  await unavailable.focus();
  const [failed] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith(`/crops/${crop.id}/restore/`)),
    page.keyboard.press('Enter'),
  ]);
  expect(failed.status()).toBe(409);
  const alert = dialog.getByRole('alert');
  await expect(alert).toHaveText(de.history.restoreErrors.reference.replace('{{field}}', de.history.fieldLabels.supplier));
  await expect(alert).toBeFocused();
  const unchanged = await apiRequest<Crop>(page, 'GET', `/crops/${crop.id}/`);
  expect(unchanged).toMatchObject({
    notes: restored.notes, crop_species: restored.crop_species, supplier: restored.supplier,
    image_file: restored.image_file,
  });
  for (const [width, height] of [[375, 800], [768, 900], [1024, 900], [1440, 900], [800, 375]]) {
    await page.setViewportSize({ width, height });
    await expect(alert).toBeVisible();
    expect(await dialog.evaluate(element => element.scrollWidth)).toBeLessThanOrEqual(
      await dialog.evaluate(element => element.clientWidth) + 1,
    );
    await page.screenshot({ path: testInfo.outputPath(`crop-restore-error-${width}.png`), animations: 'disabled' });
  }
});
