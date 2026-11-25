import { expect, test, type Page } from '@playwright/test';

const selected = (page: Page) => page.getByLabel('Selected shape');
const coordinates = (page: Page) => page.getByLabel('Stored vertices');

async function open(page: Page) {
  const externalRequests: string[] = [];
  page.on('request', request => {
    if (!request.url().startsWith('http://127.0.0.1:14191/')) externalRequests.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByText(/54 beds/)).toBeVisible();
  await expect(page.locator('.ol-viewport canvas').first()).toBeVisible();
  return externalRequests;
}

async function mapPoint(page: Page, east: number, north: number) {
  const viewport = await page.locator('.ol-viewport').boundingBox();
  if (!viewport) throw new Error('Map viewport is missing');
  const pixelsPerMetre = Math.min((viewport.width - 40) / 100, (viewport.height - 40) / 76);
  return {
    x: viewport.x + viewport.width / 2 + (east - 50) * pixelsPerMetre,
    y: viewport.y + viewport.height / 2 - (north - 38) * pixelsPerMetre,
  };
}

async function clickPoint(page: Page, east: number, north: number, offset = 0) {
  const { x, y } = await mapPoint(page, east, north);
  await page.mouse.click(x + offset, y + offset);
}

test('draws snapped rectangles and irregular polygons, modifies vertices and restores the draft', async ({ page }) => {
  const externalRequests = await open(page);
  await clickPoint(page, 16, 14);
  await expect(selected(page)).toHaveValue('bed-1');
  await expect(page.getByRole('button', { name: 'Edit vertices' })).toBeHidden();
  await page.getByRole('button', { name: 'Edit shapes' }).click();
  await page.getByRole('button', { name: 'Draw rectangle' }).click();
  // Click a few screen pixels away from Bed 1's lower-left vertex.
  await clickPoint(page, 15, 13, -3);
  await clickPoint(page, 11.5, 9.5);
  await expect(selected(page)).toHaveValue('sketch-1');
  await expect(coordinates(page)).toContainText('15, 13');
  await expect(page.locator('.selection')).toHaveText('Sketch 1 · 4 vertices');

  await page.getByRole('button', { name: 'Draw polygon' }).click();
  for (const [x, y] of [[68, 58], [82, 57], [83, 62], [74, 64], [68, 58]]) {
    await clickPoint(page, x, y);
  }
  await expect(selected(page)).toHaveValue('sketch-2');
  await expect(page.locator('.selection')).toHaveText('Sketch 2 · 4 vertices');

  const original = await coordinates(page).innerText();
  await page.getByRole('button', { name: 'Edit vertices' }).click();
  const vertex = (await coordinates(page).innerText()).split('\n')[0].split(', ').map(Number);
  const start = await mapPoint(page, vertex[0], vertex[1]);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 20, start.y, { steps: 5 });
  await page.mouse.up();
  await expect(coordinates(page)).not.toHaveText(original);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(coordinates(page)).toHaveText(original);
  await page.getByRole('button', { name: 'Cancel editing' }).click();
  await expect(selected(page).locator('option')).toHaveCount(56);
  expect(externalRequests).toEqual([]);
});

test('applies pointer and numeric transforms to a parent and its 54 beds', async ({ page }) => {
  await open(page);
  await selected(page).selectOption('bed-1');
  const original = await coordinates(page).innerText();
  await page.getByRole('button', { name: 'Edit shapes' }).click();
  await selected(page).selectOption('parcel');
  await page.getByRole('button', { name: 'Drag group' }).click();
  const start = await mapPoint(page, 82, 55);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 35, start.y - 20, { steps: 8 });
  await page.mouse.up();
  await selected(page).selectOption('bed-1');
  await expect(coordinates(page)).not.toHaveText(original);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(coordinates(page)).toHaveText(original);

  await selected(page).selectOption('site');
  await page.getByRole('spinbutton', { name: 'Rotation (°)' }).fill('90');
  await page.getByRole('spinbutton', { name: 'Scale factor' }).fill('0.5');
  await page.getByRole('spinbutton', { name: 'East (m)' }).fill('2');
  const samples = await page.getByRole('button', { name: 'Apply transform' }).evaluate(async element => {
    const durations: number[] = [];
    for (let sample = 0; sample < 12; sample++) {
      const start = performance.now();
      (element as HTMLButtonElement).click();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      durations.push(performance.now() - start);
      const undo = Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Undo');
      undo?.click();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    return durations.map(duration => Math.round(duration));
  });
  console.log('54-bed transform plus two animation frames (ms)', samples.join(', '));
  await page.getByRole('button', { name: 'Apply transform' }).focus();
  await page.keyboard.press('Enter');
  await selected(page).selectOption('bed-1');
  await expect(coordinates(page)).toContainText('64.5, 20.5');
  await selected(page).selectOption('bed-54');
  await expect(coordinates(page)).toContainText('46, 50.1');
  await page.getByRole('button', { name: 'Cancel editing' }).click();
  await selected(page).selectOption('bed-1');
  await expect(coordinates(page)).toHaveText(original);

  await page.getByRole('button', { name: 'Edit shapes' }).click();
  await selected(page).selectOption('site');
  await page.getByRole('spinbutton', { name: 'Rotation (°)' }).fill('0');
  await page.getByRole('spinbutton', { name: 'Scale factor' }).fill('1');
  await page.getByRole('spinbutton', { name: 'East (m)' }).fill('400');
  await page.getByRole('button', { name: 'Apply transform' }).click();
  await page.getByRole('button', { name: 'Fit location' }).click();
  await clickPoint(page, 16, 14);
  await expect(selected(page)).toHaveValue('bed-1');
  await expect(coordinates(page)).toContainText('415, 13');
});

test('offers touch selection, keyboard geometry and responsive controls', async ({ browser }, testInfo) => {
  const page = await browser.newPage({ hasTouch: true, viewport: { width: 375, height: 800 } });
  const externalRequests = await open(page);
  const point = await mapPoint(page, 16, 14);
  await page.touchscreen.tap(point.x, point.y);
  await expect(selected(page)).toHaveValue('bed-1');
  await page.getByRole('button', { name: 'Edit shapes' }).tap();
  const input = page.getByRole('textbox', { name: 'One X,Y pair per line' });
  await input.fill('11, 51\n16, 56');
  await page.getByRole('button', { name: 'Add rectangle' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.selection')).toHaveText('Sketch 1 · 4 vertices');
  await input.fill('11, 51\n17, 51\n18, 55\n12, 57');
  await page.getByRole('button', { name: 'Set vertices' }).focus();
  await page.keyboard.press('Enter');
  await expect(coordinates(page)).toContainText('18, 55');
  await input.fill('20, 60\n25, 60\n23, 63');
  await page.getByRole('button', { name: 'Add polygon' }).tap();
  await expect(page.locator('.selection')).toHaveText('Sketch 2 · 3 vertices');

  for (const [width, height] of [[375, 800], [768, 900], [1024, 900], [1440, 900], [800, 375]]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ fullPage: true, path: testInfo.outputPath(`editor-${width}x${height}.png`) });
  }
  expect(externalRequests).toEqual([]);
  await page.close();
});
