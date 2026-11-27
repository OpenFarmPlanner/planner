import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type Konva from 'konva';
import type { Crop, Field, IndividualPlantPosition, PaginatedResponse, PlantingPlan, Task } from '../src/api/types';
import { apiRequest, loginWithDeterministicProject, selectGraphicDisplay } from './utils';

test.use({ serviceWorkers: 'block' });

const overdueTitle = 'Einzelpflanzen vereinzeln';
const upcomingTitle = 'Einzelpflanzen mulchen';
const unlinkedTitle = 'Parzellenweg pflegen';
const date = '2026-05-15';
const stemTarget = (page: Page, id: string) => page.locator(`[data-graphical-object-target="plant:${id}"]`);
const preview = (page: Page) => page.getByTestId('graphical-object-preview');
type SavedPlantPlan = PlantingPlan & { id: number; individual_positions: IndividualPlantPosition[] };

async function fixture(page: Page, request: APIRequestContext, scenario: string, withTasks = false) {
  await page.clock.setFixedTime(new Date(2026, 4, 15, 12));
  await loginWithDeterministicProject(page, request, scenario, { demoProject: true, demoYear: 2026, loginAsAdmin: true });
  const { results: fields } = await apiRequest<PaginatedResponse<Field>>(page, 'GET', '/fields/');
  const parcel = fields.find(field => field.name === 'Frühbeete Nord')!;
  const { results: individual } = await apiRequest<PaginatedResponse<SavedPlantPlan>>(page, 'GET', `/planting-plans/?individual_location=${parcel.location}`);
  const orchard = individual.find(plan => plan.parcel === parcel.id)!;
  const { results: crops } = await apiRequest<PaginatedResponse<Crop>>(page, 'GET', '/crops/');
  const annual = crops.find(crop => crop.name === 'Rote Rübe') ?? crops.find(crop => crop.name === 'Karotte')!;
  const areaCrop = crops.find(crop => crop.name === 'Salat')!;
  const bed = await apiRequest<{ id: number; name: string }>(page, 'POST', '/beds/', {
    field: parcel.id, name: 'Mischbeet für Einzelpflanzen', width_m: 4, length_m: 6,
  });
  const area = await apiRequest<SavedPlantPlan>(page, 'POST', '/planting-plans/', {
    bed: bed.id, crop: areaCrop.id, season: orchard.season, planting_date: '2026-05-01',
    cultivation_type: 'direct_sowing', area_usage_sqm: 4,
  });
  const plan = await apiRequest<SavedPlantPlan>(page, 'POST', '/planting-plans/', {
    bed: bed.id, crop: annual.id, season: orchard.season, placement_mode: 'individual_bed',
    planting_date: '2026-05-01', harvest_date: '2026-06-02', harvest_end_date: '2026-06-20',
    cultivation_type: 'direct_sowing', individual_positions: [{ x_m: 1.2, y_m: 1.4 }, { x_m: 2.8, y_m: 4.7 }],
  });
  if (withTasks) {
    for (const id of [plan.id, area.id]) {
      const { results } = await apiRequest<PaginatedResponse<Task>>(page, 'GET', `/tasks/?planting_plan=${id}`);
      for (const task of results.filter(task => task.planting_plan === id && ['pending', 'in_progress'].includes(task.status))) {
        await apiRequest(page, 'PATCH', `/tasks/${task.id}/`, { status: 'completed' });
      }
    }
    for (const [title, due_date, planting_plan, status] of [
      [overdueTitle, '2026-05-12', plan.id, 'pending'],
      [upcomingTitle, '2026-05-17', plan.id, 'pending'],
      ['Einzelpflanzen bewässern', '2026-05-13', plan.id, 'completed'],
      [unlinkedTitle, '2026-05-11', null, 'pending'],
    ] as const) {
      await apiRequest(page, 'POST', '/tasks/', { title, due_date, planting_plan, status,
        field: planting_plan ? null : parcel.id, season: orchard.season, description: '', assigned_to: null });
    }
  }
  return { orchard, bed, plan, area };
}

async function openGraphic(page: Page) {
  await page.goto('/app/fields-beds');
  await page.getByRole('button', { name: 'Grafik', exact: true }).click();
  await page.getByRole('combobox', { name: /^Standort(?: · .+)?$/ }).click();
  await page.getByRole('option', { name: 'Hofgarten', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Standort: Hofgarten' })).toBeVisible();
}

async function shape(page: Page, key: string) {
  return page.evaluate(key => {
    const stage = (window as unknown as { Konva?: { stages: Konva.Stage[] } }).Konva?.stages
      .find(item => item.container()?.isConnected);
    const node = stage?.find('Circle, Ellipse, Rect, Group').find(item => item.getAttr('data-testid') === key);
    if (!stage || !node) return null;
    const bounds = node.getClientRect();
    const canvas = stage.container().getBoundingClientRect();
    return {
      x: bounds.x + canvas.x + bounds.width / 2,
      y: bounds.y + canvas.y + bounds.height / 2,
      world: node.getAbsolutePosition(stage),
      radius: node.getAttr('radius') ?? null,
      urgency: node.getAttr('data-task-urgency') ?? null,
      phase: node.getAttr('data-crop-phase') ?? null,
      fill: node.getAttr('fill') ?? null,
      listening: node.listening(),
    };
  }, key);
}

const stem = (page: Page, id: string) => shape(page, `individual-stem-${id}`);

async function point(page: Page, id: string) {
  await expect.poll(() => stem(page, id)).not.toBeNull();
  const { x, y } = (await stem(page, id))!;
  return { x, y };
}

async function clickStem(page: Page, id: string, button: 'left' | 'right' = 'left') {
  const { x, y } = await point(page, id);
  await page.mouse.click(x, y, { button });
}

async function setCropDate(page: Page, value: string) {
  await page.getByRole('button', { name: /^Stichtag für Kulturen · / }).click();
  const dialog = page.getByRole('dialog', { name: 'Stichtag für Kulturen' });
  await dialog.getByRole('button', { name: 'Stichtag', exact: true }).click();
  await dialog.locator('input[type="date"]').fill(value);
  await page.keyboard.press('Escape');
}

test('shows phases and shared plan tasks on orchard and mixed-bed markers in all modes', async ({ page, request }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { orchard, bed, plan, area } = await fixture(page, request, 'individual-display-tasks', true);
  const [first, second] = plan.individual_positions;
  const [apple] = orchard.individual_positions;
  await openGraphic(page);
  await selectGraphicDisplay(page, 'Anbauflächen');
  await expect.poll(() => stem(page, first.id)).toMatchObject({ urgency: null, phase: null, listening: true });
  const neutral = (await stem(page, first.id))!.fill;
  expect(await shape(page, `individual-canopy-${first.id}`)).toBeNull();
  await expect.poll(() => shape(page, `individual-canopy-${apple.id}`)).toMatchObject({ listening: false });
  const canopy = (await shape(page, `individual-canopy-${apple.id}`))!;
  const appleShape = (await stem(page, apple.id))!;
  const appleParcel = (await shape(page, `field-rect-${orchard.parcel}`))!;
  const bedShape = (await shape(page, `bed-rect-${bed.id}`))!;
  const firstShape = (await stem(page, first.id))!;
  expect(canopy.radius).toBeCloseTo(Number(orchard.estimated_canopy_diameter_m) * 18 / 2);
  expect(canopy.world).toEqual(appleShape.world);
  expect(appleShape.world.y - appleParcel.world.y).toBeCloseTo(Number(apple.x_m) * 18);
  expect(firstShape.world.y - bedShape.world.y).toBeCloseTo(Number(first.x_m) * 18);
  expect(firstShape.world.x - bedShape.world.x).toBeCloseTo((6 - Number(first.y_m)) * 18);
  await selectGraphicDisplay(page, 'Kulturen');
  await expect.poll(() => stem(page, first.id)).toMatchObject({ phase: 'growth', urgency: null });
  expect((await stem(page, first.id))!.fill).not.toBe(neutral);
  await setCropDate(page, '2026-04-25');
  await expect(stemTarget(page, first.id)).toHaveCount(0);
  expect(plan.harvest_date).toBeTruthy();
  await setCropDate(page, plan.harvest_date!);
  await expect.poll(() => stem(page, first.id)).toMatchObject({ phase: 'harvest', urgency: null });
  await page.getByRole('button', { name: /^Stichtag für Kulturen · / }).click();
  await page.getByRole('button', { name: 'Ganze Saison', exact: true }).click();
  await expect.poll(() => stem(page, first.id)).toMatchObject({ phase: null, urgency: null });

  await selectGraphicDisplay(page, 'Aufgaben');
  await expect.poll(() => stem(page, first.id)).toMatchObject({ phase: null, urgency: 'overdue' });
  await expect.poll(() => stem(page, second.id)).toMatchObject({ urgency: 'overdue' });
  await expect.poll(() => shape(page, `bed-rect-${bed.id}`)).toMatchObject({ urgency: 'overdue' });
  await expect.poll(() => stem(page, apple.id)).toMatchObject({ urgency: null });
  const overdueFill = (await stem(page, first.id))!.fill;
  await selectGraphicDisplay(page, 'Kulturen & Aufgaben');
  await setCropDate(page, date);
  await expect.poll(() => stem(page, first.id)).toMatchObject({ phase: 'growth', urgency: 'overdue', fill: overdueFill });
  const position = await point(page, first.id);
  await expect.poll(() => page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, position)).toBe('CANVAS');
  await page.mouse.move(position.x, position.y);
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toContainText('Pflanze 1 von 2');
  await expect(tooltip).toContainText(overdueTitle);
  await expect(tooltip).toContainText('Geplantes Wachstum');
  await expect(tooltip).toContainText('Überfällig');
  await expect(tooltip).toContainText('12.5.2026');
  await expect(tooltip).not.toContainText(unlinkedTitle);
  await expect(tooltip.getByRole('button')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('individual-task-tooltip.png') });
  await clickStem(page, first.id);
  await expect(preview(page)).toContainText('Pflanze 1 von 2');
  await expect(preview(page)).toContainText(bed.name);
  await expect(preview(page).getByText(overdueTitle, { exact: true })).toHaveCount(1);
  await expect(preview(page)).not.toContainText(unlinkedTitle);
  await expect(tooltip).toHaveCount(0);
  const writes: string[] = [];
  page.on('request', request => {
    if (request.method() === 'PATCH' && new URL(request.url()).pathname.includes('/tasks/')) writes.push(request.url());
  });
  await preview(page).getByRole('button', { name: new RegExp(overdueTitle) }).click();
  await expect.poll(() => stem(page, second.id)).toMatchObject({ urgency: 'upcoming' });
  await preview(page).getByRole('button', { name: new RegExp(upcomingTitle) }).click();
  await expect.poll(() => stem(page, first.id)).toMatchObject({ urgency: null, fill: neutral });
  await expect.poll(() => shape(page, `bed-rect-${bed.id}`)).toMatchObject({ urgency: null });
  expect(writes).toHaveLength(2);
  await page.keyboard.press('Escape');
  await expect.poll(() => stem(page, first.id)).toMatchObject({ phase: 'growth', urgency: null, fill: neutral });
  await page.reload();
  await expect.poll(() => stem(page, first.id)).toMatchObject({ phase: 'growth', urgency: null, fill: neutral });
  const anchor = await point(page, apple.id);
  await page.mouse.move(anchor.x, anchor.y);
  for (let index = 0; index < 5; index += 1) await page.mouse.wheel(0, -140);
  const hasLabel = async (positions: IndividualPlantPosition[]) => (await Promise.all(positions.map(position =>
    shape(page, `individual-label-${position.id}`)))).some(label => label?.listening === false);
  await expect.poll(() => hasLabel(orchard.individual_positions)).toBe(true);
  await expect.poll(() => hasLabel(plan.individual_positions)).toBe(true);
  await page.screenshot({ path: info.outputPath('individual-crop-labels-zoom.png') });
  expect(await apiRequest(page, 'GET', `/planting-plans/${area.id}/`)).toMatchObject({ placement_mode: 'area' });
});

test('opens exact plan actions by keyboard and saves a position removal through the draft', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { plan, bed } = await fixture(page, request, 'individual-display-context');
  const [first, second] = plan.individual_positions;
  await openGraphic(page);
  await expect(stemTarget(page, first.id)).toHaveAccessibleName(/Pflanze 1 von 2/);
  await stemTarget(page, first.id).focus();
  await page.keyboard.press('ArrowRight');
  await expect(stemTarget(page, second.id)).toBeFocused();
  await page.keyboard.press('Shift+F10');
  const menu = page.getByRole('menu');
  for (const label of ['Anbauplan-Details', 'Zur Kultur', 'Einzelpflanzen bearbeiten', 'Neue Stammposition', 'Position entfernen']) {
    await expect(menu.getByRole('menuitem', { name: label, exact: true })).toBeVisible();
  }
  await menu.getByRole('menuitem', { name: 'Position entfernen' }).click();
  const panel = page.getByRole('region', { name: 'Einzelpflanzen', exact: true });
  await expect(panel.getByTestId('individual-plants-parcel')).toContainText(bed.name);
  await expect(panel.getByText('1 Einzelpflanze', { exact: true })).toBeVisible();
  const read = () => apiRequest<SavedPlantPlan>(page, 'GET', `/planting-plans/${plan.id}/`);
  expect((await read()).individual_positions).toEqual(plan.individual_positions);
  await panel.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect.poll(async () => (await read()).individual_positions).toEqual([first]);
  await expect(panel.getByRole('button', { name: 'Positionen bearbeiten' })).toBeVisible();
  await panel.getByRole('button', { name: 'Schließen' }).click();
  await clickStem(page, first.id, 'right');
  await expect(menu.getByRole('menuitem', { name: 'Position entfernen' })).toBeDisabled();
  await menu.getByRole('menuitem', { name: 'Neue Stammposition' }).click();
  await expect(panel.getByRole('button', { name: 'Platzierung beenden' })).toBeVisible();
  await panel.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await panel.getByRole('button', { name: 'Schließen' }).click();
  await page.reload();
  await expect(stemTarget(page, first.id)).toHaveAccessibleName(/Pflanze 1 von 1/);
  await expect(stemTarget(page, second.id)).toHaveCount(0);
  await stemTarget(page, first.id).press('Shift+F10');
  await menu.getByRole('menuitem', { name: 'Anbauplan-Details' }).click();
  await expect(page).toHaveURL(new RegExp(`/app/planting-plans/${plan.id}$`));
});

test('labels the orchard marker and accessible preview in all seven languages', async ({ page, request }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  const { orchard } = await fixture(page, request, 'individual-display-locales');
  const [apple] = orchard.individual_positions;
  await openGraphic(page);
  await selectGraphicDisplay(page, 'Anbauflächen');
  for (const [locale, expected] of Object.entries({
    de: 'Pflanze 1 von 3', en: 'Plant 1 of 3', es: 'Planta 1 de 3', fr: 'Plant 1 sur 3',
    it: 'Pianta 1 di 3', nl: 'Plant 1 van 3', pt: 'Planta 1 de 3',
  })) {
    await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: locale });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(stemTarget(page, apple.id)).toHaveAccessibleName(new RegExp(expected));
    await stemTarget(page, apple.id).press('Enter');
    await expect(preview(page)).toContainText(expected);
    await page.keyboard.press('Escape');
  }
});

test.describe('on a touch phone', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 800 } });

  test('opens the orchard preview on tap and the grouped actions on a long press', async ({ page, request }, info) => {
    const { orchard } = await fixture(page, request, 'individual-display-touch');
    await openGraphic(page);
    const [apple] = orchard.individual_positions;
    const { x, y } = await point(page, apple.id);
    await page.touchscreen.tap(x, y);
    await expect(preview(page)).toContainText('Pflanze 1 von 3');
    await expect(preview(page)).toHaveAccessibleName(/Apfel.*Topaz/);
    await expect(preview(page)).toContainText('Keine offenen Aufgaben für diesen Anbauplan.');
    await page.screenshot({ path: info.outputPath('individual-orchard-preview-phone.png') });
    await preview(page).getByRole('button', { name: 'Schließen', exact: true }).tap();
    const touch = await page.context().newCDPSession(page);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: 'Einzelpflanzen bearbeiten', exact: true })).toBeVisible();
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(menu.getByRole('menuitem', { name: 'Anbauplan-Details' })).toBeVisible();
    await expect(preview(page)).toHaveCount(0);
  });
});
