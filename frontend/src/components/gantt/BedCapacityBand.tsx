import { useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItem, Stack, Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { Theme } from '@mui/material';
import type { TFunction } from 'i18next';
import { useTranslation } from '../../i18n';
import { bedCapacityDayToDate, type BedCapacityInterval, type BedCapacityStatus, type BedCapacityTimeline } from '../../pages/bedCapacityIntervals';
import { formatLocalizedNumber, resolveLocaleFromLanguage } from '../../utils/numberLocalization';
import { AppTooltip } from '../AppTooltip';

const BAND_HEIGHT = 24;
export const BED_CAPACITY_EXTRA_ROW_HEIGHT = 14;

function markerStyle(status: BedCapacityStatus) {
  return (theme: Theme) => {
    const neutral = alpha(theme.palette.text.primary, 0.55);
    const line = status === 'overallocated' ? theme.palette.warning.dark : neutral;
    const hatch = (angle: number) => `repeating-linear-gradient(${angle}deg, transparent 0 3px, ${line} 3px 4px)`;
    return {
      border: `1px ${status === 'unknown' ? 'dotted' : 'solid'} ${line}`,
      backgroundImage: status === 'overallocated' ? `${hatch(45)}, ${hatch(135)}`
        : status === 'free' ? hatch(135) : undefined,
      backgroundColor: status === 'partial' ? neutral : 'transparent',
    };
  };
}

function describeCapacity(interval: BedCapacityInterval, t: TFunction<'ganttChart'>, locale: string): string {
  const number = (value: number) => formatLocalizedNumber(value, locale, { maximumFractionDigits: 2 });
  const used = number(interval.knownUsedArea);
  const total = interval.totalArea === null ? null : number(interval.totalArea);
  if (interval.status === 'overallocated' && total !== null) {
    return t(interval.hasUnknownUsage ? 'capacity.minimumOverallocated' : 'capacity.overallocated', { used, total });
  }
  if (interval.freeArea !== null && total !== null) {
    return t('capacity.available', { free: number(interval.freeArea), total, used });
  }
  const usedLabel = t(interval.hasUnknownUsage ? 'capacity.minimumUsed' : 'capacity.used', { used });
  const totalLabel = total === null ? t('capacity.unknownBed') : t('capacity.total', { total });
  return t('capacity.incomplete', { used: usedLabel, total: totalLabel });
}

function formatRange(interval: BedCapacityInterval, formatter: Intl.DateTimeFormat): string {
  return formatter.formatRange(
    bedCapacityDayToDate(interval.startDay), bedCapacityDayToDate(interval.endDayExclusive - 1),
  );
}

function intervalAtTarget(target: EventTarget): number | null {
  const day = target instanceof HTMLElement ? target.dataset.capacityStart : undefined;
  return day === undefined ? null : Number(day);
}

export function BedCapacityBand({ timeline, positionDate, onOpenDetails }: {
  timeline: BedCapacityTimeline;
  positionDate: (date: Date) => number;
  onOpenDetails: (startDay: number | null) => void;
}) {
  const { t, i18n } = useTranslation('ganttChart');
  const locale = resolveLocaleFromLanguage(i18n.resolvedLanguage ?? i18n.language);
  const [hoverStart, setHoverStart] = useState<number | null>(null);
  const positions = useMemo(() => timeline.intervals.map(interval => ({
    interval,
    left: positionDate(bedCapacityDayToDate(interval.startDay)),
    right: positionDate(bedCapacityDayToDate(interval.endDayExclusive)),
  })), [positionDate, timeline.intervals]);
  const left = positions[0]?.left ?? 0;
  const width = (positions.at(-1)?.right ?? 0) - left;
  const hovered = hoverStart === null ? undefined : timeline.intervals.find(interval => interval.startDay === hoverStart);
  const openDetails = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setHoverStart(null);
    onOpenDetails(intervalAtTarget(event.target));
  };

  if (width <= 0) return null;
  return (
    <AppTooltip
      title={hovered ? <>{formatRange(hovered, new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }))}<br />{describeCapacity(hovered, t, locale)}</> : ''}
      open={Boolean(hovered)}
      describeChild
      followCursor
      disableInteractive
      disableFocusListener
      disableTouchListener
    >
      <Box
        component="button"
        type="button"
        aria-label={t('capacity.details', { bed: timeline.name })}
        aria-haspopup="dialog"
        style={{ left, width }}
        onPointerMove={event => {
          if (event.pointerType !== 'touch') setHoverStart(intervalAtTarget(event.target));
        }}
        onPointerLeave={() => setHoverStart(null)}
        onClick={openDetails}
        onContextMenu={event => event.stopPropagation()}
        sx={{
          position: 'absolute', bottom: '1px', height: `${BAND_HEIGHT}px`, p: 0, border: 0,
          bgcolor: 'transparent', cursor: 'pointer',
          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: '-2px' },
        }}
      >
        {positions.map(({ interval, left: start, right }) => (
          <Box
            key={interval.startDay}
            component="span"
            aria-hidden
            data-capacity-start={interval.startDay}
            data-capacity-status={interval.status}
            style={{ left: start - left, width: Math.max(0, right - start) }}
            sx={{ position: 'absolute', top: 0, height: '100%', display: 'flex', alignItems: 'center' }}
          >
            <Box component="span" sx={[
              { width: '100%', height: '7px', pointerEvents: 'none' },
              markerStyle(interval.status),
            ]} />
          </Box>
        ))}
      </Box>
    </AppTooltip>
  );
}

const LEGEND_STATUSES = ['free', 'partial', 'occupied', 'unknown', 'overallocated'] as const;

export function BedCapacityLegend() {
  const { t } = useTranslation('ganttChart');
  return (
    <Stack component="ul" direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1, mt: 0.5, mb: 0, p: 0, listStyle: 'none' }}>
      {LEGEND_STATUSES.map(status => (
        <Stack component="li" key={status} direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <Box component="span" aria-hidden sx={[{ width: '18px', height: '7px' }, markerStyle(status)]} />
          <Typography variant="caption">{t(`capacity.status.${status}`)}</Typography>
        </Stack>
      ))}
    </Stack>
  );
}

export function BedCapacityDetails({ timeline, selectedDay, onClose }: {
  timeline: BedCapacityTimeline;
  selectedDay: number | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation(['ganttChart', 'common']);
  const locale = resolveLocaleFromLanguage(i18n.resolvedLanguage ?? i18n.language);
  const dates = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }), [locale]);
  const selectedRef = useRef<HTMLLIElement>(null);
  return (
    <Dialog
      open onClose={onClose} fullWidth maxWidth="sm"
      slotProps={{ transition: { onEntered: () => selectedRef.current?.scrollIntoView({ block: 'nearest' }) } }}
    >
      <DialogTitle>{t('capacity.details', { bed: timeline.name })}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary">{t('capacity.estimate')}</Typography>
        <List disablePadding>
          {timeline.intervals.map(interval => (
            <ListItem
              key={interval.startDay} disableGutters divider
              ref={interval.startDay === selectedDay ? selectedRef : undefined}
              sx={{ display: 'block', bgcolor: interval.startDay === selectedDay ? 'action.selected' : undefined }}
            >
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{formatRange(interval, dates)}</Typography>
              <Typography variant="body2">{describeCapacity(interval, t, locale)}</Typography>
            </ListItem>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:actions.close')}</Button>
      </DialogActions>
    </Dialog>
  );
}
