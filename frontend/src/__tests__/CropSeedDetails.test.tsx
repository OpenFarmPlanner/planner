import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CropSeedDetails, type CropSeedRateRow, type ValueSource } from '../crops/CropSeedDetails';
import i18n from '../i18n';
import type { CultivationType } from '../api/types';

const t = i18n.getFixedT('de', 'crops') as (key: string) => string;

interface RenderOptions {
  activeCultivationTypes?: CultivationType[];
  cultivationTypeSource?: ValueSource | null;
  seedRateRows?: CropSeedRateRow[];
  showSeedSafetyMargin?: boolean;
  sowingSafetyPercent?: number | null;
  sowingSafetySource?: ValueSource | null;
  seedingRequirement?: number | null;
  seedingRequirementSource?: ValueSource | null;
  seedingRequirementType?: 'per_sqm' | 'per_plant' | '';
  seedingRequirementTypeSource?: ValueSource | null;
  thousandKernelWeightG?: number | null;
  thousandKernelWeightSource?: ValueSource | null;
}

const renderDetails = (options: RenderOptions = {}) =>
  render(
    <CropSeedDetails
      activeCultivationTypes={options.activeCultivationTypes ?? []}
      cultivationTypeSource={options.cultivationTypeSource}
      seedRateRows={options.seedRateRows ?? []}
      showSeedSafetyMargin={options.showSeedSafetyMargin}
      sowingSafetyPercent={options.sowingSafetyPercent}
      sowingSafetySource={options.sowingSafetySource}
      seedingRequirement={options.seedingRequirement}
      seedingRequirementSource={options.seedingRequirementSource}
      seedingRequirementType={options.seedingRequirementType}
      seedingRequirementTypeSource={options.seedingRequirementTypeSource}
      thousandKernelWeightG={options.thousandKernelWeightG}
      thousandKernelWeightSource={options.thousandKernelWeightSource}
      emptyValueLabel="—"
      locale="de-DE"
      t={t}
    />,
  );

const row = (overrides: Partial<CropSeedRateRow> = {}): CropSeedRateRow => ({
  method: 'direct_sowing',
  value: 2.5,
  unit: 'g_per_m2',
  safety: 10,
  ...overrides,
});

/** The value's own container, which is what carries the variety highlight. */
const valueFor = (label: string): HTMLElement =>
  screen.getByText(label).nextElementSibling as HTMLElement;

/**
 * Shared between the crop detail page, the seeding section of the crop form
 * and the public crop library. Those three differ in what they are allowed to
 * show and in where each number came from, so this component's job is mostly
 * deciding which shape to render -- and that is what is covered here.
 *
 * The real German bundle is used rather than a passthrough `t`: several
 * branches differ only in which unit or suffix they append.
 */
describe('CropSeedDetails', () => {
  describe('cultivation type', () => {
    it('stays out of the way when no method is set', () => {
      renderDetails({ activeCultivationTypes: [] });

      expect(screen.queryByText('Anbauart')).not.toBeInTheDocument();
    });

    it('names a single method', () => {
      renderDetails({ activeCultivationTypes: ['pre_cultivation'] });

      expect(valueFor('Anbauart')).toHaveTextContent('Pflanzung');
    });

    it('lists both methods when a crop is grown either way', () => {
      renderDetails({ activeCultivationTypes: ['pre_cultivation', 'direct_sowing'] });

      expect(valueFor('Anbauart')).toHaveTextContent('Pflanzung, Direktsaat');
    });
  });

  describe('one seed rate versus a rate per method', () => {
    it('shows a single amount when the crop has one method', () => {
      renderDetails({
        activeCultivationTypes: ['direct_sowing'],
        seedRateRows: [row({ value: 2.5, unit: 'g_per_m2' })],
      });

      expect(valueFor('Menge')).toHaveTextContent('2,5 g / m²');
      // A one-row table would be a heavier layout saying the same thing.
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('switches to a table once the crop is grown both ways', () => {
      renderDetails({
        activeCultivationTypes: ['pre_cultivation', 'direct_sowing'],
        seedRateRows: [
          row({ method: 'pre_cultivation', value: 1.2, unit: 'seeds_per_plant', safety: 5 }),
          row({ method: 'direct_sowing', value: 3, unit: 'g_per_m2', safety: 15 }),
        ],
      });

      expect(screen.getByText('Saatgutmenge nach Anbauart')).toBeInTheDocument();
      const rows = screen.getAllByRole('row').slice(1);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toHaveTextContent('Pflanzung');
      expect(rows[0]).toHaveTextContent('1,2');
      expect(rows[0]).toHaveTextContent('Korn / Pflanze');
      expect(rows[1]).toHaveTextContent('Direktsaat');
      expect(rows[1]).toHaveTextContent('g / m²');
      // The single-value block would repeat the first row out of context.
      expect(screen.queryByText('Menge', { selector: 'p' })).not.toBeInTheDocument();
    });

    it('keeps three decimals in the table as well', () => {
      renderDetails({
        activeCultivationTypes: ['pre_cultivation', 'direct_sowing'],
        seedRateRows: [
          row({ method: 'pre_cultivation', value: 0.125, unit: 'seeds_per_lfm' }),
          row({ method: 'direct_sowing', value: 3, unit: 'g_per_m2' }),
        ],
      });

      const rows = screen.getAllByRole('row').slice(1);
      expect(within(rows[0]).getByRole('cell', { name: '0,125' })).toBeInTheDocument();
    });

    it('shows neither when there are no rates at all', () => {
      renderDetails({ activeCultivationTypes: ['direct_sowing'], seedRateRows: [] });

      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(screen.queryByText('Menge')).not.toBeInTheDocument();
    });

    it('shows the first rate when a one-method crop carries several', () => {
      // `hasSingleSeedRate` only asks that one method is active, so the rows
      // can still outnumber it -- a crop whose method was narrowed after the
      // rates were entered. The row shown has to be the first, or the value
      // belongs to a method the crop is no longer grown by.
      renderDetails({
        activeCultivationTypes: ['direct_sowing'],
        seedRateRows: [
          row({ method: 'direct_sowing', value: 2.5, unit: 'g_per_m2' }),
          row({ method: 'pre_cultivation', value: 9, unit: 'seeds_per_plant' }),
        ],
      });

      expect(valueFor('Menge')).toHaveTextContent('2,5 g / m²');
      expect(screen.queryByText(/9 Korn \/ Pflanze/)).not.toBeInTheDocument();
    });

    it('formats a seed rate to three decimals, not two', () => {
      // Seeds per running meter are small numbers where the third decimal is
      // the difference between two sowing settings.
      renderDetails({
        activeCultivationTypes: ['direct_sowing'],
        seedRateRows: [row({ value: 0.125, unit: 'seeds_per_lfm' })],
      });

      expect(valueFor('Menge')).toHaveTextContent('0,125 Korn / lfm');
    });

    it('passes an unrecognised unit through rather than blanking it', () => {
      renderDetails({
        activeCultivationTypes: ['direct_sowing'],
        seedRateRows: [row({ unit: 'kg_per_hectare' })],
      });

      expect(valueFor('Menge')).toHaveTextContent('kg_per_hectare');
    });
  });

  describe('the seed safety margin', () => {
    it('accompanies a single seed rate', () => {
      renderDetails({
        activeCultivationTypes: ['direct_sowing'],
        seedRateRows: [row({ safety: 12.5 })],
      });

      expect(valueFor('Sicherheitszuschlag Saatgut')).toHaveTextContent('12,5 %');
    });

    it('shows a dash where the rate carries no margin', () => {
      renderDetails({
        activeCultivationTypes: ['direct_sowing'],
        seedRateRows: [row({ safety: null })],
      });

      expect(valueFor('Sicherheitszuschlag Saatgut')).toHaveTextContent('-');
    });

    it('keeps a margin of zero, which is a decision and not a gap', () => {
      renderDetails({
        activeCultivationTypes: ['direct_sowing'],
        seedRateRows: [row({ safety: 0 })],
      });

      expect(valueFor('Sicherheitszuschlag Saatgut')).toHaveTextContent('0 %');
    });

    it('gets its own column in the per-method table', () => {
      renderDetails({
        activeCultivationTypes: ['pre_cultivation', 'direct_sowing'],
        seedRateRows: [
          row({ method: 'pre_cultivation', safety: 5 }),
          row({ method: 'direct_sowing', safety: null }),
        ],
      });

      expect(screen.getByRole('columnheader', { name: 'Sicherheitszuschlag (%)' })).toBeInTheDocument();
      const rows = screen.getAllByRole('row').slice(1);
      expect(within(rows[0]).getByRole('cell', { name: '5 %' })).toBeInTheDocument();
      expect(within(rows[1]).getByRole('cell', { name: '-' })).toBeInTheDocument();
    });

    it('keeps a margin of zero in the table too', () => {
      renderDetails({
        activeCultivationTypes: ['pre_cultivation', 'direct_sowing'],
        seedRateRows: [
          row({ method: 'pre_cultivation', safety: 0 }),
          row({ method: 'direct_sowing', safety: 10 }),
        ],
      });

      const rows = screen.getAllByRole('row').slice(1);
      expect(within(rows[0]).getByRole('cell', { name: '0 %' })).toBeInTheDocument();
    });

    it('stands alone when the crop has a margin but no rates', () => {
      // The crop-level margin still applies to whatever rate is derived later.
      renderDetails({ seedRateRows: [], sowingSafetyPercent: 8 });

      expect(valueFor('Sicherheitszuschlag Saatgut')).toHaveTextContent('8 %');
    });

    it('yields to the per-rate margin once rates exist', () => {
      renderDetails({
        activeCultivationTypes: ['direct_sowing'],
        seedRateRows: [row({ safety: 12 })],
        sowingSafetyPercent: 8,
      });

      // One margin per view: the rate's own figure is the specific one.
      expect(screen.getAllByText('Sicherheitszuschlag Saatgut')).toHaveLength(1);
      expect(valueFor('Sicherheitszuschlag Saatgut')).toHaveTextContent('12 %');
    });

    it('is absent when the crop has no margin of its own', () => {
      renderDetails({ seedRateRows: [], sowingSafetyPercent: null });

      expect(screen.queryByText('Sicherheitszuschlag Saatgut')).not.toBeInTheDocument();
    });
  });

  describe('in the public crop library, where the margin is hidden', () => {
    it('drops the margin beside a single rate', () => {
      // The safety margin is a farm's own planning decision, so a view on
      // data that belongs to nobody in particular must not imply one.
      renderDetails({
        activeCultivationTypes: ['direct_sowing'],
        seedRateRows: [row({ safety: 10 })],
        showSeedSafetyMargin: false,
      });

      expect(valueFor('Menge')).toHaveTextContent('2,5');
      expect(screen.queryByText('Sicherheitszuschlag Saatgut')).not.toBeInTheDocument();
    });

    it('drops the margin column from the table as well', () => {
      renderDetails({
        activeCultivationTypes: ['pre_cultivation', 'direct_sowing'],
        seedRateRows: [
          row({ method: 'pre_cultivation', safety: 5 }),
          row({ method: 'direct_sowing', safety: 15 }),
        ],
        showSeedSafetyMargin: false,
      });

      // Header and cells both, or the table would keep an empty column.
      expect(
        screen.queryByRole('columnheader', { name: 'Sicherheitszuschlag (%)' }),
      ).not.toBeInTheDocument();
      expect(screen.getAllByRole('row')[0].children).toHaveLength(3);
      expect(screen.getAllByRole('row')[1].children).toHaveLength(3);
    });

    it('drops the standalone crop-level margin too', () => {
      renderDetails({ seedRateRows: [], sowingSafetyPercent: 8, showSeedSafetyMargin: false });

      expect(screen.queryByText('Sicherheitszuschlag Saatgut')).not.toBeInTheDocument();
    });
  });

  describe('seeding requirement', () => {
    it('appends the per-square-metre basis', () => {
      renderDetails({ seedingRequirement: 4, seedingRequirementType: 'per_sqm' });

      expect(valueFor('Saatgutbedarf')).toHaveTextContent('4 / m²');
    });

    it('appends the per-plant basis', () => {
      // The same number means very different things under the two bases.
      renderDetails({ seedingRequirement: 4, seedingRequirementType: 'per_plant' });

      expect(valueFor('Saatgutbedarf')).toHaveTextContent('4 / Pflanze');
    });

    it('shows the bare number when no basis is recorded', () => {
      renderDetails({ seedingRequirement: 4, seedingRequirementType: '' });

      expect(valueFor('Saatgutbedarf')).toHaveTextContent('4');
      expect(screen.queryByText(/\/ m²|\/ Pflanze/)).not.toBeInTheDocument();
    });

    it('is absent when there is no requirement', () => {
      renderDetails({ seedingRequirement: null });

      expect(screen.queryByText('Saatgutbedarf')).not.toBeInTheDocument();
    });

    it('keeps a requirement of zero', () => {
      renderDetails({ seedingRequirement: 0, seedingRequirementType: 'per_sqm' });

      expect(valueFor('Saatgutbedarf')).toHaveTextContent('0 / m²');
    });
  });

  describe('thousand kernel weight', () => {
    it('is always offered, so its absence is visible rather than silent', () => {
      renderDetails({ thousandKernelWeightG: null });

      expect(valueFor('1000-Korn-Gewicht (g)')).toHaveTextContent('—');
    });

    it('carries its unit', () => {
      renderDetails({ thousandKernelWeightG: 3.75 });

      expect(valueFor('1000-Korn-Gewicht (g)')).toHaveTextContent('3,75 g');
    });

    it('rounds to two decimals', () => {
      renderDetails({ thousandKernelWeightG: 3.756 });

      expect(valueFor('1000-Korn-Gewicht (g)')).toHaveTextContent('3,76 g');
    });
  });

  describe('marking which values are the variety’s own', () => {
    const highlighted = (element: HTMLElement) =>
      getComputedStyle(element).display === 'inline-block';

    it('marks a value the variety overrides', () => {
      renderDetails({
        activeCultivationTypes: ['direct_sowing'],
        cultivationTypeSource: 'ownValue',
      });

      // The accent is how a reader tells a variety's own figure from one it
      // inherited; without it the two read as equally specific.
      expect(highlighted(valueFor('Anbauart'))).toBe(true);
    });

    it('leaves an inherited value unmarked', () => {
      renderDetails({
        activeCultivationTypes: ['direct_sowing'],
        cultivationTypeSource: 'fromCrop',
      });

      expect(highlighted(valueFor('Anbauart'))).toBe(false);
    });

    it('marks the seed rate and its margin independently', () => {
      renderDetails({
        activeCultivationTypes: ['direct_sowing'],
        seedRateRows: [row({ valueSource: 'ownValue', safetySource: 'fromCrop' })],
      });

      // A variety can override the amount while keeping the crop's margin.
      expect(highlighted(valueFor('Menge'))).toBe(true);
      expect(highlighted(valueFor('Sicherheitszuschlag Saatgut'))).toBe(false);
    });

    it('marks table cells per row and per column', () => {
      renderDetails({
        activeCultivationTypes: ['pre_cultivation', 'direct_sowing'],
        seedRateRows: [
          row({ method: 'pre_cultivation', valueSource: 'ownValue', safetySource: null }),
          row({ method: 'direct_sowing', valueSource: null, safetySource: 'ownValue' }),
        ],
      });

      const rows = screen.getAllByRole('row').slice(1);
      const amount = (r: HTMLElement) => r.children[1].firstElementChild as HTMLElement;
      const margin = (r: HTMLElement) => r.children[3].firstElementChild as HTMLElement;
      expect(highlighted(amount(rows[0]))).toBe(true);
      expect(highlighted(margin(rows[0]))).toBe(false);
      expect(highlighted(amount(rows[1]))).toBe(false);
      expect(highlighted(margin(rows[1]))).toBe(true);
    });

    it('marks the thousand kernel weight', () => {
      renderDetails({ thousandKernelWeightG: 3, thousandKernelWeightSource: 'ownValue' });

      expect(highlighted(valueFor('1000-Korn-Gewicht (g)'))).toBe(true);
    });

    it('falls back to the basis source when the requirement itself is inherited', () => {
      // Changing only the basis is itself an override worth marking, and the
      // number is meaningless without it.
      renderDetails({
        seedingRequirement: 4,
        seedingRequirementType: 'per_sqm',
        seedingRequirementSource: null,
        seedingRequirementTypeSource: 'ownValue',
      });

      expect(highlighted(valueFor('Saatgutbedarf'))).toBe(true);
    });

    it("prefers the requirement's own source over the basis source", () => {
      renderDetails({
        seedingRequirement: 4,
        seedingRequirementType: 'per_sqm',
        seedingRequirementSource: 'fromCrop',
        seedingRequirementTypeSource: 'ownValue',
      });

      expect(highlighted(valueFor('Saatgutbedarf'))).toBe(false);
    });
  });
});
