import { Button } from '@mui/material';
import { useTranslation } from '../i18n';

interface LoadRetryButtonProps {
  disabled?: boolean;
  onClick: () => void;
}

/** The retry action of an error `Alert` shown when a page's data failed to load. */
export default function LoadRetryButton({ disabled = false, onClick }: LoadRetryButtonProps) {
  const { t } = useTranslation('common');
  return (
    <Button color="inherit" size="small" disabled={disabled} onClick={onClick} sx={{ whiteSpace: 'nowrap' }}>
      {t('runtime.retryAction')}
    </Button>
  );
}
