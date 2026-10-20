import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { estimateCultivationTypeColumnWidth, usePlantingPlanHierarchy } from '../pages/usePlantingPlanHierarchy';
import plantingPlansDE from '../i18n/locales/de/plantingPlans.json';
import plantingPlansEN from '../i18n/locales/en/plantingPlans.json';
import plantingPlansFR from '../i18n/locales/fr/plantingPlans.json';
import plantingPlansES from '../i18n/locales/es/plantingPlans.json';

const apiMocks = vi.hoisted(() => ({
  cropListAll: vi.fn(),
  locationListAll: vi.fn(),
  fieldListAll: vi.fn(),
  bedListAll: vi.fn(),
}));

vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return {
    ...actual,
    cropAPI: {
      ...actual.cropAPI,
      listAll: apiMocks.cropListAll,
    },
    locationAPI: {
      ...actual.locationAPI,
      listAll: apiMocks.locationListAll,
    },
    fieldAPI: {
      ...actual.fieldAPI,
      listAll: apiMocks.fieldListAll,
    },
    bedAPI: {
      ...actual.bedAPI,
      listAll: apiMocks.bedListAll,
    },
  };
});

describe('usePlantingPlanHierarchy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.cropListAll.mockResolvedValue({
      results: [
        {
          id: 1,
          name: 'Ackerbohne',
          crop_display_name: 'Broad bean',
          variety: 'Hangdown',
        },
      ],
    });
    apiMocks.locationListAll.mockResolvedValue({ results: [] });
    apiMocks.fieldListAll.mockResolvedValue({ results: [] });
    apiMocks.bedListAll.mockResolvedValue({ results: [] });
  });

  it('uses localized crop labels for planting-plan crop options', async () => {
    const { result } = renderHook(() => usePlantingPlanHierarchy(false));

    await waitFor(() => expect(result.current.isHierarchyLoading).toBe(false));

    expect(result.current.cropOptions).toEqual([
      { value: 1, label: 'Broad bean (Hangdown)' },
    ]);
  });
});

describe('estimateCultivationTypeColumnWidth', () => {
  // The column's width per language before bought-in plants became a third
  // option (header and the two former labels, eight pixels per character).
  const previousColumnWidth = (labels: string[]): number => {
    const longest = Math.max(...labels.map((label) => label.length));
    return Math.max(110, Math.min(150, longest * 8 + 52));
  };
  const previousLabels: Record<string, string[]> = {
    de: ['Anbauart', 'Direktsaat', 'Pflanzung'],
    en: ['Cultivation type', 'Direct sowing', 'Transplanting'],
    fr: ['Mode de culture', 'Semis direct', 'Plantation'],
    es: ['Tipo de cultivo', 'Siembra directa', 'Trasplante'],
  };
  const locales = { de: plantingPlansDE, en: plantingPlansEN, fr: plantingPlansFR, es: plantingPlansES };

  it.each(Object.entries(locales))('does not widen the column in %s', (language, bundle) => {
    const width = estimateCultivationTypeColumnWidth(
      bundle.columns.cultivationType,
      Object.values(bundle.cultivationTypes),
    );

    expect(width).toBeLessThanOrEqual(previousColumnWidth(previousLabels[language]));
  });

  it('sizes the column by the short labels, never the long ones', () => {
    const width = estimateCultivationTypeColumnWidth('Anbauart', ['Direktsaat', 'Pflanzung', 'Pfl. Zukauf']);

    expect(width).toBe(previousColumnWidth(['Direktsaat']));
  });
});
