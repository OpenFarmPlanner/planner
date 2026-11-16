import { Alert, CircularProgress, Stack, Typography } from '@mui/material';
import { ConfirmationDialog } from '../components/feedback/ConfirmationDialog';
import { useTranslation } from '../i18n';
import type { ProjectHistory } from './useProjectHistory';

export function ImportUndoDialog({ history }: { history: ProjectHistory }) {
  const { t } = useTranslation('crops');
  const preview = history.importUndoPreview;
  const conflicts = [...new Set(preview?.conflicts.map(conflict => conflict.code) ?? [])];
  return <ConfirmationDialog
    open={Boolean(history.pendingImportUndo)}
    fullWidth
    title={t('history.import.undo')}
    messageTypographyProps={{ component: 'div' }}
    message={<Stack spacing={2}>
      <Typography variant="body2">{t('history.import.selectiveNotice')}</Typography>
      {!preview && !history.importUndoError ? <CircularProgress size={24} aria-label={t('history.import.loading')} /> : null}
      {history.importUndoError ? <Alert severity={history.importUndoError === 'already_undone' ? 'info' : 'error'}>
        {t(history.importUndoError === 'already_undone' ? 'history.import.alreadyUndone' : 'history.import.previewError')}
      </Alert> : null}
      {preview ? <>
        <Typography variant="body2">{t('history.import.removeCreated', { count: preview.created_count })}</Typography>
        <Typography variant="body2">{t('history.import.restoreUpdated', { count: preview.updated_count })}</Typography>
        {conflicts.map(code => {
          const names = [...new Set(preview.conflicts.filter(conflict => conflict.code === code)
            .map(conflict => conflict.object_display_name || history.pendingImportUndo?.children?.find(child =>
              child.object_id === conflict.object_id && child.object_type === conflict.object_type)?.object_display_name)
            .filter((name): name is string => Boolean(name)))];
          return <Alert severity="warning" key={code}>
            <Typography variant="body2">{t(code === 'later_edit' ? 'history.import.laterEdit'
              : code === 'unavailable_state' ? 'history.import.unavailableState' : 'history.import.dependentData')}</Typography>
            {names.length ? <Stack component="ul" spacing={0.5} sx={{ pl: 2, mb: 0 }}>
              {names.map(name => <Typography component="li" variant="body2" key={name} sx={{ overflowWrap: 'anywhere' }}>{name}</Typography>)}
            </Stack> : null}
          </Alert>;
        })}
      </> : null}
    </Stack>}
    cancelLabel={t('restoreDialog.cancel')}
    confirmLabel={t('history.import.undo')}
    onCancel={history.cancelImportUndo}
    onConfirm={() => void history.confirmImportUndo()}
    cancelButtonProps={{ disabled: history.undoBusy }}
    confirmButtonProps={{ disabled: !preview || Boolean(conflicts.length) || history.undoBusy, variant: 'contained' }}
  />;
}
