import { Box, Chip } from '@mui/material';
import PushPinIcon from '@mui/icons-material/PushPin';
import { useTranslation } from '../i18n';
import { AppTooltip } from '../components/AppTooltip';
import type { Crop } from '../api/types';
import { getPinnedFieldLabels } from './libraryFieldPin';

interface CropLibraryPinnedChipProps {
  crop: Crop;
}

/**
 * "{n} Felder lokal fixiert" in the crop detail badge row, next to the library
 * status (which stays "Aktuell" for pinned differences). Passive: pins are
 * changed in the edit form or in the library sync.
 */
export function CropLibraryPinnedChip({ crop }: CropLibraryPinnedChipProps) {
  const { t } = useTranslation('crops');
  const labels = getPinnedFieldLabels(crop, t);
  if (!crop.source_public_crop || labels.length === 0) {
    return null;
  }
  const tooltip = t('library.pin.chipTooltip', { fields: labels.join(', ') });
  return (
    <AppTooltip title={tooltip}>
      <Box component="span" tabIndex={0} aria-label={tooltip} sx={{ display: 'inline-flex', borderRadius: 4 }}>
        <Chip
          size="small"
          variant="outlined"
          icon={<PushPinIcon fontSize="small" />}
          label={t('library.pin.chip', { count: labels.length })}
          data-testid="crop-detail-library-pinned"
          sx={{
            color: 'libraryLocal.main',
            borderColor: 'libraryLocal.main',
            '& .MuiChip-icon': { color: 'libraryLocal.main' },
          }}
        />
      </Box>
    </AppTooltip>
  );
}
