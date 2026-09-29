import { expect, test, type Page } from '@playwright/test';
import { loginWithDeterministicProject } from './utils';

// Functional assertions only (no screenshots): the search rules are pinned by
// unit tests, this spec proves the wiring on the real grid and card list.
const VIEWPORTS = [
  { key: 'mobile', width: 375, height: 800, isMobile: true },
  { key: 'small-desktop', width: 1024, height: 900, isMobile: false },
  { key: 'desktop', width: 1440, height: 900, isMobile: false },
] as const;

const searchBox = (page: Page) => page.getByRole('searchbox', { name: 'Anbaupläne durchsuchen' });
const searchCount = (page: Page) => page.getByTestId('planting-plan-search-count');

for (const viewport of VIEWPORTS) {
  test.describe(`planting plan search (${viewport.key})`, () => {
    const results = (page: Page) => (viewport.isMobile
      ? page.locator('[data-mobile-card-id]')
      : page.locator('[role="row"][data-id]'));

    test.beforeEach(async ({ page, request }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await loginWithDeterministicProject(page, request, `planting-plans-search-${viewport.key}`, {
        demoProject: true,
        loginAsAdmin: true,
      });
      await page.goto('/app/planting-plans');
      await expect(page.getByRole('heading', { name: 'Anbaupläne' })).toBeVisible();
      await expect(results(page).first()).toBeVisible();
      await expect(searchCount(page)).toHaveText(/^\d+ Anbaupläne$/);
    });

    test('searches live, finds synonyms and notes, and clears with Escape', async ({ page }) => {
      const total = await results(page).count();

      await searchBox(page).fill('PARADEISER');
      await expect(results(page)).toHaveCount(2);
      await expect(searchCount(page)).toHaveText(viewport.isMobile ? `2 von ${total}` : `2 von ${total} Anbauplänen`);
      await expect(page.getByText('Synonym: Paradeiser').first()).toBeVisible();

      // Only the notes contain this word.
      await searchBox(page).fill('jungpflanzen');
      await expect(results(page)).toHaveCount(1);
      if (viewport.isMobile) {
        await expect(page.getByTestId('planting-plan-notes-match').locator('mark')).toHaveText('Jungpflanzen');
      } else {
        await expect(results(page).getByRole('button', { name: /Notiz/ })).toBeVisible();
      }

      await searchBox(page).fill('reihe 2');
      await expect(results(page)).toHaveCount(1);
      await expect(results(page).locator('mark').first()).toHaveText('reihe');

      await searchBox(page).press('Escape');
      await expect(searchBox(page)).toHaveValue('');
      await expect(results(page)).toHaveCount(total);
    });

    test('sets and removes a filter', async ({ page }) => {
      const total = await results(page).count();

      if (viewport.isMobile) {
        await page.getByRole('button', { name: 'Filter', exact: true }).click();
        const sheet = page.getByRole('dialog', { name: 'Filter und Sortierung' });
        await expect(sheet).toBeVisible();
        await sheet.getByRole('button', { name: 'Acker am Bach' }).click();
        await sheet.getByRole('button', { name: /Anbaupl(an|äne) anzeigen$/ }).click();
        await expect(sheet).toBeHidden();
      } else {
        const filterButton = page.getByRole('button', { name: 'Filter', exact: true });
        await expect(filterButton).toHaveAttribute('aria-expanded', 'false');
        await filterButton.click();
        const panel = page.getByRole('dialog', { name: 'Filter' });
        await panel.getByRole('button', { name: 'Acker am Bach' }).click();
        await expect(panel.getByText(/^\d+ Treffer$/)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(panel).toBeHidden();
      }

      await expect(page.getByText('Standort: Acker am Bach')).toBeVisible();
      const filteredCount = await results(page).count();
      expect(filteredCount).toBeGreaterThan(0);
      expect(filteredCount).toBeLessThan(total);
      await expect(results(page).filter({ hasText: 'Tomate' })).toHaveCount(0);

      await page.getByRole('button', { name: 'Filter Standort entfernen' }).click();
      await expect(page.getByText('Standort: Acker am Bach')).toHaveCount(0);
      await expect(results(page)).toHaveCount(total);
    });

    test('shows the empty state and recovers from it', async ({ page }) => {
      const total = await results(page).count();

      await searchBox(page).fill('xyzkultur');
      const emptyState = page.getByTestId('planting-plan-search-empty');
      await expect(emptyState.getByRole('heading', { name: 'Keine Anbaupläne gefunden für „xyzkultur“' })).toBeVisible();
      await expect(emptyState.getByText('Prüfe die Schreibweise oder suche nach Kultur, Sorte oder Beet.')).toBeVisible();
      await expect(emptyState.getByRole('button', { name: 'Filter zurücksetzen' })).toHaveCount(0);

      await emptyState.getByRole('button', { name: 'Suche löschen' }).click();
      await expect(emptyState).toHaveCount(0);
      await expect(results(page)).toHaveCount(total);
    });

    if (!viewport.isMobile) {
      test('focuses the search with / and opens the filter panel from the column menu', async ({ page }) => {
        await page.getByRole('heading', { name: 'Anbaupläne' }).click();
        await page.keyboard.press('/');
        await expect(searchBox(page)).toBeFocused();

        await page.getByRole('columnheader', { name: 'Anbauart' }).hover();
        await page.getByRole('columnheader', { name: 'Anbauart' }).getByRole('button', { name: /menu|Menü/i }).click();
        await page.getByRole('menuitem', { name: 'Filter' }).click();
        await expect(page.getByRole('dialog', { name: 'Filter' })).toBeVisible();
      });
    }
  });
}
