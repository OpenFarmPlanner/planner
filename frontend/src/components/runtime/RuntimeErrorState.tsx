import { Box, Button, Stack, Typography } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useTranslation } from '../../i18n';
import { reloadForManualRecovery } from '../../runtime/chunkLoadErrors';

type RuntimeErrorStateProps =
  | { variant: 'applicationUpdated' | 'routeError' }
  | { variant: 'serverUnavailable'; onRetry: () => void };

const MESSAGE_KEYS: Record<RuntimeErrorStateProps['variant'], string> = {
  applicationUpdated: 'runtime.applicationUpdatedFallback',
  routeError: 'runtime.routeErrorFallback',
  serverUnavailable: 'runtime.serverUnavailable',
};

export default function RuntimeErrorState(props: RuntimeErrorStateProps) {
  const { t } = useTranslation('common');
  const isRetry = props.variant === 'serverUnavailable';

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2 }}>
      <Stack spacing={2} sx={{ maxWidth: 480, alignItems: 'center' }}>
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
          {t(MESSAGE_KEYS[props.variant])}
        </Typography>
        <Button
          variant="contained"
          startIcon={<RefreshIcon />}
          onClick={isRetry ? props.onRetry : () => reloadForManualRecovery()}
          sx={{ alignSelf: 'center' }}
        >
          {t(isRetry ? 'runtime.retryAction' : 'runtime.reloadAction')}
        </Button>
      </Stack>
    </Box>
  );
}
