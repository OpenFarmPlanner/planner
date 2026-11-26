import { useEffect, useId, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import { layoutAPI, plantingPlanAPI } from '../api/api';
import type { Bed, Crop, Field, StemCoordinates } from '../api/types';
import LoadRetryButton from '../components/LoadRetryButton';
import { useTranslation } from '../i18n';
import {
  collectOccupiedPlantPositions, getIndividualPlantFrames, individualCropSpacings, individualPlacementPeriod,
} from '../pages/individualPlantGeneration';
import type { RectSize } from '../pages/graphicalLayoutUtils';
import type { PlacementParent } from '../pages/individualPlantGeometry';
import { IndividualPlantGenerationDialog } from './IndividualPlantGenerationDialog';

export interface GenerationInput {
  parent: PlacementParent;
  field: Field;
  beds: Bed[];
  crop: Crop;
  date: string;
  dimensions: RectSize;
  count: number | 'max' | null;
}

export type GenerationResult = StemCoordinates[] | null;

export function IndividualPlanGenerationRequest({ input, onComplete }: { input: GenerationInput; onComplete: (result: GenerationResult) => void }) {
  const { t } = useTranslation(['fields', 'common']);
  const dialogTitle = useId();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ occupied: StemCoordinates[] | null; attempt: number } | null>(null);
  useEffect(() => {
    const request = new AbortController();
    const { signal } = request;
    const { field, beds, parent, crop, date } = input;
    void Promise.all([
      layoutAPI.listByLocation(field.location, signal), plantingPlanAPI.listIndividualAtLocation(field.location, signal),
    ]).then(([{ data }, { results: plans }]) => {
      if (signal.aborted) return;
      const layouts = Object.fromEntries(data.bed_layouts.map(bed => [bed.bed, bed]));
      const frames = getIndividualPlantFrames([field], beds, layouts).get(field.id!);
      const occupied = collectOccupiedPlantPositions({ frames, parent, plans, period: individualPlacementPeriod(date, crop) });
      setResult({ occupied, attempt });
    }).catch(() => {
      if (!signal.aborted) setResult({ occupied: null, attempt });
    });
    return () => request.abort();
  }, [attempt, input]);

  const occupied = result?.attempt === attempt ? result.occupied : undefined;
  if (occupied) {
    return <IndividualPlantGenerationDialog dimensions={input.dimensions}
      suggestedSpacing={individualCropSpacings(input.crop)} occupied={occupied} existingCount={0}
      initialCount={input.count} confirmLabel={t('common:actions.save')}
      onConfirm={onComplete} onClose={() => onComplete(null)} />;
  }
  return <Dialog open onClose={() => onComplete(null)} fullWidth maxWidth="sm" aria-labelledby={dialogTitle}>
    <DialogTitle id={dialogTitle}>{t('fields:individualPlants.generation.title')}</DialogTitle>
    <DialogContent dividers>
      {occupied === null ? <Alert severity="error" action={<LoadRetryButton onClick={() => setAttempt(previous => previous + 1)} />}>
        {t('fields:individualPlants.loadFailed')}
      </Alert> : <Typography role="status">{t('common:messages.loading')}</Typography>}
    </DialogContent>
    <DialogActions><Button onClick={() => onComplete(null)}>{t('common:actions.cancel')}</Button></DialogActions>
  </Dialog>;
}
