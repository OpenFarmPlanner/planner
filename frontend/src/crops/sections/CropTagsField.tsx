import { Autocomplete, Chip, TextField, type SxProps, type Theme } from '@mui/material';
import type { TFunction } from 'i18next';

import { normalizeCropTags } from '../cropTags';

interface CropTagsFieldProps {
  value: readonly string[];
  /** The project's groups, offered for selection. */
  options: readonly string[];
  onChange: (tags: string[]) => void;
  t: TFunction;
  sx?: SxProps<Theme>;
}

/** "Gruppen": the crop's own groups; existing ones are offered, new ones typed (docs/crop-groups.md). */
export function CropTagsField({ value, options, onChange, t, sx }: CropTagsFieldProps) {
  return (
    <Autocomplete<string, true, false, true>
      multiple
      freeSolo
      autoSelect
      filterSelectedOptions
      sx={sx}
      options={[...options]}
      value={[...value]}
      onChange={(_event, tags) => onChange(normalizeCropTags(tags, options))}
      renderValue={(tags, getItemProps) => tags.map((tag, index) => {
        const { key, ...itemProps } = getItemProps({ index });
        return <Chip key={key} size="small" label={tag} {...itemProps} />;
      })}
      renderInput={(params) => (
        <TextField
          {...params}
          label={t('form.tags')}
          placeholder={value.length === 0 ? t('form.tagsPlaceholder') : undefined}
          helperText={t('form.tagsHelper')}
        />
      )}
    />
  );
}
