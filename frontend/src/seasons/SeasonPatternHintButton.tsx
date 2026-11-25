import { useId, useState } from 'react';
import { IconButton, Link, Popover, Typography } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useTranslation } from '../i18n';

/**
 * The small info button next to a suggested season's period: it explains
 * that the period follows the season pattern and links to where it is set.
 * A popover, not a tooltip, so the link works with keyboard and touch.
 */
export function SeasonPatternHintButton({ onEditSeasonPattern }: { onEditSeasonPattern: () => void }) {
  const { t } = useTranslation('navigation');
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const popoverId = useId();
  return (
    <>
      <IconButton size="small" aria-label={t('seasonSwitcher.suggestion.patternHint.button')}
        aria-haspopup="dialog" aria-expanded={Boolean(anchor)} aria-controls={anchor ? popoverId : undefined}
        onClick={event => setAnchor(event.currentTarget)} sx={{ color: 'text.secondary' }}>
        <InfoOutlinedIcon fontSize="small" />
      </IconButton>
      <Popover id={popoverId} open={Boolean(anchor)} anchorEl={anchor} onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { p: 1.5, maxWidth: 320 }, role: 'dialog',
          'aria-label': t('seasonSwitcher.suggestion.patternHint.button') } }}>
        <Typography variant="body2">
          {t('seasonSwitcher.suggestion.patternHint.prefix')}
          {' '}
          <Link component="button" type="button" onClick={onEditSeasonPattern}
            sx={{ fontSize: 'inherit', verticalAlign: 'baseline', fontWeight: 700 }}>
            {t('seasonSwitcher.suggestion.patternHint.link')}
          </Link>
          {' '}
          {t('seasonSwitcher.suggestion.patternHint.suffix')}
        </Typography>
      </Popover>
    </>
  );
}
