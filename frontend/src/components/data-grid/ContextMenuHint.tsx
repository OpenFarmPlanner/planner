import CloseIcon from '@mui/icons-material/Close';
import MouseOutlinedIcon from '@mui/icons-material/MouseOutlined';
import TouchAppOutlinedIcon from '@mui/icons-material/TouchAppOutlined';
import { Box, IconButton, Typography, useMediaQuery, type SxProps, type Theme } from '@mui/material';
import type { ReactNode } from 'react';
import { useTranslation } from '../../i18n';
import { useIsCoarsePointer } from '../../utils/contextMenu';

interface ContextMenuHintProps {
  message: ReactNode;
  secondary?: ReactNode;
  onClose?: () => void;
  compact?: boolean;
  prominent?: boolean;
  sx?: SxProps<Theme>;
  /**
   * 'desktop' (default) is the right-click hint, shown only on a fine
   * (mouse/trackpad) pointer. 'touch' is the long-press hint, shown only on
   * a coarse (touch) pointer — the two are mutually exclusive by device, so
   * a page can render both unconditionally and exactly one (or neither, if
   * already dismissed) ever appears.
   */
  variant?: 'desktop' | 'touch';
}

export function ContextMenuHint({
  message,
  secondary,
  onClose,
  compact = false,
  prominent = false,
  sx,
  variant = 'desktop',
}: ContextMenuHintProps) {
  const { t } = useTranslation('common');
  const isCoarsePointer = useIsCoarsePointer();
  // Desktop kept its original (pointer: fine) and narrow-viewport check —
  // matching the discovery-hint gate in useContextMenuHint — the touch
  // variant is new and relies purely on pointer capability.
  const isMobileViewport = useMediaQuery('(max-width:900px)');
  const shouldHideHint = variant === 'desktop'
    ? (isCoarsePointer || isMobileViewport)
    : !isCoarsePointer;

  if (shouldHideHint) {
    return null;
  }

  return (
    <Box
      role="note"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1,
        maxWidth: '100%',
        px: compact ? 1 : 1.25,
        py: compact ? 0.625 : 0.75,
        border: '1px solid',
        borderColor: 'success.200',
        ...(prominent ? { borderLeft: '4px solid', borderLeftColor: 'success.main' } : {}),
        borderRadius: 1.5,
        bgcolor: 'success.50',
        color: 'text.secondary',
        boxShadow: 1,
        ...sx,
      }}
    >
      <Box
        aria-hidden="true"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: '0 0 auto',
          width: compact ? 22 : 24,
          height: compact ? 22 : 24,
          borderRadius: '50%',
          color: 'success.main',
          bgcolor: prominent ? 'success.100' : 'success.50',
        }}
      >
        {variant === 'touch' ? (
          <TouchAppOutlinedIcon sx={{ fontSize: compact ? 15 : 16 }} />
        ) : (
          <MouseOutlinedIcon sx={{ fontSize: compact ? 15 : 16 }} />
        )}
      </Box>
      <Box sx={{ minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 0.75, flexWrap: 'wrap' }}>
        <Typography variant="body2" sx={{ color: 'text.primary', fontWeight: prominent ? 700 : 600, lineHeight: 1.35 }}>
          {message}
        </Typography>
        {secondary ? (
          <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.35 }}>
            {secondary}
          </Typography>
        ) : null}
      </Box>
      {onClose ? (
        <IconButton
          size="small"
          aria-label={t('actions.close')}
          onClick={onClose}
          sx={{
            flex: '0 0 auto',
            ml: 0.25,
            width: 24,
            height: 24,
            color: 'text.secondary',
            '&:hover': {
              bgcolor: 'action.hover',
              color: 'text.primary',
            },
          }}
        >
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      ) : null}
    </Box>
  );
}
