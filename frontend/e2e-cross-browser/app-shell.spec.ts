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

const DEMO_PROJECT = 'Solawi Sonnenacker';

test.describe('app shell', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await loginToDemoProject(page, testInfo);
  });

  test('logs in with the demo project and its current season selected', async ({ page }, testInfo) => {
    const banner = page.getByRole('banner');
    await expect(banner.getByRole('heading', { name: 'Übersicht', level: 1 })).toBeVisible();

    const seasonButton = banner.getByRole('button', { name: 'Aktive Saison wechseln' });
    await expect(seasonButton).toHaveText(/2026/);

    if (isMobileProject(testInfo)) {
      // Mobile moves the project switcher out of the topbar into the overflow menu.
      await banner.getByRole('button', { name: 'Mehr' }).click();
      await expect(page.getByRole('menu').getByRole('menuitem', { name: /Aktives Projekt wechseln/ })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menu')).toBeHidden();
    } else {
      await expect(banner.getByRole('button', { name: 'Aktives Projekt wechseln' })).toContainText(DEMO_PROJECT);
    }

    // Both demo seasons are selectable.
    await seasonButton.click();
    const seasonMenu = page.getByRole('menu');
    await expect(seasonMenu.getByRole('menuitem', { name: /2025/ })).toBeVisible();
    await expect(seasonMenu.getByRole('menuitem', { name: /2026/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(seasonMenu).toBeHidden();

    await expectNoHorizontalPageOverflow(page);
    await expectNoBrokenValues(page);
    // The fixed clock puts "today" on 15 May 2026: the first upcoming task is due that day.
    await expect(page.getByRole('main')).toContainText('15.5.2026');
  });

  test('main navigation is reachable and navigates', async ({ page }, testInfo) => {
    if (isMobileProject(testInfo)) {
      await page.getByRole('banner').getByRole('button', { name: 'Menü öffnen' }).click();
    }
    // The navigation is a list of links; the app also renders a separate
    // single "Anbaupläne" link outside it, which is not under test here.
    const navigationLink = page.getByRole('list').getByRole('link', { name: 'Anbaupläne', exact: true })
      .locator('visible=true');
    await expect(navigationLink).toBeVisible();
    // The mobile drawer slides in; measure once it has arrived.
    await expect.poll(async () => (await navigationLink.boundingBox())?.x ?? -1).toBeGreaterThanOrEqual(0);
    await expectWithinViewport(page, navigationLink, 'Anbaupläne navigation link');
    await navigationLink.click();
    await expect(page).toHaveURL(/\/app\/planting-plans/);
    await expect(page.getByRole('banner').getByRole('heading', { name: 'Anbaupläne', level: 1 })).toBeVisible();
    await expectNoHorizontalPageOverflow(page);
  });

  test('dialogs fit the viewport', async ({ page }, testInfo) => {
    await gotoAppPage(page, '/app/planting-plans', 'Anbaupläne');

    // Phones edit planting plans in a dialog; desktop edits inline in the grid
    // and opens a dialog for the bed assignment instead.
    const mobile = isMobileProject(testInfo);
    if (mobile) {
      await page.getByRole('button', { name: /^Anbauplan hinzufügen/ }).first().click();
    } else {
      await page.getByRole('button', { name: 'Anbaufläche bearbeiten' }).first().click();
    }
    const dialog = page.getByRole('dialog').first();
    await expect(dialog).toBeVisible();
    await page.waitForLoadState('networkidle');

    // MUI puts role="dialog" on the Paper, so the locator is the visible dialog box.
    await expectWithinViewport(page, dialog, 'dialog');
    const contentOverflow = await dialog.locator('.MuiDialogContent-root')
      .evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(contentOverflow, 'dialog content scrolls horizontally').toBeLessThanOrEqual(1);
    const actions = dialog.locator('.MuiDialogActions-root').getByRole('button');
    expect(await actions.count()).toBeGreaterThan(0);
    for (const action of await actions.all()) {
      await expectWithinViewport(page, action, `dialog action "${await action.innerText()}"`);
    }

    await page.mouse.move(0, 0);
    await expect(dialog).toHaveScreenshot(mobile ? 'planting-plan-create-dialog.png' : 'area-assignment-dialog.png', {
      mask: dynamicContentMasks(page),
    });
  });
});
