import CloseIcon from '@mui/icons-material/Close';
import { IconButton } from '@mui/material';
import { AlertSnackbar } from '../feedback/AlertSnackbar';
import { useTranslation } from '../../i18n';
import type { EditHintControls } from './useEditHint';

const EDIT_HINT_AUTO_HIDE_MS = 6000;

type EditHintSnackbarProps = Pick<EditHintControls, 'open' | 'close' | 'dismiss'>;

export function EditHintSnackbar({ open, close, dismiss }: EditHintSnackbarProps) {
  const { t } = useTranslation('common');

  return (
    <AlertSnackbar
      open={open}
      message={t('messages.tableEditHint')}
      severity="info"
      onClose={close}
      autoHideDuration={EDIT_HINT_AUTO_HIDE_MS}
      polite
      ignoreClickAway
      action={(
        <IconButton size="small" color="inherit" aria-label={t('messages.tableEditHintDismiss')} onClick={dismiss}>
          <CloseIcon fontSize="small" />
        </IconButton>
      )}
    />
  );
}
