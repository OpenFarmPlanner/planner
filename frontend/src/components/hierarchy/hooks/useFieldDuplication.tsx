import { useCallback, useMemo, useState, type Dispatch, type ReactElement, type SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { fieldAPI, type Bed, type Field, type FieldDuplicatePayload } from '../../../api/api';
import { showGlobalSnackbar } from '../../../utils/globalSnackbar';
import { DuplicateFieldDialog } from '../DuplicateFieldDialog';

interface UseFieldDuplicationParams {
  fields: Field[];
  setFields: Dispatch<SetStateAction<Field[]>>;
  setBeds: Dispatch<SetStateAction<Bed[]>>;
  /** Beds of a field in the current table order. */
  getFieldBeds: (fieldId: number) => Bed[];
  ensureExpanded: (rowId: string) => void;
  /** Called with the source id and the copy once it is saved and in state. */
  onDuplicated?: (sourceId: number, createdField: Field, createdBeds: Bed[]) => void;
  t: TFunction;
}

/**
 * "Parzelle duplizieren", shared by the desktop table and the mobile list:
 * the dialog state, the request, adding the copy to the page state, and the
 * success snackbar. The page renders `dialog` and offers `openDuplicateField`
 * in the field row's menu.
 */
export function useFieldDuplication({
  fields,
  setFields,
  setBeds,
  getFieldBeds,
  ensureExpanded,
  onDuplicated,
  t,
}: UseFieldDuplicationParams): { openDuplicateField: (fieldId: number) => void; dialog: ReactElement | null } {
  const [sourceId, setSourceId] = useState<number | null>(null);
  const source = useMemo(
    () => (sourceId === null ? null : fields.find((field) => field.id === sourceId) ?? null),
    [fields, sourceId],
  );

  const handleDuplicate = useCallback(
    async (payload: FieldDuplicatePayload): Promise<void> => {
      if (!source?.id) return;
      const { data } = await fieldAPI.duplicate(source.id, payload);
      setFields((previous) => [...previous, data.field]);
      setBeds((previous) => [...data.beds, ...previous]);
      ensureExpanded(`field-${data.field.id}`);
      onDuplicated?.(source.id, data.field, data.beds);
      setSourceId(null);
      showGlobalSnackbar({
        message: data.beds.length > 0
          ? t('dialogs.duplicateField.createdWithBeds', { name: data.field.name, count: data.beds.length })
          : t('dialogs.duplicateField.created', { name: data.field.name }),
        severity: 'success',
      });
    },
    [ensureExpanded, onDuplicated, setBeds, setFields, source, t],
  );

  const dialog = source?.id !== undefined ? (
    // Mounted per opening so the default name is derived at that moment.
    <DuplicateFieldDialog
      key={source.id}
      open
      source={source}
      sourceBeds={getFieldBeds(source.id)}
      fields={fields}
      onClose={() => setSourceId(null)}
      onDuplicate={handleDuplicate}
    />
  ) : null;

  return { openDuplicateField: setSourceId, dialog };
}
