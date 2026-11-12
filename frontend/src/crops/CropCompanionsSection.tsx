import { useId, useMemo } from 'react';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';

import type { Crop, CropCompanion } from '../api/types';
import { normalizeLanguageTag } from '../i18n/languages';
import { useTranslation } from '../i18n';
import { CompanionKindColumns, type CompanionListItem } from './CompanionKindColumns';
import {
  companionReasonLabelKey,
  findKulturId,
  isCompanionInformationText,
  relationPartner,
  relationsOfKultur,
} from './companions';
import { usePlantFamilies } from './plantFamilies';
import { useCropCompanions } from './useCropCompanions';
import { getCropDisplayName } from './cropDisplay';
import LoadRetryButton from '../components/LoadRetryButton';

interface CropCompanionsSectionProps {
  crop: Crop;
  crops: Crop[];
  onCropSelect?: (crop: Crop) => void;
  onEdit?: (crop: Crop) => void;
}

/**
 * Shared project companion summary. Editing-capable callers open the same
 * Kultur editor from details or a crop/variety form; read-only empty lists hide.
 */
export function CropCompanionsSection({ crop, crops, onCropSelect, onEdit }: CropCompanionsSectionProps) {
  const { t, i18n } = useTranslation(['crops', 'common']);
  const titleId = useId();
  const language = normalizeLanguageTag(i18n?.resolvedLanguage ?? i18n?.language) ?? 'de';
  const families = usePlantFamilies();
  // Reloaded whenever the crop list is refetched, e.g. after the form saved.
  const { relations, failed, loaded, reload } = useCropCompanions(crops);

  const cropsById = useMemo(
    () => new Map(crops.flatMap((entry) => (entry.id === undefined ? [] : [[entry.id, entry] as const]))),
    [crops],
  );
  const kulturId = findKulturId(crop, crops);
  const kultur = kulturId !== null ? cropsById.get(kulturId) ?? (crop.id === kulturId ? crop : undefined) : undefined;
  const isVariety = Boolean((crop.variety || '').trim());

  const items: CompanionListItem[] = kulturId === null ? [] : relationsOfKultur(kulturId, relations).map((relation: CropCompanion) => {
    const partner = relationPartner(relation, kulturId);
    const partnerCrop = partner.type === 'crop' ? cropsById.get(partner.cropId) : undefined;
    const label = partner.type === 'crop'
      ? getCropDisplayName(partnerCrop ?? {})
      : partner.type === 'family'
        ? t('companions.familyLabel', { name: families.getName(partner.familyKey) })
        : partner.text;
    const reason = relation.reason === 'other' ? '' : t(companionReasonLabelKey(relation.reason));
    return {
      key: relation.id ?? `${relation.kind}-${label}`,
      kind: relation.kind,
      label,
      detail: [reason, relation.notes ? relation.notes[language] ?? '' : relation.note].filter(Boolean).join(': '),
      informational: partner.type === 'text' && isCompanionInformationText(partner.text),
      onSelect: partnerCrop && onCropSelect ? () => onCropSelect(partnerCrop) : undefined,
    };
  });

  const editable = Boolean(onEdit && kultur);
  const hasNeighbors = items.some(item => !item.informational);
  if (!failed && items.length === 0 && !editable) {
    return null;
  }

  return (
    <Box component="section" aria-labelledby={titleId} sx={{ mb: 3 }} data-testid="crop-companions-section">
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 1 }}>
        <Typography id={titleId} variant="h6">{t('companions.title')}</Typography>
        {editable && kultur ? <Button variant="outlined" startIcon={hasNeighbors ? <EditOutlinedIcon /> : <AddIcon />}
          sx={{ ml: 'auto' }}
          disabled={!loaded || failed} onClick={() => onEdit?.(kultur)}>
          {t(hasNeighbors ? 'common:actions.edit' : 'companions.addNeighbors')}
        </Button> : null}
      </Stack>
      {failed ? <Alert severity="error" action={<LoadRetryButton onClick={() => void reload()} />}>{t('companions.loadError')}</Alert> : null}
      {kultur && isVariety ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t('companions.sharedHint', { name: getCropDisplayName(kultur) })}
        </Typography>
      ) : null}
      {items.length > 0 ? <CompanionKindColumns items={items} /> : null}
      {editable && loaded && !failed && items.length === 0 ? <Typography variant="body2" color="text.secondary">{t('companions.form.empty')}</Typography> : null}
    </Box>
  );
}
