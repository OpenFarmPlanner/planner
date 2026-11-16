import { Box, Chip, Typography } from '@mui/material';
import type { PlantHealthSelections } from '../api/types';
import { useTranslation } from '../i18n';
import { plantHealthDisplayName, plantHealthKey } from './plantHealth';
import { usePlantHealthNames } from './usePlantHealthNames';
import LoadRetryButton from '../components/LoadRetryButton';
import { useState } from 'react';
import { PlantHealthRelationshipsDialog } from './PlantHealthRelationshipsDialog';

export function PlantHealthChips({ value }: { value: PlantHealthSelections }) {
  const { t } = useTranslation('crops');
  const names = usePlantHealthNames(value.entries);
  const [selectedIdentity, setSelectedIdentity] = useState<string | null>(null);
  const selected = value.entries.find(entry => entry.catalogue_identity === selectedIdentity);
  return <Box>
    <Typography variant="body2" color="text.secondary">{t('plantHealth.label')}</Typography>
    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 0.5 }}>
      {value.entries.map(entry => {
        const official = entry.catalogue_identity ? names.catalogue.get(entry.catalogue_identity) : undefined;
        const origin = !entry.catalogue_identity ? 'local' : !names.loading && !official ? 'unavailable' : 'catalogue';
        return <Chip key={plantHealthKey(entry)} size="small" variant="outlined"
          onClick={entry.catalogue_identity ? () => { setSelectedIdentity(entry.catalogue_identity!); names.retry(); } : undefined}
          label={`${plantHealthDisplayName(entry, value.entries, names.catalogue)} · ${t(`plantHealth.${origin}`)}`}
          sx={{ maxWidth: '100%', height: 'auto', '& .MuiChip-label': { whiteSpace: 'normal', overflowWrap: 'anywhere', py: 0.5 } }} />;
      })}
    </Box>
    {names.error ? <LoadRetryButton onClick={names.retry} /> : null}
    <Typography variant="caption" color="text.secondary">{t('plantHealth.associationHint')}</Typography>
    {value.entries.some(entry => entry.catalogue_identity) ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
      {t('plantHealth.relationshipsActionHint')}
    </Typography> : null}
    {selected ? <PlantHealthRelationshipsDialog entry={names.catalogue.get(selectedIdentity!)}
      name={selected.name} loading={names.loading} error={names.error} onRetry={names.retry}
      onClose={() => setSelectedIdentity(null)} /> : null}
  </Box>;
}
