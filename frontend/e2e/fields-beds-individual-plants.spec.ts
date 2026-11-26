import { expect, test, type Page } from '@playwright/test';
import type Konva from 'konva';
import { apiRequest, loginWithDeterministicProject } from './utils';

type Stem = { id: string; x_m: number; y_m: number };
type Plan = {
  id: number; parcel: number; parcel_location_id: number; bed: null;
  individual_positions: Stem[]; plants_count: number; estimated_canopy_diameter_m: string;
};

async function shape(page: Page, testId: string) {
  return page.evaluate(testId => {
    const { stages } = (window as unknown as { Konva: { stages: Konva.Stage[] } }).Konva;
    const stage = stages.find(item => item.container()?.isConnected);
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

test('creates, drags and edits stems with the keyboard and keeps the parcel offsets', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.setFixedTime(new Date(2026, 4, 15, 12));
  await loginWithDeterministicProject(page, request, 'individual-plants-desktop', { loginAsAdmin: true });
  const { results: [location] } = await apiRequest<{ results: { id: number }[] }>(page, 'GET', '/locations/');
  const plot = await apiRequest<{ id: number }>(page, 'POST', '/fields/', {
    location: location.id, name: 'Obstparzelle', width_m: 14, length_m: 20, light_condition: 'shade',
  });
  const adjacentBed = await apiRequest<{ id: number }>(page, 'POST', '/beds/', {
    field: plot.id, name: 'Gemüsebeet', width_m: 1.2, length_m: 6,
  });
  await apiRequest(page, 'POST', '/seasons/', { start_date: '2026-01-01', end_date: '2026-12-31' });
  await apiRequest(page, 'POST', '/crops/', {
    name: 'Apfel', life_cycle: 'perennial', standing_time_years: 15,
    distance_within_row_cm: 400, estimated_canopy_diameter_m: 3.8,
    cultivation_types: ['pre_cultivation'], light_requirement: ['full_sun'],
  });
  await apiRequest(page, 'POST', '/crops/', {
    name: 'Rhabarber', life_cycle: 'perennial', standing_time_years: 8, cultivation_types: ['pre_cultivation'],
  });

  await page.goto('/app/fields-beds');
  await page.getByRole('button', { name: 'Grafik', exact: true }).click();
  const toolbar = page.getByTestId('graphical-canvas-tools');
  const control = toolbar.getByRole('button', { name: /^(Weitere Grafikwerkzeuge|Einzelpflanzen)$/ });
  const opensMenu = await control.getAttribute('aria-haspopup') === 'menu';
  await control.press('Enter');
  if (opensMenu) await page.getByRole('menuitem', { name: 'Einzelpflanzen', exact: true }).press('Enter');
  const panel = page.getByRole('region', { name: 'Einzelpflanzen', exact: true });
  // #1575: a fixed parcel is context, planning and placement are separate sections, and the
  // stem/canopy explanation lives in the page help instead of the form.
  await expect(panel.getByTestId('individual-plants-parcel')).toHaveText(/Obstparzelle/);
  await expect(panel.getByRole('heading', { name: 'Anbauplan', level: 3 })).toBeVisible();
  await expect(panel.getByText(/Der Punkt zeigt die Stammposition/)).toHaveCount(0);
  await panel.getByRole('button', { name: 'Neuer Einzelpflanzenplan' }).click();
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
  await expect(panel.getByRole('button', { name: 'Pflanzen in der Grafik platzieren', exact: true })).toBeVisible();
  await expect(panel.getByText('0 Einzelpflanzen', { exact: true })).toBeVisible();

  // Manual coordinates start collapsed and open with the keyboard.
  const manual = panel.getByRole('button', { name: 'Koordinaten manuell eingeben' });
  await expect(manual).toHaveAttribute('aria-expanded', 'false');
  await expect(panel.getByRole('textbox', { name: 'X (m)', exact: true })).toBeHidden();
  await manual.focus();
  await page.keyboard.press('Enter');
  await expect(manual).toHaveAttribute('aria-expanded', 'true');

  for (const [index, coordinates] of [['1,5', '3'], ['1,5', '6,4']].entries()) {
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
  const firstStem = draftStem!.screen;
  await page.mouse.click(firstStem.x + firstStem.width / 2, firstStem.y + firstStem.height / 2);
  await expect(panel.getByRole('combobox', { name: 'Stammposition' })).toContainText(/^Stamm 1 ·/);
  await panel.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Positionen bearbeiten' })).toBeVisible();
  await expect(panel.getByTestId('site-suitability-hints')).toContainText('Für die Parzelle');
  const [created] = await individualPlans(page, location.id);
  expect(created).toMatchObject({ parcel: plot.id, bed: null, plants_count: 2 });
  const [first, second] = created.individual_positions;
  await expect.poll(() => shape(page, `individual-canopy-${first.id}`)).toMatchObject({ listened: false });

  // After saving, the next draft starts with the optional canopy disclosure collapsed again.
  await panel.getByRole('button', { name: 'Neuer Einzelpflanzenplan' }).click();
  await panel.getByRole('combobox', { name: 'Kultur (Sorte)', exact: true }).click();
  await page.getByRole('option', { name: 'Rhabarber', exact: true }).click();
  await expect(panel.getByRole('textbox', { name: /Kronendurchmesser/ })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Kronendurchmesser angeben (optional)' })).toBeVisible();
  await panel.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await panel.getByRole('combobox', { name: 'Anbauplan', exact: true }).click();
  await page.getByRole('option', { name: /^Apfel/ }).click();

  await panel.getByRole('button', { name: 'Positionen bearbeiten' }).click();
  const beforeDrag = await shape(page, `individual-stem-${first.id}`);
  expect(beforeDrag).not.toBeNull();
  const { x, y, width, height } = beforeDrag!.screen;
  await page.mouse.move(x + width / 2, y + height / 2);
  await page.mouse.down();
  await page.mouse.move(x + width / 2 + 42, y + height / 2 + 25, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await shape(page, `individual-stem-${first.id}`))?.x_m).not.toBe(first.x_m);
  await panel.getByRole('combobox', { name: 'Stammposition' }).click();
  await page.getByRole('option', { name: /^Stamm 2 ·/ }).click();
  await panel.getByRole('button', { name: 'Position entfernen' }).click();
  await panel.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(panel.getByText('1 Einzelpflanze', { exact: true })).toBeVisible();
  const [saved] = await individualPlans(page, location.id);
  expect(saved.individual_positions).toHaveLength(1);
  expect(saved.individual_positions[0].id).toBe(first.id);
  expect(saved.individual_positions[0].x_m).not.toBe(first.x_m);
  await expect.poll(() => shape(page, `individual-stem-${second.id}`)).toBeNull();
  await testInfo.attach('individual-plants-desktop', { body: await page.screenshot(), contentType: 'image/png' });

  const details = panel.getByRole('link', { name: 'Zum Anbauplan' });
  await details.click();
  await expect(page).toHaveURL(new RegExp(`/planting-plans/${saved.id}$`));
  await expect(page.getByTestId('site-suitability-hints')).toContainText('Für die Parzelle');
  await page.getByRole('link', { name: 'In der Grafik öffnen' }).click();
  await expect(page).toHaveURL(new RegExp(`individualPlan=${saved.id}`));
  await expect(panel.getByText('1 Einzelpflanze', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Schließen', exact: true }).click();
  await expect(control).toBeFocused();

  await page.getByRole('button', { name: 'Grafik bearbeiten', exact: true }).click();
  const root = await shape(page, `field-rect-${plot.id}`);
  const oldStem = await shape(page, `individual-stem-${first.id}`);
  const oldBed = await shape(page, `bed-rect-${adjacentBed.id}`);
  expect(root && oldStem && oldBed).toBeTruthy();
  const start = { x: root!.screen.x + root!.screen.width * 0.4, y: root!.screen.y + 1 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 45, start.y + 35, { steps: 7 });
  await page.mouse.up();
  await expect.poll(async () => (await shape(page, `field-rect-${plot.id}`))?.world).not.toEqual(root!.world);
  const moved = (await shape(page, `field-rect-${plot.id}`))!.world;
  const newStem = (await shape(page, `individual-stem-${first.id}`))!.world;
  const newBed = (await shape(page, `bed-rect-${adjacentBed.id}`))!.world;
  expect(newStem.x - oldStem!.world.x).toBeCloseTo(moved.x - root!.world.x);
  expect(newStem.y - oldStem!.world.y).toBeCloseTo(moved.y - root!.world.y);
  expect(newBed.x - oldBed!.world.x).toBeCloseTo(moved.x - root!.world.x);
  expect((await individualPlans(page, location.id))[0].individual_positions).toEqual(saved.individual_positions);

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
  const created = await apiRequest<Plan & { updated_at: string }>(page, 'POST', '/planting-plans/', {
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
  const stemOnBed = (await shape(page, `individual-stem-${overBed.id}`))!.screen;
  await dragScreen(page, centre(stemOnBed), { x: 36, y: 24 });
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
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect.poll(async () => (await shape(page, `individual-stem-${free.id}`))?.world).toEqual(beforeEscape.world);
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
  expect((await individualPlans(page, location.id))[0].individual_positions).toEqual(afterPending);
});

test.describe('individual plants on a phone', () => {
  test.use({ viewport: { width: 375, height: 800 }, hasTouch: true });

  test('moves and adds demo stems through explicit touch actions', async ({ page, request }, testInfo) => {
    await page.clock.setFixedTime(new Date(2026, 4, 15, 12));
    await loginWithDeterministicProject(page, request, 'individual-plants-phone', {
      demoProject: true, demoYear: 2026, loginAsAdmin: true,
    });
    const { results: locations } = await apiRequest<{ results: { id: number; name: string }[] }>(page, 'GET', '/locations/');
    const site = locations.find(location => location.name === 'Hofgarten')!;
    const [orchard] = await individualPlans(page, site.id);
    expect(orchard).toMatchObject({ bed: null, plants_count: 3, estimated_canopy_diameter_m: '3.80' });
    await page.goto(`/app/fields-beds?individualPlan=${orchard.id}&locationId=${site.id}`);
    const panel = page.getByRole('region', { name: 'Einzelpflanzen', exact: true });
    await expect(panel.getByText('3 Einzelpflanzen', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Positionen bearbeiten' }).tap();
    expect(await shape(page, `individual-place-surface-${orchard.parcel}`)).toBeNull();
    expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await panel.getByRole('button', { name: 'In der Grafik verschieben', exact: true }).tap();

    const surfaceId = `individual-place-surface-${orchard.parcel}`;
    await expect.poll(() => shape(page, surfaceId)).not.toBeNull();
    const { x, y, width, height } = (await shape(page, surfaceId))!.screen;
    const target = { x: x + width * 0.45, y: y + height * 0.55 };
    await page.touchscreen.tap(target.x, target.y);
    await expect(panel.getByRole('button', { name: 'Platzierung abbrechen' })).toHaveCount(0);
    await expect(panel.getByText('3 Einzelpflanzen', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Pflanzen in der Grafik platzieren', exact: true }).tap();
    await expect.poll(() => shape(page, surfaceId)).not.toBeNull();
    const add = (await shape(page, surfaceId))!.screen;
    await page.touchscreen.tap(add.x + add.width * 0.7, add.y + add.height * 0.3);
    await expect(panel.getByText('4 Einzelpflanzen', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Speichern', exact: true }).tap();
    await expect(panel.getByRole('button', { name: 'Positionen bearbeiten' })).toBeVisible();
    const [changed] = await individualPlans(page, site.id);
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
    await expect(french.getByText(/Depuis l’angle supérieur gauche/)).toBeHidden();
    await french.getByRole('button', { name: 'Saisir les coordonnées manuellement' }).tap();
    await expect(french.getByText(/Depuis l’angle supérieur gauche/)).toBeVisible();
    expect(await french.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  });
});
