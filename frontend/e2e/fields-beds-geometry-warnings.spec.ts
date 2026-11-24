import { expect, test, type Page } from '@playwright/test';
import type Konva from 'konva';
import { apiRequest, loginWithDeterministicProject } from './utils';

async function findShape(page: Page, testId: string) {
  return page.evaluate(testId => {
    const { stages } = (window as unknown as { Konva: { stages: Konva.Stage[] } }).Konva;
    const stage = stages.find(item => item.container()?.isConnected);
    const node = stage?.find('Rect').find(shape => shape.getAttr('data-testid') === testId);
    if (!stage || !node) return null;
    const canvas = stage.container().getBoundingClientRect();
    const bounds = node.getClientRect();
    return {
      issue: node.getAttr('data-geometry-issue') as string | undefined,
      world: node.getAbsolutePosition(stage),
      screen: { x: canvas.x + bounds.x, y: canvas.y + bounds.y, width: bounds.width, height: bounds.height },
      zoom: stage.scaleX(),
    };
  }, testId);
}

async function seedGeometry(page: Page) {
  const { results: [location] } = await apiRequest<{ results: { id: number }[] }>(page, 'GET', '/locations/');
  await apiRequest(page, 'PATCH', `/locations/${location.id}/`, {
    width_m: 30, length_m: 25, snap_to_path_spacing: false,
  });
  const fields = [];
  for (const [name, size] of [['Lernparzelle', 10], ['Volle Parzelle', 10], ['Randparzelle', 6]] as const) {
    fields.push(await apiRequest<{ id: number }>(page, 'POST', '/fields/', {
      name, location: location.id, width_m: size, length_m: size,
    }));
  }
  const beds = [];
  for (const [name, index, width, length] of [
    ['Nordbeet', 0, 2, 4], ['Südbeet', 0, 2, 4], ['Überstehendes Beet', 0, 2, 3], ['Vollbeet', 1, 10, 10],
  ] as const) {
    beds.push(await apiRequest<{ id: number }>(page, 'POST', '/beds/', {
      name, field: fields[index].id, width_m: width, length_m: length,
    }));
  }
  beds.push(await apiRequest<{ id: number }>(page, 'POST', '/beds/', {
    name: 'Beet ohne Maße', field: fields[2].id, area_sqm: 6,
  }));
  const path = `/locations/${location.id}/layouts/`;
  await apiRequest(page, 'PUT', path, {
    location_boundary: { x: 20, y: 20 },
    field_layouts: fields.map((field, index) => ({ field: field.id, x: [40, 240, 490][index], y: 40 })),
    bed_layouts: beds.map((bed, index) => ({ bed: bed.id, x: [16, 52, 150, 0, 12][index], y: [12, 12, 80, 0, 12][index] })),
  });
  return { bedId: beds[1].id, fieldId: fields[0].id, fullFieldId: fields[1].id, path };
}

for (const input of ['mouse', 'touch'] as const) {
  test.describe(`geometric checks with ${input}`, () => {
    test.use({ hasTouch: input === 'touch' });

    test('warns about specific conflicts during drag and after saving the same geometry', async ({ page, request }, testInfo) => {
      await page.setViewportSize(input === 'touch' ? { width: 390, height: 844 } : { width: 1440, height: 900 });
      await loginWithDeterministicProject(page, request, `geometry-warnings-${input}`, { loginAsAdmin: true });
      const { bedId, fieldId, fullFieldId, path } = await seedGeometry(page);
      const activate = async (name: string) => {
        const button = page.getByRole('button', { name, exact: true });
        if (input === 'touch') await button.tap();
        else await button.click();
      };
      await page.goto('/app/fields-beds');
      await activate('Grafik');
      await activate('Ansicht um 90° nach links drehen');
      const review = page.getByRole('button', { name: /^Layoutprüfung \(/ });
      if (input === 'touch') await review.tap();
      else {
        await review.focus();
        await page.keyboard.press('Enter');
      }
      const warnings = page.getByRole('dialog', { name: 'Layoutprüfung' });
      await expect(warnings.getByText('Randparzelle ragt über die Standortgrenze hinaus.')).toBeVisible();
      await expect(warnings.getByText('Überstehendes Beet ragt über die nutzbare Fläche von Lernparzelle hinaus.')).toBeVisible();
      await expect(warnings.getByText('Zwischen Nordbeet und Südbeet liegen 25 cm. Empfohlen sind 30 cm.')).toBeVisible();
      await expect(warnings.getByText('Die Beete füllen Volle Parzelle vollständig. Für die empfohlenen Wege fehlt Platz.')).toBeVisible();
      await expect(warnings.getByText(/In Randparzelle lässt sich die Beetfläche für Beet ohne Maße nicht genau bestimmen/)).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`geometry-warnings-${input}.png`), animations: 'disabled' });
      await page.keyboard.press('Escape');
      await expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(0);
      if (input === 'mouse') await expect(review).toBeFocused();

      const getBed = () => findShape(page, `bed-rect-${bedId}`);
      const getField = () => findShape(page, `field-rect-${fieldId}`);
      await activate('Grafik bearbeiten');
      await activate('Hineinzoomen');
      const bed = (await getBed())!;
      const parcel = (await getField())!;
      expect(bed.issue).toBe('shortGap');
      const start = { x: Math.round(bed.screen.x + bed.screen.width / 2), y: Math.round(bed.screen.y + bed.screen.height / 2) };
      const target = { x: start.x - Math.round(21 * bed.zoom), y: start.y };
      const touch = input === 'touch' ? await page.context().newCDPSession(page) : null;
      if (touch) {
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
        await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [target] });
      } else {
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(target.x, target.y, { steps: 5 });
      }
      await expect.poll(async () => (await getBed())?.issue).toBe('overlap');
      expect((await getField())?.world).toEqual(parcel.world);
      const readLayouts = () => apiRequest<{ bed_layouts: { bed: number; x: number }[] }>(page, 'GET', path);
      expect((await readLayouts()).bed_layouts.find(layout => layout.bed === bedId)?.x).toBe(52);
      const saved = page.waitForResponse(response => response.url().endsWith(path) && response.request().method() === 'PUT');
      if (touch) await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      else await page.mouse.up();
      expect((await saved).ok()).toBe(true);
      expect((await readLayouts()).bed_layouts.find(layout => layout.bed === bedId)?.x).toBeLessThan(48);
      await expect.poll(async () => (await getBed())?.issue).toBe('overlap');

      if (input === 'touch') await review.tap();
      else await review.click();
      await expect(warnings.getByText('Nordbeet überlappt Südbeet.')).toBeVisible();
      await warnings.getByRole('button', { name: 'Südbeet in der Grafik anzeigen' }).click();
      await expect(warnings).toHaveCount(0);
      await expect.poll(async () => {
        const [focused, stage] = await Promise.all([getBed(), page.locator('.konvajs-content').boundingBox()]);
        if (!focused || !stage) return Number.POSITIVE_INFINITY;
        return Math.abs(focused.screen.x + focused.screen.width / 2 - stage.x - stage.width / 2);
      }).toBeLessThan(2);

      if (input === 'mouse') {
        await activate('Grafik bearbeiten');
        await activate('Alles einpassen');
        const full = (await findShape(page, `field-rect-${fullFieldId}`))!;
        await page.mouse.click(full.screen.x + full.screen.width / 2, full.screen.y + 8);
        const details = page.getByRole('dialog', { name: 'Parzellendetails' });
        await expect(details.getByText('Bruttofläche 100 m²')).toBeVisible();
        await expect(details.getByText('Von Beeten belegte Fläche innerhalb der Parzelle 100 m²')).toBeVisible();
        await expect(details.getByText('Verbleibende Fläche 0 m²')).toBeVisible();
      }
    });
  });
}
