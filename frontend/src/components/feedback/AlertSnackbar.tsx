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
}: AlertSnackbarProps) {
  const handleSnackbarClose: NonNullable<SnackbarProps['onClose']> = () => {
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
      >
        {message}
      </Alert>
    </Snackbar>
  );
}
