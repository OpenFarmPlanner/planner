import { useCallback, useEffect, useMemo, useState } from 'react';

import { cropCompanionAPI } from '../api/api';
import type { Crop, PublicCropCompanion } from '../api/types';
import {
  findCompanionRowErrors,
  findKulturId,
  libraryItemToFormRow,
  relationToFormRow,
  sameCompanionRows,
  type CompanionFormRow,
  type CompanionFormRowError,
  type CompanionFormTarget,
} from './companions';
import { usePlantFamilies } from './plantFamilies';

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
  rows: CompanionFormRow[];
  setRows: (rows: CompanionFormRow[]) => void;
  /** Neighbours the user can pick, grouped by `type`. */
  options: CompanionFormTarget[];
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
  const families = usePlantFamilies();
  const isLibrary = variant === 'publicLibrary';
  const kulturId = useMemo(() => {
    if (isLibrary || !crop?.id) return null;
    return findKulturId(crop, crops as Crop[]);
  }, [crop, crops, isLibrary]);
  const mode: CompanionFormMode = isKulturForm ? 'edit' : kulturId !== null ? 'readOnly' : 'hidden';

  const cropLabel = useCallback(
    (cropId: number): string => crops.find((entry) => entry.id === cropId)?.name ?? '',
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

  const options = useMemo<CompanionFormTarget[]>(() => {
    const familyOptions = families.families.map((family) => ({
      type: 'family' as const,
      familyKey: family.botanical_name,
      label: families.getName(family.botanical_name),
    }));
    const byLabel = (a: CompanionFormTarget, b: CompanionFormTarget) => a.label.localeCompare(b.label);
    if (isLibrary) {
      const seenSpecies = new Set<number>();
      const speciesOptions = crops.flatMap((entry) => {
        const speciesId = entry.crop_species;
        if (!speciesId || !isKulturLike(entry) || speciesId === crop?.crop_species || seenSpecies.has(speciesId)) {
          return [];
        }
        seenSpecies.add(speciesId);
        return [{ type: 'species' as const, speciesId, label: entry.name ?? '' }];
      });
      return [...speciesOptions.sort(byLabel), ...familyOptions];
    }
    const cropOptions = crops.flatMap((entry) => (
      entry.id !== undefined && entry.id !== crop?.id && isKulturLike(entry)
        ? [{ type: 'crop' as const, cropId: entry.id, label: entry.name ?? '' }]
        : []
    ));
    return [...cropOptions.sort(byLabel), ...familyOptions];
  }, [crop?.crop_species, crop?.id, crops, families, isLibrary]);

  // Family names arrive with the family catalogue, possibly after the rows.
  const labelledRows = useMemo(() => rows.map((row) => (
    row.target?.type === 'family'
      ? { ...row, target: { ...row.target, label: families.getName(row.target.familyKey) } }
      : row
  )), [families, rows]);
  const errors = useMemo(() => findCompanionRowErrors(rows), [rows]);
  const validate = useCallback((): boolean => {
    setShowErrors(true);
    return Object.keys(errors).length === 0;
  }, [errors]);

  return {
    mode,
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
