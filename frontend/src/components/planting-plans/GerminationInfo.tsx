import { Alert, Box, Typography } from '@mui/material';

import type { PlantingPlan } from '../../api/types';
import { useTranslation } from '../../i18n';
import { useGerminationFindingLines } from './useGerminationFindingLines';

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T12:00:00Z`) - Date.parse(`${fromIso}T12:00:00Z`)) / DAY_MS);
}

type Props = Pick<PlantingPlan, 'germination_findings' | 'expected_emergence'> & {
  /** The sowing date the emergence window is counted from (ISO), when known. */
  sowingDate?: string | null;
};

/** The plan dialog's and expanded card's germination hints and expected emergence. */
export function GerminationInfo({ germination_findings, expected_emergence, sowingDate }: Props) {
  const { t, i18n } = useTranslation('plantingPlans');
  const findings = useGerminationFindingLines(germination_findings);
  let emergence: string | null = null;
  if (expected_emergence) {
    const format = (iso: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' })
      .format(new Date(`${iso}T12:00:00`));
    const window = { from: format(expected_emergence.min), to: format(expected_emergence.max) };
    if (sowingDate) {
      const minimum = daysBetween(sowingDate, expected_emergence.min);
      const maximum = daysBetween(sowingDate, expected_emergence.max);
      emergence = t('plantingPlans:germination.emergenceWithBasis', {
        ...window,
        sowing: format(sowingDate),
        days: minimum === maximum ? String(maximum) : `${minimum}–${maximum}`,
        count: maximum,
      });
    } else {
      emergence = t('plantingPlans:germination.emergence', window);
    }
  }
  if (!findings.length && !emergence) return null;
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      {findings.map((line) => <Alert severity="info" key={line}>{line}</Alert>)}
      {emergence && <Typography variant="body2">{emergence}</Typography>}
    </Box>
  );
}
