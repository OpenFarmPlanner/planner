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

/** What a section needs to render one pinnable field; `null` when pinning does not apply. */
export interface LibraryFieldPinProps {
  pinned: boolean;
  fieldSx: SxProps<Theme> | undefined;
  /** The pin button, as an `InputAdornment` for the field's end. */
  endAdornment: ReactNode;
  /** The pin button alone, for a field without an input adornment slot. */
  button: ReactNode;
  /** "Lokal fixiert · Bibliothek: {value}" while pinned. */
  helperText: ReactNode | undefined;
}

export type GetLibraryFieldPinProps = (field: LibraryPinFormField) => LibraryFieldPinProps | null;

interface BuildLibraryFieldPinPropsOptions {
  field: LibraryPinFormField;
  formData: Partial<Crop>;
  /** Fields the crop may pin (`library_pinnable_fields`). */
  pinnableFields: readonly string[];
  /** The linked entry's current value per pinned field (`library_pinned_values`). */
  pinnedLibraryValues: Readonly<Record<string, unknown>>;
  onPinnedFieldsChange: (pinned: string[]) => void;
  t: TFunction;
}

export function buildLibraryFieldPinProps({
  field,
  formData,
  pinnableFields,
  pinnedLibraryValues,
  onPinnedFieldsChange,
  t,
}: BuildLibraryFieldPinPropsOptions): LibraryFieldPinProps | null {
  const modelFields = getLibraryPinModelFields(field);
  if (!modelFields.every((modelField) => pinnableFields.includes(modelField))) {
    return null;
  }
  const pinnedFields = formData.library_pinned_fields ?? [];
  const hasValue = hasLibraryPinFormValue(formData, field);
  const pinned = hasValue && isLibraryPinGroupPinned(pinnedFields, field);
  const button = (
    <LibraryPinButton
      pinned={pinned}
      disabledReason={hasValue ? undefined : t('library.pin.pinDisabledEmpty')}
      onToggle={() => onPinnedFieldsChange(setLibraryPinGroup(pinnedFields, field, !pinned))}
      t={t}
    />
  );
  const primaryModelField = modelFields[0];
  const helperText = pinned
    ? (primaryModelField in pinnedLibraryValues
      ? t('library.pin.helper', {
        value: formatLibraryPinnedValue(primaryModelField, pinnedLibraryValues[primaryModelField], t),
      })
      : t('library.pin.helperPending'))
    : undefined;
  return {
    pinned,
    fieldSx: pinned ? libraryPinnedFieldSx : undefined,
    endAdornment: <InputAdornment position="end">{button}</InputAdornment>,
    button,
    helperText,
  };
}
