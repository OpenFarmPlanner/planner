import { expect, test, type Locator, type Page } from '@playwright/test';
import { VIEWPORTS, apiRequest, loginWithDeterministicProject, setViewportPreset } from './utils';

type IdResponse = { id: number };

/**
 * "Mehrere Beete anlegen" and "Parzelle duplizieren" at the standard
 * breakpoints. Functional assertions plus a layout check (no horizontal
 * overflow, actions inside the viewport); the screenshots are attached for
 * manual review only, not compared against baselines.
 */
async function seedField(page: Page, prefix: string): Promise<{ fieldId: number; fieldName: string }> {
  const location = await apiRequest<IdResponse>(page, 'POST', '/locations/', { name: `${prefix} Standort` });
  const fieldName = `${prefix} Parzelle`;
  const field = await apiRequest<IdResponse>(page, 'POST', '/fields/', {
    name: fieldName,
    location: location.id,
    length_m: 20,
    width_m: 10,
  });
  for (const name of ['E 1 1', 'E 1 2']) {
    await apiRequest<IdResponse>(page, 'POST', '/beds/', { name, field: field.id, length_m: 20, width_m: 1.2 });
  }
  return { fieldId: field.id, fieldName };
}

// The dialog role sits on the MUI Paper itself.
async function expectDialogFits(page: Page, dialog: Locator): Promise<void> {
  const overflow = await dialog.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const viewport = page.viewportSize()!;
  for (const button of await dialog.locator('.MuiDialogActions-root button').all()) {
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  }
}

async function attachScreenshot(page: Page, name: string): Promise<void> {
  const path = test.info().outputPath(`${name}.png`);
  // Let the dialog's fade-in finish so the capture shows the final state.
  await page.waitForTimeout(400);
  await page.screenshot({ path });
  await test.info().attach(name, { path, contentType: 'image/png' });
}

async function openFieldMenu(page: Page, fieldId: number): Promise<void> {
  const fieldRow = page.locator(`[role="row"][data-id="field-${fieldId}"]`);
  await expect(fieldRow).toBeVisible();
  await fieldRow.click({ button: 'right' });
}

for (const viewport of VIEWPORTS.filter((preset) => preset.key !== 'mobile')) {
  test.describe(`bed dialogs at ${viewport.key}`, () => {
    test.beforeEach(async ({ page }) => {
      await setViewportPreset(page, viewport);
    });

    test('"Mehrere Beete anlegen" suggests the count and continues the names', async ({ page, request }) => {
      await loginWithDeterministicProject(page, request, `bed-dialogs-bulk-${viewport.key}`, { loginAsAdmin: true });
      const { fieldId, fieldName } = await seedField(page, `Bulk ${viewport.key}`);
      await page.goto('/app/fields-beds');

      await openFieldMenu(page, fieldId);
      await page.getByRole('menuitem', { name: 'Mehrere Beete anlegen' }).click();
      const dialog = page.getByRole('dialog', { name: `Mehrere Beete anlegen in ${fieldName}` });
      await expect(dialog).toBeVisible();

      const length = dialog.getByRole('textbox', { name: 'Länge (m)' });
      await expect(length).toBeFocused();
      await expect(length).toHaveValue('20');
      await expect(dialog.getByRole('textbox', { name: 'Breite (m)' })).toHaveValue('1,2');
      await expect(dialog.getByRole('radio', { name: 'Beete verlaufen entlang der Länge' })).toBeChecked();
      // free = 10 - 2 × 1.2 = 7.6 → 6 beds
      const count = dialog.getByRole('spinbutton', { name: 'Anzahl Beete' });
      await expect(count).toHaveValue('6');
      await expect(dialog.getByText('Bei 0 m Weg passen noch 6 Beete auf 10 m (2 vorhandene Beete eingerechnet).')).toBeVisible();
      await expect(dialog.getByRole('textbox', { name: 'Name des ersten Beets' })).toHaveValue('E 1 3');

      // free = 10 - 2.4 - 2 × 0.4 = 6.8 → floor(7.2 / 1.6) = 4; the field keeps 6 until the link is used.
      await dialog.getByRole('textbox', { name: 'Weg (m)' }).fill('0,4');
      await expect(dialog.getByText('Bei 0,4 m Weg passen noch 4 Beete auf 10 m (2 vorhandene Beete eingerechnet).')).toBeVisible();
      await expect(count).toHaveValue('6');
      await dialog.getByRole('button', { name: '4 übernehmen' }).click();
      await expect(count).toHaveValue('4');
      await expect(dialog.getByRole('button', { name: '4 übernehmen' })).toHaveCount(0);

      await expect(dialog.getByRole('list', { name: 'Namen der neuen Beete' })).toContainText('E 1 6');
      await expect(dialog.getByText('4 Beete, je 24 m², gesamt 96 m²')).toBeVisible();
      await expectDialogFits(page, dialog);
      await attachScreenshot(page, `bulk-dialog-${viewport.key}`);

      await dialog.getByRole('button', { name: '4 Beete anlegen' }).click();
      await expect(dialog).not.toBeVisible();
      for (const name of ['E 1 3', 'E 1 6']) {
        await expect(page.locator('[role="row"][data-id]').filter({ hasText: name })).toHaveCount(1);
      }
    });

    test('"Parzelle duplizieren" copies the field with renamed beds', async ({ page, request }) => {
      await loginWithDeterministicProject(page, request, `bed-dialogs-duplicate-${viewport.key}`, { loginAsAdmin: true });
      const { fieldId, fieldName } = await seedField(page, `Dup ${viewport.key}`);
      await page.goto('/app/fields-beds');

      await openFieldMenu(page, fieldId);
      await page.getByRole('menuitem', { name: 'Parzelle duplizieren' }).click();
      const dialog = page.getByRole('dialog', { name: 'Parzelle duplizieren' });
      await expect(dialog).toBeVisible();

      const newName = `${fieldName} 2`;
      await expect(dialog.getByRole('textbox', { name: 'Name der neuen Parzelle' })).toHaveValue(newName);
      await expect(dialog.getByRole('checkbox', { name: 'Beete mitkopieren (2)' })).toBeChecked();
      await dialog.getByRole('textbox', { name: 'In Beetnamen ersetzen' }).fill('X');
      await expect(dialog.getByText('Kommt in keinem Beetnamen vor.')).toBeVisible();
      await dialog.getByRole('textbox', { name: 'In Beetnamen ersetzen' }).fill('E 1');
      await dialog.getByRole('textbox', { name: 'durch' }).fill('E 2');
      await expect(dialog.getByText(`Neue Parzelle ${newName}, 20 × 10 m, 2 Beete: E 2 1, E 2 2`)).toBeVisible();

      // A taken name blocks the action.
      await dialog.getByRole('textbox', { name: 'Name der neuen Parzelle' }).fill(fieldName);
      await expect(dialog.getByRole('button', { name: 'Duplizieren' })).toBeDisabled();
      await dialog.getByRole('textbox', { name: 'Name der neuen Parzelle' }).fill(newName);
      await expectDialogFits(page, dialog);
      await attachScreenshot(page, `duplicate-dialog-${viewport.key}`);

      await dialog.getByRole('button', { name: 'Duplizieren' }).click();
      await expect(dialog).not.toBeVisible();
      await expect(page.getByText(`Parzelle „${newName}“ mit 2 Beeten angelegt`)).toBeVisible();
      const rows = page.locator('[role="row"][data-id]');
      await expect(rows.filter({ hasText: 'E 2 1' })).toHaveCount(1);
      await expect(rows.filter({ hasText: 'E 2 2' })).toHaveCount(1);
      // The copy is the next field after its source.
      const rowIds = await rows.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-id')));
      const fieldRowIds = rowIds.filter((id) => id?.startsWith('field-'));
      const copyRowId = fieldRowIds[fieldRowIds.indexOf(`field-${fieldId}`) + 1];
      await expect(page.locator(`[role="row"][data-id="${copyRowId}"]`)).toContainText(newName);
    });
  });
}

test.describe('bed dialogs at mobile', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 800 } });

  test('"Parzelle duplizieren" opens full screen from the sheet menu', async ({ page, request }) => {
    await loginWithDeterministicProject(page, request, 'bed-dialogs-duplicate-mobile', { loginAsAdmin: true });
    const { fieldId, fieldName } = await seedField(page, 'Dup mobile');
    await page.goto('/app/fields-beds');

    const fieldRow = page.locator(`[data-hierarchy-mobile-row-id="field-${fieldId}"]`);
    if (!(await fieldRow.isVisible())) {
      await page.getByRole('button', { name: /^Aufklappen:/ }).first().click();
    }
    await fieldRow.getByRole('button', { name: new RegExp(`^${fieldName}`) }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Weitere Aktionen' }).click();
    await page.getByRole('menuitem', { name: 'Parzelle duplizieren' }).click();

    const dialog = page.getByRole('dialog', { name: 'Parzelle duplizieren' });
    await expect(dialog).toBeVisible();
    const paperBox = await dialog.boundingBox();
    expect(paperBox).toMatchObject({ x: 0, y: 0, width: 375, height: 800 });
    await expectDialogFits(page, dialog);
    await attachScreenshot(page, 'duplicate-dialog-mobile');

    await dialog.getByRole('button', { name: 'Duplizieren' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText(`Parzelle „${fieldName} 2“ mit 2 Beeten angelegt`)).toBeVisible();
  });
});
