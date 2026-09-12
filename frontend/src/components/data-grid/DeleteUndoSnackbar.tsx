import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlineOutlined';
import { Box, Button, Portal, Snackbar, Typography } from '@mui/material';

export const DELETE_UNDO_DURATION_MS = 10000;

interface DeleteUndoSnackbarProps {
  open: boolean;
  message: string;
  undoLabel: string;
  offsetIndex?: number;
  testId?: string;
  onClose: (reason?: string) => void;
  onUndo: () => void;
}

export function DeleteUndoSnackbar({
  open,
  message,
  undoLabel,
  offsetIndex = 0,
  testId = 'delete-undo-snackbar',
  onClose,
  onUndo,
}: DeleteUndoSnackbarProps) {
  return (
    <Portal>
      <Snackbar
        open={open}
        autoHideDuration={DELETE_UNDO_DURATION_MS}
        onClose={(_event, reason) => {
          if (reason === 'clickaway') {
            return;
          }
          onClose(reason);
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ mb: offsetIndex * 7 }}
      >
        <Box
          role="status"
          aria-live="polite"
          data-testid={testId}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            width: 'min(520px, calc(100vw - 32px))',
            px: { xs: 1.5, sm: 2 },
            py: 1.25,
            borderRadius: 2,
            border: '1px solid',
            borderColor: 'surface.surfaceSoftBorder',
            borderLeft: '4px solid',
            borderLeftColor: 'success.main',
            bgcolor: 'surface.surfaceBackground',
            color: 'text.primary',
            boxShadow: 6,
          }}
        >
          <CheckCircleOutlineIcon
            color="success"
            fontSize="small"
            aria-hidden="true"
            sx={{ flexShrink: 0 }}
          />
          <Typography
            component="span"
            sx={{
              flex: '1 1 auto',
              minWidth: 0,
              fontSize: '0.92rem',
              fontWeight: 600,
              lineHeight: 1.35,
            }}
          >
            {message}
          </Typography>
          <Box
            aria-hidden="true"
            sx={{
              alignSelf: 'stretch',
              width: '1px',
              bgcolor: 'surface.surfaceSoftBorder',
              display: { xs: 'none', sm: 'block' },
            }}
          />
          <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <Button
              aria-label={`${undoLabel}: ${message}`}
              size="small"
              variant="text"
              onClick={onUndo}
              sx={{
                minHeight: 36,
                px: 1.25,
                fontWeight: 700,
                color: 'primary.main',
                textTransform: 'none',
                '&:hover': {
                  bgcolor: 'action.hover',
                },
                '&.Mui-focusVisible': {
                  outline: '2px solid',
                  outlineColor: 'primary.main',
                  outlineOffset: 2,
                },
              }}
            >
              {undoLabel}
            </Button>
          </Box>
        </Box>
      </Snackbar>
    </Portal>
  );
}
