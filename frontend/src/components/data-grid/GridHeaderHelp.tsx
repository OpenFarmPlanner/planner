import { useEffect, useId, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { AppTooltip } from '../AppTooltip';
import { dataGridHeaderLabelSx } from './dataGridHeaderLabelSx';

export function GridHeaderHelp({ label, description }: { label: string; description: string }) {
  const labelRef = useRef<HTMLSpanElement>(null);
  const descriptionId = useId();
  const [keyboardFocused, setKeyboardFocused] = useState(false);
  const [interactionOpen, setInteractionOpen] = useState(false);

  useEffect(() => {
    const header = labelRef.current?.closest('[role="columnheader"]');
    if (!header) return;

    // The grid owns the focusable header. Describe it and listen there so the
    // custom label leaves the grid's roving tab stop in place.
    const describedBy = header.getAttribute('aria-describedby');
    header.setAttribute('aria-describedby', [describedBy, descriptionId].filter(Boolean).join(' '));
    const handleFocus = (event: Event) => {
      setKeyboardFocused(event.target === header && header.matches(':focus-visible'));
    };
    const handleBlur = () => setKeyboardFocused(false);
    header.addEventListener('focusin', handleFocus);
    header.addEventListener('focusout', handleBlur);
    return () => {
      header.removeEventListener('focusin', handleFocus);
      header.removeEventListener('focusout', handleBlur);
      const remaining = header.getAttribute('aria-describedby')?.split(/\s+/)
        .filter(id => id && id !== descriptionId).join(' ');
      if (remaining) header.setAttribute('aria-describedby', remaining);
      else header.removeAttribute('aria-describedby');
    };
  }, [descriptionId]);

  return <>
    <AppTooltip explanatory describeChild disableInteractive title={<>{description}</>}
      open={keyboardFocused || interactionOpen} onOpen={() => setInteractionOpen(true)}
      onClose={() => {
        setKeyboardFocused(false);
        setInteractionOpen(false);
      }}>
      <Box component="span" ref={labelRef} sx={dataGridHeaderLabelSx}>{label}</Box>
    </AppTooltip>
    <div id={descriptionId} hidden>{description}</div>
  </>;
}
