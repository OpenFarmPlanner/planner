import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import {
  Autocomplete,
  type AutocompleteInputChangeReason,
  CircularProgress,
  TextField,
  Typography,
} from '@mui/material';
import { AutocompleteActionPaper, AutocompleteActionProvider } from '../components/AutocompleteActionPaper';

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
  /**
   * `reason` is MUI's: only `'input'` and `'clear'` are the user editing the
   * text — `'selectOption'`/`'reset'`/`'blur'` write a picked option's label
   * back. Undefined when the picker restores or commits a name itself.
   */
  onInputValueChange: (value: string, reason?: AutocompleteInputChangeReason) => void;
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
  autoFocus?: boolean;
  /** Restrict callers such as sourced host links to an existing approved species. */
  allowProposal?: boolean;
  disabled?: boolean;
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
  autoFocus = serverSearched,
  allowProposal = true,
  disabled = false,
}: CropSpeciesPickerProps) {
  const { t } = useTranslation(['crops', 'common']);
  const [open, setOpen] = useState(false);
  const proposalActionId = useId();
  const inputId = useId();
  const initialFocusPending = useRef(autoFocus && !disabled);
  useEffect(() => {
    if (!initialFocusPending.current || !autoFocus || disabled) return;
    // The dialog's focus trap can restore focus after a native mount autofocus.
    const frame = window.requestAnimationFrame(() => {
      initialFocusPending.current = false;
      document.getElementById(inputId)?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [autoFocus, disabled, inputId]);
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
    if (!allowProposal || !trimmedName || loading) return false;
    return !hasStrongCropSpeciesIdentityMatch(
      trimmedName,
      species.map((option) => ({ searchNames: getCropSpeciesSearchNames(option) })),
    );
  }, [allowProposal, loading, species]);

  const proposeName = inputValue.trim();
  const canPropose = canUseProposalName(proposeName);
  const chooseProposal = () => {
    if (!canPropose || disabled || proposing) return;
    reportProposalName(proposeName);
    onInputValueChange(proposeName);
    setOpen(false);
  };

  return (
    <AutocompleteActionProvider action={canPropose ? {
      label: t('library.speciesPicker.proposeInlineLabel', { name: proposeName }),
      name: `${t('library.speciesPicker.proposeInline')} · ${proposeName}`,
      disabled: disabled || proposing,
      busy: proposing,
      onClick: chooseProposal,
      id: proposalActionId,
      testId: 'propose-species-option',
    } : null}>
    <Autocomplete<CropSpecies>
      id={inputId}
      slotProps={{ popper: {
        container: () => document.getElementById(inputId)?.closest('[role="dialog"]') ?? document.body,
        popperOptions: { strategy: 'fixed' },
        modifiers: [{ name: 'preventOverflow', options: { altAxis: true, padding: 8 } }],
        // A clipped anchor can leave its fixed popup over the dialog actions.
        sx: { '&[data-popper-reference-hidden]': { visibility: 'hidden', pointerEvents: 'none' } },
        onBlur: (event) => {
          const next = event.relatedTarget;
          if (next?.id !== inputId && !event.currentTarget.contains(next)) setOpen(false);
        },
        onKeyDown: (event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          document.getElementById(inputId)?.focus();
          setOpen(false);
        },
      } }}
      open={open} onOpen={() => setOpen(true)} clearOnBlur={false}
      onClose={(event, reason) => {
        const target = event && 'relatedTarget' in event ? event.relatedTarget : document.activeElement;
        if (reason === 'blur' && target instanceof HTMLElement && target.id === proposalActionId) return;
        setOpen(false);
      }}
      options={species}
      disabled={disabled}
      value={value}
      inputValue={inputValue}
      loading={loading}
      getOptionLabel={getCropSpeciesOptionLabel}
      isOptionEqualToValue={(option, optionValue) => (
        option.id === optionValue.id
      )}
      slots={{ paper: AutocompleteActionPaper }}
      // Server-searched mode shows its results as soon as the input is focused.
      openOnFocus={serverSearched}
      filterOptions={(options, params) => serverSearched ? options : rankSpeciesOptions(options, params.inputValue.trim(), getOfficialName)}
      renderOption={(props, option) => {
        const { key, ...optionProps } = props;
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
      onKeyDown={(event) => {
        if (event.key !== 'Tab' || event.shiftKey || !canPropose || proposing || disabled) return;
        const button = document.getElementById(proposalActionId);
        if (!button || button.closest('[data-popper-reference-hidden]')) return;
        event.preventDefault();
        button.focus();
      }}
      onChange={(_, option) => {
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
        onInputValueChange(nextValue, reason);
        if (reason !== 'reset') {
          reportProposalName(null);
        }
      }}
      // MUI only falls back to `noOptionsText` once `loading` is false; while
      // it is true it renders `loadingText`, whose default is an
      // untranslated "Loading…". The German string has to go there.
      loadingText={<Typography variant="body2" color="text.secondary">{t('common:messages.loading')}</Typography>}
      noOptionsText={canPropose ? null : t('library.speciesPicker.noOptions')}
      renderInput={(params) => (
        <TextField
          {...params}
          inputRef={inputRef}
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
    </AutocompleteActionProvider>
  );
}
