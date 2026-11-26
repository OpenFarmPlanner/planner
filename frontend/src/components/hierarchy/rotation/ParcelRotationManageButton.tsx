import AutorenewIcon from '@mui/icons-material/Autorenew';
import { useTranslation } from '../../../i18n';
import { LIST_TOOLBAR_LABEL_QUERY, ResponsiveToolbarAction } from '../../buttons/ResponsiveToolbarAction';

/** Project-level entry to the shared rotation-group dialog, styled like the toolbar's Filter and Columns buttons. */
export function ParcelRotationManageButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation('hierarchy');
  return (
    <ResponsiveToolbarAction variant="outlined" color="inherit" icon={<AutorenewIcon fontSize="small" />}
      label={t('parcelRotation.manage')} labelQuery={LIST_TOOLBAR_LABEL_QUERY}
      aria-haspopup="dialog" onClick={onClick} />
  );
}
