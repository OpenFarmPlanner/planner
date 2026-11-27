import { useState } from 'react';
import { Alert, Button, FormControlLabel, Radio, RadioGroup, Stack, Typography } from '@mui/material';
import { Link } from 'react-router';
import { ConfirmationDialog } from '../components/feedback/ConfirmationDialog';
import { useTranslation } from '../i18n';
import { plantingPlanDetailPath } from '../planting-plans/plantingPlanDetailRoutes';
import { formatLocalizedNumber, resolveLocaleFromLanguage } from '../utils/numberLocalization';
import type { GraphicalIndividualPlant } from './graphicalIndividualPlants';
import { individualCountAfterRemoval, individualRemovalBlock, type IndividualRemovalMode } from './individualPlantGeometry';

/** Confirms removing one selected plant: the plant itself or only its position (#1727). */
export function IndividualPlantRemovalDialog({ plant, onCancel, onConfirm }: {
  plant: GraphicalIndividualPlant;
  onCancel: () => void;
  onConfirm: (mode: IndividualRemovalMode) => void;
}) {
  const { t, i18n } = useTranslation(['fields', 'common']);
  const locale = resolveLocaleFromLanguage(i18n.resolvedLanguage ?? i18n.language);
  const number = (value: number) => formatLocalizedNumber(value, locale, { maximumFractionDigits: 0 });
  const plantBlock = individualRemovalBlock(plant.plan, 1, 'plant');
  const [mode, setMode] = useState<IndividualRemovalMode>(plantBlock ? 'position' : 'plant');
  const total = plant.plan.individual_count ?? plant.plan.individual_positions?.length ?? plant.count;
  const after = individualCountAfterRemoval(plant.plan, 1, 'plant') ?? total - 1;
  return (
    <ConfirmationDialog open title={t('fields:individualPlants.removal.title')}
      message={<Stack spacing={1.5}>
        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{`${plant.name} · ${t('fields:individualPlants.positionInPlan', {
          index: number(plant.index), total: number(plant.count) })}`}</Typography>
        <RadioGroup value={mode} onChange={event => setMode(event.target.value as IndividualRemovalMode)}
          aria-label={t('fields:individualPlants.removal.title')}>
          <FormControlLabel value="plant" disabled={Boolean(plantBlock)} control={<Radio />} label={<Stack>
            <Typography variant="body2">{t('fields:individualPlants.removal.plant')}</Typography>
            <Typography variant="caption" color="text.secondary">{t('fields:individualPlants.removal.plantHint', {
              from: number(total), to: number(after) })}</Typography>
          </Stack>} />
          <FormControlLabel value="position" control={<Radio />} label={<Stack>
            <Typography variant="body2">{t('fields:individualPlants.removal.position')}</Typography>
            <Typography variant="caption" color="text.secondary">{t('fields:individualPlants.removal.positionHint')}</Typography>
          </Stack>} />
        </RadioGroup>
        {plantBlock && <Alert severity="info" action={plantBlock === 'actualRecords' && plant.plan.id ? (
          <Button component={Link} to={plantingPlanDetailPath(plant.plan.id)} size="small">
            {t('fields:individualPlants.details')}</Button>
        ) : undefined}>{t(`fields:individualPlants.removal.${plantBlock}`)}</Alert>}
      </Stack>}
      cancelLabel={t('common:actions.cancel')}
      confirmLabel={t(mode === 'plant' ? 'fields:individualPlants.removal.plant' : 'fields:individualPlants.removal.position')}
      confirmButtonProps={{ color: 'error' }}
      onCancel={onCancel} onConfirm={() => onConfirm(mode)} />
  );
}
