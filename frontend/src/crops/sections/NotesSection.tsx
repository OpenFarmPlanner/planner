import { Box, Typography } from '@mui/material';
import type { Crop } from '../../api/types';
import type { TFunction } from 'i18next';
import { RichTextEditor } from '../../components/data-grid/RichTextEditor';
import type { GetLibraryFieldPinProps } from '../libraryFieldPinProps';

interface NotesSectionProps {
  formData: Partial<Crop>;
  errors: Record<string, string>;
  onChange: <K extends keyof Crop>(name: K, value: Crop[K]) => void;
  t: TFunction;
  label?: string;
  getFieldPinProps?: GetLibraryFieldPinProps;
}

export function NotesSection({ formData, onChange, t, label, getFieldPinProps }: NotesSectionProps) {
  const editorLabel = label ?? t('form.notes');
  // The rich-text editor has no adornment slot: the pin sits next to the heading.
  const notesPin = getFieldPinProps?.('notes');

  return (
    <Box sx={{ minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 2, mb: 1 }}>
        <Typography variant="h6">{editorLabel}</Typography>
        {notesPin?.button}
      </Box>
      <Box
        sx={notesPin?.pinned ? {
          border: 2,
          borderColor: 'libraryLocal.main',
          borderRadius: 1,
        } : undefined}
      >
        <RichTextEditor
          value={formData.notes ?? ''}
          onChange={(markdown) => onChange('notes', markdown)}
          autoFocus={false}
          ariaLabel={editorLabel}
        />
      </Box>
      {notesPin?.helperText ? (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'libraryLocal.main' }}>
          {notesPin.helperText}
        </Typography>
      ) : null}
    </Box>
  );
}
