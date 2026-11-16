import { expect, test, type Locator } from '@playwright/test';
import { apiRequest, expectNoHorizontalPageOverflow, loginWithDeterministicProject } from './utils';

const languages = [
  { code: 'pt', start: 'Ver demonstração sem registo', add: 'Adicionar série', explicit: ['Data de sementeira', 'Data de transplantação'], headings: ['Sementeira', 'Transplantação', 'Início da colheita', 'Fim da colheita'] },
  { code: 'it', start: 'Guarda la demo senza registrarti', add: 'Aggiungi serie', explicit: ['Data di semina', 'Data di trapianto'], headings: ['Semina', 'Trapianto', 'Inizio raccolta', 'Fine raccolta'] },
  { code: 'es', start: 'Ver la demo sin registrarse', add: 'Añadir serie', explicit: ['Fecha de siembra', 'Fecha de plantación'], headings: ['Siembra', 'Trasplante', 'Inicio de cosecha', 'Fin de cosecha'] },
] as const;
const fields = ['sowing_date', 'planting_date', 'harvest_date', 'harvest_end_date'];

async function expectReadableHeader(header: Locator, text: string) {
  await header.scrollIntoViewIfNeeded();
  const rect = await header.boundingBox();
  await header.hover({ position: { x: rect!.width - 8, y: rect!.height - 4 } });
  const label = header.locator('.MuiDataGrid-columnHeaderTitleContainerContent > span');
  await expect(label).toHaveText(text);
  await expect.poll(() => label.evaluate(node => {
    const rect = node.getBoundingClientRect();
    const headerRect = node.closest('[role="columnheader"]')!.getBoundingClientRect();
    const controls = Array.from(node.closest('[role="columnheader"]')!
      .querySelectorAll('.MuiDataGrid-iconButtonContainer, .MuiDataGrid-menuIcon'));
    return node.scrollHeight <= node.clientHeight + 1
      && node.scrollWidth <= node.clientWidth + 1
      && rect.top >= headerRect.top && rect.bottom <= headerRect.bottom
      && controls.every(control => rect.right <= control.getBoundingClientRect().left + 1);
  })).toBe(true);
}

for (const language of languages) {
  test(`${language.code} headings fit beside active sorting and column menus`, async ({ page, request }) => {
    await loginWithDeterministicProject(page, request, `planting-headings-${language.code}`, {
      demoProject: true, loginAsAdmin: true,
    });
    await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: language.code });
    await page.evaluate(code => {
      localStorage.setItem('ui.language', code);
      // An explicit saved choice keeps harvest columns visible on tablets too.
      localStorage.setItem('tableColumns.plantingPlans', '{}');
    }, language.code);
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/app/planting-plans');
      for (const [index, field] of fields.entries()) {
        const header = page.locator(`[role="columnheader"][data-field="${field}"]`);
        await expectReadableHeader(header, language.headings[index]);
        if (field === 'planting_date') {
          await header.click();
          if (await header.getAttribute('aria-sort') === 'none') await header.click();
          await expect(header).toHaveAttribute('aria-sort', /ascending|descending/);
          await expectReadableHeader(header, language.headings[index]);
          await header.locator('.MuiDataGrid-menuIconButton').click();
          await expect(page.getByRole('menu')).toBeVisible();
          await page.keyboard.press('Escape');
        }
      }
      // Text-only enlargement exercises wrapping independently of browser zoom.
      const enlargedText = await page.addStyleTag({ content:
        '.MuiDataGrid-columnHeaderTitleContainerContent > span { font-size: 21px !important; }',
      });
      for (const [index, field] of fields.entries()) {
        await expectReadableHeader(page.locator(`[role="columnheader"][data-field="${field}"]`), language.headings[index]);
      }
      await enlargedText.evaluate(node => node.remove());
      await expectNoHorizontalPageOverflow(page);
      expect(await page.evaluate(() => localStorage.getItem('tableColumns.plantingPlans'))).toBe('{}');
    }
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/app/planting-plans');
    await expect(page.locator('[data-mobile-card-id]').first()).toBeVisible();
    await page.getByRole('button', { name: new RegExp(`^${language.add}`) }).first().click();
    const dialog = page.getByRole('dialog');
    for (const name of language.explicit) await expect(dialog.getByRole('textbox', { name, exact: true })).toBeVisible();
    await expectNoHorizontalPageOverflow(page);
  });

  test.describe(`${language.code} guest demo headings`, () => {
    test.use({ locale: language.code });
    test('uses the same concise table labels', async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/${language.code}`);
      await page.getByRole('button', { name: language.start, exact: true }).click();
      await expect(page).toHaveURL(/\/app\/fields-beds/);
      await page.goto('/app/planting-plans');
      for (const [index, field] of fields.entries()) {
        await expectReadableHeader(page.locator(`[role="columnheader"][data-field="${field}"]`), language.headings[index]);
      }
    });
  });
}
