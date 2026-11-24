import { expect, test, type Page } from '@playwright/test';
import type Konva from 'konva';
import { apiRequest, loginWithDeterministicProject } from './utils';

async function rectangles(page: Page, prefix: string) {
  return page.evaluate(prefix => {
    const { stages } = (window as unknown as { Konva?: { stages: Konva.Stage[] } }).Konva ?? {};
    const stage = stages?.find(item => item.container()?.isConnected);
    if (!stage) return [];
    return stage.find('Rect').filter(node => String(node.getAttr('data-testid')).startsWith(prefix)).map(node => ({
      ...node.getAbsolutePosition(stage), width: node.width(), height: node.height(), fill: String(node.getAttr('fill')),
    }));
  }, prefix);
}

const free = (page: Page, kind: 'site' | 'parcel') => rectangles(page, `graphical-free-area-${kind}`);

async function selectLocation(page: Page, name: string, touch = false) {
  const select = page.getByRole('combobox', { name: 'Standort', exact: true });
  if (touch) await select.tap();
  else await select.click();
  const option = page.getByRole('option', { name, exact: true });
  if (touch) await option.tap();
  else await option.click();
}

function spacingControl(page: Page) {
  const trigger = page.getByRole('button', { name: 'Abstände', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Abstände (Wege)' });
  const toggle = dialog.getByRole('checkbox', { name: 'Freiflächen und Wege anzeigen' });
  return { trigger, toggle };
}

async function closePopover(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(0);
}

test('shows free shapes and the matching area figures without changing bed fills or positions', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, 'free-area-demo', { demoProject: true, loginAsAdmin: true });
  const writes: string[] = [];
  page.on('request', request => {
    if (request.method() !== 'GET' && /\/locations\/\d+\/(layouts\/)?$/.test(new URL(request.url()).pathname)) {
      writes.push(request.method());
    }
  });
  await page.goto('/app/fields-beds');
  await page.getByRole('button', { name: 'Grafik', exact: true }).click();
  await selectLocation(page, 'Hofgarten');
  await expect.poll(async () => (await rectangles(page, 'bed-rect-')).length).toBeGreaterThan(0);
  const beds = await rectangles(page, 'bed-rect-');
  expect(await free(page, 'site')).toEqual([]);
  expect(await free(page, 'parcel')).toEqual([]);

  const { trigger, toggle } = spacingControl(page);
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).not.toBeChecked();
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toBeChecked();
  await closePopover(page);
  await expect(trigger).toBeFocused();
  await expect.poll(async () => (await free(page, 'site')).length).toBeGreaterThan(0);
  const parcelShapes = await free(page, 'parcel');
  expect(parcelShapes.length).toBeGreaterThan(0);
  expect(await rectangles(page, 'bed-rect-')).toEqual(beds);
  const usableAreas = await rectangles(page, 'field-usable-area-');
  for (const shade of parcelShapes) {
    expect(usableAreas.some(parent => shade.x >= parent.x - 1e-6 && shade.y >= parent.y - 1e-6
      && shade.x + shade.width <= parent.x + parent.width + 1e-6
      && shade.y + shade.height <= parent.y + parent.height + 1e-6)).toBe(true);
    for (const bed of beds) {
      const overlapWidth = Math.min(shade.x + shade.width, bed.x + bed.width) - Math.max(shade.x, bed.x);
      const overlapHeight = Math.min(shade.y + shade.height, bed.y + bed.height) - Math.max(shade.y, bed.y);
      expect(overlapWidth < 0.000001 || overlapHeight < 0.000001).toBe(true);
    }
  }
  await page.screenshot({ path: testInfo.outputPath('free-areas-demo.png'), animations: 'disabled' });
  const info = page.getByRole('button', { name: 'Freiflächen', exact: true });
  await info.click();
  const summary = page.getByRole('dialog', { name: 'Freiflächen' });
  await expect(summary.getByText('Bruttofläche des Standorts 1.008 m²')).toBeVisible();
  await expect(summary.getByText('Fläche der Parzellen innerhalb des Standorts 510 m²')).toBeVisible();
  await expect(summary.getByText('Freifläche außerhalb der Parzellen 498 m²')).toBeVisible();
  await closePopover(page);

  await page.getByRole('button', { name: 'Hineinzoomen', exact: true }).first().click();
  await page.getByRole('button', { name: 'Ansicht nach links verschieben', exact: true }).click();
  expect(await free(page, 'parcel')).toEqual(parcelShapes);
  await selectLocation(page, 'Acker am Bach');
  await expect(info).toHaveCount(0);
  await selectLocation(page, 'Hofgarten');
  await expect(info).toBeVisible();
  await trigger.click();
  await toggle.uncheck();
  await closePopover(page);
  expect(await free(page, 'site')).toEqual([]);
  expect(writes).toEqual([]);
});

test.describe('free areas on touch', () => {
  test.use({ hasTouch: true, viewport: { width: 375, height: 800 } });

  test('shades a measured empty location and explains incomplete parcel geometry', async ({ page, request }, testInfo) => {
    await loginWithDeterministicProject(page, request, 'free-area-edge-cases', { loginAsAdmin: true });
    await apiRequest(page, 'POST', '/locations/', { name: 'Messbarer Leerstand', width_m: 10, length_m: 10 });
    const incomplete = await apiRequest<{ id: number }>(page, 'POST', '/locations/', { name: 'Unvollständiger Standort', width_m: 25, length_m: 30 });
    const parcel = await apiRequest<{ id: number }>(page, 'POST', '/fields/', {
      name: 'Fläche ohne Maße', location: incomplete.id, area_sqm: 48,
    });
    await page.goto('/app/fields-beds');
    await page.getByRole('button', { name: 'Grafik', exact: true }).tap();
    await selectLocation(page, 'Messbarer Leerstand', true);
    const { trigger, toggle } = spacingControl(page);
    await trigger.tap();
    await toggle.tap();
    await expect(toggle).toBeChecked();
    await closePopover(page);
    await expect.poll(async () => (await free(page, 'site')).length).toBe(1);
    expect(await free(page, 'parcel')).toEqual([]);
    await page.getByRole('button', { name: 'Freiflächen', exact: true }).tap();
    const summary = page.getByRole('dialog', { name: 'Freiflächen' });
    await expect(summary.getByText('Freifläche außerhalb der Parzellen 100 m²')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('free-areas-empty-mobile.png'), animations: 'disabled' });
    await closePopover(page);

    await selectLocation(page, 'Unvollständiger Standort', true);
    await trigger.tap();
    await expect(toggle).not.toBeChecked();
    await toggle.tap();
    await closePopover(page);
    await page.getByRole('button', { name: 'Freiflächen teilweise nicht messbar' }).tap();
    await expect(summary.getByText('Für die Freiflächen des Standorts werden genaue Standort- und Parzellenumrisse benötigt.')).toBeVisible();
    await expect(summary.getByText('Einige Parzellen sind wegen fehlender Maße ohne Freiflächenschattierung.')).toBeVisible();
    expect(await free(page, 'site')).toEqual([]);
    expect(await free(page, 'parcel')).toEqual([]);
    await closePopover(page);

    await apiRequest(page, 'PATCH', `/fields/${parcel.id}/`, { width_m: 6, length_m: 8 });
    await page.reload();
    await trigger.tap();
    await expect(toggle).not.toBeChecked();
    await toggle.tap();
    await closePopover(page);
    await expect.poll(async () => (await free(page, 'parcel')).length).toBe(1);
    await page.getByRole('button', { name: 'Freiflächen', exact: true }).tap();
    await expect(summary.getByText('Freifläche außerhalb der Parzellen 702 m²')).toBeVisible();
    await closePopover(page);

    await apiRequest(page, 'POST', '/beds/', { name: 'Beet ohne Maße', field: parcel.id, area_sqm: 6 });
    await page.reload();
    await trigger.tap();
    await toggle.tap();
    await closePopover(page);
    await page.getByRole('button', { name: 'Freiflächen teilweise nicht messbar' }).tap();
    await expect(summary.getByText('Einige Beete haben keine vollständigen Maße. Die Freiflächen ihrer Parzellen bleiben ungeschattet.')).toBeVisible();
    await expect(summary.getByText('Einige Parzellen sind wegen fehlender Maße ohne Freiflächenschattierung.')).toHaveCount(0);
    expect(await free(page, 'parcel')).toEqual([]);
    expect((await free(page, 'site')).length).toBeGreaterThan(0);
  });
});
