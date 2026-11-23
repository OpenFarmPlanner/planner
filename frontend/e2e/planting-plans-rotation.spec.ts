import { expect, test, type Page } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject } from './utils';

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

  test('opens the conflict details from the keyboard and accepts or clears the conflict', async ({ page }) => {
    await expect(page.getByRole('columnheader', { name: 'FF' })).toHaveCount(0);
    await searchBox(page).fill('Lauch');
    // The carrots beside the leek share its bed "Knoblauch & Lauch" (#1189).
    const leek = rows(page).filter({
      has: page.locator('[data-field="crop"]').getByText('Lauch', { exact: true }),
    });
    await expect(leek).toHaveCount(1);

    const bedCell = leek.locator('[data-field="bed"]');
    await bedCell.click();
    const icon = leek.getByRole('button', { name: 'Fruchtfolgekonflikt anzeigen' });
    await page.keyboard.press('Tab');
    await expect(icon).toBeFocused();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Fruchtfolge: Lauchgewächse zu früh auf diesem Beet')).toBeVisible();
    const accept = dialog.getByRole('checkbox', { name: 'Bewusst so planen (Konflikt akzeptieren)' });
    await expect(accept).not.toBeChecked();
    await expect(dialog.getByRole('link', { name: /Anbaupause/ })).toHaveAttribute('href', /\/app\/crops\?cropId=\d+&action=edit/);
    await dialog.getByRole('button', { name: /Belegung von .* anzeigen/ }).click();
    await expect(dialog.getByTestId('rotation-bed-history')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Standort, Parzelle, Beet suchen' })).toHaveCount(0);
    await accept.check();
    await expect(accept).toBeChecked();
    await expect(leek.locator('[data-rotation-status="accepted"]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await leek.getByRole('button', { name: 'Akzeptierten Fruchtfolgekonflikt anzeigen' }).click();
    await accept.uncheck();
    await expect(leek.locator('[data-rotation-status="conflict"]')).toHaveCount(1);
    await page.keyboard.press('Escape');
  });

  test('marks conflicts before committing a bed and saves the choice without opening the details', async ({ page }) => {
    await searchBox(page).fill('Lauch');
    const leek = rows(page).filter({ has: page.locator('[data-field="crop"]').getByText('Lauch', { exact: true }) });
    await expect(leek).toHaveCount(1);
    const bedCell = leek.locator('[data-field="bed"]');
    await bedCell.dblclick();
    await page.getByRole('button', { name: 'An allen Standorten suchen' }).click();
    const listbox = page.getByRole('listbox');
    await expect(listbox.getByRole('option', { name: /Zuckermais/ })).toContainText('12 von 24 m² frei im Zeitraum');
    const beans = listbox.getByRole('option', { name: /Bohnen/ });
    await expect(beans).not.toHaveAttribute('aria-disabled', 'true');
    await beans.click();
    await expect(bedCell).toContainText('Bohnen');
    await bedCell.dblclick();
    await page.getByRole('button', { name: 'An allen Standorten suchen' }).click();
    const conflictingBed = listbox.getByRole('option', { name: /Knoblauch & Lauch/ });
    await expect(conflictingBed.locator('[data-rotation-status="conflict"]')).toBeVisible();
    await expect(conflictingBed).toContainText(/Lauchgewächse, frühestens \d{4}/);
    await conflictingBed.click();
    await expect(bedCell).toContainText('Knoblauch & Lauch');
    await expect(leek.getByRole('button', { name: 'Fruchtfolgekonflikt anzeigen' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('keeps a saved conflict separate from an unsaved bed change', async ({ page }) => {
    await searchBox(page).fill('Lauch');
    const match = rows(page).filter({ has: page.locator('[data-field="crop"]').getByText('Lauch', { exact: true }) });
    const plan = await match.getAttribute('data-id');
    const leek = page.locator(`[role="row"][data-id="${plan}"]`);
    const bedCell = leek.locator('[data-field="bed"]');
    const icon = leek.getByRole('button', { name: 'Fruchtfolgekonflikt anzeigen' });
    await expect(icon).toBeVisible();
    const path = `/planting-plans/${plan}/`;
    const saved = await apiRequest<{ bed: number; rotation_conflict_accepted: boolean }>(page, 'GET', path);
    const plantingDate = leek.locator('[data-field="planting_date"]');

    await page.getByRole('button', { name: /^Terminansicht / }).click();
    await page.getByRole('menuitemradio', { name: 'Geplant', exact: true }).click();
    await plantingDate.dblclick();
    await expect(leek).toHaveClass(/ofp-row-editing/);
    await bedCell.dblclick();
    await page.getByRole('button', { name: 'An allen Standorten suchen' }).click();
    await page.getByRole('option', { name: /Bohnen/ }).click();
    await expect(bedCell).toContainText('Bohnen');
    await expect(leek.getByTestId('rotation-status-button')).toHaveCount(0);
    expect(await apiRequest(page, 'GET', path)).toMatchObject({
      bed: saved.bed, rotation_conflict_accepted: saved.rotation_conflict_accepted,
    });

    await plantingDate.getByRole('textbox').press('Escape');
    await expect(bedCell).toContainText('Knoblauch & Lauch');
    await expect(icon).toBeVisible();
    expect(await apiRequest(page, 'GET', path)).toMatchObject({
      bed: saved.bed, rotation_conflict_accepted: saved.rotation_conflict_accepted,
    });
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
    const seasonMarker = page.getByRole('button', { name: /Hier nur lesbar/ });
    const carriedOver = rows(page).filter({ has: seasonMarker });
    const current = rows(page).filter({ hasNot: seasonMarker });
    await expect(carriedOver.first()).toBeVisible();
    await expect(current.first()).toBeVisible();
    const changeArea = { name: 'Fruchtfolgekonflikt anzeigen' };
    await expect(current.getByRole('button', changeArea)).toHaveCount(await current.count());
    await expect(carriedOver.getByRole('button', changeArea)).toHaveCount(0);
    const warning = carriedOver.getByRole('img', { name: 'Konflikt', exact: true });
    await expect(warning).toHaveCount(await carriedOver.count());
    await warning.first().hover();
    await expect(page.getByRole('tooltip')).toContainText('Fruchtfolge:');
  });

  test('explains in the tooltip why the rotation cannot be checked, matching the filter', async ({ page }) => {
    await page.getByRole('button', { name: 'Filter' }).click();
    await page.getByRole('group', { name: 'Fruchtfolge' }).getByRole('button', { name: 'Nicht prüfbar' }).click();
    await page.keyboard.press('Escape');

    const count = await rows(page).count();
    expect(count).toBeGreaterThan(0);
    const infoButtons = rows(page).getByRole('button', { name: 'Warum die Fruchtfolge nicht prüfbar ist' });
    await expect(infoButtons).toHaveCount(count);

    await searchBox(page).fill('Erdbeere');
    await expect(rows(page)).toHaveCount(1);
    await infoButtons.hover();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toContainText('Fruchtfolge nicht prüfbar:');
    await expect(tooltip).toContainText(/Für Erdbeere.* ist keine Pflanzenfamilie hinterlegt\./);
    await expect(tooltip).toContainText('Du kannst die fehlenden Angaben in der Kulturbibliothek ergänzen.');
  });

  test('shows an accepted conflict icon and includes it in the filter', async ({ page }) => {
    await page.getByRole('button', { name: 'Filter' }).click();
    await page.getByRole('group', { name: 'Fruchtfolge' }).getByRole('button', { name: 'Akzeptiert' }).click();
    await page.keyboard.press('Escape');

    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page)).toContainText('Tomatenreihe 1');
    await expect(rows(page).getByRole('button', { name: 'Akzeptierten Fruchtfolgekonflikt anzeigen' })).toBeVisible();
  });
});
