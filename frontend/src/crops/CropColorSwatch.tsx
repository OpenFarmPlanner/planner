import { Box } from '@mui/material';
import type { Crop } from '../api/types';
import { useTranslation } from '../i18n';
import { getCropDisplayColor } from './displayColor';

export function CropColorSwatch({ crop }: { crop?: Crop | null }) {
  const { t } = useTranslation('crops');
  const color = getCropDisplayColor(crop);
  if (!crop || !color) return null;
  const label = crop.variety && crop.display_color_override !== undefined
    ? t(crop.display_color_override === null ? 'form.colorInherited' : 'form.colorOwn')
    : t('form.displayColor');
  return (
    <Box
      component="span"
      aria-hidden
      title={`${label} ${color.toUpperCase()}`}
      sx={{
        width: 9, height: 9, borderRadius: 0.5, flexShrink: 0, mr: 0.75,
        border: 1, borderColor: 'divider', bgcolor: color,
      }}
    />
  );
}
