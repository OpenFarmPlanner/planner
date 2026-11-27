import { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Typography } from '@mui/material';
import { layoutAPI, type Bed, type Field, type LocationLayoutsResponse } from '../api/api';
import type { ResolvedGrowingAreaEntity } from '../components/hierarchy/details/growingAreaEntity';
import { DetailRow } from '../components/layout/DetailPrimitives';
import { freeAreaColor } from '../components/hierarchy/utils/freeAreaColors';
import LoadRetryButton from '../components/LoadRetryButton';
import { useTranslation } from '../i18n';
import { formatLocalizedNumber } from '../utils/numberLocalization';
import { getSavedLocationCoverage, getSavedParcelCoverage } from './graphicalAreaGeometry';
import { waitForLocationLayoutSaves } from './graphicalLayoutRequests';

type CoverageRequest =
  | { status: 'loading' | 'error' }
  | { status: 'ready'; locationId: number; layouts: LocationLayoutsResponse };

export function GrowingAreaCoverageRows({ resolved, locale, refreshHierarchy }: {
  resolved: ResolvedGrowingAreaEntity;
  locale: string;
  refreshHierarchy: () => Promise<void>;
}) {
  const { t } = useTranslation(['hierarchy', 'common']);
  const locationId = resolved.location?.id;
  const [request, setRequest] = useState<CoverageRequest>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!locationId) return;
    let controller = new AbortController();
    const load = async (refresh: boolean): Promise<void> => {
      const { signal } = controller;
      try {
        await waitForLocationLayoutSaves(locationId);
        if (signal.aborted) return;
        const [{ data }] = await Promise.all([
          layoutAPI.listByLocation(locationId, signal),
          refresh ? refreshHierarchy() : undefined,
        ]);
        if (!signal.aborted) setRequest({ status: 'ready', locationId, layouts: data });
      } catch {
        if (!signal.aborted) setRequest({ status: 'error' });
      }
    };
    const reload = () => {
      controller.abort();
      controller = new AbortController();
      setRequest({ status: 'loading' });
      void load(true);
    };
    void load(attempt > 0);
    window.addEventListener('focus', reload);
    return () => {
      controller.abort();
      window.removeEventListener('focus', reload);
    };
  }, [locationId, attempt, refreshHierarchy]);

  // Layouts loaded for another location must never be applied to this entity.
  const isStale = request.status === 'ready' && request.locationId !== locationId;
  const coverage = useMemo(() => {
    if (request.status !== 'ready' || isStale) return null;
    if (resolved.type === 'location' && resolved.location) {
      return getSavedLocationCoverage(resolved.location, resolved.children as Field[], request.layouts);
    }
    return resolved.field ? getSavedParcelCoverage(resolved.field, resolved.children as Bed[], request.layouts) : null;
  }, [request, isStale, resolved]);
  const area = (value: number) => `${formatLocalizedNumber(value, locale, { maximumFractionDigits: 2 })} ${t('common:units.squareMeters')}`;
  const isLocation = resolved.type === 'location';

  if (locationId && (request.status === 'loading' || isStale)) {
    return <Typography variant="body2" color="text.secondary" role="status">{t('details.coverage.loading')}</Typography>;
  }
  if (locationId && request.status === 'error') {
    return (
      <Alert severity="error" sx={{ gridColumn: '1 / -1' }} action={<LoadRetryButton onClick={() => {
        setRequest({ status: 'loading' });
        setAttempt(value => value + 1);
      }} />}>
        {t('details.coverage.loadError')}
      </Alert>
    );
  }
  if (!coverage?.grossArea || coverage.footprintArea === null || coverage.remainingArea === null) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ gridColumn: '1 / -1' }}>
        {t(isLocation ? 'details.coverage.locationUnknown' : 'details.coverage.parcelUnknown')}
      </Typography>
    );
  }
  const fraction = coverage.footprintArea / coverage.grossArea;
  const percent = (value: number) => formatLocalizedNumber(value, locale, { style: 'percent', maximumFractionDigits: 1 });
  const coveredLabel = t(isLocation ? 'details.coverage.parcelFootprint' : 'details.coverage.bedFootprint');
  const remainingLabel = t(isLocation ? 'details.coverage.outsideParcels' : 'details.coverage.withoutBeds');
  const covered = `${area(coverage.footprintArea)} (${percent(fraction)})`;
  const remaining = `${area(coverage.remainingArea)} (${percent(coverage.remainingArea / coverage.grossArea)})`;
  return (
    <>
      <Box role="img" aria-label={`${coveredLabel} · ${covered}. ${remainingLabel} · ${remaining}.`}
        sx={{ gridColumn: '1 / -1', height: 10, border: 1, borderColor: 'divider', borderRadius: 1,
          overflow: 'hidden', bgcolor: theme => freeAreaColor(theme, isLocation ? 'site' : 'parcel') }}>
        <Box sx={{ bgcolor: 'primary.main', width: `${fraction * 100}%`, height: '100%' }} />
      </Box>
      <DetailRow
        label={coveredLabel}
        value={covered}
        testId="detail-covered-area"
      />
      <DetailRow
        label={remainingLabel}
        value={remaining}
        caption={isLocation ? undefined : t('details.coverage.parcelRemainingHelp')}
        testId="detail-remaining-area"
      />
    </>
  );
}
