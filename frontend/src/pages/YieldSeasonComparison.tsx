import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Stack, Typography } from '@mui/material';
import { yieldCalendarAPI } from '../api/api';
import type { YieldComparison, YieldComparisonFilterOptions, YieldComparisonFilters } from '../api/types';
import LoadRetryButton from '../components/LoadRetryButton';
import { useTranslation } from '../i18n';
import { resolveSeasonDateLocale } from '../seasons/formatSeasonDate';
import { YieldComparisonFilterBar } from './YieldComparisonFilterBar';
import { YieldComparisonResults } from './YieldComparisonResults';
import { groupYieldComparisonCrops } from './yieldComparisonFilters';
import type { YieldChartUnit } from './yieldSeasonChartData';

type LoadResult<T> = { key: string; data: T } | { key: string; error: true };

interface YieldSeasonComparisonProps {
  filters: YieldComparisonFilters;
  onFiltersChange: (filters: YieldComparisonFilters) => void;
}

export function YieldSeasonComparison({ filters, onFiltersChange }: YieldSeasonComparisonProps) {
  const { t, i18n } = useTranslation('yieldOverview');
  const locale = resolveSeasonDateLocale(i18n);
  const [retry, setRetry] = useState(0);
  const [catalog, setCatalog] = useState<LoadResult<YieldComparisonFilterOptions>>();
  const [comparison, setComparison] = useState<LoadResult<YieldComparison>>();
  const [preferredUnit, setPreferredUnit] = useState<YieldChartUnit>('kg');
  const catalogKey = `${locale}:${retry}`;
  const options = catalog?.key === catalogKey && 'data' in catalog ? catalog.data : undefined;
  const groups = useMemo(() => groupYieldComparisonCrops(options?.crops ?? [], locale), [options, locale]);
  const selected = useMemo(() => groups.filter(group => filters.cropKeys.includes(group.key)), [filters.cropKeys, groups]);
  const cropIds = useMemo(() => selected.flatMap(group => group.cropIds), [selected]);
  const comparisonKey = options && options.crops.length > 0 ? JSON.stringify([catalogKey, filters, cropIds]) : null;
  const varietyName = options?.crops.find(crop => crop.id === filters.varietyId)?.name;
  const cropName = varietyName ?? (selected.length === 1 ? selected[0].name
    : t(selected.length ? 'filters.selectedCrops' : 'filters.allCrops'));
  const loadCropComparison = useCallback((ids: number[], signal: AbortSignal) => (
    yieldCalendarAPI.comparison(filters, ids, signal).then(({ data }) => data)
  ), [filters]);

  useEffect(() => {
    const controller = new AbortController();
    void yieldCalendarAPI.comparisonFilterOptions(controller.signal).then(({ data }) => {
      if (!controller.signal.aborted) {
        setCatalog({ key: catalogKey, data });
      }
    }).catch(() => {
      if (!controller.signal.aborted) setCatalog({ key: catalogKey, error: true });
    });
    return () => controller.abort();
  }, [catalogKey]);

  useEffect(() => {
    if (comparisonKey === null) return;
    const controller = new AbortController();
    void yieldCalendarAPI.comparison(filters, cropIds, controller.signal).then(({ data }) => {
      if (!controller.signal.aborted) setComparison({ key: comparisonKey, data });
    }).catch(() => {
      if (!controller.signal.aborted) setComparison({ key: comparisonKey, error: true });
    });
    return () => controller.abort();
  }, [comparisonKey, cropIds, filters]);

  const retryButton = <LoadRetryButton onClick={() => setRetry(value => value + 1)} />;
  if (catalog?.key !== catalogKey) return <Typography role="status">{t('loading')}</Typography>;
  if ('error' in catalog) return <Alert severity="error" action={retryButton}>{t('errors.load')}</Alert>;
  if (catalog.data.crops.length === 0) return <Typography>{t('comparison.noCrops')}</Typography>;
  const current = comparison?.key === comparisonKey ? comparison : undefined;
  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      <YieldComparisonFilterBar options={catalog.data} groups={groups} selected={selected}
        filters={filters} onChange={onFiltersChange} />
      {!current && <Typography role="status">{t('loading')}</Typography>}
      {current && ('error' in current
        ? <Alert severity="error" action={retryButton}>{t('errors.load')}</Alert>
        : <YieldComparisonResults key={comparisonKey} comparison={current.data} cropName={cropName}
          groups={groups} loadCropComparison={loadCropComparison}
          preferredUnit={preferredUnit} onChartUnitChange={setPreferredUnit} />)}
    </Stack>
  );
}
