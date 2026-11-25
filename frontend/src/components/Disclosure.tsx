import { useId, useState, type ReactNode } from 'react';
import { Box, Button, Collapse } from '@mui/material';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

/** A collapsed-by-default section; its content stays mounted, so drafts and errors survive collapsing. */
export function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  return (
    <Box>
      <Button type="button" variant="text" size="small" aria-expanded={open} aria-controls={contentId}
        endIcon={open ? <ExpandLessIcon /> : <ExpandMoreIcon />} onClick={() => setOpen(value => !value)}>
        {label}
      </Button>
      <Collapse in={open} id={contentId}><Box sx={{ pt: 1 }}>{children}</Box></Collapse>
    </Box>
  );
}
