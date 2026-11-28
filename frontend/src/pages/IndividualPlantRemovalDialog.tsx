import { useState } from 'react';
import { Alert, Box, Button, FormControlLabel, Radio, RadioGroup, Stack, Typography } from '@mui/material';
import { Link } from 'react-router';
import { ConfirmationDialog } from '../components/feedback/ConfirmationDialog';
import { useTranslation } from '../i18n';
import { plantingPlanDetailPath } from '../planting-plans/plantingPlanDetailRoutes';
import { formatLocalizedNumber, resolveLocaleFromLanguage } from '../utils/numberLocalization';
import { groupPlantsByPlan, type GraphicalIndividualPlant } from './graphicalIndividualPlants';
import { individualCountAfterRemoval, individualRemovalBlock, type IndividualRemovalMode } from './individualPlantGeometry';

/** Confirms removing the selected plants: the plants themselves or only their positions (#1727). */
export function IndividualPlantRemovalDialog({ plants, onCancel, onConfirm }: {
  plants: readonly GraphicalIndividualPlant[];
  onCancel: () => void;
  onConfirm: (mode: IndividualRemovalMode) => void;
}) {
  const { t, i18n } = useTranslation(['fields', 'common']);
  const locale = resolveLocaleFromLanguage(i18n.resolvedLanguage ?? i18n.language);
  const number = (value: number) => formatLocalizedNumber(value, locale, { maximumFractionDigits: 0 });
  const groups = groupPlantsByPlan(plants);
  const blocked = groups.map(group => ({ group, block: individualRemovalBlock(group.plan, group.plants.length, 'plant') }))
    .filter(({ block }) => block);
  const plantBlock = blocked[0]?.block ?? null;
  const [mode, setMode] = useState<IndividualRemovalMode>(plantBlock ? 'position' : 'plant');
  const totals = groups.map(({ plan, plants: selected }) => {
    const total = plan.individual_count ?? plan.individual_positions?.length ?? selected.length;
    return { total, after: individualCountAfterRemoval(plan, selected.length, 'plant') ?? total - selected.length };
  });
  const single = plants.length === 1 ? plants[0] : null;
  const count = { count: plants.length, formatted: number(plants.length) };
  const title = single ? t('fields:individualPlants.removal.title') : t('fields:individualPlants.removal.titleMany', count);
  const blockedPlan = plantBlock === 'actualRecords' && blocked.length === 1 ? blocked[0].group.plan.id : undefined;
  return (
    <ConfirmationDialog open title={title}
      message={<Stack spacing={1.5}>
        {single ? (
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{`${single.name} · ${t('fields:individualPlants.positionInPlan', {
            index: number(single.index), total: number(single.count) })}`}</Typography>
        ) : (
          <Box component="ul" aria-label={t('fields:individualPlants.removal.affectedPlans')}
            sx={{ m: 0, pl: 2.5, maxHeight: 180, overflowY: 'auto' }}>
            {groups.map((group, index) => (
              <Typography component="li" variant="body2" key={group.plan.id} sx={{ overflowWrap: 'anywhere' }}>
                {t('fields:individualPlants.removal.groupLine', {
                  name: group.name, count: group.plants.length, formatted: number(group.plants.length),
                  from: number(totals[index].total), to: number(totals[index].after),
                })}
              </Typography>
            ))}
          </Box>
        )}
        <RadioGroup value={mode} onChange={event => setMode(event.target.value as IndividualRemovalMode)} aria-label={title}>
          <FormControlLabel value="plant" disabled={Boolean(plantBlock)} control={<Radio />} label={<Stack>
            <Typography variant="body2">{t(single ? 'fields:individualPlants.removal.plant' : 'fields:individualPlants.removal.plants')}</Typography>
            <Typography variant="caption" color="text.secondary">{single
              ? t('fields:individualPlants.removal.plantHint', { from: number(totals[0].total), to: number(totals[0].after) })
              : t('fields:individualPlants.removal.plantsHint')}</Typography>
          </Stack>} />
          <FormControlLabel value="position" control={<Radio />} label={<Stack>
            <Typography variant="body2">{t(single ? 'fields:individualPlants.removal.position' : 'fields:individualPlants.removal.positions')}</Typography>
            <Typography variant="caption" color="text.secondary">{t(single
              ? 'fields:individualPlants.removal.positionHint' : 'fields:individualPlants.removal.positionsHint')}</Typography>
          </Stack>} />
        </RadioGroup>
        {plantBlock && <Alert severity="info" action={blockedPlan ? (
          <Button component={Link} to={plantingPlanDetailPath(blockedPlan)} size="small">
            {t('fields:individualPlants.details')}</Button>
        ) : undefined}>
          {t(`fields:individualPlants.removal.${plantBlock}`)}
          {!single && ` ${t('fields:individualPlants.removal.blockedPlans', {
            names: blocked.map(({ group }) => group.name).join(', ') })}`}
        </Alert>}
      </Stack>}
      cancelLabel={t('common:actions.cancel')}
      confirmLabel={mode === 'plant'
        ? t(single ? 'fields:individualPlants.removal.plant' : 'fields:individualPlants.removal.plants')
        : t(single ? 'fields:individualPlants.removal.position' : 'fields:individualPlants.removal.positions')}
      confirmButtonProps={{ color: 'error' }}
      onCancel={onCancel} onConfirm={() => onConfirm(mode)} />
  );
}
