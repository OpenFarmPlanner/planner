import { expect, test, type Locator, type Page } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject } from './utils';

// Saving a plant count for a crop without spacing is rejected by the backend.
// Desktop (grid) and mobile (dialog) must both show the German message and a
// "Kultur bearbeiten" link. The Sorte inherits spacing live from its general
// Kultur, so the link has to open the Kultur, not the Sorte.

const SPACING_MESSAGE =
  'Flächeneingabe: Für diese Kultur fehlen Pflanz- oder Reihenabstand. '
  + 'Wir können die Fläche daher nicht aus der Pflanzenanzahl berechnen.';

async function createSpacingFixture(page: Page): Promise<{ planId: number; generalCropId: number }> {
  const projectId = Number(await page.evaluate(() => window.localStorage.getItem('activeProjectId')));
  const withProject = (data: Record<string, unknown>) => ({ ...data, project: projectId });

  const species = await apiRequest<{ results: Array<{ id: number }> }>(page, 'GET', '/crop-species/');
  const speciesId = species.results[0]?.id;
  expect(speciesId, 'fixture needs at least one crop species').toBeTruthy();

  const season = await apiRequest<{ id: number }>(page, 'POST', '/seasons/', withProject({
    start_date: '2026-01-01',
    end_date: '2026-12-31',
  }));
  const location = await apiRequest<{ id: number }>(page, 'POST', '/locations/', withProject({ name: 'Abstandshof' }));
  const field = await apiRequest<{ id: number }>(page, 'POST', '/fields/', withProject({
    name: 'Abstandsfeld',
    location: location.id,
  }));
  const bed = await apiRequest<{ id: number }>(page, 'POST', '/beds/', withProject({
    name: 'Abstandsbeet',
    field: field.id,
    area_sqm: 20,
  }));
  const generalCrop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', withProject({
    name: 'Abstandssalat',
    crop_species: speciesId,
  }));
  const variety = await apiRequest<{ id: number; general_crop?: number | null }>(page, 'POST', '/crops/', withProject({
    name: 'Abstandssalat',
    variety: 'Ohne Abstand',
    crop_species: speciesId,
  }));
  const plan = await apiRequest<{ id: number }>(page, 'POST', '/planting-plans/', withProject({
    bed: bed.id,
    crop: variety.id,
    season: season.id,
    planting_date: '2026-05-01',
    area_usage_sqm: 2,
  }));

  return { planId: plan.id, generalCropId: generalCrop.id };
}

async function expectAlertLinksToGeneralCrop(page: Page, alert: Locator, generalCropId: number): Promise<void> {
  await expect(alert).toContainText(SPACING_MESSAGE);
  const link = alert.getByRole('link', { name: 'Kultur bearbeiten' });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', `/app/crops?cropId=${generalCropId}&action=edit`);

  await link.click();
  await expect(page).toHaveURL(new RegExp(`/app/crops\\?cropId=${generalCropId}`));
  await expect(page.getByRole('dialog', { name: 'Kultur bearbeiten' })).toBeVisible();
}

test.describe('planting plan missing-spacing alert', () => {
  test('mobile dialog shows the localized alert with a crop edit link (375x800)', async ({ page, request }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await loginWithDeterministicProject(page, request, 'planting-plans-spacing-alert-mobile', { loginAsAdmin: true });
    const { planId, generalCropId } = await createSpacingFixture(page);

    await page.goto(`/app/planting-plans?planId=${planId}&edit=true`);
    const dialog = page.getByRole('dialog', { name: 'Anbauplan bearbeiten' });
    await expect(dialog).toBeVisible();

    await dialog.getByRole('textbox', { name: 'Pflanzen (≈)' }).fill('40');
    await dialog.getByRole('button', { name: 'Speichern' }).click();

    await expectAlertLinksToGeneralCrop(page, dialog.getByRole('alert'), generalCropId);
  });

  test('desktop grid shows the localized alert with a crop edit link (1440x900)', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginWithDeterministicProject(page, request, 'planting-plans-spacing-alert-desktop', { loginAsAdmin: true });
    const { planId, generalCropId } = await createSpacingFixture(page);

    await page.goto('/app/planting-plans');
    await expect(page.getByRole('heading', { name: 'Anbaupläne' })).toBeVisible();
    const row = page.locator(`[role="row"][data-id="${planId}"]`);
    const plantsCell = row.locator('[data-field="plants_count"]');
    await expect(plantsCell).toBeVisible();

    await plantsCell.dblclick();
    const plantsInput = plantsCell.locator('input');
    await expect(plantsInput).toBeFocused();
    await plantsInput.fill('40');
    await page.keyboard.press('Enter');

    const alert = page.getByRole('alert').filter({ hasText: SPACING_MESSAGE });
    await expectAlertLinksToGeneralCrop(page, alert, generalCropId);
  });
});
