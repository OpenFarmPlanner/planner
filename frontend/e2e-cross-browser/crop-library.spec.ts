import {
  dynamicContentMasks,
  expect,
  expectNoBrokenValues,
  expectNoHorizontalPageOverflow,
  expectWithinViewport,
  gotoAppPage,
  isMobileProject,
  loginToDemoProject,
  test,
} from './fixtures';

// The project's own crop library ("Kulturen", /app/crops). The demo project
// has eight crop species; Tomate carries three varieties.
const DEMO_SPECIES = ['Gurke', 'Karotte', 'Kohlrabi', 'Mangold', 'Rote Rübe', 'Salat', 'Tomate', 'Zucchini'];

test.describe('Kulturen library', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await loginToDemoProject(page, testInfo);
    await gotoAppPage(page, '/app/crops', 'Kulturen');
  });

  test('lists the crops and opens and closes a crop dialog', async ({ page }, testInfo) => {
    const header = page.getByTestId('crop-detail-header');

    if (isMobileProject(testInfo)) {
      // Phones pick the crop from a full-list dialog instead of a sidebar list.
      await page.getByRole('button', { name: 'Kultur auswählen' }).click();
      const selector = page.getByRole('dialog');
      await expect(selector).toBeVisible();
      await expectWithinViewport(page, selector, 'crop selector dialog');
      for (const species of DEMO_SPECIES) {
        await expect(selector.getByText(species, { exact: true }).first()).toBeAttached();
      }
      await selector.getByText('Tomate', { exact: true }).first().click();
      await expect(selector).toBeHidden();
    } else {
      const list = page.getByRole('listbox', { name: 'Kulturen' });
      await expect(list.getByRole('option')).toHaveCount(DEMO_SPECIES.length);
      for (const species of DEMO_SPECIES) {
        await expect(list.getByRole('option', { name: species, exact: true })).toBeVisible();
      }
      await list.getByRole('option', { name: 'Tomate' }).click();
    }
    await expect(header).toContainText('Tomate');

    // The crop's detail dialog: open it from the header, close it again.
    await header.getByRole('button', { name: 'Bearbeiten' }).click();
    const dialog = page.getByRole('dialog').filter({ has: page.locator('#crop-form-dialog-title') });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
    await expect(dialog).toBeHidden();

    await expectNoHorizontalPageOverflow(page);
    await expectNoBrokenValues(page);
  });

  test('matches the per-browser screenshot', async ({ page }) => {
    await page.mouse.move(0, 0);
    await expect(page).toHaveScreenshot('crop-library.png', { mask: dynamicContentMasks(page) });
  });
});

test('public Kulturbibliothek renders without overflow', async ({ page }, testInfo) => {
  await loginToDemoProject(page, testInfo);
  await gotoAppPage(page, '/app/crop-library', 'Kulturbibliothek');
  await expect(page.getByRole('main')).toBeVisible();
  await expectNoHorizontalPageOverflow(page);
  await expectNoBrokenValues(page);
});
