import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Box,
  Button,
  Collapse,
  Link,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormHelperText,
  IconButton,
  InputLabel,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Stack,
  Typography,
} from '@mui/material';
import type { GridRowId } from '@mui/x-data-grid';
import { useTranslation } from '../../i18n';
import type {
  Bed,
  BedSuggestion,
  Field,
  Location,
  PlantingPlan,
  RotationFinding,
  RotationStatus,
} from '../../api/types';
import { AppTooltip } from '../AppTooltip';
import { useDialogEditCellOpenRequest } from '../data-grid/DialogEditCellContext';
import { isAnyContextMenuOpen } from '../contextMenu/contextMenuOpenState';
import EmptyStateCard from '../project/EmptyStateCard';
import { CompactAreaCell } from './CompactAreaCell';
import {
  getAreaHierarchyIndex,
  type BedWithHierarchy,
} from './areaHierarchySelection';
import { formatAreaM2, toNumericValue } from '../../pages/plantingPlansUtils';
import { TypeaheadSelect as Select } from '../inputs/TypeaheadSelect';
import { fullWidthFieldSx } from '../forms/formLayout';
import { isContextMenuDismissGestureInProgress } from '../../utils/contextMenu';
import { DisabledActionTooltip } from '../DisabledActionTooltip';
import { AreaBedSuggestions } from './rotation/AreaBedSuggestions';
import { getMatchingBeds } from './rotation/bedSuggestionFilters';
import { RotationCheckPanel } from './rotation/RotationCheckPanel';
import { RotationStatusIcon } from './rotation/RotationStatusIcon';
import {
  getBedCapacityText,
  getPrimaryFinding,
  getRotationTitle,
  getSuggestionReason,
  isFlaggedRotationStatus,
} from './rotation/rotationCopy';
import { useFamilyNameResolver } from './rotation/useFamilyNameResolver';
import { useRotationAcceptanceDraft } from './rotation/useRotationAcceptanceDraft';
import { useBedSuggestions } from './rotation/useRotationQueries';

type StoredRotationAcceptance = Pick<
  PlantingPlan,
  'rotation_conflict_accepted' | 'rotation_conflict_accepted_at' | 'rotation_conflict_accepted_by_user'
>;

/** What the crop rotation check needs to know about the plan being assigned. */
export interface AreaAssignmentRotationContext {
  cropId: number | null;
  /** ISO date (YYYY-MM-DD). */
  plantingDate: string | null;
  /** ISO date the plan stops occupying its bed; derived from the crop when null. */
  endDate: string | null;
  /** The plan's area in m²; null skips the capacity check. */
  areaSqm: number | null;
  planId: number | null;
  cultureLabel: string;
  /** The saved plan's rotation status, flagged in the cell; null for drafts. */
  status: RotationStatus | null;
  findings: RotationFinding[] | null;
  acceptance: StoredRotationAcceptance | null;
}

/** What "Übernehmen" hands back besides the bed. */
export interface AreaAssignmentApplyDetails {
  /** Set only when the acceptance changed for the chosen bed. */
  rotationConflictAccepted?: boolean;
  /** Free area of the chosen bed in the plan's period (null when unknown). */
  freeAreaSqm: number | null;
}

interface AreaAssignmentDialogProps {
  bedId: number | null;
  beds: Bed[];
  fields: Field[];
  locations: Location[];
  locale: string;
  onApply: (bedId: number, details: AreaAssignmentApplyDetails) => Promise<void> | void;
  compactLabel: string;
  placeholder?: string;
  hasFocus?: boolean;
  memoKey?: string;
  /**
   * Grid cell identity. Passing both lets the cell pick up explicit dialog edit
   * requests from the grid; ordinary Tab focus only focuses the cell.
   */
  rowId?: GridRowId;
  field?: string;
  /** Enables the rotation check and bed suggestions once crop and date are known. */
  rotation?: AreaAssignmentRotationContext;
}

const ACCEPTANCE_KEY_PREFIX = 'bed:';
const toAcceptanceKey = (bedId: number | null): string => `${ACCEPTANCE_KEY_PREFIX}${bedId ?? ''}`;


interface AssignmentState {
  locationId: number | null;
  fieldId: number | null;
  bedId: number | null;
}

const selectFieldSx = {
  ...fullWidthFieldSx,
  '& .MuiSelect-select': {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
} as const;

const selectMenuProps = {
  slotProps: {
    paper: {
      sx: {
        maxWidth: { xs: 'calc(100vw - 32px)', sm: 420 },
        '& .MuiMenuItem-root': {
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        },
      },
    },
  },
} as const;

// Bed options with a rotation status carry a wrapping secondary line.
const bedOptionMenuProps = {
  slotProps: {
    paper: {
      sx: {
        maxWidth: { xs: 'calc(100vw - 32px)', sm: 480 },
        '& .MuiMenuItem-root': { alignItems: 'flex-start', whiteSpace: 'normal' },
        '& .MuiListItemIcon-root': { minWidth: 32, mt: 0.5 },
        '& .MuiListItemText-root': { my: 0 },
      },
    },
  },
} as const;

const normalizeState = (
  bedId: number | null,
  bedsWithLocation: BedWithHierarchy[],
): AssignmentState => {
  const selectedBed = bedsWithLocation.find((item) => item.id === bedId);
  if (!selectedBed) {
    return { locationId: null, fieldId: null, bedId: bedId ?? null };
  }

  return {
    locationId: selectedBed.locationId,
    fieldId: selectedBed.fieldId,
    bedId: selectedBed.id ?? null,
  };
};

const withDefaultSingleLocation = (
  state: AssignmentState,
  hasSingleLocation: boolean,
  selectableLocations: Location[],
): AssignmentState => {
  if (!hasSingleLocation || selectableLocations[0]?.id === undefined) {
    return state;
  }

  return {
    ...state,
    locationId: selectableLocations[0].id,
  };
};

const clampStateToAvailableHierarchy = (
  state: AssignmentState,
  selectableLocations: Location[],
  fieldsByLocationId: Map<number, Field[]>,
  bedsByFieldId: Map<number, BedWithHierarchy[]>,
): AssignmentState => {
  const locationStillValid = state.locationId !== null
    && selectableLocations.some((item) => item.id === state.locationId);
  const nextLocationId = locationStillValid ? state.locationId : null;
  const nextFields = nextLocationId ? fieldsByLocationId.get(nextLocationId) ?? [] : [];
  const fieldStillValid = state.fieldId !== null
    && nextFields.some((item) => item.id === state.fieldId);
  const nextFieldId = fieldStillValid ? state.fieldId : null;
  const nextBeds = nextFieldId ? bedsByFieldId.get(nextFieldId) ?? [] : [];
  const bedStillValid = state.bedId !== null
    && nextBeds.some((item) => item.id === state.bedId);

  return {
    locationId: nextLocationId,
    fieldId: nextFieldId,
    bedId: bedStillValid ? state.bedId : null,
  };
};

function AreaAssignmentDialogComponent({
  bedId,
  beds,
  fields,
  locations,
  locale,
  onApply,
  compactLabel,
  placeholder,
  hasFocus = false,
  rowId,
  field,
  rotation,
}: AreaAssignmentDialogProps) {
  const { t, i18n } = useTranslation('plantingPlans');
  const [isOpen, setIsOpen] = useState(false);
  const isOpenRef = useRef(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const focusAdvanceTimeoutsRef = useRef<number[]>([]);
  const [triggerFocusRequest, setTriggerFocusRequest] = useState(0);
  const [draft, setDraft] = useState<AssignmentState>({ locationId: null, fieldId: null, bedId: bedId ?? null });
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);
  const familyName = useFamilyNameResolver();
  const {
    resetFromPlan: resetAcceptance,
    getControls: getAcceptanceControls,
    getPayload: getAcceptancePayload,
  } = useRotationAcceptanceDraft();

  // Derived once per (locations, fields, beds) identity and shared by every
  // growing-area cell in the grid — see getAreaHierarchyIndex.
  const {
    bedsWithLocation,
    fieldsByLocationId,
    bedsByFieldId,
    selectableLocations,
  } = useMemo(() => getAreaHierarchyIndex(locations, fields, beds), [beds, fields, locations]);

  const hasSingleLocation = selectableLocations.length <= 1;

  const getOpeningDraft = useCallback((): AssignmentState => (
    withDefaultSingleLocation(
      normalizeState(bedId, bedsWithLocation),
      hasSingleLocation,
      selectableLocations,
    )
  ), [bedId, bedsWithLocation, hasSingleLocation, selectableLocations]);

  const activeDraft = useMemo(() => (
    isOpen
      ? clampStateToAvailableHierarchy(draft, selectableLocations, fieldsByLocationId, bedsByFieldId)
      : draft
  ), [bedsByFieldId, draft, fieldsByLocationId, isOpen, selectableLocations]);

  const selectableFields = useMemo(() => {
    if (!activeDraft.locationId) {
      return [];
    }
    return fieldsByLocationId.get(activeDraft.locationId) ?? [];
  }, [activeDraft.locationId, fieldsByLocationId]);

  const selectableBeds = useMemo(() => {
    if (!activeDraft.fieldId) {
      return [];
    }
    return bedsByFieldId.get(activeDraft.fieldId) ?? [];
  }, [activeDraft.fieldId, bedsByFieldId]);

  const handleLocationChange = useCallback((value: number): void => {
    const nextFields = fieldsByLocationId.get(value) ?? [];
    const selectedFieldId = activeDraft.fieldId && nextFields.some((item) => item.id === activeDraft.fieldId)
      ? activeDraft.fieldId
      : null;

    setDraft({
      locationId: value,
      fieldId: selectedFieldId,
      bedId: null,
    });
  }, [activeDraft.fieldId, fieldsByLocationId]);

  const handleFieldChange = useCallback((value: number): void => {
    if (!activeDraft.locationId) {
      return;
    }

    const selectedField = fieldsByLocationId
      .get(activeDraft.locationId)
      ?.find((item) => item.id === value);
    if (!selectedField) {
      return;
    }

    const nextBeds = bedsByFieldId.get(value) ?? [];
    const selectedBedId = activeDraft.bedId && nextBeds.some((item) => item.id === activeDraft.bedId)
      ? activeDraft.bedId
      : null;

    setDraft({
      locationId: activeDraft.locationId,
      fieldId: value,
      bedId: selectedBedId,
    });
  }, [activeDraft.bedId, activeDraft.locationId, bedsByFieldId, fieldsByLocationId]);

  const handleBedChange = useCallback((value: number): void => {
    if (!activeDraft.fieldId) {
      return;
    }

    const selectedBed = (bedsByFieldId.get(activeDraft.fieldId) ?? []).find((item) => item.id === value);
    if (!selectedBed) {
      return;
    }

    setDraft((previous) => ({
      ...previous,
      bedId: value,
    }));
  }, [activeDraft.fieldId, bedsByFieldId]);

  const renderBedLabel = (item: BedWithHierarchy): string => {
    const areaSqm = toNumericValue(item.area_sqm);
    const label = areaSqm === null
      ? item.name
      : `${item.name} (${formatAreaM2(areaSqm, locale)})`;
    return label;
  };

  const handleSuggestedBed = useCallback((suggestion: BedSuggestion): void => {
    setDraft(normalizeState(suggestion.bed_id, bedsWithLocation));
  }, [bedsWithLocation]);

  const hasRotationContext = Boolean(rotation?.cropId && rotation.plantingDate) && bedsWithLocation.length > 0;
  const rotationInput = {
    cropId: rotation?.cropId ?? null,
    bedId: activeDraft.bedId,
    plantingDate: rotation?.plantingDate ?? null,
    planId: rotation?.planId ?? null,
    endDate: rotation?.endDate ?? null,
    areaSqm: rotation?.areaSqm ?? null,
  };
  const draftBed = bedsWithLocation.find((item) => item.id === activeDraft.bedId);

  // One batch for every bed of the project: it orders and annotates the bed
  // options and feeds the suggestions, so both use the save check's rule.
  const bedOptionsQuery = useBedSuggestions(rotationInput, isOpen && hasRotationContext);
  const bedOptionResults = bedOptionsQuery.data?.results;
  const bedOptionById = useMemo(() => new Map(
    (bedOptionResults ?? []).map((option, rank) => [option.bed_id, { option, rank }]),
  ), [bedOptionResults]);
  const matchingBeds = useMemo(() => getMatchingBeds(bedOptionResults ?? []), [bedOptionResults]);
  const orderedSelectableBeds = useMemo(() => {
    if (bedOptionById.size === 0) {
      return selectableBeds;
    }
    const rankOf = (item: BedWithHierarchy): number => (
      (item.id !== undefined ? bedOptionById.get(item.id)?.rank : undefined) ?? Number.MAX_SAFE_INTEGER
    );
    return [...selectableBeds].sort((first, second) => rankOf(first) - rankOf(second));
  }, [bedOptionById, selectableBeds]);

  const getBedOptionSecondary = (option: BedSuggestion): string => {
    const capacityText = getBedCapacityText(option, rotation?.areaSqm, t, locale, i18n.language);
    if (!option.has_enough_area) {
      return capacityText;
    }
    return [getSuggestionReason(option, t, familyName, rotation?.cultureLabel ?? ''), capacityText]
      .filter((part) => part)
      .join(' · ');
  };

  const isFieldSelectDisabled = !activeDraft.locationId || selectableFields.length === 0;
  const isBedSelectDisabled = !activeDraft.fieldId || selectableBeds.length === 0;
  const isApplyDisabled = !activeDraft.bedId || bedsWithLocation.length === 0;

  const handleApply = async (): Promise<void> => {
    if (isApplyDisabled || !activeDraft.bedId) {
      return;
    }
    const acceptancePayload = hasRotationContext ? getAcceptancePayload(toAcceptanceKey(activeDraft.bedId)) : {};
    await onApply(activeDraft.bedId, {
      ...(acceptancePayload.rotation_conflict_accepted !== undefined
        ? { rotationConflictAccepted: acceptancePayload.rotation_conflict_accepted }
        : {}),
      freeAreaSqm: bedOptionById.get(activeDraft.bedId)?.option.free_area_sqm ?? null,
    });
    isOpenRef.current = false;
    setIsOpen(false);
    setTriggerFocusRequest((request) => request + 1);
  };

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void handleApply();
  };

  const getDialogTabStops = useCallback((): HTMLElement[] => {
    const form = formRef.current;
    if (!form) {
      return [];
    }

    return Array.from(form.querySelectorAll<HTMLElement>('[role="combobox"], button'))
      .filter((element) => (
        !element.hasAttribute('disabled')
        && element.getAttribute('aria-disabled') !== 'true'
        && (element.getAttribute('role') === 'combobox' || element.tabIndex >= 0)
      ));
  }, []);

  const focusFirstDialogControl = useCallback((): void => {
    getDialogTabStops()[0]?.focus();
  }, [getDialogTabStops]);

  const clearFocusAdvanceTimeouts = useCallback((): void => {
    focusAdvanceTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    focusAdvanceTimeoutsRef.current = [];
  }, []);

  const focusAdjacentDialogControl = useCallback((
    origin: HTMLElement,
    shiftKey: boolean,
  ): void => {
    clearFocusAdvanceTimeouts();
    const timeoutId = window.setTimeout(() => {
      const nextTabStops = getDialogTabStops();
      if (nextTabStops.length === 0) {
        return;
      }

      const currentIndex = nextTabStops.findIndex((element) => (
        element === origin
        || (origin.id !== '' && element.id === origin.id)
        || element.contains(origin)
        || origin.contains(element)
      ));
      const nextIndex = shiftKey
        ? ((currentIndex === -1 ? 0 : currentIndex) - 1 + nextTabStops.length) % nextTabStops.length
        : ((currentIndex === -1 ? -1 : currentIndex) + 1) % nextTabStops.length;
      const nextTabStop = nextTabStops[nextIndex];
      nextTabStop?.focus();
      focusAdvanceTimeoutsRef.current = [
        window.setTimeout(() => nextTabStop?.focus(), 10),
        window.setTimeout(() => nextTabStop?.focus(), 50),
      ];
    }, 0);
    focusAdvanceTimeoutsRef.current = [timeoutId];
  }, [clearFocusAdvanceTimeouts, getDialogTabStops]);

  const commitHighlightedOption = useCallback((activeCombobox: HTMLElement): void => {
    const listboxId = activeCombobox.getAttribute('aria-controls');
    const listbox = listboxId ? document.getElementById(listboxId) : null;
    const highlightedOption = listbox?.querySelector<HTMLElement>(
      '[role="option"][tabindex="0"], [role="option"].Mui-focusVisible',
    );
    highlightedOption?.click();
  }, []);

  useEffect(() => {
    if (!isOpen || bedsWithLocation.length === 0) {
      return;
    }

    const timeoutId = window.setTimeout(focusFirstDialogControl, 0);
    return () => window.clearTimeout(timeoutId);
  }, [bedsWithLocation.length, focusFirstDialogControl, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleDocumentKeyDownCapture = (event: globalThis.KeyboardEvent): void => {
      if (
        event.key !== 'Tab'
        || event.altKey
        || event.ctrlKey
        || event.metaKey
      ) {
        return;
      }

      const form = formRef.current;
      const eventTarget = event.target;
      if (!form || !(eventTarget instanceof HTMLElement)) {
        return;
      }

      const activeCombobox = form.querySelector<HTMLElement>('[role="combobox"][aria-expanded="true"]');
      const origin = activeCombobox
        ?? eventTarget.closest<HTMLElement>('[role="combobox"]')
        ?? eventTarget;
      if (!form.contains(origin)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (activeCombobox) {
        commitHighlightedOption(activeCombobox);
      }
      focusAdjacentDialogControl(origin, event.shiftKey);
    };

    document.addEventListener('keydown', handleDocumentKeyDownCapture, true);
    return () => {
      document.removeEventListener('keydown', handleDocumentKeyDownCapture, true);
      clearFocusAdvanceTimeouts();
    };
  }, [clearFocusAdvanceTimeouts, commitHighlightedOption, focusAdjacentDialogControl, isOpen]);

  const handleCancel = (): void => {
    isOpenRef.current = false;
    setIsOpen(false);
    setTriggerFocusRequest((request) => request + 1);
  };

  /**
   * Idempotent per edit cycle: the click, the Enter/Space keydown and the
   * grid's keyboard-entry request can all fire for one and the same entry into
   * the cell, and re-running the body would reset an already edited draft.
   */
  const savedRotationStatus = rotation?.status ?? null;
  const storedAcceptance = rotation?.acceptance ?? null;
  const handleOpen = useCallback((): void => {
    if (isOpenRef.current || isAnyContextMenuOpen() || isContextMenuDismissGestureInProgress()) {
      return;
    }

    isOpenRef.current = true;
    const openingDraft = getOpeningDraft();
    setDraft(openingDraft);
    resetAcceptance(storedAcceptance, toAcceptanceKey(openingDraft.bedId));
    // The suggestions start expanded when the plan's bed has a conflict.
    setIsSuggestionsOpen(savedRotationStatus === 'conflict');
    setIsOpen(true);
  }, [getOpeningDraft, resetAcceptance, savedRotationStatus, storedAcceptance]);

  useDialogEditCellOpenRequest(rowId, field, handleOpen);

  const flaggedStatus = isFlaggedRotationStatus(savedRotationStatus ?? undefined) ? savedRotationStatus : null;
  const statusAdornment = flaggedStatus ? (
    <AppTooltip title={getRotationTitle(flaggedStatus, getPrimaryFinding(rotation?.findings ?? undefined), t, familyName)}>
      <IconButton
        size="small"
        // The cell itself is the keyboard entry (Enter opens the same dialog),
        // so the icon stays out of the grid's tab order.
        tabIndex={-1}
        aria-label={t(`rotation.iconAria.${flaggedStatus}`)}
        data-testid="rotation-status-button"
        onClick={(event) => {
          event.stopPropagation();
          handleOpen();
        }}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <RotationStatusIcon status={flaggedStatus} fontSize="small" />
      </IconButton>
    </AppTooltip>
  ) : null;

  return (
    <>
      <CompactAreaCell
        label={compactLabel}
        placeholder={placeholder}
        hasFocus={hasFocus}
        suppressFocus={isOpen}
        focusRequest={triggerFocusRequest}
        onOpen={handleOpen}
        triggerLabel={t('areaAssignment.editButton')}
        endAdornment={statusAdornment}
      />
      <Dialog
        open={isOpen}
        onClose={handleCancel}
        fullWidth
        maxWidth="xs"
      >
        {/* A flex column, so DialogContent scrolls and the actions stay in
            view however tall the rotation check makes the content. */}
        <Box
          component="form"
          ref={formRef}
          onSubmit={handleFormSubmit}
          sx={{ minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', flex: '1 1 auto' }}
        >
          <DialogTitle>{t('areaAssignment.title')}</DialogTitle>
          <DialogContent>
            <Box sx={{ pt: 1, minWidth: 0 }}>
              {bedsWithLocation.length === 0 ? (
                <EmptyStateCard
                  title={t('areaAssignment.emptyStateTitle')}
                  description={t('areaAssignment.emptyStateDescription')}
                  actions={[{ label: t('areaAssignment.emptyStateAction'), to: '/app/fields-beds' }]}
                />
              ) : null}
              <Stack spacing={1.5} sx={{ mt: bedsWithLocation.length === 0 ? 0 : 0.5, minWidth: 0 }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: -0.25 }}>
                  {t('areaAssignment.hierarchyHint')}
                </Typography>
                <FormControl size="small" sx={selectFieldSx}>
                  <InputLabel id="assignment-location-label">{t('columns.location')}</InputLabel>
                  <Select
                    fullWidth
                    id="assignment-location"
                    labelId="assignment-location-label"
                    value={activeDraft.locationId ?? ''}
                    label={t('columns.location')}
                    disabled={selectableLocations.length === 0}
                    MenuProps={selectMenuProps}
                    onChange={(event) => handleLocationChange(Number(event.target.value))}
                  >
                    {selectableLocations.map((item) => (
                      <MenuItem key={item.id} value={item.id} title={item.name}>{item.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl size="small" sx={selectFieldSx}>
                  <InputLabel id="assignment-field-label">{t('columns.field')}</InputLabel>
                  <Select
                    fullWidth
                    id="assignment-field"
                    labelId="assignment-field-label"
                    value={activeDraft.fieldId ?? ''}
                    label={t('columns.field')}
                    disabled={isFieldSelectDisabled}
                    MenuProps={selectMenuProps}
                    onChange={(event) => handleFieldChange(Number(event.target.value))}
                  >
                    {selectableFields.map((item) => (
                      <MenuItem key={item.id} value={item.id} title={item.name}>{item.name}</MenuItem>
                    ))}
                  </Select>
                  {isFieldSelectDisabled ? (
                    <FormHelperText>
                      {!activeDraft.locationId
                        ? t('areaAssignment.selectLocationFirst')
                        : t('areaAssignment.noFieldsForLocation')}
                    </FormHelperText>
                  ) : null}
                </FormControl>

                <FormControl size="small" sx={selectFieldSx}>
                  <InputLabel id="assignment-bed-label">{t('columns.bed')}</InputLabel>
                  <Select
                    fullWidth
                    id="assignment-bed"
                    labelId="assignment-bed-label"
                    value={activeDraft.bedId ?? ''}
                    label={t('columns.bed')}
                    disabled={isBedSelectDisabled}
                    MenuProps={bedOptionById.size > 0 ? bedOptionMenuProps : selectMenuProps}
                    renderValue={(value) => {
                      const selectedBed = bedsWithLocation.find((item) => item.id === value);
                      return selectedBed ? renderBedLabel(selectedBed) : '';
                    }}
                    onChange={(event) => handleBedChange(Number(event.target.value))}
                  >
                    {orderedSelectableBeds.map((item) => {
                      const label = renderBedLabel(item);
                      const option = item.id !== undefined ? bedOptionById.get(item.id)?.option : undefined;
                      if (!option) {
                        return (
                          <MenuItem key={item.id} value={item.id} title={label}>{label}</MenuItem>
                        );
                      }
                      return (
                        <MenuItem
                          key={item.id}
                          value={item.id}
                          title={label}
                          disabled={!option.has_enough_area}
                          data-testid="bed-option"
                          data-rotation-status={option.status}
                        >
                          <ListItemIcon>
                            <RotationStatusIcon status={option.status} fontSize="small" />
                          </ListItemIcon>
                          <ListItemText primary={label} secondary={getBedOptionSecondary(option) || undefined} />
                        </MenuItem>
                      );
                    })}
                  </Select>
                  {isBedSelectDisabled ? (
                    <FormHelperText>
                      {!activeDraft.fieldId
                        ? t('areaAssignment.selectFieldFirst')
                        : t('areaAssignment.noBedsForField')}
                    </FormHelperText>
                  ) : null}
                </FormControl>
                {hasRotationContext && rotation ? (
                  <>
                    <RotationCheckPanel
                      input={rotationInput}
                      bedLabel={draftBed?.name ?? ''}
                      cultureLabel={rotation.cultureLabel}
                      acceptance={getAcceptanceControls(toAcceptanceKey(activeDraft.bedId))}
                    />
                    <Link
                      component="button"
                      type="button"
                      variant="body2"
                      aria-expanded={isSuggestionsOpen}
                      onClick={() => setIsSuggestionsOpen((value) => !value)}
                      sx={{ alignSelf: 'flex-start' }}
                    >
                      {isSuggestionsOpen
                        ? t('rotation.suggestions.hide')
                        : t('rotation.suggestions.show')}
                    </Link>
                    <Collapse in={isSuggestionsOpen} unmountOnExit>
                      <AreaBedSuggestions
                        suggestions={matchingBeds}
                        periodStart={bedOptionsQuery.data?.start_date ?? null}
                        periodEnd={bedOptionsQuery.data?.end_date ?? null}
                        selectedBedId={activeDraft.bedId}
                        isLoading={bedOptionsQuery.isLoading}
                        isError={bedOptionsQuery.isError}
                        cultureLabel={rotation.cultureLabel}
                        numberLocale={locale}
                        familyName={familyName}
                        onSelectBed={handleSuggestedBed}
                      />
                    </Collapse>
                  </>
                ) : null}
              </Stack>
            </Box>
          </DialogContent>
          <DialogActions>
            <Button type="button" data-dialog-action="cancel" onClick={handleCancel}>{t('areaAssignment.cancel')}</Button>
            <DisabledActionTooltip title={isApplyDisabled ? t('areaAssignment.selectBedFirst') : ''}>
              <Button type="submit" data-dialog-action="apply" variant="contained" disabled={isApplyDisabled}>{t('areaAssignment.apply')}</Button>
            </DisabledActionTooltip>
          </DialogActions>
        </Box>
      </Dialog>
    </>
  );
}

export const AreaAssignmentDialog = memo(AreaAssignmentDialogComponent, (previous, next) => (
  previous.bedId === next.bedId
  && previous.beds === next.beds
  && previous.fields === next.fields
  && previous.locations === next.locations
  && previous.locale === next.locale
  && previous.compactLabel === next.compactLabel
  && previous.placeholder === next.placeholder
  && previous.hasFocus === next.hasFocus
  && previous.memoKey === next.memoKey
  && previous.rowId === next.rowId
  && previous.field === next.field
  && previous.rotation?.cropId === next.rotation?.cropId
  && previous.rotation?.plantingDate === next.rotation?.plantingDate
  && previous.rotation?.endDate === next.rotation?.endDate
  && previous.rotation?.areaSqm === next.rotation?.areaSqm
  && previous.rotation?.planId === next.rotation?.planId
  && previous.rotation?.cultureLabel === next.rotation?.cultureLabel
  && previous.rotation?.status === next.rotation?.status
  && previous.rotation?.findings === next.rotation?.findings
  && previous.rotation?.acceptance?.rotation_conflict_accepted === next.rotation?.acceptance?.rotation_conflict_accepted
  && previous.rotation?.acceptance?.rotation_conflict_accepted_at === next.rotation?.acceptance?.rotation_conflict_accepted_at
));
