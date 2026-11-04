import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from './useAuth';
import ConsentGate from './ConsentGate';
import RuntimeErrorState from '../components/runtime/RuntimeErrorState';
import { useTranslation } from '../i18n';

export default function ProtectedRoute() {
  const { user, isLoading, isAuthUnavailable, retryAuthCheck } = useAuth();
  const { t } = useTranslation('common');
  const location = useLocation();

  if (isLoading) {
    return <div style={{ padding: 24 }}>{t('messages.loading')}</div>;
  }

  if (!user && isAuthUnavailable) {
    return <RuntimeErrorState variant="serverUnavailable" onRetry={() => void retryAuthCheck()} />;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (user.pending_consents.length > 0) {
    return <ConsentGate />;
  }

  return <Outlet />;
}
