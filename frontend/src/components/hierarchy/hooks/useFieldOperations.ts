/**
 * Custom hook for field operations (CRUD)
 */

import { fieldAPI, type Location } from '../../../api/api';
import type { TFunction } from 'i18next';
import { confirmAction } from '../../../utils/confirmAction';
import { retireInsteadOfDelete } from '../geometryChange/geometryChangeBridge';

export function useFieldOperations(
  locations: Location[],
  setError: (error: string) => void,
  fetchData: () => Promise<void>,
  t: TFunction
) {
  const addField = async (locationId: number | undefined, fieldName: string): Promise<void> => {
    const targetLocationId =
      locationId ?? (locations.length === 1 ? locations[0].id : undefined);
    if (!targetLocationId) {
      setError(
        locations.length > 1
          ? t('messages.invalidLocationSelection')
          : t('messages.createLocationFirst'),
      );
      return;
    }

    if (!fieldName || fieldName.trim() === '') {
      return; // User cancelled or entered empty name
    }

    try {
      await fieldAPI.create({
        name: fieldName.trim(),
        location: targetLocationId,
        area_sqm: undefined,
        notes: '',
      });
      
      // Reload all data to get the new field
      await fetchData();
      setError('');
    } catch (err) {
      setError(t('errors.createField'));
      console.error('Error creating field:', err);
    }
  };

  const deleteField = async (fieldId: number): Promise<void> => {
    if (!confirmAction(t('confirm.deleteFieldWithBeds'))) {
      return;
    }

    try {
      await fieldAPI.delete(fieldId);
      await fetchData();
      setError('');
    } catch (err) {
      if (await retireInsteadOfDelete(err) !== null) {
        await fetchData();
        setError('');
        return;
      }
      setError(t('errors.deleteField'));
      console.error('Error deleting field:', err);
    }
  };

  return {
    addField,
    deleteField,
  };
}
