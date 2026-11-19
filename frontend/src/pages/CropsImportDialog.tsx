import { useEffect, useRef } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
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
import type { TFunction } from 'i18next';
import { DISPLAY_COLOR_PATTERN } from '../crops/displayColor';
import { getCropFieldLabel } from './cropsHistoryUtils';
import { formatImportDiffChange, formatImportFailure, formatImportValue, formatImportRowRanges } from './cropsImportUtils';
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
  progressLabel?: string;
};

type ImportDiffChange = NonNullable<ImportPreviewResult['diff']>[number];

/** A color value with a small swatch in front, so "#b91c1c" reads as a color. */
function ColorValue({ value, t }: { value: unknown; t: TFunction<'crops'> }) {
  const text = formatImportValue(value, 'display_color', t);
  if (typeof value !== 'string' || !DISPLAY_COLOR_PATTERN.test(value)) {
    return <>{text}</>;
  }
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, verticalAlign: 'middle' }}>
      <Box
        component="span"
        aria-hidden
        sx={{
          width: 12,
          height: 12,
          borderRadius: 0.5,
          border: 1,
          borderColor: 'divider',
          bgcolor: value,
          flexShrink: 0,
        }}
      />
      {text}
    </Box>
  );
}

function ImportDiffLine({ change, t }: { change: ImportDiffChange; t: TFunction<'crops'> }) {
  if (change.field !== 'display_color') {
    return <>{formatImportDiffChange(change, t)}</>;
  }
  return (
    <>
      {getCropFieldLabel(change.field, t)}: <ColorValue value={change.current} t={t} /> → <ColorValue value={change.new} t={t} />
    </>
  );
}

const renderCropLabel = (result: ImportPreviewResult): string => (
  `${result.import_data.name}${result.import_data.variety ? ` (${result.import_data.variety})` : ''}`
);

function NewCropsSection({ entries, t }: { entries: ImportPreviewResult[]; t: Translator }) {
  const { t: cropsT } = useTranslation('crops');
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
            <ListItemText
              primary={renderCropLabel(result)}
              secondary={Array.isArray(result.import_data.timing_windows)
                ? formatImportValue(result.import_data.timing_windows, 'timing_windows', cropsT)
                : undefined}
            />
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
  disabled,
}: {
  entries: ImportPreviewResult[];
  confirmUpdates: boolean;
  onConfirmUpdatesChange: (value: boolean) => void;
  t: Translator;
  disabled: boolean;
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
            {Array.isArray(result.import_data.timing_windows) && (
              <Typography variant="body2" color="text.secondary">
                {formatImportValue(result.import_data.timing_windows, 'timing_windows', cropsT)}
              </Typography>
            )}
            {result.diff && result.diff.length > 0 && (
              <Box sx={{ ml: 2, fontSize: '0.875rem' }}>
                {result.diff.map((change, index) => (
                  <Typography key={index} variant="caption" sx={{ display: "block", }} >
                    <ImportDiffLine change={change} t={cropsT} />
                  </Typography>
                ))}
              </Box>
            )}
          </ListItem>
        ))}
      </List>
      <FormControlLabel
        sx={{ mt: 1 }}
        control={<Checkbox disabled={disabled} checked={confirmUpdates} onChange={(event) => onConfirmUpdatesChange(event.target.checked)} />}
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
  progressLabel,
}: CropsImportDialogProps) {
  const { t: cropsT, i18n } = useTranslation('crops');
  const contentRef = useRef<HTMLDivElement>(null);
  const resultAlertRef = useRef<HTMLDivElement>(null);
  const result = importState.result;
  const isFinished = importState.status === 'finished';
  const isImporting = importState.status === 'applying';

  // The result sits at the top; bring it into view after an import.
  useEffect(() => {
    if (!open || !isFinished) return;
    const frame = window.requestAnimationFrame(() => {
      contentRef.current?.scrollTo?.({ top: 0 });
      resultAlertRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isFinished, open]);

  const newCrops = importState.previewResults.filter((result) => result.status === 'create');
  const duplicates = importState.previewResults.filter((result) => result.status === 'duplicate');
  const updateCandidates = importState.previewResults.filter((result) => result.status === 'update_candidate');

  return (
    <Dialog open={open} onClose={isImporting ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('import.title')}</DialogTitle>
      <DialogContent ref={contentRef}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          {importState.previewError && <Alert severity="error">{importState.previewError}</Alert>}
          {result?.error && <Alert severity="error" ref={resultAlertRef} tabIndex={-1}>{result.error}</Alert>}
          {result?.savedSummary && <Alert severity="success" role="status">{result.savedSummary}</Alert>}
          {result?.details && <Typography>{result.details}</Typography>}
          {isImporting && progressLabel && <Typography role="status">{progressLabel}</Typography>}
          {result && result.confirmedRows.length > 0 && <Typography sx={{ overflowWrap: 'anywhere' }}>
            {t('import.confirmedRows', { rows: formatImportRowRanges(result.confirmedRows, i18n.language) })}
          </Typography>}
          {result && result.failedEntries.length > 0 && (
            <Box>
              <Typography variant="h6" color="error.main">
                {t('import.incompleteEntries')} ({result.failedEntries.length})
              </Typography>
              <List dense>
                {result.failedEntries.map((entry, index) => (
                  <ListItem key={index}>
                    <ListItemText
                      primary={`${t('import.rowLabel', { row: entry.row_number ?? entry.index + 1 })}: ${entry.name ? `${entry.name}${entry.variety ? ` (${entry.variety})` : ''}` : t('import.invalidEntry')}`}
                      secondary={entry.companionPhase
                        ? t('import.companionFailure', { message: formatImportFailure(entry, cropsT, result.seedRateConstraints) })
                        : formatImportFailure(entry, cropsT, result.seedRateConstraints)}
                    />
                  </ListItem>
                ))}
              </List>
            </Box>
          )}

          {!isFinished && <>
            {importState.previewCount > 0 && <Typography variant="body1">
              {t('import.foundCount', { count: importState.validCount || importState.previewCount })}
            </Typography>}
            {importState.previewCount !== importState.validCount && (
              <Typography variant="body2" color="warning.main">
                {t('import.invalidCount', {
                  count: importState.previewCount - importState.validCount,
                })}
              </Typography>
            )}

            <NewCropsSection entries={newCrops} t={t} />
            {duplicates.length > 0 && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="h6" color="warning.main">
                  {t('import.duplicateRows', { count: duplicates.length })}
                </Typography>
                <Typography variant="body2">{t('import.duplicatePolicy')}</Typography>
                <List dense>
                  {duplicates.map((result) => (
                    <ListItem key={result.index}>
                      <ListItemText
                        primary={renderCropLabel(result)}
                        secondary={t('import.duplicateRow', {
                          row: result.row_number ?? result.index + 1,
                          firstRow: result.duplicate_of_row_number ?? (result.duplicate_of_index ?? 0) + 1,
                        })}
                      />
                    </ListItem>
                  ))}
                </List>
              </Box>
            )}
            <UpdateCandidatesSection
              entries={updateCandidates}
              confirmUpdates={confirmUpdates}
              onConfirmUpdatesChange={onConfirmUpdatesChange}
              disabled={isImporting}
              t={t}
            />
          </>}

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

        </Box>
      </DialogContent>
      <DialogActions>
        {isFinished ? (
          <Button variant="contained" onClick={onClose}>{t('import.close')}</Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={isImporting}>{t('import.close')}</Button>
            <Button
              variant="contained"
              onClick={onImportStart}
              disabled={!hasImportableEntries || isImporting}
              startIcon={isImporting ? <CircularProgress color="inherit" size={16} /> : undefined}
            >
              {isImporting ? t('import.importing') : t('import.start')}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
