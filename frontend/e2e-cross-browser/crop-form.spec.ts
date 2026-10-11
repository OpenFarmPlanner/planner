import type { Locator, Page } from '@playwright/test';
import {
  dynamicContentMasks,
  expect,
  expectWithinViewport,
  findCrop,
  LAYOUT_TOLERANCE_PX,
  loginToDemoProject,
  openCropEditDialog,
  test,
} from './fixtures';

// Regression suite for the "Kultur bearbeiten" form looking different in
// every browser (most visibly Firefox on mobile): the shared form-width roles
// once made each outlined input shrink-wrap to the engine's intrinsic <input>
// width instead of filling its field (see docs/form-layout.md). The Sorte
// variant matters on its own: it adds the variety legend and the highlighted
// own-value fields, which change the form's widths and wrapping.
const TARGETS = [
  { key: 'kultur', name: 'Tomate', variety: null, title: 'Kultur bearbeiten' },
  { key: 'sorte', name: 'Tomate', variety: 'Roma', title: 'Sorte bearbeiten' },
] as const;

interface FieldGeometry {
  label: string;
  fieldLeft: number;
  fieldRight: number;
  inputWidth: number;
  fieldWidth: number;
}

async function measureFields(content: Locator): Promise<{
  contentLeft: number;
  contentRight: number;
  scrollOverflow: number;
  fields: FieldGeometry[];
}> {
  return content.evaluate((element) => {
    const contentBox = element.getBoundingClientRect();
    const fields = Array.from(element.querySelectorAll<HTMLElement>('.MuiFormControl-root'))
      .filter((field) => field.getClientRects().length > 0)
      .flatMap((field) => {
        const inputRoot = field.querySelector<HTMLElement>(':scope > .MuiInputBase-root');
        if (!inputRoot) {
          return [];
        }
        const fieldBox = field.getBoundingClientRect();
        return [{
          label: field.querySelector('label')?.textContent?.trim() || field.textContent?.trim().slice(0, 40) || '(unlabelled)',
          fieldLeft: fieldBox.left,
          fieldRight: fieldBox.right,
          fieldWidth: fieldBox.width,
          inputWidth: inputRoot.getBoundingClientRect().width,
        }];
      });
    return {
      contentLeft: contentBox.left,
      contentRight: contentBox.right,
      scrollOverflow: element.scrollWidth - element.clientWidth,
      fields,
    };
  });
}

async function openTarget(page: Page, target: (typeof TARGETS)[number]): Promise<Locator> {
  await page.goto('/app/crops');
  const crop = await findCrop(page, target.name, target.variety);
  const dialog = await openCropEditDialog(page, crop.id);
  await expect(dialog.locator('#crop-form-dialog-title')).toHaveText(target.title);
  return dialog;
}

for (const target of TARGETS) {
  test.describe(`${target.title} (${target.name}${target.variety ? ` ${target.variety}` : ''})`, () => {
    test.beforeEach(async ({ page }, testInfo) => {
      await loginToDemoProject(page, testInfo);
    });

    test('every field fits the dialog and fills its own width', async ({ page }) => {
      const dialog = await openTarget(page, target);
      const content = dialog.locator('.MuiDialogContent-root');
      const geometry = await measureFields(content);

      expect(geometry.scrollOverflow, 'dialog content scrolls horizontally').toBeLessThanOrEqual(LAYOUT_TOLERANCE_PX);
      expect(geometry.fields.length, 'no form fields rendered').toBeGreaterThan(10);
      for (const field of geometry.fields) {
        expect(field.fieldLeft, `${field.label}: starts left of the dialog content`)
          .toBeGreaterThanOrEqual(geometry.contentLeft - LAYOUT_TOLERANCE_PX);
        expect(field.fieldRight, `${field.label}: ends right of the dialog content`)
          .toBeLessThanOrEqual(geometry.contentRight + LAYOUT_TOLERANCE_PX);
        expect(field.inputWidth, `${field.label}: input does not fill its field (shrink-wrapped to the browser's intrinsic width)`)
          .toBeGreaterThanOrEqual(field.fieldWidth - LAYOUT_TOLERANCE_PX);
      }

      // Nothing inside the dialog (MUI puts role="dialog" on the Paper) is
      // wider than the dialog itself.
      const overflowing = await dialog.evaluate((paper) => {
        const paperBox = paper.getBoundingClientRect();
        return Array.from(paper.querySelectorAll<HTMLElement>('*'))
          .filter((node) => node.getClientRects().length > 0)
          .filter((node) => {
            const box = node.getBoundingClientRect();
            return box.width > 0 && (box.left < paperBox.left - 1 || box.right > paperBox.right + 1);
          })
          .map((node) => `${node.tagName.toLowerCase()}.${String(node.className).slice(0, 60)}`);
      });
      expect(overflowing, 'elements wider than the dialog').toEqual([]);
    });

    test('shows decimals and the section heading the same way in every browser', async ({ page }) => {
      const dialog = await openTarget(page, target);

      // Decimal fields use the UI language's separator, not the engine's
      // native number formatting (WebKit used to show "0,5", the others "0.5").
      await expect(dialog.getByLabel('Saattiefe (cm)')).toHaveValue('0,5');

      if (target.variety) {
        // The rotation info icon stays beside the heading's last line instead
        // of drifting to the right edge when the heading wraps on a phone.
        const heading = dialog.getByRole('heading', { name: 'Fruchtfolge-Eigenschaften' });
        const icon = dialog.getByLabel('Gilt für die gesamte Kultur, änderbar nur dort.');
        const iconBox = await icon.boundingBox();
        expect(iconBox).not.toBeNull();
        const lastLine = await heading.evaluate((element) => {
          const lines = Array.from(element.getClientRects());
          const last = lines[lines.length - 1];
          return { right: last.right, top: last.top, bottom: last.bottom };
        });
        const iconCenterY = iconBox!.y + iconBox!.height / 2;
        expect(iconCenterY, 'info icon is not on the heading\'s last line').toBeGreaterThanOrEqual(lastLine.top);
        expect(iconCenterY, 'info icon is not on the heading\'s last line').toBeLessThanOrEqual(lastLine.bottom);
        expect(iconBox!.x - lastLine.right, 'info icon is detached from the heading').toBeLessThanOrEqual(12);

        // The legend reads as one sentence: its description starts on the
        // same line as the highlighted sample instead of below it.
        const legendStartsOnOneLine = await dialog.getByText('Markierte Werte', { exact: true }).evaluate((sample) => {
          const description = sample.nextSibling;
          if (!description) {
            return false;
          }
          const range = document.createRange();
          range.setStart(description, 0);
          range.setEnd(description, 3);
          const descriptionTop = range.getBoundingClientRect().top;
          const sampleBox = sample.getBoundingClientRect();
          return descriptionTop >= sampleBox.top - 2 && descriptionTop <= sampleBox.bottom;
        });
        expect(legendStartsOnOneLine, 'legend description dropped below the sample').toBe(true);
      }
    });

    test('dialog fits the viewport and save/cancel stay reachable', async ({ page }) => {
      const dialog = await openTarget(page, target);
      await expectWithinViewport(page, dialog, 'dialog');

      const content = dialog.locator('.MuiDialogContent-root');
      await content.evaluate((element) => { element.scrollTop = element.scrollHeight; });
      for (const name of ['Abbrechen', 'Speichern']) {
        const button = dialog.getByRole('button', { name, exact: true });
        await expect(button).toBeVisible();
        await expectWithinViewport(page, button, name);
      }

      await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
      await expect(dialog).toBeHidden();
    });

    test('matches the per-browser screenshots', async ({ page }) => {
      const dialog = await openTarget(page, target);
      // Keep the pointer away from the fields so no hover tooltip is captured.
      await page.mouse.move(0, 0);
      const mask = dynamicContentMasks(page);

      await expect(dialog).toHaveScreenshot(`crop-form-${target.key}-top.png`, { mask });

      // The seed section holds the fields that broke worst (number inputs
      // with a max collapsed to a few characters).
      await dialog.getByLabel('Sicherheitszuschlag für Saatgut (%)').first().scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      await expect(dialog).toHaveScreenshot(`crop-form-${target.key}-seeding.png`, { mask });
    });
  });
}
