import type { ReactNode } from 'react';
import { InputAdornment } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import type { TFunction } from 'i18next';
import type { Crop } from '../api/types';
import { LibraryPinButton } from './LibraryPinButton';
import {
  formatLibraryPinnedValue,
  getLibraryPinModelFields,
  hasLibraryPinFormValue,
  isLibraryPinGroupPinned,
  libraryPinnedFieldSx,
  setLibraryPinGroup,
  type LibraryPinFormField,
} from './libraryFieldPin';

/** What a section needs to render one pinned field; `null` when the field is not pinned. */
export interface LibraryFieldPinProps {
  pinned: true;
  fieldSx: SxProps<Theme>;
  /** The pin button, as an `InputAdornment` for the field's end. */
  endAdornment: ReactNode;
  /** The pin button alone, for a field without an input adornment slot. */
  button: ReactNode;
}

export type GetLibraryFieldPinProps = (field: LibraryPinFormField) => LibraryFieldPinProps | null;

interface BuildLibraryFieldPinPropsOptions {
  field: LibraryPinFormField;
  formData: Partial<Crop>;
  /** Fields the crop may pin (`library_pinnable_fields`). */
  pinnableFields: readonly string[];
  /** Fields a Sorte inherits from its Kultur; they never show a pin. */
  inheritedFields?: readonly string[];
  /** The linked entry's current value per pinned field (`library_pinned_values`). */
  pinnedLibraryValues: Readonly<Record<string, unknown>>;
  onPinnedFieldsChange: (pinned: string[]) => void;
  t: TFunction;
}

/**
 * Only a pinned field gets a marker in the form: the "local" border and the
 * filled pin, whose popover releases the pin. Pinning happens in the sync
 * dialogs, so an unpinned field renders exactly as before.
 */
export function buildLibraryFieldPinProps({
  field,
  formData,
  pinnableFields,
  inheritedFields = [],
  pinnedLibraryValues,
  onPinnedFieldsChange,
  t,
}: BuildLibraryFieldPinPropsOptions): LibraryFieldPinProps | null {
  const modelFields = getLibraryPinModelFields(field);
  if (!modelFields.every((modelField) => pinnableFields.includes(modelField))) {
    return null;
  }
  if (inheritedFields.includes(field)) {
    return null;
  }
  const pinnedFields = formData.library_pinned_fields ?? [];
  if (!hasLibraryPinFormValue(formData, field) || !isLibraryPinGroupPinned(pinnedFields, field)) {
    return null;
  }
  const primaryModelField = modelFields[0];
  const libraryValue = primaryModelField in pinnedLibraryValues
    ? formatLibraryPinnedValue(primaryModelField, pinnedLibraryValues[primaryModelField], t)
    : undefined;
  const button = (
    <LibraryPinButton
      libraryValue={libraryValue}
      onUnpin={() => onPinnedFieldsChange(setLibraryPinGroup(pinnedFields, field, false))}
      t={t}
    />
  );
  return {
    pinned: true,
    fieldSx: libraryPinnedFieldSx,
    endAdornment: <InputAdornment position="end">{button}</InputAdornment>,
    button,
  };
}
