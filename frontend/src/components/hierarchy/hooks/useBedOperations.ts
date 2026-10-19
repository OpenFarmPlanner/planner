/**
 * Custom hook for bed operations (CRUD)
 */

import { useCallback, useRef, useState } from 'react';
import { bedAPI, type Bed, type BulkBedCreatePayload } from '../../../api/api';
import type { TFunction } from 'i18next';
import { confirmAction } from '../../../utils/confirmAction';
import type { HierarchyRow } from '../utils/types';
import { matchesHierarchyRowPrefill } from '../utils/hierarchyRowDraft';

/** Values a new bed row starts with ("Beet hinzufügen" after an existing bed). */
export type BedPrefill = Pick<Bed, 'name' | 'length_m' | 'width_m'>;

export function useBedOperations(
  setBeds: React.Dispatch<React.SetStateAction<Bed[]>>,
  setError: (error: string) => void,
  t: TFunction
) {
  const [pendingEditRow, setPendingEditRow] = useState<number | null>(null);
  const isDuplicatingRef = useRef(false);
  const draftPrefillsRef = useRef(new Map<number, BedPrefill>());

  const addBed = (fieldId: number, prefill?: BedPrefill): number => {
    const newBedId = -Date.now();
    const newBed: Bed = {
      id: newBedId,
      name: '',
      field: fieldId,
      area_sqm: undefined,
      notes: '',
    };
    if (prefill) {
      draftPrefillsRef.current.set(newBedId, prefill);
      newBed.name = prefill.name;
      newBed.length_m = prefill.length_m ?? null;
      newBed.width_m = prefill.width_m ?? null;
    }

    // Add temporary bed to beds state
    setBeds((prevBeds) => [newBed, ...prevBeds]);

    // Return the ID for setting edit mode
    return newBedId;
  };

  /** A prefilled new bed row the user has not changed yet (Escape drops it like an empty one). */
  const isUntouchedPrefilledDraft = useCallback((row: HierarchyRow): boolean => {
    const prefill = typeof row.id === 'number' ? draftPrefillsRef.current.get(row.id) : undefined;
    return prefill !== undefined && matchesHierarchyRowPrefill(row, prefill);
  }, []);

  const saveBed = async (bedData: Partial<Bed> & { id: number; field: number }): Promise<Bed> => {
    const isNew = bedData.id < 0;

    try {
      const payload = {
        name: bedData.name || '',
        field: bedData.field,
        area_sqm: bedData.area_sqm,
        length_m: bedData.length_m ?? null,
        width_m: bedData.width_m ?? null,
        notes: bedData.notes || '',
      };

      if (isNew) {
        // Create new bed
        const response = await bedAPI.create(payload);
        setError('');
        draftPrefillsRef.current.delete(bedData.id);
        
        // Remove temporary bed and add saved bed to state
        setBeds((prevBeds) => {
          const filteredBeds = prevBeds.filter(b => b.id !== bedData.id);
          return [response.data, ...filteredBeds];
        });
        
        return response.data;
      } else {
        // Update existing bed
        const response = await bedAPI.update(bedData.id, payload);
        setError('');
        
        // Update bed in state
        setBeds((prevBeds) => 
          prevBeds.map(b => b.id === bedData.id ? response.data : b)
        );
        
        return response.data;
      }
    } catch (err) {
      setError(t('errors.saveBed'));
      console.error('Error saving bed:', err);
      throw err;
    }
  };

  /**
   * Creates a copy of `source` right away: only length and width are copied
   * (no notes, planting plans or layout), under the given unique name. The
   * backend derives the area from the dimensions. Returns null without
   * creating anything while a previous duplicate is still being saved (e.g.
   * a held Ctrl+D), since both would compute the same next name.
   */
  const duplicateBed = async (source: Bed, name: string): Promise<Bed | null> => {
    if (isDuplicatingRef.current) {
      return null;
    }
    isDuplicatingRef.current = true;
    try {
      const response = await bedAPI.create({
        name,
        field: source.field,
        length_m: source.length_m ?? null,
        width_m: source.width_m ?? null,
        notes: '',
      });
      setError('');
      setBeds((prevBeds) => [response.data, ...prevBeds]);
      return response.data;
    } catch (err) {
      setError(t('errors.saveBed'));
      console.error('Error duplicating bed:', err);
      throw err;
    } finally {
      isDuplicatingRef.current = false;
    }
  };

  /** Creates a series of beds in one request; all or none are saved. */
  const bulkCreateBeds = async (payload: BulkBedCreatePayload): Promise<Bed[]> => {
    const response = await bedAPI.bulkCreate(payload);
    setError('');
    setBeds((prevBeds) => [...response.data, ...prevBeds]);
    return response.data;
  };

  const deleteBed = async (bedId: number): Promise<void> => {
    if (!confirmAction(t('confirm.deleteBed'))) return;

    if (bedId < 0) {
      // Remove unsaved bed from state
      setBeds((prevBeds) => prevBeds.filter((bed) => bed.id !== bedId));
      return;
    }

    try {
      await bedAPI.delete(bedId);
      // Remove bed from state
      setBeds((prevBeds) => prevBeds.filter((bed) => bed.id !== bedId));
      setError('');
    } catch (err) {
      setError(t('errors.deleteBed'));
      console.error('Error deleting bed:', err);
      throw err;
    }
  };

  return {
    addBed,
    isUntouchedPrefilledDraft,
    saveBed,
    duplicateBed,
    bulkCreateBeds,
    deleteBed,
    pendingEditRow,
    setPendingEditRow,
  };
}
