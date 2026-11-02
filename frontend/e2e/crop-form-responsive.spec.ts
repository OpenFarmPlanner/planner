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
