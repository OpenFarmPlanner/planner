import SpaOutlinedIcon from '@mui/icons-material/SpaOutlined';
import { Alert, Box, Typography } from '@mui/material';
import type { PlantingPlan } from '../../api/types';
import { useTranslation } from '../../i18n';
import { AppTooltip } from '../AppTooltip';

type Props = Pick<PlantingPlan, 'germination_findings' | 'expected_emergence'> & { icon?: boolean };

/** The same non-blocking hints and emergence dates in the dialog, table and cards. */
export function GerminationInfo({ germination_findings, expected_emergence, icon = false }: Props) {
  const { t, i18n } = useTranslation('plantingPlans');
  const lines = (germination_findings ?? []).map((finding) => t(`germination.${finding.code}`));
  if (expected_emergence) {
    const format = (iso: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(`${iso}T12:00:00`));
    lines.push(t('germination.emergence', { from: format(expected_emergence.min), to: format(expected_emergence.max) }));
  }
  if (!lines.length) return null;
  if (icon) return <AppTooltip title={lines.map((line) => <Box key={line}>{line}</Box>)}><SpaOutlinedIcon fontSize="small" color="info" role="img" aria-label={t('germination.hints')} aria-hidden={false} /></AppTooltip>;
  return <Box sx={{ display: 'grid', gap: 1 }}>{lines.map((line, index) => index < (germination_findings?.length ?? 0)
    ? <Alert severity="info" key={line}>{line}</Alert>
    : <Typography key={line} variant="body2">{line}</Typography>)}</Box>;
}
