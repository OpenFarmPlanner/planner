import { expect, test, type Page } from '@playwright/test';
import type Konva from 'konva';
import type { LocationLayoutsResponse, PaginatedResponse, YoungPlantDemand } from '../src/api/types';
import { apiRequest, loginWithDeterministicProject, toggleGraphicEdit } from './utils';

type Stem = { id: string; x_m: number; y_m: number };
type Plan = {
  id: number; parcel: number | null; parcel_location_id: number; bed: number | null;
  site?: number | null;
  placement_mode: 'area' | 'individual_bed' | 'individual_parcel' | 'individual_site';
  individual_positions: Stem[]; plants_count: number; estimated_canopy_diameter_m: string;
  season: number; updated_at: string;
};

async function shape(page: Page, testId: string) {
  return page.evaluate(testId => {
    const konva = (window as unknown as { Konva?: { stages: Konva.Stage[] } }).Konva;
    const stage = konva?.stages.find(item => item.container()?.isConnected);
    const node = stage?.find('Circle, Ellipse, Rect, Group')
      .find(item => item.getAttr('data-testid') === testId);
    if (!stage || !node) return null;
    const bounds = node.getClientRect();
    const container = stage.container().getBoundingClientRect();
    return {
      world: node.getAbsolutePosition(stage),
      screen: { x: bounds.x + container.x, y: bounds.y + container.y, width: bounds.width, height: bounds.height },
      x_m: node.getAttr('data-x-m') as number | undefined,
      y_m: node.getAttr('data-y-m') as number | undefined,
      listened: node.listening(),
    };
  }, testId);
}

async function individualPlans(page: Page, locationId: number) {
  const data = await apiRequest<{ results: Plan[] }>(
    page, 'GET', `/planting-plans/?individual_location=${locationId}`,
  );
  return data.results;
}

test.use({ serviceWorkers: 'block' });

test('places stems at three actual parents in one operation and reassigns a dragged stem', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.setFixedTime(new Date(2026, 4, 15, 12));
  await loginWithDeterministicProject(page, request, 'graphic-free-placement', {
    demoProject: true, demoYear: 2026, loginAsAdmin: true,
  });
  const { results: locations } = await apiRequest<{ results: { id: number; name: string }[] }>(page, 'GET', '/locations/');
  const { results: fields } = await apiRequest<{ results: { id: number; name: string }[] }>(page, 'GET', '/fields/');
  const { results: beds } = await apiRequest<{ results: { id: number; name: string }[] }>(page, 'GET', '/beds/');
  const site = locations.find(location => location.name === 'Hofgarten')!;
  const parcel = fields.find(field => field.name === 'Frühbeete Nord')!;
  const bed = beds.find(bed => bed.name === 'Salat 1')!;
  await apiRequest(page, 'POST', '/crops/', {
    name: 'Einzelpflanzen für freie Platzierung', life_cycle: 'annual', cultivation_types: ['direct_sowing'],
  });
  await page.goto('/app/fields-beds');
  await page.getByRole('button', { name: 'Grafik', exact: true }).click();
  await page.getByRole('combobox', { name: /^Standort(?: · .+)?$/ }).click();
  await page.getByRole('option', { name: 'Hofgarten', exact: true }).click();
  const toolbar = page.getByTestId('graphical-canvas-tools');
  const tools = toolbar.getByRole('button', { name: /^(Weitere Grafikwerkzeuge|Einzelpflanzen hinzufügen)$/ });
  const hasMenu = await tools.getAttribute('aria-haspopup') === 'menu';
  await tools.press('Enter');
  if (hasMenu) await page.getByRole('menuitem', { name: 'Einzelpflanzen hinzufügen', exact: true }).press('Enter');
  const panel = page.getByRole('region', { name: 'Einzelpflanzen', exact: true });
  await panel.getByRole('combobox', { name: 'Kultur (Sorte)', exact: true }).click();
  await page.getByRole('option', { name: 'Einzelpflanzen für freie Platzierung', exact: true }).click();
  const scenePoint = async (id: string, relativeX: number, relativeY: number) => {
    await expect.poll(() => shape(page, id)).not.toBeNull();
    const { screen } = (await shape(page, id))!;
    return { x: screen.x + screen.width * relativeX, y: screen.y + screen.height * relativeY };
  };
  for (const [key, name, x, y] of [
    [`location-boundary-${site.id}`, site.name, 0.50, 0.90],
    [`field-rect-${parcel.id}`, parcel.name, 0.25, 0.72],
    [`bed-rect-${bed.id}`, bed.name, 0.50, 0.50],
  ] as const) {
    const at = await scenePoint(key, x, y);
    await expect.poll(() => page.evaluate(point => document.elementFromPoint(point.x, point.y)?.tagName, at)).toBe('CANVAS');
    await page.mouse.move(at.x, at.y);
    await expect(panel.getByRole('status').filter({ hasText: `Anbaufläche · ${name}` })).toBeVisible();
    await page.mouse.click(at.x, at.y);
  }
  await expect(panel.getByRole('list', { name: 'Pflanzen nach Anbaufläche' }).getByRole('listitem')).toHaveCount(3);
  await panel.getByRole('button', { name: 'Platzierung beenden', exact: true }).click();
  const save = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/graphic-placement/'));
  await panel.getByRole('button', { name: 'Speichern', exact: true }).click();
  const saved = await save;
  expect(saved.status(), await saved.text()).toBe(200);
  const { plans } = await saved.json() as { plans: Plan[] };
  expect(plans.map(plan => plan.placement_mode)).toEqual(['individual_site', 'individual_parcel', 'individual_bed']);
  const original = plans[0];
  const stem = original.individual_positions[0];
  await toggleGraphicEdit(page);
  const from = await scenePoint(`individual-stem-${stem.id}`, 0.5, 0.5);
  const to = await scenePoint(`field-rect-${parcel.id}`, 0.25, 0.72);
  const moving = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/graphic-move/'));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  const moved = await moving;
  expect(moved.status(), await moved.text()).toBe(200);
  const updated = await apiRequest<Plan>(page, 'GET', `/planting-plans/${original.id}/`);
  expect(updated).toMatchObject({ placement_mode: 'individual_parcel', parcel: parcel.id, site: null, plants_count: 1 });
  expect(updated.individual_positions[0].id).toBe(stem.id);
  await page.reload();
  await expect.poll(() => shape(page, `individual-stem-${stem.id}`)).not.toBeNull();
});

test('creates, drags and edits stems with the keyboard and keeps the parcel offsets', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.setFixedTime(new Date(2026, 4, 15, 12));
  await loginWithDeterministicProject(page, request, 'individual-plants-desktop', { loginAsAdmin: true });
  const { results: [location] } = await apiRequest<{ results: { id: number }[] }>(page, 'GET', '/locations/');
  await apiRequest(page, 'PATCH', `/locations/${location.id}/`, { width_m: 24, length_m: 30 });
  const plot = await apiRequest<{ id: number }>(page, 'POST', '/fields/', {
    location: location.id, name: 'Obstparzelle', width_m: 14, length_m: 20, light_condition: 'shade',
  });
  const adjacentBed = await apiRequest<{ id: number }>(page, 'POST', '/beds/', {
    field: plot.id, name: 'Gemüsebeet', width_m: 1.2, length_m: 6,
  });
  const season = await apiRequest<{ id: number }>(page, 'POST', '/seasons/', { start_date: '2026-01-01', end_date: '2026-12-31' });
  const apple = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: 'Apfel', life_cycle: 'perennial', standing_time_years: 15,
    distance_within_row_cm: 400, estimated_canopy_diameter_m: 3.8,
    cultivation_types: ['pre_cultivation'], light_requirement: ['full_sun'],
  });
  const rhubarb = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: 'Rhabarber', life_cycle: 'perennial', standing_time_years: 8, cultivation_types: ['pre_cultivation'],
  });
  const otherPlan = await apiRequest<Plan>(page, 'POST', '/planting-plans/', {
    season: season.id, crop: rhubarb.id, parcel: plot.id, planting_date: '2026-05-01',
    cultivation_type: 'pre_cultivation', individual_positions: [{ x_m: 10, y_m: 15 }],
  });
  const projectId = await page.evaluate(() => localStorage.getItem('activeProjectId'));
  expect(projectId).toBeTruthy();
  // Share only the session cookie with the browser. Read from the API with explicit scope.
  const readBackend = async <T>(path: string): Promise<T> => {
    const response = await page.request.get(`/api${path}`, {
      headers: { 'X-Project-Id': String(projectId), 'X-Season-Id': String(season.id) },
    });
    expect(response.ok(), `GET ${path} returned ${response.status()}`).toBeTruthy();
    return response.json();
  };
  const appleDemand = async () => (await readBackend<PaginatedResponse<YoungPlantDemand>>('/young-plant-demand/'))
    .results.find(row => row.crop_id === apple.id);

  await page.goto('/app/fields-beds');
  await page.getByRole('button', { name: 'Grafik', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Einzelpflanzen', exact: true });
  const plotTarget = page.locator(`[data-graphical-object-target="field:${plot.id}"]`);
  await plotTarget.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Einzelpflanzen hinzufügen', exact: true }).press('Enter');
  await expect(panel.getByTestId('individual-plants-parcel')).toHaveText(/Obstparzelle/);
  await expect(panel.getByRole('heading', { name: 'Anbauplan', level: 3 })).toBeVisible();
  await expect(panel.getByText(/Der Punkt zeigt die Stammposition/)).toHaveCount(0);
  await expect(panel.getByRole('heading', { name: 'Platzierung', level: 3 })).toBeVisible();
  // A crop without a canopy estimate keeps the diameter behind an optional disclosure.
  await panel.getByRole('combobox', { name: 'Kultur (Sorte)', exact: true }).click();
  await page.getByRole('option', { name: 'Rhabarber', exact: true }).click();
  await expect(panel.getByRole('textbox', { name: /Kronendurchmesser/ })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Kronendurchmesser angeben (optional)' }).click();
  await expect(panel.getByRole('textbox', { name: /Kronendurchmesser/ })).toHaveValue('');
  await panel.getByRole('combobox', { name: 'Kultur (Sorte)', exact: true }).click();
  await page.getByRole('option', { name: 'Apfel', exact: true }).click();
  await expect(panel.getByRole('textbox', { name: /Kronendurchmesser/ })).toHaveValue('3,8');
  await expect(panel.getByRole('button', { name: 'Platzierung beenden', exact: true })).toBeVisible();
  await expect(panel.getByText('0 Einzelpflanzen', { exact: true })).toBeVisible();

  // Manual coordinates start collapsed and open with the keyboard.
  const manual = panel.getByRole('button', { name: 'Koordinaten manuell eingeben' });
  await expect(manual).toHaveAttribute('aria-expanded', 'false');
  await expect(panel.getByRole('textbox', { name: 'X (m)', exact: true })).toBeHidden();
  await manual.focus();
  await page.keyboard.press('Enter');
  await expect(manual).toHaveAttribute('aria-expanded', 'true');

  for (const [index, coordinates] of [['3,5', '3'], ['3,5', '6,4']].entries()) {
    if (index) await panel.getByRole('button', { name: 'Neue Stammposition' }).click();
    await panel.getByRole('textbox', { name: 'X (m)', exact: true }).fill(coordinates[0]);
    await panel.getByRole('textbox', { name: 'Y (m)', exact: true }).fill(coordinates[1]);
    await panel.getByRole('button', { name: 'Position hinzufügen' }).focus();
    await page.keyboard.press('Enter');
  }
  await expect(panel.getByText(/kleinste Stammabstand beträgt 3,4 m/)).toBeVisible();
  await expect(panel.getByText('2 Einzelpflanzen', { exact: true })).toBeVisible();
  const draftStem = await shape(page, 'individual-stem-new-0');
  expect(draftStem).not.toBeNull();
  const firstRow = panel.getByRole('button', { name: 'Stamm 1', exact: true });
  await firstRow.click();
  await expect(firstRow).toHaveAttribute('aria-pressed', 'true');
  await firstRow.press('Escape');
  await expect(panel.getByRole('button', { name: 'Pflanzen in der Grafik platzieren' })).toBeVisible();
  const saveButton = panel.getByRole('button', { name: 'Speichern', exact: true });
  const editPositions = panel.getByRole('button', { name: 'Positionen bearbeiten' });
  const [creation] = await Promise.all([
    page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/planting-plans/graphic-placement/'),
    saveButton.click(),
  ]);
  expect(creation.status()).toBe(200);
  await expect(editPositions).toBeVisible();
  await expect(panel.getByTestId('site-suitability-hints')).toContainText('Für die Parzelle');
  const { plans: [{ id: planId }] } = await creation.json() as { plans: Plan[] };
  const planPath = `/planting-plans/${planId}/`;
  const created = await readBackend<Plan>(planPath);
  expect(created).toMatchObject({ id: planId, season: season.id, parcel: plot.id, bed: null, plants_count: 2 });
  expect(created.individual_positions).toMatchObject([
    { id: expect.any(String), x_m: 3.5, y_m: 3 },
    { id: expect.any(String), x_m: 3.5, y_m: 6.4 },
  ]);
  expect(await appleDemand()).toMatchObject({ plant_count: 2, plans: [{ plan_id: planId, plant_count: 2 }] });
  const [first, second] = created.individual_positions;
  await expect.poll(() => shape(page, `individual-canopy-${first.id}`)).toMatchObject({ listened: false });
  const fieldPath = `/fields/${plot.id}/`;
  const bedPath = `/beds/${adjacentBed.id}/`;
  const layoutsPath = `/locations/${location.id}/layouts/`;
  const otherPlanPath = `/planting-plans/${otherPlan.id}/`;
  const fieldBefore = await readBackend(fieldPath);
  const bedBefore = await readBackend(bedPath);
  const layoutsBefore = await readBackend<LocationLayoutsResponse>(layoutsPath);
  const otherPlanBefore = await readBackend(otherPlanPath);

  // After saving, the next draft starts with the optional canopy disclosure collapsed again.
  await panel.getByRole('button', { name: 'Neuer Einzelpflanzenplan' }).click();
  await panel.getByRole('combobox', { name: 'Kultur (Sorte)', exact: true }).click();
  await page.getByRole('option', { name: 'Rhabarber', exact: true }).click();
  await expect(panel.getByRole('textbox', { name: /Kronendurchmesser/ })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Kronendurchmesser angeben (optional)' })).toBeVisible();
  await panel.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await panel.getByRole('combobox', { name: 'Anbauplan', exact: true }).click();
  await page.getByRole('option', { name: /^Apfel/ }).click();

  await editPositions.click();
  const beforeDrag = await shape(page, `individual-stem-${first.id}`);
  expect(beforeDrag).not.toBeNull();
  const { x, y, width, height } = beforeDrag!.screen;
  await page.mouse.move(x + width / 2, y + height / 2);
  await page.mouse.down();
  await page.mouse.move(x + width / 2 + 42, y + height / 2 + 25, { steps: 6 });
  await expectCanopyCentered(page, first.id);
  await page.mouse.up();
  await expect.poll(async () => (await shape(page, `individual-stem-${first.id}`))?.x_m ?? first.x_m).not.toBe(first.x_m);
  const movedStem = await shape(page, `individual-stem-${first.id}`);
  expect(movedStem).toMatchObject({ x_m: expect.any(Number), y_m: expect.any(Number) });
  const { x_m, y_m } = movedStem!;
  expect(x_m).not.toBe(first.x_m);
  expect(y_m).not.toBe(first.y_m);
  const expectedPositions = [{ id: first.id, x_m, y_m }];
  await panel.getByRole('button', { name: 'Position entfernen · Stamm 2', exact: true }).click();
  // The count reflects the draft already. A failed save keeps the draft available for retry.
  const placementPath = `/api${planPath}individual-placement/`;
  await page.route(url => url.pathname === placementPath, route => route.fulfill({ status: 500, json: {} }), { times: 1 });
  await saveButton.click();
  await expect(panel.getByText('Die Einzelpflanzen konnten nicht gespeichert werden.')).toBeVisible();
  await expect(saveButton).toBeEnabled();
  await expect(panel.getByText('1 Einzelpflanze', { exact: true })).toBeVisible();
  expect(await readBackend<Plan>(planPath)).toMatchObject({
    individual_positions: created.individual_positions, plants_count: 2, updated_at: created.updated_at,
  });

  const [placement] = await Promise.all([
    page.waitForResponse(response => response.request().method() === 'PATCH'
      && new URL(response.url()).pathname === placementPath),
    saveButton.click(),
  ]);
  expect(placement.status()).toBe(200);
  expect(placement.request().postDataJSON()).toMatchObject({
    placement_updated_at: created.updated_at, individual_positions: expectedPositions,
  });
  await expect(editPositions).toBeVisible();
  await expect(panel.getByText('1 Einzelpflanze', { exact: true })).toBeVisible();
  const saved = await readBackend<Plan>(planPath);
  const savedPlacement = {
    id: planId, parcel: plot.id, season: season.id, plants_count: 1, individual_positions: expectedPositions,
  };
  expect(await placement.json()).toMatchObject(savedPlacement);
  expect(saved).toMatchObject(savedPlacement);
  expect(saved.updated_at).not.toBe(created.updated_at);
  expect(await appleDemand()).toMatchObject({ plant_count: 1, plans: [{ plan_id: planId, plant_count: 1 }] });
  expect(await readBackend(otherPlanPath)).toEqual(otherPlanBefore);
  expect(await readBackend(fieldPath)).toEqual(fieldBefore);
  expect(await readBackend(bedPath)).toEqual(bedBefore);
  expect(await readBackend(layoutsPath)).toEqual(layoutsBefore);
  await expect.poll(() => shape(page, `individual-stem-${second.id}`)).toBeNull();
  await testInfo.attach('individual-plants-desktop', { body: await page.screenshot(), contentType: 'image/png' });

  const details = panel.getByRole('link', { name: 'Zum Anbauplan' });
  await details.click();
  await expect(page).toHaveURL(new RegExp(`/planting-plans/${saved.id}$`));
  await expect(page.getByTestId('site-suitability-hints')).toContainText('Für die Parzelle');
  await page.getByRole('link', { name: 'In der Grafik öffnen' }).click();
  await expect(page).toHaveURL(new RegExp(`individualPlan=${saved.id}`));
  await page.reload();
  await expect(panel.getByText('1 Einzelpflanze', { exact: true })).toBeVisible();
  await expect.poll(() => shape(page, `individual-stem-${first.id}`)).toMatchObject({ x_m, y_m });
  await expect.poll(() => shape(page, `individual-stem-${second.id}`)).toBeNull();
  await panel.getByRole('button', { name: 'Schließen', exact: true }).click();
  await expect(control).toBeFocused();

  await page.getByRole('button', { name: 'Grafik bearbeiten', exact: true }).click();
  const bareStem = otherPlan.individual_positions[0];
  const bareShape = await shape(page, `individual-stem-${bareStem.id}`);
  expect(bareShape).not.toBeNull();
  expect(await shape(page, `individual-canopy-${bareStem.id}`)).toBeNull();
  await dragScreen(page, centre(bareShape!.screen), { x: 22, y: 14 });
  await expect.poll(async () => (await readBackend<Plan>(otherPlanPath)).individual_positions[0].x_m).not.toBe(bareStem.x_m);
  expect(await shape(page, `individual-canopy-${bareStem.id}`)).toBeNull();
  const root = await shape(page, `field-rect-${plot.id}`);
  const oldStem = await shape(page, `individual-stem-${first.id}`);
  const oldBed = await shape(page, `bed-rect-${adjacentBed.id}`);
  expect(root && oldStem && oldBed).toBeTruthy();
  const start = { x: root!.screen.x + root!.screen.width * 0.4, y: root!.screen.y + 1 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 45, start.y + 35, { steps: 7 });
  const layoutWrite = page.waitForResponse(response => response.request().method() === 'PUT'
    && new URL(response.url()).pathname === `/api${layoutsPath}`);
  await page.mouse.up();
  await expect.poll(async () => (await shape(page, `field-rect-${plot.id}`))?.world).not.toEqual(root!.world);
  const moved = (await shape(page, `field-rect-${plot.id}`))!.world;
  const newStem = (await shape(page, `individual-stem-${first.id}`))!.world;
  const newBed = (await shape(page, `bed-rect-${adjacentBed.id}`))!.world;
  expect(newStem.x - oldStem!.world.x).toBeCloseTo(moved.x - root!.world.x);
  expect(newStem.y - oldStem!.world.y).toBeCloseTo(moved.y - root!.world.y);
  expect(newBed.x - oldBed!.world.x).toBeCloseTo(moved.x - root!.world.x);
  expect(newBed.y - oldBed!.world.y).toBeCloseTo(moved.y - root!.world.y);
  expect((await layoutWrite).ok()).toBeTruthy();
  const layoutsAfter = await readBackend<LocationLayoutsResponse>(layoutsPath);
  expect(layoutsAfter.field_layouts).not.toEqual(layoutsBefore.field_layouts);
  expect(layoutsAfter.bed_layouts).toEqual(layoutsBefore.bed_layouts);
  expect((await readBackend<Plan>(planPath)).individual_positions).toEqual(saved.individual_positions);

  await page.goto('/app/gantt-chart');
  await expect(page.getByText('Einzelpflanzen', { exact: true })).toBeVisible();
  await expect(page.locator(`[data-task-id="plan-${saved.id}-occupancy"]`)).toBeVisible();
});

async function worldBox(page: Page, testId: string) {
  return page.evaluate(testId => {
    const { stages } = (window as unknown as { Konva: { stages: Konva.Stage[] } }).Konva;
    const stage = stages.find(item => item.container()?.isConnected);
    const node = stage?.find('Circle, Rect').find(item => item.getAttr('data-testid') === testId);
    return stage && node ? node.getClientRect({ relativeTo: stage }) : null;
  }, testId);
}

async function dragScreen(page: Page, from: { x: number; y: number }, by: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + by.x, from.y + by.y, { steps: 6 });
  await page.mouse.up();
}

const centre = (box: { x: number; y: number; width: number; height: number }) => (
  { x: box.x + box.width / 2, y: box.y + box.height / 2 });

async function expectCanopyCentered(page: Page, stemId: string) {
  const stem = await shape(page, `individual-stem-${stemId}`);
  const canopy = await shape(page, `individual-canopy-${stemId}`);
  expect(stem && canopy).toBeTruthy();
  const marker = centre(stem!.screen);
  const outline = centre(canopy!.screen);
  expect(outline.x).toBeCloseTo(marker.x, 5);
  expect(outline.y).toBeCloseTo(marker.y, 5);
  return marker;
}

test('places annual beans in a mixed bed and moves the bed separately from parcel-direct stems', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.setFixedTime(new Date(2026, 4, 15, 12));
  await loginWithDeterministicProject(page, request, 'individual-plants-bed', { loginAsAdmin: true });
  const { results: [site] } = await apiRequest<{ results: { id: number }[] }>(page, 'GET', '/locations/');
  await apiRequest(page, 'PATCH', `/locations/${site.id}/`, { width_m: 24, length_m: 26 });
  const plot = await apiRequest<{ id: number }>(page, 'POST', '/fields/', {
    location: site.id, name: 'Gemüseparzelle', width_m: 18, length_m: 18,
  });
  const bed = await apiRequest<{ id: number }>(page, 'POST', '/beds/', {
    field: plot.id, name: 'Mischbeet', width_m: 5, length_m: 8,
  });
  const singleBed = await apiRequest<{ id: number }>(page, 'POST', '/beds/', {
    field: plot.id, name: 'Einzelbeet', width_m: 3, length_m: 4,
  });
  const season = await apiRequest<{ id: number }>(page, 'POST', '/seasons/', {
    start_date: '2026-01-01', end_date: '2026-12-31',
  });
  const beans = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: 'Stangenbohne', life_cycle: 'annual', cultivation_types: ['direct_sowing'],
    estimated_canopy_diameter_m: 1.25, growth_duration_days: 45,
  });
  const carrots = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: 'Karotte', life_cycle: 'annual', cultivation_types: ['direct_sowing'],
  });
  const custom = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: 'Hofsortenmischung',
  });
  const plantingDate = '2026-05-15';
  await apiRequest(page, 'POST', '/planting-plans/', {
    season: season.id, crop: carrots.id, bed: bed.id, planting_date: plantingDate,
    cultivation_type: 'direct_sowing', area_usage_sqm: 10,
  });
  const direct = await apiRequest<Plan>(page, 'POST', '/planting-plans/', {
    season: season.id, crop: custom.id, parcel: plot.id, planting_date: plantingDate,
    placement_mode: 'individual_parcel', cultivation_type: 'purchased_transplant',
    individual_positions: [{ x_m: 4.5, y_m: 3.5 }],
  });
  const single = await apiRequest<Plan>(page, 'POST', '/planting-plans/', {
    season: season.id, crop: custom.id, bed: singleBed.id, planting_date: plantingDate,
    placement_mode: 'individual_bed', cultivation_type: 'purchased_transplant',
    individual_positions: [{ x_m: 1, y_m: 1 }],
  });
  const directId = direct.individual_positions[0].id;
  const singleId = single.individual_positions[0].id;

  await page.goto('/app/fields-beds');
  await page.getByRole('button', { name: 'Grafik', exact: true }).click();
  const target = page.locator(`[data-graphical-object-target="bed:${bed.id}"]`);
  await target.press('Enter');
  const surfaceId = 'individual-free-placement-surface';
  const panel = page.getByRole('region', { name: 'Einzelpflanzen', exact: true });
  await expect(panel).toHaveCount(0);
  expect(await shape(page, surfaceId)).toBeNull();
  await page.getByRole('button', { name: 'Neuer Einzelpflanzenplan', exact: true }).click();
  await expect(panel.getByTestId('individual-plants-parcel')).toContainText('Gemüseparzelle · Mischbeet');
  await expect(panel.getByText(/Wähle eine Kultur, eine Anbauart/)).toBeVisible();
  expect(await shape(page, surfaceId)).toBeNull();
  await panel.getByRole('combobox', { name: 'Kultur (Sorte)', exact: true }).click();
  await page.getByRole('option', { name: 'Stangenbohne', exact: true }).click();
  await expect.poll(() => shape(page, surfaceId)).not.toBeNull();
  const box = (await shape(page, `bed-rect-${bed.id}`))!.screen;
  const point = (left: number, top: number) => ({
    x: box.x + box.width * left, y: box.y + box.height * top,
  });
  for (const position of [point(0.35, 0.32), point(0.72, 0.65)]) {
    await expect.poll(() => page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, position)).toBe('CANVAS');
    await page.mouse.click(position.x, position.y);
  }
  await expect(panel.getByText('2 Einzelpflanzen', { exact: true })).toBeVisible();
  await dragScreen(page, point(0.2, 0.6), { x: 35, y: 16 });
  await expect(panel.getByText('2 Einzelpflanzen', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Platzierung beenden' }).click();
  const [saved] = await Promise.all([
    page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/planting-plans/graphic-placement/'),
    panel.getByRole('button', { name: 'Speichern', exact: true }).click(),
  ]);
  expect(saved.status()).toBe(200);
  const { plans: [plan] } = await saved.json() as { plans: Plan[] };
  expect(plan).toMatchObject({
    crop: beans.id, bed: bed.id, parcel: null, plants_count: 2, placement_mode: 'individual_bed',
  });
  const [first] = plan.individual_positions;

  await panel.getByRole('button', { name: 'Positionen bearbeiten' }).click();
  const draftMarker = await expectCanopyCentered(page, first.id);
  await dragScreen(page, draftMarker, { x: -16, y: 23 });
  await expect.poll(async () => (await shape(page, `individual-stem-${first.id}`))?.x_m).not.toBe(first.x_m);
  await panel.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect.poll(async () => (await shape(page, `individual-stem-${first.id}`))?.x_m).toBe(first.x_m);
  await testInfo.attach('mixed-bed-individual-plants-desktop', { body: await page.screenshot(), contentType: 'image/png' });
  await panel.getByRole('button', { name: 'Schließen', exact: true }).click();

  await page.getByRole('button', { name: 'Grafik bearbeiten', exact: true }).click();
  const testId = `bed-rect-${bed.id}`;
  const before = (await shape(page, testId))!;
  const stemBefore = (await shape(page, `individual-stem-${first.id}`))!.world;
  const directBefore = (await shape(page, `individual-stem-${directId}`))!.world;
  const secondBedBefore = (await shape(page, `individual-stem-${singleId}`))!.world;
  const origin = { x: before.screen.x + 10, y: before.screen.y + 15 };
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  await page.mouse.move(origin.x + 44, origin.y + 28, { steps: 6 });
  await expectCanopyCentered(page, first.id);
  const liveBed = (await shape(page, testId))!.world;
  const liveStem = (await shape(page, `individual-stem-${first.id}`))!.world;
  expect(liveBed).not.toEqual(before.world);
  expect(liveStem.x - stemBefore.x).toBeCloseTo(liveBed.x - before.world.x);
  expect(liveStem.y - stemBefore.y).toBeCloseTo(liveBed.y - before.world.y);
  expect((await shape(page, `individual-stem-${directId}`))!.world).toEqual(directBefore);
  expect((await shape(page, `individual-stem-${singleId}`))!.world).toEqual(secondBedBefore);

  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect.poll(async () => (await shape(page, testId))?.world).toEqual(before.world);
  await expect.poll(async () => (await shape(page, `individual-stem-${first.id}`))?.world).toEqual(stemBefore);

  const layoutPath = `/api/locations/${site.id}/layouts/`;
  await page.route(url => url.pathname === layoutPath, route => route.request().method() === 'PUT'
    ? route.fulfill({ status: 500, json: {} }) : route.continue(), { times: 1 });
  const write = (by: { x: number; y: number }) => Promise.all([
    page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname === layoutPath),
    dragScreen(page, origin, by),
  ]).then(([response]) => response);
  expect((await write({ x: 44, y: 28 })).ok()).toBe(false);
  await expect.poll(async () => (await shape(page, testId))?.world).toEqual(before.world);
  await expect.poll(async () => (await shape(page, `individual-stem-${first.id}`))?.world).toEqual(stemBefore);
  expect((await write({ x: 44, y: 28 })).ok()).toBe(true);
  const persisted = (await shape(page, testId))!.world;
  expect(persisted).not.toEqual(before.world);
  await page.goto(`/app/fields-beds?individualPlan=${plan.id}&locationId=${site.id}`);
  await expect(panel.getByText('2 Einzelpflanzen', { exact: true })).toBeVisible();
  await expect.poll(async () => (await shape(page, testId))?.world).toEqual(persisted);
  await expectCanopyCentered(page, first.id);
  const savedPlans = await individualPlans(page, site.id);
  expect(savedPlans.find(item => item.id === plan.id)?.individual_positions).toEqual(plan.individual_positions);
  expect(savedPlans.find(item => item.id === direct.id)?.individual_positions).toEqual(direct.individual_positions);
});

test('drags a placed stem in graphic edit mode without moving the bed or parcel below it (#1579)', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.setFixedTime(new Date(2026, 4, 15, 12));
  await loginWithDeterministicProject(page, request, 'individual-plants-stem-drag', { loginAsAdmin: true });
  const { results: [location] } = await apiRequest<{ results: { id: number }[] }>(page, 'GET', '/locations/');
  const plot = await apiRequest<{ id: number }>(page, 'POST', '/fields/', {
    location: location.id, name: 'Obstparzelle', width_m: 14, length_m: 20,
  });
  const bed = await apiRequest<{ id: number }>(page, 'POST', '/beds/', {
    field: plot.id, name: 'Gemüsebeet', width_m: 1.2, length_m: 6,
  });
  const season = await apiRequest<{ id: number }>(page, 'POST', '/seasons/', { start_date: '2026-01-01', end_date: '2026-12-31' });
  const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: 'Apfel', life_cycle: 'perennial', standing_time_years: 15,
    distance_within_row_cm: 400, estimated_canopy_diameter_m: 3.8, cultivation_types: ['pre_cultivation'],
  });
  const created = await apiRequest<Plan>(page, 'POST', '/planting-plans/', {
    season: season.id, crop: crop.id, parcel: plot.id, planting_date: '2026-05-01', cultivation_type: 'pre_cultivation',
    estimated_canopy_diameter_m: 3.8, individual_positions: [{ x_m: 1, y_m: 1 }, { x_m: 2, y_m: 3 }],
  });
  const [free, overBed] = created.individual_positions;

  // Calibrate metres to canvas units from the two stems, then put the second one on the bed's centre.
  await page.goto('/app/fields-beds');
  await page.getByRole('button', { name: 'Grafik', exact: true }).click();
  await expect.poll(() => worldBox(page, `individual-stem-${overBed.id}`)).not.toBeNull();
  const a = centre((await worldBox(page, `individual-stem-${free.id}`))!);
  const b = centre((await worldBox(page, `individual-stem-${overBed.id}`))!);
  const perMetre = { x: (b.x - a.x) / 1, y: (b.y - a.y) / 2 };
  const bedCentre = centre((await worldBox(page, `bed-rect-${bed.id}`))!);
  // The placement endpoint reads plans of the active season, which apiRequest does not send.
  const placed = await page.evaluate(async ({ planId, seasonId, body }) => {
    const csrf = document.cookie.split('; ').find(row => row.startsWith('csrftoken='))?.split('=')[1] ?? '';
    const response = await fetch(`/api/planting-plans/${planId}/individual-placement/`, {
      method: 'PATCH', credentials: 'include', body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json', 'X-CSRFToken': csrf, 'X-Season-Id': String(seasonId),
        'X-Project-Id': String(window.localStorage.getItem('activeProjectId')),
      },
    });
    return response.ok ? true : `${response.status} ${await response.text()}`;
  }, {
    planId: created.id, seasonId: season.id, body: {
      placement_updated_at: created.updated_at,
      individual_positions: [
        { id: free.id, x_m: free.x_m, y_m: free.y_m },
        {
          id: overBed.id,
          x_m: Number((1 + (bedCentre.x - a.x) / perMetre.x).toFixed(2)),
          y_m: Number((1 + (bedCentre.y - a.y) / perMetre.y).toFixed(2)),
        },
      ],
    },
  });
  expect(placed).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Grafik bearbeiten', exact: true }).click();
  await expect.poll(() => shape(page, `individual-stem-${overBed.id}`)).toMatchObject({ listened: true });
  const [placedPlan] = await individualPlans(page, location.id);
  const parcelBefore = (await shape(page, `field-rect-${plot.id}`))!.world;
  const bedBefore = (await shape(page, `bed-rect-${bed.id}`))!.world;

  // A stem over a bed: the stem moves, the bed and parcel stay.
  const stemOnBed = await expectCanopyCentered(page, overBed.id);
  const neighborBefore = (await shape(page, `individual-stem-${free.id}`))!.world;
  await page.mouse.move(stemOnBed.x, stemOnBed.y);
  await page.mouse.down();
  for (const step of [18, 36]) {
    await page.mouse.move(stemOnBed.x + step, stemOnBed.y + step * 2 / 3, { steps: 3 });
    expect((await expectCanopyCentered(page, overBed.id)).x).toBeCloseTo(stemOnBed.x + step, 0);
    expect((await shape(page, `individual-stem-${free.id}`))!.world).toEqual(neighborBefore);
    expect((await shape(page, `bed-rect-${bed.id}`))!.world).toEqual(bedBefore);
  }
  await testInfo.attach('canopy-during-mouse-drag', { body: await page.screenshot(), contentType: 'image/png' });
  await page.mouse.up();
  await expect.poll(async () => (await individualPlans(page, location.id))[0].individual_positions[1].x_m)
    .not.toBe(placedPlan.individual_positions[1].x_m);
  expect((await shape(page, `bed-rect-${bed.id}`))!.world).toEqual(bedBefore);
  expect((await shape(page, `field-rect-${plot.id}`))!.world).toEqual(parcelBefore);

  // A stem over empty parcel space.
  const stemFree = (await shape(page, `individual-stem-${free.id}`))!.screen;
  await dragScreen(page, centre(stemFree), { x: 30, y: 30 });
  await expect.poll(async () => (await individualPlans(page, location.id))[0].individual_positions[0].x_m)
    .not.toBe(free.x_m);
  expect((await shape(page, `field-rect-${plot.id}`))!.world).toEqual(parcelBefore);
  const afterStemDrags = (await individualPlans(page, location.id))[0].individual_positions;
  await testInfo.attach('individual-stem-drag-edit-mode', { body: await page.screenshot(), contentType: 'image/png' });

  // After a reload the saved positions are shown and the bed is where it was.
  await page.reload();
  await page.getByRole('button', { name: 'Grafik bearbeiten', exact: true }).click();
  await expect.poll(async () => (await shape(page, `individual-stem-${overBed.id}`))?.x_m)
    .toBe(afterStemDrags[1].x_m);
  await expectCanopyCentered(page, overBed.id);
  expect((await shape(page, `bed-rect-${bed.id}`))!.world).toEqual(bedBefore);

  // Inside the canopy but outside the stem, the bed below keeps its own drag.
  const bedBox = (await shape(page, `bed-rect-${bed.id}`))!.screen;
  const stemBox = (await shape(page, `individual-stem-${overBed.id}`))!.screen;
  const stemPoint = centre(stemBox);
  const vertical = bedBox.height >= bedBox.width;
  const canopyPoint = vertical
    ? { x: centre(bedBox).x, y: stemPoint.y < centre(bedBox).y ? stemPoint.y + 26 : stemPoint.y - 26 }
    : { x: stemPoint.x < centre(bedBox).x ? stemPoint.x + 26 : stemPoint.x - 26, y: centre(bedBox).y };
  await dragScreen(page, canopyPoint, { x: 20, y: 20 });
  await expect.poll(async () => (await shape(page, `bed-rect-${bed.id}`))?.world).not.toEqual(bedBefore);
  expect((await individualPlans(page, location.id))[0].individual_positions).toEqual(afterStemDrags);

  // Escape during a stem drag cancels it without saving (#1579).
  let placementWrites = 0;
  page.on('request', request => {
    if (request.method() === 'PATCH' && request.url().includes('/individual-placement/')) placementWrites += 1;
  });
  const beforeEscape = (await shape(page, `individual-stem-${free.id}`))!;
  const escapeFrom = centre(beforeEscape.screen);
  await page.mouse.move(escapeFrom.x, escapeFrom.y);
  await page.mouse.down();
  await page.mouse.move(escapeFrom.x + 40, escapeFrom.y + 20, { steps: 6 });
  expect((await expectCanopyCentered(page, free.id)).x).not.toBeCloseTo(escapeFrom.x, 0);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect.poll(async () => (await shape(page, `individual-stem-${free.id}`))?.world).toEqual(beforeEscape.world);
  await expectCanopyCentered(page, free.id);
  expect(placementWrites).toBe(0);
  expect((await individualPlans(page, location.id))[0].individual_positions).toEqual(afterStemDrags);

  // While one stem's save is pending, its plan's other stem still takes the gesture: the parcel stays.
  let releasePending: () => void = () => undefined;
  const placementUrl = (url: URL) => url.pathname.endsWith('/individual-placement/');
  await page.route(placementUrl, async route => {
    await new Promise<void>(resolve => { releasePending = resolve; });
    await route.continue();
  });
  const parcelBeforePending = (await shape(page, `field-rect-${plot.id}`))!.world;
  await dragScreen(page, centre((await shape(page, `individual-stem-${free.id}`))!.screen), { x: 20, y: 20 });
  await dragScreen(page, centre((await shape(page, `individual-stem-${overBed.id}`))!.screen), { x: 40, y: 30 });
  expect((await shape(page, `field-rect-${plot.id}`))!.world).toEqual(parcelBeforePending);
  releasePending();
  await expect.poll(async () => (await individualPlans(page, location.id))[0].individual_positions[0].x_m)
    .not.toBe(afterStemDrags[0].x_m);
  await page.unroute(placementUrl);
  const afterPending = (await individualPlans(page, location.id))[0].individual_positions;
  expect(afterPending[1]).toEqual(afterStemDrags[1]);

  // A failed save restores the stem and reports the error.
  await page.route(placementUrl, route => route.fulfill({ status: 500, json: {} }));
  const beforeFailure = (await shape(page, `individual-stem-${free.id}`))!;
  await dragScreen(page, centre(beforeFailure.screen), { x: 30, y: -20 });
  await expect(page.getByText('Die Einzelpflanzen konnten nicht gespeichert werden.')).toBeVisible();
  await expect.poll(async () => (await shape(page, `individual-stem-${free.id}`))?.x_m).toBe(beforeFailure.x_m);
  await expectCanopyCentered(page, free.id);
  expect((await individualPlans(page, location.id))[0].individual_positions).toEqual(afterPending);
});

test.describe('individual plants on a phone', () => {
  test.use({ viewport: { width: 375, height: 800 }, hasTouch: true });

  test('keeps the orchard canopy centered during touch drag, cancellation and reload', async ({ page, request }, testInfo) => {
    await page.clock.setFixedTime(new Date(2026, 4, 15, 12));
    await loginWithDeterministicProject(page, request, 'individual-plants-live-canopy', {
      demoProject: true, demoYear: 2026, loginAsAdmin: true,
    });
    const { results: locations } = await apiRequest<{ results: { id: number; name: string }[] }>(page, 'GET', '/locations/');
    const site = locations.find(location => location.name === 'Hofgarten')!;
    const orchard = (await individualPlans(page, site.id)).find(plan => plan.placement_mode === 'individual_parcel')!;
    const [stem] = orchard.individual_positions;
    await page.goto(`/app/fields-beds?individualPlan=${orchard.id}&locationId=${site.id}`);
    await page.getByRole('region', { name: 'Einzelpflanzen', exact: true }).getByRole('button', { name: 'Schließen' }).tap();
    await toggleGraphicEdit(page, 'touch');
    const touch = await page.context().newCDPSession(page);
    const dragStart = async () => {
      const before = await expectCanopyCentered(page, stem.id);
      const origin = { x: Math.round(before.x), y: Math.round(before.y) };
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [origin] });
      for (const step of [10, 16]) {
        await touch.send('Input.dispatchTouchEvent', {
          type: 'touchMove', touchPoints: [{ x: origin.x + step, y: origin.y + step }],
        });
        const next = await expectCanopyCentered(page, stem.id);
        expect(Math.hypot(next.x - before.x, next.y - before.y)).toBeGreaterThan(6);
      }
      return before;
    };
    let writes = 0;
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().endsWith('/graphic-move/')) writes += 1;
    });
    const original = await dragStart();
    await testInfo.attach('canopy-during-touch-drag', { body: await page.screenshot(), contentType: 'image/png' });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    expect(await expectCanopyCentered(page, stem.id)).toEqual(original);
    expect(writes).toBe(0);

    await dragStart();
    const saved = page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname === `/api/planting-plans/${orchard.id}/graphic-move/`);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect((await saved).ok()).toBe(true);
    const persisted = (await individualPlans(page, site.id)).flatMap(plan => plan.individual_positions);
    const moved = persisted.find(position => position.id === stem.id)!;
    expect(moved).not.toEqual(stem);
    expect(persisted.filter(position => position.id === stem.id)).toHaveLength(1);
    expect(persisted).toEqual(expect.arrayContaining(orchard.individual_positions.slice(1)));
    expect(writes).toBe(1);
    await page.reload();
    await expect.poll(async () => (await shape(page, `individual-stem-${stem.id}`))?.x_m).toBe(moved.x_m);
    await expectCanopyCentered(page, stem.id);
  });

  test('moves and adds demo stems through explicit touch actions', async ({ page, request }, testInfo) => {
    await page.clock.setFixedTime(new Date(2026, 4, 15, 12));
    await loginWithDeterministicProject(page, request, 'individual-plants-phone', {
      demoProject: true, demoYear: 2026, loginAsAdmin: true,
    });
    const { results: locations } = await apiRequest<{ results: { id: number; name: string }[] }>(page, 'GET', '/locations/');
    const site = locations.find(location => location.name === 'Hofgarten')!;
    const orchard = (await individualPlans(page, site.id)).find(plan => plan.placement_mode === 'individual_parcel')!;
    expect(orchard).toMatchObject({ bed: null, plants_count: 3, estimated_canopy_diameter_m: '3.80' });
    await page.goto(`/app/fields-beds?individualPlan=${orchard.id}&locationId=${site.id}`);
    const panel = page.getByRole('region', { name: 'Einzelpflanzen', exact: true });
    await expect(panel.getByText('3 Einzelpflanzen', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Positionen bearbeiten' }).tap();
    expect(await shape(page, 'individual-free-placement-surface')).toBeNull();
    expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await expect(panel.getByRole('button', { name: 'In der Grafik verschieben' })).toHaveCount(0);
    const surfaceId = 'individual-free-placement-surface';
    await page.locator('.konvajs-content').scrollIntoViewIfNeeded();
    const [first] = orchard.individual_positions;
    const marker = await expectCanopyCentered(page, first.id);
    const origin = { x: Math.round(marker.x), y: Math.round(marker.y) };
    const touch = await page.context().newCDPSession(page);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [origin] });
    for (const step of [9, 18]) {
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ x: origin.x + step, y: origin.y + step }],
      });
    }
    await expectCanopyCentered(page, first.id);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await shape(page, `individual-stem-${first.id}`))?.x_m).not.toBe(first.x_m);
    await expect(panel.getByText('3 Einzelpflanzen', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Pflanzen in der Grafik platzieren', exact: true }).tap();
    await expect.poll(() => shape(page, surfaceId)).not.toBeNull();
    await page.locator('.konvajs-content').scrollIntoViewIfNeeded();
    const add = (await shape(page, `field-rect-${orchard.parcel}`))!.screen;
    await page.touchscreen.tap(add.x + add.width * 0.25, add.y + add.height * 0.7);
    await expect(panel.getByText('4 Einzelpflanzen', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Platzierung beenden', exact: true }).tap();
    await panel.getByRole('button', { name: 'Speichern', exact: true }).tap();
    await expect(panel.getByRole('button', { name: 'Positionen bearbeiten' })).toBeVisible();
    const changed = (await individualPlans(page, site.id)).find(plan => plan.id === orchard.id)!;
    expect(changed.individual_positions.slice(0, 3).map(stem => stem.id)).toEqual(orchard.individual_positions.map(stem => stem.id));
    expect(changed.individual_positions).toHaveLength(4);
    expect(changed.individual_positions[0]).not.toEqual(orchard.individual_positions[0]);
    await testInfo.attach('individual-plants-phone', { body: await panel.screenshot(), contentType: 'image/png' });

    await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: 'fr' });
    await page.reload();
    const french = page.getByRole('region', { name: 'Plantes individuelles', exact: true });
    await expect(french.getByText('4 plantes individuelles', { exact: true })).toBeVisible();
    await french.getByRole('button', { name: 'Modifier les positions' }).tap();
    await expect(french.getByRole('textbox', { name: 'Diamètre estimé du houppier (m)' })).toHaveValue('3,8');
    expect(await french.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await testInfo.attach('individual-plants-phone-french', { body: await french.screenshot(), contentType: 'image/png' });
    await page.setViewportSize({ width: 800, height: 375 });
    // The origin and bounds guidance sits in the collapsed manual-coordinates section (#1575).
    await expect(french.getByText(/Depuis le coin supérieur gauche/)).toBeHidden();
    await french.getByRole('button', { name: 'Saisir les coordonnées manuellement' }).tap();
    await expect(french.getByText(/Depuis le coin supérieur gauche/)).toBeVisible();
    expect(await french.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  });
});
