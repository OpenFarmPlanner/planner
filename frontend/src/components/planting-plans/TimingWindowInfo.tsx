import EventBusyOutlinedIcon from '@mui/icons-material/EventBusyOutlined';
import { Alert, Box, type SxProps, type Theme } from '@mui/material';
import type { ReactNode } from 'react';

import type { TimingWindowFinding, TimingWindowKind } from '../../api/types';
import { useTranslation } from '../../i18n';
import { AppTooltip } from '../AppTooltip';
import { FullCellTooltip } from '../data-grid/FullCellTooltip';
import { useTimingWindowLines } from './useTimingWindowLines';

const linesTitle = (lines: string[]): ReactNode => lines.map((line, index) => (
  <Box component="span" key={index} sx={{ display: 'block' }}>{line}</Box>
));

interface TimingWindowIconProps {
  findings: readonly TimingWindowFinding[] | null | undefined;
  fontSize?: 'inherit' | 'small';
  sx?: SxProps<Theme>;
}

/** The mobile cards' small icon; the tooltip lists the hints. Renders nothing without any. */
export function TimingWindowIcon({ findings, fontSize = 'small', sx }: TimingWindowIconProps) {
  const { t } = useTranslation('plantingPlans');
  const lines = useTimingWindowLines(findings);
  if (lines.length === 0) {
    return null;
  }
  return (
    <AppTooltip title={linesTitle(lines)}>
      <EventBusyOutlinedIcon
        color="info"
        fontSize={fontSize}
        role="img"
        aria-label={t('plantingPlans:timingWindow.iconAria')}
        aria-hidden={false}
        data-testid="timing-window-icon"
        sx={sx}
      />
    </AppTooltip>
  );
}

const dateUnderlineSx = {
  textDecorationLine: 'underline',
  textDecorationStyle: 'dotted',
  textDecorationColor: (theme: Theme) => theme.palette.info.main,
  textDecorationThickness: 2,
  textUnderlineOffset: 3,
} as const;

interface TimingWindowDateCellProps {
  findings: readonly TimingWindowFinding[] | null | undefined;
  /** The window kinds this date column shows hints for. */
  kinds: readonly TimingWindowKind[];
  cellHasFocus: boolean;
  children: ReactNode;
}

/**
 * A table date outside the crop's windows: the same dotted info underline and
 * full-cell tooltip as a harvest overlap. Needs FULL_CELL_TOOLTIP_CELL_CLASS.
 */
export function TimingWindowDateCell({ findings, kinds, cellHasFocus, children }: TimingWindowDateCellProps) {
  const lines = useTimingWindowLines(findings, kinds);
  if (lines.length === 0) {
    return <>{children}</>;
  }
  return (
    <FullCellTooltip cellHasFocus={cellHasFocus} title={linesTitle(lines)}>
      <Box component="span" sx={dateUnderlineSx} data-testid="timing-window-date">{children}</Box>
    </FullCellTooltip>
  );
}

/** The planting-plan dialog's info Alert below the date fields. Renders nothing without hints. */
export function TimingWindowAlert({ findings }: { findings: readonly TimingWindowFinding[] | null | undefined }) {
  const lines = useTimingWindowLines(findings);
  if (lines.length === 0) {
    return null;
  }
  return (
    <Alert severity="info" sx={{ boxShadow: 'none' }} data-testid="timing-window-alert">
      {linesTitle(lines)}
    </Alert>
  );
}
