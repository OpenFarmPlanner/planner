import EventBusyOutlinedIcon from '@mui/icons-material/EventBusyOutlined';
import { Alert, Box, type SxProps, type Theme } from '@mui/material';
import type { ReactNode } from 'react';

import type { TimingWindowFinding, TimingWindowKind } from '../../api/types';
import { useTranslation } from '../../i18n';
import { AppTooltip } from '../AppTooltip';
import { FullCellTooltip } from '../data-grid/FullCellTooltip';
import { type GerminationFindings, useGerminationFindingLines } from './useGerminationFindingLines';
import { useTimingWindowLines } from './useTimingWindowLines';

const linesTitle = (lines: string[]): ReactNode => lines.map((line, index) => (
  <Box component="span" key={index} sx={{ display: 'block' }}>{line}</Box>
));

/** Timing-window hints plus the sowing-related germination hints, as one list. */
function useDateHintLines(
  findings: readonly TimingWindowFinding[] | null | undefined,
  germinationFindings: GerminationFindings | null | undefined,
  kinds?: readonly TimingWindowKind[],
): string[] {
  const timing = useTimingWindowLines(findings, kinds);
  const germination = useGerminationFindingLines(germinationFindings);
  return germination.length ? [...timing, ...germination] : timing;
}

interface TimingWindowIconProps {
  findings: readonly TimingWindowFinding[] | null | undefined;
  /** Germination hints shown with the timing-window hints (mobile cards). */
  germinationFindings?: GerminationFindings | null;
  fontSize?: 'inherit' | 'small';
  sx?: SxProps<Theme>;
}

/** The mobile cards' small icon; the tooltip lists the hints. Renders nothing without any. */
export function TimingWindowIcon({ findings, germinationFindings, fontSize = 'small', sx }: TimingWindowIconProps) {
  const { t } = useTranslation('plantingPlans');
  const lines = useDateHintLines(findings, germinationFindings);
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
  /** Germination hints that belong to this date (the sowing date). */
  germinationFindings?: GerminationFindings | null;
  cellHasFocus: boolean;
  children: ReactNode;
  tooltipContent?: ReactNode;
}

/**
 * A table date outside the crop's windows, or a sowing date with germination
 * hints: the same dotted info underline and full-cell tooltip as a harvest
 * overlap. Needs FULL_CELL_TOOLTIP_CELL_CLASS.
 */
export function TimingWindowDateCell({ findings, kinds, germinationFindings, cellHasFocus, children, tooltipContent }: TimingWindowDateCellProps) {
  const lines = useDateHintLines(findings, germinationFindings, kinds);
  if (lines.length === 0 && !tooltipContent) {
    return <>{children}</>;
  }
  return (
    <FullCellTooltip cellHasFocus={cellHasFocus} describeChild={Boolean(tooltipContent)} touchPreview={Boolean(tooltipContent)} title={<>{tooltipContent}{linesTitle(lines)}</>}>
      {lines.length > 0 ? <Box component="span" sx={dateUnderlineSx} data-testid="timing-window-date">{children}</Box> : children}
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
