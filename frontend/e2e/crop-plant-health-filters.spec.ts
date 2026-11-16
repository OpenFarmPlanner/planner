import { expect, test, type Page } from '@playwright/test';
import { apiRequest, expectNoHorizontalPageOverflow, loginWithDeterministicProject, resetE2EScenario } from './utils';
import { SUPPORTED_LANGUAGES } from '../src/i18n/languages';
import type { Crop, PublicCrop } from '../src/api/types';
import type { PlantHealthEntry } from '../src/crop-library/plant-health/types';
import de from '../src/i18n/locales/de/crops.json' with { type: 'json' };

test.use({ serviceWorkers: 'block' });

async function openFilters(page: Page, publicLibrary = false) {
  const advanced = page.getByRole('button', { name: de.filters.openAdvanced, exact: true });
  const selector = page.getByRole('button', { name: de.selectCrop, exact: true });
  await expect(advanced.or(selector).first()).toBeVisible();
  if (!await advanced.isVisible()) await selector.click();
  await advanced.click();
  const panel = page.locator(publicLibrary ? '#public-crop-filters-popover' : '#crop-filters-popover');
  await expect(panel).toBeVisible();
  return { panel, input: panel.getByRole('combobox', { name: de.plantHealth.label, exact: true }) };
}

async function closeFilters(page: Page, panel: ReturnType<Page['locator']>) {
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
}

for (const [width, height] of [[375, 800], [768, 900], [1024, 900], [1440, 900], [800, 375]]) {
  test(`plant-health AND filters and sourced host relationships at ${width}x${height}`, async ({ page, request }, info) => {
    test.setTimeout(180_000);
    const scenario = `health-filters-${width}-${Date.now()}`;
    try {
      await page.setViewportSize({ width, height });
      await loginWithDeterministicProject(page, request, scenario, { demoProject: true, loginAsAdmin: true, libraryModerator: true });
      const createSpecies = async (suffix: string) => {
        const name = `Synthetic ${suffix} ${scenario}`;
        const row = await apiRequest<{ id: number }>(page, 'POST', '/crop-species/', { name });
        await apiRequest(page, 'POST', `/crop-species/${row.id}/approve/`, {
          translations: SUPPORTED_LANGUAGES.map(({ code }) => ({ language_code: code, common_name: name })),
        });
        return { ...row, name };
      };
      const species = await createSpecies('filter host');
      const otherSpecies = await createSpecies('other documented host');
      const createEntry = async (suffix: string, broad = false) => {
        const row = await apiRequest<PlantHealthEntry>(page, 'POST', '/plant-health/entries/', {
          name: `Synthetic ${suffix} ${scenario}`, kind: broad ? 'group' : 'pathogen',
          scientific_name: broad ? '' : `Syntheticus ${suffix} ${scenario}`,
          sources: [{ url: 'https://example.org/synthetic-filter-fixture', title: 'Synthetic test data only' }],
          translations: SUPPORTED_LANGUAGES.map(({ code }) => ({ language_code: code,
            preferred_name: `${broad ? 'Broad label' : 'Same vernacular label'} ${scenario}`,
            synonyms: [`Alias ${suffix} ${scenario}`],
          })),
        });
        return apiRequest<PlantHealthEntry>(page, 'POST', `/plant-health/entries/${row.id}/approve/`, {});
      };
      const first = await createEntry('alpha');
      const second = await createEntry('beta');
      const broad = await createEntry('broad', true);
      const official = (entry: PlantHealthEntry) => ({ name: entry.name, catalogue_identity: entry.identity_key });
      const localName = `Project-only spot ${scenario}`;
      const parent = await apiRequest<Crop>(page, 'POST', '/crops/', {
        name: species.name, crop_species: species.id, growth_duration_days: 42, harvest_duration_days: 14,
        plant_health: { entries: [official(first), official(broad), { name: localName }] },
        pests_diseases: 'Early sowing protects against carrot fly. Repels aphids.',
      });
      const createVariety = (variety: string, plant_health: Crop['plant_health']) => apiRequest<Crop>(page, 'POST', '/crops/', {
        name: species.name, crop_species: species.id, variety, plant_health,
        growth_duration_days: 42, harvest_duration_days: 14,
      });
      const inherited = await createVariety('Synthetic inherited filter variety', null);
      const empty = await createVariety('Synthetic empty filter variety', { entries: [] });
      const own = await createVariety('Synthetic own AND variety', { entries: [official(first), official(second)] });
      for (const [hostSpecies, variety] of [[species, ''], [otherSpecies, 'Synthetic qualified variety']] as const) {
        await apiRequest(page, 'POST', '/plant-health/hosts/', {
          entry: first.id, species: hostSpecies.id, variety_name: variety, is_confirmed: true,
          qualification: 'Synthetic source conditions only; not agronomic evidence.',
          sources: [{ url: 'https://example.org/synthetic-qualified-host', title: 'Synthetic host source', evidence: 'Qualified synthetic relationship only.' }],
        });
      }
      const publish = async (crop: Crop, general = false) => (await apiRequest<{ public_crop: PublicCrop }>(page, 'POST', `/crops/${crop.id}/publish-public/`, {
        accepted_public_library_terms: true, crop_species_id: species.id, original_language_code: 'de', publish_as_general: general,
      })).public_crop;
      await publish(parent, true);
      const publicInherited = await publish(inherited);
      await apiRequest(page, 'PATCH', `/public-crops/${publicInherited.id}/`, { base_version: publicInherited.version, plant_health: null });
      await publish(empty);
      const publicOwn = await publish(own);

      await page.goto(`/app/crops?cropId=${parent.id}`);
      const privateFilter = await openFilters(page);
      await privateFilter.input.fill(`Alias alpha ${scenario}`);
      await page.getByRole('option', { name: new RegExp(`Syntheticus alpha ${scenario}`) }).click();
      await privateFilter.input.fill(localName);
      await page.getByRole('option', { name: localName, exact: true }).click();
      if (width === 375 || height === 375) {
        const reset = privateFilter.panel.getByRole('button', { name: de.filters.reset, exact: true });
        await reset.scrollIntoViewIfNeeded();
        await expect(reset).toBeInViewport();
        await page.screenshot({ path: info.outputPath(`private-filter-actions-${width}.png`), animations: 'disabled' });
        await privateFilter.input.scrollIntoViewIfNeeded();
      }
      await privateFilter.panel.locator('.MuiPopover-paper').evaluate(element => { element.scrollTop = 0; });
      await expectNoHorizontalPageOverflow(page);
      await page.screenshot({ path: info.outputPath(`private-filter-${width}.png`), animations: 'disabled' });
      await closeFilters(page, privateFilter.panel);
      await page.getByRole('textbox', { name: de.searchPlaceholder, exact: true }).fill(species.name);
      await expect(page.getByRole('option', { name: inherited.variety! })).toBeVisible();
      await expect(page.getByRole('option', { name: empty.variety! })).toHaveCount(0);
      await expect(page.getByRole('option', { name: own.variety! })).toHaveCount(0);

      await page.goto(`/app/crop-library?cropId=${publicOwn.id}`);
      const publicFilter = await openFilters(page, true);
      await publicFilter.input.fill(localName);
      await expect(page.getByRole('option', { name: localName, exact: true })).toHaveCount(0);
      await publicFilter.input.fill(`Alias alpha ${scenario}`);
      await page.getByRole('option', { name: new RegExp(`Syntheticus alpha ${scenario}`) }).click();
      await publicFilter.input.fill(`Alias beta ${scenario}`);
      await page.getByRole('option', { name: new RegExp(`Syntheticus beta ${scenario}`) }).click();
      if (width === 375 || height === 375) {
        const reset = publicFilter.panel.getByRole('button', { name: de.filters.reset, exact: true });
        await reset.scrollIntoViewIfNeeded();
        await expect(reset).toBeInViewport();
        await page.screenshot({ path: info.outputPath(`public-filter-actions-${width}.png`), animations: 'disabled' });
        await publicFilter.input.scrollIntoViewIfNeeded();
      }
      await publicFilter.panel.locator('.MuiPopover-paper').evaluate(element => { element.scrollTop = 0; });
      await page.screenshot({ path: info.outputPath(`public-filter-${width}.png`), animations: 'disabled' });
      await closeFilters(page, publicFilter.panel);
      await page.getByRole('textbox', { name: de.library.searchLabel, exact: true }).fill(species.name);
      await expect(page.getByRole('option', { name: own.variety! })).toBeVisible();
      await expect(page.getByRole('option', { name: inherited.variety! })).toHaveCount(0);
      await expect(page.getByRole('option', { name: empty.variety! })).toHaveCount(0);

      await page.goto(`/app/crop-library?cropId=${publicOwn.id}`);
      await page.getByRole('button', { name: new RegExp(`Syntheticus alpha ${scenario}`) }).click();
      const relationships = page.getByRole('dialog', { name: de.plantHealth.relationshipsTitle });
      await expect(relationships.getByText(otherSpecies.name, { exact: true })).toBeVisible();
      await expect(relationships.getByText(/Sortenbezogener Beleg: Synthetic qualified variety/)).toBeVisible();
      await expect(relationships.getByRole('link', { name: 'Synthetic host source' })).toHaveCount(2);
      await expect(relationships.getByRole('button', { name: 'Schließen', exact: true })).toBeInViewport();
      expect(await relationships.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await page.screenshot({ path: info.outputPath(`public-hosts-${width}.png`), animations: 'disabled' });
      await relationships.getByRole('button', { name: 'Schließen', exact: true }).click();
      await page.goto(`/app/crops?cropId=${parent.id}`);
      await page.getByRole('button', { name: new RegExp(`Same vernacular label ${scenario}.*Katalogeintrag`) }).click();
      await expect(relationships.getByText(otherSpecies.name, { exact: true })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`private-hosts-${width}.png`), animations: 'disabled' });
      await relationships.getByRole('button', { name: 'Schließen', exact: true }).click();
      await page.getByRole('button', { name: new RegExp(`Broad label ${scenario}.*Katalogeintrag`) }).click();
      await expect(relationships.getByText(de.plantHealth.broadRelationshipHint)).toBeVisible();
      await expect(relationships.getByRole('link')).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`broad-unknown-${width}.png`), animations: 'disabled' });

      if (width === 1440) {
        await relationships.getByRole('button', { name: 'Schließen', exact: true }).click();
        const other = await apiRequest<{ id: number }>(page, 'POST', '/projects/', { name: `Other scoped filters ${scenario}` });
        await apiRequest(page, 'POST', '/projects-switch/', { project_id: other.id });
        await page.reload();
        await expect.poll(() => page.evaluate(() => localStorage.getItem('activeProjectId'))).toBe(String(other.id));
        const otherCrop = await apiRequest<Crop>(page, 'POST', '/crops/', { name: 'Other scoped crop', plant_health: { entries: [{ name: 'Other scoped name' }] } });
        await page.goto(`/app/crops?cropId=${otherCrop.id}`);
        const switched = await openFilters(page);
        await expect(switched.panel.locator('.MuiChip-root')).toHaveCount(0);
        await switched.input.click();
        await expect(page.getByRole('option', { name: 'Other scoped name', exact: true })).toBeVisible();
        await expect(page.getByRole('option', { name: localName, exact: true })).toHaveCount(0);
      }
    } finally { await resetE2EScenario(request, scenario); }
  });
}
