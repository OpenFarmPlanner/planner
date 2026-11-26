import { useRef } from 'react';
import { Box } from '@mui/material';

interface TableColumnDividerProps {
  label: string;
  width: number;
  onResize: (width: number) => void;
  onAutoFit: () => void;
}

export function TableColumnDivider({ label, width, onResize, onAutoFit }: TableColumnDividerProps) {
  const drag = useRef<{ pointer: number; startX: number; width: number; started: boolean } | null>(null);

  return (
    <Box
      component="button"
      type="button"
      aria-label={label}
      onDoubleClick={onAutoFit}
      onClick={event => {
        if (event.detail === 0) onAutoFit();
      }}
      onKeyDown={event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        onResize(width + (event.key === 'ArrowLeft' ? -12 : 12));
      }}
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0) return;
        drag.current = { pointer: event.pointerId, startX: event.clientX, width, started: false };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        const initial = drag.current;
        if (initial?.pointer !== event.pointerId) return;
        const delta = event.clientX - initial.startX;
        if (!initial.started && Math.abs(delta) < 3) return;
        initial.started = true;
        onResize(initial.width + delta);
      }}
      onLostPointerCapture={() => { drag.current = null; }}
      sx={{
        position: 'absolute', inset: '0 0 0 auto', width: 14, p: 0, border: 0,
        bgcolor: 'transparent', cursor: 'col-resize', touchAction: 'none',
        '&::before': {
          content: '""', position: 'absolute', inset: '25% 3px 25% auto',
          borderRight: '1px solid', borderColor: 'divider',
        },
        '&:hover::before, &:focus-visible::before': { borderColor: 'primary.main' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
        '@media (pointer: coarse)': { width: 22 },
      }}
    />
  );
}
