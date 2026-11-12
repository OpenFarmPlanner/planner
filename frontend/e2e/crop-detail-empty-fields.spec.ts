import { expect, test, type Page } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject, VIEWPORTS, waitForPageStable } from './utils';

// The crop details on the crops page and in the crop library show only
// filled-in values, leave out empty sections, and follow the crop form's
// section order (docs/crop-detail.md). Asserted functionally; the screenshots
// are review artifacts only.
const PHONE_LANDSCAPE = { key: 'phone-landscape', width: 800, height: 375 } as const;

// The crop form's order as the detail views show it.
const SECTION_ORDER = [
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
  'Bibliotheksdaten',
];

async function sectionTitles(page: Page): Promise<string[]> {
  return (await page.getByRole('main').getByRole('heading', { level: 6 }).allTextContents())
    .map((title) => title.trim())
    .filter((title) => SECTION_ORDER.includes(title));
}

function expectFormOrder(titles: string[], where: string): void {
  const sorted = [...titles].sort((a, b) => SECTION_ORDER.indexOf(a) - SECTION_ORDER.indexOf(b));
  expect(titles, `${where}: sections out of the crop form's order`).toEqual(sorted);
}

async function expectNoHorizontalOverflow(page: Page, where: string): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow, `${where}: the detail overflows horizontally`).toBe(false);
}

test('hides empty crop details on the crops page at every viewport', async ({ page, request }, testInfo) => {
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
    await page.goto(`/app/crops?cropId=${crop.id}`);
    await waitForPageStable(page, /Kulturbibliothek/i);

    const sections = page.getByTestId('crop-detail-sections');
    // Navigation, backend defaults and actionable empty sections stay.
    await expect(sections.getByRole('heading', { level: 6 })).toHaveText([
      'Sorten',
      'Fruchtfolge-Eigenschaften',
      'Zeitplanung',
      'Saatgutbedarf',
      'Mischkultur',
      'Aufgabenvorlagen',
      'Lieferantendaten',
    ]);
    await expect(sections.getByText('0 Jahre')).toBeVisible();
    await expect(sections.getByText('Keine Angabe')).toHaveCount(0);
    await expect(page.getByRole('switch')).toHaveCount(0);
    await expectNoHorizontalOverflow(page, viewport.key);
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`crop-detail-${viewport.key}.png`) });
  }
});

test('hides empty details in the crop library and keeps the crop form order', async ({ page, request }, testInfo) => {
  await loginWithDeterministicProject(page, request, `library-detail-empty-${testInfo.workerIndex}`, { loginAsAdmin: true });
  const speciesResponse = await apiRequest<{ results: { id: number; name: string }[] }>(page, 'GET', '/crop-species/');
  const species = speciesResponse.results[0];
  expect(species).toBeTruthy();
  const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: species.name,
    variety: `E2E Leere Angaben ${Date.now()}`,
    crop_species: species.id,
    cultivation_types: ['direct_sowing'],
    growth_duration_days: 42,
    harvest_duration_days: 14,
    notes: 'Nur wenige Angaben.',
  });
  const published = await apiRequest<{ public_crop: { id: number } }>(page, 'POST', `/crops/${crop.id}/publish-public/`, {
    accepted_public_library_terms: true,
    crop_species_id: species.id,
    original_language_code: 'de',
  });

  for (const viewport of [VIEWPORTS[0], VIEWPORTS[3], PHONE_LANDSCAPE]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(`/app/crop-library?cropId=${published.public_crop.id}`);
    await waitForPageStable(page);
    await expect(page.getByRole('heading', { level: 6, name: 'Zeitplanung' })).toBeVisible();

    const titles = await sectionTitles(page);
    expect(titles).toEqual(expect.arrayContaining(['Allgemeine Informationen', 'Zeitplanung', 'Saatgutbedarf', 'Notizen']));
    expectFormOrder(titles, viewport.key);
    await expect(page.getByRole('main').getByText('Keine Angabe', { exact: true })).toHaveCount(0);
    await expectNoHorizontalOverflow(page, viewport.key);
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`library-detail-${viewport.key}.png`) });
  }
});
