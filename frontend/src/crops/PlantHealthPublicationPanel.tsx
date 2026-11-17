import { useState } from 'react';
import { Alert, Box, Link, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router';
import type { Crop, StagedPlantHealthMapping } from '../api/types';
import type { PlantHealthEntry } from '../crop-library/plant-health/types';
import { plantHealthAPI } from '../crop-library/plant-health/api';
import { useTranslation } from '../i18n';
import { FALLBACK_LANGUAGE, normalizeLanguageTag } from '../i18n/languages';
import { PlantHealthMappingPicker } from './PlantHealthMappingPicker';
import { FieldInfoButton } from './FieldInfoButton';

interface Props {
  crop: Crop;
  inheritedSource?: Crop;
  onNavigate?: () => void;
  disabled: boolean;
  drafts: StagedPlantHealthMapping[];
  onChange: (mapping: StagedPlantHealthMapping) => void;
  onBusyChange: (busy: boolean) => void;
}

function MappingRow({ name, crop, drafts, disabled, onChange, onBusyChange }: Props & { name: string }) {
  const { t, i18n } = useTranslation('crops');
  const draft = drafts.find(item => item.crop_id === crop.id)?.mappings.find(item => item.local_name === name);
  const selection = draft ? { identity_key: draft.catalogue_identity, name: draft.catalogue_name || name, display_name: draft.catalogue_name || name } : null;
  const [proposed, setProposed] = useState(false);
  const [error, setError] = useState('');
  const propose = async (proposalName: string): Promise<PlantHealthEntry | null> => {
    if (disabled) return null;
    setError('');
    onBusyChange(true);
    try {
      const response = await plantHealthAPI.create({
        name: proposalName, scientific_name: '', kind: 'group', eppo_code: '', sources: [],
        translations: [{ language_code: normalizeLanguageTag(i18n.resolvedLanguage ?? i18n.language) ?? FALLBACK_LANGUAGE, preferred_name: proposalName }],
      });
      setProposed(true);
      return response.data;
    } catch {
      setError('plantHealth.publication.error');
      return null;
    } finally {
      onBusyChange(false);
    }
  };
  return <Stack role="group" aria-label={name} spacing={1} sx={{ minWidth: 0 }}>
    <PlantHealthMappingPicker name={name} value={selection} disabled={disabled || !crop.updated_at}
      onChange={entry => {
        if (!crop.id || !crop.updated_at) return;
        const previous = drafts.find(draft => draft.crop_id === crop.id)?.mappings ?? [];
        onChange({ crop_id: crop.id, expected_updated_at: crop.updated_at,
          mappings: [...previous.filter(mapping => mapping.local_name !== name),
            ...(entry ? [{ local_name: name, catalogue_identity: entry.identity_key, catalogue_name: entry.display_name || entry.name }] : [])] });
      }} onPropose={propose} />
    {proposed ? <Alert severity="success">{t('plantHealth.publication.proposed')}</Alert> : null}
    {error ? <Alert severity="error">{t(error)}</Alert> : null}
  </Stack>;
}

export function PlantHealthPublicationPanel(props: Props) {
  const { t } = useTranslation('crops');
  const names = (props.crop.plant_health ?? props.crop.effective_values?.plant_health)?.entries
    .filter(entry => !entry.catalogue_identity).map(entry => entry.name) ?? [];
  if (!names.length) return null;
  if (props.crop.plant_health == null && props.crop.general_crop) {
    const source = props.inheritedSource?.id === props.crop.general_crop ? props.inheritedSource : undefined;
    return <Stack spacing={2}>
      <Alert severity="info">
        {t('plantHealth.publication.inherited', { name: source?.name ?? props.crop.name })}
        {!source ? <> <Link component={RouterLink} to={`/app/crops?cropId=${props.crop.general_crop}&action=edit`} onClick={props.onNavigate}>
          {t('plantHealth.publication.editGeneral')}
        </Link></> : null}
      </Alert>
      {source ? <PlantHealthPublicationPanel {...props} crop={source} inheritedSource={undefined} /> : null}
    </Stack>;
  }
  return <Stack spacing={2} data-testid="plant-health-publication">
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Typography variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>
        {t('plantHealth.publication.title', { name: props.crop.variety || props.crop.name })}
      </Typography>
      <FieldInfoButton contextual title={t('plantHealth.publication.helper')}
        ariaLabel={t('form.fieldInfoAriaLabel', { field: t('plantHealth.label') })} />
    </Box>
    {names.map(name => <MappingRow key={name} {...props} name={name} />)}
  </Stack>;
}
