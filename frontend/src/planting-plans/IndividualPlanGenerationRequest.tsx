import { useEffect, useId, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import { layoutAPI, plantingPlanAPI } from '../api/api';
import type { Bed, Crop, Field, Location, StemCoordinates } from '../api/types';
import LoadRetryButton from '../components/LoadRetryButton';
import { useTranslation } from '../i18n';
import {
  collectOccupiedPlantPositions, individualCropSpacings, individualPlacementPeriod,
} from '../pages/individualPlantGeneration';
import type { RectSize } from '../pages/graphicalLayoutUtils';
import { getGraphicalBedLayout, getSchematicLocationLayout } from '../pages/graphicalAreaGeometry';
import { createGraphicPlacementContext, createParentLocalPlacement, type PlantGenerationGeometry } from '../pages/graphicalPlantPlacement';
import { WORKSPACE_MIN_HEIGHT, WORKSPACE_MIN_WIDTH } from '../pages/graphicalFieldsGeometry';
import type { PlacementParent } from '../pages/individualPlantGeometry';
import { IndividualPlantGenerationDialog } from './IndividualPlantGenerationDialog';

export interface GenerationInput {
  parent: PlacementParent;
  location: Location & { id: number };
  fields: Field[];
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
  const [result, setResult] = useState<{ occupied: StemCoordinates[]; geometry: PlantGenerationGeometry; attempt: number }
    | { error: 'geometryUnknown' | 'loadFailed'; attempt: number } | null>(null);
  useEffect(() => {
    const request = new AbortController();
    const { signal } = request;
    const { location, fields, beds, parent, crop, date } = input;
    void Promise.all([
      layoutAPI.listByLocation(location.id, signal), plantingPlanAPI.listIndividualAtLocation(location.id, signal),
    ]).then(([{ data }, { results: plans }]) => {
      if (signal.aborted) return;
      const layouts = Object.fromEntries(data.bed_layouts.map(bed => [bed.bed, bed]));
      const fieldLayouts = Object.fromEntries(data.field_layouts.map(field => [field.field, field]));
      const layout = getSchematicLocationLayout(location, fields, fieldLayouts, data.location_boundary ?? null,
        0, WORKSPACE_MIN_WIDTH, WORKSPACE_MIN_HEIGHT);
      const fieldsById = new Map(fields.map(field => [field.id, field]));
      const parcels = layout.fieldViewModels.flatMap(rect => {
        const field = fieldsById.get(rect.id);
        return field ? [{ field, rect, layout: getGraphicalBedLayout(field, beds.filter(bed => bed.field === rect.id), layouts, 0) }] : [];
      });
      const context = createGraphicPlacementContext(location, layout.boundary, data.location_boundary ?? layout.unsavedBoundaryOrigin, 0, parcels)
        ?? createParentLocalPlacement(parent, parcels, 0);
      const geometry = context?.generationGeometry(parent);
      if (!geometry) { setResult({ error: 'geometryUnknown', attempt }); return; }
      const occupied = collectOccupiedPlantPositions({ parent, plans, period: individualPlacementPeriod(date, crop),
        projectBetweenParents: context?.projectBetweenParents });
      setResult({ occupied, geometry, attempt });
    }).catch(() => {
      if (!signal.aborted) setResult({ error: 'loadFailed', attempt });
    });
    return () => request.abort();
  }, [attempt, input]);

  const current = result?.attempt === attempt ? result : null;
  if (current && 'geometry' in current) {
    return <IndividualPlantGenerationDialog dimensions={input.dimensions}
      suggestedSpacing={individualCropSpacings(input.crop)} occupied={current.occupied} existingCount={0} geometry={current.geometry}
      initialCount={input.count} confirmLabel={t('common:actions.save')}
      onConfirm={onComplete} onClose={() => onComplete(null)} />;
  }
  return <Dialog open onClose={() => onComplete(null)} fullWidth maxWidth="sm" aria-labelledby={dialogTitle}>
    <DialogTitle id={dialogTitle}>{t('fields:individualPlants.generation.title')}</DialogTitle>
    <DialogContent dividers>
      {current && 'error' in current ? <Alert severity="error" action={current.error === 'loadFailed'
        ? <LoadRetryButton onClick={() => setAttempt(previous => previous + 1)} /> : undefined}>
        {t(`fields:individualPlants.${current.error}`)}
      </Alert> : <Typography role="status">{t('common:messages.loading')}</Typography>}
    </DialogContent>
    <DialogActions><Button onClick={() => onComplete(null)}>{t('common:actions.cancel')}</Button></DialogActions>
  </Dialog>;
}
