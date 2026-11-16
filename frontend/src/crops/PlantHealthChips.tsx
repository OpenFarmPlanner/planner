import ListAltOutlinedIcon from '@mui/icons-material/ListAltOutlined';
import { FieldInfoButton } from './FieldInfoButton';
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
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Typography variant="body2" color="text.secondary">{t('plantHealth.label')}</Typography>
      <FieldInfoButton contextual title={`${t('plantHealth.associationHint')} ${t('plantHealth.relationshipsActionHint')}`}
        ariaLabel={t('form.fieldInfoAriaLabel', { field: t('plantHealth.label') })} />
    </Box>
    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 0.5 }}>
      {value.entries.map(entry => {
        const official = entry.catalogue_identity ? names.catalogue.get(entry.catalogue_identity) : undefined;
        const origin = !entry.catalogue_identity ? 'local' : !names.loading && !official ? 'unavailable' : 'catalogue';
        return <Chip key={plantHealthKey(entry)} size="small" variant="outlined"
          icon={entry.catalogue_identity ? <ListAltOutlinedIcon /> : undefined}
          onClick={entry.catalogue_identity ? () => { setSelectedIdentity(entry.catalogue_identity!); names.retry(); } : undefined}
          label={`${plantHealthDisplayName(entry, value.entries, names.catalogue)} · ${t(`plantHealth.${origin}`)}`}
          sx={{ maxWidth: '100%', height: 'auto', '& .MuiChip-label': { whiteSpace: 'normal', overflowWrap: 'anywhere', py: 0.5 } }} />;
      })}
    </Box>
    {names.error ? <LoadRetryButton onClick={names.retry} /> : null}
    {selected ? <PlantHealthRelationshipsDialog entry={names.catalogue.get(selectedIdentity!)}
      name={selected.name} loading={names.loading} error={names.error} onRetry={names.retry}
      onClose={() => setSelectedIdentity(null)} /> : null}
  </Box>;
}
