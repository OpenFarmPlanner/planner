/**
 * Crop Form component for creating and editing crops.
 * 
 * Provides a comprehensive form with validation for all crop fields.
 * All fields are visible without collapsible sections.
 * UI text is in German, code comments remain in English.
 * 
 * @param props - Component properties
 * @param props.crop - Existing crop for editing (optional)
 * @param props.onSave - Callback when crop is saved
 * @param props.onCancel - Callback when form is cancelled
 * @returns JSX element rendering the crop form
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from '../i18n';
import type { Crop, PublicCrop, SeedRateUnitConstraints, Supplier } from '../api/types';
import { extractApiErrorMessage } from '../api/errors';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Box,
  Button,
  Typography,
  TextField,
  FormControl,
  InputLabel,
  MenuItem,
  IconButton,
  Checkbox,
  FormControlLabel,
} from '@mui/material';
import type { AutocompleteChangeReason } from '@mui/material/Autocomplete';
import { alpha } from '@mui/material/styles';
import DeleteIcon from '@mui/icons-material/Delete';
import { cropAPI, supplierAPI } from '../api/api';
import { useActiveSaveShortcut } from '../hooks/useActiveSaveShortcut';
import { useDialogKeyboardScroll } from '../hooks/useDialogKeyboardScroll';
import { ConfirmationDialog } from '../components/feedback/ConfirmationDialog';
import { AppTooltip } from '../components/AppTooltip';
import { hasEffectiveCropFormChanges } from './cropFormChangeDetection';
import { validateCrop } from './validation';
import { normalizeSeedRateUnit } from './enumNormalization';
import { buildCropIdentityKey, normalizeCropIdentityValue } from './cropIdentity';
import { TypeaheadSelect as Select } from '../components/inputs/TypeaheadSelect';
import { BasicInfoSection } from './sections/BasicInfoSection';
import { TimingSection } from './sections/TimingSection';
import { HarvestSection } from './sections/HarvestSection';
import { SpacingSection } from './sections/SpacingSection';
import { SeedingSection } from './sections/SeedingSection';
import { ColorSection } from './sections/ColorSection';
import { NotesSection } from './sections/NotesSection';
import { hasSupplierDataRowMissingSupplier, hasSupplierInformation } from './supplierDataRows';
import { stripCitationMarkers } from '../components/data-grid/markdown';
import { SupplierFormDialog } from '../components/suppliers/SupplierFormDialog';
import { findSpeciesCrop } from './cropHierarchy';
import {
  isLikelyTestPublicCropEntry,
  normalizeIdentityValue,
} from './publicCropNameSuggestions';
import { usePublicCropSuggestions } from './usePublicCropSuggestions';
import {
  buildInheritedValueBaseline,
  getVarietyOwnValueSource,
  stripValuesMatchingBaseline,
} from './varietyValueSource';
import { varietySpecificFieldHighlightSx } from './varietyValueAccent';
import { metersToRoundedCentimeters } from '../utils/measurementConversion';
import { buildVarietyFieldTooltipTitle, type GetVarietyFieldTooltipProps } from './varietyFieldTooltipHelpers';
import { VarietyValueLegend } from './VarietyValueLegend';
import {
  compactFieldSx,
  formRowSx,
  mediumStackedFieldSx,
  smallFieldSx,
  wideSingleColumnFieldSx,
} from '../components/forms/formLayout';

/**
 * The optional first variety created alongside a brand-new crop. `draft`
 * carries public-library values plus their `source_public_crop` linking
 * when the user picked a concrete variety suggestion; without it the variety
 * inherits the crop's own values (the pre-existing behavior).
 */
export interface FirstVarietyDraft {
  name: string;
  draft?: Partial<Crop>;
  copyValuesToCrop?: boolean;
}

interface CropFormProps {
  crop?: Crop;
  /**
   * Full crop list, used to find the parent species crop for variety inheritance
   * highlighting. Accepts partial/converted crop data (e.g. public library entries
   * mapped to the project `Crop` shape) as long as field names/units line up.
   */
  crops?: Partial<Crop>[];
  onSave: (crop: Crop, firstVariety?: FirstVarietyDraft) => Promise<void>;
  onCancel: () => void;
  /**
   * Offered when the typed crop name already exists as a private crop in
   * this project: closes the form and hands over to the existing "+ Add
   * variety" flow for that crop instead of creating a second crop with the
   * same name. Omitted by callers that have no such flow.
   */
  onSwitchToAddVariety?: (speciesCrop: Crop) => void;
  title?: string;
  variant?: 'project' | 'publicLibrary';
  extraSections?: ReactNode;
  hasExternalChanges?: boolean;
  /**
   * Whether this form edits a crop-level entry (no variety, the species'
   * general record) or a variety-level entry (variety required). Only
   * relevant for `variant="project"` — the public-library form always shows
   * both identity fields via `showIdentityFields`. Defaults to 'variety' so
   * existing callers that don't pass it keep today's behavior.
   */
  formKind?: 'crop' | 'variety';
  /**
   * Initial field values merged onto the blank template when creating (i.e.
   * `crop` is undefined) — used by "+ Add variety" to pre-fill the parent
   * crop's `crop_species`/`name` so the new row groups correctly.
   */
  initialDraft?: Partial<Crop>;
  /**
   * Number of project crops currently linked to this public-library entry
   * (`variant="publicLibrary"` only). Shown so an admin can see the blast
   * radius of an edit — especially a variety rename — before saving.
   */
  importedCopiesCount?: number;
  /** Prevent public-library identity edits for users without administrator privileges. */
  publicIdentityReadOnly?: boolean;
}

// Default color for display color picker
const DEFAULT_DISPLAY_COLOR = '#3498db';

// Vertical rhythm of the supplier data section (MUI spacing unit = 8px -> 14px).
const SUPPLIER_SECTION_GAP = 1.75;

// Empty crop template
const EMPTY_CROP: Partial<Crop> = {
  name: '',
  variety: '',
  crop_family: '',
  nutrient_demand: '',
  cultivation_type: 'pre_cultivation',
  cultivation_types: ['pre_cultivation'],
  notes: '',
  growth_duration_days: undefined,
  harvest_duration_days: undefined,
  propagation_duration_days: undefined,
  expected_yield: undefined,
  distance_within_row_cm: undefined,
  row_spacing_cm: undefined,
  sowing_depth_cm: undefined,
  display_color: '',
  sowing_calculation_safety_percent: 0,
  sowing_calculation_safety_percent_direct: undefined,
  sowing_calculation_safety_percent_pre_cultivation: undefined,
  thousand_kernel_weight_g: undefined,
  seeding_requirement: undefined,
  seeding_requirement_type: '',
  seed_rate_value: null,
  seed_rate_unit: null,
  seed_rate_by_cultivation: null,
  seed_rate_direct_value: null,
  seed_rate_direct_unit: null,
  seed_rate_pre_cultivation_value: null,
  seed_rate_pre_cultivation_unit: null,
  seed_packages: [],
};

// Same visual treatment as the Name field's green "applied from library"
// hint, reused wherever a public-library entry got linked in.
const PublicCropSourceHint = ({ text }: { text: string }) => (
  <Box
    sx={(theme) => ({
      px: 1.5,
      py: 1,
      borderLeft: `4px solid ${theme.palette.primary.main}`,
      borderRadius: 1,
      bgcolor: alpha(theme.palette.primary.light, 0.1),
      color: 'text.primary',
    })}
  >
    <Typography variant="body2" sx={{ lineHeight: 1.35 }}>{text}</Typography>
  </Box>
);

// Dezent hint offered when typed free text matches a library entry exactly
// but wasn't picked from the dropdown — applying stays an explicit action
// rather than a silent background fill.
const PublicCropApplyHint = ({ hintText, actionLabel, onApply }: { hintText: string; actionLabel: string; onApply: () => void }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
    <Typography variant="body2" color="text.secondary">{hintText}</Typography>
    <Button size="small" onClick={onApply}>{actionLabel}</Button>
  </Box>
);

const DUPLICATE_CHECK_DEBOUNCE_MS = 400;

const getPublicCropDraftName = (publicCrop: PublicCrop): string => (
  publicCrop.display_name || publicCrop.crop_species_name || publicCrop.name
);

const buildDraftFromPublicCrop = (publicCrop: PublicCrop): Partial<Crop> => ({
  name: getPublicCropDraftName(publicCrop),
  variety: publicCrop.variety ?? '',
  notes: publicCrop.notes ?? '',
  crop_species: publicCrop.crop_species ?? null,
  source_public_crop: publicCrop.id,
  source_public_version: publicCrop.version,
  origin_type: 'imported',
  is_modified_from_source: false,
  crop_family: publicCrop.crop_family ?? '',
  nutrient_demand: publicCrop.nutrient_demand ?? '',
  cultivation_type: publicCrop.cultivation_type || 'pre_cultivation',
  cultivation_types: publicCrop.cultivation_types?.length ? publicCrop.cultivation_types : ['pre_cultivation'],
  growth_duration_days: publicCrop.growth_duration_days ?? undefined,
  harvest_duration_days: publicCrop.harvest_duration_days ?? undefined,
  propagation_duration_days: publicCrop.propagation_duration_days ?? undefined,
  harvest_method: publicCrop.harvest_method ?? '',
  expected_yield: publicCrop.expected_yield ?? undefined,
  distance_within_row_cm: metersToRoundedCentimeters(publicCrop.distance_within_row_m),
  row_spacing_cm: metersToRoundedCentimeters(publicCrop.row_spacing_m),
  sowing_depth_cm: metersToRoundedCentimeters(publicCrop.sowing_depth_m),
  seed_rate_value: publicCrop.seed_rate_value ?? null,
  seed_rate_unit: publicCrop.seed_rate_unit ?? null,
  seed_rate_by_cultivation: publicCrop.seed_rate_by_cultivation ?? null,
  seed_rate_direct_value: publicCrop.seed_rate_direct_value ?? null,
  seed_rate_direct_unit: publicCrop.seed_rate_direct_unit ?? null,
  seed_rate_pre_cultivation_value: publicCrop.seed_rate_pre_cultivation_value ?? null,
  seed_rate_pre_cultivation_unit: publicCrop.seed_rate_pre_cultivation_unit ?? null,
  thousand_kernel_weight_g: publicCrop.thousand_kernel_weight_g ?? undefined,
  seeding_requirement: publicCrop.seeding_requirement ?? undefined,
  seeding_requirement_type: publicCrop.seeding_requirement_type ?? '',
  display_color: publicCrop.display_color ?? '',
  seed_packages: publicCrop.seed_packages ?? [],
});

const buildInitialFormData = (crop?: Crop, initialDraft?: Partial<Crop>): Partial<Crop> => {
  if (!crop) {
    return initialDraft ? { ...EMPTY_CROP, ...initialDraft } : EMPTY_CROP;
  }

  // A Sorte only stores the values it actually overrides. Every other field
  // shows the value the backend resolved from its general Kultur, so the form
  // displays what the Sorte effectively is instead of a row of empty inputs.
  // The merged-in values carry no override styling (they equal the Kultur's
  // own values, see getVarietyOwnValueSource) and are stripped again on save.
  const displayedCrop: Crop = { ...crop, ...buildInheritedValueBaseline(crop) };

  const normalizedSpacingValues: Partial<Crop> = {
    distance_within_row_cm:
      typeof displayedCrop.distance_within_row_cm === 'number'
        ? Math.round(displayedCrop.distance_within_row_cm)
        : displayedCrop.distance_within_row_cm,
    row_spacing_cm:
      typeof displayedCrop.row_spacing_cm === 'number'
        ? Math.round(displayedCrop.row_spacing_cm)
        : displayedCrop.row_spacing_cm,
  };

  const normalizedSeedRateUnits: Partial<Crop> = {
    seed_rate_unit: normalizeSeedRateUnit(displayedCrop.seed_rate_unit),
    seed_rate_direct_unit: normalizeSeedRateUnit(displayedCrop.seed_rate_direct_unit),
    seed_rate_pre_cultivation_unit: normalizeSeedRateUnit(displayedCrop.seed_rate_pre_cultivation_unit),
  };

  const normalizedNotes = displayedCrop.notes
    ? stripCitationMarkers(displayedCrop.notes)
    : displayedCrop.notes;

  // `crop.name` is free text and never cascades a later crop_species rename
  // (see crop_display.py) — `crop_display_name` is the field that already
  // resolves to the species' current name, and it falls back to `crop.name`
  // itself when there is no linked species, so preferring it here can only
  // correct a stale value, never lose one.
  const normalizedName = displayedCrop.crop_display_name ?? displayedCrop.name;

  if (displayedCrop.supplier || !displayedCrop.seed_supplier) {
    return {
      ...displayedCrop,
      ...normalizedSpacingValues,
      ...normalizedSeedRateUnits,
      notes: normalizedNotes,
      name: normalizedName,
    };
  }

  return {
    ...displayedCrop,
    ...normalizedSpacingValues,
    ...normalizedSeedRateUnits,
    notes: normalizedNotes,
    name: normalizedName,
    supplier: {
      name: displayedCrop.seed_supplier,
      allowed_domains: [],
    },
  };
};

/**
 * Renders the CropForm as a modal dialog. The dialog can only be closed via Save or Cancel.
 *
 * @remarks
 * Prevents closing by clicking outside.
 */
export function CropForm({
  crop,
  crops,
  onSave,
  onCancel,
  onSwitchToAddVariety,
  title,
  variant = 'project',
  extraSections,
  hasExternalChanges = false,
  formKind = 'variety',
  initialDraft,
  importedCopiesCount,
  publicIdentityReadOnly = false,
}: CropFormProps) {
  const { t } = useTranslation('crops');
  const isEdit = Boolean(crop);
  const isProjectForm = variant === 'project';
  const showSupplierDataSection = isProjectForm;
  const showVarietyField = !isProjectForm || formKind === 'variety';
  const requireVariety = isProjectForm && formKind === 'variety';
  const showFirstVarietyField = isProjectForm && formKind === 'crop' && !isEdit;
  const [saveError, setSaveError] = useState<string>('');
  const [firstVarietyName, setFirstVarietyName] = useState<string>('');
  const [copyValuesToCrop, setCopyValuesToCrop] = useState(false);
  // Set only when the first-variety name was picked from a public-library
  // suggestion, so that variety gets the same source linking as an import.
  const [firstVarietyPublicCrop, setFirstVarietyPublicCrop] = useState<PublicCrop | null>(null);
  const hasFirstVarietyName = firstVarietyName.trim().length > 0;

  // --- Validation now imported from ../crops/validation ---

  // Save function for the autosave hook
  const saveCrop = async (draft: Partial<Crop>): Promise<Partial<Crop>> => {
    const dataToSave: Crop = {
      ...(draft as Crop),
      ...(isProjectForm && formKind === 'variety' && !isEdit && Boolean((draft.variety ?? '').trim())
        ? { copy_values_to_crop: copyValuesToCrop }
        : {}),
    };
    // The Name field displays the species' current translated name
    // (crop_display_name) so a rename elsewhere shows up immediately, but
    // that translation is language-dependent — submitting it verbatim would
    // silently overwrite the canonical Crop.name with whatever language
    // the viewer's UI happens to be in. Only accept it as an edit if it
    // actually changed from what was displayed; otherwise keep the
    // untouched stored name.
    if (crop?.crop_species && dataToSave.name === (crop.crop_display_name ?? crop.name)) {
      dataToSave.name = crop.name;
    }
    const trimmedFirstVarietyName = firstVarietyName.trim();
    const firstVarietyDraft = firstVarietyPublicCrop && normalizeIdentityValue(firstVarietyPublicCrop.variety) === normalizeIdentityValue(trimmedFirstVarietyName)
      ? buildDraftFromPublicCrop(firstVarietyPublicCrop)
      : undefined;
    const firstVariety: FirstVarietyDraft | undefined = showFirstVarietyField && trimmedFirstVarietyName
      ? {
        name: trimmedFirstVarietyName,
        draft: firstVarietyDraft,
        ...(copyValuesToCrop ? { copyValuesToCrop: true } : {}),
      }
      : undefined;
    await onSave(dataToSave, firstVariety);
    return dataToSave;
  };

  // Local form state (no autosave)
  const [formData, setFormData] = useState<Partial<Crop>>(buildInitialFormData(crop, initialDraft));
  const cropIdentityLabel = formData.name ?? '';
  const hasDirectVarietyName = Boolean((formData.variety ?? '').trim());
  const hasCopyValuesToCropTarget = formKind === 'variety' ? hasDirectVarietyName : hasFirstVarietyName;
  const showCopyValuesToCropCheckbox = isProjectForm && !isEdit && (
    formKind === 'variety'
    || showFirstVarietyField
  );
  const copyValuesToCropDisabled = !hasCopyValuesToCropTarget;

  const selectedSpeciesCrop = useMemo(
    () => (crops ? findSpeciesCrop(formData as Crop, crops as Crop[]) : null),
    // findSpeciesCrop only reads these fields off formData (via
    // getCropSpeciesKey's crop_species -> crop_display_name -> name
    // fallback); keying on the whole object means it re-scans `crops` on
    // every keystroke in any unrelated field (yield, notes, ...), not just
    // when the species identity actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [crops, formData.variety, formData.crop_species, formData.crop_display_name, formData.name],
  );
  const showVarietyValueLegend = Boolean(formData.variety && selectedSpeciesCrop);
  // A Sorte linked to a crop species takes crop family, nutrient demand and
  // rotation break from its general Kultur — those fields describe the species,
  // so the form shows them read-only here and they are edited on the Kultur.
  const isSpeciesLinkedVariety = isProjectForm
    && formKind === 'variety'
    && Boolean(formData.crop_species);
  const getFieldTooltipProps: GetVarietyFieldTooltipProps = useCallback((fields, helpText) => {
    if (!selectedSpeciesCrop) {
      return null;
    }
    const fieldList = Array.isArray(fields) ? fields : [fields];
    const active = fieldList.some((field) => getVarietyOwnValueSource(formData, selectedSpeciesCrop, field) === 'ownValue');
    return {
      sx: active ? varietySpecificFieldHighlightSx : undefined,
      tooltipTitle: buildVarietyFieldTooltipTitle(t, active, helpText),
    };
  }, [selectedSpeciesCrop, formData, t]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicateErrorKey, setDuplicateErrorKey] = useState<string>('');
  const [isDuplicateChecking, setIsDuplicateChecking] = useState(false);
  const [publicCropSearchTerm, setPublicCropSearchTerm] = useState('');
  const {
    nameOptions,
    nameOptionsLoading,
    matchedNameOption,
    varietyPublicCrops,
    varietyOptions,
    varietyOptionsLoading,
    loadedVarietySpeciesId,
  } = usePublicCropSuggestions({
    enabled: isProjectForm,
    searchTerm: publicCropSearchTerm,
    nameText: formData.name,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [supplierOptions, setSupplierOptions] = useState<Supplier[]>([]);
  const [seedRateUnitConstraints, setSeedRateUnitConstraints] = useState<SeedRateUnitConstraints | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isValid, setIsValid] = useState(true);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [supplierCreateTargetIndex, setSupplierCreateTargetIndex] = useState<number | null>(null);
  const isSavingRef = useRef(false);
  const [userInteracted, setUserInteracted] = useState(false);
  const createSupplierButtonRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const dialogContentRef = useDialogKeyboardScroll(true);
  const formRef = useRef<HTMLFormElement | null>(null);
  const supplierOptionsRef = useRef<Supplier[]>([]);
  const duplicateCheckSequenceRef = useRef(0);
  // Crop species whose general ("no variety") library entry should be applied
  // as soon as that species' entries finish loading. Set when the user picks a
  // Name suggestion; the species entries are fetched by the variety-options
  // effect anyway, so this avoids a second request for the same rows.
  const pendingSpeciesPrefillRef = useRef<number | null>(null);
  // isDirty alone would also fire for purely programmatic state changes (e.g.
  // auto-selecting a public crop template); userInteracted is set at every
  // real edit site, so pairing it here keeps "unsaved changes" tied to an
  // actual user edit instead of any isDirty(true) call.
  const hasUnsavedChanges = (isDirty && userInteracted) || hasExternalChanges;

  // Move focus to the first input after MUI's FocusTrap has settled
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const firstInput = formRef.current?.querySelector<HTMLInputElement>('input:not([type="hidden"])');
      firstInput?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const loadSuppliers = useCallback(async (): Promise<Supplier[]> => {
    try {
      const response = await supplierAPI.list();
      const nextSuppliers = response.data.results || [];
      const previousIds = new Set(supplierOptionsRef.current.map((supplier) => supplier.id).filter((id): id is number => typeof id === 'number'));
      const newestSupplier = [...nextSuppliers].reverse().find((supplier) => typeof supplier.id === 'number' && !previousIds.has(supplier.id));

      supplierOptionsRef.current = nextSuppliers;
      setSupplierOptions(nextSuppliers);

      if (newestSupplier?.id) {
        setFormData((prev) => {
          const rows = prev.supplier_data ?? [];
          let hasChanges = false;
          const nextRows = rows.map((row) => {
            const hasSupplier = typeof row.supplier_id === 'number' || typeof row.supplier?.id === 'number';
            if (hasSupplier || !hasSupplierInformation(row)) {
              return row;
            }
            hasChanges = true;
            return {
              ...row,
              supplier_id: newestSupplier.id,
              supplier_name: newestSupplier.name,
              supplier_name_input: undefined,
            };
          });

          if (!hasChanges) {
            return prev;
          }

          return {
            ...prev,
            supplier_data: nextRows,
          };
        });
      }
      return nextSuppliers;
    } catch {
      supplierOptionsRef.current = [];
      setSupplierOptions([]);
      return [];
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setFormData(buildInitialFormData(crop, initialDraft));
    setFirstVarietyName('');
    setFirstVarietyPublicCrop(null);
    pendingSpeciesPrefillRef.current = null;
    setErrors({});
    setDuplicateErrorKey('');
    setIsDuplicateChecking(false);
    setPublicCropSearchTerm('');
    setIsDirty(false);
    setIsValid(true);
    setHasSubmitted(false);
    setSaveError('');
    setSupplierCreateTargetIndex(null);
    isSavingRef.current = false;
    setUserInteracted(false);
  }, [crop, initialDraft]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!showSupplierDataSection) {
      supplierOptionsRef.current = [];
      queueMicrotask(() => setSupplierOptions([]));
      return undefined;
    }

    queueMicrotask(() => {
      void loadSuppliers();
    });

    const onWindowFocus = () => {
      void loadSuppliers();
    };

    window.addEventListener('focus', onWindowFocus);
    return () => window.removeEventListener('focus', onWindowFocus);
  }, [loadSuppliers, showSupplierDataSection]);

  useEffect(() => {
    let cancelled = false;
    cropAPI.seedRateConstraints()
      .then((response) => {
        if (!cancelled) {
          setSeedRateUnitConstraints(response.data.units);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSeedRateUnitConstraints(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Validate on every change
  const validateAndSet = useCallback((draft: Partial<Crop>, mode: 'live' | 'submit' = hasSubmitted ? 'submit' : 'live') => {
    const result = validateCrop(draft, t, mode, requireVariety, seedRateUnitConstraints);
    setErrors(result.errors);
    setIsValid(result.isValid);
    return result.isValid;
  }, [hasSubmitted, requireVariety, seedRateUnitConstraints, t]);

  useEffect(() => {
    if (!isProjectForm) {
      queueMicrotask(() => {
        setDuplicateErrorKey('');
        setIsDuplicateChecking(false);
      });
      return undefined;
    }

    const name = formData.name ?? '';
    const variety = formData.variety ?? '';
    const identityKey = formKind === 'crop'
      ? normalizeCropIdentityValue(name)
      : buildCropIdentityKey(name, variety);
    const originalIdentityKey = formKind === 'crop'
      ? normalizeCropIdentityValue(crop?.crop_display_name ?? crop?.name)
      : buildCropIdentityKey(
        crop?.crop_display_name ?? crop?.name,
        crop?.variety,
      );
    const currentSequence = duplicateCheckSequenceRef.current + 1;
    duplicateCheckSequenceRef.current = currentSequence;
    queueMicrotask(() => setDuplicateErrorKey(''));

    if (!identityKey) {
      queueMicrotask(() => setIsDuplicateChecking(false));
      return;
    }

    if (crop?.id && identityKey === originalIdentityKey) {
      queueMicrotask(() => setIsDuplicateChecking(false));
      return;
    }

    queueMicrotask(() => setIsDuplicateChecking(true));
    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => {
      cropAPI.duplicateCheck(
        {
          name,
          variety,
          exclude_id: crop?.id,
        },
        abortController.signal,
      )
        .then((response) => {
          if (duplicateCheckSequenceRef.current !== currentSequence) {
            return;
          }
          if (formKind === 'crop' && !hasFirstVarietyName && response.data.name_exists) {
            setDuplicateErrorKey('form.cropNameConflict');
            return;
          }
          setDuplicateErrorKey(response.data.exists ? 'form.duplicateNameVariety' : '');
        })
        .catch(() => {
          if (
            duplicateCheckSequenceRef.current !== currentSequence
            || abortController.signal.aborted
          ) {
            return;
          }
          setDuplicateErrorKey('');
        })
        .finally(() => {
          if (duplicateCheckSequenceRef.current === currentSequence) {
            setIsDuplicateChecking(false);
          }
        });
    }, DUPLICATE_CHECK_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
      abortController.abort();
    };
  }, [crop?.id, crop?.crop_display_name, crop?.name, crop?.variety, formData.name, formData.variety, formKind, hasFirstVarietyName, isProjectForm]);

  // Creating a second crop under a name the project already uses is almost
  // always meant as "add another variety of that crop". The hint offers that
  // route without blocking a deliberate free-text duplicate.
  const existingPrivateCrop = useMemo<Crop | null>(() => {
    if (!showFirstVarietyField || !onSwitchToAddVariety || !crops?.length) {
      return null;
    }
    const normalizedName = normalizeIdentityValue(formData.name);
    if (!normalizedName) {
      return null;
    }
    const matches = crops.filter((candidate) => (
      typeof candidate.id === 'number' && normalizeIdentityValue(candidate.name) === normalizedName
    )) as Crop[];
    if (!matches.length) {
      return null;
    }
    // The species-level row ("no variety") is the correct parent for the
    // "+ Add variety" flow; fall back to any match for crops that only ever
    // got variety rows.
    return matches.find((candidate) => !(candidate.variety || '').trim()) ?? matches[0];
  }, [crops, formData.name, onSwitchToAddVariety, showFirstVarietyField]);

  const handleSwitchToAddVariety = useCallback(() => {
    if (existingPrivateCrop) {
      onSwitchToAddVariety?.(existingPrivateCrop);
    }
  }, [existingPrivateCrop, onSwitchToAddVariety]);

  // Handle field changes
  // Strongly typed change handler
  const handleChange = <K extends keyof Crop>(name: K, value: Crop[K]) => {
    setFormData((prev) => {
      const updated = { ...prev, [name]: value };
      setIsDirty(true);
      setUserInteracted(true);
      setSaveError('');
      if (name === 'name' || name === 'variety') {
        setDuplicateErrorKey('');
      }
      validateAndSet(updated);
      return updated;
    });
  };

  const handleFirstVarietyNameChange = useCallback((value: string) => {
    setFirstVarietyName(value);
    // Typing past a picked suggestion drops the library link; the name is
    // re-matched against the suggestion list only on an explicit selection.
    setFirstVarietyPublicCrop(null);
    setIsDirty(true);
    setUserInteracted(true);
  }, []);

  const handleManualPublicCropSearchChange = useCallback((value: string) => {
    setPublicCropSearchTerm(value);
  }, []);

  /**
   * Copies a public-library entry into the private draft using the very same
   * shape the "Import from library" button produces (`source_public_crop` /
   * `source_public_version` / `origin_type: 'imported'`), so the backend's
   * existing re-import/update model applies to these crops unchanged.
   *
   * `preserveVariety` keeps the variety the user already typed — species-level
   * ("general crop") entries carry an empty variety and must never clear it.
   */
  const applyPublicCropDraft = useCallback((
    publicCrop: PublicCrop,
    { preserveVariety = false }: { preserveVariety?: boolean } = {},
  ) => {
    setPublicCropSearchTerm(getPublicCropDraftName(publicCrop));
    setFormData((prev) => {
      const draft = buildDraftFromPublicCrop(publicCrop);
      const updated = {
        ...prev,
        ...draft,
        ...(preserveVariety ? { variety: prev.variety } : {}),
      };
      setIsDirty(true);
      setUserInteracted(true);
      setSaveError('');
      setDuplicateErrorKey('');
      validateAndSet(updated);
      return updated;
    });
  }, [validateAndSet]);

  const handlePublicCropSelect = useCallback((publicCrop: PublicCrop | null) => {
    if (!publicCrop) {
      setFormData((prev) => {
        const updated = {
          ...prev,
          crop_species: null,
          source_public_crop: null,
          source_public_version: null,
          origin_type: 'manual' as const,
          is_modified_from_source: false,
        };
        setIsDirty(true);
        setUserInteracted(true);
        setSaveError('');
        validateAndSet(updated);
        return updated;
      });
      return;
    }

    applyPublicCropDraft(publicCrop);
  }, [applyPublicCropDraft, validateAndSet]);

  // The one place that links a crop draft to a library species and carries
  // over its general ("no variety") fields (crop_family, spacing, seed
  // rate, ...). Every entry point that can identify a species - picking or
  // applying a Name suggestion, picking or applying a Sorte suggestion -
  // must route through this, or the crop draft silently misses the
  // species' general data (see git history: two separate Sorte entry
  // points each needed their own fix before this got unified).
  //
  // `varietyPublicCrops` only holds rows for the *currently* matched
  // species (see the fetch effect above), so if it's not that species yet,
  // the actual application is deferred: link `crop_species` immediately,
  // queue `pendingSpeciesPrefillRef`, and let the effect below finish the
  // job once the fetch for this species lands. A species without a general
  // entry stays linked by `crop_species` alone rather than copying an
  // arbitrary variety's values.
  const applySpeciesGeneralPrefill = useCallback((cropSpeciesId: number) => {
    if (formData.crop_species === cropSpeciesId) {
      return;
    }
    if (loadedVarietySpeciesId === cropSpeciesId) {
      const generalEntry = varietyPublicCrops.find((item) => (
        !(item.variety || '').trim() && !isLikelyTestPublicCropEntry(item)
      ));
      if (generalEntry) {
        applyPublicCropDraft(generalEntry, { preserveVariety: true });
        return;
      }
    }
    pendingSpeciesPrefillRef.current = cropSpeciesId;
    setFormData((prev) => {
      const updated = { ...prev, crop_species: cropSpeciesId };
      setIsDirty(true);
      setUserInteracted(true);
      setSaveError('');
      validateAndSet(updated);
      return updated;
    });
  }, [applyPublicCropDraft, formData.crop_species, loadedVarietySpeciesId, validateAndSet, varietyPublicCrops]);

  const handleNameOptionSelect = useCallback((option: { cropSpeciesId: number | null } | null) => {
    if (option?.cropSpeciesId == null) {
      pendingSpeciesPrefillRef.current = null;
      setFormData((prev) => {
        const updated = { ...prev, crop_species: null };
        setIsDirty(true);
        setUserInteracted(true);
        setSaveError('');
        validateAndSet(updated);
        return updated;
      });
      return;
    }
    applySpeciesGeneralPrefill(option.cropSpeciesId);
  }, [applySpeciesGeneralPrefill, validateAndSet]);

  // Explicit apply action for free text that matches a Name suggestion
  // exactly without having been picked from the dropdown — reuses the exact
  // same linking logic a dropdown pick triggers.
  const handleApplyNameSuggestion = useCallback(() => {
    if (matchedNameOption) {
      handleNameOptionSelect(matchedNameOption);
    }
  }, [handleNameOptionSelect, matchedNameOption]);

  useEffect(() => {
    const pendingSpeciesId = pendingSpeciesPrefillRef.current;
    if (pendingSpeciesId === null || pendingSpeciesId !== loadedVarietySpeciesId) {
      return;
    }
    pendingSpeciesPrefillRef.current = null;
    const generalEntry = varietyPublicCrops.find((item) => (
      !(item.variety || '').trim() && !isLikelyTestPublicCropEntry(item)
    ));
    if (generalEntry) {
      queueMicrotask(() => applyPublicCropDraft(generalEntry, { preserveVariety: true }));
    }
  }, [applyPublicCropDraft, loadedVarietySpeciesId, varietyPublicCrops]);

  // The library entry the typed first-variety text matches exactly. Exposed
  // separately from `firstVarietyPublicCrop` so free text that happens to
  // match a suggestion can offer an explicit "apply" action instead of
  // linking silently (see handleApplyFirstVarietySuggestion).
  const matchedFirstVarietyOption = useMemo(() => {
    const normalizedVariety = normalizeIdentityValue(firstVarietyName);
    return normalizedVariety
      ? varietyPublicCrops.find((item) => normalizeIdentityValue(item.variety) === normalizedVariety)
      : undefined;
  }, [firstVarietyName, varietyPublicCrops]);

  // The crop dialog's optional first variety is a separate crop created
  // after the crop, so picking a suggestion only records which library entry
  // it came from — the draft is built at save time. Only an explicit dropdown
  // pick (reason === 'selectOption') links the library entry; free text that
  // happens to match exactly is offered via handleApplyFirstVarietySuggestion
  // instead, so nothing is taken over silently. Either way, route the match
  // through applySpeciesGeneralPrefill so the parent crop draft also gets the
  // species' general fields, not just the variety row built at save time.
  const handleFirstVarietyCommit = useCallback((variety: string, reason?: AutocompleteChangeReason) => {
    setFirstVarietyName(variety);
    const matched = reason === 'selectOption' && variety.trim()
      ? varietyPublicCrops.find((item) => (
        normalizeIdentityValue(item.variety) === normalizeIdentityValue(variety)
      )) ?? null
      : null;
    setFirstVarietyPublicCrop(matched);
    if (matched?.crop_species != null) {
      applySpeciesGeneralPrefill(matched.crop_species);
    }
    setIsDirty(true);
    setUserInteracted(true);
  }, [applySpeciesGeneralPrefill, varietyPublicCrops]);

  const handleApplyFirstVarietySuggestion = useCallback(() => {
    if (!matchedFirstVarietyOption) return;
    setFirstVarietyPublicCrop(matchedFirstVarietyOption);
    if (matchedFirstVarietyOption.crop_species != null) {
      applySpeciesGeneralPrefill(matchedFirstVarietyOption.crop_species);
    }
    setIsDirty(true);
    setUserInteracted(true);
  }, [applySpeciesGeneralPrefill, matchedFirstVarietyOption]);

  // The library entry the typed variety text matches exactly. Same purpose as
  // matchedFirstVarietyOption above, for the "add variety to existing crop" form.
  const matchedVarietyOption = useMemo(() => {
    const normalizedVariety = normalizeIdentityValue(formData.variety);
    return normalizedVariety
      ? varietyPublicCrops.find((item) => normalizeIdentityValue(item.variety || '') === normalizedVariety)
      : undefined;
  }, [formData.variety, varietyPublicCrops]);

  // Only an explicit dropdown pick applies library values automatically; free
  // text that happens to match exactly is offered via
  // handleApplyVarietySuggestion instead (see matchedVarietyOption above).
  const handleVarietyCommit = useCallback((variety: string, reason?: AutocompleteChangeReason) => {
    const matchedCrop = reason === 'selectOption' && variety.trim()
      ? varietyPublicCrops.find((item) => normalizeIdentityValue(item.variety || '') === normalizeIdentityValue(variety))
      : undefined;
    if (matchedCrop) {
      handlePublicCropSelect(matchedCrop);
      return;
    }
    setFormData((prev) => {
      const updated = { ...prev, variety };
      setIsDirty(true);
      setUserInteracted(true);
      setSaveError('');
      setDuplicateErrorKey('');
      validateAndSet(updated);
      return updated;
    });
  }, [handlePublicCropSelect, validateAndSet, varietyPublicCrops]);

  const handleApplyVarietySuggestion = useCallback(() => {
    if (matchedVarietyOption) {
      handlePublicCropSelect(matchedVarietyOption);
    }
  }, [handlePublicCropSelect, matchedVarietyOption]);

  // "Matched, but not linked yet" flags for the explicit apply hints below —
  // formData.crop_species/source_public_crop and firstVarietyPublicCrop
  // only get set via an actual dropdown pick, so a match without a link means
  // the current text was typed rather than chosen from the suggestion list.
  const showNameApplyHint = isProjectForm && Boolean(matchedNameOption) && !formData.crop_species;
  const showVarietyApplyHint = isProjectForm && showVarietyField && Boolean(matchedVarietyOption)
    && formData.source_public_crop !== matchedVarietyOption?.id;
  const showFirstVarietyApplyHint = isProjectForm && showFirstVarietyField && Boolean(matchedFirstVarietyOption)
    && firstVarietyPublicCrop?.id !== matchedFirstVarietyOption?.id;

  // Tab/Shift+Tab inside this dialog is MUI's `Dialog` focus trap's job; Tab
  // out of an open Select dropdown belongs to `TypeaheadSelect`. Do not add a
  // second trap here — see docs/keyboard-architecture.md.

  // Handle manual save (for Save button)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingRef.current) return;
    if (isEdit && !hasExternalChanges && !hasEffectiveCropFormChanges(buildInitialFormData(crop, initialDraft), formData)) {
      onCancel();
      return;
    }
    setHasSubmitted(true);
    if (!validateAndSet(formData, 'submit')) return;
    if (showSupplierDataSection && hasSupplierDataRowMissingSupplier(formData.supplier_data)) {
      setSaveError(t('form.supplierDataMissingSupplier'));
      return;
    }
    if (duplicateErrorKey || isDuplicateChecking) return;
    isSavingRef.current = true;
    setIsSaving(true);
    try {
      // The form shows the variety's inherited crop values — prefilled from the
      // crop when adding one (see Crops.tsx `handleAddVariety`), resolved by
      // the backend when editing one — purely so the user can see what the
      // variety effectively is. Any field left matching that baseline is
      // stripped back to empty here so the variety keeps inheriting from the
      // crop (including future crop edits) instead of freezing a duplicate copy
      // of today's crop values.
      const inheritanceBaseline = isEdit ? buildInheritedValueBaseline(crop) : initialDraft;
      const dataToSave = inheritanceBaseline
        ? stripValuesMatchingBaseline(
          formData,
          inheritanceBaseline,
          (field) => (field in EMPTY_CROP ? EMPTY_CROP[field as keyof typeof EMPTY_CROP] : ''),
        )
        : formData;
      await saveCrop(dataToSave);
      setSaveError('');
      setIsDirty(false);
      setHasSubmitted(false);
    } catch (error) {
      setSaveError(extractApiErrorMessage(error, t, t('messages.updateError')));
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  const supplierRows = formData.supplier_data ?? [];
  const duplicateErrorField = duplicateErrorKey === 'form.cropNameConflict' ? 'name' : 'variety';
  const displayErrors = duplicateErrorKey
    ? { ...errors, [duplicateErrorField]: errors[duplicateErrorField] || t(duplicateErrorKey) }
    : errors;
  const isSaveDisabled = isSaving || !isValid || Boolean(duplicateErrorKey) || isDuplicateChecking;
  const saveDisabledTooltip = duplicateErrorKey === 'form.cropNameConflict'
    ? t('form.cropNameConflict')
    : '';
  const isSupplierCreateDialogOpen = supplierCreateTargetIndex !== null;

  const handleCreateSupplierClick = useCallback((supplierIndex: number): void => {
    setSupplierCreateTargetIndex(supplierIndex);
  }, []);

  const handleCloseSupplierCreateDialog = useCallback((): void => {
    const targetIndex = supplierCreateTargetIndex;
    setSupplierCreateTargetIndex(null);
    window.setTimeout(() => {
      const createButton = targetIndex === null ? null : createSupplierButtonRefs.current[targetIndex];
      if (createButton?.isConnected) {
        createButton.focus();
        return;
      }

      const supplierFields = Array.from(document.querySelectorAll<HTMLElement>('[role="combobox"]'));
      supplierFields[targetIndex ?? 0]?.focus();
    }, 0);
  }, [supplierCreateTargetIndex]);

  const mergeSupplierOption = useCallback((createdSupplier: Supplier): void => {
    supplierOptionsRef.current = [
      ...supplierOptionsRef.current.filter((supplier) => supplier.id !== createdSupplier.id),
      createdSupplier,
    ];
    setSupplierOptions(supplierOptionsRef.current);
  }, []);

  const handleSupplierCreated = useCallback(async (createdSupplier: Supplier): Promise<void> => {
    const createdSupplierId = createdSupplier.id;
    if (typeof createdSupplierId !== 'number') {
      setSaveError(t('form.supplierCreateSelectionError'));
      return;
    }

    mergeSupplierOption(createdSupplier);

    setFormData((prev) => {
      const rows = prev.supplier_data ?? [];
      if (supplierCreateTargetIndex === null || !rows[supplierCreateTargetIndex]) {
        setSaveError(t('form.supplierCreateSelectionError'));
        return prev;
      }

      const nextRows = rows.map((row, rowIndex) => (
        rowIndex === supplierCreateTargetIndex
          ? {
            ...row,
            supplier_id: createdSupplierId,
            supplier: createdSupplier,
            supplier_name: createdSupplier.name,
            supplier_name_input: undefined,
          }
          : row
      ));

      setIsDirty(true);
      setUserInteracted(true);
      setSaveError('');
      validateAndSet({ ...prev, supplier_data: nextRows });
      return {
        ...prev,
        supplier_data: nextRows,
      };
    });

    const refreshedSuppliers = await loadSuppliers();
    if (!refreshedSuppliers.some((supplier) => supplier.id === createdSupplierId)) {
      mergeSupplierOption(createdSupplier);
    }
  }, [loadSuppliers, mergeSupplierOption, supplierCreateTargetIndex, t, validateAndSet]);

  const getActiveSaveShortcutElement = useCallback((): HTMLElement | null => {
    const formElement = formRef.current;
    const dialogElement = formElement?.closest('[role="dialog"]') as HTMLElement | null;
    if (!formElement || !dialogElement || showDiscardConfirm || isSupplierCreateDialogOpen) {
      return null;
    }

    const openDialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
      .filter((element) => element.getAttribute('aria-hidden') !== 'true');
    const topDialog = openDialogs.at(-1);
    if (topDialog && topDialog !== dialogElement) {
      return null;
    }

    return formElement;
  }, [isSupplierCreateDialogOpen, showDiscardConfirm]);

  const submitActiveForm = useCallback((): void => {
    formRef.current?.requestSubmit();
  }, []);

  useActiveSaveShortcut({
    enabled: true,
    disabled: isSaveDisabled,
    getActiveElement: getActiveSaveShortcutElement,
    onSave: submitActiveForm,
  });

  const updateSupplierRow = (index: number, patch: Record<string, unknown>) => {
    const nextRows = supplierRows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row));
    handleChange('supplier_data', nextRows);
  };
  const addSupplierRow = () => {
    handleChange('supplier_data', [...supplierRows, { supplier_name_input: '', packaging_sizes: [] }]);
  };
  const removeSupplierRow = (index: number) => {
    handleChange('supplier_data', supplierRows.filter((_row, rowIndex) => rowIndex !== index));
  };
  const addPackageRow = (supplierIndex: number) => {
    const currentPackages = supplierRows[supplierIndex]?.packaging_sizes ?? [];
    updateSupplierRow(supplierIndex, { packaging_sizes: [...currentPackages, { size_value: 0, size_unit: 'g' }] });
  };
  const updatePackageRow = (supplierIndex: number, packageIndex: number, patch: Record<string, unknown>) => {
    const currentPackages = supplierRows[supplierIndex]?.packaging_sizes ?? [];
    const nextPackages = currentPackages.map((pkg, index) => (index === packageIndex ? { ...pkg, ...patch } : pkg));
    updateSupplierRow(supplierIndex, { packaging_sizes: nextPackages });
  };
  const removePackageRow = (supplierIndex: number, packageIndex: number) => {
    const currentPackages = supplierRows[supplierIndex]?.packaging_sizes ?? [];
    updateSupplierRow(supplierIndex, { packaging_sizes: currentPackages.filter((_pkg, index) => index !== packageIndex) });
  };

  return (
    <Dialog
      open
      onClose={(_event, reason) => {
        if (reason === 'backdropClick') return;
        if (isSupplierCreateDialogOpen && reason === 'escapeKeyDown') return;
        if (hasUnsavedChanges) {
          setShowDiscardConfirm(true);
        } else {
          onCancel();
        }
      }}
      aria-labelledby="crop-form-dialog-title"
      maxWidth="md"
      fullWidth
    >
      <form ref={formRef} onSubmit={handleSubmit}>
        <DialogTitle id="crop-form-dialog-title">
          {title ?? (
            isProjectForm && formKind === 'variety'
              ? (isEdit ? t('form.editVarietyTitle') : t('form.createVarietyTitle'))
              : (isEdit ? t('form.editTitle') : t('form.createTitle'))
          )}
        </DialogTitle>
        <DialogContent
          ref={dialogContentRef}
          dividers
          sx={{
            maxHeight: '70vh',
            overscrollBehavior: 'contain',
            '&:focus': {
              outline: 'none',
            },
          }}
          tabIndex={-1}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 }}>
            <Typography variant="h6">{t('form.generalInfoSectionTitle')}</Typography>
            {!isProjectForm ? (
              <Box
                sx={{
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                  px: 1.5,
                  py: 1.25,
                  bgcolor: 'action.hover',
                }}
              >
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>
                  {t('form.publicCropIdentityLabel')}
                </Typography>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
                  {cropIdentityLabel || t('noData')}
                </Typography>
                {typeof importedCopiesCount === 'number' ? (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    {t('form.publicCropImportedCopiesCount', { count: importedCopiesCount })}
                  </Typography>
                ) : null}
              </Box>
            ) : null}
            {showVarietyValueLegend ? (
              <VarietyValueLegend
                sampleLabel={t('hierarchy.ownValueLegendSample')}
                description={t('hierarchy.ownValueLegendDescription')}
              />
            ) : null}
            <BasicInfoSection
              formData={formData}
              errors={displayErrors}
              onChange={handleChange}
              t={t}
              getFieldTooltipProps={getFieldTooltipProps}
              speciesInvariantFieldsReadOnly={isSpeciesLinkedVariety}
              showIdentityFields={isProjectForm}
              showVarietyField={showVarietyField}
              varietyRequired={isProjectForm}
              varietyReadOnly={!isProjectForm && publicIdentityReadOnly}
              showFirstVarietyField={showFirstVarietyField}
              firstVarietyName={firstVarietyName}
              onFirstVarietyNameChange={handleFirstVarietyNameChange}
              firstVarietyOptions={isProjectForm ? varietyOptions : undefined}
              firstVarietyOptionsLoading={varietyOptionsLoading}
              onFirstVarietyCommit={isProjectForm ? handleFirstVarietyCommit : undefined}
              firstVarietyApplyHint={showFirstVarietyApplyHint && matchedFirstVarietyOption ? (
                <PublicCropApplyHint
                  hintText={t('form.publicCropApplyHint', { name: matchedFirstVarietyOption.variety || firstVarietyName })}
                  actionLabel={t('form.publicCropApplyAction')}
                  onApply={handleApplyFirstVarietySuggestion}
                />
              ) : null}
              firstVarietySourceHint={firstVarietyPublicCrop ? (
                <PublicCropSourceHint text={t('form.firstVarietySourceHint')} />
              ) : null}
              existingCropHint={existingPrivateCrop ? (
                <Alert
                  severity="info"
                  data-testid="crop-existing-crop-hint"
                  action={!hasFirstVarietyName ? (
                    <Button color="inherit" size="small" onClick={handleSwitchToAddVariety}>
                      {t('form.existingCropAddVarietyAction')}
                    </Button>
                  ) : undefined}
                >
                  {hasFirstVarietyName
                    ? t('form.existingCropFirstVarietyHint', {
                      variety: firstVarietyName.trim(),
                      name: existingPrivateCrop.name,
                    })
                    : t('form.existingCropHint', { name: existingPrivateCrop.name })}
                </Alert>
              ) : null}
              nameOptions={isProjectForm ? nameOptions : undefined}
              nameOptionsLoading={nameOptionsLoading}
              onNameSearchChange={isProjectForm ? handleManualPublicCropSearchChange : undefined}
              onNameOptionSelect={isProjectForm ? handleNameOptionSelect : undefined}
              nameApplyHint={showNameApplyHint && matchedNameOption ? (
                <PublicCropApplyHint
                  hintText={t('form.publicCropApplyHint', { name: matchedNameOption.name })}
                  actionLabel={t('form.publicCropApplyAction')}
                  onApply={handleApplyNameSuggestion}
                />
              ) : null}
              varietyOptions={isProjectForm ? varietyOptions : undefined}
              varietyOptionsLoading={varietyOptionsLoading}
              onVarietyCommit={isProjectForm ? handleVarietyCommit : undefined}
              varietyApplyHint={showVarietyApplyHint && matchedVarietyOption ? (
                <PublicCropApplyHint
                  hintText={t('form.publicCropApplyHint', { name: matchedVarietyOption.variety || formData.variety || '' })}
                  actionLabel={t('form.publicCropApplyAction')}
                  onApply={handleApplyVarietySuggestion}
                />
              ) : null}
              identityRowControl={showCopyValuesToCropCheckbox ? (
                <AppTooltip
                  title={copyValuesToCropDisabled ? t('form.copyValuesToCropDisabledTooltip') : ''}
                  placement="top-start"
                >
                  <Box
                    component="span"
                    sx={(theme) => ({
                      alignSelf: 'flex-start',
                      opacity: copyValuesToCropDisabled ? theme.palette.action.disabledOpacity : 1,
                    })}
                  >
                    <FormControlLabel
                      disabled={copyValuesToCropDisabled}
                      control={(
                        <Checkbox
                          checked={copyValuesToCrop}
                          disabled={copyValuesToCropDisabled}
                          onChange={(event) => {
                            setCopyValuesToCrop(event.target.checked);
                            setIsDirty(true);
                            setUserInteracted(true);
                          }}
                        />
                      )}
                      label={t('form.copyValuesToCrop')}
                    />
                  </Box>
                </AppTooltip>
              ) : null}
              identityHint={isProjectForm && formData.source_public_crop && !hasFirstVarietyName ? (
                <PublicCropSourceHint text={t('form.publicCropSourceHint')} />
              ) : null}
            />
            <TimingSection formData={formData} errors={errors} onChange={handleChange} t={t} getFieldTooltipProps={getFieldTooltipProps} />
            <HarvestSection formData={formData} errors={errors} onChange={handleChange} t={t} getFieldTooltipProps={getFieldTooltipProps} />
            <SpacingSection formData={formData} errors={errors} onChange={handleChange} t={t} getFieldTooltipProps={getFieldTooltipProps} />
            <SeedingSection
              formData={formData}
              errors={errors}
              onChange={handleChange}
              t={t}
              getFieldTooltipProps={getFieldTooltipProps}
              seedRateUnitConstraints={seedRateUnitConstraints}
              showSeedSafetyMargin={isProjectForm}
            />
            <ColorSection formData={formData} errors={errors} onChange={handleChange} t={t} defaultColor={DEFAULT_DISPLAY_COLOR} />
            {isProjectForm ? (
              <NotesSection formData={formData} onChange={handleChange} t={t} errors={errors} />
            ) : null}
            {extraSections}
            {showSupplierDataSection ? (
              <Box
                data-testid="crop-supplier-data-section"
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: SUPPLIER_SECTION_GAP,
                  mt: 1,
                }}
              >
                <Typography variant="h6">{t('form.supplierDataSectionTitle')}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('form.supplierDataSectionDescription')}
                </Typography>
                {supplierRows.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    {t('form.noSupplierDataRows')}
                  </Typography>
                ) : null}
                {supplierRows.map((row, supplierIndex) => {
                  const selectedSupplierId = row.supplier_id ?? row.supplier?.id ?? null;
                  const availableSupplierIds = new Set(supplierOptions.map((supplier) => supplier.id));
                  const hasSelectedSupplier = typeof selectedSupplierId === 'number';
                  const isSelectedSupplierAvailable = hasSelectedSupplier && availableSupplierIds.has(selectedSupplierId);
                  const selectValue = isSelectedSupplierAvailable ? String(selectedSupplierId) : '';
                  const hasSupplierOptions = supplierOptions.length > 0;
                  // Supplier-specific inputs stay unmounted until a supplier is picked so the
                  // section never reserves height for fields that cannot be filled in yet.
                  const showSupplierFields = hasSupplierOptions && isSelectedSupplierAvailable;

                  return (
                    <Box
                      key={`supplier-row-${supplierIndex}`}
                      data-testid="crop-supplier-data-row"
                      sx={{
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1,
                        p: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: SUPPLIER_SECTION_GAP,
                        minHeight: 0,
                        flexGrow: 0,
                      }}
                    >
                      {hasSupplierOptions ? (
                        <FormControl size="small" sx={mediumStackedFieldSx}>
                          <InputLabel shrink>{t('form.supplier')}</InputLabel>
                          <Select
                            fullWidth
                            value={selectValue}
                            label={t('form.supplier')}
                            renderValue={(selected) => {
                              if (!selected) {
                                return (
                                  <Typography component="span" color="text.secondary">
                                    {t('form.supplierPlaceholder')}
                                  </Typography>
                                );
                              }
                              const selectedSupplier = supplierOptions.find((supplier) => String(supplier.id) === String(selected));
                              return selectedSupplier?.name ?? '';
                            }}
                            onChange={(event) => {
                              const selectedValue = String(event.target.value ?? '');

                              const parsedSupplierId = Number(selectedValue);
                              const selectedSupplier = supplierOptions.find((supplier) => supplier.id === parsedSupplierId);
                              updateSupplierRow(supplierIndex, {
                                supplier_id: parsedSupplierId,
                                supplier: selectedSupplier,
                                supplier_name_input: selectedSupplier ? undefined : row.supplier_name_input,
                                supplier_name: selectedSupplier?.name ?? row.supplier_name,
                              });
                            }}
                            displayEmpty
                          >
                            {supplierOptions.map((supplier) => (
                              <MenuItem key={supplier.id} value={String(supplier.id)}>{supplier.name}</MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      ) : (
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: { xs: 'stretch', sm: 'center' },
                            justifyContent: 'space-between',
                            gap: 1,
                            flexDirection: { xs: 'column', sm: 'row' },
                            border: '1px solid',
                            borderColor: 'surface.surfaceSoftBorder',
                            borderRadius: 1,
                            bgcolor: 'surface.surfaceSubtleBackground',
                            px: 1.5,
                            py: 1.25,
                          }}
                        >
                          <Typography variant="body2" color="text.secondary">
                            {t('form.noSuppliers')}
                          </Typography>
                          <Button
                            ref={(element) => {
                              createSupplierButtonRefs.current[supplierIndex] = element;
                            }}
                            variant="outlined"
                            size="small"
                            onClick={() => handleCreateSupplierClick(supplierIndex)}
                          >
                            {t('form.createSuppliers')}
                          </Button>
                        </Box>
                      )}
                      {hasSupplierOptions && !showSupplierFields ? (
                        <Box
                          data-testid="crop-supplier-data-hint"
                          sx={{
                            border: '1px solid',
                            borderColor: 'surface.surfaceSoftBorder',
                            borderRadius: 1,
                            bgcolor: 'surface.surfaceSubtleBackground',
                            px: 1.5,
                            py: 1,
                          }}
                        >
                          <Typography variant="body2" color="text.secondary">
                            {t('form.supplierDataSelectSupplierHint')}
                          </Typography>
                        </Box>
                      ) : null}
                      {showSupplierFields ? (
                        <>
                          <TextField
                            label={t('form.supplierProductNameLabel')}
                            value={row.supplier_product_name ?? ''}
                            onChange={(event) => updateSupplierRow(supplierIndex, { supplier_product_name: event.target.value })}
                            sx={wideSingleColumnFieldSx}
                          />
                          <Typography variant="subtitle2">{t('form.seedPackagesLabel')}</Typography>
                          {(row.packaging_sizes ?? []).map((pkg, packageIndex) => (
                            <Box
                              key={`pkg-${supplierIndex}-${packageIndex}`}
                              sx={{ ...formRowSx, gap: 1, alignItems: 'center' }}
                            >
                              <TextField
                                label={t('form.seedAmountLabel')}
                                type="number"
                                value={pkg.size_value}
                                onChange={(event) => updatePackageRow(supplierIndex, packageIndex, { size_value: Number(event.target.value) || 0 })}
                                sx={compactFieldSx}
                                slotProps={{ htmlInput: { inputMode: pkg.size_unit === 'seeds' ? 'numeric' : 'decimal' } }}
                              />
                              <Select
                                value={pkg.size_unit}
                                onChange={(event) => updatePackageRow(supplierIndex, packageIndex, { size_unit: event.target.value })}
                                size="small"
                                sx={smallFieldSx}
                              >
                                <MenuItem value="g">{t('form.packageUnitGram')}</MenuItem>
                                <MenuItem value="seeds">{t('form.packageUnitSeeds')}</MenuItem>
                              </Select>
                              <IconButton
                                color="error"
                                onClick={() => removePackageRow(supplierIndex, packageIndex)}
                                aria-label={t('form.removeSeedPackageAriaLabel')}
                              >
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </Box>
                          ))}
                        </>
                      ) : null}
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {showSupplierFields ? (
                          <Button variant="outlined" onClick={() => addPackageRow(supplierIndex)}>{t('form.addSeedPackage')}</Button>
                        ) : null}
                        <Button variant="outlined" color="error" onClick={() => removeSupplierRow(supplierIndex)}>{t('form.removeSupplierData')}</Button>
                      </Box>
                    </Box>
                  );
                })}
                <Button variant="outlined" onClick={addSupplierRow}>{t('form.addSupplierData')}</Button>
              </Box>
            ) : null}
          </div>
        </DialogContent>
        <DialogActions sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end', alignItems: 'center', mt: 1, flexWrap: 'wrap' }}>
          {saveError ? (
            <Alert severity="error" sx={{ width: '100%' }}>
              {saveError}
            </Alert>
          ) : null}
          {hasUnsavedChanges && (
            <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
              {isValid && !duplicateErrorKey
                ? t('messages.unsavedChanges')
                : t('messages.fixErrors')}
            </Typography>
          )}
          <Button variant="outlined" onClick={() => {
            if (hasUnsavedChanges) {
              setShowDiscardConfirm(true);
            } else {
              onCancel();
            }
          }} disabled={isSaving}>
            {t('form.cancel')}
          </Button>
          <AppTooltip title={saveDisabledTooltip}>
            <Box component="span">
              <Button
                type="submit"
                variant="contained"
                disabled={isSaveDisabled}
              >
                {isSaving
                  ? t('messages.saving')
                  : isEdit ? t('form.save') : t('form.create')}
              </Button>
            </Box>
          </AppTooltip>
        </DialogActions>
      </form>
      <ConfirmationDialog
        open={showDiscardConfirm}
        title={t('form.discardChangesTitle')}
        message={t('form.discardChangesMessage')}
        cancelLabel={t('form.discardCancel')}
        confirmLabel={t('form.discardConfirm')}
        onCancel={() => setShowDiscardConfirm(false)}
        onConfirm={() => {
          setShowDiscardConfirm(false);
          onCancel();
        }}
        cancelButtonProps={{ autoFocus: true }}
        confirmButtonProps={{ variant: 'contained', color: 'error' }}
      />
      {showSupplierDataSection ? (
        <SupplierFormDialog
          open={isSupplierCreateDialogOpen}
          title={t('form.createSuppliers')}
          submitLabel={t('form.createSuppliers')}
          onClose={handleCloseSupplierCreateDialog}
          onSaved={handleSupplierCreated}
        />
      ) : null}
    </Dialog>
  );
}
