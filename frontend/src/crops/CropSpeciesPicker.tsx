import { useCallback, useEffect, useRef, type RefObject } from 'react';
import {
  Autocomplete,
  Box,
  CircularProgress,
  createFilterOptions,
  TextField,
  Typography,
} from '@mui/material';

import type { CropSpecies } from '../api/types';
import { useTranslation } from '../i18n';
import {
  getCropSpeciesOptionLabel,
  getCropSpeciesSearchNames,
  hasStrongCropSpeciesIdentityMatch,
  isCropSpeciesSearchMatch,
} from './cropSpeciesMatching';

/**
 * Sentinel option that lets the user propose their own typed name as a new
 * crop species. It is appended to the species dropdown as the last entry
 * only when the typed value does not match any official species name,
 * synonym, or regional name. Matches must be explicit instead of silent:
 * if an alias made the canonical species appear, the option label includes it.
 *
 * Picking it does not talk to the server. It puts the picker into
 * "propose a new species" mode and reports the name through
 * `onProposalNameChange`; the owning dialog decides when the proposal is
 * actually filed — so a browsed-away dialog never leaves a stray proposal
 * behind.
 */
interface ProposeSpeciesOption {
  proposeName: string;
  /** Separates the action from the regular hits above it; false when it stands alone. */
  dividerAbove: boolean;
}

type SpeciesPickerOption = CropSpecies | ProposeSpeciesOption;

const isProposeSpeciesOption = (option: SpeciesPickerOption): option is ProposeSpeciesOption => (
  'proposeName' in option
);

const getCropSpeciesSearchText = (option: SpeciesPickerOption): string => {
  if (isProposeSpeciesOption(option)) {
    return option.proposeName;
  }
  return getCropSpeciesSearchNames(option).join(' ');
};

const getSpeciesPickerOptionLabel = (option: SpeciesPickerOption): string => (
  isProposeSpeciesOption(option) ? option.proposeName : getCropSpeciesOptionLabel(option)
);

const filterSpeciesOptions = createFilterOptions<SpeciesPickerOption>({
  stringify: getCropSpeciesSearchText,
});

export interface CropSpeciesPickerProps {
  /** Every selectable official species, already loaded (see `useCropSpeciesOptions`). */
  species: CropSpecies[];
  loading: boolean;
  value: CropSpecies | null;
  onChange: (species: CropSpecies | null) => void;
  inputValue: string;
  onInputValueChange: (value: string) => void;
  /**
   * The typed name while the user picked "propose as a new species", or null.
   * Owned by the caller so the same state can drive its submit button.
   */
  proposalName: string | null;
  onProposalNameChange: (name: string | null) => void;
  /** True while a proposal is being filed; keeps the option from firing twice. */
  proposing?: boolean;
  errorText?: string;
  label?: string;
  required?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
}

/**
 * The official crop species picker, shared by the publishing wizard and the
 * moderators' "Kulturart korrigieren" dialog — including its inline
 * "propose a new species" affordance, so both places search, match and propose
 * species in exactly the same way.
 */
export function CropSpeciesPicker({
  species,
  loading,
  value,
  onChange,
  inputValue,
  onInputValueChange,
  proposalName,
  onProposalNameChange,
  proposing = false,
  errorText,
  label,
  required = false,
  inputRef,
}: CropSpeciesPickerProps) {
  const { t } = useTranslation(['crops', 'common']);
  const highlightedOptionRef = useRef<SpeciesPickerOption | null>(null);
  // MUI fires the 'reset' input update in the same tick as onChange, before
  // React has re-rendered with the new prop, so that handler cannot read
  // `proposalName` from its closure. This mirror is written by the picker
  // itself the moment it reports a change, and follows the prop afterwards.
  const proposalNameRef = useRef<string | null>(proposalName);
  useEffect(() => {
    proposalNameRef.current = proposalName;
  }, [proposalName]);

  const reportProposalName = useCallback((name: string | null) => {
    proposalNameRef.current = name;
    onProposalNameChange(name);
  }, [onProposalNameChange]);

  const canUseProposalName = useCallback((name: string): boolean => {
    const trimmedName = name.trim();
    if (!trimmedName || loading) return false;
    return !hasStrongCropSpeciesIdentityMatch(
      trimmedName,
      species.map((option) => ({ searchNames: getCropSpeciesSearchNames(option) })),
    );
  }, [loading, species]);

  return (
    <Autocomplete<SpeciesPickerOption>
      options={species}
      value={value}
      inputValue={inputValue}
      loading={loading}
      getOptionLabel={getSpeciesPickerOptionLabel}
      isOptionEqualToValue={(option, optionValue) => (
        !isProposeSpeciesOption(option) && !isProposeSpeciesOption(optionValue) && option.id === optionValue.id
      )}
      getOptionDisabled={(option) => isProposeSpeciesOption(option) && proposing}
      filterOptions={(options, params) => {
        const baseFiltered = filterSpeciesOptions(options, params);
        const proposeName = params.inputValue.trim();
        const filteredIds = new Set(
          baseFiltered
            .filter((option): option is CropSpecies => !isProposeSpeciesOption(option))
            .map((option) => option.id),
        );
        const fuzzyMatches = proposeName
          ? options.filter((option): option is CropSpecies => (
            !isProposeSpeciesOption(option)
            && !filteredIds.has(option.id)
            && isCropSpeciesSearchMatch(proposeName, getCropSpeciesSearchNames(option))
          ))
          : [];
        const filtered = [...baseFiltered, ...fuzzyMatches];
        const hasStrongExistingSpeciesMatch = hasStrongCropSpeciesIdentityMatch(
          proposeName,
          options
            .filter((option): option is CropSpecies => !isProposeSpeciesOption(option))
            .map((option) => ({ searchNames: getCropSpeciesSearchNames(option) })),
        );
        if (!proposeName || loading || hasStrongExistingSpeciesMatch) {
          return filtered;
        }
        return [...filtered, { proposeName, dividerAbove: filtered.length > 0 }];
      }}
      renderOption={(props, option) => {
        const { key, ...optionProps } = props;
        if (isProposeSpeciesOption(option)) {
          return (
            <Box
              component="li"
              {...optionProps}
              key="propose-species"
              sx={{
                gap: 1,
                ...(option.dividerAbove
                  ? { borderTop: '1px solid', borderColor: 'divider' }
                  : {}),
              }}
            >
              <Typography variant="body2" color="primary.main" sx={{ fontWeight: 500 }}>
                {t('library.speciesPicker.proposeInline', { name: option.proposeName })}
              </Typography>
              {proposing ? <CircularProgress color="inherit" size={16} /> : null}
            </Box>
          );
        }
        return (
          <li {...optionProps} key={key}>
            {getCropSpeciesOptionLabel(option, inputValue)}
          </li>
        );
      }}
      onHighlightChange={(_, option) => {
        highlightedOptionRef.current = option;
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const highlightedOption = highlightedOptionRef.current;
        const nextProposalName = highlightedOption && isProposeSpeciesOption(highlightedOption)
          ? highlightedOption.proposeName
          : inputValue.trim();
        if (!canUseProposalName(nextProposalName)) return;

        reportProposalName(nextProposalName);
        onInputValueChange(nextProposalName);
      }}
      onChange={(_, option) => {
        if (option && isProposeSpeciesOption(option)) {
          // Deliberately no request here — see ProposeSpeciesOption.
          reportProposalName(option.proposeName);
          return;
        }
        onChange(option);
        reportProposalName(null);
      }}
      onInputChange={(_, nextValue, reason) => {
        // 'reset'/'blur' is MUI writing the picked option's label back into
        // the field right after onChange — not the user retyping,
        // so it must not undo the propose mode just entered. Picking
        // "propose as new species" clears the selected species (it isn't
        // a real CropSpecies), which makes this same update write an
        // empty label into the field; keep showing the proposed name
        // instead of letting that overwrite it.
        const pendingProposalName = proposalNameRef.current;
        if ((reason === 'reset' || reason === 'blur') && pendingProposalName) {
          onInputValueChange(pendingProposalName);
          return;
        }
        onInputValueChange(nextValue);
        if (reason !== 'reset') {
          reportProposalName(null);
        }
      }}
      noOptionsText={loading
        ? <Typography variant="body2" color="text.secondary">{t('common:loading')}</Typography>
        : t('library.speciesPicker.noOptions')}
      renderInput={(params) => (
        <TextField
          {...params}
          inputRef={inputRef}
          label={label ?? t('library.speciesPicker.label')}
          required={required}
          error={Boolean(errorText)}
          helperText={errorText || undefined}
          slotProps={{
            ...params.slotProps,

            input: {
              ...params.slotProps.input,
              endAdornment: (
                <>
                  {loading ? <CircularProgress color="inherit" size={20} /> : null}
                  {params.slotProps.input.endAdornment}
                </>
              ),
            }
          }}
        />
      )}
    />
  );
}
