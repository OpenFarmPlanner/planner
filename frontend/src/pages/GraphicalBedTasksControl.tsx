import { useId, useState } from 'react';
import {
  Alert, Box, Button, FormControlLabel, MenuItem, Popover, Stack, Switch,
  TextField, Typography, useTheme,
} from '@mui/material';
import LoadRetryButton from '../components/LoadRetryButton';
import { BED_TASK_URGENCIES, bedTaskUrgencyLabel, type BedTaskSummary } from '../components/tasks/bedTaskUrgency';
import { useTranslation } from '../i18n';
import { bedTaskColors, BED_TASK_SYMBOLS } from './graphicalBedTaskStyle';
import { getGraphicalPortalContainer } from './useGraphicalStageSize';

interface Props {
  anchor: HTMLButtonElement | null;
  onClose: () => void;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  beds: readonly { id: number; name: string; parcel: string }[];
  summaries: ReadonlyMap<number, BedTaskSummary>;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  onOpenBed?: (id: number) => void;
}

export function GraphicalBedTasksControl({ anchor, onClose, enabled, onToggle, beds, summaries, loading, failed, onRetry, onOpenBed }: Props) {
  const { t } = useTranslation(['fields', 'dashboard', 'common', 'hierarchy']);
  const theme = useTheme();
  const id = useId();
  const [bedId, setBedId] = useState<number | ''>('');
  const bed = beds.find(item => item.id === bedId);
  const selected = bed ? summaries.get(bed.id) : undefined;
  const name = bed ? `${bed.name} · ${bed.parcel}` : '';
  const title = t('graphical.taskLayer.title');
  const container = getGraphicalPortalContainer();

  return (
    <Popover open={Boolean(anchor)} anchorEl={anchor} onClose={onClose}
      container={container}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{ paper: {
        id, role: 'dialog', 'aria-modal': true, 'aria-labelledby': `${id}-title`,
        sx: { width: 340, maxWidth: 'calc(100% - 32px)', maxHeight: '75vh' },
      } }}>
      <Stack spacing={1.25} sx={{ p: 2, overflowWrap: 'anywhere' }}>
        <Typography id={`${id}-title`} component="h2" variant="subtitle1" sx={{ fontWeight: 600 }}>{title}</Typography>
        <FormControlLabel sx={{ m: 0, minHeight: 44 }}
          control={<Switch checked={enabled} onChange={(_, checked) => onToggle(checked)} />}
          label={t('graphical.taskLayer.show')} />
        {enabled && (
          <>
            <Stack component="ul" spacing={0.5} sx={{ p: 0, m: 0, listStyle: 'none' }}>
              {BED_TASK_URGENCIES.map(urgency => {
                const colors = bedTaskColors(theme, urgency);
                return (
                  <Stack component="li" key={urgency} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Box aria-hidden sx={{ width: 21, flexShrink: 0, bgcolor: colors.fill,
                      color: colors.glyph, textAlign: 'center', borderRadius: 0.5, fontWeight: 700 }}>
                      {BED_TASK_SYMBOLS[urgency]}
                    </Box>
                    <Typography variant="body2">{bedTaskUrgencyLabel(urgency, t)}</Typography>
                  </Stack>
                );
              })}
            </Stack>
            <Typography variant="caption" color="text.secondary">{t('graphical.taskLayer.noFill')}</Typography>
            {loading && <Typography role="status" variant="body2">{t('common:messages.loading')}</Typography>}
            {failed && <Alert severity="error" action={<LoadRetryButton onClick={onRetry} />}>
              {t('graphical.taskLayer.loadError')}
            </Alert>}
          </>
        )}
        {onOpenBed && beds.length > 0 && (
          <>
            <TextField select fullWidth size="small" label={t('graphical.taskLayer.chooseBed')} value={bed?.id ?? ''}
              slotProps={{ select: { MenuProps: { container } } }}
              onChange={event => setBedId(Number(event.target.value))}>
              {beds.map(item => <MenuItem key={item.id} value={item.id} sx={{ minHeight: 44, whiteSpace: 'normal' }}>
                {item.name} · {item.parcel}
              </MenuItem>)}
            </TextField>
            {bed && enabled && !loading && !failed && (
              <Stack aria-live="polite" spacing={0.25}>
                <Typography variant="body2">
                  {name} · {selected?.urgency ? bedTaskUrgencyLabel(selected.urgency, t) : t('graphical.taskLayer.none')}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('graphical.taskLayer.outstanding', { count: selected?.outstanding ?? 0 })}
                  {selected?.undated ? ` · ${t('graphical.taskLayer.undatedCount', { count: selected.undated })}` : ''}
                </Typography>
              </Stack>
            )}
            <Button sx={{ minHeight: 44 }} disabled={!bed} onClick={() => { if (bed) onOpenBed(bed.id); }}>
              {t('hierarchy:details.open.bed')}
            </Button>
          </>
        )}
      </Stack>
    </Popover>
  );
}
