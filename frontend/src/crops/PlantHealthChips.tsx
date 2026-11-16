import { Box, Chip, Typography } from '@mui/material';
import type { PlantHealthSelections } from '../api/types';
import { useTranslation } from '../i18n';
import { plantHealthKey } from './plantHealth';
import { usePlantHealthNames } from './usePlantHealthNames';
import LoadRetryButton from '../components/LoadRetryButton';

export function PlantHealthChips({ value }: { value: PlantHealthSelections }) {
  const { t } = useTranslation('crops');
  const names = usePlantHealthNames(value.entries);
  return <Box>
    <Typography variant="body2" color="text.secondary">{t('plantHealth.label')}</Typography>
    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 0.5 }}>
      {value.entries.map(entry => {
        const official = entry.catalogue_identity ? names.catalogue.get(entry.catalogue_identity) : undefined;
        const origin = !entry.catalogue_identity ? 'local' : !names.loading && !official ? 'unavailable' : 'catalogue';
        return <Chip key={plantHealthKey(entry)} size="small" variant="outlined"
          label={`${official?.display_name ?? entry.name} · ${t(`plantHealth.${origin}`)}`}
          sx={{ maxWidth: '100%', height: 'auto', '& .MuiChip-label': { whiteSpace: 'normal', overflowWrap: 'anywhere', py: 0.5 } }} />;
      })}
    </Box>
    {names.error ? <LoadRetryButton onClick={names.retry} /> : null}
    <Typography variant="caption" color="text.secondary">{t('plantHealth.associationHint')}</Typography>
  </Box>;
}
