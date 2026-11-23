import { test, expect, type Locator } from '@playwright/test';
import de from '../src/i18n/locales/de/crops.json' with { type: 'json' };
import en from '../src/i18n/locales/en/crops.json' with { type: 'json' };
import es from '../src/i18n/locales/es/crops.json' with { type: 'json' };
import fr from '../src/i18n/locales/fr/crops.json' with { type: 'json' };
import it from '../src/i18n/locales/it/crops.json' with { type: 'json' };
import nl from '../src/i18n/locales/nl/crops.json' with { type: 'json' };
import pt from '../src/i18n/locales/pt/crops.json' with { type: 'json' };
import { apiRequest, expectNoHorizontalPageOverflow, loginWithDeterministicProject, resetE2EScenario } from './utils';

test.use({ hasTouch: true, serviceWorkers: 'block' });

const viewports = [
  { width: 375, height: 800 }, { width: 768, height: 900 }, { width: 1024, height: 900 },
  { width: 1440, height: 900 }, { width: 800, height: 375 },
];

async function expectCompactRow(row: Locator) {
  const size = await row.evaluate(element => ({ outer: element.clientWidth, inner: element.scrollWidth }));
  expect(size.inner - size.outer).toBeLessThanOrEqual(1);
  const action = row.getByRole('button');
  await action.scrollIntoViewIfNeeded();
  await expect(action).toBeInViewport();
  const bounds = (await action.boundingBox())!;
  expect(bounds.width).toBeGreaterThanOrEqual(43);
  expect(bounds.height).toBeGreaterThanOrEqual(43);
}

test('crop detail lists keep localized values and actions usable at narrow widths and enlarged text', async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  const scenario = 'crop-detail-list-layout-' + Date.now();
  const taskName = 'Préparer les équipements pour la prochaine intervention et vérifier les instructions';
  const shortTaskName = 'Vérifier le stock';
  const supplierName = 'Cooperativa portuguesa de fornecimento hortícola e variedades tradicionais';
  const product = 'Zeer lange productomschrijving voor regionale groentezaden en bereiding';
  const description = 'Vérifier le matériel et les pièces de rechange.\nNoter le lot et confirmer la date de la prochaine intervention.';
  const notes = 'Lieferung im Frühjahr nach Absprache.\nDe tweede verpakking is beschikbaar op aanvraag.';
  await loginWithDeterministicProject(page, request, scenario, { loginAsAdmin: true });
  try {
    const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
      name: 'Synthetic compact crop details',
      supplier_data_input: [{
        supplier_name_input: supplierName,
        supplier_product_name: product,
        supplier_product_url: 'https://example.org/products/traditional-vegetables-long-localized-description',
        packaging_sizes: [{ size_value: 25, size_unit: 'g' }, { size_value: 250, size_unit: 'seeds' }],
        price: 0,
        notes,
      }],
    });
    await apiRequest(page, 'POST', '/crop-task-templates/', {
      crop: crop.id, title: taskName, description, reference_event: 'planting', day_offset: -3,
      repeat_interval_days: 7, repeat_until: 'count', repeat_count: 3,
    });
    await apiRequest(page, 'POST', '/crop-task-templates/', {
      crop: crop.id, title: shortTaskName, reference_event: 'planting', day_offset: 0,
    });
    for (const [language, text, titleField] of [
      ['de', de, 'Titel'], ['en', en, 'Title'], ['fr', fr, 'Titre'], ['es', es, 'Título'],
      ['it', it, 'Titolo'], ['pt', pt, 'Título'], ['nl', nl, 'Titel'],
    ] as const) {
      await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: language });
      await page.evaluate(code => {
        localStorage.setItem('ui.language', code);
        localStorage.setItem('ui.language.pendingChoice', code);
      }, language);
      await page.setViewportSize(viewports[0]);
      await page.goto('/app/crops?cropId=' + crop.id);
      const taskSection = page.getByRole('region', { name: text.taskTemplates.title, exact: true });
      const supplierSection = page.getByRole('region', { name: text.supplierData.title, exact: true });
      const task = taskSection.getByRole('listitem').filter({ hasText: taskName });
      const offer = supplierSection.getByRole('listitem').filter({ hasText: supplierName });
      const interval = text.taskTemplates.repeatEvery_other.replace('{{count}}', '7');
      const recurrence = task.getByText(interval, { exact: false });
      await expect(task.getByText(taskName, { exact: true })).toBeVisible();
      await expect(task.getByText(description)).toHaveCSS('white-space', 'pre-wrap');
      await expect(recurrence).toContainText(text.taskTemplates.occurrences_other.replace('{{count}}', '3'));
      const taskRows = taskSection.getByRole('listitem');
      await expect(taskRows).toHaveCount(2);
      await expect(taskRows.first()).toHaveCSS('border-top-width', '0px');
      await expect(taskRows.last()).toHaveCSS('border-top-width', '1px');
      await expect(offer.getByText(supplierName, { exact: true })).toBeVisible();
      await expect(offer.getByText(product, { exact: true })).toBeVisible();
      await expect(offer.getByText(notes)).toHaveCSS('white-space', 'pre-wrap');
      await expect(offer.getByText('25 ' + text.detail.packageUnits.grams, { exact: false })).toContainText('250 ' + text.detail.packageUnits.seeds);
      await expect(offer.getByText(text.supplierData.legacyPrice.replace('{{amount}}', '0'), { exact: true })).toBeVisible();
      await expect(taskSection.getByRole('button', { name: text.taskTemplates.add, exact: true })).toBeEnabled();
      await expect(supplierSection.getByRole('button', { name: text.form.addSupplierData, exact: true })).toBeEnabled();

      for (const viewport of language === 'fr' ? viewports : [viewports[0], viewports[4]]) {
        await page.setViewportSize(viewport);
        await expectCompactRow(task);
        await expectCompactRow(offer);
        await expectNoHorizontalPageOverflow(page);
        if (language === 'fr') {
          await task.scrollIntoViewIfNeeded();
          await page.screenshot({ path: testInfo.outputPath('crop-detail-lists-' + viewport.width + '.png'), animations: 'disabled' });
          if (viewport.width === 1440) {
            const title = (await task.getByText(taskName, { exact: true }).boundingBox())!;
            const metadata = (await recurrence.boundingBox())!;
            const action = (await task.getByRole('button').boundingBox())!;
            expect(metadata.x).toBeGreaterThan(title.x + title.width);
            expect(action.x).toBeGreaterThan(metadata.x + metadata.width);
            const productBounds = (await offer.getByText(product, { exact: true }).boundingBox())!;
            const packageBounds = (await offer.getByText('25 ' + text.detail.packageUnits.grams, { exact: false }).boundingBox())!;
            const offerAction = (await offer.getByRole('button').boundingBox())!;
            expect(packageBounds.x).toBeGreaterThan(productBounds.x + productBounds.width);
            expect(offerAction.x).toBeGreaterThan(packageBounds.x + packageBounds.width);
          }
        }
      }

      const taskMenuButton = task.getByRole('button');
      await taskMenuButton.focus();
      await page.keyboard.press('Enter');
      const taskEdit = page.getByRole('menuitem', { name: text.taskTemplates.editNamed.replace('{{title}}', taskName), exact: true });
      await expect(taskEdit).toBeFocused();
      await page.keyboard.press('Enter');
      const editor = page.getByRole('dialog', { name: text.taskTemplates.edit, exact: true });
      await expect(editor.getByRole('textbox', { name: titleField, exact: true })).toHaveValue(taskName);
      await page.keyboard.press('Escape');
      await expect(editor).toBeHidden();

      const supplierActions = offer.getByRole('button');
      const supplierEdit = page.getByRole('menuitem', { name: text.supplierData.editNamed.replace('{{supplier}}', supplierName), exact: true });
      const supplierDelete = page.getByRole('menuitem', { name: text.supplierData.deleteNamed.replace('{{supplier}}', supplierName), exact: true });
      for (const viewport of [viewports[4], viewports[0]]) {
        await page.setViewportSize(viewport);
        await supplierActions.tap();
        await expect(supplierEdit).toBeInViewport();
        await expect(supplierDelete).toBeInViewport();
        if (language === 'fr' && viewport.width === 375) {
          await page.screenshot({ path: testInfo.outputPath('supplier-actions-fr.png'), animations: 'disabled' });
        }
        await page.keyboard.press('Escape');
        await expect(supplierActions).toBeFocused();
      }

      if (language === 'pt') {
        const enlargedText = await page.addStyleTag({ content: 'html { font-size: 200%; }' });
        await expectCompactRow(task);
        await expectCompactRow(offer);
        await expectNoHorizontalPageOverflow(page);
        await page.screenshot({ path: testInfo.outputPath('crop-detail-lists-200-percent.png'), animations: 'disabled' });
        await enlargedText.evaluate(element => element.remove());
      }
    }
  } finally {
    await resetE2EScenario(request, scenario);
  }
});

test('crop details save templates independently and instantiate plan tasks', async ({ page, request }, testInfo) => {
  await loginWithDeterministicProject(page, request, `task-template-${testInfo.workerIndex}`, { loginAsAdmin: true });
  const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: 'Template crop', cultivation_type: 'direct_sowing', cultivation_types: ['direct_sowing'],
  });
  const season = await apiRequest<{ id: number }>(page, 'POST', '/seasons/', { start_date: '2026-01-01', end_date: '2026-12-31' });
  const plan = await apiRequest<{ id: number }>(page, 'POST', '/planting-plans/', {
    crop: crop.id, season: season.id, planting_date: '2026-05-01', cultivation_type: 'direct_sowing',
  });
  await page.goto(`/app/crops?cropId=${crop.id}`);
  await page.getByRole('button', { name: 'Vorlage hinzufügen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Vorlage hinzufügen' });
  await dialog.getByRole('textbox', { name: 'Titel' }).fill('Beet abdecken');
  await dialog.getByRole('combobox', { name: 'Referenzereignis' }).click();
  await page.getByRole('option', { name: 'Direktsaat', exact: true }).click();
  await dialog.getByRole('spinbutton', { name: 'Abstand in Tagen' }).fill('-3');
  for (const size of [{ width: 375, height: 800 }, { width: 800, height: 375 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size);
    await page.screenshot({ path: testInfo.outputPath(`template-editor-${size.width}.png`), fullPage: true });
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(page.getByText('Beet abdecken', { exact: true })).toBeVisible();
  const tasks = await apiRequest<{ results: { title: string; due_date: string; template: number | null }[] }>(page, 'GET', `/tasks/?planting_plan=${plan.id}`);
  expect(tasks.results.find((task) => task.title === 'Beet abdecken')).toMatchObject({ due_date: '2026-04-28', template: expect.any(Number) });
  await page.getByRole('button', { name: 'Weitere Aktionen — Beet abdecken' }).click();
  await page.getByRole('menuitem', { name: 'Vorlage löschen: Beet abdecken' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Löschen' }).click();
  await expect(page.getByText('Beet abdecken', { exact: true })).not.toBeVisible();
});

test('recurring templates create independently completable occurrences', async ({ page, request }, testInfo) => {
  await loginWithDeterministicProject(page, request, `task-recurrence-${testInfo.workerIndex}`, { loginAsAdmin: true });
  const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: 'Repeat crop', cultivation_type: 'direct_sowing', cultivation_types: ['direct_sowing'],
  });
  const season = await apiRequest<{ id: number }>(page, 'POST', '/seasons/', { start_date: '2026-01-01', end_date: '2026-12-31' });
  const plan = await apiRequest<{ id: number }>(page, 'POST', '/planting-plans/', {
    crop: crop.id, season: season.id, planting_date: '2026-05-01', cultivation_type: 'direct_sowing',
  });
  await page.goto(`/app/crops?cropId=${crop.id}`);
  await page.getByRole('button', { name: 'Vorlage hinzufügen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Vorlage hinzufügen' });
  await dialog.getByRole('textbox', { name: 'Titel' }).fill('Gießen');
  await dialog.getByRole('combobox', { name: 'Referenzereignis' }).click();
  await page.getByRole('option', { name: 'Direktsaat', exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'Wiederholen' }).check();
  await dialog.getByRole('spinbutton', { name: 'Intervall in Tagen' }).fill('5');
  await dialog.getByRole('spinbutton', { name: 'Anzahl Aufgaben' }).fill('3');
  for (const size of [{ width: 375, height: 800 }, { width: 800, height: 375 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size);
    if (size.height < 500) {
      await dialog.getByRole('spinbutton', { name: 'Anzahl Aufgaben' }).scrollIntoViewIfNeeded();
      await expect(dialog.getByRole('spinbutton', { name: 'Anzahl Aufgaben' })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Speichern' })).toBeVisible();
    }
    await page.screenshot({ path: testInfo.outputPath(`recurring-editor-${size.width}.png`), fullPage: true });
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).not.toBeVisible();
  type Occurrence = { id: number; title: string; status: string; occurrence_index: number; due_date: string };
  const initial = await apiRequest<{ results: Occurrence[] }>(page, 'GET', `/tasks/?planting_plan=${plan.id}&origin=template`);
  expect(initial.results).toHaveLength(3);
  const first = initial.results.find((task) => task.occurrence_index === 0)!;
  await apiRequest(page, 'PATCH', `/tasks/${first.id}/`, { status: 'completed' });
  await apiRequest(page, 'PATCH', `/planting-plans/${plan.id}/`, { planting_date: '2026-06-01' });
  const changed = await apiRequest<{ results: Occurrence[] }>(page, 'GET', `/tasks/?planting_plan=${plan.id}&origin=template`);
  expect(changed.results.map((task) => task.id).sort()).toEqual(initial.results.map((task) => task.id).sort());
  expect(changed.results.find((task) => task.id === first.id)).toMatchObject({ status: 'completed', due_date: '2026-05-01' });
  expect(changed.results.find((task) => task.occurrence_index === 2)).toMatchObject({ status: 'pending', due_date: '2026-06-11' });
});
