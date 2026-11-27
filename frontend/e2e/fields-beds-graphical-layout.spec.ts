import { expect, test, type Page } from '@playwright/test';
import type Konva from 'konva';
import { activateCanvasTool, apiRequest, canvasInteractionPoint, expectGraphicDisplayMode, graphicDisplayButton, graphicLegendButton, graphicWorkspaceMenu, loginWithDeterministicProject, openGraphicLegend, selectGraphicDisplay, toggleGraphicEdit } from './utils';

// Layout failure/delay fixtures must intercept the browser's requests directly.
test.use({ serviceWorkers: 'block' });

async function canvasRects(page: Page, prefix: string) {
  return page.evaluate(prefix => {
    const konva = (window as unknown as { Konva?: { stages: Konva.Stage[] } }).Konva;
    return (konva?.stages ?? []).filter(stage => stage.container()?.isConnected)
      .flatMap(stage => stage.find('Rect, Text').map(node => ({
        id: String(node.getAttr('data-testid') ?? ''),
        ...node.getAbsolutePosition(stage), width: node.width(), height: node.height(),
        rotation: node.rotation(), bounds: node.getClientRect(), issue: node.getAttr('data-geometry-issue') ?? null,
        annotation: node.getAttr('data-area-annotation-placement') ?? null,
        text: node.getClassName() === 'Text' ? node.getAttr('text') as string : null,
        screenSize: { width: node.width() * stage.scaleX(), height: node.height() * stage.scaleY() },
        stage: { width: stage.width(), height: stage.height() },
        container: { x: stage.container().getBoundingClientRect().x, y: stage.container().getBoundingClientRect().y },
      }))).filter(rect => rect.id.startsWith(prefix));
  }, prefix);
}

async function waitForParcelDragTarget(page: Page, fieldId: number) {
  await expect.poll(() => page.evaluate(fieldId => {
    const stage = (window as unknown as { Konva?: { stages: Konva.Stage[] } }).Konva?.stages
      .find(item => item.container()?.isConnected);
    return stage?.find<Konva.Group>('Group').find(group => group.getAttr('data-testid') === `field-group-${fieldId}`)
      ?.draggable() ?? false;
  }, fieldId)).toBe(true);
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
  for (const [index, width, length] of [[1, 10, 20], [2, 24, 6], [3, 8, 8]]) {
    const field = await apiRequest<{ id: number }>(page, 'POST', '/fields/', {
      name: `Parzelle ${index}`, location: location.id, width_m: width, length_m: length,
    });
    fieldIds.push(field.id);
    const bed = await apiRequest<{ id: number }>(page, 'POST', '/beds/', {
      name: `Beet ${index} mit einem langen lesbaren Namen`, field: field.id,
      width_m: 2,
      length_m: index === 1 ? 15 : 4,
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
    expect(fields[1].width / fields[1].height).toBeCloseTo(1 / 4);
    for (const [index, field] of fields.entries()) {
      for (const other of fields.slice(index + 1)) {
        expect(field.x + field.width <= other.x || other.x + other.width <= field.x ||
          field.y + field.height <= other.y || other.y + other.height <= field.y).toBe(true);
      }
    }
    const beds = (await canvasRects(page, 'bed-rect-')).filter(bed => bedIds.includes(Number(bed.id.replace('bed-rect-', ''))));
    expect(beds[1].screenSize).toEqual(beds[2].screenSize);
    expect(beds[1].screenSize.width / fields[1].screenSize.width).toBeCloseTo(4 / 6);
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

test('keeps growing-area annotations clear of dense beds and preserves access to suppressed names', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1060, height: 900 });
  await loginWithDeterministicProject(page, request, `annotation-layout-${testInfo.workerIndex}`, {
    demoProject: true, demoYear: 2026, loginAsAdmin: true,
  });
  const location = await apiRequest<{ id: number }>(page, 'POST', '/locations/', {
    name: 'Beschriftungsfläche', width_m: 48, length_m: 24,
  });
  const open = await apiRequest<{ id: number }>(page, 'POST', '/fields/', {
    name: 'Offene Parzelle', location: location.id, width_m: 12, length_m: 10,
  });
  const packed = await apiRequest<{ id: number }>(page, 'POST', '/fields/', {
    name: 'Volle Parzelle', location: location.id, width_m: 8, length_m: 8,
  });
  const longName = 'W'.repeat(135);
  const crowded = await apiRequest<{ id: number }>(page, 'POST', '/fields/', {
    name: longName, location: location.id, width_m: 7, length_m: 8,
  });
  const bed = await apiRequest<{ id: number }>(page, 'POST', '/beds/', {
    name: 'Flächenfüllendes Beet', field: packed.id, width_m: 8, length_m: 8,
  });
  const layoutsPath = `/locations/${location.id}/layouts/`;
  await apiRequest(page, 'PUT', layoutsPath, {
    location_boundary: { x: 0, y: 0 },
    field_layouts: [
      { field: open.id, x: 36, y: 36 }, { field: packed.id, x: 306, y: 108 },
      { field: crowded.id, x: 468, y: 108 },
    ],
    bed_layouts: [{ bed: bed.id, x: 0, y: 0 }],
  });
  const saved = await apiRequest(page, 'GET', layoutsPath);
  await page.goto('/app/fields-beds');
  await page.getByRole('button', { name: 'Grafik', exact: true }).click();
  await selectLocation(page, 'Beschriftungsfläche');
  const card = page.getByRole('region', { name: 'Standort: Beschriftungsfläche' });
  await card.scrollIntoViewIfNeeded();
  const label = async (fieldId: number) => (await canvasRects(page, `field-label-${fieldId}`))[0];
  await expect.poll(async () => (await label(open.id))?.annotation).toBe('inside');
  await expect.poll(async () => (await label(packed.id))?.annotation).toBe('outside');
  await expect.poll(async () => (await canvasRects(page, `location-boundary-label-${location.id}`))[0]?.text)
    .toBe('Beschriftungsfläche · 48 × 24 m');
  const outside = await label(packed.id);
  const bedShape = (await canvasRects(page, `bed-rect-${bed.id}`))[0];
  const { x, y, width, height } = outside.bounds;
  expect(x + width <= bedShape.bounds.x || x >= bedShape.bounds.x + bedShape.bounds.width ||
    y + height <= bedShape.bounds.y || y >= bedShape.bounds.y + bedShape.bounds.height).toBe(true);
  const leaderListening = await page.evaluate(fieldId => {
    const konva = (window as unknown as { Konva: { stages: Konva.Stage[] } }).Konva;
    const stage = konva.stages.find(item => item.container()?.isConnected)!;
    return stage.find('Line').find(node => node.getAttr('data-testid') === `field-label-${fieldId}-leader`)?.isListening();
  }, packed.id);
  expect(leaderListening).toBe(false);
  expect(await label(crowded.id)).toBeUndefined();
  await card.screenshot({ path: testInfo.outputPath('growing-area-annotations-desktop.png') });
  const point = shapePoint((await canvasRects(page, `field-rect-${crowded.id}`))[0]);
  await page.mouse.move(point.x, point.y);
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toContainText(longName);
  expect(await tooltip.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.mouse.click(point.x, point.y);
  const preview = page.getByTestId('graphical-object-preview');
  await expect(preview).toHaveAccessibleName(longName);
  await page.keyboard.press('Escape');
  const target = card.locator(`[data-graphical-object-target="field:${crowded.id}"]`);
  await target.press('Enter');
  await expect(preview).toHaveAccessibleName(longName);
  await page.keyboard.press('Escape');
  await expect(target).toBeFocused();
  expect(await target.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  const openPlot = async () => (await canvasRects(page, `field-rect-${open.id}`))[0];
  await toggleGraphicEdit(page);
  await waitForParcelDragTarget(page, open.id);
  const beforeDrag = await openPlot();
  const labelBeforeDrag = await label(open.id);
  const grab = shapePoint(labelBeforeDrag);
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 36, grab.y + 18, { steps: 4 });
  await expect.poll(async () => (await openPlot()).bounds.x).toBeGreaterThan(beforeDrag.bounds.x + 10);
  await expect.poll(async () => (await label(open.id)).bounds.x).toBeGreaterThan(labelBeforeDrag.bounds.x + 10);
  expect((await label(open.id)).bounds.height).toBeCloseTo(labelBeforeDrag.bounds.height);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect.poll(async () => (await label(open.id)).bounds.x).toBeCloseTo(labelBeforeDrag.bounds.x);
  await toggleGraphicEdit(page);
  const initial = await label(open.id);
  await activateCanvasTool(page, 'Hineinzoomen');
  await expect.poll(async () => (await activeCamera(page)).scale).toBeGreaterThan(bedShape.screenSize.width / bedShape.width);
  expect((await label(open.id))?.bounds.height).toBeCloseTo(initial.bounds.height);
  await activateCanvasTool(page, 'Ansicht um 90° nach rechts drehen');
  await expect.poll(async () => (await label(open.id))?.rotation).toBe(0);
  expect(await apiRequest(page, 'GET', layoutsPath)).toEqual(saved);
  await selectLocation(page, 'Hofgarten');
  await expect.poll(async () => (await canvasRects(page, 'field-label-')).length).toBeGreaterThan(0);
  await selectGraphicDisplay(page, 'Kulturen & Aufgaben');
  await expect.poll(async () => (await canvasRects(page, 'field-label-')).length).toBeGreaterThan(0);
  await page.getByRole('region', { name: 'Standort: Hofgarten' })
    .screenshot({ path: testInfo.outputPath('growing-area-annotations-hofgarten.png') });
});

test('selects the deepest object, keeps the native blank-canvas menu and supports keyboard details', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1050, height: 900 });
  await loginWithDeterministicProject(page, request, `graphic-selection-${testInfo.workerIndex}`, { loginAsAdmin: true });
  const { location, parcel, bed, card } = await selectionFixture(page);
  const preview = page.getByTestId('graphical-object-preview');
  const hint = card.getByText(/Rechtsklick auf einen Standort/);
  await expect(hint).toBeVisible();

  const at = async (id: string, x?: number, y?: number) => shapePoint((await canvasRects(page, id))[0], x, y);
  const bedPoint = await canvasInteractionPoint(page, `bed-rect-${bed.id}`);
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

  await page.mouse.move(free.x, free.y);
  await expect(page.getByRole('tooltip')).toContainText('24 × 28 m');
  await page.mouse.click(free.x, free.y, { button: 'right' });
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
  await selectGraphicDisplay(page, 'Aufgaben');
  await activateCanvasTool(page, 'Ansicht um 90° nach rechts drehen');
  await activateCanvasTool(page, 'Ansicht nach links verschieben');
  const cameraBeforeDetails = await activeCamera(page);
  const parcelGeometry = (await canvasRects(page, `field-rect-${parcel.id}`))[0];
  await card.getByRole('button', { name: 'Vollbild öffnen' }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
  await locationTarget.press('Shift+F10');
  const fullscreenMenu = page.getByRole('menu', { name: 'Lernhof' });
  await expect(fullscreenMenu).toBeVisible();
  expect(await fullscreenMenu.evaluate(node => document.fullscreenElement?.contains(node))).toBe(true);
  await fullscreenMenu.getByRole('menuitem', { name: 'Details anzeigen' }).click();
  await expect(page).toHaveURL(new RegExp(`/fields-beds/locations/${location.id}$`));
  await expect(page.getByTestId('detail-remaining-area')).toContainText('552 m²');
  await expect(page.getByRole('img', { name: /552 m²/ })).toBeVisible();
  const details = page.getByTestId('growing-area-detail');
  const back = details.getByRole('button', { name: 'Zurück zur Grafik', exact: true });
  const heading = details.getByRole('heading', { level: 1 });
  await expect(back).toBeVisible();
  expect((await back.boundingBox())!.y).toBeLessThan((await heading.boundingBox())!.y);
  await details.getByTestId('detail-section-children').getByRole('link', { name: 'Lernparzelle' }).click();
  await expect(page).toHaveURL(new RegExp(`/fields-beds/fields/${parcel.id}$`));
  await expect(back).toBeVisible();
  await expect(page.getByTestId('detail-covered-area')).toContainText('8 m²');
  await details.getByTestId('detail-section-children').getByRole('link', { name: 'Lernbeet' }).click();
  await expect(page).toHaveURL(new RegExp(`/fields-beds/beds/${bed.id}$`));
  await expect(back).toBeVisible();
  await page.goBack();
  await expect(heading).toHaveText('Lernparzelle');
  await back.click();
  await expect(page).toHaveURL(/fields-beds$/);
  await expect(card).toBeVisible();
  await expectGraphicDisplayMode(page, 'Aufgaben');
  await expect.poll(() => activeCamera(page)).toEqual(cameraBeforeDetails);
  expect((await canvasRects(page, `field-rect-${parcel.id}`))[0].width).toBe(parcelGeometry.width);
});

test.describe('graphical object touch gestures', () => {
  test.use({ hasTouch: true, viewport: { width: 375, height: 800 } });

  test('separates taps, long presses and cancelled presses, with a persistent touch hint', async ({ page, request }, testInfo) => {
    await loginWithDeterministicProject(page, request, `graphic-touch-${testInfo.workerIndex}`, { loginAsAdmin: true });
    const { parcel, bed, card } = await selectionFixture(page);
    const touch = await page.context().newCDPSession(page);
    const preview = page.getByTestId('graphical-object-preview');
    const hint = card.getByText(/Standort, Parzelle oder Beet gedrückt halten/);
    await expect(hint).toBeVisible();
    await expect(card.getByText(/Rechtsklick auf einen Standort/)).toHaveCount(0);
    const points = [
      { id: `bed-rect-${bed.id}`, name: 'Lernbeet' },
      { id: `field-rect-${parcel.id}`, name: 'Lernparzelle', x: 0.9, y: 0.17 },
      { id: 'graphical-free-area-site', name: 'Lernhof' },
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
    const individualPlants = toolbar.getByRole('button', { name: /^(Einzelpflanzen|Einzelpflanzen hinzufügen)$/ });
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
    await expect(menu.getByRole('menuitem', { name: /^(Einzelpflanzen|Einzelpflanzen hinzufügen)$/ })).toHaveCount(0);
    await expect(menu.getByRole('menuitem', { name: 'Aufgaben im Beet' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    const display = graphicDisplayButton(page);
    expect(await display.evaluate(element => document.fullscreenElement?.contains(element))).toBe(true);
    const tasks = await openGraphicLegend(page);
    await expect(tasks).toBeVisible();
    expect(await tasks.evaluate(element => document.fullscreenElement?.contains(element))).toBe(true);
    await expect(tasks.getByRole('combobox')).toHaveCount(0);
    await expect(tasks.getByRole('button')).toHaveCount(0);
    await expect(tasks.getByText('Offen ohne Termin', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tasks).toHaveCount(0);
    await expect(graphicLegendButton(page)).toBeFocused();
    await toolbar.getByRole('button', { name: 'Vollbild schließen' }).tap();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
    const layoutBefore = (await canvasRects(page, 'field-rect-')).map(rect => [rect.id, rect.x, rect.y]);
    await toggleGraphicEdit(page, 'touch');
    const editLegend = await openGraphicLegend(page, 'touch');
    await expect(editLegend.getByText('Anbauflächen', { exact: true })).toBeVisible();
    await expect(editLegend.getByText('Offen ohne Termin')).toHaveCount(0);
    await page.keyboard.press('Escape');
    expect((await canvasRects(page, 'field-rect-')).map(rect => [rect.id, rect.x, rect.y])).toEqual(layoutBefore);
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
    const trigger = page.getByRole('button', { name: 'Grafikeinstellungen', exact: true });
    const dialog = page.getByRole('dialog', { name: 'Grafikeinstellungen' });
    const bed = dialog.getByRole('textbox', { name: 'Zwischen Beeten (cm)' });
    const parcel = dialog.getByRole('textbox', { name: 'Zwischen Parzellen (cm)' });
    const checkbox = dialog.getByRole('checkbox', { name: 'Pflanzen und Flächen an Abständen einrasten' });
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
    await bed.fill('44');
    await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(bed).toHaveValue('30');
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
    const scaleNames = { de: 'Maßstab', en: 'Metric scale', fr: 'Échelle métrique', es: 'Escala métrica',
      it: 'Scala metrica', pt: 'Escala métrica', nl: 'Metrische schaal' };
    for (const [locale, button, layerLabel, edit, shift, details, workspaceLabel, modeLabel] of [
      ['de', 'Grafikeinstellungen', 'Ebenen', 'Grafik bearbeiten', /Umschalttaste/, 'Details anzeigen', 'Arbeitsbereichsmenü', 'Kulturen & Aufgaben'],
      ['en', 'Graphic settings', 'Layers', 'Edit graphic', /Hold Shift/, 'View details', 'Workspace menu', 'Crops & tasks'],
      ['fr', 'Paramètres du graphique', 'Couches', 'Modifier le graphique', /Maintenez Maj/, 'Voir les détails', 'Menu de l’espace de travail', 'Cultures et tâches'],
      ['es', 'Ajustes del gráfico', 'Capas', 'Editar gráfico', /tecla Mayús/, 'Ver detalles', 'Menú del área de trabajo', 'Cultivos y tareas'],
      ['it', 'Impostazioni grafiche', 'Livelli', 'Modifica grafica', /premuto Maiusc/, 'Visualizza dettagli', 'Menu dell’area di lavoro', 'Colture e attività'],
      ['pt', 'Definições do gráfico', 'Camadas', 'Editar gráfico', /tecla Shift/, 'Ver detalhes', 'Menu da área de trabalho', 'Culturas e tarefas'],
      ['nl', 'Grafiekinstellingen', 'Lagen', 'Grafische weergave bewerken', /Houd Shift/, 'Details bekijken', 'Werkruimtemenu', 'Gewassen en taken'],
    ] as const) {
      await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: locale });
      await page.setViewportSize({ width: 375, height: 800 });
      await page.reload();
      const spacingButton = page.getByRole('button', { name: button, exact: true });
      const editButton = page.getByRole('button', { name: edit, exact: true });
      const workspace = page.getByRole('button', { name: workspaceLabel, exact: true });
      const layers = graphicDisplayButton(page);
      const date = page.getByTestId('graphical-crop-date');
      await expect(editButton).toHaveCount(0);
      await expect(layers).toHaveAccessibleName(`${layerLabel} · ${modeLabel}`);
      await expect(page.getByTestId('graphical-scale-indicator').getByRole('img'))
        .toHaveAccessibleName(new RegExp(`^${scaleNames[locale]} · `));
      await expect(spacingButton).toHaveCount(0);
      await expect.poll(async () => {
        const [dateBox, menuBox] = await Promise.all([date.boundingBox(), workspace.boundingBox()]);
        return dateBox && menuBox && [dateBox, menuBox].every(box => box.width >= 44 && box.height >= 44)
          && dateBox.x >= menuBox.x + menuBox.width - 1
          && Math.abs(menuBox.y - dateBox.y) <= 1 && dateBox.x + dateBox.width <= 375;
      }).toBe(true);
      await layers.tap();
      await expect(page.getByRole('menuitemradio')).toHaveCount(4);
      await expect(page.getByRole('menuitemradio', { name: modeLabel, exact: true, checked: true })).toHaveCount(1);
      await page.keyboard.press('Escape');
      await expect(layers).toBeFocused();
      await workspace.tap();
      await expect(page.getByRole('menuitemcheckbox', { name: edit, exact: true })).toHaveAttribute('aria-checked', 'false');
      await expect(page.getByRole('menuitemradio')).toHaveCount(0);
      await expect(page.getByRole('menuitem')).toHaveCount(1);
      const menuBox = (await page.getByRole('menu').boundingBox())!;
      expect(menuBox.x).toBeGreaterThanOrEqual(0);
      expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(375);
      const spacingItem = page.getByRole('menuitem', { name: button, exact: true });
      await expect.poll(async () => (await spacingItem.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await spacingItem.tap();
      const translated = page.getByRole('dialog', { name: button, exact: true });
      await expect(translated).toBeVisible();
      await expect(translated.getByRole('textbox').first()).toBeFocused();
      await expect(translated.getByText(shift)).toHaveCount(0);
      await expect(page.getByRole('tooltip')).toHaveCount(0);
      const bounds = (await translated.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(375);
      await page.screenshot({ path: testInfo.outputPath(`location-spacing-${locale}.png`), animations: 'disabled' });
      await page.keyboard.press('Escape');
      await expect(workspace).toBeFocused();
      if (locale === 'de') {
        expect(await page.evaluate(() => localStorage.getItem('ofp.shortcutHintSeen'))).toBeNull();
        await workspace.press('Enter');
        await spacingItem.press('Enter');
        await expect(translated.getByText(shift)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(workspace).toBeFocused();
        await page.keyboard.press('Alt+k');
        await expect(page.getByRole('textbox', { name: 'Aktionssuche' })).toBeVisible();
        await page.keyboard.press('Escape');
      }
      const locationTarget = page.locator('[data-graphical-object-target^="location:"]');
      await locationTarget.press('Enter');
      const objectPreview = page.getByTestId('graphical-object-preview');
      await expect(objectPreview).toHaveAccessibleName('Acker am Bach');
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

  await page.getByRole('button', { name: 'Grafikeinstellungen', exact: true }).click();
  const spacing = page.getByRole('dialog', { name: 'Grafikeinstellungen' });
  await spacing.getByRole('checkbox', { name: 'Pflanzen und Flächen an Abständen einrasten' }).uncheck();
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
  const layers = graphicDisplayButton(page);
  const canvas = page.locator('.konvajs-content');
  const layersInset = async () => {
    const [controlBox, canvasBox] = await Promise.all([layers.boundingBox(), canvas.boundingBox()]);
    if (!controlBox || !canvasBox) return null;
    return {
      top: controlBox.y - canvasBox.y,
      right: canvasBox.x + canvasBox.width - controlBox.x - controlBox.width,
    };
  };
  const initialInset = await layersInset();
  expect(initialInset).not.toBeNull();
  await activateCanvasTool(page, 'Ansicht um 90° nach rechts drehen');
  for (let count = 0; count < 5; count++) await page.getByRole('button', { name: 'Hineinzoomen', exact: true }).click();
  await activateCanvasTool(page, 'Ansicht nach links verschieben');
  await expect.poll(layersInset).toEqual(initialInset);
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
  const contextHint = page.getByRole('note').filter({ hasText: /Kontextmenü öffnen|öffnet das Kontextmenü/ });
  await expect(contextHint).toBeVisible();
  for (const viewport of [
    { width: 2240, height: 1080 }, { width: 1920, height: 1080 }, { width: 1440, height: 900 },
    { width: 1200, height: 900 },
    { width: 1199, height: 900 }, { width: 1024, height: 768 }, { width: 768, height: 1024 },
    { width: 320, height: 800 }, { width: 375, height: 800 }, { width: 800, height: 375 },
    { width: 1024, height: 500 },
  ]) {
    await page.setViewportSize(viewport);
    const edit = page.getByRole('button', { name: 'Grafik bearbeiten', exact: true });
    const spacing = page.getByRole('button', { name: 'Grafikeinstellungen', exact: true });
    const compact = viewport.width < 600 || viewport.height < 500;
    const display = graphicDisplayButton(page);
    const workspace = graphicWorkspaceMenu(page);
    const date = page.getByTestId('graphical-crop-date');
    const location = page.getByRole('combobox', { name: /^Standort(?: · .+)?$/ });
    await expect(page.getByTestId('topbar-workspace-controls').getByTestId('graphical-display-mode')).toHaveCount(0);
    await expect(display).toHaveText('');
    await expect.poll(async () => {
      const [layers, tools, canvas] = await Promise.all([display.boundingBox(),
        page.getByTestId('graphical-canvas-tools').boundingBox(), page.locator('.konvajs-content').boundingBox()]);
      return Boolean(layers && tools && canvas && layers.width >= 44 && layers.height >= 44
        && layers.y >= canvas.y - 1 && layers.y + layers.height <= tools.y
        && layers.x + layers.width <= canvas.x + canvas.width + 1);
    }).toBe(true);
    if (compact) {
      await expect(edit).toHaveCount(0);
      await expect(spacing).toHaveCount(0);
      await workspace.press('Enter');
      await expect(page.getByRole('menuitemradio')).toHaveCount(0);
      await page.getByRole('menuitem', { name: 'Grafikeinstellungen', exact: true }).press('Enter');
      await expect(page.getByRole('dialog', { name: 'Grafikeinstellungen' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(workspace).toBeFocused();
      await expect(location).toHaveAccessibleName(`Standort · ${longLocationName}`);
      await expect(location).toHaveText(longLocationName);
      await expect.poll(async () => {
        const targets = await Promise.all([
          page.getByRole('button', { name: 'Liste', exact: true }),
          page.getByRole('button', { name: 'Grafik', exact: true }), location, date, workspace,
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
    if (!compact) {
      await expect(spacing.locator('[data-toolbar-action-label]')).toBeHidden();
      const editLabel = edit.locator('[data-toolbar-action-label]');
      if (viewport.width >= 1440) await expect(editLabel).toBeVisible();
      if (viewport.width < 1200) await expect(editLabel).toBeHidden();
    }
    for (const button of compact ? [workspace] : [edit, spacing]) {
      await expect.poll(async () => {
        const target = await button.boundingBox();
        return Boolean(target && target.width >= 44 && target.height >= 44);
      }).toBe(true);
    }
    await expect.poll(async () => {
      const rects = await Promise.all([
        page.getByRole('banner').getByRole('heading', { level: 1 }),
        ...['Liste', 'Grafik'].map(name => page.getByRole('button', { name, exact: true })),
        compact ? date : edit,
        compact ? workspace : spacing,
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
    if (viewport.width === 2240) {
      await expect(page.getByTestId('topbar-workspace-row')).toHaveCount(0);
    }
    await page.mouse.move(1, viewport.height - 1);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    if ([1440, 768, 375].includes(viewport.width)) {
      const canvas = page.locator('.konvajs-content');
      await expect(canvas).toBeVisible();
      const before = await canvas.boundingBox();
      expect(before).not.toBeNull();
      if (viewport.width === 1440) {
        await edit.hover();
        await expect(page.getByRole('tooltip')).toContainText('Im Bearbeitungsmodus lassen sich Parzellen und Beete verschieben.');
        await edit.press('Enter');
      } else {
        await toggleGraphicEdit(page);
      }
      const editState = compact ? workspace : edit;
      if (compact) await expect(workspace).toHaveAccessibleDescription(/Bearbeitungsmodus/);
      else await expect(edit).toHaveAttribute('aria-pressed', 'true');
      await expect(editState).toHaveClass(/MuiButton-contained\b/);
      await expect(editState).toHaveClass(/MuiButton-colorSuccess\b/);
      await expect(page.getByRole('tooltip')).toHaveCount(0);
      await expect(page.getByText(/^Grafikbearbeitung aktiv:/)).toHaveCount(0);
      await expect.poll(() => canvas.boundingBox()).toMatchObject({ y: before?.y, height: before?.height });
      await expect(display).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`workspace-edit-${viewport.width}.png`), animations: 'disabled' });
      await toggleGraphicEdit(page);
      if (compact) await expect(workspace).not.toHaveAccessibleDescription(/Bearbeitungsmodus/);
      else await expect(edit).toHaveAttribute('aria-pressed', 'false');
    }
    await page.screenshot({ path: testInfo.outputPath(`workspace-${viewport.width}x${viewport.height}.png`), animations: 'disabled' });
    await page.getByRole('button', { name: 'Liste', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Standort', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Grafik bearbeiten', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Grafikeinstellungen', exact: true })).toHaveCount(0);
    await expect(display).toHaveCount(0);
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
  await page.setViewportSize({ width: 1440, height: 900 });
  await contextHint.getByRole('button', { name: 'Schließen' }).click();
  await expect(contextHint).toHaveCount(0);
  for (const width of [320, 1200, 768, 1440, 375]) {
    await page.setViewportSize({ width, height: 800 });
  }
  await selectGraphicDisplay(page, 'Aufgaben');
  await expect(page.getByRole('button', { name: /^Stichtag für Kulturen · / })).toHaveCount(0);
  await selectGraphicDisplay(page, 'Kulturen & Aufgaben');
  await expect(page.getByRole('button', { name: /^Stichtag für Kulturen · / })).toBeVisible();
  await expect(contextHint).toHaveCount(0);
  await expect.poll(async () => {
    const canvas = (await canvasRects(page, 'field-rect-'))[0];
    return Boolean(canvas && canvas.stage.width <= 375 && canvas.container.y + canvas.stage.height <= 801);
  }).toBe(true);
});

test('keeps crop dates directly reachable and shows the selected year on a compact workspace', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.clock.setFixedTime(new Date(2026, 10, 14, 12));
  await loginWithDeterministicProject(page, request, 'graphical-cross-year-date', { loginAsAdmin: true });
  await apiRequest(page, 'POST', '/seasons/', { start_date: '2026-09-01', end_date: '2027-03-31' });
  await selectionFixture(page);
  const date = page.getByTestId('graphical-crop-date');
  const dateDialog = page.getByRole('dialog', { name: 'Stichtag für Kulturen' });
  for (const [iso, shortened, fullYear] of [
    ['2026-11-15', '15.11.26', /15\.11\.2026/],
    ['2027-01-01', '01.01.27', /0?1\.0?1\.2027/],
  ] as const) {
    await date.click();
    await dateDialog.getByRole('button', { name: 'Stichtag', exact: true }).click();
    await dateDialog.locator('input[type="date"]').fill(iso);
    await page.keyboard.press('Escape');
    await expect(date).toHaveAccessibleName(fullYear);
    await expect(date.getByText(shortened, { exact: true })).toBeVisible();
  }
  const workspace = page.getByTestId('topbar-workspace-controls');
  const controls = [workspace.getByRole('button', { name: 'Liste', exact: true }),
    workspace.getByRole('button', { name: 'Grafik', exact: true }), workspace.getByRole('combobox'),
    date, graphicWorkspaceMenu(page)];
  await expect.poll(async () => {
    const targets = await Promise.all(controls.map(control => control.boundingBox()));
    return targets.filter(box => !box || box.height < 44 || box.width < 44
      || box.x + box.width > 375 || Math.abs(box.y - targets[0]!.y) > 1);
  }).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('graphical-cross-year-375.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 320, height: 800 });
  await expect(date).toHaveAccessibleName(/0?1\.0?1\.2027/);
  await expect(date.getByText('01.01.27', { exact: true })).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(date).toHaveText(/0?1\.0?1\.2027/);
  await expect(page.getByRole('button', { name: 'Grafik bearbeiten', exact: true })).toBeVisible();
  await date.click();
  await dateDialog.getByRole('button', { name: 'Ganze Saison' }).click();
  await expect(date).toHaveAccessibleName('Stichtag für Kulturen · Ganze Saison');
});

test.describe('crop time on a touch-capable phone', () => {
  test.use({ hasTouch: true });

  test('synchronizes the season slider and calendar through a leap day and in fullscreen', async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.clock.setFixedTime(new Date(2024, 1, 28, 12));
    await loginWithDeterministicProject(page, request, 'graphical-leap-timeline', { loginAsAdmin: true });
    await apiRequest(page, 'POST', '/seasons/', {
      start_date: '2023-12-31', end_date: '2024-03-31', custom_label: 'Schaltjahrsaison',
    });
    await apiRequest(page, 'POST', '/seasons/', {
      start_date: '2024-04-01', end_date: '2024-12-31', custom_label: 'Folgesaison',
    });
    await selectionFixture(page);
    const switcher = page.getByRole('button', { name: 'Aktive Saison wechseln' });
    const switchSeason = async (label: string) => {
      await switcher.tap();
      await page.getByRole('menuitem').filter({ hasText: label }).tap();
      await expect(switcher).toContainText(label);
    };
    await switchSeason('Schaltjahrsaison');

    const trigger = page.getByTestId('graphical-crop-date');
    const dialog = page.getByRole('dialog', { name: 'Stichtag für Kulturen' });
    const picker = dialog.getByLabel('Stichtag', { exact: true });
    const slider = dialog.getByRole('slider', { name: 'Saisonzeitachse' });
    await trigger.tap();
    await expect(dialog.getByRole('button', { name: 'Heute' })).toHaveAttribute('aria-pressed', 'true');
    await dialog.getByRole('button', { name: 'Stichtag', exact: true }).tap();
    await expect(picker).toHaveValue('2024-02-28');
    await expect(slider).toHaveAttribute('aria-valuemax', '91');
    await slider.press('ArrowRight');
    await expect(picker).toHaveValue('2024-02-29');
    await expect(slider).toHaveAttribute('aria-valuetext', /29\.0?2\.2024/);
    await dialog.getByRole('button', { name: 'Nächster Tag' }).tap();
    await expect(picker).toHaveValue('2024-03-01');
    await slider.press('Home');
    await expect(picker).toHaveValue('2023-12-31');
    await expect(dialog.getByRole('button', { name: 'Vorheriger Tag' })).toBeDisabled();
    await slider.press('End');
    await expect(picker).toHaveValue('2024-03-31');
    await expect(dialog.getByRole('button', { name: 'Nächster Tag' })).toBeDisabled();
    await picker.fill('2024-01-01');
    await expect(slider).toHaveAttribute('aria-valuenow', '1');

    const track = (await dialog.locator('.MuiSlider-root').boundingBox())!;
    const camera = await activeCamera(page);
    const touch = await page.context().newCDPSession(page);
    const point = (fraction: number) => ({ x: Math.round(track.x + track.width * fraction), y: Math.round(track.y + track.height / 2) });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(0.05)] });
    for (const fraction of [0.15, 0.3, 0.5]) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(fraction)] });
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(picker).toHaveValue(/2024-02-1[345]/);
    expect(await activeCamera(page)).toEqual(camera);
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();

    for (const viewport of [
      { width: 320, height: 800 }, { width: 375, height: 800 }, { width: 768, height: 1024 },
      { width: 1024, height: 900 }, { width: 1440, height: 900 }, { width: 800, height: 375 },
    ]) {
      await page.setViewportSize(viewport);
      await trigger.tap();
      await expect(slider).toBeVisible();
      const box = (await dialog.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      await page.screenshot({ path: testInfo.outputPath(`crop-timeline-${viewport.width}.png`), animations: 'disabled' });
      await page.keyboard.press('Escape');
    }
    await page.setViewportSize({ width: 320, height: 800 });
    await activateCanvasTool(page, 'Vollbild öffnen', 'touch');
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
    await expect.poll(async () => {
      const settings = page.getByRole('button', { name: 'Grafikeinstellungen', exact: true });
      const [date, gear, layers] = await Promise.all([trigger.boundingBox(), settings.boundingBox(),
        graphicDisplayButton(page).boundingBox()]);
      return Boolean(date && gear && layers && Math.abs(date.y - gear.y) <= 1 && Math.abs(date.y - layers.y) <= 1
        && date.x + date.width <= gear.x && gear.x + gear.width <= layers.x);
    }).toBe(true);
    const settings = page.getByRole('button', { name: 'Grafikeinstellungen', exact: true });
    await settings.tap();
    const settingsDialog = page.getByRole('dialog', { name: 'Grafikeinstellungen', exact: true });
    await expect(settingsDialog.getByRole('heading', { name: 'Wegeabstände', exact: true })).toBeVisible();
    expect(await settingsDialog.evaluate(element => document.fullscreenElement?.contains(element))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(settings).toBeFocused();
    await trigger.tap();
    await expect(slider).toBeVisible();
    expect(await dialog.evaluate(element => document.fullscreenElement?.contains(element))).toBe(true);
    await dialog.getByRole('button', { name: 'Zeitraum' }).tap();
    await expect(dialog.getByLabel('Von', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('Bis', { exact: true })).toBeVisible();
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await dialog.getByLabel('Von', { exact: true }).fill('2023-12-31');
    await dialog.getByLabel('Bis', { exact: true }).fill('2024-03-01');
    await page.screenshot({ path: testInfo.outputPath('crop-timeline-fullscreen-320.png'), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await activateCanvasTool(page, 'Vollbild schließen', 'touch');
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);

    await switchSeason('Folgesaison');
    await trigger.tap();
    await expect(dialog.getByRole('button', { name: 'Heute' })).toBeDisabled();
    await expect(picker).toHaveValue('2024-04-01');
    await page.keyboard.press('Escape');
    await switchSeason('Schaltjahrsaison');
    await expect(trigger).toHaveAccessibleName(/Zeitraum · .*31\.12\.2023.*0?1\.0?3\.2024/);
  });
});

test('keeps an individual plant task target and its open-task state across crop periods', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.setFixedTime(new Date(2026, 4, 15, 12));
  await loginWithDeterministicProject(page, request, 'graphical-individual-period', { loginAsAdmin: true });
  const season = await apiRequest<{ id: number }>(page, 'POST', '/seasons/', { start_date: '2026-01-01', end_date: '2026-12-31' });
  const { bed } = await selectionFixture(page);
  const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: 'Zeitraumkultur', growth_duration_days: 14, harvest_duration_days: 5,
  });
  const plan = await apiRequest<{ id: number; individual_positions: { id: string }[] }>(page, 'POST', '/planting-plans/', {
    season: season.id, crop: crop.id, bed: bed.id, planting_date: '2026-02-01',
    placement_mode: 'individual_bed', cultivation_type: 'direct_sowing', individual_positions: [{ x_m: 1, y_m: 1 }],
  });
  const { results: generated } = await apiRequest<{ results: { id: number }[] }>(page, 'GET', `/tasks/?planting_plan=${plan.id}`);
  for (const task of generated) await apiRequest(page, 'PATCH', `/tasks/${task.id}/`, { status: 'completed' });
  for (const [title, due_date, status] of [
    ['Zeitraumstamm prüfen', '2026-05-14', 'pending'],
    ['Junge Triebe prüfen', '2026-05-19', 'pending'],
    ['Beet beobachten', '2026-06-15', 'pending'],
    ['Notizen ergänzen', null, 'pending'],
    ['Erledigte Stammaufgabe', '2026-05-01', 'completed'],
  ]) {
    await apiRequest(page, 'POST', '/tasks/', { title, due_date, status, season: season.id, planting_plan: plan.id });
  }
  await page.reload();
  await expectGraphicDisplayMode(page, 'Kulturen & Aufgaben');
  const [stem] = plan.individual_positions;
  const marker = page.locator(`[data-graphical-object-target="plant:${stem.id}"]`);
  await expect(marker).toHaveAccessibleDescription(/Überfällig.*4 offene Aufgaben/);
  await marker.press('Enter');
  const preview = page.getByTestId('graphical-object-preview');
  await expect(preview).toContainText('Außerhalb des gewählten Kulturzeitraums');
  await expect(preview).toContainText('Zeitraumstamm prüfen');
  await expect(preview).not.toContainText('Erledigte Stammaufgabe');

  const trigger = page.getByTestId('graphical-crop-date');
  const dialog = page.getByRole('dialog', { name: 'Stichtag für Kulturen' });
  await trigger.click();
  await dialog.getByRole('button', { name: 'Zeitraum' }).click();
  await dialog.getByLabel('Von', { exact: true }).fill('2026-02-01');
  await dialog.getByLabel('Bis', { exact: true }).fill('2026-02-15');
  await page.keyboard.press('Escape');
  await expect(preview).toContainText(/0?1\.0?2\.2026.*20\.0?2\.2026/);
  await expect(marker).toHaveAccessibleDescription(/Überfällig.*4 offene Aufgaben/);
  await expect(preview).not.toContainText('Geplantes Wachstum');

  await trigger.click();
  await dialog.getByRole('button', { name: 'Heute' }).click();
  await expect(preview).toContainText('Außerhalb des gewählten Kulturzeitraums');
  await expect(marker).toHaveAccessibleDescription(/Überfällig.*4 offene Aufgaben/);
  await preview.getByRole('button', { name: /Zeitraumstamm prüfen.*als erledigt markieren/ }).click();
  await expect(marker).toHaveAccessibleDescription(/3 offene Aufgaben/);
  await expect(preview.getByText('Zeitraumstamm prüfen', { exact: true })).toHaveCount(0);
  await expect(preview.getByText(/3 offene Aufgaben/)).toHaveCount(1);
  await preview.getByRole('button', { name: 'Anbauplan-Details', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/planting-plans/${plan.id}$`));
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
  const longBed = await apiRequest<{ id: number }>(page, 'POST', '/beds/', {
    name: 'Beet außerhalb der Parzelle', field: inside.id, width_m: 2, length_m: 45,
  });
  await page.goto('/app/fields-beds');
  await page.getByRole('button', { name: 'Grafik', exact: true }).click();
  await selectLocation(page, 'Grenzhof');
  await expect.poll(async () => (await canvasRects(page, `location-boundary-${location.id}`)).length).toBe(1);
  await page.locator(`[data-graphical-object-target="location:${location.id}"]`).press('Enter');
  await expect(page.getByTestId('graphical-object-preview')).toContainText('12,5 × 30 m');
  await page.keyboard.press('Escape');
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
    const bed = (await canvasRects(page, `bed-rect-${longBed.id}`))[0];
    expect(bed.issue).toBe('outside');
    expect(bed.bounds.x).toBeGreaterThanOrEqual(0);
    expect(bed.bounds.x + bed.bounds.width).toBeLessThanOrEqual(bed.stage.width + 1);
    expect(boundary.bounds.x).toBeGreaterThanOrEqual(0);
    expect(boundary.bounds.x + boundary.bounds.width).toBeLessThanOrEqual(boundary.stage.width + 1);
    await page.screenshot({ path: testInfo.outputPath(`boundary-${viewport.width}x${viewport.height}.png`), animations: 'disabled' });
  }
  await apiRequest(page, 'PUT', `/locations/${location.id}/layouts/`, {
    location_boundary: { x: 0, y: 0 },
    field_layouts: [{ field: inside.id, x: 20, y: 20 }, { field: outside.id, x: 5000, y: 0 }],
    bed_layouts: [],
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await page.getByRole('button', { name: /^Layoutprüfung/ }).click();
  await page.getByRole('button', { name: 'Zu groß in der Grafik anzeigen', exact: true }).click();
  await expect.poll(async () => {
    const { bounds, stage } = (await canvasRects(page, `location-boundary-${location.id}`))[0];
    return bounds.x + bounds.width <= 0 || bounds.x >= stage.width
      || bounds.y + bounds.height <= 0 || bounds.y >= stage.height;
  }).toBe(true);
  const site = page.getByRole('button', { name: 'Standort · Grenzhof', exact: true });
  await expect(site).toBeInViewport();
  await site.click();
  await expect(page.getByTestId('graphical-object-preview')).toHaveAccessibleName('Grenzhof');
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
    await expect.poll(() => page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, start)).toBe('CANVAS');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    const viewport = page.viewportSize()!;
    await page.mouse.move(Math.max(1, Math.min(viewport.width - 2, start.x + dx)),
      Math.max(1, Math.min(viewport.height - 2, start.y + dy)), { steps: 12 });
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
    await toggleGraphicEdit(page);
    await waitForParcelDragTarget(page, field.id);
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
    if (viewport.width > 375) await page.getByRole('button', { name: 'Grafik bearbeiten', exact: true, pressed: true }).click();
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
      await toggleGraphicEdit(page, input);
      await waitForParcelDragTarget(page, field.id);
      await expect.poll(async () => (await bedOffsets()).length).toBe(2);
      const before = await plot();
      const offsets = await bedOffsets();
      const touch = input === 'touch' ? await page.context().newCDPSession(page) : null;
      const start = {
        x: Math.round(before.container.x + before.bounds.x + before.bounds.width * 0.22),
        y: Math.round(before.container.y + before.bounds.y + before.bounds.height * 0.21),
      };
      await expect.poll(() => page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, start)).toBe('CANVAS');
      const beginDrag = async () => {
        if (touch) {
          await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
        } else {
          await page.mouse.move(start.x, start.y);
          await page.mouse.down();
        }
        for (const distance of [18, 36]) {
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

test('shows dimensions along the selected Graphic location axes throughout a full turn', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, 'graphical-dimension-arrows', { loginAsAdmin: true });
  const { results: [location] } = await apiRequest<{ results: { id: number; name: string }[] }>(page, 'GET', '/locations/');
  const dimensions = { length_m: 24, width_m: 12.5 };
  await apiRequest(page, 'PATCH', `/locations/${location.id}/`, dimensions);
  await apiRequest(page, 'POST', '/fields/', { name: 'Lange Parzelle', location: location.id, length_m: 18, width_m: 8 });
  const otherLocation = await apiRequest<{ name: string }>(page, 'POST', '/locations/', {
    name: 'Zweiter Standort', length_m: 20, width_m: 10,
  });
  await page.goto('/app/fields-beds');

  const show = (view: string) => page.getByRole('button', { name: view, exact: true }).click();
  const row = page.locator(`[role="row"][data-id="location-${location.id}"]`);
  const arrowIsHorizontal = (label: string) => page.getByText(label, { exact: true }).locator('..')
    .locator('svg[aria-hidden="true"] path').evaluate(node => {
      const { width, height } = (node as SVGPathElement).getBBox();
      return width > height;
    });
  const expectDimensions = async (lengthHorizontal: boolean) => {
    await expect.poll(() => arrowIsHorizontal('Länge (m)')).toBe(lengthHorizontal);
    await expect.poll(() => arrowIsHorizontal('Breite (m)')).toBe(!lengthHorizontal);
    await expect(row.locator('[data-field="length_m"]')).toHaveText('24');
    await expect(row.locator('[data-field="width_m"]')).toHaveText('12.5');
  };
  await expectDimensions(true);
  const headers = page.locator('.MuiDataGrid-columnHeaders');
  await headers.screenshot({ path: testInfo.outputPath('dimension-headers-default.png') });
  await show('Grafik');
  await selectLocation(page, location.name);
  for (const lengthHorizontal of [false, true, false, true]) {
    await activateCanvasTool(page, 'Ansicht um 90° nach rechts drehen');
    await expect.poll(async () => {
      const [boundary] = await canvasRects(page, `location-boundary-${location.id}`);
      return boundary ? boundary.width > boundary.height : null;
    }).toBe(lengthHorizontal);
    if (!lengthHorizontal) {
      await activateCanvasTool(page, 'Hineinzoomen');
      await activateCanvasTool(page, 'Ansicht nach links verschieben');
      await activateCanvasTool(page, 'Alles einpassen');
    }
    await show('Liste');
    await expectDimensions(lengthHorizontal);
    if (!lengthHorizontal) await headers.screenshot({ path: testInfo.outputPath('dimension-headers-rotated.png') });
    await show('Grafik');
    if (!lengthHorizontal) {
      await selectLocation(page, otherLocation.name);
      await show('Liste');
      await expectDimensions(true);
      await show('Grafik');
      await selectLocation(page, location.name);
    }
  }
  expect(await apiRequest(page, 'GET', `/locations/${location.id}/`)).toMatchObject(dimensions);
});

test('uses one metric zoom range for fitting a large site and working on a small measured bed', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, 'graphical-metric-zoom', { loginAsAdmin: true });
  const { results: [location] } = await apiRequest<{ results: { id: number; name: string }[] }>(page, 'GET', '/locations/');
  await apiRequest(page, 'PATCH', `/locations/${location.id}/`, { length_m: 2000, width_m: 1000 });
  const parcel = await apiRequest<{ id: number }>(page, 'POST', '/fields/', {
    name: 'Messparzelle', location: location.id, length_m: 6, width_m: 4,
  });
  const bed = await apiRequest<{ id: number }>(page, 'POST', '/beds/', {
    name: 'Kleines Messbeet', field: parcel.id, length_m: 0.8, width_m: 0.5,
  });
  const approximate = await apiRequest<{ id: number; name: string }>(page, 'POST', '/locations/', { name: 'Zweiter Standort ohne Maße' });
  await apiRequest(page, 'POST', '/fields/', { name: 'Schematische Parzelle', location: approximate.id });
  const layoutURL = `/locations/${location.id}/layouts/`;
  const layoutBefore = await apiRequest(page, 'GET', layoutURL);
  await page.goto('/app/fields-beds');
  await page.getByRole('button', { name: 'Grafik', exact: true }).click();
  await selectLocation(page, location.name);
  await activateCanvasTool(page, 'Alles einpassen');
  const overview = await activeCamera(page);
  expect(overview.scale).toBeLessThan(0.035);
  const zoomOut = page.getByRole('button', { name: 'Herauszoomen', exact: true });
  const zoomIn = page.getByRole('button', { name: 'Hineinzoomen', exact: true });
  const scale = page.getByTestId('graphical-scale-indicator');
  await expect(zoomOut).toBeDisabled();
  await expect(scale.getByRole('img', { name: /Maßstab.*m/ })).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('-');
  expect(await activeCamera(page)).toEqual(overview);
  await page.keyboard.press('+');
  await expect.poll(async () => (await activeCamera(page)).scale).toBeCloseTo(overview.scale * 1.2, 7);
  await page.keyboard.press('-');
  await expect(zoomOut).toBeDisabled();
  await expect.poll(async () => (await activeCamera(page)).scale).toBeCloseTo(overview.scale, 9);
  await page.screenshot({ path: testInfo.outputPath('metric-large-site-overview.png') });

  const zoomTo = page.getByRole('menuitem', { name: 'Auf Auswahl zoomen', exact: true });
  const parcelTarget = page.getByRole('button', { name: 'Parzelle · Messparzelle' });
  await parcelTarget.press('Shift+F10');
  await zoomTo.press('Enter');
  await expect(parcelTarget).toBeFocused();
  await expect.poll(async () => (await activeCamera(page)).scale).toBeGreaterThan(3);
  const point = await canvasInteractionPoint(page, `bed-rect-${bed.id}`);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await zoomTo.click();
  await expect(zoomIn).toBeDisabled();
  const detail = await activeCamera(page);
  expect(detail.scale * 18).toBeCloseTo(500, 8);
  await expect(scale.getByRole('img', { name: /Maßstab.*10\s*cm/ })).toBeVisible();
  expect((await page.getByTestId('graphical-metric-scale-bar').boundingBox())?.width).toBeCloseTo(50, 1);
  const bedAtLimit = await canvasInteractionPoint(page, `bed-rect-${bed.id}`);
  await page.mouse.move(bedAtLimit.x, bedAtLimit.y);
  await page.mouse.wheel(0, -120);
  await page.keyboard.press('+');
  expect(await activeCamera(page)).toEqual(detail);
  for (const mode of ['Anbauflächen', 'Kulturen', 'Aufgaben', 'Kulturen & Aufgaben']) {
    await selectGraphicDisplay(page, mode);
    expect(await activeCamera(page)).toEqual(detail);
  }
  await activateCanvasTool(page, 'Ansicht um 90° nach rechts drehen');
  await expect.poll(async () => (await activeCamera(page)).scale).toBeCloseTo(detail.scale, 8);
  await canvasInteractionPoint(page, `bed-rect-${bed.id}`);
  await toggleGraphicEdit(page);
  await page.getByRole('button', { name: 'Beet · Kleines Messbeet' }).press('Shift+F10');
  await expect(page.getByRole('menuitem')).toHaveCount(1);
  await zoomTo.press('Enter');
  await expect(page.getByRole('button', { name: 'Grafik bearbeiten', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await toggleGraphicEdit(page);
  await activateCanvasTool(page, 'Vollbild öffnen');
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await expect(scale.getByRole('img', { name: /Maßstab.*10\s*cm/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('metric-bed-fullscreen.png') });
  await activateCanvasTool(page, 'Vollbild schließen');
  await selectLocation(page, approximate.name);
  await expect(scale).toContainText('Schematische Darstellung');
  await expect(page.getByTestId('graphical-metric-scale-bar')).toHaveCount(0);
  await selectLocation(page, location.name);
  await expect.poll(async () => (await activeCamera(page)).scale).toBeCloseTo(detail.scale, 8);
  await activateCanvasTool(page, 'Alles einpassen');
  await expect.poll(async () => (await activeCamera(page)).scale).toBeLessThan(0.035);
  await page.reload();
  expect(await apiRequest(page, 'GET', layoutURL)).toEqual(layoutBefore);
  expect(await apiRequest(page, 'GET', `/beds/${bed.id}/`)).toMatchObject({ length_m: 0.8, width_m: 0.5 });
});

test.describe('metric zoom on a touch-capable phone', () => {
  test.use({ hasTouch: true, viewport: { width: 375, height: 800 } });

  test('anchors a moving pinch and fits a bed through its read-only long-press menu', async ({ page, request, browserName }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Uses real two-finger touch input through Chromium');
    await loginWithDeterministicProject(page, request, 'graphical-metric-pinch', { loginAsAdmin: true });
    const { results: [location] } = await apiRequest<{ results: { id: number }[] }>(page, 'GET', '/locations/');
    await apiRequest(page, 'PATCH', `/locations/${location.id}/`, { length_m: 60, width_m: 42 });
    const parcel = await apiRequest<{ id: number }>(page, 'POST', '/fields/', {
      name: 'Parzelle zum Einpassen', location: location.id, length_m: 12, width_m: 8,
    });
    const bed = await apiRequest<{ id: number }>(page, 'POST', '/beds/', {
      name: 'Beet zum Einpassen', field: parcel.id, length_m: 3, width_m: 2,
    });
    await page.route('**/api/auth/me/', async route => {
      const response = await route.fetch();
      const user = await response.json();
      const memberships = user.memberships.map((membership: { project_id: number }) => ({ ...membership, project_id: -1 }));
      await route.fulfill({ response, json: { ...user, memberships } });
    });
    const writes: string[] = [];
    page.on('request', request => {
      if (request.method() !== 'GET' && /\/(layouts|graphic-move|graphic-placement)\/$/.test(new URL(request.url()).pathname)) {
        writes.push(request.url());
      }
    });
    await page.goto('/app/fields-beds');
    await page.getByRole('button', { name: 'Grafik', exact: true }).tap();
    await activateCanvasTool(page, 'Alles einpassen', 'touch');
    await expect(graphicWorkspaceMenu(page)).toHaveCount(0);
    for (let step = 0; step < 10; step++) await activateCanvasTool(page, 'Hineinzoomen', 'touch');
    const before = await activeCamera(page);
    const canvas = (await page.locator('.konvajs-content').boundingBox())!;
    const center = { x: canvas.x + canvas.width * 0.48, y: canvas.y + canvas.height * 0.58 };
    const next = { x: center.x + 14, y: center.y + 8 };
    const fingers = ({ x, y }: { x: number; y: number }, separation: number) => [
      { id: 0, x: x - separation, y }, { id: 1, x: x + separation, y },
    ];
    const touch = await page.context().newCDPSession(page);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(center, 22) });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(center, 34) });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(next, 56) });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await activeCamera(page)).scale).toBeGreaterThan(before.scale * 1.3);
    const after = await activeCamera(page);
    expect((next.x - canvas.x - after.x) / after.scale).toBeCloseTo((center.x - canvas.x - before.x) / before.scale, 1);
    expect((next.y - canvas.y - after.y) / after.scale).toBeCloseTo((center.y - canvas.y - before.y) / before.scale, 1);
    await expect(page.getByTestId('graphical-object-preview')).toHaveCount(0);

    await activateCanvasTool(page, 'Alles einpassen', 'touch');
    const target = await canvasInteractionPoint(page, `bed-rect-${bed.id}`);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [target] });
    const zoomTo = page.getByRole('menuitem', { name: 'Auf Auswahl zoomen', exact: true });
    await expect(zoomTo).toBeVisible();
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await zoomTo.tap();
    await expect.poll(async () => (await activeCamera(page)).scale).toBeGreaterThan(3);
    const bar = page.getByTestId('graphical-scale-indicator');
    await expect(bar.getByRole('img', { name: /Maßstab/ })).toBeVisible();
    const barBounds = (await bar.boundingBox())!;
    const toolBounds = (await page.getByTestId('graphical-canvas-tools').boundingBox())!;
    expect(toolBounds.y + toolBounds.height).toBeLessThan(barBounds.y);
    expect(writes).toEqual([]);
    await expect(zoomTo).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('metric-read-only-touch.png'), animations: 'disabled' });
  });
});

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
  await expect(page.getByTestId('topbar-workspace-controls').getByText(location.name, { exact: false })).toHaveCount(0);
  await expect.poll(async () => (await canvasRects(page, `location-boundary-${location.id}`)).length).toBe(1);
  await expect.poll(async () => (await canvasRects(page, `location-boundary-label-${location.id}`))[0]?.text).toContain(location.name);
  await expect(page.getByTestId('location-boundary-overflow-hint')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('single-location-graphic-1440.png'), animations: 'disabled' });
});

test('shows the location selector only while there is a choice of locations', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, `empty-graphic-${testInfo.workerIndex}`, { loginAsAdmin: true });
  const { results: [location] } = await apiRequest<{ results: { id: number; name: string }[] }>(page, 'GET', '/locations/');
  await page.goto('/app/fields-beds');
  await expect(page.getByRole('heading', { name: 'Parzelle fehlt', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Grafik', exact: true }).click();
  const workspace = page.getByTestId('topbar-workspace-controls');
  const selector = workspace.getByRole('combobox', { name: 'Standort', exact: true });
  const addLocation = page.getByRole('button', { name: /^Standort hinzufügen(?: \(|$)/ });
  await expect(selector).toHaveCount(0);
  await expect(workspace.getByText(location.name, { exact: false })).toHaveCount(0);
  await expect(addLocation).toBeVisible();
  await expect(page.getByText(/Dieser Standort hat noch keine Parzellen/)).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Parzelle fehlt', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: `Standort · ${location.name}`, exact: true }).click();
  const preview = page.getByTestId('graphical-object-preview');
  await expect(preview).toHaveAccessibleName(location.name);
  await expect(preview).not.toContainText('m²');
  await preview.getByRole('button', { name: 'Details anzeigen' }).click();
  await expect(page).toHaveURL(new RegExp(`/fields-beds/locations/${location.id}$`));
  await page.getByRole('button', { name: 'Zurück zur Grafik', exact: true }).click();
  await expect(selector).toHaveCount(0);

  await addLocation.click();
  const dialog = page.getByRole('dialog', { name: 'Weiteren Standort hinzufügen', exact: true });
  await dialog.getByRole('textbox', { name: 'Name des Standorts', exact: true }).fill('Zweiter Hof');
  const created = page.waitForResponse(response => response.url().endsWith('/locations/') && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Standort anlegen', exact: true }).click();
  const { id: addedId } = await (await created).json() as { id: number };
  await expect(selector).toHaveText(location.name);
  await selectLocation(page, 'Zweiter Hof');
  await selectLocation(page, location.name);
  await selectLocation(page, 'Zweiter Hof');
  await expect(addLocation).toBeVisible();

  await page.getByRole('button', { name: 'Liste', exact: true }).click();
  const addedRow = page.locator(`[role="row"][data-id="location-${addedId}"]`);
  await addedRow.click({ button: 'right' });
  const deleted = page.waitForResponse(response => response.url().endsWith(`/locations/${addedId}/`)
    && response.request().method() === 'DELETE');
  await page.getByRole('menuitem', { name: 'Löschen', exact: true }).click();
  expect((await deleted).ok()).toBe(true);
  await expect(addedRow).toHaveCount(0);
  await page.getByRole('button', { name: 'Grafik', exact: true }).click();
  await expect(page.getByRole('region', { name: `Standort: ${location.name}`, exact: true })).toBeVisible();
  await expect(selector).toHaveCount(0);
  await expect(addLocation).toBeVisible();
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
  const { results: mixedPlans } = await apiRequest<{ results: {
    crop_name: string; crop_display_name: string | null; crop_variety: string | null; planting_date: string;
  }[] }>(page, 'GET', `/planting-plans/?bed=${mixed}`);
  const chronologicalNames = mixedPlans.sort((a, b) => a.planting_date.localeCompare(b.planting_date))
    .map(plan => (plan.crop_display_name || plan.crop_name) + (plan.crop_variety ? ` (${plan.crop_variety})` : ''));
  const { results: growthPlans } = await apiRequest<{ results: { id: number }[] }>(page, 'GET', `/planting-plans/?bed=${growth}`);
  for (const plan of growthPlans) {
    const { results: tasks } = await apiRequest<{ results: { id: number; status: string }[] }>(page, 'GET', `/tasks/?planting_plan=${plan.id}`);
    for (const task of tasks.filter(task => task.status === 'pending' || task.status === 'in_progress')) {
      await apiRequest(page, 'PATCH', `/tasks/${task.id}/`, { status: 'completed' });
    }
  }
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
  await expectGraphicDisplayMode(page, 'Kulturen & Aufgaben');
  const dateButton = page.getByTestId('graphical-crop-date');
  await expect(dateButton).toHaveAccessibleName(/^Stichtag für Kulturen · Heute(?: · .*2026)?$/);

  const shape = (id: number) => page.evaluate(id => {
    const stage = (window as unknown as { Konva?: { stages: Konva.Stage[] } }).Konva?.stages
      .find(item => item.container()?.isConnected);
    const bed = stage?.find('Rect').find(rect => rect.getAttr('data-testid') === `bed-rect-${id}`);
    return { phase: bed?.getAttr('data-crop-phase') ?? null, urgency: bed?.getAttr('data-task-urgency') ?? null,
      fill: bed?.getAttr('fill') ?? null };
  }, id);
  await expect.poll(async () => (await shape(growth)).phase).toBe('growth');
  await expect.poll(async () => (await shape(harvest)).phase).toBe('harvest');
  await expect.poll(async () => (await shape(mixed)).phase).toBe('mixed');
  await expect.poll(async () => (await shape(free)).phase).toBeNull();
  const harvestUrgency = (await shape(harvest)).urgency;
  expect(harvestUrgency).toBeTruthy();
  const combinedHarvest = await shape(harvest);
  const normalFill = (await shape(free)).fill;
  expect(combinedHarvest.fill).not.toBe(normalFill);
  expect((await shape(growth)).fill).toBe(normalFill);
  const hover = page.getByRole('tooltip').filter({ hasText: 'Erntebeet' });
  const harvestPoint = shapePoint((await canvasRects(page, `bed-rect-${harvest}`))[0]);
  await page.mouse.move(harvestPoint.x, harvestPoint.y);
  await expect(hover).toContainText('Erntereife prüfen');
  await expect(hover).toContainText('Geplante Ernte');
  await expect(hover).not.toContainText('Erntewerkzeug vorbereiten');
  await expect(hover.getByRole('button')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('graphic-display-task-tooltip.png') });
  await display.press('Enter');
  await expect(hover).toHaveCount(0);
  await page.keyboard.press('Escape');

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
  await dateDialog.getByRole('button', { name: 'Stichtag', exact: true }).click();
  await dateDialog.locator('input[type="date"]').fill('2026-04-15');
  await expect(dateDialog.getByText(/heutige Datum/)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dateButton).not.toHaveAccessibleName('Stichtag für Kulturen · Heute');
  await expect.poll(async () => (await shape(mixed)).phase).toBe('growth');
  await expect.poll(async () => (await shape(harvest)).urgency).toBe(harvestUrgency);

  await target(mixed).press('Enter');
  await dateButton.click();
  await dateDialog.getByRole('button', { name: 'Zeitraum' }).click();
  const from = dateDialog.getByLabel('Von', { exact: true });
  const to = dateDialog.getByLabel('Bis', { exact: true });
  await from.fill('2026-04-01');
  await to.fill('2026-06-10');
  await from.fill('2026-06-11');
  await expect(dateDialog.getByRole('alert')).toContainText('Enddatum');
  await from.fill('');
  await expect(dateDialog.getByRole('alert')).toHaveText('Gib beide Daten ein.');
  await from.fill('2025-12-31');
  await expect(dateDialog.getByRole('alert')).toContainText('ausgewählten Saison');
  await expect(dateDialog.getByText(/Gezeigter Zeitraum: .*0?1\.0?4\.2026.*10\.0?6\.2026/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dateButton).toBeFocused();
  await expect(dateButton).toHaveAccessibleName(/Zeitraum · .*0?1\.0?4\.2026.*10\.0?6\.2026/);
  await expect(preview).toHaveAccessibleName('Misch- und Folgebeet');
  const projected = preview.getByRole('region', { name: 'Kulturen' });
  await expect(projected.getByRole('listitem').locator('p')).toHaveText(chronologicalNames);
  await expect(projected).not.toContainText(/Geplantes Wachstum|Geplante Ernte/);
  await expect(projected.getByRole('listitem').first()).toContainText(/2026.*2026/);
  await expect.poll(async () => (await shape(harvest)).urgency).toBe(harvestUrgency);

  await dateButton.click();
  await from.fill('2026-04-15');
  await to.fill('2026-04-15');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await shape(mixed)).phase).toBe('growth');
  await expect(projected.getByRole('listitem')).toHaveCount(1);
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
  expect((await shape(harvest)).fill).not.toBe(combinedHarvest.fill);
  await page.reload();
  await expectGraphicDisplayMode(page, 'Kulturen');
  await selectGraphicDisplay(page, 'Aufgaben');
  await expect(dateButton).toHaveCount(0);
  expect((await shape(harvest)).phase).toBeNull();
  await expect.poll(async () => (await shape(harvest)).fill).toBe(combinedHarvest.fill);
  await page.reload();
  await expectGraphicDisplayMode(page, 'Aufgaben');
  await selectGraphicDisplay(page, 'Kulturen & Aufgaben');
  await expect(dateButton).toHaveAccessibleName(/^Stichtag für Kulturen · Heute · .*2026$/);
  await page.reload();
  await expectGraphicDisplayMode(page, 'Kulturen & Aufgaben');
  await expect.poll(() => shape(harvest)).toMatchObject(combinedHarvest);
  await page.screenshot({ path: testInfo.outputPath('graphic-display-combined-375.png') });
  await display.press('Enter');
  await expect(page.getByRole('menuitemradio', { name: 'Kulturen & Aufgaben' })).toHaveAttribute('aria-checked', 'true');
  await page.screenshot({ path: testInfo.outputPath('graphic-display-dropdown-375.png') });
  await page.keyboard.press('Escape');
  await selectGraphicDisplay(page, 'Anbauflächen');
  await page.reload();
  await expectGraphicDisplayMode(page, 'Anbauflächen');
  await expect(dateButton).toHaveCount(0);
  await target(harvest).press('Enter');
  await expect(preview).toContainText('Geplante Ernte');
  await expect(preview.getByText(/offene Aufgaben?/)).toBeVisible();
  expect(writes).toEqual([]);
  await page.keyboard.press('Escape');
});
