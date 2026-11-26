import { expect, test, type Page } from '@playwright/test';
import type Konva from 'konva';
import { activateCanvasTool, apiRequest, graphicDisplayButton, loginWithDeterministicProject, openGraphicLegend, selectGraphicDisplay } from './utils';

// Layout failure/delay fixtures must intercept the browser's requests directly.
test.use({ serviceWorkers: 'block' });

async function canvasRects(page: Page, prefix: string) {
  return page.evaluate(prefix => {
    const konva = (window as unknown as { Konva?: { stages: Konva.Stage[] } }).Konva;
    return (konva?.stages ?? []).filter(stage => stage.container()?.isConnected)
      .flatMap(stage => stage.find('Rect, Text').map(node => ({
        id: String(node.getAttr('data-testid') ?? ''),
        ...node.getAbsolutePosition(stage), width: node.width(), height: node.height(),
        rotation: node.rotation(), bounds: node.getClientRect(),
        screenSize: { width: node.width() * stage.scaleX(), height: node.height() * stage.scaleY() },
        stage: { width: stage.width(), height: stage.height() },
        container: { x: stage.container().getBoundingClientRect().x, y: stage.container().getBoundingClientRect().y },
      }))).filter(rect => rect.id.startsWith(prefix));
  }, prefix);
}

test('fits unsaved plots together and shows readable beds in the schematic view', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, `graphical-layout-${testInfo.workerIndex}`, { loginAsAdmin: true });
  const location = await apiRequest<{ id: number }>(page, 'POST', '/locations/', { name: 'Grafik913' });
  const fieldIds: number[] = [];
  const bedIds: number[] = [];
  const layoutWrites: string[] = [];
  page.on('request', request => {
    if (/\/layouts\/$/.test(new URL(request.url()).pathname) && request.method() !== 'GET') layoutWrites.push(request.method());
  });
  for (const [index, width, length] of [[1, 10, 20], [2, 24, 10], [3, 8, 8]]) {
    const field = await apiRequest<{ id: number }>(page, 'POST', '/fields/', {
      name: `Parzelle ${index}`, location: location.id, width_m: width, length_m: length,
    });
    fieldIds.push(field.id);
    const bed = await apiRequest<{ id: number }>(page, 'POST', '/beds/', {
      name: `Beet ${index} mit einem langen lesbaren Namen`, field: field.id,
      width_m: index === 1 ? 2 : index === 2 ? 18 : 4,
      length_m: index === 1 ? 15 : index === 2 ? 3 : 4,
    });
    bedIds.push(bed.id);
  }
  await page.goto('/app/fields-beds');
  // The project's own first location (named after the project, #1190) is
  // preselected, so pick the one this test fills.
  const layouts = page.waitForResponse(response => response.url().endsWith(`/locations/${location.id}/layouts/`));
  await page.getByRole('button', { name: 'Grafik', exact: true }).click();
  await selectLocation(page, 'Grafik913');
  await layouts;
  await page.waitForLoadState('networkidle');
  await page.getByRole('region', { name: 'Standort: Grafik913', exact: true }).scrollIntoViewIfNeeded();
  for (const viewport of [
    { width: 1440, height: 900 }, { width: 1024, height: 900 },
    { width: 768, height: 900 }, { width: 375, height: 800 }, { width: 800, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.getByRole('region', { name: 'Standort: Grafik913', exact: true }).scrollIntoViewIfNeeded();
    // Wait for the actual canvas card to be measured after responsive reflow.
    await expect.poll(async () => {
      const field = (await canvasRects(page, `field-rect-${fieldIds[0]}`))[0];
      const bottom = field.container.y + field.stage.height;
      return field.stage.width <= viewport.width && bottom <= viewport.height && bottom >= viewport.height - 32;
    }).toBe(true);
    await expect.poll(async () => (await canvasRects(page, 'bed-rect-')).filter(bed => bedIds.includes(Number(bed.id.replace('bed-rect-', '')))).length).toBe(3);
    const fields = (await canvasRects(page, 'field-rect-')).filter(field => fieldIds.includes(Number(field.id.replace('field-rect-', ''))));
    expect(fields).toHaveLength(3);
    for (const field of fields) {
      expect(field.bounds.x).toBeGreaterThanOrEqual(0);
      // Konva bounds include the scaled stroke around the top fit inset.
      expect(field.bounds.y).toBeGreaterThanOrEqual(44);
      expect(field.bounds.x + field.bounds.width).toBeLessThanOrEqual(field.stage.width + 1);
      expect(field.bounds.y + field.bounds.height).toBeLessThanOrEqual(field.stage.height + 1);
    }
    expect(fields[0].width / fields[0].height).toBeCloseTo(2);
    expect(fields[1].width / fields[1].height).toBeCloseTo(1 / 2.4);
    for (const [index, field] of fields.entries()) {
      for (const other of fields.slice(index + 1)) {
        expect(field.x + field.width <= other.x || other.x + other.width <= field.x ||
          field.y + field.height <= other.y || other.y + other.height <= field.y).toBe(true);
      }
    }
    const beds = (await canvasRects(page, 'bed-rect-')).filter(bed => bedIds.includes(Number(bed.id.replace('bed-rect-', ''))));
    const labels = await canvasRects(page, 'bed-label-');
    for (const bed of beds) {
      const label = labels.find(label => label.id === bed.id.replace('bed-rect-', 'bed-label-'));
      if (bed.screenSize.height >= 13 && bed.screenSize.width >= 22) {
        expect(label).toBeDefined();
        expect(label!.rotation).toBe(0);
        expect(label!.bounds.x).toBeGreaterThanOrEqual(bed.bounds.x - 1);
        expect(label!.bounds.y).toBeGreaterThanOrEqual(bed.bounds.y - 1);
        expect(label!.bounds.x + label!.bounds.width).toBeLessThanOrEqual(bed.bounds.x + bed.bounds.width + 1);
        expect(label!.bounds.y + label!.bounds.height).toBeLessThanOrEqual(bed.bounds.y + bed.bounds.height + 1);
      }
    }
    await page.mouse.move(1, viewport.height - 1);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`graphical-${viewport.width}x${viewport.height}.png`), animations: 'disabled' });
    if (viewport.height === 375) {
      await page.getByRole('region', { name: 'Standort: Grafik913', exact: true })
        .screenshot({ path: testInfo.outputPath('graphical-landscape-card.png'), animations: 'disabled' });
    }
  }
  await page.setViewportSize({ width: 375, height: 800 });
  const card = page.getByRole('region', { name: 'Standort: Grafik913', exact: true });
  await expect.poll(async () => (await canvasRects(page, `bed-rect-${bedIds[0]}`))[0].stage.width).toBeLessThanOrEqual(375);
  await card.scrollIntoViewIfNeeded();
  const zoomTarget = (await canvasRects(page, `bed-rect-${bedIds[0]}`))[0];
  await page.mouse.move(zoomTarget.container.x + zoomTarget.bounds.x + zoomTarget.bounds.width / 2,
    zoomTarget.container.y + zoomTarget.bounds.y + zoomTarget.bounds.height / 2);
  for (let i = 0; i < 2; i += 1) {
    const before = (await canvasRects(page, `bed-rect-${bedIds[0]}`))[0].screenSize.height;
    await page.mouse.wheel(0, -100);
    await expect.poll(async () => (await canvasRects(page, `bed-rect-${bedIds[0]}`))[0].screenSize.height).toBeGreaterThan(before);
  }
  await expect.poll(async () => (await canvasRects(page, `bed-label-${bedIds[0]}`)).length).toBe(1);
  let zoomedLabel = (await canvasRects(page, `bed-label-${bedIds[0]}`))[0];
  if (zoomedLabel.bounds.x + zoomedLabel.bounds.width > zoomedLabel.stage.width) {
    await page.keyboard.press('ArrowRight');
    zoomedLabel = (await canvasRects(page, `bed-label-${bedIds[0]}`))[0];
  }
  expect(zoomedLabel.bounds.x).toBeGreaterThanOrEqual(0);
  expect(zoomedLabel.bounds.y).toBeGreaterThanOrEqual(0);
  expect(zoomedLabel.bounds.x + zoomedLabel.bounds.width).toBeLessThanOrEqual(zoomedLabel.stage.width);
  await page.screenshot({ path: testInfo.outputPath('graphical-mobile-zoomed.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 1600, height: 900 });
  await card.getByRole('button', { name: 'Alles einpassen', exact: true }).click();
  await page.getByRole('region', { name: 'Standort: Grafik913', exact: true }).scrollIntoViewIfNeeded();
  const original = (await canvasRects(page, `field-rect-${fieldIds[0]}`))[0];
  for (let turn = 1; turn <= 4; turn += 1) {
    await card.getByRole('button', { name: 'Ansicht um 90° nach rechts drehen', exact: true }).click();
    const field = (await canvasRects(page, `field-rect-${fieldIds[0]}`))[0];
    expect(field.width / field.height).toBeCloseTo(turn % 2 ? 0.5 : 2);
    for (const label of await canvasRects(page, 'bed-label-')) expect(label.rotation).toBe(0);
    expect(field.bounds.x).toBeGreaterThanOrEqual(0);
    // Konva bounds include the scaled stroke around the top fit inset.
      expect(field.bounds.y).toBeGreaterThanOrEqual(44);
    expect(field.bounds.x + field.bounds.width).toBeLessThanOrEqual(field.stage.width + 1);
    expect(field.bounds.y + field.bounds.height).toBeLessThanOrEqual(field.stage.height + 1);
  }
  const restored = (await canvasRects(page, `field-rect-${fieldIds[0]}`))[0];
  expect(restored.x).toBe(original.x);
  expect(restored.y).toBe(original.y);
  await card.getByRole('button', { name: 'Ansicht um 90° nach rechts drehen', exact: true }).hover();
  await expect(page.getByRole('tooltip')).toHaveText('Ansicht um 90° nach rechts drehen');
  await card.getByRole('button', { name: 'Ansicht um 90° nach links drehen', exact: true }).click();
  await card.getByRole('button', { name: 'Ansicht um 90° nach rechts drehen', exact: true }).click();
  const bed = (await canvasRects(page, `bed-rect-${bedIds[0]}`))[0];
  await page.mouse.click(bed.container.x + bed.bounds.x + bed.bounds.width / 2,
    bed.container.y + bed.bounds.y + bed.bounds.height / 2);
  const preview = page.getByRole('region', { name: 'Beet 1 mit einem langen lesbaren Namen', exact: true });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('2 × 15 m');
  await expect(page).toHaveURL(/fields-beds$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const camera = await activeCamera(page);
  await preview.getByRole('button', { name: 'Details anzeigen' }).click();
  await expect(page).toHaveURL(new RegExp(`/fields-beds/beds/${bedIds[0]}$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Beet 1 mit einem langen lesbaren Namen' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('graphical-bed-details.png'), animations: 'disabled' });
  expect(layoutWrites).toEqual([]);
  await page.getByRole('button', { name: 'Zurück zur Grafik' }).click();
  await expect(card).toBeVisible();
  await expect.poll(() => activeCamera(page)).toEqual(camera);
  const unmeasuredLocation = card.getByRole('button', { name: 'Standort · Grafik913' });
  await unmeasuredLocation.click();
  const locationPreview = page.getByRole('region', { name: 'Grafik913', exact: true });
  await expect(locationPreview).toBeVisible();
  await expect(locationPreview).not.toContainText('m²');
  await expect(locationPreview).not.toContainText(' × ');
  await page.keyboard.press('Escape');
  await page.evaluate(() => localStorage.setItem('ui.language', 'fr'));
  await page.setViewportSize({ width: 375, height: 800 });
  await page.reload();
  await page.getByRole('button', { name: 'Autres outils du plan', exact: true }).click();
  const rotateRight = page.getByRole('menuitem', { name: 'Tourner la vue de 90° vers la droite', exact: true });
  await rotateRight.hover();
  await page.screenshot({ path: testInfo.outputPath('graphical-mobile-fr.png'), animations: 'disabled' });
  await rotateRight.click();
});

function shapePoint(shape: Awaited<ReturnType<typeof canvasRects>>[number], x = 0.5, y = 0.5) {
  return {
    x: shape.container.x + shape.bounds.x + shape.bounds.width * x,
    y: shape.container.y + shape.bounds.y + shape.bounds.height * y,
  };
}

async function selectionFixture(page: Page) {
  const location = await apiRequest<{ id: number }>(page, 'POST', '/locations/', {
    name: 'Lernhof', width_m: 24, length_m: 28,
  });
  const parcel = await apiRequest<{ id: number }>(page, 'POST', '/fields/', {
    name: 'Lernparzelle', location: location.id, width_m: 12, length_m: 10,
  });
  const bed = await apiRequest<{ id: number }>(page, 'POST', '/beds/', {
    name: 'Lernbeet', field: parcel.id, width_m: 2, length_m: 4,
  });
  await page.goto('/app/fields-beds');
  await page.getByRole('button', { name: 'Grafik', exact: true }).click();
  await selectLocation(page, 'Lernhof');
  const card = page.getByRole('region', { name: 'Standort: Lernhof' });
  await card.scrollIntoViewIfNeeded();
  await expect.poll(async () => (await canvasRects(page, `bed-rect-${bed.id}`)).length).toBe(1);
  return { location, parcel, bed, card };
}

test('selects the deepest object, keeps the native blank-canvas menu and supports keyboard details', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1050, height: 900 });
  await loginWithDeterministicProject(page, request, `graphic-selection-${testInfo.workerIndex}`, { loginAsAdmin: true });
  const { location, parcel, bed, card } = await selectionFixture(page);
  const preview = page.getByTestId('graphical-object-preview');
  const hint = card.getByText(/Rechtsklick auf einen Standort/);
  await expect(hint).toBeVisible();

  const at = async (id: string, x?: number, y?: number) => shapePoint((await canvasRects(page, id))[0], x, y);
  const bedPoint = await at(`bed-rect-${bed.id}`);
  await page.mouse.move(bedPoint.x, bedPoint.y);
  await expect(page.getByRole('tooltip')).toContainText('2 × 4 m');
  await page.mouse.click(bedPoint.x, bedPoint.y);
  await expect(preview).toHaveAccessibleName('Lernbeet');
  await expect(preview).toContainText('Lernparzelle');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(page).toHaveURL(/fields-beds$/);

  const parcelPoint = await at(`field-rect-${parcel.id}`, 0.9, 0.17);
  await page.mouse.click(parcelPoint.x, parcelPoint.y);
  await expect(preview).toHaveAccessibleName('Lernparzelle');
  await expect(preview).toContainText('12 × 10 m');
  await expect(preview).toContainText('112 m²');

  const free = await at('graphical-free-area-site');
  await page.mouse.click(free.x, free.y);
  await expect(preview).toHaveAccessibleName('Lernhof');
  await expect(preview).toContainText('Freifläche außerhalb der Parzellen');
  await expect(preview).toContainText('552 m²');
  await page.screenshot({ path: testInfo.outputPath('graphical-location-preview.png') });
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);

  const label = await at(`location-boundary-label-${location.id}`);
  await page.mouse.move(label.x, label.y);
  await expect(page.getByRole('tooltip')).toContainText('24 × 28 m');
  await page.mouse.click(label.x, label.y, { button: 'right' });
  await expect(page.getByRole('menu', { name: 'Lernhof' })).toBeVisible();
  await expect(page.getByText(/Rechtsklick auf einen Standort/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('graphical-object-menu.png') });
  await page.keyboard.press('Escape');
  await expect(hint).toHaveCount(0);
  const locationTarget = card.locator(`[data-graphical-object-target="location:${location.id}"]`);
  await expect(locationTarget).toBeFocused();

  await page.evaluate(() => {
    const canvas = document.querySelector('.konvajs-content')!;
    document.addEventListener('contextmenu', event => {
      canvas.setAttribute('data-native-menu-handled', String(event.defaultPrevented));
    }, { once: true });
  });
  const shape = (await canvasRects(page, `bed-rect-${bed.id}`))[0];
  const blank = { x: shape.container.x + 5, y: shape.container.y + shape.stage.height - 8 };
  await page.mouse.click(blank.x, blank.y, { button: 'right' });
  await expect(page.locator('.konvajs-content')).toHaveAttribute('data-native-menu-handled', 'false');
  await expect(page.getByRole('menu')).toHaveCount(0);

  const keyboardBed = card.locator(`[data-graphical-object-target="bed:${bed.id}"]`);
  await keyboardBed.press('Enter');
  await expect(preview).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(keyboardBed).toBeFocused();
  await keyboardBed.press('Shift+F10');
  const bedMenu = page.getByRole('menu', { name: 'Lernbeet' });
  await expect(bedMenu).toBeVisible();
  await bedMenu.getByRole('menuitem', { name: 'Details anzeigen' }).press('Enter');
  await expect(page).toHaveURL(new RegExp(`/fields-beds/beds/${bed.id}$`));
  await page.getByRole('button', { name: 'Zurück zur Grafik' }).click();
  await expect(card).toBeVisible();
  await expect(hint).toHaveCount(0);

  const center = await at(`bed-rect-${bed.id}`);
  const scale = (await activeCamera(page)).scale;
  await page.mouse.dblclick(center.x, center.y);
  await expect.poll(async () => (await activeCamera(page)).scale).toBeGreaterThan(scale);
  await expect(preview).toHaveCount(0);
  await expect(page).toHaveURL(/fields-beds$/);
  await card.getByRole('button', { name: 'Vollbild öffnen' }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
  await locationTarget.press('Shift+F10');
  const fullscreenMenu = page.getByRole('menu', { name: 'Lernhof' });
  await expect(fullscreenMenu).toBeVisible();
  expect(await fullscreenMenu.evaluate(node => document.fullscreenElement?.contains(node))).toBe(true);
  await fullscreenMenu.getByRole('menuitem', { name: 'Details anzeigen' }).click();
  await expect(page).toHaveURL(new RegExp(`/fields-beds/locations/${location.id}$`));
  await expect(page.getByTestId('detail-remaining-area')).toContainText('552 m²');
});

test.describe('graphical object touch gestures', () => {
  test.use({ hasTouch: true, viewport: { width: 375, height: 800 } });

  test('separates taps, long presses and cancelled presses, with a persistent touch hint', async ({ page, request }, testInfo) => {
    await loginWithDeterministicProject(page, request, `graphic-touch-${testInfo.workerIndex}`, { loginAsAdmin: true });
    const { location, parcel, bed, card } = await selectionFixture(page);
    const touch = await page.context().newCDPSession(page);
    const preview = page.getByTestId('graphical-object-preview');
    const hint = card.getByText(/Standort, Parzelle oder Beet gedrückt halten/);
    await expect(hint).toBeVisible();
    await expect(card.getByText(/Rechtsklick auf einen Standort/)).toHaveCount(0);
    const points = [
      { id: `bed-rect-${bed.id}`, name: 'Lernbeet' },
      { id: `field-rect-${parcel.id}`, name: 'Lernparzelle', x: 0.9, y: 0.17 },
      { id: `location-boundary-label-${location.id}`, name: 'Lernhof' },
    ];
    for (const { id, name, x, y } of points) {
      const point = shapePoint((await canvasRects(page, id))[0], x, y);
      await page.touchscreen.tap(point.x, point.y);
      await expect(preview).toHaveAccessibleName(name);
      if (name === 'Lernbeet') await page.screenshot({ path: testInfo.outputPath('graphical-bed-preview-phone.png') });
      await expect(page.getByRole('tooltip')).toHaveCount(0);
      await expect(page).toHaveURL(/fields-beds$/);
      await page.keyboard.press('Escape');
      await expect(preview).toHaveCount(0);

      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
      const menu = page.getByRole('menu', { name });
      await expect(menu).toBeVisible();
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect(menu).toBeVisible();
      await expect(preview).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(hint).toHaveCount(0);
    }

    const point = shapePoint((await canvasRects(page, `bed-rect-${bed.id}`))[0]);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x + 20, y: point.y + 20 }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    // Wait past the gesture threshold so a leaked timer would open a menu.
    await page.waitForTimeout(500);
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(preview).toHaveCount(0);
    const zoomPoint = shapePoint((await canvasRects(page, `bed-rect-${bed.id}`))[0]);
    const beforeZoom = (await activeCamera(page)).scale;
    await page.touchscreen.tap(zoomPoint.x, zoomPoint.y);
    await page.touchscreen.tap(zoomPoint.x, zoomPoint.y);
    await expect.poll(async () => (await activeCamera(page)).scale).toBeGreaterThan(beforeZoom);
    await expect(preview).toHaveCount(0);
    await page.reload();
    await expect(card).toBeVisible();
    await expect(hint).toHaveCount(0);
  });
});

async function activeCamera(page: Page) {
  return page.evaluate(() => {
    const stage = (window as unknown as { Konva: { stages: Konva.Stage[] } }).Konva.stages
      .find(stage => stage.container()?.isConnected)!;
    return { scale: stage.scaleX(), x: stage.x(), y: stage.y() };
  });
}

async function selectLocation(page: Page, name: string) {
  await page.getByRole('combobox', { name: /^Standort(?: · .+)?$/ }).click();
  await page.getByRole('option', { name, exact: true }).click();
  await expect(page.getByRole('region', { name: `Standort: ${name}`, exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
}

test.describe('responsive canvas tools', () => {
  test.use({ hasTouch: true });

  test('keeps core tools reachable and moves navigation to the menu only on a narrow canvas', async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await loginWithDeterministicProject(page, request, 'responsive-canvas-tools', { demoProject: true, loginAsAdmin: true });
    await page.goto('/app/fields-beds');
    await page.getByRole('button', { name: 'Grafik', exact: true }).tap();
    await selectLocation(page, 'Hofgarten');
    const toolbar = page.getByTestId('graphical-canvas-tools');
    const trigger = toolbar.getByRole('button', { name: 'Weitere Grafikwerkzeuge' });
    const menu = page.getByRole('menu', { name: 'Weitere Grafikwerkzeuge' });
    const individualPlants = toolbar.getByRole('button', { name: 'Einzelpflanzen', exact: true });
    const rotate = 'Ansicht um 90° nach rechts drehen';
    const directRotation = toolbar.getByRole('button', { name: rotate, exact: true });

    for (const viewport of [
      { width: 375, height: 800 }, { width: 768, height: 1024 },
      { width: 1024, height: 768 }, { width: 800, height: 375 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(toolbar.getByRole('button')).toHaveCount(5);
      await expect(directRotation).toHaveCount(0);
      const buttons = await toolbar.getByRole('button').all();
      for (const button of buttons) {
        const bounds = (await button.boundingBox())!;
        expect(bounds.width).toBeGreaterThanOrEqual(44);
        expect(bounds.height).toBeGreaterThanOrEqual(44);
      }
      expect(await toolbar.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
      if (viewport.height === 375) {
        await trigger.tap();
        await expect(menu).toBeVisible();
        for (const item of await menu.getByRole('menuitem').all()) {
          expect(await item.evaluate(element => element.offsetHeight)).toBeGreaterThanOrEqual(44);
        }
        await page.screenshot({ path: testInfo.outputPath('canvas-tools-landscape.png'), animations: 'disabled' });
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
      }
    }

    await page.setViewportSize({ width: 768, height: 1024 });
    await expect.poll(async () => (await canvasRects(page, 'field-rect-'))[0]?.stage.height ?? 0).toBeGreaterThan(800);
    await trigger.press('Enter');
    await expect(menu.getByRole('menuitem', { name: rotate })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /Freiflächen/ })).toHaveCount(0);
    const initial = await activeCamera(page);
    await page.keyboard.press('ArrowDown');
    expect(await activeCamera(page)).toEqual(initial);
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    const zoom = toolbar.getByRole('button', { name: 'Hineinzoomen', exact: true });
    for (let step = 0; step < 7; step += 1) await zoom.tap();
    const beforeHorizontal = await activeCamera(page);
    await activateCanvasTool(page, 'Ansicht nach links verschieben', 'touch');
    await expect.poll(async () => (await activeCamera(page)).x).toBeGreaterThan(beforeHorizontal.x);
    const left = await activeCamera(page);
    await activateCanvasTool(page, 'Ansicht nach rechts verschieben', 'touch');
    await expect.poll(async () => (await activeCamera(page)).x).toBeLessThan(left.x);
    const beforeVertical = await activeCamera(page);
    await activateCanvasTool(page, 'Ansicht nach oben verschieben', 'touch');
    await expect.poll(async () => (await activeCamera(page)).y).toBeGreaterThan(beforeVertical.y);
    const up = await activeCamera(page);
    await activateCanvasTool(page, 'Ansicht nach unten verschieben', 'touch');
    await expect.poll(async () => (await activeCamera(page)).y).toBeLessThan(up.y);
    const originalWidth = (await canvasRects(page, 'field-rect-'))[0].width;
    await activateCanvasTool(page, rotate, 'touch');
    await expect.poll(async () => (await canvasRects(page, 'field-rect-'))[0].width).not.toBe(originalWidth);
    await activateCanvasTool(page, 'Ansicht um 90° nach links drehen', 'touch');
    await expect.poll(async () => (await canvasRects(page, 'field-rect-'))[0].width).toBe(originalWidth);

    await trigger.press('Enter');
    await expect(menu).toBeVisible();
    await page.setViewportSize({ width: 1600, height: 900 });
    await expect(menu).toHaveCount(0);
    await expect(individualPlants).toBeFocused();
    await expect(directRotation).toBeVisible();
    await expect(trigger).toHaveCount(0);
    await expect(individualPlants).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(async () => {
      const box = await individualPlants.boundingBox();
      return Boolean(box && box.width >= 44 && box.height >= 44);
    }).toBe(true);
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(trigger).toBeFocused();
    await expect(menu).toHaveCount(0);
    await expect(individualPlants).toHaveCount(0);
    await page.setViewportSize({ width: 1600, height: 900 });
    await individualPlants.press('Enter');
    const plants = page.getByRole('region', { name: 'Einzelpflanzen' });
    await expect(plants).toBeVisible();
    await expect(directRotation).toHaveCount(0);
    await expect(plants).toBeFocused();
    await trigger.tap();
    await expect(menu.getByRole('menuitem', { name: 'Einzelpflanzen' })).toHaveAttribute('aria-description', 'Aktiv');
    await page.keyboard.press('Escape');
    await expect(plants).toBeVisible();
    await plants.getByRole('button', { name: 'Schließen' }).tap();
    await expect(individualPlants).toBeFocused();
    await expect(directRotation).toBeVisible();
    await expect(trigger).toHaveCount(0);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('canvas-tools-wide.png'), animations: 'disabled' });

    await page.setViewportSize({ width: 1920, height: 900 });
    await individualPlants.tap();
    await expect(individualPlants).toHaveAttribute('aria-pressed', 'true');
    await expect(plants).toBeVisible();
    await individualPlants.tap();
    await expect(plants).toHaveCount(0);
    await expect(individualPlants).toHaveAttribute('aria-pressed', 'false');
    await toolbar.getByRole('button', { name: 'Vollbild öffnen' }).tap();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
    await expect(individualPlants).toHaveCount(0);
    await expect(trigger).toHaveCount(0);
    await expect(directRotation).toBeVisible();
    await expect(zoom).toBeVisible();
    await toolbar.getByRole('button', { name: 'Vollbild schließen' }).tap();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);

    await page.setViewportSize({ width: 1024, height: 768 });
    await toolbar.getByRole('button', { name: 'Vollbild öffnen' }).tap();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
    await trigger.tap();
    await expect(menu).toBeVisible();
    expect(await menu.evaluate(element => document.fullscreenElement?.contains(element))).toBe(true);
    await expect(menu.getByRole('menuitem', { name: 'Einzelpflanzen' })).toHaveCount(0);
    await expect(menu.getByRole('menuitem', { name: 'Aufgaben im Beet' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    const display = graphicDisplayButton(page);
    expect(await display.evaluate(element => document.fullscreenElement?.contains(element))).toBe(true);
    const tasks = await openGraphicLegend(page);
    await expect(tasks).toBeVisible();
    expect(await tasks.evaluate(element => document.fullscreenElement?.contains(element))).toBe(true);
    await tasks.getByRole('combobox', { name: 'Beet auswählen' }).tap();
    const beds = page.getByRole('listbox', { name: 'Beet auswählen' });
    await expect(beds).toBeVisible();
    expect(await beds.evaluate(element => document.fullscreenElement?.contains(element))).toBe(true);
    await beds.getByRole('option').first().tap();
    await page.keyboard.press('Escape');
    await expect(tasks).toHaveCount(0);
    await expect(display).toBeFocused();
    await toolbar.getByRole('button', { name: 'Vollbild schließen' }).tap();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  });
});

test.describe('location spacing in a touch-capable browser', () => {
  test.use({ hasTouch: true });

  test('edits and resets isolated location spacing with keyboard and localized touch controls', async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginWithDeterministicProject(page, request, 'graphical-spacing-settings', { demoProject: true, loginAsAdmin: true });
    const { results: locations } = await apiRequest<{ results: { id: number; name: string }[] }>(page, 'GET', '/locations/');
    const hofgarten = locations.find(location => location.name === 'Hofgarten')!;
    const layouts = `/locations/${hofgarten.id}/layouts/`;
    const originalGeometry = await apiRequest(page, 'GET', layouts);
    await page.goto('/app/fields-beds');
    await page.getByRole('button', { name: 'Grafik', exact: true }).click();
    await selectLocation(page, 'Hofgarten');
    await expect(page.getByRole('button', { name: /^Layoutprüfung/ })).toHaveCount(0);
    const trigger = page.getByRole('button', { name: 'Abstände', exact: true });
    const dialog = page.getByRole('dialog', { name: 'Abstände (Wege)' });
    const bed = dialog.getByRole('textbox', { name: 'Zwischen Beeten (cm)' });
    const parcel = dialog.getByRole('textbox', { name: 'Zwischen Parzellen (cm)' });
    const checkbox = dialog.getByRole('checkbox', { name: 'Beim Verschieben an Abständen einrasten' });
    const apply = dialog.getByRole('button', { name: 'Übernehmen' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(bed).toBeFocused();
    await expect(dialog.getByText(/die Umschalttaste gedrückt halten/)).toBeVisible();
    await expect(bed).toHaveValue('30');
    await expect(parcel).toHaveValue('75');
    await expect(checkbox).toBeChecked();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await page.keyboard.press('Enter');
    await bed.fill('-1');
    await expect(bed).toHaveAttribute('aria-invalid', 'true');
    await expect(apply).toBeDisabled();
    await bed.fill('0');
    await parcel.fill('82,5');
    await checkbox.uncheck();
    await page.route(`**/locations/${hofgarten.id}/`, route => route.fulfill({ status: 503 }), { times: 1 });
    await apply.click();
    await expect(dialog.getByRole('alert')).toHaveText('Die Abstände konnten nicht gespeichert werden.');
    await expect(parcel).toHaveValue('82,5');
    await apply.click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await page.reload();
    await trigger.click();
    await expect(bed).toHaveValue('0');
    await expect(parcel).toHaveValue('82,5');
    await expect(checkbox).not.toBeChecked();
    await dialog.getByRole('button', { name: 'Standardwerte' }).click();
    await apply.click();
    await expect(dialog).toHaveCount(0);
    expect(await apiRequest(page, 'GET', layouts)).toEqual(originalGeometry);

    await selectLocation(page, 'Acker am Bach');
    await expect(page.getByRole('button', { name: /^Layoutprüfung/ })).toHaveCount(0);
    await trigger.click();
    await expect(bed).toHaveValue('45');
    await expect(parcel).toHaveValue('100');
    await page.keyboard.press('Escape');

    // Account language is a persisted preference, so each reload renders the
    // toolbar and the popover in the selected language.
    for (const [locale, button, title, edit, shift, details, displayLabel] of [
      ['de', 'Abstände', 'Abstände (Wege)', 'Grafik bearbeiten', /Umschalttaste/, 'Details anzeigen', 'Darstellung der Grafik · Kulturen & Aufgaben'],
      ['en', 'Spacing', 'Spacing (paths)', 'Edit graphic', /Hold Shift/, 'View details', 'Graphic display · Crops & tasks'],
      ['fr', 'Espacement', 'Espacement (allées)', 'Modifier le graphique', /Maintenez Maj/, 'Voir les détails', 'Affichage du graphique · Cultures et tâches'],
      ['es', 'Distancias', 'Distancias (caminos)', 'Editar gráfico', /tecla Mayús/, 'Ver detalles', 'Vista del gráfico · Cultivos y tareas'],
      ['it', 'Distanze', 'Distanze (passaggi)', 'Modifica grafica', /premuto Maiusc/, 'Visualizza dettagli', 'Visualizzazione del grafico · Colture e attività'],
      ['pt', 'Espaçamento', 'Espaçamento (caminhos)', 'Editar gráfico', /tecla Shift/, 'Ver detalhes', 'Modo de visualização · Culturas e tarefas'],
      ['nl', 'Afstanden', 'Afstanden (paden)', 'Grafische weergave bewerken', /Houd Shift/, 'Details bekijken', 'Grafiekweergave · Gewassen en taken'],
    ] as const) {
      await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: locale });
      await page.setViewportSize({ width: 375, height: 800 });
      await page.reload();
      const spacingButton = page.getByRole('button', { name: button, exact: true });
      const editButton = page.getByRole('button', { name: edit, exact: true });
      const mode = page.getByRole('button', { name: displayLabel, exact: true });
      await expect(editButton).toBeVisible();
      await expect(editButton.locator('[data-toolbar-action-label]')).toBeHidden();
      await expect(spacingButton).toHaveCount(0);
      await expect.poll(async () => {
        const [editBox, menuBox] = await Promise.all([editButton.boundingBox(), mode.boundingBox()]);
        return editBox && menuBox && [editBox, menuBox].every(box => box.width >= 44 && box.height >= 44)
          && menuBox.x >= editBox.x + editBox.width - 1
          && menuBox.y < editBox.y + editBox.height && menuBox.x + menuBox.width <= 375;
      }).toBe(true);
      await mode.tap();
      await expect(page.getByRole('menuitemradio')).toHaveCount(4);
      await expect(page.getByRole('menuitemradio', { checked: true })).toHaveCount(1);
      const spacingItem = page.getByRole('menuitem', { name: button, exact: true });
      await expect.poll(async () => (await spacingItem.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await spacingItem.tap();
      const translated = page.getByRole('dialog', { name: title });
      await expect(translated).toBeVisible();
      await expect(translated.getByRole('textbox').first()).toBeFocused();
      await expect(translated.getByText(shift)).toHaveCount(0);
      await expect(page.getByRole('tooltip')).toHaveCount(0);
      const bounds = (await translated.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(375);
      await page.screenshot({ path: testInfo.outputPath(`location-spacing-${locale}.png`), animations: 'disabled' });
      await page.keyboard.press('Escape');
      await expect(mode).toBeFocused();
      if (locale === 'de') {
        expect(await page.evaluate(() => localStorage.getItem('ofp.shortcutHintSeen'))).toBeNull();
        await mode.press('Enter');
        await spacingItem.press('Enter');
        await expect(translated.getByText(shift)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(mode).toBeFocused();
        await page.keyboard.press('Alt+k');
        await expect(page.getByRole('textbox', { name: 'Aktionssuche' })).toBeVisible();
        await page.keyboard.press('Escape');
      }
      const locationTarget = page.locator('[data-graphical-object-target^="location:"]');
      await locationTarget.press('Enter');
      const objectPreview = page.getByTestId('graphical-object-preview');
      await expect(objectPreview.getByRole('button', { name: details })).toBeVisible();
      await page.keyboard.press('Escape');
      await locationTarget.press('Shift+F10');
      await expect(page.getByRole('menuitem', { name: details })).toBeVisible();
      await page.keyboard.press('Escape');
    }
  });
});

test('snaps real bed and parcel edges and permits closer placement with Shift or snapping off', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 950 });
  await loginWithDeterministicProject(page, request, 'graphical-spacing-drag', { loginAsAdmin: true });
  const { results: [location] } = await apiRequest<{ results: { id: number }[] }>(page, 'GET', '/locations/');
  const locationPath = `/locations/${location.id}/`;
  const layouts = `${locationPath}layouts/`;
  await apiRequest(page, 'PATCH', locationPath, { width_m: 30, length_m: 24 });
  const fields = [];
  for (const name of ['Feste Parzelle', 'Bewegliche Parzelle']) {
    fields.push(await apiRequest<{ id: number }>(page, 'POST', '/fields/', {
      name, location: location.id, width_m: 8, length_m: 10,
    }));
  }
  const beds = [];
  for (const name of ['Festes Beet', 'Bewegliches Beet']) {
    beds.push(await apiRequest<{ id: number }>(page, 'POST', '/beds/', {
      name, field: fields[0].id, width_m: 1.2, length_m: 4,
    }));
  }
  await apiRequest(page, 'PUT', layouts, {
    location_boundary: { x: 20, y: 20 },
    field_layouts: fields.map((field, index) => ({ field: field.id, x: index === 0 ? 40 : 270, y: 40 })),
    bed_layouts: beds.map((bed, index) => ({ bed: bed.id, x: index === 0 ? 12 : 70, y: 40 })),
  });

  await page.goto('/app/fields-beds');
  await page.getByRole('button', { name: 'Grafik', exact: true }).click();
  await activateCanvasTool(page, 'Ansicht um 90° nach links drehen');
  await page.getByRole('button', { name: 'Grafik bearbeiten', exact: true }).click();
  const findRect = async (id: string) => (await canvasRects(page, id)).find(rect => rect.id === id)!;
  const fieldId = `field-rect-${fields[1].id}`;
  const bedId = `bed-rect-${beds[1].id}`;
  const surfaceId = `field-usable-area-${fields[0].id}`;
  await expect.poll(async () => (await findRect(surfaceId))?.width ?? 0).toBeGreaterThan(0);
  const bedSurface = await findRect(surfaceId);
  const bedScale = bedSurface.width / 8;
  expect(bedSurface.height / 10).toBeCloseTo(bedScale);
  await expect.poll(async () => (await findRect(bedId))?.width).toBeCloseTo(1.2 * bedScale);
  const startDrag = async (id: string, targetX: number, heightFraction: number) => {
    const rect = await findRect(id);
    const { scale } = await activeCamera(page);
    const x = rect.container.x + rect.bounds.x + rect.bounds.width / 2;
    const y = rect.container.y + rect.bounds.y + rect.bounds.height * heightFraction;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + (targetX - rect.x) * scale, y, { steps: 10 });
  };
  const finishDrag = async () => {
    const saved = page.waitForResponse(response => response.url().endsWith(layouts) && response.request().method() === 'PUT');
    await page.mouse.up();
    expect((await saved).ok()).toBe(true);
  };
  const guideLabels = () => page.evaluate(() => {
    const { stages } = (window as unknown as { Konva: { stages: Konva.Stage[] } }).Konva;
    const stage = stages.find(item => item.container()?.isConnected)!;
    return stage.find('Text').filter(node => node.getAttr('data-testid') === 'graphical-snap-gap')
      .map(node => node.getAttr('text'));
  });

  const bedAnchor = await findRect(`bed-rect-${beds[0].id}`);
  const bedTarget = bedAnchor.x + bedAnchor.width + bedScale * 0.3;
  await startDrag(bedId, bedTarget + 4, 0.5);
  await expect.poll(async () => (await findRect(bedId)).x).toBeCloseTo(bedTarget);
  await expect.poll(guideLabels).toContain('30 cm');
  await finishDrag();

  const fieldTarget = 40 + 8 * 18 + 0.75 * 18;
  await startDrag(fieldId, fieldTarget + 5, 0.1);
  await expect.poll(async () => (await findRect(fieldId)).x).toBeCloseTo(fieldTarget);
  await expect.poll(guideLabels).toContain('75 cm');
  await page.screenshot({ path: testInfo.outputPath('location-spacing-gap.png'), animations: 'disabled' });
  await page.keyboard.down('Shift');
  await expect.poll(guideLabels).toEqual([]);
  await expect.poll(async () => (await findRect(fieldId)).x).toBeGreaterThan(fieldTarget + 2);
  await page.keyboard.up('Shift');
  await expect.poll(async () => (await findRect(fieldId)).x).toBeCloseTo(fieldTarget);
  await finishDrag();

  await startDrag(fieldId, fieldTarget + 8, 0.1);
  await page.keyboard.down('Shift');
  await expect.poll(async () => (await findRect(fieldId)).x).toBeGreaterThan(fieldTarget + 5);
  await finishDrag();
  await page.keyboard.up('Shift');
  const storedAfterShift = await apiRequest<{ field_layouts: { field: number; x: number }[] }>(page, 'GET', layouts);
  expect(storedAfterShift.field_layouts.find(layout => layout.field === fields[1].id)!.x).toBeGreaterThan(fieldTarget + 5);

  await page.getByRole('button', { name: 'Abstände', exact: true }).click();
  const spacing = page.getByRole('dialog', { name: 'Abstände (Wege)' });
  await spacing.getByRole('checkbox', { name: 'Beim Verschieben an Abständen einrasten' }).uncheck();
  await spacing.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(0);
  await startDrag(fieldId, 188, 0.1);
  await expect.poll(async () => (await findRect(fieldId)).x).toBeLessThan(fieldTarget - 5);
  await expect.poll(guideLabels).toEqual([]);
  await finishDrag();
  const { field_layouts: saved } = await apiRequest<{ field_layouts: { field: number; x: number }[] }>(page, 'GET', layouts);
  const moved = saved.find(layout => layout.field === fields[1].id)!;
  expect(moved.x).toBeGreaterThan(184);
  expect(moved.x).toBeLessThan(fieldTarget - 5);
});

test('retains selected location, camera and rotation through representation changes and fullscreen', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, 'graphical-workspace-camera', { demoProject: true, loginAsAdmin: true });
  await page.goto('/app/fields-beds');
  await page.getByRole('button', { name: 'Grafik', exact: true }).click();
  await selectLocation(page, 'Hofgarten');
  await expect(page.locator('.konvajs-content')).toHaveCount(1);
  await expect(page.locator('.MuiAccordion-root')).toHaveCount(0);
  await activateCanvasTool(page, 'Ansicht um 90° nach rechts drehen');
  for (let count = 0; count < 5; count++) await page.getByRole('button', { name: 'Hineinzoomen', exact: true }).click();
  await activateCanvasTool(page, 'Ansicht nach links verschieben');
  const camera = await activeCamera(page);
  await page.getByRole('combobox', { name: 'Standort', exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  expect(await activeCamera(page)).toEqual(camera);
  const field = (await canvasRects(page, 'field-rect-'))[0];
  await page.getByRole('button', { name: 'Grafik bearbeiten', exact: true }).click();
  await expect.poll(() => activeCamera(page)).toEqual(camera);
  await page.getByRole('button', { name: 'Grafik bearbeiten', exact: true }).click();
  await selectLocation(page, 'Acker am Bach');
  expect(await activeCamera(page)).not.toEqual(camera);
  await selectLocation(page, 'Hofgarten');
  expect(await activeCamera(page)).toEqual(camera);
  await page.getByRole('button', { name: 'Liste', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Standort', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Grafik bearbeiten', exact: true })).toHaveCount(0);
  let releaseLayouts: () => void = () => {};
  const resumeLayouts = new Promise<void>(resolve => { releaseLayouts = resolve; });
  let finishLayoutRequest: () => void = () => {};
  const layoutRequestFinished = new Promise<void>(resolve => { finishLayoutRequest = resolve; });
  let layoutIntercepted = false;
  const layoutUrl = /\/locations\/\d+\/layouts\/$/;
  await page.route(layoutUrl, async route => {
    layoutIntercepted = true;
    await resumeLayouts;
    await route.continue();
    finishLayoutRequest();
  });
  await page.getByRole('button', { name: 'Grafik', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Standort', exact: true })).toHaveText('Hofgarten');
  await expect.poll(() => layoutIntercepted).toBe(true);
  await expect(page.locator('main').getByRole('progressbar')).toBeVisible();
  await expect(page.locator('.konvajs-content')).toHaveCount(0);
  releaseLayouts();
  await layoutRequestFinished;
  await page.unroute(layoutUrl);
  await expect(page.locator('.konvajs-content')).toHaveCount(1);
  await expect.poll(() => activeCamera(page)).toEqual(camera);
  expect((await canvasRects(page, 'field-rect-'))[0].width).toBe(field.width);
  await page.screenshot({ path: testInfo.outputPath('workspace-restored-camera.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Vollbild öffnen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
  await expect.poll(() => activeCamera(page)).toEqual(camera);
  await page.screenshot({ path: testInfo.outputPath('workspace-fullscreen.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Vollbild schließen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await expect.poll(() => activeCamera(page)).toEqual(camera);
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Standort', exact: true })).toHaveText('Hofgarten');
  let failLayoutRead = true;
  await page.route(layoutUrl, route => failLayoutRead
    ? route.fulfill({ status: 503, json: { detail: 'Temporary test failure' } }) : route.continue());
  await page.reload();
  await expect(page.locator('main').getByRole('alert')).toHaveText(/Die Grafik konnte nicht geladen werden/);
  await expect(page.locator('.konvajs-content')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('workspace-layout-load-error.png'), animations: 'disabled' });
  failLayoutRead = false;
  await page.getByRole('button', { name: 'Erneut versuchen', exact: true }).click();
  await expect(page.locator('.konvajs-content')).toHaveCount(1);
  await expect(page.getByRole('combobox', { name: 'Standort', exact: true })).toHaveText('Hofgarten');
  await page.unroute(layoutUrl);
});

test('keeps graphical controls reachable and the canvas inside the viewport as the shared header wraps', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, 'graphical-workspace-responsive', { demoProject: true, loginAsAdmin: true });
  const { results: locations } = await apiRequest<{ results: { id: number; name: string }[] }>(page, 'GET', '/locations/');
  const hofgarten = locations.find(location => location.name === 'Hofgarten')!;
  const longLocationName = 'Hofgarten mit besonders langem Namen für die schmale Grafik-Werkzeugleiste';
  await apiRequest(page, 'PATCH', `/locations/${hofgarten.id}/`, { name: longLocationName });
  await page.goto('/app/fields-beds');
  await page.getByRole('button', { name: 'Grafik', exact: true }).click();
  await selectLocation(page, longLocationName);
  for (const viewport of [
    { width: 2240, height: 1080 }, { width: 1920, height: 1080 }, { width: 1440, height: 900 },
    { width: 1200, height: 900 },
    { width: 1199, height: 900 }, { width: 1024, height: 768 }, { width: 768, height: 1024 },
    { width: 320, height: 800 }, { width: 375, height: 800 }, { width: 800, height: 375 },
    { width: 1024, height: 500 },
  ]) {
    await page.setViewportSize(viewport);
    const edit = page.getByRole('button', { name: 'Grafik bearbeiten', exact: true });
    const spacing = page.getByRole('button', { name: 'Abstände', exact: true });
    const compact = viewport.width <= 375;
    const display = graphicDisplayButton(page);
    const location = page.getByRole('combobox', { name: /^Standort(?: · .+)?$/ });
    if (compact) {
      await expect(spacing).toHaveCount(0);
      await expect(location).toHaveAccessibleName(`Standort · ${longLocationName}`);
      await expect(location).toHaveText(longLocationName);
      await expect.poll(async () => {
        const targets = await Promise.all([
          page.getByRole('button', { name: 'Liste', exact: true }),
          page.getByRole('button', { name: 'Grafik', exact: true }), location, edit, display,
        ].map(item => item.boundingBox()));
        return targets.every(box => box && box.width >= 44 && box.height >= 44)
          && targets.every(box => box && targets[0] && Math.abs(box.y - targets[0].y) <= 1);
      }, { message: `Primary graphic controls fit at ${viewport.width}px` }).toBe(true);
    }
    if (viewport.width === 1200) {
      const label = edit.locator('[data-toolbar-action-label]');
      await expect(label).toBeHidden();
      await page.getByRole('button', { name: 'Sidebar einklappen' }).click();
      await expect(label).toBeVisible();
      await page.getByRole('button', { name: 'Sidebar ausklappen' }).click();
      await expect(label).toBeHidden();
    }
    for (const button of compact ? [edit] : [edit, spacing]) {
      const label = button.locator('[data-toolbar-action-label]');
      if (viewport.width >= 1440) await expect(label).toBeVisible();
      if (viewport.width < 1200) await expect(label).toBeHidden();
      await expect.poll(async () => {
        const target = await button.boundingBox();
        return Boolean(target && target.width >= 44 && target.height >= 44);
      }).toBe(true);
    }
    await expect.poll(async () => {
      const rects = await Promise.all([
        page.getByRole('banner').getByRole('heading', { level: 1 }),
        ...['Liste', 'Grafik', 'Grafik bearbeiten'].map(name => page.getByRole('button', { name, exact: true })),
        compact ? display : spacing,
        page.getByRole('button', { name: /^Standort hinzufügen/ }),
        location,
      ].map(locator => locator.boundingBox()));
      return rects.every(rect => rect && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= viewport.width + 1 && rect.y + rect.height <= viewport.height)
        && rects.every((rect, index) => rect && rects.slice(index + 1).every(other => other &&
          (rect.x + rect.width <= other.x + 1 || other.x + other.width <= rect.x + 1 ||
           rect.y + rect.height <= other.y + 1 || other.y + other.height <= rect.y + 1)));
    }).toBe(true);
    await expect.poll(async () => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
    await expect.poll(async () => (await canvasRects(page, 'field-rect-'))[0]?.stage.height ?? 0).toBeGreaterThan(96);
    // The mode and date controls can use the wrapped workspace row on a large desktop as well.
    if (viewport.width === 2240) await expect(page.getByTestId('topbar-workspace-row')).toHaveCount(0);
    if (viewport.width <= 1024) await expect(page.getByTestId('topbar-workspace-row')).toBeVisible();
    await page.mouse.move(1, viewport.height - 1);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    if ([1440, 768, 375].includes(viewport.width)) {
      const canvas = page.locator('.konvajs-content');
      const before = (await canvas.boundingBox())!;
      if (viewport.width === 1440) {
        await edit.hover();
        await expect(page.getByRole('tooltip')).toContainText('Im Bearbeitungsmodus lassen sich Parzellen und Beete verschieben.');
        await edit.press('Enter');
      } else {
        await edit.click();
      }
      await expect(edit).toHaveAttribute('aria-pressed', 'true');
      await expect(edit).toHaveClass(/MuiButton-contained\b/);
      await expect(edit).toHaveClass(/MuiButton-colorSuccess\b/);
      await expect(page.getByRole('tooltip')).toHaveCount(0);
      await expect(page.getByText(/^Grafikbearbeitung aktiv:/)).toHaveCount(0);
      await expect.poll(() => canvas.boundingBox()).toMatchObject({ y: before.y, height: before.height });
      await page.screenshot({ path: testInfo.outputPath(`workspace-edit-${viewport.width}.png`), animations: 'disabled' });
      await edit.click();
      await expect(edit).toHaveAttribute('aria-pressed', 'false');
    }
    await page.screenshot({ path: testInfo.outputPath(`workspace-${viewport.width}x${viewport.height}.png`), animations: 'disabled' });
    await page.getByRole('button', { name: 'Liste', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Standort', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Grafik bearbeiten', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Abstände', exact: true })).toHaveCount(0);
    await expect.poll(async () => {
      const rects = await Promise.all([
        page.getByRole('banner').getByRole('heading', { level: 1 }),
        page.getByRole('button', { name: 'Liste', exact: true }),
        page.getByRole('button', { name: 'Grafik', exact: true }),
        page.getByRole('button', { name: /^Standort hinzufügen/ }),
      ].map(locator => locator.boundingBox()));
      return rects.every(rect => rect && rect.x >= 0 && rect.x + rect.width <= viewport.width + 1 && rect.y >= 0 && rect.y + rect.height <= viewport.height)
        && rects.every((rect, index) => rect && rects.slice(index + 1).every(other => other &&
          (rect.x + rect.width <= other.x + 1 || other.x + other.width <= rect.x + 1 || rect.y + rect.height <= other.y + 1 || other.y + other.height <= rect.y + 1)));
    }).toBe(true);
    if (viewport.width === 1024) await page.screenshot({ path: testInfo.outputPath(`list-${viewport.width}x${viewport.height}.png`), animations: 'disabled' });
    await page.getByRole('button', { name: 'Grafik', exact: true }).click();
    await expect(page.locator('.konvajs-content')).toHaveCount(1);

  }
});

test('draws a sized location boundary and flags plots that cross it', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, `graphical-boundary-${testInfo.workerIndex}`, { loginAsAdmin: true });
  const location = await apiRequest<{ id: number; area_sqm: number }>(page, 'POST', '/locations/', {
    name: 'Grenzhof', length_m: 30, width_m: 12.5,
  });
  expect(location.area_sqm).toBe(375);
  const inside = await apiRequest<{ id: number }>(page, 'POST', '/fields/', {
    name: 'Innen', location: location.id, width_m: 10, length_m: 10,
  });
  const outside = await apiRequest<{ id: number }>(page, 'POST', '/fields/', {
    name: 'Zu groß', location: location.id, width_m: 20, length_m: 40,
  });
  await page.goto('/app/fields-beds');
  await page.getByRole('button', { name: 'Grafik', exact: true }).click();
  await selectLocation(page, 'Grenzhof');
  await expect.poll(async () => (await canvasRects(page, `location-boundary-${location.id}`)).length).toBe(1);
  const label = await page.evaluate(id => {
    const konva = (window as unknown as { Konva: { stages: Konva.Stage[] } }).Konva;
    const stage = konva.stages.find(item => item.container()?.isConnected)!;
    return stage.find('Text').find(node => node.getAttr('data-testid') === `location-boundary-label-${id}`)?.getAttr('text');
  }, location.id);
  expect(label).toBe('Grenzhof · 12,5 × 30 m');
  const outsideFlags = await page.evaluate(ids => {
    const konva = (window as unknown as { Konva: { stages: Konva.Stage[] } }).Konva;
    const stage = konva.stages.find(item => item.container()?.isConnected)!;
    return ids.map(id => Boolean(stage.find('Rect').find(node => node.getAttr('data-testid') === `field-rect-${id}`)?.getAttr('data-outside-location')));
  }, [inside.id, outside.id]);
  expect(outsideFlags).toEqual([false, true]);
  const hint = page.getByTestId('location-boundary-overflow-hint');
  await expect(hint).toHaveText('Mindestens eine Parzelle ragt über die Standortgrenze hinaus.');
  for (const viewport of [
    { width: 1440, height: 900 }, { width: 1024, height: 900 },
    { width: 768, height: 900 }, { width: 375, height: 800 }, { width: 800, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByRole('button', { name: 'Alles einpassen', exact: true }).click();
    const card = page.getByRole('region', { name: 'Standort: Grenzhof', exact: true });
    await card.scrollIntoViewIfNeeded();
    await expect(hint).toBeVisible();
    const [hintBox, cardBox] = [await hint.boundingBox(), await card.boundingBox()];
    expect(hintBox!.x + hintBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 1);
    const boundary = (await canvasRects(page, `location-boundary-${location.id}`))[0];
    expect(boundary.bounds.x).toBeGreaterThanOrEqual(0);
    expect(boundary.bounds.x + boundary.bounds.width).toBeLessThanOrEqual(boundary.stage.width + 1);
    await page.screenshot({ path: testInfo.outputPath(`boundary-${viewport.width}x${viewport.height}.png`), animations: 'disabled' });
  }
});

test('keeps a dragged plot inside the location boundary at any zoom and viewport', async ({ page, request }, testInfo) => {
  await loginWithDeterministicProject(page, request, `graphical-boundary-drag-${testInfo.workerIndex}`, { loginAsAdmin: true });
  const location = await apiRequest<{ id: number }>(page, 'POST', '/locations/', {
    name: 'Klemmhof', length_m: 30, width_m: 20,
  });
  const field = await apiRequest<{ id: number }>(page, 'POST', '/fields/', {
    name: 'Schiebeparzelle', location: location.id, width_m: 8, length_m: 10,
  });
  const fieldRect = async () => (await canvasRects(page, `field-rect-${field.id}`))[0];
  const boundaryRect = async () => (await canvasRects(page, `location-boundary-${location.id}`))[0];
  const expectInside = async () => {
    const [plot, site] = [(await fieldRect()).bounds, (await boundaryRect()).bounds];
    expect(plot.x).toBeGreaterThanOrEqual(site.x - 1);
    expect(plot.y).toBeGreaterThanOrEqual(site.y - 1);
    expect(plot.x + plot.width).toBeLessThanOrEqual(site.x + site.width + 1);
    expect(plot.y + plot.height).toBeLessThanOrEqual(site.y + site.height + 1);
  };
  const dragPlotBy = async (dx: number, dy: number) => {
    const plot = await fieldRect();
    const start = { x: plot.container.x + plot.bounds.x + plot.bounds.width / 2, y: plot.container.y + plot.bounds.y + plot.bounds.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + dx, start.y + dy, { steps: 12 });
    const saved = page.waitForResponse(response => response.url().endsWith(`/locations/${location.id}/layouts/`)
      && response.request().method() === 'PUT'
      && (response.request().postDataJSON() as { field_layouts: unknown[] }).field_layouts.length > 0);
    await page.mouse.up();
    await saved;
  };

  for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 800 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/app/fields-beds');
    await page.getByRole('button', { name: 'Grafik', exact: true }).click();
    await selectLocation(page, 'Klemmhof');
    await expect.poll(async () => (await canvasRects(page, `location-boundary-${location.id}`)).length).toBe(1);
    await page.getByRole('button', { name: 'Grafik bearbeiten', exact: true }).click();
    for (const zoomClicks of [0, 2]) {
      for (let i = 0; i < zoomClicks; i += 1) {
        await page.getByRole('button', { name: 'Herauszoomen', exact: true }).first().click();
      }
      const site = (await boundaryRect()).bounds;
      for (const [fx, fy] of [[1, 1], [-1, -1], [1, -1]] as const) {
        await dragPlotBy(fx * site.width, fy * site.height);
        await expectInside();
      }
    }
    await expect(page.getByTestId('location-boundary-overflow-hint')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`boundary-drag-${viewport.width}x${viewport.height}.png`), animations: 'disabled' });
    await page.waitForLoadState('networkidle');
  }

  // After a reload the boundary and the plot are still where they were left.
  const [plotBefore, siteBefore] = [(await fieldRect()), (await boundaryRect())];
  await page.goto('/app/fields-beds');
  await page.getByRole('button', { name: 'Grafik', exact: true }).click();
  await selectLocation(page, 'Klemmhof');
  await expect.poll(async () => (await canvasRects(page, `location-boundary-${location.id}`)).length).toBe(1);
  const [plotAfter, siteAfter] = [(await fieldRect()), (await boundaryRect())];
  expect([plotAfter.x - siteAfter.x, plotAfter.y - siteAfter.y]).toEqual([plotBefore.x - siteBefore.x, plotBefore.y - siteBefore.y]);
  await expectInside();
});

for (const input of ['mouse', 'touch'] as const) {
  test.describe(`plot drag with ${input}`, () => {
    test.use({ hasTouch: input === 'touch' });

    test('moves the beds before release, cancels together and persists their exact offsets', async ({ page, request }, testInfo) => {
      await page.setViewportSize(input === 'mouse' ? { width: 1440, height: 900 } : { width: 375, height: 800 });
      await loginWithDeterministicProject(page, request, `graphical-group-drag-${input}`, { loginAsAdmin: true });
      const { results: [location] } = await apiRequest<{ results: { id: number }[] }>(page, 'GET', '/locations/');
      const field = await apiRequest<{ id: number }>(page, 'POST', '/fields/', {
        name: 'Parzelle mit Beeten', location: location.id, width_m: 10, length_m: 12,
      });
      const bedIds = [];
      for (const [index, width] of [[1, 2], [2, 3]]) {
        const bed = await apiRequest<{ id: number }>(page, 'POST', '/beds/', {
          name: `Beet ${index}`, field: field.id, width_m: width, length_m: 4,
        });
        bedIds.push(bed.id);
      }
      const layoutsPath = `/locations/${location.id}/layouts/`;
      await apiRequest(page, 'PUT', layoutsPath, {
        field_layouts: [{ field: field.id, x: 1000, y: 700, version: 1 }],
        bed_layouts: bedIds.map((bed, index) => ({ bed, x: 20 + index * 55, y: 30 + index * 15, version: 1 })),
      });
      const initialLayouts = await apiRequest<{ bed_layouts: unknown[] }>(page, 'GET', layoutsPath);
      const fieldPrefix = `field-rect-${field.id}`;
      const plot = async () => (await canvasRects(page, fieldPrefix))[0];
      const bedOffsets = async () => {
        const parent = await plot();
        if (!parent) return [];
        return (await canvasRects(page, 'bed-rect-'))
          .filter(rect => bedIds.some(id => rect.id === `bed-rect-${id}`))
          .map(({ x, y, width, height }) => ({
            x: Number((x - parent.x).toFixed(8)),
            y: Number((y - parent.y).toFixed(8)),
            width,
            height,
          }));
      };

      const activate = async (name: string) => {
        const button = page.getByRole('button', { name, exact: true });
        if (input === 'touch') await button.tap();
        else await button.click();
      };
      await page.goto('/app/fields-beds');
      await activate('Grafik');
      await activate('Grafik bearbeiten');
      await expect.poll(async () => (await bedOffsets()).length).toBe(2);
      const before = await plot();
      const offsets = await bedOffsets();
      const touch = input === 'touch' ? await page.context().newCDPSession(page) : null;
      const start = {
        x: Math.round(before.container.x + before.bounds.x + before.bounds.width / 2),
        y: Math.round(before.container.y + before.bounds.y + before.bounds.height * 0.12),
      };
      const beginDrag = async () => {
        if (touch) {
          await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
        } else {
          await page.mouse.move(start.x, start.y);
          await page.mouse.down();
        }
        for (const distance of [9, 20]) {
          const point = { x: start.x + distance, y: start.y + distance };
          if (touch) {
            await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] });
          } else {
            await page.mouse.move(point.x, point.y);
          }
          await expect.poll(async () => (await plot()).x).not.toBe(before.x);
          expect(await bedOffsets()).toEqual(offsets);
        }
      };
      await beginDrag();
      if (touch) {
        await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      } else {
        await page.keyboard.press('Escape');
        await page.mouse.up();
      }
      await expect.poll(async () => (await plot()).x).toBe(before.x);
      expect(await bedOffsets()).toEqual(offsets);
      expect(await apiRequest(page, 'GET', layoutsPath)).toEqual(initialLayouts);

      await beginDrag();
      const droppedX = (await plot()).x;
      await page.screenshot({ path: testInfo.outputPath(`plot-drag-${input}.png`), animations: 'disabled' });
      const save = page.waitForResponse(response => response.url().endsWith(layoutsPath) && response.request().method() === 'PUT');
      if (touch) {
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await page.mouse.up();
      }
      const response = await save;
      expect(response.ok()).toBe(true);
      expect(response.request().postDataJSON().bed_layouts).toEqual([]);
      const saved = await apiRequest<{ bed_layouts: unknown[] }>(page, 'GET', layoutsPath);
      expect(saved.bed_layouts).toEqual(initialLayouts.bed_layouts);
      await activate('Liste');
      await activate('Grafik');
      await expect.poll(async () => (await plot())?.x ?? NaN).toBeCloseTo(droppedX, 7);
      await expect.poll(bedOffsets).toEqual(offsets);
      await page.reload();
      await expect.poll(async () => (await plot())?.x ?? NaN).toBeCloseTo(droppedX, 7);
      await expect.poll(bedOffsets).toEqual(offsets);
    });
  });
}

test('shows the only location with its name and gross area in the list and the graphic', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, `single-location-${testInfo.workerIndex}`, { loginAsAdmin: true });
  const { results: [location] } = await apiRequest<{ results: { id: number; name: string }[] }>(page, 'GET', '/locations/');
  await apiRequest(page, 'PATCH', `/locations/${location.id}/`, { length_m: 20, width_m: 12.5 });
  await apiRequest(page, 'POST', '/fields/', { name: 'Einzige Parzelle', location: location.id, width_m: 8, length_m: 15 });
  await page.goto('/app/fields-beds');
  for (const viewport of [
    { width: 1440, height: 900 }, { width: 1024, height: 900 },
    { width: 768, height: 900 }, { width: 375, height: 800 }, { width: 800, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    const locationRow = page.locator(`[role="row"][data-id="location-${location.id}"]`);
    const locationCard = page.locator(`[data-hierarchy-mobile-row-id="location-${location.id}"]`);
    const visibleLocation = locationRow.or(locationCard).filter({ visible: true }).first();
    await expect(visibleLocation).toBeVisible();
    await expect(visibleLocation).toContainText(location.name);
    await expect(page.getByText('Einzige Parzelle', { exact: true }).filter({ visible: true }).first()).toBeVisible();
    // Narrower grids virtualise columns, so the area cell is checked where all fit.
    if (viewport.width === 1440) {
      await expect(locationRow.locator('[data-field="area_sqm"]')).toContainText('250');
    }
    await page.screenshot({ path: testInfo.outputPath(`single-location-list-${viewport.width}x${viewport.height}.png`), animations: 'disabled' });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Grafik', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Standort', exact: true })).toHaveCount(0);
  await expect(page.getByText(`Standort: ${location.name}`, { exact: true }).first()).toBeVisible();
  await expect.poll(async () => (await canvasRects(page, `location-boundary-${location.id}`)).length).toBe(1);
  await expect(page.getByTestId('location-boundary-overflow-hint')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('single-location-graphic-1440.png'), animations: 'disabled' });
});

test('keeps an empty unmeasured location selectable with a single guidance message', async ({ page, request }, testInfo) => {
  await loginWithDeterministicProject(page, request, `empty-graphic-${testInfo.workerIndex}`, { loginAsAdmin: true });
  const { results: [location] } = await apiRequest<{ results: { id: number; name: string }[] }>(page, 'GET', '/locations/');
  await page.goto('/app/fields-beds');
  await expect(page.getByRole('heading', { name: 'Parzelle fehlt', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Grafik', exact: true }).click();
  await expect(page.getByText(/Dieser Standort hat noch keine Parzellen/)).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Parzelle fehlt', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: `Standort · ${location.name}`, exact: true }).click();
  const preview = page.getByTestId('graphical-object-preview');
  await expect(preview).toHaveAccessibleName(location.name);
  await expect(preview).not.toContainText('m²');
  await preview.getByRole('button', { name: 'Details anzeigen' }).click();
  await expect(page).toHaveURL(new RegExp(`/fields-beds/locations/${location.id}$`));
});

test('projects demo crops by date, preserves real task urgency and remembers the display mode', async ({ page, request }, testInfo) => {
  await page.clock.setFixedTime(new Date(2026, 4, 15, 12));
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, `graphic-display-${testInfo.workerIndex}`, { demoProject: true, demoYear: 2026, loginAsAdmin: true });
  const { results: locations } = await apiRequest<{ results: { id: number; name: string }[] }>(page, 'GET', '/locations/');
  const site = locations.find(location => location.name === 'Pachtacker Lindenhof')!;
  const { results: beds } = await apiRequest<{ results: { id: number; name: string }[] }>(page, 'GET', '/beds/');
  const id = (name: string) => beds.find(bed => bed.name === name)!.id;
  const growth = id('Wachstumsbeet');
  const harvest = id('Erntebeet');
  const mixed = id('Misch- und Folgebeet');
  const free = id('Freies Beispielbeet');
  const reads: URL[] = [];
  const writes: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname.endsWith('/planting-plans/')) reads.push(url);
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method()) &&
      /\/(planting-plans|seasons|tasks)\//.test(url.pathname)) writes.push(url.pathname);
  });
  await page.goto('/app/fields-beds');
  await page.getByRole('button', { name: 'Grafik', exact: true }).click();
  await selectLocation(page, site.name);
  const display = graphicDisplayButton(page);
  await expect(display).toHaveAccessibleName('Darstellung der Grafik · Kulturen & Aufgaben');
  const dateButton = page.getByRole('button', { name: /^Stichtag für Kulturen · / });
  await expect(dateButton).toHaveAccessibleName('Stichtag für Kulturen · Heute');

  const shape = (id: number) => page.evaluate(id => {
    const stage = (window as unknown as { Konva: { stages: Konva.Stage[] } }).Konva.stages
      .find(item => item.container()?.isConnected);
    const bed = stage?.find('Rect').find(rect => rect.getAttr('data-testid') === `bed-rect-${id}`);
    return { phase: bed?.getAttr('data-crop-phase') ?? null, urgency: bed?.getAttr('data-task-urgency') ?? null };
  }, id);
  await expect.poll(async () => (await shape(growth)).phase).toBe('growth');
  await expect.poll(async () => (await shape(harvest)).phase).toBe('harvest');
  await expect.poll(async () => (await shape(mixed)).phase).toBe('mixed');
  await expect.poll(async () => (await shape(free)).phase).toBeNull();
  const harvestUrgency = (await shape(harvest)).urgency;
  expect(harvestUrgency).toBeTruthy();

  const preview = page.getByTestId('graphical-object-preview');
  const target = (id: number) => page.locator(`[data-graphical-object-target="bed:${id}"]`);
  await target(mixed).press('Enter');
  await expect(preview).toHaveAccessibleName('Misch- und Folgebeet');
  await expect(preview).toContainText('Geplantes Wachstum');
  await expect(preview).toContainText('Geplante Ernte');
  await expect.poll(async () => {
    const [sheet, canvas] = await Promise.all([preview.boundingBox(), page.locator('.konvajs-content').boundingBox()]);
    return Boolean(sheet && canvas && sheet.y + sheet.height <= canvas.y + canvas.height + 1);
  }).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('graphic-display-combined.png') });
  await page.keyboard.press('Escape');

  await dateButton.click();
  const dateDialog = page.getByRole('dialog', { name: 'Stichtag für Kulturen' });
  await dateDialog.locator('input[type="date"]').fill('2026-04-15');
  await expect(dateDialog.getByText(/heutige Datum/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dateButton).not.toHaveAccessibleName('Stichtag für Kulturen · Heute');
  await expect.poll(async () => (await shape(mixed)).phase).toBe('growth');
  await expect.poll(async () => (await shape(harvest)).urgency).toBe(harvestUrgency);
  await dateButton.click();
  await dateDialog.getByRole('button', { name: 'Ganze Saison' }).click();
  await target(mixed).press('Enter');
  await expect(preview.getByRole('region', { name: 'Kulturen' }).getByRole('listitem')).toHaveCount(3);
  await expect(preview).not.toContainText('Geplantes Wachstum');
  await page.keyboard.press('Escape');
  expect(reads.filter(url => url.searchParams.get('location') === String(site.id))).toHaveLength(1);
  expect(reads.filter(url => url.searchParams.has('bed'))).toHaveLength(0);

  await page.setViewportSize({ width: 375, height: 800 });
  await selectGraphicDisplay(page, 'Kulturen');
  await expect(dateButton).toHaveAccessibleName('Stichtag für Kulturen · Ganze Saison');
  expect((await shape(harvest)).urgency).toBeNull();
  await selectGraphicDisplay(page, 'Aufgaben');
  await expect(dateButton).toHaveCount(0);
  expect((await shape(harvest)).phase).toBeNull();
  await selectGraphicDisplay(page, 'Kulturen & Aufgaben');
  await expect(dateButton).toHaveAccessibleName('Stichtag für Kulturen · Ganze Saison');
  await page.screenshot({ path: testInfo.outputPath('graphic-display-combined-375.png') });
  await selectGraphicDisplay(page, 'Anbauflächen');
  await page.reload();
  await expect(display).toHaveAccessibleName('Darstellung der Grafik · Anbauflächen');
  await expect(dateButton).toHaveCount(0);
  await target(harvest).press('Enter');
  await expect(preview).toContainText('Geplante Ernte');
  await expect(preview.getByText(/offene Aufgaben?/)).toBeVisible();
  expect(writes).toEqual([]);
  await page.keyboard.press('Escape');
});
