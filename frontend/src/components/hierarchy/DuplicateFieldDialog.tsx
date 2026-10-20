import { useId, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react';
import axios from 'axios';
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
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import type { Bed, Field, FieldDuplicatePayload } from '../../api/types';
import { useTranslation } from '../../i18n';
import { formRowSx, mediumFieldSx, smallFieldSx } from '../forms/formLayout';
import { DisabledActionTooltip } from '../DisabledActionTooltip';
import { formatLocalizedNumber, getActiveFormattingLocale } from '../../utils/numberLocalization';
import { abbreviateNameList } from './utils/bedNaming';
import {
  evaluateFieldDuplicate,
  getInitialFieldDuplicateValues,
  previewBedNames,
  type FieldDuplicateFormValues,
} from './utils/fieldDuplicatePlan';

interface DuplicateFieldDialogProps {
  open: boolean;
  source: Field;
  /** Beds of `source` in their current table order. */
  sourceBeds: readonly Bed[];
  /** All fields of the project, for the per-location name check. */
  fields: readonly Field[];
  onClose: () => void;
  onDuplicate: (payload: FieldDuplicatePayload) => Promise<void>;
}

type ServerConflict =
  | { kind: 'nameTaken' }
  | { kind: 'bedNames'; names: string[] }
  | null;

const readServerConflict = (error: unknown): ServerConflict => {
  if (!axios.isAxiosError(error)) return null;
  const data = error.response?.data as { code?: unknown; names?: unknown } | undefined;
  if (data?.code === 'field_name_taken') return { kind: 'nameTaken' };
  if (data?.code === 'bed_names_conflict' && Array.isArray(data.names)) {
    return { kind: 'bedNames', names: data.names.filter((name): name is string => typeof name === 'string') };
  }
  return null;
};

export function DuplicateFieldDialog({
  open,
  source,
  sourceBeds,
  fields,
  onClose,
  onDuplicate,
}: DuplicateFieldDialogProps): ReactElement {
  const { t } = useTranslation(['hierarchy', 'common']);
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const locale = getActiveFormattingLocale();
  const titleId = useId();
  const persistedBeds = useMemo(
    () => sourceBeds.filter((bed) => typeof bed.id === 'number' && bed.id > 0),
    [sourceBeds],
  );
  const [values, setValues] = useState<FieldDuplicateFormValues>(() => getInitialFieldDuplicateValues(source, fields));
  const [serverConflict, setServerConflict] = useState<ServerConflict>(null);
  const [submitError, setSubmitError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false);

  const plan = useMemo(
    () => evaluateFieldDuplicate(values, source, persistedBeds, fields),
    [fields, persistedBeds, source, values],
  );
  const nameTaken = plan.nameTaken || serverConflict?.kind === 'nameTaken';
  const conflictingBedNames = plan.duplicateBedNames.length > 0
    ? plan.duplicateBedNames
    : serverConflict?.kind === 'bedNames' ? serverConflict.names : [];
  const canSubmit = plan.canSubmit && !nameTaken && conflictingBedNames.length === 0 && !isSaving;

  const formatNumber = (value: number): string => formatLocalizedNumber(value, locale, { maximumFractionDigits: 2 });

  const updateValues = (patch: Partial<FieldDuplicateFormValues>): void => {
    setValues((previous) => ({ ...previous, ...patch }));
    setServerConflict(null);
    setSubmitError('');
  };

  const handleClose = (): void => {
    if (!isSavingRef.current) {
      onClose();
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!canSubmit || isSavingRef.current) {
      return;
    }
    isSavingRef.current = true;
    setIsSaving(true);
    setSubmitError('');
    try {
      await onDuplicate({
        name: plan.name,
        copy_beds: values.copyBeds && persistedBeds.length > 0,
        replace_search: values.copyBeds ? values.replaceSearch : '',
        replace_with: values.copyBeds ? values.replaceWith : '',
      });
    } catch (error) {
      console.error('Error duplicating field', error);
      const conflict = readServerConflict(error);
      if (conflict) {
        setServerConflict(conflict);
      } else {
        setSubmitError(t('dialogs.duplicateField.saveError'));
      }
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  const hasDimensions = typeof source.length_m === 'number' && source.length_m > 0
    && typeof source.width_m === 'number' && source.width_m > 0;
  const previewParts = [
    t('dialogs.duplicateField.previewField', { name: plan.name || '…' }),
    ...(hasDimensions
      ? [t('dialogs.duplicateField.previewDimensions', {
        length: formatNumber(source.length_m!),
        width: formatNumber(source.width_m!),
      })]
      : []),
    ...(plan.bedNames.length > 0
      ? [t('dialogs.duplicateField.previewBeds', {
        count: plan.bedNames.length,
        names: previewBedNames(plan.bedNames).join(', '),
      })]
      : []),
  ];

  let disabledReason = '';
  if (isSaving) {
    disabledReason = t('common:disabledReasons.busy');
  } else if (plan.name === '') {
    disabledReason = t('common:disabledReasons.requiredFields');
  } else if (nameTaken) {
    disabledReason = t('dialogs.duplicateField.nameTaken');
  } else if (conflictingBedNames.length > 0 || plan.invalidBedNames.length > 0) {
    disabledReason = t('dialogs.duplicateField.bedNamesBlocked');
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      fullWidth
      maxWidth="sm"
      fullScreen={fullScreen}
      aria-labelledby={titleId}
    >
      <Box
        component="form"
        noValidate
        onSubmit={(event) => { void handleSubmit(event); }}
        sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}
      >
        <DialogTitle id={titleId}>{t('dialogs.duplicateField.title')}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 0.5 }}>
            <Box sx={formRowSx}>
              <TextField
                autoFocus
                label={t('dialogs.duplicateField.name')}
                margin="dense"
                sx={mediumFieldSx}
                required
                value={values.name}
                disabled={isSaving}
                error={nameTaken}
                helperText={nameTaken ? t('dialogs.duplicateField.nameTaken') : undefined}
                onChange={(event) => updateValues({ name: event.target.value })}
                slotProps={{ htmlInput: { maxLength: 200 } }}
              />
            </Box>

            {persistedBeds.length > 0 ? (
              <Box>
                <FormControlLabel
                  control={(
                    <Checkbox
                      checked={values.copyBeds}
                      disabled={isSaving}
                      onChange={(event) => updateValues({ copyBeds: event.target.checked })}
                    />
                  )}
                  label={t('dialogs.duplicateField.copyBeds', { total: persistedBeds.length })}
                />
                {values.copyBeds ? (
                  <Box sx={formRowSx}>
                    <TextField
                      label={t('dialogs.duplicateField.replaceSearch')}
                      margin="dense"
                      sx={smallFieldSx}
                      value={values.replaceSearch}
                      disabled={isSaving}
                      helperText={plan.searchNotFound ? t('dialogs.duplicateField.searchNotFound') : undefined}
                      onChange={(event) => updateValues({ replaceSearch: event.target.value })}
                      slotProps={{ htmlInput: { maxLength: 200 } }}
                    />
                    <TextField
                      label={t('dialogs.duplicateField.replaceWith')}
                      margin="dense"
                      sx={smallFieldSx}
                      value={values.replaceWith}
                      disabled={isSaving}
                      onChange={(event) => updateValues({ replaceWith: event.target.value })}
                      slotProps={{ htmlInput: { maxLength: 200 } }}
                    />
                  </Box>
                ) : null}
              </Box>
            ) : null}

            <Box component="section" aria-live="polite">
              <Typography variant="subtitle2" component="h3" sx={{ mb: 1 }}>
                {t('dialogs.duplicateField.previewSection')}
              </Typography>
              <Typography variant="body2">{previewParts.join(', ')}</Typography>
              {conflictingBedNames.length > 0 ? (
                <Alert severity="error" sx={{ mt: 1.5 }}>
                  {t('dialogs.duplicateField.bedNamesConflict', {
                    count: conflictingBedNames.length,
                    names: abbreviateNameList(conflictingBedNames).join(', '),
                  })}
                </Alert>
              ) : null}
              {plan.invalidBedNames.length > 0 ? (
                <Alert severity="error" sx={{ mt: 1.5 }}>
                  {t('dialogs.duplicateField.invalidBedNames', {
                    count: plan.invalidBedNames.length,
                    names: abbreviateNameList(plan.invalidBedNames).join(', '),
                  })}
                </Alert>
              ) : null}
            </Box>
            {submitError ? <Alert severity="error">{submitError}</Alert> : null}
          </Box>
        </DialogContent>
        <DialogActions>
          <DisabledActionTooltip title={isSaving ? t('common:disabledReasons.busy') : ''}>
            <Button type="button" onClick={handleClose} disabled={isSaving}>
              {t('common:actions.cancel')}
            </Button>
          </DisabledActionTooltip>
          <DisabledActionTooltip title={disabledReason}>
            <Button
              type="submit"
              variant="contained"
              disabled={!canSubmit}
              startIcon={isSaving ? <CircularProgress size={16} color="inherit" /> : undefined}
            >
              {t('dialogs.duplicateField.submit')}
            </Button>
          </DisabledActionTooltip>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
