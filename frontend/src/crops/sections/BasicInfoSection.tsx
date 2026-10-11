/**
 * BasicInfoSection: Name, Variety, Crop Family, Nutrient Demand
 */
import { useCallback, useMemo, type ReactNode } from 'react';
import { Autocomplete, Box, CircularProgress, TextField, FormControl, InputLabel, MenuItem, Typography } from '@mui/material';
import { createFilterOptions } from '@mui/material/Autocomplete';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import type { AutocompleteChangeReason } from '@mui/material/Autocomplete';
import { fieldRowSx, mediumFieldSx, smallFieldSx } from './styles.tsx';
import type { Crop, PlantFamily } from '../../api/types';
import type { TFunction } from 'i18next';
import { AppTooltip } from '../../components/AppTooltip';
import { TypeaheadSelect as Select } from '../../components/inputs/TypeaheadSelect';
import { VarietyFieldTooltip } from '../VarietyFieldTooltip';
import type { GetVarietyFieldTooltipProps } from '../varietyFieldTooltipHelpers';
import { mergeVarietyFieldSx } from '../varietyValueAccent';
import type { PublicCropSpeciesOption } from '../publicCropNameSuggestions';
import { CropSpeciesOptionContent } from '../CropSpeciesOptionContent';
import { usePlantFamilies } from '../plantFamilies';

interface BasicInfoSectionProps {
  formData: Partial<Crop>;
  errors: Record<string, string>;
  onChange: <K extends keyof Crop>(name: K, value: Crop[K]) => void;
  t: TFunction;
  identityHint?: ReactNode;
  showIdentityFields?: boolean;
  showVarietyField?: boolean;
  /** Whether the variety field is a required input. False for the public-library admin edit form, where a blank variety marks the species-level ("general crop") entry. */
  varietyRequired?: boolean;
  varietyReadOnly?: boolean;
  showFirstVarietyField?: boolean;
  firstVarietyName?: string;
  onFirstVarietyNameChange?: (value: string) => void;
  /**
   * Variety suggestions for the optional first variety of a brand-new crop.
   * Same source as `varietyOptions`; empty until the Name field matches a
   * public crop species, which keeps the field free text otherwise.
   */
  firstVarietyOptions?: string[];
  firstVarietyOptionsLoading?: boolean;
  onFirstVarietyCommit?: (variety: string, reason?: AutocompleteChangeReason) => void;
  /** Explicit "apply library values" offer for first-variety free text matching a suggestion exactly. */
  firstVarietyApplyHint?: ReactNode;
  /** Shown once a library entry got linked to the first variety (dropdown pick or explicit apply). */
  firstVarietySourceHint?: ReactNode;
  /** Shown when the typed crop name already exists as a private crop. */
  existingCropHint?: ReactNode;
  /** Deduplicated crop-species-level name suggestions (never "Species · Variety" combinations). */
  nameOptions?: PublicCropSpeciesOption[];
  nameOptionsLoading?: boolean;
  onNameSearchChange?: (value: string) => void;
  onNameOptionSelect?: (option: PublicCropSpeciesOption | null) => void;
  /** Explicit "apply library values" offer for Name free text matching a suggestion exactly. */
  nameApplyHint?: ReactNode;
  /** Variety suggestions for the crop species currently matched in the Name field; empty otherwise. */
  varietyOptions?: string[];
  varietyOptionsLoading?: boolean;
  onVarietyCommit?: (variety: string, reason?: AutocompleteChangeReason) => void;
  /** Explicit "apply library values" offer for Variety free text matching a suggestion exactly. */
  varietyApplyHint?: ReactNode;
  /** Optional control rendered directly below the Name/Sorte identity row. */
  identityRowControl?: ReactNode;
  getFieldTooltipProps?: GetVarietyFieldTooltipProps;
  /**
   * Render the species-invariant crop-rotation fields (crop family, nutrient
   * demand, rotation break) read-only and show an info icon next to the section
   * heading. Set for a Sorte linked to a crop species: those three fields
   * describe the crop species and are edited only on the general Kultur.
   */
  speciesInvariantFieldsReadOnly?: boolean;
}

const identityRowSx = {
  display: 'grid',
  gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 3fr) minmax(0, 2fr)' },
  gap: 1,
  alignItems: 'flex-start',
} as const;

const identityFieldSx = {
  width: '100%',
  maxWidth: '100%',
  minWidth: 0,
} as const;

/** A family key the list does not (yet) contain, shown as its botanical name. */
function unlistedPlantFamily(botanicalName: string): PlantFamily {
  return {
    botanical_name: botanicalName,
    display_name: botanicalName,
    translations: {},
    default_rotation_break_years: null,
  };
}

export function BasicInfoSection({
  formData,
  errors,
  onChange,
  t,
  identityHint,
  showIdentityFields = true,
  showVarietyField = true,
  varietyRequired = true,
  varietyReadOnly = false,
  showFirstVarietyField = false,
  firstVarietyName,
  onFirstVarietyNameChange,
  firstVarietyOptions,
  firstVarietyOptionsLoading = false,
  onFirstVarietyCommit,
  firstVarietyApplyHint,
  firstVarietySourceHint,
  existingCropHint,
  nameOptions,
  nameOptionsLoading = false,
  onNameSearchChange,
  onNameOptionSelect,
  nameApplyHint,
  varietyOptions,
  varietyOptionsLoading = false,
  onVarietyCommit,
  varietyApplyHint,
  identityRowControl,
  getFieldTooltipProps,
  speciesInvariantFieldsReadOnly = false,
}: BasicInfoSectionProps) {
  const nameAutocomplete = nameOptions && onNameSearchChange && onNameOptionSelect
    ? {
      options: nameOptions,
      onSearchChange: onNameSearchChange,
      onSelect: onNameOptionSelect,
    }
    : null;
  const varietyAutocomplete = varietyOptions && onVarietyCommit
    ? { options: varietyOptions, onCommit: onVarietyCommit }
    : null;
  const firstVarietyAutocomplete = firstVarietyOptions && onFirstVarietyCommit
    ? { options: firstVarietyOptions, onCommit: onFirstVarietyCommit }
    : null;
  const plantFamilies = usePlantFamilies();
  const getPlantFamilyLabel = useCallback(
    (family: PlantFamily) => plantFamilies.getName(family.botanical_name),
    [plantFamilies],
  );
  const plantFamilyFilter = useMemo(() => createFilterOptions<PlantFamily>({
    stringify: (family) => `${plantFamilies.getName(family.botanical_name)} ${family.botanical_name}`,
  }), [plantFamilies]);
  const selectedFamily = formData.crop_family
    ? plantFamilies.getFamily(formData.crop_family) ?? unlistedPlantFamily(formData.crop_family)
    : null;
  const legacyCropFamily = !formData.crop_family ? formData.legacy_crop_family?.trim() : '';
  const familyDefaultBreakYears = formData.rotation_break_years === null || formData.rotation_break_years === undefined
    ? plantFamilies.getDefaultBreakYears(formData.crop_family)
    : null;
  const rotationBreakDefaultHint = familyDefaultBreakYears !== null
    ? t('form.rotationBreakYearsFamilyDefault', {
      family: plantFamilies.getName(formData.crop_family),
      count: familyDefaultBreakYears,
    })
    : null;
  const cropFamilyVariety = getFieldTooltipProps?.('crop_family');
  const nutrientDemandVariety = getFieldTooltipProps?.('nutrient_demand');
  const rotationBreakYearsVariety = getFieldTooltipProps?.('rotation_break_years');

  return (
    <>
      {showIdentityFields || showVarietyField ? (
        <Box sx={identityRowSx}>
          {showIdentityFields ? (
            nameAutocomplete ? (
              <Autocomplete<PublicCropSpeciesOption, false, false, true>
                freeSolo
                clearOnBlur={false}
                options={nameAutocomplete.options}
                value={formData.name ?? ''}
                inputValue={formData.name ?? ''}
                loading={nameOptionsLoading}
                getOptionLabel={(option) => (typeof option === 'string' ? option : option.name)}
                isOptionEqualToValue={(option, value) => typeof value !== 'string' && option.key === value.key}
                filterOptions={(options) => options}
                groupBy={() => t('form.publicCropSuggestionsGroupLabel')}
                onInputChange={(_, value, reason) => {
                  if (reason === 'reset') {
                    return;
                  }
                  nameAutocomplete.onSearchChange(value);
                  onChange('name', value);
                  nameAutocomplete.onSelect(null);
                }}
                onChange={(_, value) => {
                  if (typeof value === 'string') {
                    onChange('name', value);
                    nameAutocomplete.onSelect(null);
                    return;
                  }
                  if (value) {
                    onChange('name', value.canonicalName);
                    nameAutocomplete.onSelect(value);
                    return;
                  }
                  onChange('name', '');
                  nameAutocomplete.onSelect(null);
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    sx={identityFieldSx}
                    required
                    label={t('form.name')}
                    placeholder={t('form.namePlaceholder')}
                    error={Boolean(errors.name)}
                    helperText={errors.name || t('form.publicCropAutocompleteHelp')}
                    slotProps={{
                      ...params.slotProps,

                      htmlInput: { ...params.slotProps.htmlInput, maxLength: 200 },

                      input: {
                        ...params.slotProps.input,
                        endAdornment: (
                          <>
                            {nameOptionsLoading ? <CircularProgress color="inherit" size={20} /> : null}
                            {params.slotProps.input.endAdornment}
                          </>
                        ),
                      }
                    }} />
                )}
              />
            ) : (
            <TextField
              sx={identityFieldSx}
              required
              label={t('form.name')}
              placeholder={t('form.namePlaceholder')}
              value={formData.name}
              onChange={e => onChange('name', e.target.value)}
              error={Boolean(errors.name)}
              helperText={errors.name}
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
          )
          ) : null}
          {showVarietyField ? (
            varietyAutocomplete ? (
              <Autocomplete<string, false, false, true>
                disabled={varietyReadOnly}
                freeSolo
                clearOnBlur={false}
                options={varietyAutocomplete.options}
                value={formData.variety ?? ''}
                inputValue={formData.variety ?? ''}
                loading={varietyOptionsLoading}
                groupBy={() => t('form.publicCropSuggestionsGroupLabel')}
                onInputChange={(_, value, reason) => {
                  if (reason === 'reset') {
                    return;
                  }
                  onChange('variety', value);
                }}
                onChange={(_, value, reason) => {
                  varietyAutocomplete.onCommit(value ?? '', reason);
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    sx={identityFieldSx}
                    required={varietyRequired}
                    label={t('form.variety')}
                    placeholder={t('form.varietyPlaceholder')}
                    error={Boolean(errors.variety)}
                    helperText={errors.variety}
                    slotProps={{
                      ...params.slotProps,

                      htmlInput: { ...params.slotProps.htmlInput, maxLength: 200 },

                      input: {
                        ...params.slotProps.input,
                        endAdornment: (
                          <>
                            {varietyOptionsLoading ? <CircularProgress color="inherit" size={20} /> : null}
                            {params.slotProps.input.endAdornment}
                          </>
                        ),
                      }
                    }} />
                )}
              />
            ) : (
              <TextField
                sx={identityFieldSx}
                disabled={varietyReadOnly}
                required={varietyRequired}
                label={t('form.variety')}
                placeholder={t('form.varietyPlaceholder')}
                value={formData.variety}
                onChange={e => onChange('variety', e.target.value)}
                error={Boolean(errors.variety)}
                helperText={errors.variety}
                slotProps={{ htmlInput: { maxLength: 200 } }}
              />
            )
          ) : null}
          {!showVarietyField && showFirstVarietyField ? (
            firstVarietyAutocomplete ? (
              <Autocomplete<string, false, false, true>
                freeSolo
                clearOnBlur={false}
                options={firstVarietyAutocomplete.options}
                value={firstVarietyName ?? ''}
                inputValue={firstVarietyName ?? ''}
                loading={firstVarietyOptionsLoading}
                groupBy={() => t('form.publicCropSuggestionsGroupLabel')}
                onInputChange={(_, value, reason) => {
                  if (reason === 'reset') {
                    return;
                  }
                  onFirstVarietyNameChange?.(value);
                }}
                onChange={(_, value, reason) => {
                  firstVarietyAutocomplete.onCommit(value ?? '', reason);
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    sx={identityFieldSx}
                    label={t('form.firstVarietyLabel')}
                    placeholder={t('form.firstVarietyPlaceholder')}
                    helperText={t('form.firstVarietyHelperText')}
                    slotProps={{
                      ...params.slotProps,

                      htmlInput: { ...params.slotProps.htmlInput, maxLength: 200 },

                      input: {
                        ...params.slotProps.input,
                        endAdornment: (
                          <>
                            {firstVarietyOptionsLoading ? <CircularProgress color="inherit" size={20} /> : null}
                            {params.slotProps.input.endAdornment}
                          </>
                        ),
                      }
                    }} />
                )}
              />
            ) : (
              <TextField
                sx={identityFieldSx}
                label={t('form.firstVarietyLabel')}
                placeholder={t('form.firstVarietyPlaceholder')}
                value={firstVarietyName ?? ''}
                onChange={e => onFirstVarietyNameChange?.(e.target.value)}
                helperText={t('form.firstVarietyHelperText')}
                slotProps={{ htmlInput: { maxLength: 200 } }}
              />
            )
          ) : null}
        </Box>
      ) : null}
      {identityRowControl}
      {nameApplyHint || varietyApplyHint ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {nameApplyHint}
          {varietyApplyHint}
        </Box>
      ) : null}
      {showFirstVarietyField && existingCropHint ? (
        <Box sx={fieldRowSx}>{existingCropHint}</Box>
      ) : null}
      {showFirstVarietyField && firstVarietyApplyHint ? (
        <Box sx={fieldRowSx}>{firstVarietyApplyHint}</Box>
      ) : null}
      {showFirstVarietyField && firstVarietySourceHint ? (
        <Box sx={fieldRowSx}>{firstVarietySourceHint}</Box>
      ) : null}
      {identityHint}
      {/* The heading is inline and the info icon follows it in an unbreakable
          span (a line may otherwise break before an inline-flex box despite the
          no-break space): on a narrow phone the heading wraps at its hyphen and
          the icon stays beside the last word instead of drifting to the right
          edge or onto a line of its own. The icon stays outside the heading's
          accessible name. */}
      <Box sx={{ mt: 2, typography: 'h6' }}>
        <Typography variant="h6" sx={{ display: 'inline' }}>{t('form.sectionCropRotation')}</Typography>
        {speciesInvariantFieldsReadOnly ? (
          <Box component="span" sx={{ whiteSpace: 'nowrap' }}>
            {'\u00A0'}
            <AppTooltip title={t('form.cropRotationInheritedTooltip')}>
              <Box
                component="span"
                tabIndex={0}
                aria-label={t('form.cropRotationInheritedTooltip')}
                sx={{
                  display: 'inline-flex',
                  verticalAlign: 'middle',
                  color: 'text.secondary',
                  cursor: 'help',
                  borderRadius: '50%',
                  '&:focus-visible': { outline: (theme) => `2px solid ${theme.palette.primary.main}` },
                }}
              >
                <InfoOutlinedIcon fontSize="small" />
              </Box>
            </AppTooltip>
          </Box>
        ) : null}
      </Box>
      <Box sx={fieldRowSx}>
        <VarietyFieldTooltip tooltipTitle={cropFamilyVariety?.tooltipTitle}>
          <Autocomplete<PlantFamily, false, false, false>
            sx={mergeVarietyFieldSx(mediumFieldSx, cropFamilyVariety?.sx)}
            options={plantFamilies.families}
            value={selectedFamily}
            onChange={(_, family) => onChange('crop_family', family?.botanical_name ?? null)}
            getOptionLabel={getPlantFamilyLabel}
            isOptionEqualToValue={(option, value) => option.botanical_name === value.botanical_name}
            filterOptions={plantFamilyFilter}
            noOptionsText={t('form.cropFamilyNoOptions')}
            loading={!plantFamilies.loaded}
            disabled={speciesInvariantFieldsReadOnly}
            renderOption={({ key, ...optionProps }, family) => (
              <li key={key} {...optionProps}>
                <CropSpeciesOptionContent
                  officialName={plantFamilies.getName(family.botanical_name)}
                  scientificName={family.botanical_name}
                  match={null}
                  query=""
                />
              </li>
            )}
            renderInput={(params) => (
              <TextField
                {...params}
                label={t('form.cropFamily')}
                placeholder={t('form.cropFamilyPlaceholder')}
                helperText={legacyCropFamily ? t('form.cropFamilyLegacyHint', { value: legacyCropFamily }) : undefined}
              />
            )}
          />
        </VarietyFieldTooltip>
        <VarietyFieldTooltip tooltipTitle={nutrientDemandVariety?.tooltipTitle}>
          <FormControl
            sx={mergeVarietyFieldSx(smallFieldSx, nutrientDemandVariety?.sx)}
            disabled={speciesInvariantFieldsReadOnly}
          >
            <InputLabel>{t('form.nutrientDemand')}</InputLabel>
            <Select
              fullWidth
              value={formData.nutrient_demand || ''}
              onChange={e => onChange('nutrient_demand', e.target.value)}
              label={t('form.nutrientDemand')}
              disabled={speciesInvariantFieldsReadOnly}
            >
              <MenuItem value="">{t('noData')}</MenuItem>
              <MenuItem value="low">{t('form.nutrientDemandLow')}</MenuItem>
              <MenuItem value="medium">{t('form.nutrientDemandMedium')}</MenuItem>
              <MenuItem value="high">{t('form.nutrientDemandHigh')}</MenuItem>
            </Select>
          </FormControl>
        </VarietyFieldTooltip>
        <VarietyFieldTooltip tooltipTitle={rotationBreakYearsVariety?.tooltipTitle}>
          <TextField
            type="number"
            sx={mergeVarietyFieldSx(smallFieldSx, rotationBreakYearsVariety?.sx)}
            label={t('form.rotationBreakYears')}
            value={formData.rotation_break_years ?? ''}
            onChange={e => onChange('rotation_break_years', e.target.value === '' ? null : parseInt(e.target.value, 10))}
            placeholder={familyDefaultBreakYears !== null ? String(familyDefaultBreakYears) : undefined}
            helperText={(
              <>
                {rotationBreakDefaultHint ? (
                  <Box component="span" sx={{ display: 'block' }}>{rotationBreakDefaultHint}</Box>
                ) : null}
                {t('form.rotationBreakYearsHelper')}
              </>
            )}
            slotProps={{
              htmlInput: { min: 0, inputMode: 'numeric' },
              inputLabel: familyDefaultBreakYears !== null ? { shrink: true } : undefined,
            }}
            disabled={speciesInvariantFieldsReadOnly}
          />
        </VarietyFieldTooltip>
      </Box>
    </>
  );
}
