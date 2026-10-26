import { expect, test, type Page } from '@playwright/test';
import { loginWithDeterministicProject } from './utils';

// Functional assertions on the demo project's crop rotation cases (see the
// "Demo cases" table in docs/crop-rotation.md); the rules themselves are
// pinned by the backend tests.
const searchBox = (page: Page) => page.getByRole('searchbox', { name: 'Anbaupläne durchsuchen' });
const rows = (page: Page) => page.locator('[role="row"][data-id]');

test.describe('planting plan crop rotation in the table', () => {
  test.beforeEach(async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginWithDeterministicProject(page, request, 'planting-plans-rotation', {
      demoProject: true,
      loginAsAdmin: true,
    });
    await page.goto('/app/planting-plans');
    await expect(page.getByRole('heading', { name: 'Anbaupläne' })).toBeVisible();
    await expect(rows(page).first()).toBeVisible();
  });

  test('flags a conflict in the growing-area cell and opens "Anbaufläche ändern" from it', async ({ page }) => {
    await expect(page.getByRole('columnheader', { name: 'FF' })).toHaveCount(0);
    await searchBox(page).fill('Lauch');
    await expect(rows(page)).toHaveCount(1);

    await rows(page).getByRole('button', { name: 'Fruchtfolge-Konflikt, Anbaufläche ändern' }).click();

    const dialog = page.getByRole('dialog', { name: 'Anbaufläche ändern' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Fruchtfolge: Lauchgewächse zu früh auf diesem Beet')).toBeVisible();
    await expect(dialog.getByRole('checkbox', { name: 'Bewusst so planen (Konflikt akzeptieren)' })).toBeVisible();

    // Expanded by default for a conflict, across all locations of the project.
    const suggestions = dialog.getByTestId('area-bed-suggestions');
    await expect(suggestions.getByText(/^Passende Beete, frei von /)).toBeVisible();
    await expect(suggestions.getByTestId('bed-suggestion')).toHaveCount(3);
    const otherLocation = suggestions.getByTestId('bed-suggestion').filter({ hasNotText: 'Pachtacker Lindenhof' }).first();
    await expect(otherLocation).toBeVisible();

    await dialog.getByRole('combobox', { name: 'Beet' }).click();
    const listbox = page.getByRole('listbox');
    await expect(listbox.getByRole('option', { name: /Zuckermais/ })).toContainText('12 von 24 m² frei im Zeitraum');
    // The leek follows the bush beans during their harvest phase
    // (docs/bed-occupancy.md), so their bed stays selectable.
    const beans = listbox.getByRole('option', { name: /Bohnen/ });
    await expect(beans).not.toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');

    const locationName = (await otherLocation.innerText()).split(' | ')[0];
    await otherLocation.click();
    await expect(dialog.getByRole('combobox', { name: 'Standort' })).toHaveText(locationName);

    // Nothing is saved until "Übernehmen".
    await dialog.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(rows(page).getByRole('button', { name: 'Fruchtfolge-Konflikt, Anbaufläche ändern' })).toBeVisible();
  });

  test('leaves the cell empty when the rotation fits', async ({ page }) => {
    await searchBox(page).fill('Mangold');
    await expect(rows(page)).toHaveCount(1);

    await expect(rows(page).getByTestId('rotation-status-button')).toHaveCount(0);
  });

  test('filters by crop rotation status from the filter menu', async ({ page }) => {
    await expect(page.getByTestId('rotation-quick-filters')).toHaveCount(0);
    await page.getByRole('button', { name: 'Filter' }).click();
    const rotationFilter = page.getByRole('group', { name: 'Fruchtfolge' });
    await rotationFilter.getByRole('button', { name: 'Konflikt' }).click();
    await page.keyboard.press('Escape');

    await expect(page.getByText('Fruchtfolge: Konflikt')).toBeVisible();
    const count = await rows(page).count();
    expect(count).toBeGreaterThan(0);
    await expect(rows(page).getByRole('button', { name: 'Fruchtfolge-Konflikt, Anbaufläche ändern' })).toHaveCount(count);
  });

  test('explains in the tooltip why the rotation cannot be checked, matching the filter', async ({ page }) => {
    await page.getByRole('button', { name: 'Filter' }).click();
    await page.getByRole('group', { name: 'Fruchtfolge' }).getByRole('button', { name: 'Nicht prüfbar' }).click();
    await page.keyboard.press('Escape');

    const count = await rows(page).count();
    expect(count).toBeGreaterThan(0);
    const infoButtons = rows(page).getByRole('button', { name: 'Fruchtfolge nicht prüfbar, Anbaufläche ändern' });
    await expect(infoButtons).toHaveCount(count);

    await searchBox(page).fill('Erdbeere');
    await expect(rows(page)).toHaveCount(1);
    await infoButtons.hover();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toContainText('Fruchtfolge nicht prüfbar:');
    await expect(tooltip).toContainText(/Für Erdbeere.* ist keine Pflanzenfamilie hinterlegt\./);
    await expect(tooltip).toContainText('Du kannst die fehlenden Angaben in der Kulturbibliothek ergänzen.');
  });

  test('shows no icon for an accepted conflict, which the filter still finds', async ({ page }) => {
    await page.getByRole('button', { name: 'Filter' }).click();
    await page.getByRole('group', { name: 'Fruchtfolge' }).getByRole('button', { name: 'Akzeptiert' }).click();
    await page.keyboard.press('Escape');

    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page)).toContainText('Tomatenreihe 1');
    await expect(rows(page).getByTestId('rotation-status-button')).toHaveCount(0);
  });
});
