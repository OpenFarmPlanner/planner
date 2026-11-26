import { expect, test, type Locator, type Page } from '@playwright/test';
import type Konva from 'konva';
import { VIEWPORTS, apiRequest, loginWithDeterministicProject, setViewportPreset } from './utils';

type IdResponse = { id: number };
type Rect = { x: number; y: number; width: number; height: number };

/**
 * "Mehrere Beete anlegen" and "Parzelle duplizieren" at the standard
 * breakpoints (from the context menu on desktop, the sheet menu on mobile). Functional assertions plus a layout check (no horizontal
 * overflow, actions inside the viewport); the screenshots are attached for
 * manual review only, not compared against baselines.
 */
async function seedField(page: Page, prefix: string): Promise<{ fieldId: number; fieldName: string; locationId: number }> {
  const location = await apiRequest<IdResponse>(page, 'POST', '/locations/', { name: `${prefix} Standort` });
  const fieldName = `${prefix} Parzelle`;
  const field = await apiRequest<IdResponse>(page, 'POST', '/fields/', {
    name: fieldName,
    location: location.id,
    length_m: 20,
    width_m: 10,
  });
  const beds = [];
  for (const name of ['E 1 1', 'E 1 2']) {
    beds.push(await apiRequest<IdResponse>(page, 'POST', '/beds/', { name, field: field.id, length_m: 20, width_m: 1.2 }));
  }
  await apiRequest(page, 'PUT', `/locations/${location.id}/layouts/`, {
    bed_layouts: beds.map((bed, index) => ({ bed: bed.id, x: index * 24, y: 0 })),
    field_layouts: [],
  });
  return { fieldId: field.id, fieldName, locationId: location.id };
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

function relativeBed(bed: Rect, parcel: Rect): Rect {
  return {
    x: (bed.x - parcel.x) / parcel.width, y: (bed.y - parcel.y) / parcel.height,
    width: bed.width / parcel.width, height: bed.height / parcel.height,
  };
}

async function readPreview(figure: Locator, names: string[]) {
  return figure.evaluate((svg, names) => {
    const parcel = svg.querySelector('[data-testid="bulk-bed-parcel"]')!.getBoundingClientRect();
    const beds = names.map(name => Array.from(svg.querySelectorAll('rect'))
      .find(rect => rect.querySelector('title')?.textContent === name)!.getBoundingClientRect().toJSON() as Rect);
    return { parcel: parcel.toJSON() as Rect, beds, frame: svg.getBoundingClientRect().toJSON() as Rect };
  }, names);
}

for (const mobile of [false, true]) {
  const device = mobile ? 'mobile' : 'desktop';
  test.describe(`bulk layout geometry on ${device}`, () => {
    test.use(mobile ? { hasTouch: true, isMobile: true, viewport: { width: 375, height: 800 } }
      : { viewport: { width: 1440, height: 900 } });

    test('keeps both preview orientations proportional and draws the saved layout after reload', async ({ page, request }) => {
      await loginWithDeterministicProject(page, request, `bulk-bed-geometry-${device}`, { loginAsAdmin: true });
      const locationName = 'Teststandort';
      const location = await apiRequest<IdResponse>(page, 'POST', '/locations/', { name: locationName });
      const testParcels = [];
      for (const [width, length] of [[8, 18], [18, 8], [12, 12]]) {
        const fieldName = `Parzelle ${width} × ${length}`;
        const field = await apiRequest<IdResponse>(page, 'POST', '/fields/', {
          name: fieldName, location: location.id, width_m: width, length_m: length,
        });
        const bed = await apiRequest<IdResponse>(page, 'POST', '/beds/', {
          name: 'Bestand', field: field.id, length_m: 3, width_m: 1.2,
        });
        testParcels.push({ fieldId: field.id, fieldName, width, length, existingId: bed.id });
      }
      await apiRequest(page, 'PUT', `/locations/${location.id}/layouts/`, {
        bed_layouts: testParcels.map(({ existingId }) => ({ bed: existingId, x: 22, y: 10 })), field_layouts: [],
      });
      await page.goto('/app/fields-beds');

      const names = ['Bestand', 'Neuanlage 1', 'Neuanlage 2'];
      const expected = [];
      for (const { fieldId, fieldName, width, length, existingId } of testParcels) {
        if (mobile) {
          const row = page.locator(`[data-hierarchy-mobile-row-id="field-${fieldId}"]`);
          if (!(await row.isVisible())) await page.getByRole('button', { name: `Aufklappen: ${locationName}` }).click();
          await row.getByRole('button', { name: new RegExp(`^${fieldName}`) }).click();
          await page.getByRole('dialog').getByRole('button', { name: 'Weitere Aktionen' }).click();
        } else {
          await openFieldMenu(page, fieldId);
        }
        await page.getByRole('menuitem', { name: 'Mehrere Beete anlegen' }).click();
        const dialog = page.getByRole('dialog', { name: `Mehrere Beete anlegen in ${fieldName}` });
        const lengthField = dialog.getByRole('textbox', { name: 'Länge (m)' });
        const widthField = dialog.getByRole('textbox', { name: 'Breite (m)', exact: true });
        const gap = dialog.getByRole('textbox', { name: 'Wegbreite (m)' });
        await lengthField.fill('3');
        await widthField.fill('1,2');
        await gap.fill('0,45');
        await dialog.getByRole('spinbutton', { name: 'Anzahl Beete' }).fill('2');
        await dialog.getByRole('textbox', { name: 'Name des ersten Beets' }).fill(names[1]);
        await expect(dialog.getByText('Abstand zwischen den Beeten', { exact: true })).toHaveCount(0);
        const preview = dialog.getByRole('img', { name: 'Parzellenlayout mit 2 vorgeschlagenen Beeten' });
        await expect(preview).toHaveAccessibleDescription(/Vorhandene Beete.*Neue Beete.*Außerhalb der Parzelle/);
        const alongLength = await readPreview(preview, names);
        // The main Graphic starts at 90°. The displayed parcel width is its physical length.
        expect(alongLength.parcel.width / alongLength.parcel.height).toBeCloseTo(length / width);
        expect(alongLength.parcel.width).toBeLessThanOrEqual(alongLength.frame.width);
        expect(alongLength.parcel.height).toBeLessThanOrEqual(alongLength.frame.height);
        expect(relativeBed(alongLength.beds[0], alongLength.parcel).x).toBeGreaterThan(0.5);
        expect(alongLength.beds[1].width / alongLength.beds[1].height).toBeCloseTo(2.5);

        await dialog.getByRole('radio', { name: 'Beete verlaufen entlang der Breite' }).check();
        await expect(lengthField).toHaveValue('3');
        await expect(widthField).toHaveValue('1,2');
        await expect(gap).toHaveValue('0,45');
        const alongWidth = await readPreview(preview, names);
        expect(alongWidth.parcel.width).toBeCloseTo(alongLength.parcel.width);
        expect(alongWidth.parcel.height).toBeCloseTo(alongLength.parcel.height);
        expect(relativeBed(alongWidth.beds[0], alongWidth.parcel)).toEqual(relativeBed(alongLength.beds[0], alongLength.parcel));
        expect(alongWidth.beds[1].width / alongWidth.beds[1].height).toBeCloseTo(0.4);

        if (!mobile) await dialog.getByRole('radio', { name: 'Beete verlaufen entlang der Länge' }).check();
        const selected = mobile ? alongWidth : alongLength;
        await dialog.getByRole('button', { name: '2 Beete anlegen' }).click();
        await expect(dialog).not.toBeVisible();
        const { results } = await apiRequest<{ results: (IdResponse & { name: string; field: number; length_m: number; width_m: number })[] }>(page, 'GET', '/beds/');
        const created = names.slice(1).map(name => results.find(bed => bed.field === fieldId && bed.name === name)!);
        for (const bed of created) expect(bed).toMatchObject({ length_m: 3, width_m: 1.2 });
        expected.push({ fieldId, ids: [existingId, ...created.map(bed => bed.id)],
          beds: selected.beds.map(rect => relativeBed(rect, selected.parcel)) });
      }

      await page.getByRole('button', { name: 'Grafik', exact: true }).click();
      await page.getByRole('combobox', { name: /^Standort(?: · .+)?$/ }).click();
      await page.getByRole('option', { name: locationName, exact: true }).click();
      await page.reload();
      const shapes = () => page.evaluate(fields => {
        const stage = (window as unknown as { Konva?: { stages: Konva.Stage[] } }).Konva?.stages
          .find(item => item.container()?.isConnected);
        if (!stage) return [];
        const rects = stage.find('Rect');
        const read = (testId: string): Rect | undefined => {
          const shape = rects.find(rect => rect.getAttr('data-testid') === testId) as Konva.Rect | undefined;
          return shape && { ...shape.getAbsolutePosition(stage), width: shape.width(), height: shape.height() };
        };
        return fields.map(({ fieldId, ids }) => ({ parcel: read(`field-usable-area-${fieldId}`),
          beds: ids.map(id => read(`bed-rect-${id}`)) }));
      }, expected);
      await expect.poll(async () => (await shapes()).filter(row => row.parcel && row.beds.every(Boolean)).length)
        .toBe(expected.length);
      (await shapes()).forEach(({ parcel, beds }, index) => {
        beds.forEach((bed, bedIndex) => {
          const relative = relativeBed(bed!, parcel!);
          for (const key of ['x', 'y', 'width', 'height'] as const) {
            expect(relative[key]).toBeCloseTo(expected[index].beds[bedIndex][key], 4);
          }
          expect(bed!.width / bed!.height).toBeCloseTo(mobile && bedIndex > 0 ? 0.4 : 2.5);
        });
      });
    });
  });
}

test('previews with the keyboard, retries a failed save and draws the saved orientation', async ({ page, request }) => {
  await setViewportPreset(page, VIEWPORTS.find(preset => preset.key === 'desktop')!);
  await loginWithDeterministicProject(page, request, 'bed-dialogs-positioned-keyboard', { loginAsAdmin: true });
  const { fieldId, fieldName, locationId } = await seedField(page, 'Keyboard Bulk');
  const path = `/locations/${locationId}/layouts/`;
  const before = await apiRequest(page, 'GET', path);
  await page.goto('/app/fields-beds');
  const open = async () => {
    await openFieldMenu(page, fieldId);
    await page.getByRole('menuitem', { name: 'Mehrere Beete anlegen' }).click();
    return page.getByRole('dialog', { name: `Mehrere Beete anlegen in ${fieldName}` });
  };
  let dialog = await open();
  await dialog.getByRole('textbox', { name: 'Wegbreite (m)' }).fill('0');
  await expect(dialog.getByRole('img')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  expect(await apiRequest(page, 'GET', path)).toEqual(before);

  dialog = await open();
  await expect(dialog.getByRole('textbox', { name: 'Wegbreite (m)' })).toHaveValue('0,3');
  const length = dialog.getByRole('textbox', { name: 'Länge (m)' });
  const submit = dialog.getByRole('button', { name: '3 Beete anlegen' });
  await dialog.getByRole('spinbutton', { name: 'Anzahl Beete' }).fill('3');
  await length.fill('invalid');
  await expect(submit).toBeDisabled();
  await length.fill('4');
  await dialog.getByRole('radio', { name: 'Beete verlaufen entlang der Länge' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByRole('radio', { name: 'Beete verlaufen entlang der Breite' })).toBeChecked();
  await expect(length).toHaveValue('4');
  await expect(dialog.getByRole('img', { name: 'Parzellenlayout mit 3 vorgeschlagenen Beeten' })).toBeVisible();
  await page.route('**/beds/bulk-create/', route => route.fulfill({ status: 500, json: {} }), { times: 1 });
  await submit.focus();
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('alert').filter({ hasText: /konnte nicht bestätigt werden/ })).toBeVisible();
  expect(await apiRequest(page, 'GET', path)).toEqual(before);

  await submit.click();
  await expect(dialog).not.toBeVisible();
  const after = await apiRequest<{ bed_layouts: { bed: number; runs_across_parcel: boolean }[] }>(page, 'GET', path);
  const newLayouts = after.bed_layouts.slice(2);
  expect(newLayouts).toHaveLength(3);
  expect(newLayouts.every(layout => layout.runs_across_parcel)).toBe(true);
  await page.getByRole('button', { name: 'Grafik', exact: true }).click();
  await page.getByRole('combobox', { name: 'Standort', exact: true }).click();
  await page.getByRole('option', { name: 'Keyboard Bulk Standort', exact: true }).click();
  await expect.poll(() => page.evaluate(ids => {
    const stage = (window as unknown as { Konva?: { stages: Konva.Stage[] } }).Konva?.stages
      .find(item => item.container()?.isConnected);
    if (!stage) return 0;
    // The Graphic opens at a quarter turn, so crosswise beds run vertically on screen.
    return stage.find('Rect').filter(rect => ids.some(id => rect.getAttr('data-testid') === `bed-rect-${id}`)
      && rect.height() > rect.width()).length;
  }, newLayouts.map(layout => layout.bed))).toBe(3);
});

for (const viewport of VIEWPORTS.filter((preset) => preset.key !== 'mobile')) {
  test.describe(`bed dialogs at ${viewport.key}`, () => {
    test.beforeEach(async ({ page }) => {
      await setViewportPreset(page, viewport);
    });

    test('"Mehrere Beete anlegen" suggests the count and continues the names', async ({ page, request }) => {
      await loginWithDeterministicProject(page, request, `bed-dialogs-bulk-${viewport.key}`, { loginAsAdmin: true });
      const { fieldId, fieldName, locationId } = await seedField(page, `Bulk ${viewport.key}`);
      await page.goto('/app/fields-beds');

      await openFieldMenu(page, fieldId);
      await page.getByRole('menuitem', { name: 'Mehrere Beete anlegen' }).click();
      const dialog = page.getByRole('dialog', { name: `Mehrere Beete anlegen in ${fieldName}` });
      await expect(dialog).toBeVisible();

      const length = dialog.getByRole('textbox', { name: 'Länge (m)' });
      await expect(length).toBeFocused();
      await expect(length).toHaveValue('20');
      await expect(dialog.getByRole('textbox', { name: 'Breite (m)', exact: true })).toHaveValue('1,2');
      await expect(dialog.getByRole('radio', { name: 'Beete verlaufen entlang der Länge' })).toBeChecked();
      const count = dialog.getByRole('spinbutton', { name: 'Anzahl Beete' });
      await expect(count).toHaveValue('4');
      const gap = dialog.getByRole('textbox', { name: 'Wegbreite (m)' });
      await expect(gap).toHaveValue('0,3');
      await expect(dialog.getByRole('img', { name: 'Parzellenlayout mit 4 vorgeschlagenen Beeten' })).toBeVisible();
      await expect(dialog.getByText('Beetfläche 144 m² · Freie Bodenfläche 56 m²')).toBeVisible();
      await expect(dialog.getByRole('textbox', { name: 'Name des ersten Beets' })).toHaveValue('E 1 3');

      await gap.fill('0,75');
      await expect(dialog.getByText('Passende Beete in dieser Anordnung (3)')).toBeVisible();
      await expect(dialog.getByText(/Beet außerhalb der Parzellengrenze \(1\)/)).toBeVisible();
      await expect(count).toHaveValue('4');
      await dialog.getByRole('button', { name: '3 übernehmen' }).click();
      await expect(count).toHaveValue('3');
      await expect(dialog.getByRole('button', { name: '3 übernehmen' })).toHaveCount(0);

      await expect(dialog.getByRole('list', { name: 'Namen der neuen Beete' })).toContainText('E 1 5');
      await expect(dialog.getByText('3 Beete, je 24 m², gesamt 72 m²')).toBeVisible();
      const path = `/locations/${locationId}/layouts/`;
      const before = await apiRequest<{ bed_layouts: unknown[] }>(page, 'GET', path);
      expect(before.bed_layouts).toHaveLength(2);
      await expectDialogFits(page, dialog);
      await attachScreenshot(page, `bulk-dialog-${viewport.key}`);

      await dialog.getByRole('button', { name: '3 Beete anlegen' }).click();
      await expect(dialog).not.toBeVisible();
      for (const name of ['E 1 3', 'E 1 5']) {
        await expect(page.locator('[role="row"][data-id]').filter({ hasText: name })).toHaveCount(1);
      }
      const after = await apiRequest<{ bed_layouts: { x: number; y: number }[] }>(page, 'GET', path);
      expect(after.bed_layouts).toHaveLength(5);
      expect(after.bed_layouts.slice(0, 2)).toEqual(before.bed_layouts);
      expect(after.bed_layouts[2].x).toBeCloseTo(3.45 * 16);
      expect(after.bed_layouts[2].y).toBe(0);
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

  test('"Mehrere Beete anlegen" opens full screen from the sheet menu', async ({ page, request }) => {
    await loginWithDeterministicProject(page, request, 'bed-dialogs-bulk-mobile', { loginAsAdmin: true });
    const { fieldId, fieldName } = await seedField(page, 'Bulk mobile');
    await page.goto('/app/fields-beds');

    const fieldRow = page.locator(`[data-hierarchy-mobile-row-id="field-${fieldId}"]`);
    if (!(await fieldRow.isVisible())) {
      await page.getByRole('button', { name: /^Aufklappen:/ }).first().click();
    }
    await fieldRow.getByRole('button', { name: new RegExp(`^${fieldName}`) }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Weitere Aktionen' }).click();
    await page.getByRole('menuitem', { name: 'Mehrere Beete anlegen' }).click();

    const dialog = page.getByRole('dialog', { name: `Mehrere Beete anlegen in ${fieldName}` });
    await expect(dialog).toBeVisible();
    expect(await dialog.boundingBox()).toMatchObject({ x: 0, y: 0, width: 375, height: 800 });
    await expect(dialog.getByRole('spinbutton', { name: 'Anzahl Beete' })).toHaveValue('4');
    await expect(dialog.getByRole('textbox', { name: 'Name des ersten Beets' })).toHaveValue('E 1 3');
    await expect(dialog.getByRole('img', { name: 'Parzellenlayout mit 4 vorgeschlagenen Beeten' })).toBeVisible();
    await expectDialogFits(page, dialog);
    await attachScreenshot(page, 'bulk-dialog-mobile');

    await dialog.getByRole('button', { name: '4 Beete anlegen' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText('4 Beete angelegt.')).toBeVisible();
    const created = page.locator('[data-hierarchy-mobile-row-id]').filter({ hasText: 'E 1 6' });
    await expect(created).toHaveCount(1);
    await page.getByRole('button', { name: 'Rückgängig' }).click();
    await expect(created).toHaveCount(0);
  });

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
