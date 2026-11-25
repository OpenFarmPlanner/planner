import { expect, test, type Page } from '@playwright/test';
import type Konva from 'konva';
import { activateCanvasTool, apiRequest, loginWithDeterministicProject } from './utils';

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

async function closePopover(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(0);
}

test('shows free shapes and the matching area figures without changing bed fills or positions', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, 'free-area-demo', { demoProject: true, loginAsAdmin: true });
  const { results: locations } = await apiRequest<{ results: { id: number; name: string }[] }>(page, 'GET', '/locations/');
  const hofgarten = locations.find(location => location.name === 'Hofgarten')!;
  const writes: string[] = [];
  page.on('request', request => {
    if (request.method() !== 'GET' && /\/(locations|fields|beds)\/\d+\/(layouts\/)?$/.test(new URL(request.url()).pathname)) {
      writes.push(request.method());
    }
  });
  await page.goto('/app/fields-beds');
  await page.getByRole('button', { name: 'Grafik', exact: true }).click();
  await selectLocation(page, 'Hofgarten');
  await expect.poll(async () => (await rectangles(page, 'bed-rect-')).length).toBeGreaterThan(0);
  const beds = await rectangles(page, 'bed-rect-');
  await expect(page.getByRole('button', { name: /^Freiflächen/ })).toHaveCount(0);
  const trigger = page.getByRole('button', { name: 'Abstände', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const spacing = page.getByRole('dialog', { name: 'Abstände (Wege)' });
  await expect(spacing.getByRole('checkbox', { name: /einrasten/i })).toBeVisible();
  await expect(spacing.getByRole('checkbox', { name: /Freiflächen/ })).toHaveCount(0);
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
  await page.getByRole('button', { name: 'Hilfe zu Anbauflächen öffnen' }).click();
  await expect(page.getByText('Hellblau zeigt freie Fläche außerhalb von Parzellen.')).toBeVisible();
  await expect(page.getByText('Hellgrün zeigt freie Fläche innerhalb von Parzellen, außerhalb der Beete.')).toBeVisible();
  await closePopover(page);

  await page.getByRole('button', { name: 'Hineinzoomen', exact: true }).first().click();
  await activateCanvasTool(page, 'Ansicht nach links verschieben');
  expect(await free(page, 'parcel')).toEqual(parcelShapes);
  await selectLocation(page, 'Acker am Bach');
  await expect.poll(async () => (await free(page, 'site')).length).toBeGreaterThan(0);
  await selectLocation(page, 'Hofgarten');
  await page.reload();
  await expect.poll(async () => (await free(page, 'parcel')).length).toBe(parcelShapes.length);
  await page.getByRole('button', { name: 'Vollbild öffnen' }).click();
  await expect.poll(async () => (await free(page, 'parcel')).length).toBe(parcelShapes.length);
  await page.getByRole('button', { name: 'Vollbild schließen' }).click();
  await expect.poll(async () => (await free(page, 'parcel')).length).toBe(parcelShapes.length);

  await page.getByRole('button', { name: 'Liste', exact: true }).click();
  await page.locator(`[role="row"][data-id="location-${hofgarten.id}"]`).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Standortdetails' }).click();
  await expect(page.getByTestId('detail-area')).toContainText('1.008 m²');
  await expect(page.getByTestId('detail-covered-area')).toContainText('510 m²');
  await expect(page.getByTestId('detail-remaining-area')).toContainText(/498 m² \(49,4\s?%\)/);
  await page.screenshot({ path: testInfo.outputPath('free-areas-location-details.png'), animations: 'disabled' });
  expect(writes).toEqual([]);
});

test.describe('free areas on touch', () => {
  test.use({ hasTouch: true, viewport: { width: 375, height: 800 } });

  test('shades a measured empty location and explains incomplete parcel geometry', async ({ page, request }, testInfo) => {
    await loginWithDeterministicProject(page, request, 'free-area-edge-cases', { loginAsAdmin: true });
    const empty = await apiRequest<{ id: number }>(page, 'POST', '/locations/', { name: 'Messbarer Leerstand', width_m: 10, length_m: 10 });
    const incomplete = await apiRequest<{ id: number }>(page, 'POST', '/locations/', { name: 'Unvollständiger Standort', width_m: 25, length_m: 30 });
    const parcel = await apiRequest<{ id: number }>(page, 'POST', '/fields/', {
      name: 'Fläche ohne Maße', location: incomplete.id, area_sqm: 48,
    });
    await page.goto('/app/fields-beds');
    await page.getByRole('button', { name: 'Grafik', exact: true }).tap();
    await selectLocation(page, 'Messbarer Leerstand', true);
    await expect.poll(async () => (await free(page, 'site')).length).toBe(1);
    expect(await free(page, 'parcel')).toEqual([]);
    await expect(page.getByText(/Dieser Standort hat noch keine Parzellen/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('free-areas-empty-mobile.png'), animations: 'disabled' });
    await selectLocation(page, 'Unvollständiger Standort', true);
    await expect.poll(async () => (await rectangles(page, `field-rect-${parcel.id}`)).length).toBe(1);
    await expect.poll(() => free(page, 'site')).toEqual([]);
    expect(await free(page, 'parcel')).toEqual([]);

    await page.goto(`/app/fields-beds/locations/${empty.id}`);
    await expect(page.getByTestId('detail-covered-area')).toContainText('0 m²');
    await expect(page.getByTestId('detail-remaining-area')).toContainText(/100 m² \(100\s?%\)/);
    await page.goto(`/app/fields-beds/locations/${incomplete.id}`);
    await expect(page.getByText(/Für die Flächenberechnung fehlen Standort- oder Parzellenmaße/)).toBeVisible();

    await apiRequest(page, 'PATCH', `/fields/${parcel.id}/`, { width_m: 6, length_m: 8 });
    await page.reload();
    await expect(page.getByTestId('detail-remaining-area')).toContainText('702 m²');
    await page.screenshot({ path: testInfo.outputPath('free-areas-location-details-mobile.png'), animations: 'disabled' });

    await apiRequest(page, 'POST', '/beds/', { name: 'Beet ohne Maße', field: parcel.id, area_sqm: 6 });
    await page.goto(`/app/fields-beds/fields/${parcel.id}`);
    await expect(page.getByText('Für die Flächenberechnung fehlen Maße der Parzelle oder ihrer Beete.')).toBeVisible();
    await page.goto('/app/fields-beds');
    await page.getByRole('button', { name: 'Grafik', exact: true }).tap();
    await selectLocation(page, 'Unvollständiger Standort', true);
    await expect.poll(async () => (await free(page, 'site')).length).toBeGreaterThan(0);
    expect(await free(page, 'parcel')).toEqual([]);
  });
});
