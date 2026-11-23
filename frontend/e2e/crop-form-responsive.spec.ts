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

async function selectSupplierOfferAction(page: Page, supplierName: string, actionLabel: string) {
  const offer = page.getByRole('listitem').filter({ has: page.getByText(supplierName, { exact: true }) });
  await offer.getByRole('button').click();
  await page.getByRole('menuitem', { name: actionLabel, exact: true }).click();
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
    growth_duration_days: 60,
    propagation_duration_days: 28,
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

test('edits and reloads the perennial harvest window by keyboard on a phone', async ({ page, request }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await loginWithDeterministicProject(page, request, 'perennial-crop-annual-harvest', { loginAsAdmin: true });
  const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: 'Testapfel', life_cycle: 'perennial', standing_time_years: 20,
    growth_duration_days: 760, harvest_duration_days: 44,
  });
  const detailUrl = `/app/crops?cropId=${crop.id}`;
  const sections = page.getByTestId('crop-detail-sections');
  await page.goto(detailUrl);
  await expect(sections.getByText('Wachstumszeit (Tage)', { exact: true })).toBeVisible();
  await expect(sections.getByText('Erntezeit (Tage)', { exact: true })).toBeVisible();
  await page.goto(`${detailUrl}&action=edit`);
  const dialog = page.getByRole('dialog', { name: 'Kultur bearbeiten' });
  const start = dialog.getByRole('textbox', { name: 'Jährlicher Erntebeginn', exact: true });
  const end = dialog.getByRole('textbox', { name: 'Jährliches Ernteende', exact: true });
  const delay = dialog.getByRole('spinbutton', { name: 'Jahre bis zur ersten Ernte', exact: true });
  await expect(dialog.getByLabel('Wachstumszeit (Tage)', { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel('Erntezeit (Tage)', { exact: true })).toHaveCount(0);
  await start.focus();
  await page.keyboard.type('12-15');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(end).toBeFocused();
  await page.keyboard.type('02-30');
  await expect(dialog.getByText('Gib für Beginn und Ende ein gültiges Datum im Format MM-TT ein.')).toBeVisible();
  await end.fill('02-29');
  await page.keyboard.press('Tab');
  await expect(delay).toBeFocused();
  await page.keyboard.type('-1');
  await expect(dialog.getByText('Gib eine ganze Zahl ab 0 ein.')).toBeVisible();
  await delay.clear();
  await page.keyboard.type('2');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).toBeHidden();

  const saved = await apiRequest(page, 'GET', `/crops/${crop.id}/`);
  expect(saved).toMatchObject({ annual_harvest_window: '12-15/02-29', first_harvest_delay_years: 2 });
  await page.goto(detailUrl);
  await expect(sections.getByText('Jährliches Erntefenster', { exact: true })).toBeVisible();
  await expect(sections.getByText('Wachstumszeit (Tage)', { exact: true })).toHaveCount(0);
  await page.goto(`${detailUrl}&action=edit`);
  await expect(start).toHaveValue('12-15');
  await expect(end).toHaveValue('02-29');
  await expect(delay).toHaveValue('2');

  await start.fill('12-01');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await apiRequest(page, 'GET', `/crops/${crop.id}/`)).toMatchObject({
    annual_harvest_window: '12-01/02-29', first_harvest_delay_years: 2,
  });
});

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
    const harvest = await fieldBox(dialog.getByLabel('Erntezeit (Tage)', { exact: true }));
    const propagation = await fieldBox(dialog.getByLabel('Anzuchtdauer (Tage)', { exact: true }));
    expect(propagation.y).toBeGreaterThan(harvest.y + harvest.height);
    expect(propagation.width).toBeCloseTo(harvest.width, 0);
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
    // Tags span the same two columns as the name above them.
    expect(Math.abs(tagsBox.x - nameBox.x)).toBeLessThan(2);
    expect(Math.abs(tagsBox.width - nameBox.width)).toBeLessThan(2);
    // Compact fields: the small MUI field height.
    expect(nameBox.height).toBeLessThan(48);

    // The three durations share one row beneath cultivation type.
    const cultivationBox = await fieldBox(dialog.getByRole('combobox', { name: 'Anbauart' }));
    const durationBoxes = [
      await fieldBox(dialog.getByLabel('Wachstumszeit (Tage)', { exact: true })),
      await fieldBox(dialog.getByLabel('Erntezeit (Tage)', { exact: true })),
      await fieldBox(dialog.getByLabel('Anzuchtdauer (Tage)', { exact: true })),
    ];
    await expectOneRow(durationBoxes);
    expect(durationBoxes[0].y).toBeGreaterThan(cultivationBox.y + cultivationBox.height);
    expect(durationBoxes[0].x).toBeLessThan(durationBoxes[1].x);
    expect(durationBoxes[1].x).toBeLessThan(durationBoxes[2].x);
    await expectOneRow([
      // The yield unit select has no labelled combobox: find it by its label.
      await inputBox(dialog.locator('.MuiFormControl-root')
        .filter({ has: page.locator('label', { hasText: /^Ertragseinheit$/ }) })
        .locator('.MuiInputBase-root')),
      await fieldBox(dialog.getByLabel(/^Erwarteter Ertrag/)),
    ]);
    await expect(dialog.getByRole('heading', { name: 'Ertrag', exact: true })).toBeVisible();
  });
});

test('keeps every variety form row on the shared three-column grid', async ({ page, request }, testInfo) => {
  await loginWithDeterministicProject(page, request, `crop-form-grid-${testInfo.workerIndex}`);
  const projectId = Number(await page.evaluate(() => window.localStorage.getItem('activeProjectId')));
  const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    project: projectId,
    name: 'Rasterkarotte',
    variety: 'Nantaise',
    cultivation_types: ['direct_sowing'],
    propagation_duration_days: 28,
  });
  await page.goto(`/app/crops?cropId=${crop.id}&action=edit`);
  const dialog = page.getByRole('dialog', { name: 'Sorte bearbeiten' });
  await expect(dialog).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });

  const nameBox = await fieldBox(dialog.getByLabel(/^Name/));
  const varietyBox = await fieldBox(dialog.getByLabel(/^Sorte/));
  const botanicalBox = await fieldBox(dialog.getByLabel('Lateinischer Name'));
  const seedTypeBox = await fieldBox(dialog.getByRole('combobox', { name: 'Saatguttyp' }));
  const tagsBox = await fieldBox(dialog.getByRole('combobox', { name: 'Tags' }));
  await expectOneRow([seedTypeBox, tagsBox]);
  expect(Math.abs(seedTypeBox.x - nameBox.x)).toBeLessThan(2);
  expect(Math.abs(seedTypeBox.width - nameBox.width)).toBeLessThan(2);
  expect(Math.abs(tagsBox.x - varietyBox.x)).toBeLessThan(2);
  expect(Math.abs(tagsBox.x + tagsBox.width - (botanicalBox.x + botanicalBox.width))).toBeLessThan(2);

  // Rows with fewer than three fields keep the column width.
  const spacingBox = await fieldBox(dialog.getByLabel('Abstand in der Reihe (cm)'));
  const kernelWeightBox = await fieldBox(dialog.getByLabel(/^1000-Korn-Gewicht/));
  for (const box of [spacingBox, kernelWeightBox]) {
    expect(Math.abs(box.x - nameBox.x)).toBeLessThan(2);
    expect(Math.abs(box.width - nameBox.width)).toBeLessThan(2);
  }

  // The sowing depth range is one field in the third column, on the line of
  // the spacing fields and as high as they are; both inputs share its outline.
  const rowSpacingBox = await fieldBox(dialog.getByLabel('Reihenabstand (cm)'));
  const depthBox = await fieldBox(dialog.getByLabel('Saattiefe von (cm)'));
  expect(await fieldBox(dialog.getByLabel('Saattiefe bis (cm)'))).toEqual(depthBox);
  await expect(dialog.getByRole('group', { name: 'Saattiefe (cm)' })).toBeVisible();
  await expectOneRow([spacingBox, rowSpacingBox, depthBox]);
  expect(Math.abs(depthBox.height - rowSpacingBox.height)).toBeLessThan(1);
  expect(Math.abs(depthBox.x - botanicalBox.x)).toBeLessThan(2);
  expect(Math.abs(depthBox.x + depthBox.width - (botanicalBox.x + botanicalBox.width))).toBeLessThan(2);

  // The minimum temperature sits on the same line as the two range fields.
  await expectOneRow([
    await fieldBox(dialog.getByLabel('Optimale Keimtemperatur von (°C)')),
    await fieldBox(dialog.getByLabel('Keimdauer von (Tage)')),
    await fieldBox(dialog.getByLabel('Mindestkeimtemperatur (°C)')),
  ]);

  // Review artifacts only; the layout itself is asserted above.
  const propagation = dialog.getByLabel('Anzuchtdauer (Tage)', { exact: true });
  const germination = dialog.getByRole('heading', { name: 'Keimung' });
  for (const viewport of [
    { width: 375, height: 800 }, { width: 800, height: 375 }, { width: 768, height: 900 },
    { width: 1024, height: 900 }, { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await dialog.getByLabel(/^Name/).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`crop-form-top-${viewport.width}.png`) });
    await propagation.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`crop-form-timing-${viewport.width}.png`) });
    await germination.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`crop-form-germination-${viewport.width}.png`) });
    await dialog.getByLabel('Saattiefe von (cm)').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`crop-form-spacing-${viewport.width}.png`) });
  }
});

/**
 * The "Zeiträume" categories share the form width while each row keeps its
 * controls inside its own category. Empty categories keep their add action.
 */
test.describe('crop form timing windows section', () => {
  test.beforeEach(async ({ page, request }, testInfo) => {
    await loginWithDeterministicProject(page, request, `crop-form-windows-${testInfo.workerIndex}`);
  });

  async function addDirectSowingRow(dialog: Locator): Promise<Locator> {
    const group = dialog.getByRole('group', { name: 'Direktsaatzeitraum' });
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

  test('keeps three category columns as a row is added and wraps the categories on a tablet', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const dialog = await openEditCropDialog(page);
    const categories = ['Anzuchtzeitraum', 'Direktsaatzeitraum', 'Pflanzzeitraum'].map((name) => (
      dialog.getByRole('group', { name, exact: true })
    ));
    const empty = await Promise.all(categories.map(inputBox));
    await expectOneRow(empty);
    expect(empty[1].x).toBeGreaterThanOrEqual(empty[0].x + empty[0].width);
    expect(empty[2].x).toBeGreaterThanOrEqual(empty[1].x + empty[1].width);

    const group = await addDirectSowingRow(dialog);
    const populated = await Promise.all(categories.map(inputBox));
    await expectOneRow(populated);
    expect(populated.map(({ x, width }) => ({ x, width })))
      .toEqual(empty.map(({ x, width }) => ({ x, width })));
    const sowing = populated[1];
    for (const control of await group.getByTestId('timing-window-row').locator('button, select').all()) {
      const box = await inputBox(control);
      expect(box.x).toBeGreaterThanOrEqual(sowing.x);
      expect(box.x + box.width).toBeLessThanOrEqual(sowing.x + sowing.width + 1);
    }
    await page.screenshot({ path: test.info().outputPath('timing-windows-1440.png'), fullPage: false });

    await page.setViewportSize({ width: 768, height: 900 });
    const tablet = await Promise.all(categories.map(inputBox));
    await expectOneRow(tablet.slice(0, 2));
    expect(tablet[2].y).toBeGreaterThanOrEqual(tablet[1].y + tablet[1].height);
    await expect(group.getByLabel('Von: Monat', { exact: true })).toHaveValue('11');
  });
});

test('supplier seed statuses persist and fit the existing responsive editor', async ({ page, request }, testInfo) => {
  await loginWithDeterministicProject(page, request, `supplier-status-${testInfo.workerIndex}`, { loginAsAdmin: true });
  const supplier = await apiRequest<{ id: number }>(page, 'POST', '/suppliers/', {
    name: 'Status supplier', homepage_url: 'https://seeds.example',
  });
  const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: 'Status carrot', notes: 'Keep crop notes', supplier_data_input: [{
      supplier_id: supplier.id, supplier_product_name: 'Old article', price: 3.5,
      packaging_sizes: [{ size_value: 25, size_unit: 'g' }, { size_value: 100, size_unit: 'g' }],
    }],
  });
  await page.goto('/app/project-settings');
  const general = page.getByRole('region', { name: 'Allgemein' });
  const projectCurrency = general.getByRole('combobox', { name: 'Standardwährung für Angebote' });
  await expect(projectCurrency).toHaveValue('Nach Projektregion (EUR)');
  await projectCurrency.fill('CHF');
  await page.getByRole('option', { name: /^CHF/ }).click();
  const saveProject = page.waitForResponse((response) =>
    /\/api\/projects\/\d+\/$/.test(new URL(response.url()).pathname) && response.request().method() === 'PATCH');
  await general.getByRole('button', { name: 'Speichern', exact: true }).click();
  expect((await saveProject).ok()).toBe(true);

  await page.goto(`/app/crops?cropId=${crop.id}&action=edit`);
  const cropDialog = page.getByRole('dialog', { name: 'Kultur bearbeiten' });
  await expect(cropDialog.getByTestId('crop-supplier-data-section')).toHaveCount(0);
  await cropDialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(cropDialog).not.toBeVisible();
  await expect(page.locator('#root')).not.toHaveAttribute('aria-hidden', 'true');
  await selectSupplierOfferAction(page, 'Status supplier', 'Lieferantendaten bearbeiten: Status supplier');
  const dialog = page.getByRole('dialog', { name: 'Kulturspezifische Lieferantendaten' });
  const seedStatus = dialog.getByRole('combobox', { name: 'Saatgutstatus', exact: true });
  const exemptionHelp = dialog.getByRole('button', { name: 'Hilfe zur Saatgut-Ausnahme' });
  const currency = dialog.getByRole('combobox', { name: 'Währung des Angebots' });
  await expect(currency).toHaveValue(/^CHF/);
  await currency.fill('GBP');
  await page.getByRole('option', { name: /^GBP/ }).click();
  const packagePrices = dialog.getByRole('textbox', { name: 'Packungspreis', exact: true });
  await packagePrices.nth(0).fill('0');
  await packagePrices.nth(1).fill('12,75');
  await dialog.getByRole('textbox', { name: 'Produktlink' }).fill('https://seeds.example/carrot');
  await dialog.getByRole('textbox', { name: 'Quellenlink' }).fill('https://seeds.example/catalogue');
  await dialog.getByRole('textbox', { name: 'Notizen', exact: true }).fill('Catalogue price');
  await dialog.getByRole('textbox', { name: 'Keimrate (%)', exact: true }).fill('85');
  await exemptionHelp.press('Enter');
  await expect(page.getByRole('tooltip')).toContainText('Unbekannt bedeutet');
  await exemptionHelp.press('Escape');
  await expect(page.getByRole('tooltip')).toBeHidden();
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
  const saved = await apiRequest<{ supplier_data: Array<Record<string, unknown>> }>(page, 'GET', `/crops/${crop.id}/`);
  expect(saved.supplier_data[0]).toMatchObject({
    seed_status: 'conventional', seed_exemption_status: 'approved', package_currency: 'GBP',
    notes: 'Catalogue price', supplier_product_url: 'https://seeds.example/carrot', germination_rate: 85,
    source_url: 'https://seeds.example/catalogue', price: '3.50',
    packaging_sizes: [
      { size_value: 25, size_unit: 'g', price: '0.0000' },
      { size_value: 100, size_unit: 'g', price: '12.7500' },
    ],
  });
  await page.reload();
  const supplierRegion = page.getByRole('region', { name: 'Lieferantendaten', exact: true });
  await expect(supplierRegion.getByText(/12,75.*GBP|GBP.*12,75/)).toBeVisible();
  await expect(supplierRegion.getByRole('link', { name: 'Quelle', exact: true })).toHaveAttribute('href', 'https://seeds.example/catalogue');
  await selectSupplierOfferAction(page, 'Status supplier', 'Lieferantendaten bearbeiten: Status supplier');
  await expect(seedStatus).toHaveText('Konventionell');
  await expect(currency).toHaveValue(/^GBP/);
  await expect(packagePrices.nth(0)).toHaveValue(/^0([.,]0+)?$/);
  for (const [width, height] of [[375, 800], [800, 375], [768, 900], [1024, 900], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await packagePrices.nth(1).scrollIntoViewIfNeeded();
    const row = dialog.getByTestId('crop-supplier-data-row');
    const overflow = await row.evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(dialog.getByRole('button', { name: 'Speichern', exact: true })).toBeInViewport();
    // Review artifacts only; dynamic form contents are asserted functionally.
    await page.screenshot({ path: testInfo.outputPath(`supplier-status-${width}.png`) });
  }
  await packagePrices.nth(1).fill('');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const cleared = await apiRequest<{ supplier_data: Array<Record<string, unknown>> }>(page, 'GET', `/crops/${crop.id}/`);
  expect(cleared.supplier_data[0]).toMatchObject({
    package_currency: 'GBP',
    packaging_sizes: [{ price: '0.0000' }, { price: null }],
  });
  await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: 'fr' });
  await page.goto(`/app/crops?cropId=${crop.id}`);
  await selectSupplierOfferAction(page, 'Status supplier', 'Modifier les données fournisseur : Status supplier');
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
  await selectSupplierOfferAction(page, 'Draft supplier', 'Lieferantendaten bearbeiten: Draft supplier');
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

test('supplier section adds, edits and deletes one offer without changing other crop data', async ({ page, request }, testInfo) => {
  await loginWithDeterministicProject(page, request, `supplier-section-${testInfo.workerIndex}`);
  const suppliers: { id: number; name: string }[] = [];
  for (const name of ['Offer A', 'Offer B', 'Offer C']) {
    suppliers.push(await apiRequest(page, 'POST', '/suppliers/', { name }));
  }
  const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: 'Independent offers', notes: 'Keep these crop notes',
    supplier_data_input: [
      { supplier_id: suppliers[0].id, supplier_product_name: 'Original A', packaging_sizes: [{ size_value: 25, size_unit: 'g' }] },
      { supplier_id: suppliers[1].id, supplier_product_name: 'Original B', packaging_sizes: [{ size_value: 100, size_unit: 'seeds' }] },
    ],
  });
  await page.goto(`/app/crops?cropId=${crop.id}`);
  const section = page.getByRole('region', { name: 'Lieferantendaten', exact: true });
  const add = section.getByRole('button', { name: 'Lieferanteninformation hinzufügen' });
  await add.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Kulturspezifische Lieferantendaten' });
  await dialog.getByRole('combobox', { name: 'Saatgutlieferant', exact: true }).click();
  await page.getByRole('option', { name: 'Offer C', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Artikelbezeichnung beim Lieferanten' }).fill('New C');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(section.getByText('New C', { exact: true })).toBeVisible();

  await selectSupplierOfferAction(page, 'Offer B', 'Lieferantendaten bearbeiten: Offer B');
  await expect(dialog.getByTestId('crop-supplier-data-row')).toHaveCount(1);
  await dialog.getByRole('textbox', { name: 'Artikelbezeichnung beim Lieferanten' }).fill('Updated B');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await selectSupplierOfferAction(page, 'Offer C', 'Lieferantendaten löschen: Offer C');
  const confirm = page.getByRole('dialog', { name: 'Lieferantendaten löschen', exact: true });
  await confirm.getByRole('button', { name: 'Löschen', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(confirm).not.toBeVisible();
  await page.reload();
  await expect(section.getByText('Updated B', { exact: true })).toBeVisible();
  await expect(section.getByText('New C', { exact: true })).toHaveCount(0);
  const saved = await apiRequest<{ notes: string; supplier_data: { supplier: { id: number }; packaging_sizes: unknown[] }[] }>(page, 'GET', `/crops/${crop.id}/`);
  expect(saved.notes).toBe('Keep these crop notes');
  expect(saved.supplier_data).toHaveLength(2);
  expect(saved.supplier_data.find((row) => row.supplier.id === suppliers[0].id)?.packaging_sizes).toEqual([{ size_value: 25, size_unit: 'g' }]);
  expect(saved.supplier_data.find((row) => row.supplier.id === suppliers[1].id)?.packaging_sizes).toEqual([{ size_value: 100, size_unit: 'seeds' }]);
  for (const viewport of [{ width: 375, height: 800 }, { width: 800, height: 375 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    expect(await section.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  }
});
