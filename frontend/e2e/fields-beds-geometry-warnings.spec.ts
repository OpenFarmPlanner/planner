import { expect, test, type Page } from '@playwright/test';
import type Konva from 'konva';
import { activateCanvasTool, apiRequest, graphicDisplayButton, graphicLegendButton, loginWithDeterministicProject, openGraphicLegend, selectGraphicDisplay } from './utils';

test.use({ serviceWorkers: 'block' });

async function findShape(page: Page, testId: string) {
  return page.evaluate(testId => {
    const konva = (window as unknown as { Konva?: { stages: Konva.Stage[] } }).Konva;
    const stage = konva?.stages.find(item => item.container()?.isConnected);
    const node = stage?.find('Rect').find(shape => shape.getAttr('data-testid') === testId);
    if (!stage || !node) return null;
    const canvas = stage.container().getBoundingClientRect();
    const bounds = node.getClientRect();
    return {
      issue: node.getAttr('data-geometry-issue') as string | undefined,
      urgency: node.getAttr('data-task-urgency') as string | undefined,
      fill: node.getAttr('fill') as string,
      hasTaskIcon: stage.find('Text').some(text => text.getAttr('data-testid') === testId.replace('bed-rect-', 'bed-task-icon-')),
      world: node.getAbsolutePosition(stage),
      screen: { x: canvas.x + bounds.x, y: canvas.y + bounds.y, width: bounds.width, height: bounds.height },
      zoom: stage.scaleX(),
    };
  }, testId);
}

async function seedGeometry(page: Page) {
  const { results: [location] } = await apiRequest<{ results: { id: number }[] }>(page, 'GET', '/locations/');
  await apiRequest(page, 'PATCH', `/locations/${location.id}/`, {
    width_m: 30, length_m: 25, snap_to_path_spacing: false,
  });
  const fields = [];
  for (const [name, size] of [['Lernparzelle', 10], ['Volle Parzelle', 10], ['Randparzelle', 6]] as const) {
    fields.push(await apiRequest<{ id: number }>(page, 'POST', '/fields/', {
      name, location: location.id, width_m: size, length_m: size,
    }));
  }
  const beds = [];
  for (const [name, index, width, length] of [
    ['Nordbeet', 0, 2, 4], ['Südbeet', 0, 2, 4], ['Überstehendes Beet', 0, 2, 3], ['Vollbeet', 1, 10, 10],
  ] as const) {
    beds.push(await apiRequest<{ id: number }>(page, 'POST', '/beds/', {
      name, field: fields[index].id, width_m: width, length_m: length,
    }));
  }
  beds.push(await apiRequest<{ id: number }>(page, 'POST', '/beds/', {
    name: 'Beet ohne Maße', field: fields[2].id, area_sqm: 6,
  }));
  const path = `/locations/${location.id}/layouts/`;
  await apiRequest(page, 'PUT', path, {
    location_boundary: { x: 20, y: 20 },
    field_layouts: fields.map((field, index) => ({ field: field.id, x: [40, 240, 490][index], y: 40 })),
    bed_layouts: beds.map((bed, index) => ({ bed: bed.id, x: [16, 52, 150, 0, 12][index], y: [12, 12, 80, 0, 12][index] })),
  });
  return { bedId: beds[1].id, neighborId: beds[0].id, fieldId: fields[0].id,
    fullBedId: beds[3].id, fullFieldId: fields[1].id, path };
}

test('shows scoped open task titles, dates and urgency as the task state and zoom change', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.setFixedTime(new Date(2026, 4, 15, 12));
  await loginWithDeterministicProject(page, request, 'graphical-bed-task-tooltip', { loginAsAdmin: true });
  const { fullBedId: bedId, fullFieldId: fieldId } = await seedGeometry(page);
  const season = await apiRequest<{ id: number }>(page, 'POST', '/seasons/', {
    start_date: '2026-01-01', end_date: '2026-12-31',
  });
  const plan = await apiRequest<{ id: number }>(page, 'POST', '/planting-plans/', { bed: bedId, season: season.id });
  for (const [title, due_date, status] of [
    ['Werkzeug prüfen', '2026-05-14', 'in_progress'],
    ['Pflanzen kontrollieren', '2026-05-22', 'pending'],
    ['Mulch nachfüllen', '2026-05-23', 'pending'],
    ['Etiketten vorbereiten', null, 'pending'],
    ['Gießkanne holen', null, 'pending'],
    ['Diese Aufgabe wurde erledigt', '2026-05-01', 'completed'],
    ['Diese Aufgabe wurde abgebrochen', '2026-05-01', 'cancelled'],
  ]) {
    await apiRequest(page, 'POST', '/tasks/', { title, due_date, status, season: season.id, planting_plan: plan.id });
  }
  await apiRequest(page, 'POST', '/tasks/', { title: 'Nur Parzelle', season: season.id, field: fieldId });
  await page.goto('/app/fields-beds');
  const tasksUrl = (url: URL) => url.pathname === '/api/tasks/';
  let rejectRead = () => {};
  const triggerFailure = new Promise<void>(resolve => { rejectRead = resolve; });
  await page.route(tasksUrl, async route => {
    await triggerFailure;
    await route.fulfill({ status: 503, json: {} });
  }, { times: 1 });
  let reads = 0;
  page.on('request', request => {
    if (request.method() === 'GET' && tasksUrl(new URL(request.url()))) reads += 1;
  });
  await page.getByRole('button', { name: 'Grafik', exact: true }).click();
  const getBed = () => findShape(page, `bed-rect-${bedId}`);
  const hoverBed = async () => {
    await expect.poll(getBed).not.toBeNull();
    const { screen } = (await getBed())!;
    const point = { x: screen.x + screen.width / 2, y: screen.y + screen.height / 2 };
    await expect.poll(() => page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, point)).toBe('CANVAS');
    await page.mouse.move(1, 1);
    await page.mouse.move(point.x, point.y);
  };
  const tooltip = page.getByRole('tooltip').filter({ hasText: 'Vollbeet' });
  await hoverBed();
  await expect(tooltip).toContainText('Lädt...');
  await expect(tooltip).not.toContainText('Keine offenen Aufgaben');
  rejectRead();
  await expect(tooltip).toContainText('Die Beetaufgaben konnten nicht geladen werden.');
  await expect(tooltip).not.toContainText('Keine offenen Aufgaben');
  await page.reload();
  await expect.poll(async () => (await getBed())?.urgency).toBe('overdue');
  const settledReads = reads;
  await hoverBed();
  await expect(tooltip).toContainText('5 offene Aufgaben');
  await expect(tooltip.getByRole('listitem')).toHaveCount(3);
  await expect(tooltip.getByRole('listitem').nth(0)).toContainText(/Werkzeug prüfen.*Überfällig.*14\.0?5\.2026/s);
  await expect(tooltip.getByRole('listitem').nth(1)).toContainText(/Pflanzen kontrollieren.*22\.0?5\.2026/s);
  await expect(tooltip.getByRole('listitem').nth(2)).toContainText(/Mulch nachfüllen.*23\.0?5\.2026/s);
  await expect(tooltip).toContainText('+2 weitere Aufgaben');
  await expect(tooltip).not.toContainText(/Nur Parzelle|Diese Aufgabe wurde/);
  expect(reads).toBe(settledReads);

  await page.getByRole('button', { name: 'Grafik bearbeiten', exact: true }).click();
  await hoverBed();
  await expect(tooltip).toHaveCount(0);
  await page.getByRole('button', { name: 'Grafik bearbeiten', exact: true }).click();
  await activateCanvasTool(page, 'Ansicht um 90° nach rechts drehen');
  for (let step = 0; step < 6; step += 1) {
    await page.getByRole('button', { name: 'Hineinzoomen', exact: true }).click();
  }
  const labels = () => page.evaluate(bedId => {
    const stage = (window as unknown as { Konva: { stages: Konva.Stage[] } }).Konva.stages
      .find(item => item.container()?.isConnected);
    return stage?.find<Konva.Text>('Text').filter(node => new RegExp(`^bed-(task-label|task-due|more-tasks-label)-${bedId}-`).test(node.getAttr('data-testid')))
      .map(node => node.text()) ?? [];
  }, bedId);
  await expect.poll(labels).toEqual(expect.arrayContaining(['Werkzeug prüfen', expect.stringMatching(/14\.0?5\.2026/), '+3 weitere Aufgaben']));
  const target = page.locator(`[data-graphical-object-target="bed:${bedId}"]`);
  await target.focus();
  await expect(target).toHaveAccessibleDescription('Überfällig · 5 offene Aufgaben');
  await page.screenshot({ path: testInfo.outputPath('zoomed-rotated-bed-task-labels.png') });
  await target.press('Enter');
  const preview = page.getByTestId('graphical-object-preview');
  await expect(preview).toHaveAccessibleName('Vollbeet');
  const observedFills = [(await getBed())?.fill];
  for (const [title, urgency] of [
    ['Werkzeug prüfen', 'upcoming'], ['Pflanzen kontrollieren', 'later'], ['Mulch nachfüllen', 'undated'],
  ]) {
    await preview.getByRole('button', { name: `„${title}“ als erledigt markieren` }).click();
    await expect.poll(async () => (await getBed())?.urgency).toBe(urgency);
    observedFills.push((await getBed())?.fill);
  }
  expect(new Set(observedFills).size).toBe(4);
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await activateCanvasTool(page, 'Alles einpassen');
  await hoverBed();
  await expect(tooltip).toContainText('2 offene Aufgaben');
  await expect(tooltip).toContainText(/Ohne Datum|Ohne Termin/);
  await selectGraphicDisplay(page, 'Aufgaben');
  await hoverBed();
  await expect(tooltip).toContainText('Etiketten vorbereiten');
  await selectGraphicDisplay(page, 'Kulturen');
  await expect(tooltip).toHaveCount(0);
  await hoverBed();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).not.toContainText('Etiketten vorbereiten');
});

for (const mobile of [false, true]) {
  test.describe(`bed tasks on ${mobile ? 'a phone' : 'desktop'}`, () => {
    test.use({ hasTouch: mobile });

    test('explains urgency independently of zoom and updates it after completing a task', async ({ page, request }, testInfo) => {
      await page.setViewportSize(mobile ? { width: 375, height: 800 } : { width: 1440, height: 900 });
      await page.clock.setFixedTime(new Date(2026, 4, 15, 12));
      await loginWithDeterministicProject(page, request, `graphical-bed-tasks-${mobile}`, { loginAsAdmin: true });
      const { bedId, neighborId, fieldId } = await seedGeometry(page);
      const season = await apiRequest<{ id: number }>(page, 'POST', '/seasons/', {
        start_date: '2026-01-01', end_date: '2026-12-31',
      });
      const plan = await apiRequest<{ id: number }>(page, 'POST', '/planting-plans/', {
        bed: bedId, season: season.id, planting_date: '2026-05-10',
      });
      const generated = await apiRequest<{ results: { id: number }[] }>(page, 'GET', `/tasks/?planting_plan=${plan.id}`);
      for (const task of generated.results) await apiRequest(page, 'PATCH', `/tasks/${task.id}/`, { status: 'completed' });
      const overdue = await apiRequest<{ id: number }>(page, 'POST', '/tasks/', {
        title: 'Überfällige Kontrolle', season: season.id, planting_plan: plan.id, due_date: '2026-05-14',
      });
      const undated = await apiRequest<{ id: number }>(page, 'POST', '/tasks/', {
        title: 'Material besorgen', season: season.id, planting_plan: plan.id, due_date: null,
      });
      await apiRequest(page, 'POST', '/tasks/', {
        title: 'Bewässerung abgebrochen', season: season.id, planting_plan: plan.id, status: 'cancelled',
      });
      await apiRequest(page, 'POST', '/tasks/', {
        title: 'Parzellenzaun prüfen', season: season.id, field: fieldId, due_date: '2026-05-14',
      });
      const taskWrites: string[] = [];
      page.on('request', request => {
        if (request.method() !== 'GET' && /\/tasks\//.test(new URL(request.url()).pathname)) {
          taskWrites.push(new URL(request.url()).pathname);
        }
      });

      await page.goto('/app/fields-beds');
      await page.getByRole('button', { name: 'Grafik', exact: true }).click();
      const getBed = () => findShape(page, `bed-rect-${bedId}`);
      const getNeighbor = () => findShape(page, `bed-rect-${neighborId}`);
      const display = graphicDisplayButton(page);
      await expect(display).toHaveAccessibleName('Darstellung der Grafik · Kulturen & Aufgaben');
      await selectGraphicDisplay(page, 'Anbauflächen');
      await expect.poll(async () => (await getBed())?.issue).toBe('shortGap');
      const ordinaryFill = (await getBed())?.fill;
      await expect.poll(() => findShape(page, 'graphical-free-area-site')).not.toBeNull();
      const legendButton = graphicLegendButton(page);
      const zoom = page.getByRole('button', { name: 'Herauszoomen', exact: true });
      const input = mobile ? 'touch' : 'keyboard';
      await display.press('Enter');
      await expect(page.getByRole('menuitemradio')).toHaveCount(4);
      await expect(page.getByRole('menuitem')).toHaveCount(mobile ? 1 : 0);
      await page.keyboard.press('Escape');
      const triggerBounds = (await legendButton.boundingBox())!;
      expect(triggerBounds.width).toBeGreaterThanOrEqual(44);
      const areaLegend = await openGraphicLegend(page, input);
      await expect(areaLegend).toBeFocused();
      await expect(areaLegend.getByText('Freifläche außerhalb der Parzellen')).toBeVisible();
      await expect(areaLegend.getByText('Zu wenig Platz für Wege')).toBeVisible();
      await expect(areaLegend.getByText('Offen ohne Termin')).toHaveCount(0);
      await expect(areaLegend.getByText(/Wachstum oder Belegung/)).toHaveCount(0);
      const panelBounds = (await areaLegend.boundingBox())!;
      expect(panelBounds.y + panelBounds.height).toBeLessThan(triggerBounds.y);
      if (mobile) await zoom.tap();
      else await zoom.click();
      await expect(areaLegend).toHaveCount(0);
      await expect(zoom).toBeFocused();
      expect(await legendButton.boundingBox()).toEqual(triggerBounds);
      await activateCanvasTool(page, 'Alles einpassen');
      await selectGraphicDisplay(page, 'Kulturen');
      const cropLegend = await openGraphicLegend(page, input);
      await expect(cropLegend.getByText(/Wachstum oder Belegung/)).toBeVisible();
      await expect(cropLegend.getByText('Offen ohne Termin')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(legendButton).toBeFocused();
      await selectGraphicDisplay(page, 'Kulturen & Aufgaben');
      const combinedLegend = await openGraphicLegend(page, input);
      await expect(combinedLegend.getByText(/Kulturnamen und Phasen/)).toBeVisible();
      await expect(combinedLegend.getByText('Offen ohne Termin')).toBeVisible();
      await expect(combinedLegend.getByText(/Wachstum oder Belegung/)).toHaveCount(0);
      await page.keyboard.press('Escape');
      await selectGraphicDisplay(page, 'Anbauflächen');
      const preview = page.getByTestId('graphical-object-preview');
      const bedTarget = page.locator(`[data-graphical-object-target="bed:${bedId}"]`);
      await bedTarget.press('Enter');
      await expect(preview).toHaveAccessibleName('Südbeet');
      await expect(preview.getByText(/2 offene Aufgaben.*1 ohne Termin/)).toBeVisible();
      await expect(preview.getByText('Überfällige Kontrolle')).toBeVisible();
      await expect(preview.getByText('Material besorgen')).toBeVisible();
      await expect(preview.getByText('Parzellenzaun prüfen')).toHaveCount(0);
      await expect(preview.getByText('Bewässerung abgebrochen')).toHaveCount(0);
      await expect(preview.getByRole('button', { name: '„Überfällige Kontrolle“ als erledigt markieren' })).toBeVisible();
      await expect.poll(async () => (await getBed())?.fill).toBe(ordinaryFill);
      await page.keyboard.press('Escape');
      await expect(preview).toHaveCount(0);
      await selectGraphicDisplay(page, 'Aufgaben');
      let panel = await openGraphicLegend(page, input);
      await expect(panel.getByRole('switch')).toHaveCount(0);
      await expect(panel.getByText('Offen ohne Termin', { exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(panel).toHaveCount(0);
      await expect.poll(async () => (await getBed())?.urgency).toBe('overdue');
      const colored = await getBed();
      expect(colored?.fill).not.toBe(ordinaryFill);
      expect(colored?.issue).toBe('shortGap');
      expect((await getNeighbor())?.urgency).toBeUndefined();
      if (!mobile) {
        const screen = colored!.screen;
        const x = screen.x + screen.width / 2;
        const y = screen.y + screen.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + 15, y, { steps: 4 });
        await page.mouse.up();
        await expect(page).toHaveURL(/fields-beds$/);
      }
      for (let step = 0; step < 5; step += 1) {
        await page.getByRole('button', { name: 'Herauszoomen', exact: true }).click();
      }
      await expect.poll(getBed).toMatchObject({ urgency: 'overdue', fill: colored?.fill, hasTaskIcon: false });
      await display.press('Enter');
      await expect(page.getByRole('menuitemradio', { name: 'Aufgaben', exact: true })).toHaveAttribute('aria-checked', 'true');
      await page.keyboard.press('Escape');
      panel = await openGraphicLegend(page, input);
      await panel.getByRole('combobox', { name: 'Beet auswählen' }).click();
      await page.getByRole('option', { name: /Südbeet · Lernparzelle/ }).click();
      await expect(panel.getByText(/Südbeet · Lernparzelle · Überfällig/)).toBeVisible();
      await expect(panel.getByText(/2 offene Aufgaben.*1 ohne Termin/)).toBeVisible();
      expect(await panel.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(0);
      await testInfo.attach(`bed-tasks-${mobile ? 'phone' : 'desktop'}`, {
        body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png',
      });
      await page.screenshot({ path: testInfo.outputPath(`legend-${mobile ? 'phone' : 'desktop'}.png`), animations: 'disabled' });
      if (mobile) {
        await page.setViewportSize({ width: 800, height: 375 });
        await expect(panel.getByText(/Südbeet · Lernparzelle · Überfällig/)).toBeVisible();
        expect(await panel.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(0);
        await expect.poll(() => panel.evaluate(element => {
          const rect = element.getBoundingClientRect();
          return rect.y >= 0 && rect.bottom <= window.innerHeight && element.scrollHeight > element.clientHeight;
        })).toBe(true);
        const bounds = (await panel.boundingBox())!;
        const touch = await page.context().newCDPSession(page);
        const start = { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height - 16) };
        await panel.evaluate(element => { element.scrollTop = 0; });
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
        for (const offset of [12, 27, 42, 57, 72, 95]) {
          // Deliver separate touch moves at a pace the browser can scroll with.
          await page.waitForTimeout(35);
          await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x, y: start.y - offset }] });
        }
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect.poll(() => panel.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
        await touch.detach();
        await panel.evaluate(element => { element.scrollTop = 0; });
        await testInfo.attach('bed-tasks-phone-landscape', {
          body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png',
        });
        await page.screenshot({ path: testInfo.outputPath('legend-landscape.png'), animations: 'disabled' });
        await page.setViewportSize({ width: 375, height: 800 });
      }
      const details = panel.getByRole('button', { name: 'Beetdetails' });
      if (mobile) await details.tap();
      else {
        await details.focus();
        await page.keyboard.press('Enter');
      }
      await expect(page).toHaveURL(new RegExp(`/fields-beds/beds/${bedId}$`));
      await expect(page.getByRole('heading', { name: 'Südbeet', level: 1 })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Alle Aufgaben' })).toHaveAttribute('href', /dashboard$/);
      await expect(page.getByText('Material besorgen')).toBeVisible();
      await expect(page.getByText(/Überfällig · 2 offene Aufgaben/)).toBeVisible();
      await expect(page.getByText('Parzellenzaun prüfen')).toHaveCount(0);
      await page.getByRole('button', { name: '„Überfällige Kontrolle“ als erledigt markieren' }).click();
      await expect(page.getByRole('button', { name: '„Überfällige Kontrolle“ als erledigt markieren' })).toHaveCount(0);
      const saved = await apiRequest<{ status: string }>(page, 'GET', `/tasks/${overdue.id}/`);
      expect(saved.status).toBe('completed');
      await page.getByRole('button', { name: 'Zurück zu den Anbauflächen' }).click();
      await page.getByRole('button', { name: 'Grafik', exact: true }).click();
      await expect(display).toHaveAccessibleName('Darstellung der Grafik · Aufgaben');
      await expect.poll(async () => (await getBed())?.urgency).toBe('undated');
      expect(taskWrites).toHaveLength(1);
      expect(taskWrites[0]).toMatch(new RegExp(`/tasks/${overdue.id}/$`));
      const { screen } = (await getBed())!;
      const point = { x: Math.round(screen.x + screen.width / 2), y: Math.round(screen.y + screen.height / 2) };
      await expect.poll(() => page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, point)).toBe('CANVAS');
      const graphicUrl = page.url();
      if (mobile) await page.touchscreen.tap(point.x, point.y);
      else await page.mouse.click(point.x, point.y);
      await expect(preview).toHaveAccessibleName('Südbeet');
      await expect(preview.getByText('Material besorgen')).toBeVisible();
      await expect(page).toHaveURL(graphicUrl);
      await page.route(`**/api/tasks/${undated.id}/`, async route => {
        if (route.request().method() === 'PATCH') await route.fulfill({ status: 500, body: 'Unavailable' });
        else await route.continue();
      });
      await preview.getByRole('button', { name: '„Material besorgen“ als erledigt markieren' }).click();
      const error = preview.getByRole('alert');
      await expect(error).toBeVisible();
      await page.unroute(`**/api/tasks/${undated.id}/`);
      await error.getByRole('button').click();
      await expect(preview.getByText('Keine offenen Aufgaben für dieses Beet.')).toBeVisible();
      await expect.poll(getBed).toMatchObject({ fill: ordinaryFill, hasTaskIcon: false });
      expect((await getBed())?.urgency).toBeUndefined();
      await preview.getByRole('button', { name: 'Details anzeigen' }).click();
      await expect(page).toHaveURL(new RegExp(`/fields-beds/beds/${bedId}$`));
      await expect(page.getByText('Material besorgen')).toBeHidden();
      await page.getByText(/^\d+ erledigte Aufgaben$/).click();
      await expect(page.getByText('Material besorgen')).toBeVisible();
      await expect(page.getByText('Bewässerung abgebrochen')).toBeHidden();
      await page.getByText('1 abgebrochene Aufgabe', { exact: true }).click();
      await expect(page.getByText('Bewässerung abgebrochen')).toBeVisible();
      await expect(page.getByRole('button', { name: /„Bewässerung abgebrochen“ als erledigt markieren/ })).toHaveCount(0);
    });
  });
}

for (const input of ['mouse', 'touch'] as const) {
  test.describe(`geometric checks with ${input}`, () => {
    test.use({ hasTouch: input === 'touch' });

    test('warns about specific conflicts during drag and after saving the same geometry', async ({ page, request }, testInfo) => {
      await page.setViewportSize(input === 'touch' ? { width: 390, height: 844 } : { width: 1440, height: 900 });
      await loginWithDeterministicProject(page, request, `geometry-warnings-${input}`, { loginAsAdmin: true });
      const { bedId, fieldId, fullFieldId, path } = await seedGeometry(page);
      const activate = async (name: string) => {
        const button = page.getByRole('button', { name, exact: true });
        if (input === 'touch') await button.tap();
        else await button.click();
      };
      await page.goto('/app/fields-beds');
      await activate('Grafik');
      await activateCanvasTool(page, 'Ansicht um 90° nach links drehen', input);
      const review = page.getByRole('button', { name: /^Layoutprüfung \(/ });
      if (input === 'touch') await review.tap();
      else {
        await review.focus();
        await page.keyboard.press('Enter');
      }
      const warnings = page.getByRole('dialog', { name: 'Layoutprüfung' });
      await expect(warnings.getByText('Randparzelle ragt über die Standortgrenze hinaus.')).toBeVisible();
      await expect(warnings.getByText('Überstehendes Beet ragt über die nutzbare Fläche von Lernparzelle hinaus.')).toBeVisible();
      await expect(warnings.getByText('Zwischen Nordbeet und Südbeet liegen 25 cm. Empfohlen sind 30 cm.')).toBeVisible();
      await expect(warnings.getByText('Die Beete füllen Volle Parzelle vollständig. Für die empfohlenen Wege fehlt Platz.')).toBeVisible();
      await expect(warnings.getByText(/In Randparzelle lässt sich die Beetfläche für Beet ohne Maße nicht genau bestimmen/)).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`geometry-warnings-${input}.png`), animations: 'disabled' });
      await page.keyboard.press('Escape');
      await expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(0);
      if (input === 'mouse') await expect(review).toBeFocused();

      const getBed = () => findShape(page, `bed-rect-${bedId}`);
      const getField = () => findShape(page, `field-rect-${fieldId}`);
      await activate('Grafik bearbeiten');
      await activate('Hineinzoomen');
      const bed = (await getBed())!;
      const parcel = (await getField())!;
      expect(bed.issue).toBe('shortGap');
      const start = { x: Math.round(bed.screen.x + bed.screen.width / 2), y: Math.round(bed.screen.y + bed.screen.height / 2) };
      const target = { x: start.x - Math.round(21 * bed.zoom), y: start.y };
      const touch = input === 'touch' ? await page.context().newCDPSession(page) : null;
      if (touch) {
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
        await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [target] });
      } else {
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(target.x, target.y, { steps: 5 });
      }
      await expect.poll(async () => (await getBed())?.issue).toBe('overlap');
      expect((await getField())?.world).toEqual(parcel.world);
      const readLayouts = () => apiRequest<{ bed_layouts: { bed: number; x: number }[] }>(page, 'GET', path);
      expect((await readLayouts()).bed_layouts.find(layout => layout.bed === bedId)?.x).toBe(52);
      const saved = page.waitForResponse(response => response.url().endsWith(path) && response.request().method() === 'PUT');
      if (touch) await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      else await page.mouse.up();
      expect((await saved).ok()).toBe(true);
      expect((await readLayouts()).bed_layouts.find(layout => layout.bed === bedId)?.x).toBeLessThan(48);
      await expect.poll(async () => (await getBed())?.issue).toBe('overlap');

      if (input === 'touch') await review.tap();
      else await review.click();
      await expect(warnings.getByText('Nordbeet überlappt Südbeet.')).toBeVisible();
      await warnings.getByRole('button', { name: 'Südbeet in der Grafik anzeigen' }).click();
      await expect(warnings).toHaveCount(0);
      await expect.poll(async () => {
        const [focused, stage] = await Promise.all([getBed(), page.locator('.konvajs-content').boundingBox()]);
        if (!focused || !stage) return Number.POSITIVE_INFINITY;
        return Math.abs(focused.screen.x + focused.screen.width / 2 - stage.x - stage.width / 2);
      }).toBeLessThan(2);

      if (input === 'mouse') {
        await activate('Grafik bearbeiten');
        await activate('Alles einpassen');
        const full = (await findShape(page, `field-rect-${fullFieldId}`))!;
        await page.mouse.click(full.screen.x + full.screen.width / 2, full.screen.y + 8);
        const details = page.getByRole('region', { name: 'Volle Parzelle', exact: true });
        await expect(details).toBeVisible();
        await expect(details).toContainText('100 m²');
        await details.getByRole('button', { name: 'Details anzeigen' }).click();
        await expect(page).toHaveURL(new RegExp(`/app/fields-beds/fields/${fullFieldId}$`));
        await expect(page.getByTestId('detail-area')).toContainText('100 m²');
        await expect(page.getByTestId('detail-covered-area')).toContainText('100 m²');
        await expect(page.getByTestId('detail-remaining-area')).toContainText(/0 m² \(0\s?%\)/);
      }
    });
  });
}
