import { Alert, Box, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useId } from 'react';
import { useTranslation } from '../../i18n';
import { rotateRect, type GraphicalRotation } from '../../pages/graphicalLayoutUtils';
import type { buildBulkBedPreview } from './utils/bulkBedPreview';
import type { MetricRect } from './utils/growingAreaGeometry';

type Preview = NonNullable<ReturnType<typeof buildBulkBedPreview>>;

export function BulkBedLayoutPreview({ preview, rotation, formatNumber }: {
  preview: Preview;
  rotation: GraphicalRotation;
  formatNumber: (value: number) => string;
}) {
  const { t } = useTranslation('hierarchy');
  const { palette } = useTheme();
  const legendId = useId();
  const { bounds, existing, beds, geometry, insideCount } = preview;
  const project = (rect: MetricRect) => rotateRect(rect, bounds, rotation);
  const frame = project(preview.frame);
  const styles = {
    existing: { fill: palette.action.disabled, stroke: palette.divider },
    new: { fill: palette.info.light, stroke: palette.info.dark },
    outside: { fill: palette.error.light, stroke: palette.error.dark, strokeDasharray: '3 2' },
  };
  const names = new Map([...existing, ...beds].map(bed => [bed.id, bed.name]));
  const overlap = geometry.issues.find(issue => issue.kind === 'overlap' && issue.ids[0] < 0);
  const shortGap = geometry.issues.find(issue => issue.kind === 'shortGap' && issue.ids[0] < 0);
  const noPathSpace = geometry.issues.some(issue => issue.kind === 'noPathSpace');
  const outsideCount = Math.max(0, beds.length - insideCount);
  const { footprintArea, remainingArea } = geometry.coverage;
  return (
    <Box sx={{ mt: 1.5 }}>
      <Box sx={{ width: '100%', height: { xs: 155, sm: 195 }, p: 0.75, bgcolor: 'action.hover' }}>
        <Box component="svg" role="img"
          aria-label={t('dialogs.bulkCreateBeds.layoutGraphic', { count: beds.length })}
          aria-describedby={legendId}
          viewBox={`${frame.x} ${frame.y} ${frame.width} ${frame.height}`}
          preserveAspectRatio="xMidYMid meet"
          sx={{ display: 'block', width: '100%', height: '100%', overflow: 'visible' }}>
          <rect {...project(bounds)} vectorEffect="non-scaling-stroke" data-testid="bulk-bed-parcel"
            fill={palette.background.paper} stroke={palette.text.secondary} />
          {existing.map(bed => (
            <rect key={bed.id} {...project(bed.rect)} {...styles.existing} vectorEffect="non-scaling-stroke">
              <title>{bed.name}</title>
            </rect>
          ))}
          {beds.map((bed, index) => (
            <rect key={bed.id} {...project(bed.rect)} {...(index < insideCount ? styles.new : styles.outside)}
              vectorEffect="non-scaling-stroke">
              <title>{bed.name}</title>
            </rect>
          ))}
        </Box>
      </Box>
      <Box component="ul" id={legendId} role="list" sx={{
        m: 0, mt: 0.5, p: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', rowGap: 0.25, columnGap: 1.5,
      }}>
        {(Object.keys(styles) as Array<keyof typeof styles>).map(kind => (
          <Typography key={kind} component="li" variant="caption" color="text.secondary"
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
            <Box component="span" aria-hidden sx={{ width: 12, height: 8, flexShrink: 0,
              bgcolor: styles[kind].fill, border: `1px ${kind === 'outside' ? 'dashed' : 'solid'}`,
              borderColor: styles[kind].stroke }} />
            {t(`dialogs.bulkCreateBeds.legend.${kind}`)}
          </Typography>
        ))}
      </Box>
      <Typography variant="body2" sx={{ mt: 1 }}>
        {footprintArea !== null && remainingArea !== null
          ? t('dialogs.bulkCreateBeds.occupiedAndRemaining', {
            occupied: formatNumber(footprintArea), remaining: formatNumber(remainingArea),
          })
          : t('dialogs.bulkCreateBeds.unknownBedArea')}
      </Typography>
      {outsideCount > 0 ? (
        <Alert severity="warning" sx={{ mt: 1 }}>
          {t('dialogs.bulkCreateBeds.outsideParcel', { count: outsideCount })}
        </Alert>
      ) : null}
      {overlap?.kind === 'overlap' ? (
        <Alert severity="warning" sx={{ mt: 1 }}>
          {t('dialogs.bulkCreateBeds.overlappingBeds', {
            first: names.get(overlap.ids[0]), second: names.get(overlap.ids[1]),
          })}
        </Alert>
      ) : null}
      {shortGap?.kind === 'shortGap' ? (
        <Alert severity="info" sx={{ mt: 1 }}>
          {t('dialogs.bulkCreateBeds.shortBedGap', {
            first: names.get(shortGap.ids[0]), second: names.get(shortGap.ids[1]),
            gap: formatNumber(shortGap.gapM), recommended: formatNumber(shortGap.recommendedM),
          })}
        </Alert>
      ) : noPathSpace ? (
        <Alert severity="info" sx={{ mt: 1 }}>{t('dialogs.bulkCreateBeds.noPathSpace')}</Alert>
      ) : null}
    </Box>
  );
}
