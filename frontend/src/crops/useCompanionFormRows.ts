import { useCallback, useEffect, useMemo, useState } from 'react';

import { cropCompanionAPI } from '../api/api';
import type { Crop, PublicCropCompanion } from '../api/types';
import { normalizeLanguageTag } from '../i18n/languages';
import { useTranslation } from '../i18n';
import {
  buildCompanionFormOptions,
  findCompanionRowErrors,
  findKulturId,
  libraryItemToFormRow,
  relationToFormRow,
  sameCompanionRows,
  type CompanionFormOption,
  type CompanionFormRow,
  type CompanionFormRowError,
  type CompanionNeighbor,
} from './companions';
import { usePlantFamilies } from './plantFamilies';
import { getEffectiveCropValue } from './varietyValueSource';
import { getCropDisplayName } from './cropDisplay';

/**
 * How the form shows neighbours: editable on a Kultur (or a species-level
 * library entry), read-only on a Sorte with a Kultur, else not at all.
 */
export type CompanionFormMode = 'edit' | 'readOnly' | 'hidden';

interface UseCompanionFormRowsArgs {
  variant: 'project' | 'publicLibrary';
  crop?: Crop;
  crops?: readonly Partial<Crop>[];
  /** Whether the form edits a Kultur (project) or a species-level entry (library). */
  isKulturForm: boolean;
  /** The library entry's neighbours (library form only). */
  libraryCompanions?: readonly PublicCropCompanion[];
}

export interface CompanionFormRowsState {
  mode: CompanionFormMode;
  noteLanguage?: string;
  setNoteLanguage?: (language: string) => void;
  rows: CompanionFormRow[];
  setRows: (rows: CompanionFormRow[]) => void;
  /** Neighbours the user can pick, in the order of their plant-family groups. */
  options: CompanionFormOption[];
  /** Free text is a neighbour only in a project; the library holds species and families. */
  allowFreeText: boolean;
  /** The Kultur a Sorte's read-only list belongs to. */
  kulturName: string;
  loaded: boolean;
  failed: boolean;
  dirty: boolean;
  errors: Record<string, CompanionFormRowError>;
  /** Shows the row errors; returns whether the rows can be saved. */
  validate: () => boolean;
}

const isKulturLike = (crop: Partial<Crop>): boolean => !(crop.variety || '').trim();

/** The "Mischkultur" rows of the crop form (see docs/crop-companions.md#crop-form). */
export function useCompanionFormRows({
  variant,
  crop,
  crops = [],
  isKulturForm,
  libraryCompanions,
}: UseCompanionFormRowsArgs): CompanionFormRowsState {
  const { t, i18n } = useTranslation('crops');
  const families = usePlantFamilies();
  const isLibrary = variant === 'publicLibrary';
  const [language, setLanguage] = useState(normalizeLanguageTag(i18n?.resolvedLanguage ?? i18n?.language) ?? 'de');
  const kulturId = useMemo(() => {
    if (isLibrary || !crop?.id) return null;
    return findKulturId(crop, crops as Crop[]);
  }, [crop, crops, isLibrary]);
  const mode: CompanionFormMode = isKulturForm ? 'edit' : kulturId !== null ? 'readOnly' : 'hidden';

  const cropLabel = useCallback(
    (cropId: number): string => getCropDisplayName(crops.find((entry) => entry.id === cropId) ?? {}),
    [crops],
  );
  // The form mounts once per opening, so the library entry's list is read once.
  const [initialRows, setInitialRows] = useState<CompanionFormRow[]>(() => (
    isLibrary ? (libraryCompanions ?? []).map((item) => libraryItemToFormRow(item, families.getName)) : []
  ));
  const [rows, setRows] = useState<CompanionFormRow[]>(initialRows);
  const [loaded, setLoaded] = useState(isLibrary || kulturId === null);
  const [failed, setFailed] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (isLibrary || kulturId === null) return undefined;
    let cancelled = false;
    cropCompanionAPI.listForCrop(kulturId)
      .then((response) => {
        if (cancelled) return;
        const projectRows = response.data.map((relation) => (
          relationToFormRow(relation, kulturId, cropLabel, families.getName)
        ));
        setInitialRows(projectRows);
        setRows(projectRows);
        setFailed(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error('Error loading crop companions:', error);
        setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => { cancelled = true; };
    // Loaded when the form opens for a Kultur, not on every crop-list change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLibrary, kulturId]);

  const options = useMemo<CompanionFormOption[]>(() => {
    const seenSpecies = new Set<number>();
    const neighbors = crops.filter(isKulturLike).flatMap((entry): CompanionNeighbor[] => {
      const familyKey = getEffectiveCropValue(entry, 'crop_family');
      const label = getCropDisplayName(entry);
      if (isLibrary) {
        const speciesId = entry.crop_species;
        if (!speciesId || speciesId === crop?.crop_species || seenSpecies.has(speciesId)) return [];
        seenSpecies.add(speciesId);
        return [{ target: { type: 'species', speciesId, label }, familyKey }];
      }
      return entry.id !== undefined && entry.id !== crop?.id
        ? [{ target: { type: 'crop', cropId: entry.id, label }, familyKey }]
        : [];
    });
    return buildCompanionFormOptions(
      neighbors,
      families.families.map((family) => family.botanical_name),
      families.getName,
      t('companions.form.noFamily'),
      i18n?.resolvedLanguage ?? i18n?.language,
    );
  }, [crop?.crop_species, crop?.id, crops, families, i18n?.language, i18n?.resolvedLanguage, isLibrary, t]);

  // Refresh labels without refetching relations or discarding note drafts.
  const labelledRows = useMemo(() => rows.map((row) => ({
    ...row, noteLanguage: row.noteLanguage ?? language,
    ...(row.target?.type === 'family' ? { target: { ...row.target, label: families.getName(row.target.familyKey) } }
      : row.target?.type === 'crop' ? { target: { ...row.target, label: cropLabel(row.target.cropId) } } : {}),
  })), [cropLabel, families, rows, language]);
  const errors = useMemo(() => findCompanionRowErrors(rows), [rows]);
  const validate = useCallback((): boolean => {
    setShowErrors(true);
    return Object.keys(errors).length === 0;
  }, [errors]);

  const setNoteLanguage = (next: string) => {
    const selected = normalizeLanguageTag(next);
    if (!selected) return;
    const select = (row: CompanionFormRow): CompanionFormRow => ({
      ...row, noteLanguage: selected, note: row.notes?.[selected] ?? '',
    });
    setRows((current) => current.map(select));
    setInitialRows((current) => current.map(select));
    setLanguage(selected);
  };

  return {
    mode,
    noteLanguage: language,
    setNoteLanguage,
    rows: labelledRows,
    setRows,
    options,
    allowFreeText: !isLibrary,
    kulturName: kulturId !== null ? cropLabel(kulturId) : '',
    loaded,
    failed,
    dirty: mode === 'edit' && !sameCompanionRows(initialRows, rows),
    errors: showErrors ? errors : {},
    validate,
  };
}
