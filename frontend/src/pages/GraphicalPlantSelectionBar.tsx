import { Button, Paper, Stack, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import { useTranslation } from '../i18n';
import { formatLocalizedNumber, getActiveFormattingLocale } from '../utils/numberLocalization';

/** Compact on-canvas controls for a multi-selection of individual plants (#1727). */
export function GraphicalPlantSelectionBar({ count, onRemove, onClear }: {
  count: number;
  /** Absent for read-only access. */
  onRemove?: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation('fields');
  const formatted = formatLocalizedNumber(count, getActiveFormattingLocale(), { maximumFractionDigits: 0 });
  const label = t('individualPlants.selection.label');
  return (
    <Paper component="section" aria-label={label} data-graphical-annotation-obstacle data-testid="individual-plant-selection"
      elevation={3} onKeyDown={event => {
        if (event.key !== 'Delete' || event.repeat || !count || !onRemove) return;
        event.preventDefault();
        onRemove();
      }}
      sx={{ position: 'absolute', zIndex: 2, top: 48, left: 12, maxWidth: 'calc(100% - 88px)', px: 1.5, py: 0.5 }}>
      <Stack direction="row" useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', columnGap: 1 }}>
        <Typography role="status" variant="body2" sx={{ fontWeight: 600 }}>
          {count ? t('individualPlants.selection.count', { count, formatted }) : t('individualPlants.selection.hint')}
        </Typography>
        {onRemove && (
          <Button size="small" color="error" startIcon={<DeleteOutlineIcon fontSize="small" />} disabled={!count}
            aria-keyshortcuts="Delete" onClick={onRemove} sx={{ minHeight: 44 }}>
            {t('individualPlants.selection.remove')}
          </Button>
        )}
        <Button size="small" startIcon={<CloseIcon fontSize="small" />} aria-keyshortcuts="Escape" onClick={onClear}
          sx={{ minHeight: 44 }}>
          {t('individualPlants.selection.clear')}
        </Button>
      </Stack>
    </Paper>
  );
}
