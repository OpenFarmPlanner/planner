import { useState } from 'react';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import { ButtonBase } from '@mui/material';
import { useTranslation } from '../../i18n';
import { AppTooltip } from '../AppTooltip';

export function CarriedOverPlanIndicator({ season, tabIndex = 0, compact = false }: {
  season?: string | null;
  tabIndex?: number;
  compact?: boolean;
}) {
  const { t } = useTranslation('plantingPlans');
  const [open, setOpen] = useState(false);
  const description = season
    ? t('carriedOver.description', { season })
    : t('carriedOver.unknownDescription');
  return (
    <AppTooltip
      title={description}
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      enterDelay={0}
      enterNextDelay={0}
      disableTouchListener
      slotProps={{ tooltip: { sx: { overflowWrap: 'anywhere' } } }}
    >
      <ButtonBase
        disableRipple
        tabIndex={tabIndex}
        aria-label={description}
        onClick={(event) => {
          event.stopPropagation();
          event.currentTarget.focus({ preventScroll: true });
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: compact ? 24 : 44,
          height: compact ? 24 : 44,
          flexShrink: 0,
          color: 'text.secondary',
          borderRadius: 1,
          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
        }}
      >
        <HistoryOutlinedIcon sx={{ fontSize: 18 }} />
      </ButtonBase>
    </AppTooltip>
  );
}
