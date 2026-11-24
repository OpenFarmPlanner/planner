import { Alert, Box, Typography } from '@mui/material';
import { useTranslation } from '../../i18n';
import { getBulkPreviewFrame, type buildBulkBedPreview } from './utils/bulkBedPreview';
import type { MetricRect } from './utils/growingAreaGeometry';

type Preview = NonNullable<ReturnType<typeof buildBulkBedPreview>>;

export function BulkBedLayoutPreview({ preview, formatNumber }: {
  preview: Preview;
  formatNumber: (value: number) => string;
}) {
  const { t } = useTranslation('hierarchy');
  const { bounds, existing, beds, geometry, insideCount } = preview;
  const frame = getBulkPreviewFrame(bounds, [...existing, ...beds]);
  const offset = (rect: MetricRect) => ({
    position: 'absolute',
    left: `${(rect.x - frame.x) / frame.width * 100}%`, top: `${(rect.y - frame.y) / frame.height * 100}%`,
    width: `${rect.width / frame.width * 100}%`, height: `${rect.height / frame.height * 100}%`,
  } as const);
  const names = new Map([...existing, ...beds].map(bed => [bed.id, bed.name]));
  const overlap = geometry.issues.find(issue => issue.kind === 'overlap' && issue.ids[0] < 0);
  const shortGap = geometry.issues.find(issue => issue.kind === 'shortGap' && issue.ids[0] < 0);
  const noPathSpace = geometry.issues.some(issue => issue.kind === 'noPathSpace');
  const outsideCount = Math.max(0, beds.length - insideCount);
  const { footprintArea, remainingArea } = geometry.coverage;
  return (
    <Box sx={{ mt: 1.5 }}>
      <Box role="img" aria-label={t('dialogs.bulkCreateBeds.layoutGraphic', { count: beds.length })} sx={{
        position: 'relative', width: '100%', height: { xs: 155, sm: 195 }, bgcolor: 'action.hover',
      }}>
        <Box sx={{ ...offset(bounds), border: 1, borderColor: 'text.secondary', bgcolor: 'background.paper' }} />
        {existing.map(bed => (
          <Box key={bed.id} title={bed.name} sx={{ ...offset(bed.rect), bgcolor: 'action.disabled',
            border: '1px solid', borderColor: 'divider' }} />
        ))}
        {beds.map((bed, index) => (
          <Box key={bed.id} title={bed.name} sx={{ ...offset(bed.rect),
            bgcolor: index < insideCount ? 'primary.light' : 'error.light',
            border: '1px solid', borderColor: index < insideCount ? 'primary.dark' : 'error.dark' }} />
        ))}
      </Box>
      <Typography variant="caption" color="text.secondary">
        {t('dialogs.bulkCreateBeds.layoutLegend')}
      </Typography>
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
