import { expect, test, type Page } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject } from './utils';

// Functional assertions, not screenshots: these flows are about which control
// the crop offers per library state and that no expected state produces a
// failing request. The full state matrix is explored by
// e2e/library-matrix.explore.ts (dev tool).

interface CropSpecies { id: number; name: string }
interface CropRow { id: number; name: string; variety: string }
interface PublishResponse { public_crop: { id: number; name: string; variety: string } }

function trackFailedApiCalls(page: Page): string[] {
  const failures: string[] = [];
  page.on('response', (response) => {
    // The session probe answers 401 before login; that is not a library state.
    if (response.status() >= 400 && response.url().includes('/api/') && !response.url().includes('/auth/me/')) {
      failures.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });
  return failures;
}

async function listSpecies(page: Page, count: number): Promise<CropSpecies[]> {
  const response = await apiRequest<{ results: CropSpecies[] }>(page, 'GET', '/crop-species/');
  expect(response.results.length).toBeGreaterThanOrEqual(count);
  return response.results.slice(0, count);
}

async function publishVariety(
  page: Page,
  species: CropSpecies,
  variety: string,
): Promise<{ crop: CropRow; publicCropId: number }> {
  const crop = await apiRequest<CropRow>(page, 'POST', '/crops/', {
    name: species.name,
    variety,
    crop_species: species.id,
    cultivation_type: 'pre_cultivation',
    cultivation_types: ['pre_cultivation'],
    growth_duration_days: 42,
    harvest_duration_days: 14,
  });
  const published = await apiRequest<PublishResponse>(page, 'POST', `/crops/${crop.id}/publish-public/`, {
    accepted_public_library_terms: true,
    crop_species_id: species.id,
    original_language_code: 'de',
  });
  return { crop, publicCropId: published.public_crop.id };
}

async function openCrop(page: Page, variety: string): Promise<void> {
  await page.goto('/app/crops');
  await page.getByLabel('Kultur suchen').first().fill(variety);
  await page.getByText(variety, { exact: true }).first().click();
}

test('a crop whose own library entry was withdrawn offers republishing and can be unlinked', async ({ page, request }) => {
  const failures = trackFailedApiCalls(page);
  await loginWithDeterministicProject(page, request, `library-withdrawn-${Date.now()}`, { loginAsAdmin: true });
  const [species] = await listSpecies(page, 1);
  const variety = `E2E Zurückgezogen ${Date.now()}`;
  const { publicCropId } = await publishVariety(page, species, variety);
  await apiRequest(page, 'POST', `/public-crops/${publicCropId}/remove/`, {});

  await openCrop(page, variety);

  await expect(page.getByTestId('crop-detail-publish-action')).toHaveText('Wieder veröffentlichen');

  await page.getByRole('button', { name: 'Weitere Aktionen' }).first().click();
  await page.getByRole('menuitem', { name: 'Verknüpfung aufheben' }).click();
  const dialog = page.getByRole('dialog', { name: 'Verknüpfung aufheben?' });
  await expect(dialog).toContainText(species.name);
  await expect(dialog).not.toContainText('öffentlicher Eintrag“');
  await dialog.getByRole('button', { name: 'Verknüpfung aufheben' }).click();

  await expect(page.getByRole('button', { name: 'In Bibliothek teilen' })).toBeVisible();
  expect(failures).toEqual([]);
});

test('an own withdrawn entry is republished with one confirmation', async ({ page, request }) => {
  const failures = trackFailedApiCalls(page);
  await loginWithDeterministicProject(page, request, `library-republish-${Date.now()}`, { loginAsAdmin: true });
  const [species] = await listSpecies(page, 1);
  const variety = `E2E Wieder ${Date.now()}`;
  const { publicCropId } = await publishVariety(page, species, variety);
  await apiRequest(page, 'POST', `/public-crops/${publicCropId}/remove/`, {});

  await openCrop(page, variety);
  await page.getByTestId('crop-detail-publish-action').click();
  await page.getByRole('dialog', { name: 'Wieder veröffentlichen?' })
    .getByRole('button', { name: 'Wieder veröffentlichen' }).click();

  await expect(page.getByTestId('crop-detail-library-status')).toHaveText('Aktuell');
  expect(failures).toEqual([]);
});

test('a linked crop with local changes is synced field by field with its entry', async ({ page, request }) => {
  const failures = trackFailedApiCalls(page);
  await loginWithDeterministicProject(page, request, `library-sync-${Date.now()}`, { loginAsAdmin: true });
  const [species] = await listSpecies(page, 1);
  const variety = `E2E Abgleich ${Date.now()}`;
  const { crop } = await publishVariety(page, species, variety);
  await apiRequest(page, 'PATCH', `/crops/${crop.id}/`, { growth_duration_days: 55 });

  await openCrop(page, variety);
  await page.getByTestId('crop-detail-publish-action').click();

  const dialog = page.getByRole('dialog', { name: 'Mit Kulturbibliothek abgleichen' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Abgleichen' }).click();

  await expect(page.getByTestId('crop-detail-library-status')).toHaveText('Aktuell');
  expect(failures).toEqual([]);
});

test('correcting the crop species to one that already has the variety shows the conflict inline', async ({ page, request }) => {
  await loginWithDeterministicProject(page, request, `library-relink-${Date.now()}`, {
    loginAsAdmin: true, libraryModerator: true,
  });
  const [first, second] = await listSpecies(page, 2);
  const variety = `E2E Konflikt ${Date.now()}`;
  await publishVariety(page, first, variety);
  const { publicCropId } = await publishVariety(page, second, variety);

  await page.goto(`/app/crop-library?cropId=${publicCropId}`);
  await page.getByRole('button', { name: /Moderation/ }).first().click();
  await page.getByRole('menuitem', { name: 'Kulturart korrigieren' }).click();
  const dialog = page.getByRole('dialog', { name: 'Kulturart korrigieren' });

  // Nothing changed yet: the submit is disabled and says why.
  await expect(dialog.getByRole('button', { name: 'Kulturart ändern' })).toBeDisabled();
  await expect(dialog.getByLabel('Wähle eine andere Kulturart oder Sorte aus.')).toBeVisible();

  const field = dialog.getByLabel(/Offizielle Kulturart/i);
  await field.click();
  await field.fill(first.name);
  await page.getByRole('option', { name: new RegExp(first.name) }).first().click();
  await dialog.getByRole('button', { name: 'Kulturart ändern' }).click();

  await expect(dialog.getByRole('alert')).toContainText(
    'Unter dieser Kulturart gibt es bereits einen veröffentlichten Eintrag mit dieser Sorte.',
  );
  await expect(dialog).toBeVisible();
});
