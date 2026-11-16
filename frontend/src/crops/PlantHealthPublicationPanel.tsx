import { useState } from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { isAxiosError } from 'axios';
import { cropAPI, type Crop } from '../api/api';
import type { PlantHealthSelections } from '../api/types';
import { plantHealthAPI } from '../crop-library/plant-health/api';
import { useTranslation } from '../i18n';
import { FALLBACK_LANGUAGE, normalizeLanguageTag } from '../i18n/languages';
import { PlantHealthField } from './sections/PlantHealthField';

interface Props {
  crop: Crop;
  disabled: boolean;
  onMapped: (crop: Crop) => void;
  onBusyChange: (busy: boolean) => void;
}

function MappingRow({ name, crop, disabled, onMapped, onBusyChange }: Props & { name: string }) {
  const { t, i18n } = useTranslation('crops');
  const [selection, setSelection] = useState<PlantHealthSelections | null>(null);
  const [proposed, setProposed] = useState(false);
  const [error, setError] = useState('');
  const identity = selection?.entries[0]?.catalogue_identity;
  const submit = async (action: 'map' | 'propose') => {
    if (!crop.id || disabled || (action === 'map' && (!identity || !crop.updated_at))) return;
    setError('');
    onBusyChange(true);
    try {
      if (action === 'map' && identity && crop.updated_at) {
        const response = await cropAPI.mapPlantHealth(crop.id, {
          expected_updated_at: crop.updated_at,
          mappings: [{ local_name: name, catalogue_identity: identity }],
        });
        onMapped(response.data);
      } else {
        await plantHealthAPI.create({
          name, scientific_name: '', kind: 'group', eppo_code: '', sources: [],
          translations: [{ language_code: normalizeLanguageTag(i18n.resolvedLanguage ?? i18n.language) ?? FALLBACK_LANGUAGE, preferred_name: name }],
        });
        setProposed(true);
      }
    } catch (failure) {
      setError(isAxiosError(failure) && failure.response?.status === 409
        ? 'plantHealth.publication.conflict' : 'plantHealth.publication.error');
    } finally {
      onBusyChange(false);
    }
  };
  return <Stack role="group" aria-label={name} spacing={1} sx={{ minWidth: 0 }}>
    <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{name}</Typography>
    <Box inert={disabled}>
      <PlantHealthField value={selection} onChange={setSelection} localOptions={[]} canInherit={false} allowLocal={false} selectionLimit={1} />
    </Box>
    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
      <Button size="small" variant="outlined" disabled={disabled || !identity || !crop.updated_at} onClick={() => void submit('map')}>
        {t('plantHealth.publication.map')}
      </Button>
      <Button size="small" disabled={disabled || proposed} onClick={() => void submit('propose')}>
        {t('plantHealth.publication.propose')}
      </Button>
    </Stack>
    {proposed ? <Alert severity="success">{t('plantHealth.publication.proposed')}</Alert> : null}
    {error ? <Alert severity="error">{t(error)}</Alert> : null}
  </Stack>;
}

export function PlantHealthPublicationPanel(props: Props) {
  const { t } = useTranslation('crops');
  const names = (props.crop.plant_health ?? props.crop.effective_values?.plant_health)?.entries
    .filter(entry => !entry.catalogue_identity).map(entry => entry.name) ?? [];
  if (!names.length) return null;
  return <Stack spacing={2} data-testid="plant-health-publication">
    <Typography variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>
      {t('plantHealth.publication.title', { name: props.crop.variety || props.crop.name })}
    </Typography>
    <Typography variant="body2" color="text.secondary">{t('plantHealth.publication.helper')}</Typography>
    {names.map(name => <MappingRow key={name} {...props} name={name} />)}
  </Stack>;
}
