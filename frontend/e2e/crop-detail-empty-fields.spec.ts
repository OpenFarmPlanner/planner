import { expect, test } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject, VIEWPORTS, waitForPageStable } from './utils';

// The crop detail hides unset values by default and brings them back with
// the "Alle Angaben anzeigen" switch, a choice that survives a reload. The
// section order follows the crop form in both modes. Asserted functionally;
// the screenshots are review artifacts only.
const PHONE_LANDSCAPE = { key: 'phone-landscape', width: 800, height: 375 } as const;

test('hides empty crop details by default and shows them on request at every viewport', async ({ page, request }, testInfo) => {
  await loginWithDeterministicProject(page, request, `crop-detail-empty-${testInfo.workerIndex}`);
  await page.goto('/app/crops');
  await waitForPageStable(page, /Kulturbibliothek/i);
  const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: 'Sparse crop',
    growth_duration_days: 40,
    rotation_break_years: 0,
  });

  for (const viewport of [...VIEWPORTS, PHONE_LANDSCAPE]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.evaluate(() => localStorage.removeItem('ofp.crops.detail.showAllFields'));
    await page.goto(`/app/crops?cropId=${crop.id}`);
    await waitForPageStable(page, /Kulturbibliothek/i);

    const sections = page.getByTestId('crop-detail-sections');
    const headings = sections.getByRole('heading', { level: 6 });
    // The Sorten list is navigation and the cultivation type has a backend
    // default, so both stay; every untouched section is gone.
    await expect(headings).toHaveText([
      'Sorten',
      'Fruchtfolge-Eigenschaften',
      'Zeitplanung',
      'Saatgutbedarf',
      'Aufgabenvorlagen',
      'Lieferantendaten',
    ]);
    await expect(sections.getByText('0 Jahre')).toBeVisible();
    await expect(sections.getByText('Keine Angabe')).toHaveCount(0);
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`crop-detail-hidden-${viewport.key}.png`) });

    const toggle = page.getByRole('switch', { name: 'Alle Angaben anzeigen' });
    await toggle.click();
    await expect(sections.getByRole('heading', { level: 6, name: 'Keimung' })).toBeVisible();
    await expect(sections.getByText('Keine Angabe').first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow, `${viewport.key}: the detail overflows horizontally`).toBe(false);
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`crop-detail-all-${viewport.key}.png`) });

    await page.reload();
    await waitForPageStable(page, /Kulturbibliothek/i);
    await expect(page.getByRole('switch', { name: 'Alle Angaben anzeigen' })).toBeChecked();
    await expect(sections.getByRole('heading', { level: 6 })).toHaveText([
      'Sorten',
      'Allgemeine Informationen',
      'Fruchtfolge-Eigenschaften',
      'Zeitplanung',
      'Pflanzabstände',
      'Ertrag',
      'Saatgutbedarf',
      'Zeiträume',
      'Keimung',
      'Standort und Pflanzengesundheit',
      'Mischkultur',
      'Notizen',
      'Aufgabenvorlagen',
      'Lieferantendaten',
    ]);
  }
});
