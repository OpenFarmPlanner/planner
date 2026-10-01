import { useCallback, useEffect, useRef, type RefObject } from 'react';
import {
  Autocomplete,
  Box,
  CircularProgress,
  TextField,
  Typography,
} from '@mui/material';

import type { CropSpecies } from '../api/types';
import { useTranslation } from '../i18n';
import i18n from '../i18n/config';
import { CropSpeciesOptionContent } from './CropSpeciesOptionContent';
import {
  CROP_SPECIES_MATCH_SOURCE_ORDER,
  getCropSpeciesCanonicalName,
  getCropSpeciesOptionLabel,
  getCropSpeciesResultLabel,
  getCropSpeciesSearchMatch,
  getCropSpeciesSearchNames,
  hasStrongCropSpeciesIdentityMatch,
  normalizeCropSpeciesSearchValue,
} from './cropSpeciesMatching';

/**
 * Sentinel option that lets the user propose their own typed name as a new
 * crop species. It is appended to the species dropdown as the last entry
 * only when the typed value does not match any official species name,
 * synonym, or regional name. Matches must be explicit instead of silent:
 * every option says why it matched (`CropSpeciesOptionContent`).
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

const getSpeciesPickerOptionLabel = (option: SpeciesPickerOption): string => (
  isProposeSpeciesOption(option) ? option.proposeName : getCropSpeciesOptionLabel(option)
);

/** Options matching `searchValue`, ordered official name → synonym → botanical → similar name. */
const rankSpeciesOptions = (
  options: CropSpecies[],
  searchValue: string,
  getOfficialName: (option: CropSpecies) => string,
): CropSpecies[] => {
  if (!searchValue) return options;
  return options
    .flatMap((option) => {
      const match = getCropSpeciesSearchMatch(option, searchValue, getOfficialName(option));
      return match ? [{ option, order: CROP_SPECIES_MATCH_SOURCE_ORDER.indexOf(match.source) }] : [];
    })
    .sort((left, right) => left.order - right.order)
    .map((item) => item.option);
};

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
  /**
   * The user's own crop name. When the selected species is listed under a
   * different name, the helper text confirms which name gets published.
   */
  localCropName?: string;
  errorText?: string;
  label?: string;
  required?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  /**
   * True when `species` is already a ranked, server-searched result set
   * (see `useCropSpeciesSearch`) rather than the full catalogue loaded once
   * for client-side filtering. In that mode the picker trusts the given
   * order/set as-is instead of re-filtering it locally, lists each option
   * under `getCropSpeciesResultLabel` (UI-language canonical name) instead of
   * the canonical `name`, and explains the match with the server's
   * `search_match`. Used by the publishing wizard's "Offizielle Kulturart"
   * field; the moderators' relink dialog keeps the default client-filtered
   * full-list mode.
   */
  serverSearched?: boolean;
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
  localCropName,
  errorText,
  label,
  required = false,
  inputRef,
  serverSearched = false,
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

  const uiLanguage = i18n.resolvedLanguage ?? i18n.language;
  const getOfficialName = useCallback((option: CropSpecies): string => (
    serverSearched
      ? getCropSpeciesResultLabel(option, uiLanguage).label
      : getCropSpeciesCanonicalName(option)
  ), [serverSearched, uiLanguage]);

  const selectedOfficialName = value ? getOfficialName(value) : '';
  const publishAsHelp = selectedOfficialName && localCropName?.trim()
    && normalizeCropSpeciesSearchValue(selectedOfficialName) !== normalizeCropSpeciesSearchValue(localCropName)
    ? t('library.speciesPicker.publishAsHelp', { localName: localCropName.trim(), officialName: selectedOfficialName })
    : undefined;

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
      // Server-searched mode wants results visible the moment the field is
      // focused (the publishing wizard autofocuses it on open, prefilled
      // with the crop's own name) rather than only once the user types —
      // uncontrolled, so it doesn't fight MUI's own open/close timing the
      // way a controlled `open` prop toggled from mount did.
      openOnFocus={serverSearched}
      filterOptions={(options, params) => {
        const proposeName = params.inputValue.trim();
        const knownOptions = options.filter((option): option is CropSpecies => !isProposeSpeciesOption(option));
        // Server-searched mode: `options` is already the ranked result set
        // for this query (see `useCropSpeciesSearch`) — re-running the
        // client-side substring/fuzzy filter here would drop fuzzy hits
        // that don't literally contain the typed text.
        const filtered: SpeciesPickerOption[] = serverSearched
          ? knownOptions
          : rankSpeciesOptions(knownOptions, proposeName, getOfficialName);
        const hasStrongExistingSpeciesMatch = hasStrongCropSpeciesIdentityMatch(
          proposeName,
          knownOptions.map((option) => ({ searchNames: getCropSpeciesSearchNames(option) })),
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
        const officialName = getOfficialName(option);
        // A species prepended outside the search (the wizard's own fresh
        // proposal) has no server `search_match`; classify it locally.
        const match = (serverSearched ? option.search_match : null)
          ?? getCropSpeciesSearchMatch(option, inputValue, officialName);
        return (
          <li {...optionProps} key={key}>
            <CropSpeciesOptionContent
              officialName={officialName}
              scientificName={option.scientific_name}
              match={match}
              query={inputValue}
              pending={option.status === 'proposed'}
            />
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
      // MUI only falls back to `noOptionsText` once `loading` is false; while
      // it is true it renders `loadingText`, whose default is an
      // untranslated "Loading…". The German string has to go there.
      loadingText={<Typography variant="body2" color="text.secondary">{t('common:messages.loading')}</Typography>}
      noOptionsText={t('library.speciesPicker.noOptions')}
      renderInput={(params) => (
        <TextField
          {...params}
          inputRef={inputRef}
          // Server-searched mode (the publishing wizard) wants results
          // visible the moment the dialog opens, with no extra click —
          // `autoFocus` plus `openOnFocus` above gets there without an
          // imperative `.focus()` call racing the dialog's own mount/open
          // transition.
          autoFocus={serverSearched}
          label={label ?? t('library.speciesPicker.label')}
          required={required}
          error={Boolean(errorText)}
          // Makes it unmistakable, right where the name is edited, that no
          // existing library entry is linked and a typo here would create a
          // wrong proposal — the name stays directly correctable in the
          // field itself, with no extra dialog step.
          helperText={errorText || (proposalName
            ? t('library.speciesPicker.proposingHelp', { name: proposalName })
            : publishAsHelp)}
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
