import { useEffect, useState } from 'react';
import { Alert, Stack, Typography } from '@mui/material';
import { yieldCalendarAPI } from '../api/api';
import type { YieldComparison } from '../api/types';
import LoadRetryButton from '../components/LoadRetryButton';
import { useTranslation } from '../i18n';
import { resolveSeasonDateLocale } from '../seasons/formatSeasonDate';
import { YieldFilterBar } from './YieldFilterBar';
import { YieldComparisonResults } from './YieldComparisonResults';
import { ALL_CROPS } from './yieldOverviewUtils';

type LoadResult<T> = { key: string; data: T } | { key: string; error: true };

interface YieldSeasonComparisonProps {
  cropId: string;
  onCropChange: (cropId: string) => void;
}

export function YieldSeasonComparison({ cropId, onCropChange }: YieldSeasonComparisonProps) {
  const { t, i18n } = useTranslation('yieldOverview');
  const locale = resolveSeasonDateLocale(i18n);
  const [retry, setRetry] = useState(0);
  const [catalog, setCatalog] = useState<LoadResult<{ id: number; name: string }[]>>();
  const [comparison, setComparison] = useState<LoadResult<YieldComparison>>();
  const catalogKey = `${locale}:${retry}`;
  const crop = catalog?.key === catalogKey && 'data' in catalog
    ? catalog.data.find(entry => String(entry.id) === cropId)
    : undefined;
  const comparisonKey = crop ? `${crop.id}:${retry}` : null;
  const activeCropId = crop?.id;

  useEffect(() => {
    const controller = new AbortController();
    void yieldCalendarAPI.comparisonCrops(controller.signal).then(({ data }) => {
      if (!controller.signal.aborted) {
        const crops = [...data.crops].sort((left, right) => left.name.localeCompare(right.name, locale));
        setCatalog({ key: catalogKey, data: crops });
      }
    }).catch(() => {
      if (!controller.signal.aborted) setCatalog({ key: catalogKey, error: true });
    });
    return () => controller.abort();
  }, [catalogKey, locale]);

  useEffect(() => {
    if (activeCropId === undefined || comparisonKey === null) return;
    const controller = new AbortController();
    void yieldCalendarAPI.comparison(activeCropId, controller.signal).then(({ data }) => {
      if (!controller.signal.aborted) setComparison({ key: comparisonKey, data });
    }).catch(() => {
      if (!controller.signal.aborted) setComparison({ key: comparisonKey, error: true });
    });
    return () => controller.abort();
  }, [activeCropId, comparisonKey]);

  const retryButton = <LoadRetryButton onClick={() => setRetry(value => value + 1)} />;
  if (catalog?.key !== catalogKey) return <Typography role="status">{t('loading')}</Typography>;
  if ('error' in catalog) return <Alert severity="error" action={retryButton}>{t('errors.load')}</Alert>;
  if (catalog.data.length === 0) return <Typography>{t('comparison.noCrops')}</Typography>;

  const current = comparison?.key === comparisonKey ? comparison : undefined;
  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      <YieldFilterBar crops={catalog.data} selectedCropId={crop ? cropId : ALL_CROPS}
        allCropsLabel={t('comparison.chooseCrop')} onCropChange={onCropChange} />
      {crop && !current && <Typography role="status">{t('loading')}</Typography>}
      {crop && current && ('error' in current
        ? <Alert severity="error" action={retryButton}>{t('errors.load')}</Alert>
        : <YieldComparisonResults key={crop.id} comparison={current.data} cropName={crop.name} />)}
    </Stack>
  );
}
