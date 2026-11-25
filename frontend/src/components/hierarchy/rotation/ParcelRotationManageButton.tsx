import { Button } from '@mui/material';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import { useTranslation } from '../../../i18n';

/** Project-level entry to the shared rotation-group dialog, styled like the toolbar's Filter and Columns buttons. */
export function ParcelRotationManageButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation('hierarchy');
  return (
    <Button variant="outlined" color="inherit" startIcon={<AutorenewIcon fontSize="small" />}
      aria-haspopup="dialog" onClick={onClick} sx={{ minHeight: 40 }}>
      {t('parcelRotation.manage')}
    </Button>
  );
}
