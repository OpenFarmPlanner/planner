import { useMemo } from 'react';
import { Alert, Box, Typography } from '@mui/material';

import type { Crop, CropCompanion } from '../api/types';
import { useTranslation } from '../i18n';
import { CompanionKindColumns, type CompanionListItem } from './CompanionKindColumns';
import {
  companionReasonLabelKey,
  findKulturId,
  relationPartner,
  relationsOfKultur,
} from './companions';
import { usePlantFamilies } from './plantFamilies';
import { useCropCompanions } from './useCropCompanions';

interface CropCompanionsSectionProps {
  crop: Crop;
  crops: Crop[];
  onCropSelect: (crop: Crop) => void;
}

/**
 * "Mischkultur" in the crop details: the Kultur's good and bad neighbours,
 * read-only; they are edited in the Kultur's crop form. A Sorte shows its
 * Kultur's list (see docs/crop-companions.md).
 */
export function CropCompanionsSection({ crop, crops, onCropSelect }: CropCompanionsSectionProps) {
  const { t } = useTranslation(['crops', 'common']);
  const families = usePlantFamilies();
  // Reloaded whenever the crop list is refetched, e.g. after the form saved.
  const { relations, loaded, failed } = useCropCompanions(crops);

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
      ? partnerCrop?.name ?? ''
      : partner.type === 'family'
        ? t('companions.familyLabel', { name: families.getName(partner.familyKey) })
        : partner.text;
    const reason = relation.reason === 'other' ? '' : t(companionReasonLabelKey(relation.reason));
    return {
      key: relation.id ?? `${relation.kind}-${label}`,
      kind: relation.kind,
      label,
      detail: [reason, relation.note].filter(Boolean).join(': '),
      onSelect: partnerCrop ? () => onCropSelect(partnerCrop) : undefined,
    };
  });

  return (
    <Box sx={{ mb: 3 }} data-testid="crop-companions-section">
      <Typography variant="h6" gutterBottom>{t('companions.title')}</Typography>
      {failed ? <Alert severity="error">{t('companions.loadError')}</Alert> : null}
      {!kultur ? (
        <Typography variant="body2" color="text.secondary">
          {t('companions.noKulturHint', { name: crop.name })}
        </Typography>
      ) : null}
      {kultur && isVariety ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t('companions.sharedHint', { name: kultur.name })}
        </Typography>
      ) : null}
      {kultur && loaded && !failed && items.length === 0 ? (
        <Typography variant="body1">{t('noData')}</Typography>
      ) : null}
      {items.length > 0 ? <CompanionKindColumns items={items} /> : null}
    </Box>
  );
}
