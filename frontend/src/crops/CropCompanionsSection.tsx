import { useMemo } from 'react';
import EditIcon from '@mui/icons-material/Edit';
import { Alert, Box, Button, Link, Stack, Typography } from '@mui/material';

import type { CompanionKind, Crop, CropCompanion } from '../api/types';
import { useTranslation } from '../i18n';
import {
  COMPANION_KINDS,
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
  /** Opens the Kultur's crop form, where neighbours are edited. */
  onEditKultur?: (kultur: Crop) => void;
}

const KIND_TITLE_KEYS: Record<CompanionKind, string> = {
  good: 'companions.goodColumn',
  bad: 'companions.badColumn',
};

/**
 * "Mischkultur" in the crop details: the Kultur's good and bad neighbours,
 * read-only. They are edited in the Kultur's crop form; a Sorte shows its
 * Kultur's list (see docs/crop-companions.md).
 */
export function CropCompanionsSection({ crop, crops, onCropSelect, onEditKultur }: CropCompanionsSectionProps) {
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
  const ownRelations = kulturId !== null ? relationsOfKultur(kulturId, relations) : [];
  const isVariety = Boolean((crop.variety || '').trim());

  const partnerLabel = (relation: CropCompanion): string => {
    if (kulturId === null) return '';
    const partner = relationPartner(relation, kulturId);
    if (partner.type === 'crop') return cropsById.get(partner.cropId)?.name ?? '';
    if (partner.type === 'family') return t('companions.familyLabel', { name: families.getName(partner.familyKey) });
    return partner.text;
  };

  const renderRelation = (relation: CropCompanion) => {
    const partner = kulturId !== null ? relationPartner(relation, kulturId) : null;
    const partnerCrop = partner?.type === 'crop' ? cropsById.get(partner.cropId) : undefined;
    const label = partnerLabel(relation);
    const reasonLabel = relation.reason === 'other' ? '' : t(companionReasonLabelKey(relation.reason));
    const detail = [reasonLabel, relation.note].filter(Boolean).join(': ');
    return (
      <Box key={relation.id} data-testid="crop-companion-row" sx={{ py: 0.5, minWidth: 0 }}>
        {partnerCrop ? (
          <Link component="button" type="button" variant="body1" underline="hover" onClick={() => onCropSelect(partnerCrop)}>
            {label}
          </Link>
        ) : (
          <Typography variant="body1">{label}</Typography>
        )}
        {detail ? (
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            {detail}
          </Typography>
        ) : null}
      </Box>
    );
  };

  return (
    <Box sx={{ mb: 3 }} data-testid="crop-companions-section">
      <Typography variant="h6" sx={{ mb: 1 }}>{t('companions.title')}</Typography>
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
      {kultur && loaded && !failed && ownRelations.length === 0 ? (
        <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
          <Typography variant="body2" color="text.secondary">{t('companions.empty')}</Typography>
          {onEditKultur ? (
            <Button
              size="small"
              variant="outlined"
              startIcon={<EditIcon fontSize="small" />}
              onClick={() => onEditKultur(kultur)}
            >
              {t('companions.editAction')}
            </Button>
          ) : null}
        </Stack>
      ) : null}
      {kultur && ownRelations.length > 0 ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: { xs: 1.5, md: 3 } }}>
          {COMPANION_KINDS.map((kind) => {
            const kindRelations = ownRelations.filter((relation) => relation.kind === kind);
            if (kindRelations.length === 0) return null;
            return (
              <Box key={kind}>
                <Typography variant="body2" color="text.secondary">{t(KIND_TITLE_KEYS[kind])}</Typography>
                {kindRelations.map(renderRelation)}
              </Box>
            );
          })}
        </Box>
      ) : null}
    </Box>
  );
}
