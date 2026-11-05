import { expect, test, type Locator, type Page } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject, waitForPageStable } from './utils';

async function openCreateCropDialog(page: Page): Promise<Locator> {
  await page.goto('/app/crops');
  await waitForPageStable(page, /Kulturbibliothek/i);
  await page.getByRole('button', { name: 'Kultur hinzufügen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Kultur hinzufügen' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function inputBox(input: Locator) {
  const box = await input.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

/** The outlined field around an input: inputs of Autocomplete and TextField sit at different paddings. */
async function fieldBox(input: Locator) {
  return inputBox(input.locator('xpath=ancestor::div[contains(@class, "MuiInputBase-root")][1]'));
}

test.describe('crop create dialog responsive identity row', () => {
  test.beforeEach(async ({ page, request }, testInfo) => {
    await loginWithDeterministicProject(page, request, `crop-form-responsive-${testInfo.workerIndex}`);
  });

  test('stacks name and variety at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    const dialog = await openCreateCropDialog(page);

    const nameBox = await inputBox(dialog.getByLabel(/^Name/));
    const varietyBox = await inputBox(dialog.getByLabel('Sorte (optional)'));
    const checkbox = dialog.getByRole('checkbox', { name: 'Werte auch als allgemeine Kulturwerte übernehmen' });

    expect(varietyBox.y).toBeGreaterThan(nameBox.y + nameBox.height);
    await expect(checkbox).toBeDisabled();
  });

  test('places name, variety and Latin name in one row of the three-column grid on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    const dialog = await openCreateCropDialog(page);

    const nameBox = await fieldBox(dialog.getByLabel(/^Name/));
    const varietyBox = await fieldBox(dialog.getByLabel('Sorte (optional)'));
    const botanicalBox = await fieldBox(dialog.getByLabel('Lateinischer Name'));
    const tagsBox = await fieldBox(dialog.getByRole('combobox', { name: 'Tags' }));
    const checkbox = dialog.getByRole('checkbox', { name: 'Werte auch als allgemeine Kulturwerte übernehmen' });

    expect(Math.abs(nameBox.y - varietyBox.y)).toBeLessThan(4);
    expect(Math.abs(nameBox.y - botanicalBox.y)).toBeLessThan(4);
    expect(Math.abs(nameBox.width - varietyBox.width)).toBeLessThan(4);
    expect(tagsBox.y).toBeGreaterThan(nameBox.y + nameBox.height);
    await expect(checkbox).toBeDisabled();

    await dialog.getByLabel('Sorte (optional)').fill('Nantaise');
    await expect(checkbox).toBeEnabled();
  });
});

async function openEditCropDialog(page: Page): Promise<Locator> {
  const projectId = Number(await page.evaluate(() => window.localStorage.getItem('activeProjectId')));
  const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    project: projectId,
    name: 'Kompaktsalat',
    botanical_name: 'Lactuca sativa',
    cultivation_types: ['pre_cultivation', 'direct_sowing'],
  });
  await page.goto(`/app/crops?cropId=${crop.id}&action=edit`);
  const dialog = page.getByRole('dialog', { name: 'Kultur bearbeiten' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function expectOneRow(boxes: Array<{ y: number }>) {
  for (const box of boxes.slice(1)) {
    expect(Math.abs(box.y - boxes[0].y)).toBeLessThan(4);
  }
}

test.describe('crop edit dialog compact layout', () => {
  test.beforeEach(async ({ page, request }, testInfo) => {
    await loginWithDeterministicProject(page, request, `crop-form-compact-${testInfo.workerIndex}`);
  });

  test('opens full screen with one column at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    const dialog = await openEditCropDialog(page);

    const paperBox = await inputBox(dialog);
    expect(paperBox.width).toBeGreaterThanOrEqual(374);
    expect(paperBox.height).toBeGreaterThanOrEqual(799);

    const nameBox = await inputBox(dialog.getByLabel(/^Name/));
    const botanicalBox = await inputBox(dialog.getByLabel('Lateinischer Name'));
    expect(botanicalBox.y).toBeGreaterThan(nameBox.y + nameBox.height);
    await expect(dialog.getByRole('button', { name: /Speichern/ })).toBeInViewport();
  });

  test('lays out name with Latin name and full rows of three fields on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const dialog = await openEditCropDialog(page);

    // md width and a fixed height of the viewport minus the dialog margins.
    const paperBox = await inputBox(dialog);
    expect(paperBox.width).toBeLessThanOrEqual(900);
    expect(Math.abs(paperBox.height - (900 - 64))).toBeLessThan(2);

    const nameBox = await fieldBox(dialog.getByLabel(/^Name/));
    const botanicalBox = await fieldBox(dialog.getByLabel('Lateinischer Name'));
    const tagsBox = await fieldBox(dialog.getByRole('combobox', { name: 'Tags' }));
    await expectOneRow([nameBox, botanicalBox]);
    expect(nameBox.width).toBeGreaterThan(botanicalBox.width);
    expect(tagsBox.y).toBeGreaterThan(nameBox.y + nameBox.height);
    expect(tagsBox.width).toBeGreaterThan(nameBox.width + botanicalBox.width);
    // Compact fields: the small MUI field height.
    expect(nameBox.height).toBeLessThan(48);

    await expectOneRow([
      await fieldBox(dialog.getByRole('combobox', { name: 'Anbauart' })),
      await fieldBox(dialog.getByLabel('Wachstumszeit (Tage)')),
      await fieldBox(dialog.getByLabel('Anzuchtdauer (Tage)')),
    ]);
    await expectOneRow([
      await fieldBox(dialog.getByLabel('Erntezeit (Tage)')),
      // The yield unit select has no labelled combobox: find it by its label.
      await inputBox(dialog.locator('.MuiFormControl-root')
        .filter({ has: page.locator('label', { hasText: /^Ertragseinheit$/ }) })
        .locator('.MuiInputBase-root')),
      await fieldBox(dialog.getByLabel(/^Erwarteter Ertrag/)),
    ]);
  });
});

/**
 * The "Zeiträume" section: a row of unit switch, "Von"/"Bis" selects and the
 * remove button must fit the full-screen phone dialog (wrapping "Bis" below
 * "Von") and stay on one line on desktop. Functional layout assertions, no
 * screenshot baseline: the rows are dynamic and the risk is overflow.
 */
test.describe('crop form timing windows section', () => {
  test.beforeEach(async ({ page, request }, testInfo) => {
    await loginWithDeterministicProject(page, request, `crop-form-windows-${testInfo.workerIndex}`);
  });

  async function addDirectSowingRow(dialog: Locator): Promise<Locator> {
    const group = dialog.getByRole('group', { name: 'Direktsaat' });
    const addButton = group.getByRole('button', { name: 'Zeitraum hinzufügen' });
    await addButton.scrollIntoViewIfNeeded();
    await addButton.click();
    await group.getByLabel('Von: Monatsdrittel').selectOption({ label: 'Mitte' });
    await group.getByLabel('Von: Monat', { exact: true }).selectOption({ label: 'November' });
    await group.getByLabel('Bis: Monatsdrittel').selectOption({ label: 'Ende' });
    await group.getByLabel('Bis: Monat', { exact: true }).selectOption({ label: 'Februar' });
    await expect(group.getByText('Über den Jahreswechsel')).toBeVisible();
    return group;
  }

  test('wraps "Bis" below "Von" and keeps the row inside the dialog at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    const dialog = await openEditCropDialog(page);
    const group = await addDirectSowingRow(dialog);

    const dialogBox = await inputBox(dialog);
    const fromBox = await inputBox(group.getByLabel('Von: Monat', { exact: true }));
    const toBox = await inputBox(group.getByLabel('Bis: Monat', { exact: true }));
    const removeBox = await inputBox(group.getByRole('button', { name: 'Zeitraum entfernen' }));
    expect(toBox.y).toBeGreaterThan(fromBox.y + fromBox.height - 1);
    for (const box of [fromBox, toBox, removeBox]) {
      expect(box.x).toBeGreaterThanOrEqual(dialogBox.x);
      expect(box.x + box.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width);
    }
    await page.screenshot({ path: test.info().outputPath('timing-windows-375.png'), fullPage: false });
  });

  test('keeps switch, "Von", "Bis" and remove button on one line at 1440px', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const dialog = await openEditCropDialog(page);
    const group = await addDirectSowingRow(dialog);

    // Compare vertical centres: the switch is shorter than the selects.
    const centre = (box: { y: number; height: number }) => ({ y: box.y + box.height / 2 });
    await expectOneRow([
      centre(await inputBox(group.getByRole('button', { name: 'Monat', exact: true }))),
      centre(await inputBox(group.getByLabel('Von: Monat', { exact: true }))),
      centre(await inputBox(group.getByLabel('Bis: Monat', { exact: true }))),
      centre(await inputBox(group.getByRole('button', { name: 'Zeitraum entfernen' }))),
    ]);
    await page.screenshot({ path: test.info().outputPath('timing-windows-1440.png'), fullPage: false });
  });
});

test('supplier seed statuses persist and fit the existing responsive editor', async ({ page, request }, testInfo) => {
  await loginWithDeterministicProject(page, request, `supplier-status-${testInfo.workerIndex}`, { loginAsAdmin: true });
  const supplier = await apiRequest<{ id: number }>(page, 'POST', '/suppliers/', {
    name: 'Status supplier', homepage_url: 'https://seeds.example',
  });
  const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: 'Status carrot', notes: 'Keep crop notes', supplier_data_input: [{ supplier_id: supplier.id, packaging_sizes: [{ size_value: 25, size_unit: 'g' }], supplier_product_name: 'Old article' }],
  });
  await page.goto(`/app/crops?cropId=${crop.id}&action=edit`);
  const cropDialog = page.getByRole('dialog', { name: 'Kultur bearbeiten' });
  await expect(cropDialog.getByTestId('crop-supplier-data-section')).toHaveCount(0);
  await cropDialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await page.getByRole('button', { name: 'Lieferantendaten bearbeiten' }).click();
  const dialog = page.getByRole('dialog', { name: 'Kulturspezifische Lieferantendaten' });
  const seedStatus = dialog.getByRole('combobox', { name: 'Saatgutstatus', exact: true });
  await expect(seedStatus).toHaveText('Unbekannt');
  await seedStatus.click();
  await page.getByRole('option', { name: 'Konventionell', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Ausnahmegenehmigung', exact: true }).click();
  await page.getByRole('option', { name: 'Genehmigung vorhanden', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Artikelbezeichnung beim Lieferanten' }).fill('Updated article');
  const write = page.waitForResponse((response) => response.url().includes(`/api/crops/${crop.id}/`) && response.request().method() === 'PATCH');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  const response = await write;
  expect(Object.keys(response.request().postDataJSON())).toEqual(['supplier_data_input']);
  await expect(dialog).not.toBeVisible();
  const saved = await apiRequest<{ supplier_data: Array<{ seed_status: string; seed_exemption_status: string }> }>(page, 'GET', `/crops/${crop.id}/`);
  expect(saved.supplier_data[0]).toMatchObject({ seed_status: 'conventional', seed_exemption_status: 'approved' });
  await page.getByRole('button', { name: 'Lieferantendaten bearbeiten' }).click();
  await expect(seedStatus).toHaveText('Konventionell');
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await seedStatus.scrollIntoViewIfNeeded();
    const row = dialog.getByTestId('crop-supplier-data-row');
    const overflow = await row.evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(dialog.getByRole('button', { name: 'Speichern', exact: true })).toBeInViewport();
    // Review artifacts only; dynamic form contents are asserted functionally.
    await page.screenshot({ path: testInfo.outputPath(`supplier-status-${width}.png`) });
  }
  await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: 'fr' });
  await page.goto(`/app/crops?cropId=${crop.id}`);
  await page.getByRole('button', { name: 'Modifier les données fournisseur' }).click();
  await page.setViewportSize({ width: 375, height: 800 });
  const frenchStatus = page.getByRole('combobox', { name: 'Statut des semences', exact: true });
  await frenchStatus.scrollIntoViewIfNeeded();
  await expect(frenchStatus).toHaveText('Conventionnel');
  const frenchRow = page.getByTestId('crop-supplier-data-row');
  expect(await frenchRow.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('supplier-status-fr-375.png') });
});

test('supplier editor retains failed drafts and explicitly clears all supplier rows', async ({ page, request }, testInfo) => {
  await loginWithDeterministicProject(page, request, `supplier-independent-${testInfo.workerIndex}`, { loginAsAdmin: true });
  const supplier = await apiRequest<{ id: number }>(page, 'POST', '/suppliers/', { name: 'Draft supplier' });
  const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: 'Keep identity', notes: 'Keep notes',
    supplier_data_input: [{ supplier_id: supplier.id, supplier_product_name: 'Old' }],
  });
  await page.goto(`/app/crops?cropId=${crop.id}`);
  await page.getByRole('button', { name: 'Lieferantendaten bearbeiten' }).click();
  const dialog = page.getByRole('dialog', { name: 'Kulturspezifische Lieferantendaten' });
  const product = dialog.getByRole('textbox', { name: 'Artikelbezeichnung beim Lieferanten' });
  await product.fill('Retained draft');
  await page.route(`**/api/crops/${crop.id}/`, (route) => route.fulfill({ status: 500, body: 'Unavailable' }), { times: 1 });
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(product).toHaveValue('Retained draft');
  await dialog.getByRole('button', { name: 'Lieferantendaten entfernen', exact: true }).click();
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const saved = await apiRequest<{ name: string; notes: string; supplier_data: unknown[] }>(page, 'GET', `/crops/${crop.id}/`);
  expect(saved).toMatchObject({ name: 'Keep identity', notes: 'Keep notes', supplier_data: [] });
});
