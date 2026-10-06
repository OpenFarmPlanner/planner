import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { loginWithDeterministicProject } from './utils';

const backendPort = process.env.BACKEND_PORT ?? '8000';
const apiBase = `http://127.0.0.1:${backendPort}/api`;

const focusedField = async (page: Page): Promise<string | null> =>
  page.evaluate(() =>
    document.activeElement?.closest('[role="gridcell"]')?.getAttribute('data-field') ?? null);

type AreaDialogFixtureOptions = {
  languageCode?: 'de' | 'en';
  longNames?: boolean;
  /** Number of planting plans to create; defaults to a single row. */
  planCount?: number;
};

async function createAreaDialogFixture(
  page: Page,
  request: APIRequestContext,
  scenario: string,
  options: AreaDialogFixtureOptions = {},
): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/');
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  await loginWithDeterministicProject(page, request, scenario, {
    loginAsAdmin: true,
  });
  if (options.languageCode) {
    await page.evaluate((languageCode) => {
      window.localStorage.setItem('ui.language', languageCode);
    }, options.languageCode);
    await page.reload();
    await expect(page).toHaveURL(/\/app\//);
  }

  const activeProjectId = await page.evaluate(() => window.localStorage.getItem('activeProjectId'));
  const projectId = Number(activeProjectId);
  const csrfToken = await page.evaluate(() =>
    document.cookie.split('; ').find((row) => row.startsWith('csrftoken='))?.split('=')[1] ?? '');

  const api = async <T,>(path: string, data: Record<string, unknown>): Promise<T> => {
    const response = await page.request.post(`${apiBase}${path}`, {
      headers: {
        'X-CSRFToken': csrfToken,
        'Content-Type': 'application/json',
        'X-Project-Id': String(projectId),
      },
      data: { ...data, project: projectId },
    });
    expect(response.ok(), `${path} -> ${response.status()}: ${await response.text()}`).toBeTruthy();
    return response.json() as Promise<T>;
  };

  const locationName = options.longNames
    ? 'Sonnenacker mit sehr langer Standortbezeichnung am Nordhang'
    : 'Hofgarten';
  const fieldName = options.longNames
    ? 'Folientunnel Sued mit langer Parzellenbezeichnung und Zusatz'
    : 'Fruehbeete Nord';
  const bedName = options.longNames
    ? 'Tomatenreihe mit besonders langer Beetbezeichnung 2026'
    : 'Salat 1';

  const season = await api<{ id: number }>('/seasons/', { start_date: '2026-01-01', end_date: '2026-12-31' });
  const location = await api<{ id: number }>('/locations/', { name: locationName });
  const field = await api<{ id: number }>('/fields/', { name: fieldName, location: location.id });
  const bed = await api<{ id: number }>('/beds/', {
    name: bedName,
    field: field.id,
    area_sqm: 18.8,
  });
  const crop = await api<{ id: number }>('/crops/', {
    name: 'Salat',
    variety: 'Dialog',
    propagation_duration_days: 21,
    cultivation_type: 'pre_cultivation',
    cultivation_types: ['pre_cultivation'],
    plants_per_m2: 4,
  });
  for (let index = 0; index < (options.planCount ?? 1); index += 1) {
    await api<{ id: number }>('/planting-plans/', {
      bed: bed.id,
      crop: crop.id,
      season: season.id,
      cultivation_type: 'pre_cultivation',
      planting_date: `2026-04-${String(10 + index).padStart(2, '0')}`,
      area_usage_sqm: 2,
    });
  }
}

async function openAreaAssignmentDialog(page: Page, title: string, editLabel: string) {
  await page.goto('/app/planting-plans');
  await expect(page.getByRole('heading', { name: /Anbaupläne|Planting plans/ })).toBeVisible();
  const bedCell = page.locator('[role="gridcell"][data-field="bed"]').first();
  await expect(bedCell).toBeVisible();

  // A single click must open the real editor — the bed cell has no inline edit
  // mode to step through first.
  await bedCell.getByLabel(editLabel).click();

  const dialog = page.getByRole('dialog', { name: title });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openFocusedAreaCellWithEnter(page: Page, rowIndex: number): Promise<void> {
  await expect(
    page.locator('[role="gridcell"][data-field="bed"]').nth(rowIndex).getByLabel('Anbaufläche bearbeiten'),
  ).toBeFocused();
  await page.keyboard.press('Enter');
}

async function readDialogMetrics(page: Page, title: string) {
  return page.getByRole('dialog', { name: title }).evaluate((dialogElement) => {
    const paper = dialogElement.closest<HTMLElement>('.MuiPaper-root') ?? dialogElement;
    const content = dialogElement.querySelector<HTMLElement>('.MuiDialogContent-root');
    const actions = dialogElement.querySelector<HTMLElement>('.MuiDialogActions-root');
    const controls = Array.from(dialogElement.querySelectorAll<HTMLElement>('.MuiFormControl-root'))
      .map((element) => element.getBoundingClientRect());
    const paperRect = paper.getBoundingClientRect();
    const contentRect = content?.getBoundingClientRect();
    const actionsRect = actions?.getBoundingClientRect();

    return {
      actionsWidth: actionsRect?.width ?? 0,
      contentClientHeight: content?.clientHeight ?? 0,
      contentClientWidth: content?.clientWidth ?? 0,
      contentScrollHeight: content?.scrollHeight ?? 0,
      contentScrollWidth: content?.scrollWidth ?? 0,
      contentWidth: contentRect?.width ?? 0,
      controlHeights: controls.map((rect) => rect.height),
      controlWidths: controls.map((rect) => rect.width),
      gaps: controls.slice(1).map((rect, index) => rect.top - controls[index].bottom),
      paperLeft: paperRect.left,
      paperRight: paperRect.right,
      paperWidth: paperRect.width,
      viewportWidth: window.innerWidth,
    };
  });
}

test.describe('planting plans area assignment dialog', () => {
  test('opens on a single click and keeps the grid keyboard-navigable afterwards', async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await createAreaDialogFixture(page, request, 'planting-plans-area-dialog-single-click');

    await page.goto('/app/planting-plans');
    await expect(page.getByRole('heading', { name: 'Anbaupläne' })).toBeVisible();
    const bedCell = page.locator('[role="gridcell"][data-field="bed"]').first();
    await expect(bedCell).toBeVisible();

    // No pencil button next to the value, and no inline edit cell in between.
    await expect(bedCell.locator('[data-testid="EditIcon"]')).toHaveCount(0);

    await bedCell.getByLabel('Anbaufläche bearbeiten').click();
    await expect(page.getByRole('dialog', { name: 'Anbaufläche ändern' })).toBeVisible();
    await expect(page.locator('.MuiDataGrid-row.ofp-row-editing')).toHaveCount(0);

    await page.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(page.getByRole('dialog', { name: 'Anbaufläche ändern' })).toBeHidden();

    // Focus returns to the cell, so plain arrow navigation keeps working.
    await expect(bedCell.getByLabel('Anbaufläche bearbeiten')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(
      page.locator('[role="gridcell"][data-field="cultivation_type"]').first(),
    ).toHaveAttribute('tabindex', '0');
  });

  test('focuses on keyboard entry and opens with Enter, forwards and backwards', async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await createAreaDialogFixture(page, request, 'planting-plans-area-dialog-keyboard', { planCount: 3 });

    await page.goto('/app/planting-plans');
    await expect(page.getByRole('heading', { name: 'Anbaupläne' })).toBeVisible();

    const dialog = page.getByRole('dialog', { name: 'Anbaufläche ändern' });
    const cellAt = (field: string, rowIndex: number) =>
      page.locator(`[role="gridcell"][data-field="${field}"]`).nth(rowIndex);
    const bedCell = cellAt('bed', 0);
    const previousCell = cellAt('cultivation_type', 0);
    await expect(bedCell).toBeVisible();

    // Tab onto the cell focuses it without opening the dialog …
    await previousCell.click();
    await page.keyboard.press('Escape');
    await previousCell.focus();
    await page.keyboard.press('Tab');
    await expect(dialog).toBeHidden();
    await expect(bedCell.getByLabel('Anbaufläche bearbeiten')).toBeFocused();

    // … Enter starts the edit dialog.
    await openFocusedAreaCellWithEnter(page, 0);
    await expect(dialog).toBeVisible();

    // Cancelling leaves focus on the cell, and re-entering focuses it again.
    await page.getByRole('button', { name: 'Abbrechen' }).click();
    await expect(dialog).toBeHidden();
    await expect(bedCell.getByLabel('Anbaufläche bearbeiten')).toBeFocused();
    await openFocusedAreaCellWithEnter(page, 0);
    await expect(dialog).toBeVisible();

    // Escape must not save, and must not stop the next entry from opening.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(bedCell.getByLabel('Anbaufläche bearbeiten')).toBeFocused();
    await openFocusedAreaCellWithEnter(page, 0);
    await expect(dialog).toBeVisible();

    // Backwards navigation from the following cell focuses it too.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.keyboard.press('Tab');
    await expect.poll(() => focusedField(page)).toBe('sowing_date');
    await page.keyboard.press('Shift+Tab');
    await expect(dialog).toBeHidden();
    await openFocusedAreaCellWithEnter(page, 0);
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // Every other row behaves the same, in both directions.
    for (const rowIndex of [1, 2]) {
      await cellAt('cultivation_type', rowIndex).click();
      await page.keyboard.press('Escape');
      await cellAt('cultivation_type', rowIndex).focus();
      await page.keyboard.press('Tab');
      await expect(dialog).toBeHidden();
      await openFocusedAreaCellWithEnter(page, rowIndex);
      await expect(dialog).toBeVisible();
      await page.getByRole('button', { name: 'Abbrechen' }).click();
      await expect(dialog).toBeHidden();
      await expect(cellAt('bed', rowIndex).getByLabel('Anbaufläche bearbeiten')).toBeFocused();

      await page.keyboard.press('Tab');
      await expect.poll(() => focusedField(page)).toBe('sowing_date');
      await page.keyboard.press('Shift+Tab');
      await expect(dialog).toBeHidden();
      await openFocusedAreaCellWithEnter(page, rowIndex);
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    }
  });

  test('tabs between closed hierarchy dropdowns inside the dialog', async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await createAreaDialogFixture(page, request, 'planting-plans-area-dialog-dropdown-tabs');

    await page.goto('/app/planting-plans');
    await expect(page.getByRole('heading', { name: 'Anbaupläne' })).toBeVisible();
    await page.locator('[role="gridcell"][data-field="bed"]').first().getByLabel('Anbaufläche bearbeiten').click();
    await expect(page.getByRole('dialog', { name: 'Anbaufläche ändern' })).toBeVisible();

    const locationSelect = page.getByRole('combobox', { name: 'Standort' });
    const fieldSelect = page.getByRole('combobox', { name: 'Parzelle' });
    const bedSelect = page.getByRole('combobox', { name: 'Beet' });

    await expect(locationSelect).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(fieldSelect).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(bedSelect).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(fieldSelect).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(locationSelect).toBeFocused();
  });

  test('tabs between hierarchy dropdowns when opened from an edited planting-plan row', async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await createAreaDialogFixture(page, request, 'planting-plans-area-dialog-row-edit-dropdown-tabs');

    await page.goto('/app/planting-plans');
    await expect(page.getByRole('heading', { name: 'Anbaupläne' })).toBeVisible();
    const firstRow = page.locator('[role="row"][data-id]').first();
    await firstRow.locator('[data-field="crop"]').dblclick();
    await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(1);

    await firstRow.locator('[data-field="cultivation_type"]').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('dialog', { name: 'Anbaufläche ändern' })).toBeHidden();
    await expect(firstRow.locator('[data-field="bed"]').getByLabel('Anbaufläche bearbeiten')).toBeFocused();

    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Anbaufläche ändern' });
    await expect(dialog).toBeVisible();

    const locationSelect = dialog.getByRole('combobox', { name: 'Standort' });
    const fieldSelect = dialog.getByRole('combobox', { name: 'Parzelle' });
    const bedSelect = dialog.getByRole('combobox', { name: 'Beet' });

    await expect(locationSelect).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(fieldSelect).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(bedSelect).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(fieldSelect).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(locationSelect).toBeFocused();
  });

  test('keeps the desktop field hierarchy editor compact without internal scrolling', async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await createAreaDialogFixture(page, request, 'planting-plans-area-dialog-compact');

    await openAreaAssignmentDialog(page, 'Anbaufläche ändern', 'Anbaufläche bearbeiten');
    const metrics = await readDialogMetrics(page, 'Anbaufläche ändern');

    expect(metrics.controlHeights).toHaveLength(3);
    for (const height of metrics.controlHeights) {
      expect(height).toBeLessThan(72);
    }
    for (const gap of metrics.gaps) {
      expect(gap).toBeLessThan(32);
    }
    expect(metrics.contentClientWidth).toBeLessThanOrEqual(460);
    expect(metrics.paperWidth).toBeLessThan(500);
    for (const width of metrics.controlWidths) {
      expect(width).toBeGreaterThanOrEqual(360);
      expect(width).toBeLessThanOrEqual(420);
      expect(width).toBeGreaterThan(metrics.contentWidth - 56);
    }
    expect(metrics.contentScrollHeight - metrics.contentClientHeight).toBeLessThanOrEqual(1);
  });

  test('keeps long hierarchy names compact and accessible in German and English', async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await createAreaDialogFixture(page, request, 'planting-plans-area-dialog-long-de', { longNames: true });

    await openAreaAssignmentDialog(page, 'Anbaufläche ändern', 'Anbaufläche bearbeiten');
    let metrics = await readDialogMetrics(page, 'Anbaufläche ändern');
    expect(metrics.paperWidth).toBeLessThan(500);
    expect(metrics.contentScrollWidth - metrics.contentClientWidth).toBeLessThanOrEqual(1);

    await page.getByRole('combobox', { name: 'Standort' }).click();
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible();
    await expect(listbox.getByRole('option', { name: 'Sonnenacker mit sehr langer Standortbezeichnung am Nordhang' })).toBeVisible();
    const menuMetrics = await listbox.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, viewportWidth: window.innerWidth };
    });
    expect(menuMetrics.left).toBeGreaterThanOrEqual(0);
    expect(menuMetrics.right).toBeLessThanOrEqual(menuMetrics.viewportWidth);

    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 920, height: 900 });
    metrics = await readDialogMetrics(page, 'Anbaufläche ändern');
    expect(metrics.paperWidth).toBeLessThan(500);
    expect(metrics.paperLeft).toBeGreaterThanOrEqual(16);
    expect(metrics.paperRight).toBeLessThanOrEqual(metrics.viewportWidth - 16);
    expect(metrics.contentScrollWidth - metrics.contentClientWidth).toBeLessThanOrEqual(1);

    await page.setViewportSize({ width: 375, height: 800 });
    metrics = await readDialogMetrics(page, 'Anbaufläche ändern');
    expect(metrics.paperWidth).toBeLessThanOrEqual(metrics.viewportWidth - 32);
    expect(metrics.paperWidth).toBeGreaterThan(280);
    expect(metrics.contentScrollWidth - metrics.contentClientWidth).toBeLessThanOrEqual(1);

    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 1400, height: 900 });
    await createAreaDialogFixture(page, request, 'planting-plans-area-dialog-long-en', {
      languageCode: 'en',
      longNames: true,
    });
    await openAreaAssignmentDialog(page, 'Change growing area', 'Edit growing area');
    metrics = await readDialogMetrics(page, 'Change growing area');
    expect(metrics.paperWidth).toBeLessThan(500);
    for (const width of metrics.controlWidths) {
      expect(width).toBeGreaterThanOrEqual(360);
      expect(width).toBeLessThanOrEqual(420);
    }

    await page.getByRole('combobox', { name: 'Location' }).click();
    await expect(page.getByRole('listbox').getByRole('option', {
      name: 'Sonnenacker mit sehr langer Standortbezeichnung am Nordhang',
    })).toBeVisible();
  });
});
