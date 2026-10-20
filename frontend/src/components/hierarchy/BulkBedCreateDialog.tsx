import { useId, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react';
import axios from 'axios';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Link,
  Radio,
  RadioGroup,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import type { BulkBedCreatePayload } from '../../api/api';
import type { Bed, Field } from '../../api/types';
import { useTranslation } from '../../i18n';
import { compactFieldSx, formRowSx, mediumFieldSx } from '../forms/formLayout';
import { LocalizedDecimalField } from '../inputs/LocalizedDecimalField';
import { DisabledActionTooltip } from '../DisabledActionTooltip';
import { formatLocalizedNumber, getActiveFormattingLocale } from '../../utils/numberLocalization';
import { abbreviateNameList } from './utils/bedNaming';
import {
  changeBulkBedOrientation,
  evaluateBulkBedForm,
  getBulkBedAreaOverflow,
  getInitialBulkBedFormValues,
  hasBothFieldSides,
  suggestBulkBedCount,
  type BedOrientation,
  type BulkBedFieldError,
  type BulkBedFormValues,
} from './utils/bulkBedCreatePlan';

interface BulkBedCreateDialogProps {
  open: boolean;
  field: Field | null;
  /**
   * Beds of `field` in their current table order (the last one seeds the
   * dimensions and the first name). Defaults are read once on mount: mount
   * the dialog per opening.
   */
  fieldBeds: readonly Bed[];
  onClose: () => void;
  onCreate: (payload: BulkBedCreatePayload) => Promise<void>;
}

/** Three equal columns from `sm` up, stacked full width on phones. */
const dimensionsRowSx = {
  display: 'grid',
  gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' },
  columnGap: 1,
} as const;

const readTakenNames = (error: unknown): string[] | null => {
  if (!axios.isAxiosError(error)) {
    return null;
  }
  const takenNames = (error.response?.data as { taken_names?: unknown } | undefined)?.taken_names;
  return Array.isArray(takenNames) ? takenNames.filter((name): name is string => typeof name === 'string') : null;
};

export function BulkBedCreateDialog({
  open,
  field,
  fieldBeds,
  onClose,
  onCreate,
}: BulkBedCreateDialogProps): ReactElement {
  const { t } = useTranslation(['hierarchy', 'common']);
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const locale = getActiveFormattingLocale();
  const titleId = useId();
  const [values, setValues] = useState<BulkBedFormValues>(
    () => getInitialBulkBedFormValues(field, fieldBeds, t('dialogs.bulkCreateBeds.defaultFirstName')),
  );
  const [lengthEdited, setLengthEdited] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [serverTakenNames, setServerTakenNames] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false);

  const existingNames = useMemo(() => fieldBeds.map((bed) => bed.name), [fieldBeds]);
  const plan = useMemo(() => evaluateBulkBedForm(values, existingNames), [existingNames, values]);
  const suggestion = useMemo(() => suggestBulkBedCount(field, fieldBeds, values), [field, fieldBeds, values]);
  const takenNames = plan.takenNames.length > 0 ? plan.takenNames : serverTakenNames;
  const areaOverflow = field ? getBulkBedAreaOverflow(field, fieldBeds, plan.totalAreaSqm) : null;
  const canSubmit = plan.isComplete && takenNames.length === 0 && !isSaving;

  const formatNumber = (value: number): string => formatLocalizedNumber(value, locale, { maximumFractionDigits: 2 });

  const updateValues = (patch: Partial<BulkBedFormValues>): void => {
    setValues((previous) => ({ ...previous, ...patch }));
    setSubmitError('');
    setServerTakenNames([]);
  };

  const handleOrientationChange = (orientation: BedOrientation): void => {
    setValues((previous) => changeBulkBedOrientation(previous, field, orientation, lengthEdited));
    setSubmitError('');
  };

  const describeError = (error: BulkBedFieldError | undefined): string | undefined => {
    if (!error) return undefined;
    if (error.key === 'wholeNumber') return t('dialogs.bulkCreateBeds.wholeNumber', { min: error.min });
    if (error.key === 'tooMany') return t('dialogs.bulkCreateBeds.tooMany', { max: error.max });
    if (error.key === 'nonNegativeNumber') return t('dialogs.bulkCreateBeds.nonNegativeNumber');
    return t('dialogs.bulkCreateBeds.positiveNumber');
  };

  const describeSuggestion = (): string | null => {
    if (!suggestion) return null;
    if (suggestion.count <= 0) return t('dialogs.bulkCreateBeds.noSpaceLeft');
    const params = {
      count: suggestion.count,
      path: formatNumber(values.pathM ?? 0),
      side: formatNumber(suggestion.crossSideM),
    };
    if (suggestion.existingBedCount === 0) {
      return t('dialogs.bulkCreateBeds.suggestion', params);
    }
    return t('dialogs.bulkCreateBeds.suggestionRemaining', {
      ...params,
      existing: t('dialogs.bulkCreateBeds.existingBeds', { count: suggestion.existingBedCount }),
    });
  };
  const suggestionText = describeSuggestion();
  const applicableCount = suggestion && suggestion.count > 0 && String(suggestion.count) !== values.count.trim()
    ? suggestion.count
    : null;

  const handleClose = (): void => {
    if (!isSavingRef.current) {
      onClose();
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!field?.id || !canSubmit || isSavingRef.current) {
      return;
    }
    isSavingRef.current = true;
    setIsSaving(true);
    setSubmitError('');
    try {
      await onCreate({
        field: field.id,
        beds: plan.names.map((name) => ({ name, length_m: values.lengthM!, width_m: values.widthM! })),
      });
    } catch (error) {
      console.error('Error creating beds', error);
      const serverTaken = readTakenNames(error);
      if (serverTaken && serverTaken.length > 0) {
        setServerTakenNames(serverTaken);
      } else {
        setSubmitError(t('dialogs.bulkCreateBeds.saveError'));
      }
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  const previewNames = abbreviateNameList(plan.names);
  const disabledReason = isSaving
    ? t('common:disabledReasons.busy')
    : !plan.isComplete ? t('common:disabledReasons.requiredFields') : '';

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
        <DialogTitle id={titleId}>
          {t('dialogs.bulkCreateBeds.title', { field: field?.name ?? '' })}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, mt: 0.5 }}>
            <Box component="section">
              <Typography variant="subtitle2" component="h3" sx={{ mb: 1 }}>
                {t('dialogs.bulkCreateBeds.dimensionsSection')}
              </Typography>
              {hasBothFieldSides(field) ? (
                <RadioGroup
                  row
                  aria-label={t('dialogs.bulkCreateBeds.orientation')}
                  value={values.orientation}
                  onChange={(event) => handleOrientationChange(event.target.value as BedOrientation)}
                >
                  <FormControlLabel
                    value="length"
                    control={<Radio size="small" />}
                    label={t('dialogs.bulkCreateBeds.orientationLength')}
                    disabled={isSaving}
                    slotProps={{ typography: { variant: 'body2' } }}
                  />
                  <FormControlLabel
                    value="width"
                    control={<Radio size="small" />}
                    label={t('dialogs.bulkCreateBeds.orientationWidth')}
                    disabled={isSaving}
                    slotProps={{ typography: { variant: 'body2' } }}
                  />
                </RadioGroup>
              ) : null}
              <Box sx={dimensionsRowSx}>
                <LocalizedDecimalField
                  autoFocus
                  label={t('dialogs.bulkCreateBeds.length')}
                  margin="dense"
                  required
                  value={values.lengthM}
                  disabled={isSaving}
                  error={Boolean(plan.errors.lengthM)}
                  helperText={describeError(plan.errors.lengthM)}
                  onValueChange={(lengthM) => {
                    setLengthEdited(true);
                    updateValues({ lengthM });
                  }}
                />
                <LocalizedDecimalField
                  label={t('dialogs.bulkCreateBeds.width')}
                  margin="dense"
                  required
                  value={values.widthM}
                  disabled={isSaving}
                  error={Boolean(plan.errors.widthM)}
                  helperText={describeError(plan.errors.widthM)}
                  onValueChange={(widthM) => updateValues({ widthM })}
                />
                <LocalizedDecimalField
                  label={t('dialogs.bulkCreateBeds.pathWidth')}
                  margin="dense"
                  value={values.pathM}
                  disabled={isSaving}
                  error={Boolean(plan.errors.pathM)}
                  helperText={describeError(plan.errors.pathM) ?? t('dialogs.bulkCreateBeds.pathHelper')}
                  onValueChange={(pathM) => updateValues({ pathM })}
                />
              </Box>
            </Box>

            <Box component="section">
              <Typography variant="subtitle2" component="h3" sx={{ mb: 1 }}>
                {t('dialogs.bulkCreateBeds.countSection')}
              </Typography>
              <Box sx={formRowSx}>
                <TextField
                  label={t('dialogs.bulkCreateBeds.count')}
                  type="number"
                  margin="dense"
                  sx={compactFieldSx}
                  value={values.count}
                  required
                  disabled={isSaving}
                  error={Boolean(plan.errors.count)}
                  helperText={describeError(plan.errors.count)}
                  onChange={(event) => updateValues({ count: event.target.value })}
                  slotProps={{ htmlInput: { min: 1, step: 1, inputMode: 'numeric' } }}
                />
              </Box>
              {suggestionText ? (
                <Box
                  sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 2 }}
                  aria-live="polite"
                >
                  <Typography variant="body2" color="text.secondary">
                    {suggestionText}
                  </Typography>
                  {applicableCount !== null ? (
                    <Link
                      component="button"
                      type="button"
                      variant="body2"
                      disabled={isSaving}
                      sx={{ flexShrink: 0 }}
                      onClick={() => updateValues({ count: String(applicableCount) })}
                    >
                      {t('dialogs.bulkCreateBeds.applySuggestion', { count: applicableCount })}
                    </Link>
                  ) : null}
                </Box>
              ) : null}
            </Box>

            <Box component="section">
              <Typography variant="subtitle2" component="h3" sx={{ mb: 1 }}>
                {t('dialogs.bulkCreateBeds.namingSection')}
              </Typography>
              <Box sx={formRowSx}>
                <TextField
                  label={t('dialogs.bulkCreateBeds.firstName')}
                  margin="dense"
                  sx={mediumFieldSx}
                  required
                  value={values.firstName}
                  disabled={isSaving}
                  onChange={(event) => updateValues({ firstName: event.target.value })}
                  slotProps={{ htmlInput: { maxLength: 200 } }}
                />
              </Box>
            </Box>

            <Box component="section" aria-live="polite">
              <Typography variant="subtitle2" component="h3" sx={{ mb: 1 }}>
                {t('dialogs.bulkCreateBeds.previewSection')}
              </Typography>
              {plan.names.length > 0 ? (
                <>
                  <Box
                    component="ul"
                    aria-label={t('dialogs.bulkCreateBeds.previewList')}
                    // Names contain spaces ("E 1 1"), so a comma separates them.
                    sx={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      columnGap: 0.5,
                      listStyle: 'none',
                      p: 0,
                      m: 0,
                      '& > li:not(:last-of-type)::after': { content: '","' },
                    }}
                  >
                    {previewNames.map((name, index) => (
                      <Typography key={`${name}-${index}`} component="li" variant="body2">
                        {name}
                      </Typography>
                    ))}
                  </Box>
                  {plan.areaPerBedSqm !== null && plan.totalAreaSqm !== null ? (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                      {t('dialogs.bulkCreateBeds.summary', {
                        count: plan.names.length,
                        area: formatNumber(plan.areaPerBedSqm),
                        total: formatNumber(plan.totalAreaSqm),
                      })}
                    </Typography>
                  ) : null}
                </>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {t('dialogs.bulkCreateBeds.previewEmpty')}
                </Typography>
              )}
              {takenNames.length > 0 ? (
                <Alert severity="error" sx={{ mt: 1.5 }}>
                  {t('dialogs.bulkCreateBeds.namesTaken', {
                    count: takenNames.length,
                    names: abbreviateNameList(takenNames).join(', '),
                  })}
                </Alert>
              ) : null}
              {areaOverflow ? (
                <Alert severity="warning" sx={{ mt: 1.5 }}>
                  {t('dialogs.bulkCreateBeds.areaWarning', {
                    newArea: formatNumber(areaOverflow.newArea),
                    existingArea: formatNumber(areaOverflow.existingArea),
                    fieldArea: formatNumber(areaOverflow.fieldArea),
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
              {plan.names.length > 0
                ? t('dialogs.bulkCreateBeds.submitCount', { count: plan.names.length })
                : t('dialogs.bulkCreateBeds.submit')}
            </Button>
          </DisabledActionTooltip>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
