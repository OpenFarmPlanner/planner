import { useEffect, useId, useState } from 'react';
import { Alert, Dialog, DialogContent, DialogTitle, IconButton, Typography, useMediaQuery, useTheme } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import type { YieldComparison } from '../api/types';
import LoadRetryButton from '../components/LoadRetryButton';
import { useTranslation } from '../i18n';
import { YieldSeasonDetails } from './YieldSeasonDetails';

export type LoadCropComparison = (cropIds: number[], signal: AbortSignal) => Promise<YieldComparison>;

export function YieldCropDrilldown({ crop, load, onClose }: {
  crop: { label: string; crop_ids: number[] };
  load: LoadCropComparison;
  onClose: () => void;
}) {
  const { t } = useTranslation(['yieldOverview', 'common']);
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const titleId = useId();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ data: YieldComparison } | { error: true }>();

  useEffect(() => {
    const controller = new AbortController();
    void load(crop.crop_ids, controller.signal).then(data => {
      if (!controller.signal.aborted) setResult({ data });
    }).catch(() => {
      if (!controller.signal.aborted) setResult({ error: true });
    });
    return () => controller.abort();
  }, [attempt, crop.crop_ids, load]);

  const retry = () => {
    setResult(undefined);
    setAttempt(value => value + 1);
  };

  return <Dialog open maxWidth="md" fullWidth fullScreen={fullScreen} onClose={onClose} aria-labelledby={titleId}>
    <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
      <span id={titleId}>{crop.label}</span>
      <IconButton aria-label={t('common:actions.close')} onClick={onClose}><CloseIcon /></IconButton>
    </DialogTitle>
    <DialogContent>
      {!result && <Typography role="status">{t('loading')}</Typography>}
      {result && ('error' in result ? <Alert severity="error" action={<LoadRetryButton onClick={retry} />}>
        {t('errors.load')}
      </Alert> : <YieldSeasonDetails comparison={result.data} cropName={crop.label} showTitle={false} />)}
    </DialogContent>
  </Dialog>;
}
