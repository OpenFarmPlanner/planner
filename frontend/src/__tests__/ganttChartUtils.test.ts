import { describe, expect, it } from 'vitest';
import i18n from '../i18n';
import {
  buildOccupancyTooltipDetails,
  buildFieldOccupancyHierarchy,
  buildFieldOccupancyTaskGroups,
  buildSeedlingTaskGroups,
  buildSeedlingTooltipDetails,
  createGanttTaskLabels,
  formatCropDisplayLabel,
  formatGanttDate,
  getOccupancyCalendarRange,
  getMovedPlanDates,
  getOccupancyTaskPhase,
  getSeedlingCalendarRange,
} from '../pages/ganttChartUtils';
import { parseIsoDate } from '../utils/isoDate';

const locations = [{ id: 1, name: 'Hof' }];
const fields = [{ id: 10, name: 'Nordfeld', location: 1 }];
const beds = [{ id: 100, name: 'Beet A', field: 10 }];
const labels = createGanttTaskLabels(i18n.getFixedT('de'));

describe('getOccupancyTaskPhase', () => {
  it('identifies growth tasks by id suffix', () => {
    expect(getOccupancyTaskPhase({ id: 'plan-1-growth' })).toBe('growth');
  });

  it('identifies harvest tasks by id suffix', () => {
    expect(getOccupancyTaskPhase({ id: 'plan-1-harvest' })).toBe('harvest');
  });
});

describe('getMovedPlanDates', () => {
  const plan = {
    planting_date: '2026-04-01',
    harvest_date: '2026-05-20',
    harvest_end_date: '2026-06-10',
  };

  it('shifts all plan dates by the days the growth bar moved', () => {
    expect(getMovedPlanDates(plan, {
      id: 'plan-1-growth',
      startDate: parseIsoDate('2026-04-11')!,
    })).toEqual({
      planting_date: '2026-04-11',
      harvest_date: '2026-05-30',
      harvest_end_date: '2026-06-20',
    });
  });

  it('shifts all plan dates by the days the harvest bar moved', () => {
    expect(getMovedPlanDates(plan, {
      id: 'plan-1-harvest',
      startDate: parseIsoDate('2026-05-13')!,
    })).toEqual({
      planting_date: '2026-03-25',
      harvest_date: '2026-05-13',
      harvest_end_date: '2026-06-03',
    });
  });

  it('ignores a time-of-day offset below half a day, e.g. a local-midnight drop position', () => {
    const localMidnight = new Date(parseIsoDate('2026-04-11')!.getTime() - 2 * 60 * 60 * 1000);
    expect(getMovedPlanDates(plan, { id: 'plan-1-growth', startDate: localMidnight })?.planting_date)
      .toBe('2026-04-11');
  });

  it('keeps a missing harvest end empty and rejects plans without a schedule', () => {
    expect(getMovedPlanDates(
      { ...plan, harvest_end_date: null },
      { id: 'plan-1-growth', startDate: parseIsoDate('2026-04-02')! },
    )?.harvest_end_date).toBeNull();
    expect(getMovedPlanDates(
      { ...plan, harvest_date: null },
      { id: 'plan-1-growth', startDate: parseIsoDate('2026-04-02')! },
    )).toBeNull();
  });
});

describe('buildOccupancyTooltipDetails', () => {
  const storedTask = {
    startDate: parseIsoDate('2026-04-01')!,
    endDate: parseIsoDate('2026-05-20')!,
    harvestStartDate: parseIsoDate('2026-05-20')!,
    harvestEndDate: parseIsoDate('2026-06-10')!,
  };
  const valueOf = (details: ReturnType<typeof buildOccupancyTooltipDetails>, key: string) => (
    details.find((detail) => detail.labelKey === key)?.value
  );
  const formatted = (iso: string) => formatGanttDate(parseIsoDate(iso)!);

  it('describes the plan at its previewed position while the growth bar is dragged', () => {
    const details = buildOccupancyTooltipDetails({
      ...storedTask,
      id: 'plan-1-growth',
      startDate: parseIsoDate('2026-04-11')!,
      endDate: parseIsoDate('2026-05-30')!,
    });

    expect(valueOf(details, 'plantingDate')).toBe(formatted('2026-04-11'));
    expect(valueOf(details, 'firstHarvest')).toBe(formatted('2026-05-30'));
    expect(valueOf(details, 'lastHarvest')).toBe(formatted('2026-06-20'));
  });

  it('describes the plan at its previewed position while the harvest bar is dragged', () => {
    const details = buildOccupancyTooltipDetails({
      ...storedTask,
      id: 'plan-1-harvest',
      startDate: parseIsoDate('2026-05-13')!,
      endDate: parseIsoDate('2026-06-03')!,
    });

    expect(valueOf(details, 'firstHarvest')).toBe(formatted('2026-05-13'));
    expect(valueOf(details, 'lastHarvest')).toBe(formatted('2026-06-03'));
  });

  it('shows the stored dates when the bar is not moved', () => {
    const details = buildOccupancyTooltipDetails({ ...storedTask, id: 'plan-1-growth' });

    expect(valueOf(details, 'firstHarvest')).toBe(formatted('2026-05-20'));
    expect(valueOf(details, 'lastHarvest')).toBe(formatted('2026-06-10'));
  });
});

describe('getOccupancyCalendarRange', () => {
  it('spans the earliest planting date and the latest harvest end across all plans', () => {
    const range = getOccupancyCalendarRange([
      { id: 1, bed: 100, planting_date: '2026-04-10', harvest_date: '2026-06-01', harvest_end_date: '2026-06-20' },
      { id: 2, bed: 101, planting_date: '2026-02-15', harvest_date: '2026-05-01' },
      // Reaches past the season end (Dec) into the next year.
      { id: 3, bed: 102, planting_date: '2026-11-20', harvest_date: '2027-01-10', harvest_end_date: '2027-02-05' },
    ]);

    expect(range?.start.toISOString()).toContain('2026-02-15');
    expect(range?.end.toISOString()).toContain('2027-02-05');
  });

  it('falls back to the harvest date when no harvest end date is set', () => {
    const range = getOccupancyCalendarRange([
      { id: 1, bed: 100, planting_date: '2026-04-10', harvest_date: '2026-09-30' },
    ]);

    expect(range?.start.toISOString()).toContain('2026-04-10');
    expect(range?.end.toISOString()).toContain('2026-09-30');
  });

  it('returns null when the season has no scheduled plans', () => {
    expect(getOccupancyCalendarRange([])).toBeNull();
    expect(getOccupancyCalendarRange([{ id: 1, bed: 100, planting_date: null }])).toBeNull();
  });
});

describe('getSeedlingCalendarRange', () => {
  const seedlingCrops = [
    { id: 7, name: 'Tomate', propagation_duration_days: 21, cultivation_type: 'pre_cultivation' },
  ];

  it('spans the earliest propagation start and the latest transplant date', () => {
    const range = getSeedlingCalendarRange(
      [
        { id: 1, crop: 7, planting_date: '2026-05-10', cultivation_type: 'pre_cultivation' },
        { id: 2, crop: 7, planting_date: '2026-03-01', cultivation_type: 'pre_cultivation' },
      ],
      seedlingCrops,
    );

    // 2026-03-01 minus 21 days of propagation.
    expect(range?.start.toISOString()).toContain('2026-02-08');
    expect(range?.end.toISOString()).toContain('2026-05-10');
  });

  it('returns null when there are no pre-cultivation plans', () => {
    const range = getSeedlingCalendarRange(
      [{ id: 1, crop: 7, planting_date: '2026-05-10', cultivation_type: 'direct_sowing' }],
      seedlingCrops,
    );
    expect(range).toBeNull();
  });
});

describe('buildSeedlingTaskGroups', () => {

  it('formats the visible label as crop and variety', () => {
    expect(formatCropDisplayLabel('Tomate', 'Resibella')).toBe('Tomate (Resibella)');
    expect(formatCropDisplayLabel('Tomate', '')).toBe('Tomate');
  });

  it('builds tooltip details only for available values', () => {
    const details = buildSeedlingTooltipDetails({
      propagationStartDate: new Date(2026, 3, 15),
      transplantDate: new Date(2026, 4, 10),
      propagationDurationDays: 25,
      plantsCount: 40,
      plantingPlanCount: 3,
    });

    expect(details).toEqual([
      { labelKey: 'propagationStart', value: '15.4.2026' },
      { labelKey: 'transplantDate', value: '10.5.2026' },
      { labelKey: 'propagationDuration', value: '25' },
      { labelKey: 'totalPlantsCount', value: '40' },
      { labelKey: 'plantingPlanCount', value: '3' },
    ]);

    const reducedDetails = buildSeedlingTooltipDetails({
      plantingPlanCount: 1,
    });

    expect(reducedDetails).toEqual([{ labelKey: 'plantingPlanCount', value: '1' }]);
  });

  it('builds propagation windows grouped by crop', () => {
    const groups = buildSeedlingTaskGroups({
      labels,
      locations,
      fields,
      beds,
      crops: [
        {
          id: 7,
          name: 'Tomate',
          variety: 'Resibella',
          propagation_duration_days: 21,
          cultivation_type: 'pre_cultivation',
          display_color: '#ff0000',
        },
      ],
      plantingPlans: [
        {
          id: 5,
          crop: 7,
          crop_name: 'Tomate',
          bed: 100,
          bed_name: 'Beet A',
          planting_date: '2026-05-10',
          cultivation_type: 'pre_cultivation',
          area_usage_sqm: 12,
          plants_count: 18,
        },
      ],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Tomate (Resibella)');
    expect(groups[0].tasks).toHaveLength(1);
    expect(groups[0].tasks[0].startDate.toISOString()).toContain('2026-04-19');
    expect(groups[0].tasks[0].endDate.toISOString()).toContain('2026-05-10');
    expect(groups[0].tasks[0].targetBedName).toBeUndefined();
    expect(groups[0].tasks[0].targetFieldName).toBeUndefined();
    expect(groups[0].tasks[0].targetLocationName).toBeUndefined();
    expect(groups[0].tasks[0].targetAreaUsage).toBeUndefined();
    expect(groups[0].tasks[0].plantsCount).toBe(18);
    expect(groups[0].tasks[0].plantingPlanCount).toBe(1);
  });

  it('leaves bought-in plants out of the propagation calendar', () => {
    const groups = buildSeedlingTaskGroups({
      labels,
      locations,
      fields,
      beds,
      crops: [
        { id: 7, name: 'Tomate', propagation_duration_days: 21, cultivation_types: ['pre_cultivation'] },
      ],
      plantingPlans: [
        {
          id: 5,
          crop: 7,
          bed: 100,
          planting_date: '2026-05-10',
          cultivation_type: 'purchased_transplant',
        },
      ],
    });

    expect(groups).toEqual([]);
  });

  it('starts the occupancy bar of bought-in plants at the planting date', () => {
    const groups = buildFieldOccupancyTaskGroups({
      labels,
      locations,
      fields,
      beds,
      crops: [
        { id: 7, name: 'Tomate', propagation_duration_days: 21, cultivation_types: ['pre_cultivation'] },
      ],
      plantingPlans: [
        {
          id: 5,
          crop: 7,
          crop_name: 'Tomate',
          bed: 100,
          planting_date: '2026-05-10',
          harvest_date: '2026-07-01',
          harvest_end_date: '2026-08-01',
          cultivation_type: 'purchased_transplant',
        },
      ],
    });

    expect(groups[0].tasks[0].startDate.toISOString()).toContain('2026-05-10');
  });

  it('builds a propagation window from timing a Sorte inherits from its general Kultur', () => {
    const groups = buildSeedlingTaskGroups({
      labels,
      locations,
      fields,
      beds,
      crops: [
        {
          id: 9,
          name: 'Tomate',
          variety: 'Berner Rose',
          crop_species: 4,
          general_crop: 8,
          inherited_fields: ['propagation_duration_days', 'cultivation_type'],
          effective_values: {
            propagation_duration_days: 21,
            cultivation_type: 'pre_cultivation',
          },
          display_color: '#ff0000',
        },
      ],
      plantingPlans: [
        {
          id: 6,
          crop: 9,
          crop_name: 'Tomate',
          bed: 100,
          bed_name: 'Beet A',
          planting_date: '2026-05-10',
        },
      ],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].tasks).toHaveLength(1);
    expect(groups[0].tasks[0].startDate.toISOString()).toContain('2026-04-19');
    expect(groups[0].tasks[0].endDate.toISOString()).toContain('2026-05-10');
  });

  it('aggregates seedling requirements by crop, start date and transplant date independent of beds', () => {
    const groups = buildSeedlingTaskGroups({
      labels,
      locations: [
        { id: 1, name: 'Hof' },
        { id: 2, name: 'Pacht' },
      ],
      fields: [
        { id: 10, name: 'Nordfeld', location: 1 },
        { id: 20, name: 'Südfeld', location: 2 },
      ],
      beds: [
        { id: 100, name: 'Beet A', field: 10 },
        { id: 200, name: 'Beet B', field: 20 },
      ],
      crops: [
        {
          id: 7,
          name: 'Gurke',
          variety: 'RS-Gu-01.25',
          propagation_duration_days: 28,
          cultivation_type: 'pre_cultivation',
        },
      ],
      plantingPlans: [
        {
          id: 1,
          crop: 7,
          crop_name: 'Gurke',
          bed: 100,
          planting_date: '2026-02-20',
          cultivation_type: 'pre_cultivation',
          plants_count: 20,
        },
        {
          id: 2,
          crop: 7,
          crop_name: 'Gurke',
          bed: 200,
          planting_date: '2026-02-20',
          cultivation_type: 'pre_cultivation',
          plants_count: 34,
        },
        {
          id: 3,
          crop: 7,
          crop_name: 'Gurke',
          bed: 100,
          planting_date: '2026-02-27',
          cultivation_type: 'pre_cultivation',
          plants_count: 12,
        },
      ],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Gurke (RS-Gu-01.25)');
    expect(groups[0].description).toBeUndefined();
    expect(groups[0].tasks).toHaveLength(2);
    expect(groups[0].tasks[0]).toMatchObject({
      plantsCount: 54,
      plantingPlanCount: 2,
    });
    expect(groups[0].tasks[0].name).toBe('Gurke (RS-Gu-01.25)');
    expect(groups[0].tasks[0].targetBedName).toBeUndefined();
    expect(groups[0].tasks[0].targetFieldName).toBeUndefined();
    expect(groups[0].tasks[0].targetLocationName).toBeUndefined();
    expect(groups[0].tasks[1]).toMatchObject({
      plantsCount: 12,
      plantingPlanCount: 1,
    });
  });



  it('falls back to planting plan payload when the crop list is incomplete', () => {
    const groups = buildSeedlingTaskGroups({
      labels,
      locations,
      fields,
      beds,
      crops: [],
      plantingPlans: [
        {
          id: 9,
          crop: 77,
          crop_name: 'Salat',
          crop_variety: 'Bijella',
          crop_display_color: '#00aa44',
          crop_propagation_duration_days: 25,
          crop_cultivation_types: ['pre_cultivation', 'direct_sowing'],
          bed: 100,
          bed_name: 'Beet A',
          planting_date: '2026-05-10',
        },
      ],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Salat (Bijella)');
    expect(groups[0].tasks[0].color).toBe('#00aa44');
    expect(groups[0].tasks[0].startDate.toISOString()).toContain('2026-04-15');
  });

  it('prefers localized planting plan crop names in seedling labels', () => {
    const groups = buildSeedlingTaskGroups({
      labels,
      locations,
      fields,
      beds,
      crops: [
        {
          id: 77,
          name: 'Karotte',
          variety: 'Nantaise 2',
          propagation_duration_days: 21,
          cultivation_type: 'pre_cultivation',
        },
      ],
      plantingPlans: [
        {
          id: 9,
          crop: 77,
          crop_name: 'Karotte',
          crop_display_name: 'Carrot',
          crop_variety: 'Nantaise 2',
          bed: 100,
          planting_date: '2026-05-10',
          cultivation_type: 'pre_cultivation',
        },
      ],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Carrot (Nantaise 2)');
    expect(groups[0].tasks[0].name).toBe('Carrot (Nantaise 2)');
    expect(groups[0].tasks[0].cropName).toBe('Carrot');
  });

  it('ignores direct sowings and incomplete propagation data', () => {
    const groups = buildSeedlingTaskGroups({
      labels,
      locations,
      fields,
      beds,
      crops: [
        {
          id: 7,
          name: 'Möhre',
          propagation_duration_days: 0,
          cultivation_type: 'direct_sowing',
        },
        {
          id: 8,
          name: 'Salat',
          propagation_duration_days: 14,
          cultivation_type: 'pre_cultivation',
        },
      ],
      plantingPlans: [
        {
          id: 1,
          crop: 7,
          crop_name: 'Möhre',
          bed: 100,
          planting_date: '2026-04-01',
          cultivation_type: 'direct_sowing',
        },
        {
          id: 2,
          crop: 8,
          crop_name: 'Salat',
          bed: 100,
          planting_date: '2026-04-20',
          cultivation_type: 'direct_sowing',
        },
      ],
    });

    expect(groups).toEqual([]);
  });

  it('shows variety in occupancy task labels', () => {
    const groups = buildFieldOccupancyTaskGroups({
      labels,
      locations,
      fields,
      beds,
      crops: [],
      plantingPlans: [
        {
          id: 21,
          crop: 42,
          crop_name: 'Salat',
          crop_variety: 'Bijella',
          bed: 100,
          planting_date: '2026-03-01',
          harvest_date: '2026-04-15',
          harvest_end_date: '2026-04-30',
        },
      ],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].tasks).toHaveLength(2);
    expect(groups[0].tasks[0].name).toBe('Salat (Bijella)');
  });

  it('links the growth and harvest bars of a plan so they are dragged together', () => {
    const groups = buildFieldOccupancyTaskGroups({
      labels,
      locations,
      fields,
      beds,
      crops: [],
      plantingPlans: [
        {
          id: 21,
          crop: 42,
          crop_name: 'Salat',
          bed: 100,
          planting_date: '2026-03-01',
          harvest_date: '2026-04-15',
          harvest_end_date: '2026-04-30',
        },
      ],
    });

    expect(groups[0].tasks.map((task) => task.linkGroupId)).toEqual(['plan-21', 'plan-21']);
  });

  it('prefers localized planting plan crop names in occupancy labels', () => {
    const groups = buildFieldOccupancyTaskGroups({
      labels,
      locations,
      fields,
      beds,
      crops: [],
      plantingPlans: [
        {
          id: 21,
          crop: 42,
          crop_name: 'Karotte',
          crop_display_name: 'Carrot',
          crop_variety: 'Nantaise 2',
          bed: 100,
          planting_date: '2026-03-01',
          harvest_date: '2026-04-15',
          harvest_end_date: '2026-04-30',
        },
      ],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].tasks[0].name).toBe('Carrot (Nantaise 2)');
    expect(groups[0].tasks[0].cropName).toBe('Carrot');
    expect(groups[0].tasks[1].name).toBe('Carrot (Nantaise 2) (Ernte)');
  });

  it('omits location level in occupancy hierarchy when only one used location exists', () => {
    const groups = buildFieldOccupancyTaskGroups({
      labels,
      locations,
      fields,
      beds,
      crops: [],
      plantingPlans: [
        {
          id: 23,
          crop: 13,
          crop_name: 'Kohl',
          bed: 100,
          planting_date: '2026-03-10',
          harvest_date: '2026-04-20',
          harvest_end_date: '2026-04-30',
        },
      ],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Nordfeld / Beet A');
    expect(groups[0].description).toBe('Nordfeld / Beet A');
    expect(groups[0].hierarchyPath).toEqual(['Nordfeld', 'Beet A']);
  });

  it('includes location level in occupancy hierarchy when multiple used locations exist', () => {
    const groups = buildFieldOccupancyTaskGroups({
      labels,
      locations: [
        { id: 1, name: 'Hof' },
        { id: 2, name: 'Pacht' },
      ],
      fields: [
        { id: 10, name: 'Nordfeld', location: 1 },
        { id: 20, name: 'Südfeld', location: 2 },
      ],
      beds: [
        { id: 100, name: 'Beet A', field: 10 },
        { id: 200, name: 'Beet B', field: 20 },
      ],
      crops: [],
      plantingPlans: [
        {
          id: 24,
          crop: 7,
          crop_name: 'Salat',
          bed: 100,
          planting_date: '2026-03-01',
          harvest_date: '2026-04-15',
          harvest_end_date: '2026-04-30',
        },
        {
          id: 25,
          crop: 8,
          crop_name: 'Tomate',
          bed: 200,
          planting_date: '2026-05-01',
          harvest_date: '2026-07-01',
          harvest_end_date: '2026-07-15',
        },
      ],
    });

    expect(groups).toHaveLength(2);
    expect(groups[0].hierarchyPath).toEqual(['Hof', 'Nordfeld', 'Beet A']);
    expect(groups[0].name).toBe('Hof / Nordfeld / Beet A');
    expect(groups[0].description).toBe('Hof / Nordfeld / Beet A');
    expect(groups[1].hierarchyPath).toEqual(['Pacht', 'Südfeld', 'Beet B']);
    expect(groups[1].name).toBe('Pacht / Südfeld / Beet B');
    expect(groups[1].description).toBe('Pacht / Südfeld / Beet B');
  });

  it('shows variety in occupancy harvest labels', () => {
    const groups = buildFieldOccupancyTaskGroups({
      labels,
      locations,
      fields,
      beds,
      crops: [],
      plantingPlans: [
        {
          id: 22,
          crop: 42,
          crop_name: 'Salat',
          crop_variety: 'Bijella',
          bed: 100,
          planting_date: '2026-03-01',
          harvest_date: '2026-04-15',
          harvest_end_date: '2026-04-30',
        },
      ],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].tasks).toHaveLength(2);
    expect(groups[0].tasks[1].name).toBe('Salat (Bijella) (Ernte)');
    expect(groups[0].tasks[1].notes).toBeUndefined();
  });

  it('keeps the original plan note in growth and harvest tooltips', () => {
    const groups = buildFieldOccupancyTaskGroups({
      labels,
      locations,
      fields,
      beds,
      crops: [],
      plantingPlans: [{
        id: 23,
        crop: 42,
        crop_name: 'Salat',
        bed: 100,
        planting_date: '2026-03-01',
        harvest_date: '2026-04-15',
        harvest_end_date: '2026-04-30',
        notes: 'Morgens ernten',
      }],
    });

    expect(groups[0].tasks.map((task) => task.notes)).toEqual([
      'Morgens ernten',
      'Morgens ernten',
    ]);
  });

  it('keeps the growth task but omits the harvest period without a computed harvest end date', () => {
    const groups = buildFieldOccupancyTaskGroups({
      labels,
      locations,
      fields,
      beds,
      crops: [],
      plantingPlans: [
        {
          id: 26,
          crop: 42,
          crop_name: 'Salat',
          bed: 100,
          planting_date: '2026-03-01',
          harvest_date: '2026-04-15',
          harvest_end_date: null,
        },
      ],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].tasks).toHaveLength(1);
    expect(groups[0].tasks[0]).toMatchObject({
      id: 'plan-26-growth',
      startDate: new Date('2026-03-01T00:00:00.000Z'),
      endDate: new Date('2026-04-15T00:00:00.000Z'),
      harvestStartDate: new Date('2026-04-15T00:00:00.000Z'),
      harvestEndDate: new Date('2026-04-15T00:00:00.000Z'),
    });
  });
});

describe('buildFieldOccupancyHierarchy', () => {
  const multiLocationLocations = [
    { id: 1, name: 'Hof' },
    { id: 2, name: 'Pacht' },
  ];
  const multiLocationFields = [
    { id: 10, name: 'Nordfeld', location: 1 },
    { id: 20, name: 'Südfeld', location: 2 },
  ];
  const multiLocationBeds = [
    { id: 100, name: 'Beet A', field: 10 },
    { id: 101, name: 'Beet A2', field: 10 },
    { id: 200, name: 'Beet B', field: 20 },
  ];

  it('always builds a location node and a field node, even for a single location', () => {
    const nodes = buildFieldOccupancyHierarchy({
      labels,
      locations,
      fields,
      beds,
      crops: [],
      plantingPlans: [],
    });

    const locationNode = nodes.find((n) => n.type === 'location');
    const fieldNode = nodes.find((n) => n.type === 'field');
    expect(locationNode?.name).toBe('Hof');
    expect(locationNode?.parentId).toBeNull();
    expect(fieldNode?.name).toBe('Nordfeld');
    expect(fieldNode?.parentId).toBe(locationNode?.id);
  });

  it('includes beds without any planting plan as empty leaf nodes', () => {
    const nodes = buildFieldOccupancyHierarchy({
      labels,
      locations,
      fields,
      beds,
      crops: [],
      plantingPlans: [],
    });

    const bedNode = nodes.find((n) => n.type === 'bed');
    expect(bedNode).toBeDefined();
    expect(bedNode?.tasks).toEqual([]);
    expect(bedNode?.occupiedBedCount).toBe(0);
  });

  it('sets parentId references forming a Standort -> Parzelle -> Beet chain', () => {
    const nodes = buildFieldOccupancyHierarchy({
      labels,
      locations: multiLocationLocations,
      fields: multiLocationFields,
      beds: multiLocationBeds,
      crops: [],
      plantingPlans: [],
    });

    const bedA = nodes.find((n) => n.type === 'bed' && n.name === 'Beet A');
    const fieldNord = nodes.find((n) => n.type === 'field' && n.name === 'Nordfeld');
    const locationHof = nodes.find((n) => n.type === 'location' && n.name === 'Hof');

    expect(bedA?.parentId).toBe(fieldNord?.id);
    expect(fieldNord?.parentId).toBe(locationHof?.id);
    expect(locationHof?.parentId).toBeNull();
  });

  it('aggregates bed/occupied-bed/plan counts up through field and location nodes', () => {
    const nodes = buildFieldOccupancyHierarchy({
      labels,
      locations: multiLocationLocations,
      fields: multiLocationFields,
      beds: multiLocationBeds,
      crops: [],
      plantingPlans: [
        {
          id: 1,
          crop: 1,
          crop_name: 'Salat',
          bed: 100,
          planting_date: '2026-03-01',
          harvest_date: '2026-04-15',
          harvest_end_date: '2026-04-30',
        },
        {
          id: 2,
          crop: 2,
          crop_name: 'Kohl',
          bed: 101,
          planting_date: '2026-03-05',
          harvest_date: '2026-04-20',
          harvest_end_date: '2026-04-30',
        },
      ],
    });

    const fieldNord = nodes.find((n) => n.type === 'field' && n.name === 'Nordfeld');
    const locationHof = nodes.find((n) => n.type === 'location' && n.name === 'Hof');
    const locationPacht = nodes.find((n) => n.type === 'location' && n.name === 'Pacht');

    expect(fieldNord?.bedCount).toBe(2);
    expect(fieldNord?.occupiedBedCount).toBe(2);
    expect(fieldNord?.planCount).toBe(2);
    expect(locationHof?.bedCount).toBe(2);
    expect(locationHof?.occupiedBedCount).toBe(2);
    expect(locationPacht?.bedCount).toBe(1);
    expect(locationPacht?.occupiedBedCount).toBe(0);
  });

  it('builds growth and harvest tasks for occupied beds the same way as buildFieldOccupancyTaskGroups', () => {
    const nodes = buildFieldOccupancyHierarchy({
      labels,
      locations,
      fields,
      beds,
      crops: [],
      plantingPlans: [
        {
          id: 21,
          crop: 42,
          crop_name: 'Salat',
          crop_variety: 'Bijella',
          bed: 100,
          planting_date: '2026-03-01',
          harvest_date: '2026-04-15',
          harvest_end_date: '2026-04-30',
        },
      ],
    });

    const bedNode = nodes.find((n) => n.type === 'bed');
    expect(bedNode?.tasks).toHaveLength(2);
    expect(bedNode?.tasks[0].name).toBe('Salat (Bijella)');
    expect(bedNode?.tasks[1].name).toBe('Salat (Bijella) (Ernte)');
  });

  it('prefers localized planting plan crop names in hierarchy task labels', () => {
    const nodes = buildFieldOccupancyHierarchy({
      labels,
      locations,
      fields,
      beds,
      crops: [],
      plantingPlans: [
        {
          id: 21,
          crop: 42,
          crop_name: 'Karotte',
          crop_display_name: 'Carrot',
          crop_variety: 'Nantaise 2',
          bed: 100,
          planting_date: '2026-03-01',
          harvest_date: '2026-04-15',
          harvest_end_date: '2026-04-30',
        },
      ],
    });

    const bedNode = nodes.find((n) => n.type === 'bed');
    expect(bedNode?.tasks[0].name).toBe('Carrot (Nantaise 2)');
    expect(bedNode?.tasks[1].name).toBe('Carrot (Nantaise 2) (Ernte)');
  });

  it('returns an empty list when there are no locations', () => {
    const nodes = buildFieldOccupancyHierarchy({
      labels,
      locations: [],
      fields,
      beds,
      crops: [],
      plantingPlans: [],
    });

    expect(nodes).toEqual([]);
  });

  it('renders growth and harvest phase colors without alpha blending', () => {
    const baseColor = '#93c5fd';
    const groups = buildFieldOccupancyTaskGroups({
      labels,
      locations,
      fields,
      beds,
      crops: [
        {
          id: 42,
          name: 'Kohlrabi',
          display_color: baseColor,
        },
      ],
      plantingPlans: [
        {
          id: 30,
          crop: 42,
          crop_name: 'Kohlrabi',
          bed: 100,
          planting_date: '2026-03-01',
          harvest_date: '2026-04-15',
          harvest_end_date: '2026-04-30',
        },
      ],
    });

    const [growthTask, harvestTask] = groups[0].tasks;
    expect(growthTask.color).not.toBe(baseColor);
    expect(growthTask.color).not.toBe(harvestTask.color);
    expect(harvestTask.color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('createGanttTaskLabels', () => {
  const plan = {
    id: 21,
    crop: 42,
    crop_name: 'Salat',
    bed: 100,
    planting_date: '2026-03-01',
    harvest_date: '2026-04-15',
    harvest_end_date: '2026-04-30',
  };

  it.each([
    ['de', 'Salat (Ernte)'],
    ['en', 'Salat (harvest)'],
    ['fr', 'Salat (récolte)'],
    ['es', 'Salat (cosecha)'],
  ])('names the harvest task in %s', (language, expectedName) => {
    const groups = buildFieldOccupancyTaskGroups({
      labels: createGanttTaskLabels(i18n.getFixedT(language)),
      locations,
      fields,
      beds,
      crops: [],
      plantingPlans: [plan],
    });

    expect(groups[0].tasks[1].name).toBe(expectedName);
  });

  it('falls back to a localized crop name when the plan carries none', () => {
    const groups = buildFieldOccupancyTaskGroups({
      labels: createGanttTaskLabels(i18n.getFixedT('fr')),
      locations,
      fields,
      beds,
      crops: [],
      plantingPlans: [{ ...plan, crop_name: undefined }],
    });

    expect(groups[0].tasks[0].name).toBe('Culture 42');
    expect(groups[0].tasks[1].name).toBe('Culture 42 (récolte)');
  });
});
