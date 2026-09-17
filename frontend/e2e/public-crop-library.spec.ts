import { expect, test, type Page } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject, resetE2EScenario } from './utils';

type CropSpecies = {
  id: number;
  name: string;
};

type Crop = {
  id: number;
  name: string;
  variety: string;
};

type PublishResponse = {
  public_crop: {
    id: number;
    name: string;
    variety: string;
  };
};

async function publishUniquePublicCrop(page: Page): Promise<PublishResponse['public_crop']> {
  const speciesResponse = await apiRequest<{ results: CropSpecies[] }>(page, 'GET', '/crop-species/');
  const species = speciesResponse.results[0];
  expect(species).toBeTruthy();
  const uniqueSuffix = Date.now();
  const crop = await apiRequest<Crop>(page, 'POST', '/crops/', {
    name: species.name,
    variety: `E2E Kollaboration ${uniqueSuffix}`,
    crop_species: species.id,
    cultivation_type: 'pre_cultivation',
    cultivation_types: ['pre_cultivation'],
    growth_duration_days: 42,
    harvest_duration_days: 14,
    notes: 'Bestehende öffentliche Notiz.',
  });
  const published = await apiRequest<PublishResponse>(page, 'POST', `/crops/${crop.id}/publish-public/`, {
    accepted_public_library_terms: true,
    crop_species_id: species.id,
    original_language_code: 'de',
  });
  return published.public_crop;
}

test('public crop library supports quick import, direct edit, versions, discussion, and mobile layout', async ({ page, request }) => {
  const scenarioId = `public-crop-library-${Date.now()}`;

  try {
    await loginWithDeterministicProject(page, request, scenarioId, { loginAsAdmin: true });
    const publicCrop = await publishUniquePublicCrop(page);

    await page.goto('/app/crops');
    // The library entry point lives inside the topbar's Import/Export menu
    // rather than being its own button.
    await page.getByRole('button', { name: 'Import/Export' }).click();
    await page.getByRole('menuitem', { name: 'Aus Bibliothek importieren' }).click();
    const importDialog = page.getByRole('dialog', { name: 'Aus Kulturbibliothek importieren' });
    await expect(importDialog).toBeVisible();
    await importDialog.getByLabel('Öffentliche Kulturen durchsuchen').fill(publicCrop.variety);
    await expect(importDialog.getByRole('option', { name: new RegExp(publicCrop.variety) })).toBeVisible();
    await importDialog.getByRole('option', { name: new RegExp(publicCrop.variety) }).click();
    await expect(page.getByRole('button', { name: 'In Projekt importieren' })).toBeEnabled();
    await page.getByRole('button', { name: 'In Projekt importieren' }).click();
    // The crop was published from this project, so it is already linked to the
    // public entry and identical to it: the quick import reports "unchanged"
    // rather than creating a second copy.
    await expect(page.getByText(/ist bereits identisch/i)).toBeVisible();

    // The dialog now stays open after a successful import (so multiple
    // crops can be imported in one sitting) instead of closing itself.
    await expect(importDialog).toBeVisible();
    await importDialog.getByRole('link', { name: 'Kulturbibliothek öffnen' }).click();
    await expect(page).toHaveURL(/\/app\/crop-library/);

    await page.goto('/app/crop-library');
    await expect(page.getByRole('heading', { name: 'Kulturbibliothek' })).toBeVisible();
    await expect(page.getByText('Die Kulturbibliothek wächst mit der Community')).toBeVisible();
    await expect(page.getByText('Teile deine bewährten Kulturen mit anderen.')).toBeVisible();
    await page.getByLabel('Öffentliche Kulturen durchsuchen').fill(publicCrop.variety);
    await page.keyboard.press('Enter');
    await expect(page.getByText(publicCrop.variety).first()).toBeVisible();
    await page.getByText(publicCrop.variety).first().click();
    await expect(page.getByRole('heading', { name: 'Allgemeine Informationen' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Zeitplanung' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Saatgut' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Bibliotheksdaten' })).toBeVisible();
    await expect(page.getByText('42 Tage')).toBeVisible();
    await expect(page.getByText('14 Tage')).toBeVisible();
    await expect(page.getByText('Bestehende öffentliche Notiz.')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`cropId=${publicCrop.id}`));

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Bibliotheksdaten' })).toBeVisible();
    await expect(page.getByText(publicCrop.variety).first()).toBeVisible();

    await page.goto('/app/crops');
    await page.goto('/app/crop-library');
    await expect(page.getByRole('heading', { name: 'Allgemeine Informationen' })).toBeVisible();
    await expect(page.getByText(publicCrop.variety).first()).toBeVisible();

    // The project copy is still identical to the entry it was published from,
    // so there is nothing to pull: the action is disabled and says why instead
    // of reporting the no-op after a click.
    const updateInProjectButton = page.getByRole('button', { name: 'Im Projekt aktualisieren' });
    await expect(updateInProjectButton).toBeDisabled();
    await updateInProjectButton.hover({ force: true });
    await expect(page.getByText('Bereits aktuell – keine Änderungen vorhanden')).toBeVisible();

    await page.getByRole('tab', { name: /Diskussion/ }).click();
    await expect(page.getByText('Noch keine Diskussionen')).toBeVisible();
    await page.getByRole('button', { name: 'Neue Diskussion' }).click();
    await page.getByLabel('Titel').fill('Wachstumszeit prüfen');
    await page.getByLabel('Kommentar').fill('E2E-Kommentar zur öffentlichen Kultur.');
    await page.getByRole('button', { name: 'Diskussion starten' }).click();
    await page.getByText('Wachstumszeit prüfen').click();
    await expect(page.getByText('E2E-Kommentar zur öffentlichen Kultur.')).toBeVisible();
    await page.getByRole('button', { name: 'Antworten' }).click();
    await page.getByRole('textbox', { name: 'Antwort' }).fill('E2E-Antwort.');
    await page.getByRole('button', { name: 'Absenden' }).click();
    await expect(page.getByText('E2E-Antwort.')).toBeVisible();

    await page.getByRole('tab', { name: /Details/ }).click();
    await expect(page.getByRole('heading', { name: 'Allgemeine Informationen' })).toBeVisible();
    await page.getByTestId('public-crop-detail-header').getByRole('button', { name: 'Bearbeiten' }).click();
    const editDialog = page.getByRole('dialog', { name: 'Öffentliche Kultur bearbeiten' });
    await expect(editDialog).toBeVisible();
    const growthDurationInput = editDialog.getByLabel('Wachstumszeit (Tage)');
    await expect(growthDurationInput).toHaveValue('42');
    await growthDurationInput.fill('48');
    await expect(growthDurationInput).toHaveValue('48');
    const saveButton = editDialog.getByRole('button', { name: 'Speichern' });
    await expect(saveButton).toBeEnabled();
    const [saveResponse] = await Promise.all([
      page.waitForResponse((response) => (
        response.url().includes(`/api/public-crops/${publicCrop.id}/`)
        && response.request().method() === 'PATCH'
      )),
      page.keyboard.press('Control+S'),
    ]);
    expect(saveResponse.ok()).toBeTruthy();
    await expect(editDialog).not.toBeVisible();
    await expect(page.getByText('48 Tage')).toBeVisible();
    await expect(page.getByTestId('public-crop-detail-header').getByRole('button', { name: 'Übersetzen' })).toHaveCount(0);

    await page.getByRole('tab', { name: /Versionen/ }).click();
    await expect(page.getByRole('heading', { name: 'Version 2' })).toBeVisible();
    await expect(page.getByText('Aktuelle Version')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Version 1' })).toBeVisible();
    await page.getByRole('button', { name: 'Wiederherstellen' }).click();
    await expect(page.getByRole('heading', { name: 'Version 3' })).toBeVisible();
    await expect(page.getByText('Aus Version 1 wiederhergestellt')).toBeVisible();
    await page.getByRole('tab', { name: /Details/ }).click();
    await expect(page.getByText('42 Tage')).toBeVisible();
    await expect(page.getByText('Bestehende öffentliche Notiz.')).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Kulturbibliothek' })).toBeVisible();
    await expect(page.getByLabel('Öffentliche Kulturen durchsuchen')).not.toBeVisible();
    await page.getByRole('button', { name: 'Kultur auswählen' }).click();
    const mobileSelector = page.getByRole('dialog', { name: 'Kultur auswählen' });
    await expect(mobileSelector).toBeVisible();
    await mobileSelector.getByLabel('Öffentliche Kulturen durchsuchen').fill(publicCrop.variety);
    await mobileSelector.getByRole('option', { name: new RegExp(publicCrop.variety) }).click();
    await expect(mobileSelector).not.toBeVisible();
    await expect(page.getByText(publicCrop.variety).first()).toBeVisible();
    await expect(page.locator('body')).not.toHaveCSS('overflow-x', 'scroll');
  } finally {
    await resetE2EScenario(request, scenarioId);
  }
});
