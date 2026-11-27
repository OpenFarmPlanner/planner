import { expect, test, type Locator } from '@playwright/test';
import common from '../src/i18n/locales/de/common.json' with { type: 'json' };
import navigation from '../src/i18n/locales/de/navigation.json' with { type: 'json' };
import plans from '../src/i18n/locales/de/plantingPlans.json' with { type: 'json' };
import { apiRequest, expectNoHorizontalPageOverflow, loginWithDeterministicProject, resetE2EScenario } from './utils';

test.describe('planting plans empty new row cancellation', () => {
  test.beforeEach(async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await loginWithDeterministicProject(page, request, 'planting-plans-empty-new-row', {
      demoProject: true,
      loginAsAdmin: true,
    });
    await page.goto('/app/planting-plans');
    await expect(page.getByRole('heading', { name: 'Anbaupläne' })).toBeVisible();
    await expect(page.locator('[role="row"][data-id]').first()).toBeVisible();
  });

  test('clicking outside an untouched new row discards it without validation', async ({ page }) => {
    const grid = page.getByRole('grid');
    // The draft moves the viewport. The rendered row count can change with scrolling.
    const rowCountBefore = Number(await grid.getAttribute('aria-rowcount'));

    await page.getByRole('button', { name: /^Anbauplan hinzufügen/ }).first().click();
    await expect(page.locator('.MuiDataGrid-row--editing')).toBeInViewport();

    await page.getByRole('heading', { name: 'Anbaupläne' }).click();

    await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(0);
    await expect(grid).toHaveAttribute('aria-rowcount', String(rowCountBefore));
    await expect(page.getByText('Kultur oder Beet ist ein Pflichtfeld')).toHaveCount(0);
  });

  test('Escape discards an untouched new row without validation', async ({ page }) => {
    const grid = page.getByRole('grid');
    const rowCountBefore = Number(await grid.getAttribute('aria-rowcount'));

    await page.getByRole('button', { name: /^Anbauplan hinzufügen/ }).first().click();
    await expect(page.locator('.MuiDataGrid-row--editing')).toBeInViewport();

    await page.keyboard.press('Escape');

    await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(0);
    await expect(grid).toHaveAttribute('aria-rowcount', String(rowCountBefore));
    await expect(page.getByText('Kultur oder Beet ist ein Pflichtfeld')).toHaveCount(0);
  });
});

async function expectReadableGridMessage(grid: Locator) {
  const message = grid.getByText(common.messages.noRows, { exact: true });
  await expect(message).toBeVisible();
  await expect.poll(() => message.evaluate((overlay) => {
    const header = overlay.closest('[role="grid"]')?.querySelector('.MuiDataGrid-columnHeaders');
    const range = document.createRange();
    range.selectNodeContents(overlay);
    const { left, top, right, bottom } = range.getBoundingClientRect();
    const overlayBounds = overlay.getBoundingClientRect();
    return Boolean(header
      && top >= header.getBoundingClientRect().bottom
      && top >= overlayBounds.top
      && bottom <= overlayBounds.bottom
      && overlay.contains(document.elementFromPoint(left + 1, (top + bottom) / 2))
      && overlay.contains(document.elementFromPoint(right - 1, (top + bottom) / 2)));
  })).toBe(true);
}

test.describe('planting plan setup and empty grid layout', () => {
  test.use({ hasTouch: true, serviceWorkers: 'block' });

  for (const withSeason of [false, true]) {
    test(`keeps the ${withSeason ? 'empty-season' : 'no-season'} guidance readable and actionable`, async ({ page, request }, info) => {
      const scenario = `planting-plans-empty-${withSeason ? 'season' : 'project'}-${Date.now()}`;
      try {
        await loginWithDeterministicProject(page, request, scenario, { loginAsAdmin: true });
        const location = await apiRequest<{ id: number }>(page, 'POST', '/locations/', { name: 'Test garden' });
        const field = await apiRequest<{ id: number }>(page, 'POST', '/fields/', { name: 'Test field', location: location.id });
        await apiRequest(page, 'POST', '/beds/', { name: 'Test bed', field: field.id, area_sqm: 12 });
        await apiRequest(page, 'POST', '/crops/', { name: 'Test tomato' });
        if (withSeason) {
          const year = new Date().getUTCFullYear();
          await apiRequest(page, 'POST', '/seasons/', { start_date: `${year}-01-01`, end_date: `${year}-12-31` });
        }
        const guidance = plans.emptyStates.states[withSeason ? 'plans' : 'seasons'];
        const main = page.getByRole('main');
        const action = main.getByRole('button', {
          name: withSeason ? common.setupActions.createPlan : plans.emptyStates.actions.createSeason,
          exact: true,
        });
        const grid = main.getByRole('grid');

        for (const [width, height] of [[1024, 900], [1440, 900], [375, 800], [800, 375]]) {
          await page.setViewportSize({ width, height });
          await page.goto('/app/planting-plans');
          const description = main.getByText(guidance.description, { exact: true });
          await expect(main.getByText(guidance.title, { exact: true })).toBeInViewport({ ratio: 1 });
          await expect(description).toBeInViewport({ ratio: 1 });
          await expect(action).toBeInViewport({ ratio: 1 });
          await expectNoHorizontalPageOverflow(page);

          if (width >= 900) {
            await expectReadableGridMessage(grid);
            await page.screenshot({ path: info.outputPath(`empty-${width}.png`), animations: 'disabled' });
            const scrollLeft = await grid.evaluate((element) => {
              let scrollport = element.parentElement;
              while (scrollport && !['auto', 'scroll'].includes(getComputedStyle(scrollport).overflowX)) {
                scrollport = scrollport.parentElement;
              }
              if (!scrollport) throw new Error('Missing grid scrollport');
              scrollport.scrollLeft = scrollport.scrollWidth;
              return scrollport.scrollLeft;
            });
            expect(scrollLeft).toBeGreaterThan(0);
            await expectReadableGridMessage(grid);
            await expect(description).toBeInViewport({ ratio: 1 });
            await expect(action).toBeInViewport({ ratio: 1 });
            await page.screenshot({ path: info.outputPath(`empty-${width}-scrolled.png`), animations: 'disabled' });
          } else {
            await expect(grid).toHaveCount(0);
            await page.screenshot({ path: info.outputPath(`empty-${width}.png`), animations: 'disabled' });
          }

          await expect(action).toHaveJSProperty('tabIndex', 0);
          await action.focus();
          await expect(action).toBeFocused();

          if (width === 800) await action.tap();
          else if (width === 1440) await action.click();
          else await action.press('Enter');

          if (withSeason && width >= 900) {
            const draft = grid.locator('.MuiDataGrid-row--editing');
            await expect(draft).toBeInViewport();
            await page.keyboard.press('Escape');
            await expect(draft).toHaveCount(0);
            await expectReadableGridMessage(grid);
          } else {
            const dialog = withSeason ? page.getByRole('dialog', { name: plans.mobile.createTitle })
              : page.getByRole('dialog', { name: navigation.firstSeason.title, exact: true });
            await expect(dialog).toBeVisible();
            if (!withSeason) await expect(dialog.getByLabel(navigation.firstSeason.year, { exact: true })).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(dialog).toBeHidden();
          }
          await expect(action).toBeInViewport({ ratio: 1 });
        }
      } finally {
        await resetE2EScenario(request, scenario);
      }
    });
  }
});
