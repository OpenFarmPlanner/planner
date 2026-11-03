import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { Box } from '@mui/material';

import { AppTooltip } from '../components/AppTooltip';

/**
 * A small focusable info icon whose tooltip explains a heading or a field; a
 * tap opens it on touch. Inside a field label it keeps the click from
 * focusing the input (and opening the keyboard on a phone).
 */
export function FieldInfoIcon({ title }: { title: string }) {
  return (
    <AppTooltip title={title} enterTouchDelay={0}>
      <Box
        component="span"
        role="img"
        tabIndex={0}
        aria-label={title}
        onClick={(event) => event.preventDefault()}
        sx={{
          display: 'inline-flex',
          verticalAlign: 'middle',
          color: 'text.secondary',
          cursor: 'help',
          // A label inside the empty field ignores the pointer; the icon must not.
          pointerEvents: 'auto',
          borderRadius: '50%',
          '&:focus-visible': { outline: (theme) => `2px solid ${theme.palette.primary.main}` },
        }}
      >
        <InfoOutlinedIcon fontSize="small" />
      </Box>
    </AppTooltip>
  );
}
