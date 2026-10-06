import { expect, test } from '@playwright/test';
import { loginWithDeterministicProject } from './utils';

test('mobile planting plan dialog shows a planting-date picker button', async ({ page, request }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await loginWithDeterministicProject(page, request, 'planting-plans-mobile-date-picker', {
    demoProject: true,
    loginAsAdmin: true,
  });
  await page.goto('/app/planting-plans');
  await expect(page.getByRole('heading', { name: 'Anbaupläne' })).toBeVisible();

  await page.getByRole('button', { name: /^Anbauplan hinzufügen/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Anbauplan hinzufügen' });
  await expect(dialog).toBeVisible();

  const dateField = dialog.getByRole('textbox', { name: 'Pflanztermin' });
  // The dialog now also has an Aussaattermin field with its own calendar
  // button right before Pflanztermin's, so scope to the planting-date field.
  const fieldRoot = dateField.locator('xpath=ancestor::div[contains(@class, "MuiFormControl-root")][1]');
  const pickerButton = fieldRoot.getByRole('button', { name: 'Kalender öffnen' });
  await expect(dateField).toBeVisible();
  await expect(pickerButton).toBeVisible();

  const metrics = await pickerButton.evaluate((button) => {
    const buttonRect = button.getBoundingClientRect();
    const fieldRoot = button.closest('.MuiFormControl-root');
    const fieldRect = fieldRoot?.getBoundingClientRect();
    return {
      buttonWidth: buttonRect.width,
      buttonHeight: buttonRect.height,
      fieldWidth: fieldRect?.width ?? 0,
      buttonLeft: buttonRect.left,
      fieldLeft: fieldRect?.left ?? 0,
      buttonRight: buttonRect.right,
      fieldRight: fieldRect?.right ?? 0,
    };
  });
  expect(metrics.buttonWidth).toBeGreaterThanOrEqual(32);
  expect(metrics.buttonHeight).toBeGreaterThanOrEqual(32);
  expect(metrics.buttonLeft).toBeGreaterThanOrEqual(metrics.fieldLeft);
  expect(metrics.buttonRight).toBeLessThanOrEqual(metrics.fieldRight);
  expect(metrics.fieldWidth).toBeGreaterThan(0);
});
