import { expect, test, type Page } from '@playwright/test';
import type Konva from 'konva';
import { apiRequest, loginWithDeterministicProject } from './utils';

// Layout failure/delay fixtures must intercept the browser's requests directly.
test.use({ serviceWorkers: 'block' });

async function canvasRects(page: Page, prefix: string) {
  return page.evaluate(prefix => {
    const konva = (window as unknown as { Konva: { stages: Konva.Stage[] } }).Konva;
    return konva.stages.filter(stage => stage.container()?.isConnected)
      .flatMap(stage => stage.find('Rect, Text').map(node => ({
        id: String(node.getAttr('data-testid') ?? ''),
        x: node.x(), y: node.y(), width: node.width(), height: node.height(),
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
      // Konva bounds include the scaled stroke around the 48px fit inset.
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
  await page.setViewportSize({ width: 1440, height: 900 });
  await card.getByRole('button', { name: 'Alles einpassen', exact: true }).click();
  await page.getByRole('region', { name: 'Standort: Grafik913', exact: true }).scrollIntoViewIfNeeded();
  const original = (await canvasRects(page, `field-rect-${fieldIds[0]}`))[0];
  for (let turn = 1; turn <= 4; turn += 1) {
    await card.getByRole('button', { name: 'Ansicht um 90° nach rechts drehen', exact: true }).click();
    const field = (await canvasRects(page, `field-rect-${fieldIds[0]}`))[0];
    expect(field.width / field.height).toBeCloseTo(turn % 2 ? 0.5 : 2);
    for (const label of await canvasRects(page, 'bed-label-')) expect(label.rotation).toBe(0);
    expect(field.bounds.x).toBeGreaterThanOrEqual(0);
    // Konva bounds include the scaled stroke around the 48px fit inset.
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
  await expect(page.getByRole('dialog')).toContainText('Beet 1 mit einem langen lesbaren Namen');
  await page.screenshot({ path: testInfo.outputPath('graphical-bed-details.png'), animations: 'disabled' });
  expect(layoutWrites).toEqual([]);
  await page.getByRole('button', { name: 'Schließen', exact: true }).click();
  await page.evaluate(() => localStorage.setItem('ui.language', 'fr'));
  await page.setViewportSize({ width: 375, height: 800 });
  await page.reload();
  const rotateRight = page.getByRole('button', { name: 'Tourner la vue de 90° vers la droite', exact: true }).first();
  await rotateRight.scrollIntoViewIfNeeded();
  await rotateRight.click();
  await rotateRight.hover();
  await page.screenshot({ path: testInfo.outputPath('graphical-mobile-fr.png'), animations: 'disabled' });
});

async function activeCamera(page: Page) {
  return page.evaluate(() => {
    const stage = (window as unknown as { Konva: { stages: Konva.Stage[] } }).Konva.stages
      .find(stage => stage.container()?.isConnected)!;
    return { scale: stage.scaleX(), x: stage.x(), y: stage.y() };
  });
}

async function selectLocation(page: Page, name: string) {
  await page.getByRole('combobox', { name: 'Standort', exact: true }).click();
  await page.getByRole('option', { name, exact: true }).click();
  await expect(page.getByRole('region', { name: `Standort: ${name}`, exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
}

test('retains selected location, camera and rotation through representation changes and fullscreen', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, 'graphical-workspace-camera', { demoProject: true, loginAsAdmin: true });
  await page.goto('/app/fields-beds');
  await page.getByRole('button', { name: 'Grafik', exact: true }).click();
  await selectLocation(page, 'Hofgarten');
  await expect(page.locator('.konvajs-content')).toHaveCount(1);
  await expect(page.locator('.MuiAccordion-root')).toHaveCount(0);
  await page.getByRole('button', { name: 'Ansicht um 90° nach rechts drehen', exact: true }).click();
  for (let count = 0; count < 5; count++) await page.getByRole('button', { name: 'Hineinzoomen', exact: true }).click();
  await page.getByRole('button', { name: 'Ansicht nach links verschieben', exact: true }).click();
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
  await page.goto('/app/fields-beds');
  await page.getByRole('button', { name: 'Grafik', exact: true }).click();
  for (const viewport of [
    { width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1024, height: 900 },
    { width: 768, height: 900 }, { width: 375, height: 800 }, { width: 800, height: 375 },
    { width: 1024, height: 500 },
  ]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => {
      const rects = await Promise.all([
        page.getByRole('banner').getByRole('heading', { level: 1 }),
        ...['Liste', 'Grafik', 'Grafik bearbeiten'].map(name => page.getByRole('button', { name, exact: true })),
        page.getByRole('button', { name: /^Standort hinzufügen/ }),
        page.getByRole('combobox', { name: 'Standort', exact: true }),
      ].map(locator => locator.boundingBox()));
      return rects.every(rect => rect && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= viewport.width + 1 && rect.y + rect.height <= viewport.height)
        && rects.every((rect, index) => rect && rects.slice(index + 1).every(other => other &&
          (rect.x + rect.width <= other.x + 1 || other.x + other.width <= rect.x + 1 ||
           rect.y + rect.height <= other.y + 1 || other.y + other.height <= rect.y + 1)));
    }).toBe(true);
    await expect.poll(async () => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
    await expect.poll(async () => (await canvasRects(page, 'field-rect-'))[0].stage.height).toBeGreaterThan(96);
    if (viewport.width === 1920) await expect(page.getByTestId('topbar-workspace-row')).toHaveCount(0);
    if (viewport.width <= 1024) await expect(page.getByTestId('topbar-workspace-row')).toBeVisible();
    await page.mouse.move(1, viewport.height - 1);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`workspace-${viewport.width}x${viewport.height}.png`), animations: 'disabled' });
    await page.getByRole('button', { name: 'Liste', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Standort', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Grafik bearbeiten', exact: true })).toHaveCount(0);
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
