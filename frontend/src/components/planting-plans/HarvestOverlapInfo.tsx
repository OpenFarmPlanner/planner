import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { Alert, Box, type SxProps, type Theme } from '@mui/material';

import type { HarvestOverlap } from '../../api/types';
import { useTranslation } from '../../i18n';
import { AppTooltip } from '../AppTooltip';
import { useHarvestOverlapLines } from './useHarvestOverlapLines';

interface HarvestOverlapIconProps {
  overlaps: readonly HarvestOverlap[] | null | undefined;
  fontSize?: 'inherit' | 'small';
  sx?: SxProps<Theme>;
}

/** The table's small info icon; the tooltip lists the overlaps. Renders nothing without any. */
export function HarvestOverlapIcon({ overlaps, fontSize = 'small', sx }: HarvestOverlapIconProps) {
  const { t } = useTranslation('plantingPlans');
  const lines = useHarvestOverlapLines(overlaps);
  if (lines.length === 0) {
    return null;
  }
  return (
    <AppTooltip
      title={lines.map((line, index) => (
        <Box component="span" key={index} sx={{ display: 'block' }}>{line}</Box>
      ))}
    >
      <InfoOutlinedIcon
        color="info"
        fontSize={fontSize}
        role="img"
        aria-label={t('plantingPlans:harvestOverlap.iconAria')}
        aria-hidden={false}
        data-testid="harvest-overlap-icon"
        sx={sx}
      />
    </AppTooltip>
  );
}

/** The planting-plan dialog's info Alert below the date fields. Renders nothing without overlaps. */
export function HarvestOverlapAlert({ overlaps }: { overlaps: readonly HarvestOverlap[] | null | undefined }) {
  const lines = useHarvestOverlapLines(overlaps);
  if (lines.length === 0) {
    return null;
  }
  return (
    <Alert severity="info" sx={{ boxShadow: 'none' }} data-testid="harvest-overlap-alert">
      {lines.map((line, index) => (
        <Box component="span" key={index} sx={{ display: 'block' }}>{line}</Box>
      ))}
    </Alert>
  );
}
