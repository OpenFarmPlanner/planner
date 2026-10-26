import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { Alert, Box, type SxProps, type Theme } from '@mui/material';
import type { ReactNode } from 'react';

import type { HarvestOverlap } from '../../api/types';
import { useTranslation } from '../../i18n';
import { AppTooltip } from '../AppTooltip';
import { FullCellTooltip } from '../data-grid/FullCellTooltip';
import { getPredecessorOverlaps, useHarvestOverlapLines } from './useHarvestOverlapLines';

interface HarvestOverlapIconProps {
  overlaps: readonly HarvestOverlap[] | null | undefined;
  fontSize?: 'inherit' | 'small';
  sx?: SxProps<Theme>;
}

/** The mobile cards' small info icon; the tooltip lists the overlaps. Renders nothing without any. */
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

const overlapUnderlineSx = {
  textDecorationLine: 'underline',
  textDecorationStyle: 'dotted',
  textDecorationColor: (theme: Theme) => theme.palette.info.main,
  textDecorationThickness: 2,
  textUnderlineOffset: 3,
} as const;

interface HarvestOverlapDateCellProps {
  overlaps: readonly HarvestOverlap[] | null | undefined;
  cellHasFocus: boolean;
  children: ReactNode;
}

/**
 * The table's "Ernteende" cell of a previous crop whose harvest has to end
 * early: the date gets a dotted info-coloured underline and the whole cell
 * the overlap lines as tooltip. The cell needs FULL_CELL_TOOLTIP_CELL_CLASS.
 * Follow-up crops stay unmarked in the table to keep it calm.
 */
export function HarvestOverlapDateCell({ overlaps, cellHasFocus, children }: HarvestOverlapDateCellProps) {
  const lines = useHarvestOverlapLines(getPredecessorOverlaps(overlaps));
  if (lines.length === 0) {
    return <>{children}</>;
  }
  return (
    <FullCellTooltip
      cellHasFocus={cellHasFocus}
      title={lines.map((line, index) => (
        <Box component="span" key={index} sx={{ display: 'block' }}>{line}</Box>
      ))}
    >
      <Box component="span" sx={overlapUnderlineSx} data-testid="harvest-overlap-date">{children}</Box>
    </FullCellTooltip>
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
