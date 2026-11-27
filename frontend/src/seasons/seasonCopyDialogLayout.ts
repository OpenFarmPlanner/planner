import type { DialogProps } from '@mui/material';

export const seasonCopyDialogSlotProps = {
  paper: {
    sx: {
      '--season-dialog-margin': { xs: '12px', sm: '24px' },
      '@media (max-height: 500px)': { '--season-dialog-margin': '8px' },
      m: 'var(--season-dialog-margin)',
      width: 'calc(100% - 2 * var(--season-dialog-margin))',
      maxHeight: 'calc(100dvh - 2 * var(--season-dialog-margin))',
    },
  },
} satisfies DialogProps['slotProps'];

export const seasonCopyDialogTitleSx = {
  flexShrink: 0,
  overflowWrap: 'anywhere',
  px: { xs: 2, sm: 3 },
} as const;

export const seasonCopyDialogContentSx = {
  minHeight: 0,
  minWidth: 0,
  overflowWrap: 'anywhere',
  overscrollBehaviorY: 'contain',
  px: { xs: 2, sm: 3 },
} as const;

export const seasonCopyDialogActionsSx = { flexShrink: 0, flexWrap: 'wrap', rowGap: 0.5 } as const;
