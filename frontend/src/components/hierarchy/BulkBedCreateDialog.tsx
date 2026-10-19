import { useId, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react';
import axios from 'axios';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Collapse,
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
} from '@mui/material';
import type { BulkBedCreatePayload } from '../../api/api';
import type { Bed, Field } from '../../api/types';
import { useTranslation } from '../../i18n';
import { compactFieldSx, formRowSx, mediumFieldSx } from '../forms/formLayout';
import { LocalizedDecimalField } from '../inputs/LocalizedDecimalField';
import { DisabledActionTooltip } from '../DisabledActionTooltip';
import { formatLocalizedNumber, getActiveFormattingLocale } from '../../utils/numberLocalization';
import { abbreviateNameList, suggestBedCountAcrossWidth } from './utils/bedNaming';
import {
  evaluateBulkBedForm,
  getBulkBedAreaOverflow,
  getInitialBulkBedFormValues,
  type BulkBedFieldError,
  type BulkBedFormField,
  type BulkBedFormValues,
} from './utils/bulkBedCreatePlan';

interface BulkBedCreateDialogProps {
  open: boolean;
  field: Field | null;
  /**
   * Beds of `field` in their current table order (the last one seeds the
   * dimensions). Defaults are read once on mount: mount the dialog per opening.
   */
  fieldBeds: readonly Bed[];
  onClose: () => void;
  onCreate: (payload: BulkBedCreatePayload) => Promise<void>;
}

type WholeNumberField = Exclude<BulkBedFormField, 'lengthM' | 'widthM'>;

const hasFieldDimensions = (field: Field | null): field is Field & { length_m: number; width_m: number } => (
  typeof field?.length_m === 'number'
  && typeof field.width_m === 'number'
  && field.length_m > 0
  && field.width_m > 0
);

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
  const locale = getActiveFormattingLocale();
  const titleId = useId();
  const [values, setValues] = useState<BulkBedFormValues>(() => getInitialBulkBedFormValues(fieldBeds));
  const [isCalculatorOpen, setIsCalculatorOpen] = useState(false);
  const [pathWidthM, setPathWidthM] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState('');
  const [serverTakenNames, setServerTakenNames] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false);

  const existingNames = useMemo(() => fieldBeds.map((bed) => bed.name), [fieldBeds]);
  const plan = useMemo(() => evaluateBulkBedForm(values, existingNames), [existingNames, values]);
  const takenNames = plan.takenNames.length > 0 ? plan.takenNames : serverTakenNames;
  const areaOverflow = field ? getBulkBedAreaOverflow(field, fieldBeds, plan.totalAreaSqm) : null;
  const canSubmit = plan.isComplete && plan.names.length > 0 && takenNames.length === 0 && !isSaving;

  const formatNumber = (value: number): string => formatLocalizedNumber(value, locale, { maximumFractionDigits: 2 });

  const suggestedCount = hasFieldDimensions(field) && values.widthM !== null && values.widthM > 0
    ? suggestBedCountAcrossWidth(field.width_m, values.widthM, pathWidthM ?? 0)
    : null;

  const updateValues = (patch: Partial<BulkBedFormValues>): void => {
    setValues((previous) => ({ ...previous, ...patch }));
    setSubmitError('');
    setServerTakenNames([]);
  };

  const describeError = (error: BulkBedFieldError | undefined): string | undefined => {
    if (!error) return undefined;
    if (error.key === 'wholeNumber') return t('dialogs.bulkCreateBeds.wholeNumber', { min: error.min });
    if (error.key === 'tooMany') return t('dialogs.bulkCreateBeds.tooMany', { max: error.max });
    return t('dialogs.bulkCreateBeds.positiveNumber');
  };

  const renderWholeNumberField = (name: WholeNumberField, labelKey: string, min: number): ReactElement => (
    <TextField
      label={t(`dialogs.bulkCreateBeds.${labelKey}`)}
      type="number"
      margin="dense"
      sx={compactFieldSx}
      value={values[name]}
      required={name === 'count' || name === 'bedsPerRow' || name === 'rows'}
      disabled={isSaving}
      error={Boolean(plan.errors[name])}
      helperText={describeError(plan.errors[name])}
      onChange={(event) => updateValues({ [name]: event.target.value } as Partial<BulkBedFormValues>)}
      slotProps={{ htmlInput: { min, step: 1, inputMode: 'numeric' } }}
    />
  );

  const handleApplySuggestedCount = (): void => {
    if (!hasFieldDimensions(field) || suggestedCount === null) {
      return;
    }
    updateValues({
      ...(values.mode === 'sequential' ? { count: String(suggestedCount) } : { bedsPerRow: String(suggestedCount) }),
      ...(values.lengthM === null ? { lengthM: field.length_m } : {}),
    });
  };

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
    : !plan.isComplete || plan.names.length === 0 ? t('common:disabledReasons.requiredFields') : '';

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm" aria-labelledby={titleId}>
      <Box component="form" noValidate onSubmit={(event) => { void handleSubmit(event); }}>
        <DialogTitle id={titleId}>
          {t('dialogs.bulkCreateBeds.title', { field: field?.name ?? '' })}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, mt: 0.5 }}>
            <Box component="section">
              <Typography variant="subtitle2" component="h3" sx={{ mb: 1 }}>
                {t('dialogs.bulkCreateBeds.namingSection')}
              </Typography>
              <RadioGroup
                row
                value={values.mode}
                onChange={(event) => updateValues({ mode: event.target.value as BulkBedFormValues['mode'] })}
              >
                <FormControlLabel
                  value="sequential"
                  control={<Radio size="small" />}
                  label={t('dialogs.bulkCreateBeds.namingSequential')}
                  disabled={isSaving}
                />
                <FormControlLabel
                  value="rowBed"
                  control={<Radio size="small" />}
                  label={t('dialogs.bulkCreateBeds.namingRowBed')}
                  disabled={isSaving}
                />
              </RadioGroup>
              <Box sx={formRowSx}>
                <TextField
                  autoFocus
                  label={t('dialogs.bulkCreateBeds.prefix')}
                  margin="dense"
                  sx={mediumFieldSx}
                  value={values.prefix}
                  disabled={isSaving}
                  onChange={(event) => updateValues({ prefix: event.target.value })}
                />
              </Box>
              {values.mode === 'sequential' ? (
                <Box sx={formRowSx}>
                  {renderWholeNumberField('start', 'startNumber', 0)}
                  {renderWholeNumberField('count', 'count', 1)}
                </Box>
              ) : (
                <Box sx={formRowSx}>
                  {renderWholeNumberField('rows', 'rowCount', 1)}
                  {renderWholeNumberField('bedsPerRow', 'bedsPerRow', 1)}
                  {renderWholeNumberField('firstRow', 'firstRow', 0)}
                  {renderWholeNumberField('firstBed', 'firstBed', 0)}
                </Box>
              )}
            </Box>

            <Box component="section">
              <Typography variant="subtitle2" component="h3" sx={{ mb: 1 }}>
                {t('dialogs.bulkCreateBeds.dimensionsSection')}
              </Typography>
              <Box sx={formRowSx}>
                <LocalizedDecimalField
                  label={t('dialogs.bulkCreateBeds.length')}
                  margin="dense"
                  sx={compactFieldSx}
                  required
                  value={values.lengthM}
                  disabled={isSaving}
                  error={Boolean(plan.errors.lengthM)}
                  helperText={describeError(plan.errors.lengthM)}
                  onValueChange={(lengthM) => updateValues({ lengthM })}
                />
                <LocalizedDecimalField
                  label={t('dialogs.bulkCreateBeds.width')}
                  margin="dense"
                  sx={compactFieldSx}
                  required
                  value={values.widthM}
                  disabled={isSaving}
                  error={Boolean(plan.errors.widthM)}
                  helperText={describeError(plan.errors.widthM)}
                  onValueChange={(widthM) => updateValues({ widthM })}
                />
              </Box>
              {hasFieldDimensions(field) ? (
                <>
                  <Link
                    component="button"
                    type="button"
                    variant="body2"
                    aria-expanded={isCalculatorOpen}
                    onClick={() => setIsCalculatorOpen((value) => !value)}
                    sx={{ mt: 1 }}
                  >
                    {t('dialogs.bulkCreateBeds.calculatorToggle')}
                  </Link>
                  <Collapse in={isCalculatorOpen} unmountOnExit>
                    <Box sx={{ mt: 1 }}>
                      <Typography variant="body2" color="text.secondary">
                        {t('dialogs.bulkCreateBeds.calculatorHint')}
                      </Typography>
                      <Box sx={{ ...formRowSx, alignItems: 'center' }}>
                        <LocalizedDecimalField
                          label={t('dialogs.bulkCreateBeds.pathWidth')}
                          margin="dense"
                          sx={compactFieldSx}
                          value={pathWidthM}
                          disabled={isSaving}
                          error={pathWidthM !== null && pathWidthM < 0}
                          helperText={pathWidthM !== null && pathWidthM < 0 ? t('dialogs.bulkCreateBeds.nonNegativeNumber') : undefined}
                          onValueChange={setPathWidthM}
                        />
                        <Button
                          type="button"
                          variant="outlined"
                          disabled={isSaving || !suggestedCount}
                          onClick={handleApplySuggestedCount}
                        >
                          {t('dialogs.bulkCreateBeds.applyCount')}
                        </Button>
                      </Box>
                      {suggestedCount !== null ? (
                        <Typography variant="body2" sx={{ mt: 0.5 }}>
                          {t('dialogs.bulkCreateBeds.suggestion', {
                            count: suggestedCount,
                            width: formatNumber(field.width_m),
                          })}
                        </Typography>
                      ) : null}
                    </Box>
                  </Collapse>
                </>
              ) : null}
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
