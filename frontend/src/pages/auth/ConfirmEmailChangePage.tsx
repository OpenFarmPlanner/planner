import { Alert, Box, CircularProgress, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { confirmEmailChange, getAuthErrorMessage } from '../../auth/authApi';
import { useTranslation } from '../../i18n';

export default function ConfirmEmailChangePage() {
  const { t } = useTranslation('account');
  const [searchParams] = useSearchParams();
  const uid = searchParams.get('uid');
  const token = searchParams.get('token');
  const requestId = searchParams.get('request_id');
  const hasRequiredParams = Boolean(uid && token && requestId);
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!uid || !token || !requestId) {
      return;
    }

    void (async () => {
      try {
        await confirmEmailChange(uid, token, requestId);
        setStatus('success');
      } catch (confirmationError) {
        setStatus('error');
        setError(confirmationError);
      }
    })();
  }, [requestId, token, uid]);

  const effectiveStatus = hasRequiredParams ? status : 'error';

  return (
    <Box sx={{ maxWidth: 640, mx: 'auto', mt: 8, p: 3 }}>
      <Typography variant="h4" sx={{ mb: 2 }}>
        {t('emailConfirm.title')}
      </Typography>
      {effectiveStatus === 'loading' ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <CircularProgress size={20} />
          <Typography>{t('emailConfirm.loading')}</Typography>
        </Box>
      ) : null}
      {effectiveStatus === 'success' ? <Alert severity="success">{t('emailConfirm.success')}</Alert> : null}
      {effectiveStatus === 'error' ? <Alert severity="error">{getAuthErrorMessage(error, t('emailConfirm.invalid'))}</Alert> : null}
    </Box>
  );
}
