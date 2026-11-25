import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react';
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
import { layoutAPI } from '../../api/api';
import type { Bed, BedLayoutEntry, BulkBedCreatePayload, Field, Location } from '../../api/types';
import { useTranslation } from '../../i18n';
import { DEFAULT_GRAPHICAL_ROTATION, type GraphicalRotation } from '../../pages/graphicalLayoutUtils';
import { compactFieldSx, formRowSx, mediumFieldSx } from '../forms/formLayout';
import { LocalizedDecimalField } from '../inputs/LocalizedDecimalField';
import { DisabledActionTooltip } from '../DisabledActionTooltip';
import { formatLocalizedNumber, getActiveFormattingLocale } from '../../utils/numberLocalization';
import { abbreviateNameList } from './utils/bedNaming';
import { bedDimensionInputFormat, type BedDimensions } from './utils/bedDimensions';
import { BulkBedLayoutPreview } from './BulkBedLayoutPreview';
import { buildBulkBedPreview, getBulkBedPreviewContext } from './utils/bulkBedPreview';
import { getLocationPathSpacing } from './utils/locationPathSpacing';
import {
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
   * Beds of `field` in their current table order. The last bed supplies
   * fallback dimensions and the next name. Mount the dialog per opening.
   */
  fieldBeds: readonly Bed[];
  layoutBeds?: readonly Bed[];
  location?: Location;
  rotation?: GraphicalRotation;
  bedDefaults?: BedDimensions;
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
  layoutBeds = fieldBeds,
  location,
  rotation = DEFAULT_GRAPHICAL_ROTATION,
  bedDefaults,
  onClose,
  onCreate,
}: BulkBedCreateDialogProps): ReactElement {
  const { t } = useTranslation(['hierarchy', 'common']);
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const locale = getActiveFormattingLocale();
  const titleId = useId();
  const recommendedGapM = location ? getLocationPathSpacing(location).bed_path_spacing_cm / 100 : null;
  const [values, setValues] = useState<BulkBedFormValues>(
    () => getInitialBulkBedFormValues(
      field, fieldBeds, t('dialogs.bulkCreateBeds.defaultFirstName'), bedDefaults, recommendedGapM,
    ),
  );
  const [submitError, setSubmitError] = useState('');
  const [serverTakenNames, setServerTakenNames] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false);
  const locationId = hasBothFieldSides(field) ? location?.id : undefined;
  const [layoutAttempt, setLayoutAttempt] = useState(0);
  const [layoutResult, setLayoutResult] = useState<{
    locationId: number;
    attempt: number;
    layouts: Record<number, BedLayoutEntry> | null;
  }>();
  useEffect(() => {
    if (!open || locationId === undefined) return;
    let active = true;
    void layoutAPI.listByLocation(locationId).then(({ data }) => {
      if (active) setLayoutResult({ locationId, attempt: layoutAttempt,
        layouts: Object.fromEntries(data.bed_layouts.map(layout => [layout.bed, layout])) });
    }).catch(() => {
      if (active) setLayoutResult({ locationId, attempt: layoutAttempt, layouts: null });
    });
    return () => { active = false; };
  }, [layoutAttempt, locationId, open]);
  const currentLayout = layoutResult?.locationId === locationId && layoutResult?.attempt === layoutAttempt
    ? layoutResult.layouts : undefined;
  const layoutContext = useMemo(() => field && currentLayout
    ? getBulkBedPreviewContext(field, layoutBeds.filter(bed => bed.field === field.id && (bed.id ?? 0) > 0), currentLayout)
    : null, [field, layoutBeds, currentLayout]);

  const existingNames = useMemo(() => fieldBeds.map((bed) => bed.name), [fieldBeds]);
  const plan = useMemo(() => evaluateBulkBedForm(values, existingNames), [existingNames, values]);
  const preview = useMemo(() => layoutContext
    ? buildBulkBedPreview(layoutContext, values, plan.names, recommendedGapM ?? 0) : null,
  [layoutContext, values, plan.names, recommendedGapM]);
  const suggestion = useMemo(() => locationId === undefined
    ? suggestBulkBedCount(field, fieldBeds, values) : null, [field, fieldBeds, values, locationId]);
  const takenNames = plan.takenNames.length > 0 ? plan.takenNames : serverTakenNames;
  const areaOverflow = field && locationId === undefined
    ? getBulkBedAreaOverflow(field, fieldBeds, plan.totalAreaSqm) : null;
  const canSubmit = plan.isComplete && takenNames.length === 0 && !isSaving
    && (locationId === undefined || Boolean(preview));

  const formatNumber = (value: number): string => formatLocalizedNumber(value, locale, { maximumFractionDigits: 2 });

  const updateValues = (patch: Partial<BulkBedFormValues>): void => {
    setValues((previous) => ({ ...previous, ...patch }));
    setSubmitError('');
    setServerTakenNames([]);
  };

  const describeError = (error: BulkBedFieldError | undefined): string | undefined => {
    if (!error) return undefined;
    if (error.key === 'wholeNumber') return t('dialogs.bulkCreateBeds.wholeNumber', { min: error.min });
    if (error.key === 'tooMany') return t('dialogs.bulkCreateBeds.tooMany', { max: error.max });
    if (error.key === 'nonNegativeNumber') return t('dialogs.bulkCreateBeds.nonNegativeNumber');
    return t('dialogs.bulkCreateBeds.positiveNumber');
  };

  const describeSuggestion = (): string | null => {
    if (preview) return preview.insideCount > 0
      ? t('dialogs.bulkCreateBeds.layoutFits', { count: preview.insideCount })
      : t('dialogs.bulkCreateBeds.noSpaceLeft');
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
  const suggestedCount = preview?.insideCount ?? suggestion?.count ?? 0;
  const applicableCount = suggestedCount > 0 && String(suggestedCount) !== values.count.trim() ? suggestedCount : null;

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
        beds: plan.names.map((name, index) => ({
          name, length_m: values.lengthM!, width_m: values.widthM!,
          ...(preview ? { layout: preview.placements[index] } : {}),
        })),
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
                  onChange={(event) => updateValues({ orientation: event.target.value as BedOrientation })}
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
                  formatOptions={bedDimensionInputFormat}
                  disabled={isSaving}
                  error={Boolean(plan.errors.lengthM)}
                  helperText={describeError(plan.errors.lengthM)}
                  onValueChange={(lengthM) => updateValues({ lengthM })}
                  onInvalidValue={() => updateValues({ lengthM: Number.NaN })}
                />
                <LocalizedDecimalField
                  label={t('dialogs.bulkCreateBeds.width')}
                  margin="dense"
                  required
                  value={values.widthM}
                  formatOptions={bedDimensionInputFormat}
                  disabled={isSaving}
                  error={Boolean(plan.errors.widthM)}
                  helperText={describeError(plan.errors.widthM)}
                  onValueChange={(widthM) => updateValues({ widthM })}
                  onInvalidValue={() => updateValues({ widthM: Number.NaN })}
                />
                <LocalizedDecimalField
                  label={t('dialogs.bulkCreateBeds.pathWidth')}
                  margin="dense"
                  value={values.pathM}
                  formatOptions={bedDimensionInputFormat}
                  disabled={isSaving}
                  error={Boolean(plan.errors.pathM)}
                  helperText={describeError(plan.errors.pathM)}
                  onValueChange={(pathM) => updateValues({ pathM })}
                  onInvalidValue={() => updateValues({ pathM: Number.NaN })}
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
              {preview && plan.isComplete ? (
                <BulkBedLayoutPreview preview={preview} rotation={rotation} formatNumber={formatNumber} />
              ) : null}
              {locationId !== undefined && currentLayout === undefined ? (
                <Typography variant="body2" role="status" sx={{ mt: 1 }}>
                  {t('dialogs.bulkCreateBeds.loadingLayout')}
                </Typography>
              ) : null}
              {currentLayout === null ? (
                <Alert severity="error" sx={{ mt: 1 }} action={
                  <Button color="inherit" onClick={() => setLayoutAttempt(attempt => attempt + 1)}>
                    {t('common:runtime.retryAction')}
                  </Button>
                }>{t('dialogs.bulkCreateBeds.loadLayoutError')}</Alert>
              ) : null}
              {location && locationId === undefined ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  {t('dialogs.bulkCreateBeds.missingParcelDimensions')}
                </Typography>
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
