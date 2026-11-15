import { expect, test, type Page } from '@playwright/test';
import type Konva from 'konva';
import { apiRequest, loginWithDeterministicProject } from './utils';

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
  const layouts = page.waitForResponse(response => response.url().endsWith(`/locations/${location.id}/layouts/`));
  await page.getByRole('button', { name: 'Grafik', exact: true }).click();
  await layouts;
  await page.waitForLoadState('networkidle');
  await page.getByRole('heading', { name: 'Standort: Grafik913', exact: true }).scrollIntoViewIfNeeded();
  for (const viewport of [
    { width: 1440, height: 900 }, { width: 1024, height: 900 },
    { width: 768, height: 900 }, { width: 375, height: 800 }, { width: 800, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.getByRole('heading', { name: 'Standort: Grafik913', exact: true }).scrollIntoViewIfNeeded();
    // Wait for the actual canvas card to be measured after responsive reflow.
    await expect.poll(async () => {
      const field = (await canvasRects(page, `field-rect-${fieldIds[0]}`))[0];
      return field.stage.width <= viewport.width && field.stage.height === Math.max(320, Math.min(560, Math.round(viewport.height * 0.45)));
    }).toBe(true);
    await expect.poll(async () => (await canvasRects(page, 'bed-rect-')).filter(bed => bedIds.includes(Number(bed.id.replace('bed-rect-', '')))).length).toBe(3);
    const fields = (await canvasRects(page, 'field-rect-')).filter(field => fieldIds.includes(Number(field.id.replace('field-rect-', ''))));
    expect(fields).toHaveLength(3);
    for (const field of fields) {
      expect(field.bounds.x).toBeGreaterThanOrEqual(0);
      expect(field.bounds.y).toBeGreaterThanOrEqual(47);
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
    await page.screenshot({ path: testInfo.outputPath(`graphical-${viewport.width}x${viewport.height}.png`), animations: 'disabled' });
    if (viewport.height === 375) {
      await page.locator('.MuiAccordion-root').filter({ has: page.getByRole('heading', { name: 'Standort: Grafik913', exact: true }) })
        .screenshot({ path: testInfo.outputPath('graphical-landscape-card.png'), animations: 'disabled' });
    }
  }
  await page.setViewportSize({ width: 375, height: 800 });
  const card = page.locator('.MuiAccordion-root').filter({ has: page.getByRole('heading', { name: 'Standort: Grafik913', exact: true }) });
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
  await page.getByRole('heading', { name: 'Standort: Grafik913', exact: true }).scrollIntoViewIfNeeded();
  const original = (await canvasRects(page, `field-rect-${fieldIds[0]}`))[0];
  for (let turn = 1; turn <= 4; turn += 1) {
    await card.getByRole('button', { name: 'Ansicht um 90° nach rechts drehen', exact: true }).click();
    const field = (await canvasRects(page, `field-rect-${fieldIds[0]}`))[0];
    expect(field.width / field.height).toBeCloseTo(turn % 2 ? 0.5 : 2);
    for (const label of await canvasRects(page, 'bed-label-')) expect(label.rotation).toBe(0);
    expect(field.bounds.x).toBeGreaterThanOrEqual(0);
    expect(field.bounds.y).toBeGreaterThanOrEqual(47);
    expect(field.bounds.x + field.bounds.width).toBeLessThanOrEqual(field.stage.width + 1);
    expect(field.bounds.y + field.bounds.height).toBeLessThanOrEqual(field.stage.height + 1);
  }
  const restored = (await canvasRects(page, `field-rect-${fieldIds[0]}`))[0];
  expect(restored.x).toBe(original.x);
  expect(restored.y).toBe(original.y);
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
