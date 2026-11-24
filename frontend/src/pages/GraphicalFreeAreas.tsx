import { useId, useState } from 'react';
import { Box, Button, IconButton, Popover, Stack, Typography } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { alpha, useTheme, type Theme } from '@mui/material/styles';
import type { TFunction } from 'i18next';
import { Group, Rect } from 'react-konva';
import { AppTooltip } from '../components/AppTooltip';
import type { MetricCoverage } from '../components/hierarchy/utils/growingAreaGeometry';
import { formatLocalizedNumber, getActiveFormattingLocale } from '../utils/numberLocalization';
import type { Point } from './graphicalFieldsGeometry';

type AreaKind = 'site' | 'parcel';

const areaColor = (theme: Theme, kind: AreaKind) => kind === 'site'
  ? alpha(theme.palette.info.main, 0.12)
  : alpha(theme.palette.success.main, 0.16);

export function GraphicalFreeRectangles({ coverage, origin, scale, kind }: {
  coverage?: MetricCoverage;
  origin: Point;
  scale: Point;
  kind: AreaKind;
}) {
  const color = areaColor(useTheme(), kind);
  if (!coverage?.freeRects?.length) return null;
  return (
    <Group listening={false}>
      {coverage.freeRects.map((rect, index) => (
        <Rect
          key={index}
          x={origin.x + rect.x * scale.x}
          y={origin.y + rect.y * scale.y}
          width={rect.width * scale.x}
          height={rect.height * scale.y}
          fill={color}
          data-testid={`graphical-free-area-${kind}`}
        />
      ))}
    </Group>
  );
}

export function GraphicalFreeAreaInfo({ coverage, missingParcelDimensions, missingBedDimensions, t }: {
  coverage: MetricCoverage;
  missingParcelDimensions: boolean;
  missingBedDimensions: boolean;
  t: TFunction<['fields', 'common']>;
}) {
  const theme = useTheme();
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const incompleteLocation = coverage.footprintArea === null || coverage.remainingArea === null;
  const incomplete = incompleteLocation || missingParcelDimensions || missingBedDimensions;
  const summaryTitle = t('fields:graphical.freeArea.title');
  const label = incomplete ? t('fields:graphical.freeArea.incomplete') : summaryTitle;
  const area = (value: number) => `${formatLocalizedNumber(value, getActiveFormattingLocale(), {
    maximumFractionDigits: 2,
  })} ${t('common:units.squareMeters')}`;

  return (
    <>
      <AppTooltip title={label} disableInteractive placement="left">
        <IconButton
          size="small"
          color={incomplete ? 'warning' : 'default'}
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={Boolean(anchor)}
          aria-controls={anchor ? id : undefined}
          onClick={event => setAnchor(event.currentTarget)}
          sx={{ borderRadius: 0, p: 1.25 }}
        >
          <InfoOutlinedIcon fontSize="small" />
        </IconButton>
      </AppTooltip>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        container={() => document.fullscreenElement instanceof HTMLElement ? document.fullscreenElement : document.body}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: {
          id, role: 'dialog', 'aria-modal': true, 'aria-labelledby': `${id}-title`,
          sx: { width: 340, maxWidth: 'calc(100% - 32px)', maxHeight: '65vh' },
        } }}
      >
        <Stack spacing={1.25} sx={{ p: 2 }}>
          <Typography id={`${id}-title`} component="h2" variant="subtitle1" sx={{ fontWeight: 600 }}>{summaryTitle}</Typography>
          {(['site', 'parcel'] as const).map(kind => (
            <Stack key={kind} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Box aria-hidden sx={{ bgcolor: areaColor(theme, kind), width: 16, height: 12, borderRadius: 0.5, flexShrink: 0 }} />
              <Typography variant="body2">{t(`fields:graphical.freeArea.${kind}`)}</Typography>
            </Stack>
          ))}
          <Typography variant="body2" color="text.secondary">{t('fields:graphical.geometry.remainingHelp')}</Typography>
          {coverage.grossArea !== null ? (
            <Typography>{t('fields:graphical.freeArea.gross', { area: area(coverage.grossArea) })}</Typography>
          ) : null}
          {coverage.footprintArea !== null && coverage.remainingArea !== null ? (
            <>
              <Typography>{t('fields:graphical.freeArea.covered', { area: area(coverage.footprintArea) })}</Typography>
              <Typography>{t('fields:graphical.freeArea.remaining', { area: area(coverage.remainingArea) })}</Typography>
            </>
          ) : <Typography variant="body2">{t('fields:graphical.freeArea.unknownLocation')}</Typography>}
          {missingParcelDimensions ? <Typography variant="body2">{t('fields:graphical.freeArea.unknownParcel')}</Typography> : null}
          {missingBedDimensions ? <Typography variant="body2">{t('fields:graphical.freeArea.unknownBed')}</Typography> : null}
          <Button onClick={() => setAnchor(null)} sx={{ alignSelf: 'flex-end' }}>{t('common:actions.close')}</Button>
        </Stack>
      </Popover>
    </>
  );
}
