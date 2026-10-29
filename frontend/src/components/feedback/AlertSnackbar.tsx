import type { ReactNode } from 'react';
import {
  Alert,
  Snackbar,
  type AlertProps,
  type SnackbarOrigin,
  type SnackbarProps,
  type SxProps,
  type Theme,
} from '@mui/material';

const DEFAULT_ANCHOR_ORIGIN: SnackbarOrigin = {
  vertical: 'bottom',
  horizontal: 'center',
};

interface AlertSnackbarProps {
  open: boolean;
  message: ReactNode;
  severity: NonNullable<AlertProps['severity']>;
  onClose: () => void;
  autoHideDuration?: SnackbarProps['autoHideDuration'];
  anchorOrigin?: SnackbarProps['anchorOrigin'];
  closeText?: string;
  variant?: AlertProps['variant'];
  action?: AlertProps['action'];
  snackbarSx?: SxProps<Theme>;
  alertSx?: SxProps<Theme>;
  /** Announce politely (role="status") instead of as an alert. */
  polite?: boolean;
  /** Keep the snackbar open when the user clicks elsewhere on the page. */
  ignoreClickAway?: boolean;
}

export function AlertSnackbar({
  open,
  message,
  severity,
  onClose,
  autoHideDuration = 5000,
  anchorOrigin = DEFAULT_ANCHOR_ORIGIN,
  closeText,
  variant,
  action,
  snackbarSx,
  alertSx,
  polite = false,
  ignoreClickAway = false,
}: AlertSnackbarProps) {
  const handleSnackbarClose: NonNullable<SnackbarProps['onClose']> = (_event, reason) => {
    if (ignoreClickAway && reason === 'clickaway') {
      return;
    }
    onClose();
  };

  const handleAlertClose: NonNullable<AlertProps['onClose']> = () => {
    onClose();
  };

  return (
    <Snackbar
      open={open}
      autoHideDuration={autoHideDuration}
      onClose={handleSnackbarClose}
      anchorOrigin={anchorOrigin}
      sx={snackbarSx}
    >
      <Alert
        onClose={handleAlertClose}
        severity={severity}
        variant={variant}
        closeText={closeText}
        sx={alertSx}
        action={action}
        {...(polite ? { role: 'status', 'aria-live': 'polite' as const } : {})}
      >
        {message}
      </Alert>
    </Snackbar>
  );
}
