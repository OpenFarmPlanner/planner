import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  List,
  ListItem,
  ListItemText,
  Typography,
} from '@mui/material';
import { useTranslation } from '../i18n';
import type { ImportPreviewResult } from './cropsPageUtils';
import { formatImportDiffChange, formatImportFailure } from './cropsImportUtils';
import type { CropImportState } from './useCropImportState';

type Translator = (key: string, options?: Record<string, unknown>) => string;

type CropsImportDialogProps = {
  open: boolean;
  importState: CropImportState;
  hasImportableEntries: boolean;
  confirmUpdates: boolean;
  onConfirmUpdatesChange: (value: boolean) => void;
  onClose: () => void;
  onImportStart: () => void;
  t: Translator;
};

const renderCropLabel = (result: ImportPreviewResult): string => (
  `${result.import_data.name}${result.import_data.variety ? ` (${result.import_data.variety})` : ''}`
);

function NewCropsSection({ entries, t }: { entries: ImportPreviewResult[]; t: Translator }) {
  if (!entries.length) {
    return null;
  }

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="h6" color="success.main">
        {t('import.newCrops')} ({entries.length})
      </Typography>
      <List dense>
        {entries.map((result) => (
          <ListItem key={result.index}>
            <ListItemText primary={renderCropLabel(result)} />
          </ListItem>
        ))}
      </List>
    </Box>
  );
}

function UpdateCandidatesSection({
  entries,
  confirmUpdates,
  onConfirmUpdatesChange,
  t,
}: {
  entries: ImportPreviewResult[];
  confirmUpdates: boolean;
  onConfirmUpdatesChange: (value: boolean) => void;
  t: Translator;
}) {
  const { t: cropsT } = useTranslation('crops');

  if (!entries.length) {
    return null;
  }

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="h6" color="warning.main">
        {t('import.updateCandidates')} ({entries.length})
      </Typography>
      <List dense>
        {entries.map((result) => (
          <ListItem key={result.index} sx={{ flexDirection: 'column', alignItems: 'flex-start' }}>
            <ListItemText
              primary={renderCropLabel(result)}
              secondary={result.diff && result.diff.length > 0 ? t('import.fieldsChanged', { count: result.diff.length }) : t('import.noChanges')}
            />
            {result.diff && result.diff.length > 0 && (
              <Box sx={{ ml: 2, fontSize: '0.875rem' }}>
                {result.diff.map((change, index) => (
                  <Typography key={index} variant="caption" sx={{ display: "block", }} >
                    {formatImportDiffChange(change, cropsT)}
                  </Typography>
                ))}
              </Box>
            )}
          </ListItem>
        ))}
      </List>
      <FormControlLabel
        sx={{ mt: 1 }}
        control={<Checkbox checked={confirmUpdates} onChange={(event) => onConfirmUpdatesChange(event.target.checked)} />}
        label={t('import.confirmUpdates')}
      />
    </Box>
  );
}

export function CropsImportDialog({
  open,
  importState,
  hasImportableEntries,
  confirmUpdates,
  onConfirmUpdatesChange,
  onClose,
  onImportStart,
  t,
}: CropsImportDialogProps) {
  const { t: cropsT } = useTranslation('crops');
  const newCrops = importState.previewResults.filter((result) => result.status === 'create');
  const updateCandidates = importState.previewResults.filter((result) => result.status === 'update_candidate');

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('import.title')}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <Typography variant="body1">
            {t('import.foundCount', { count: importState.validCount || importState.previewCount })}
          </Typography>
          {importState.previewCount !== importState.validCount && (
            <Typography variant="body2" color="warning.main">
              {t('import.invalidCount', {
                count: importState.previewCount - importState.validCount,
              })}
            </Typography>
          )}

          <NewCropsSection entries={newCrops} t={t} />
          <UpdateCandidatesSection
            entries={updateCandidates}
            confirmUpdates={confirmUpdates}
            onConfirmUpdatesChange={onConfirmUpdatesChange}
            t={t}
          />

          {importState.invalidEntries.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="h6" color="error.main">
                {t('import.invalidEntries')} ({importState.invalidEntries.length})
              </Typography>
              <List dense>
                {importState.invalidEntries.map((entry) => (
                  <ListItem key={entry}>
                    <ListItemText primary={entry} />
                  </ListItem>
                ))}
              </List>
            </Box>
          )}

          {importState.failedEntries.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="h6" color="error.main">
                {t('import.failedEntries')} ({importState.failedEntries.length})
              </Typography>
              <List dense>
                {importState.failedEntries.map((entry, index) => (
                  <ListItem key={index}>
                    <ListItemText
                      primary={entry.name ? `${entry.name}${entry.variety ? ` (${entry.variety})` : ''}` : `${t('import.invalidEntry')} ${entry.index + 1}`}
                      secondary={formatImportFailure(entry, cropsT)}
                    />
                  </ListItem>
                ))}
              </List>
            </Box>
          )}

          {importState.error && <Alert severity="error">{importState.error}</Alert>}
          {importState.success && <Alert severity="success">{importState.success}</Alert>}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('import.close')}</Button>
        <Button
          variant="contained"
          onClick={onImportStart}
          disabled={!hasImportableEntries || importState.status === 'uploading' || importState.status === 'success'}
        >
          {importState.status === 'success' ? t('import.done') : t('import.start')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
