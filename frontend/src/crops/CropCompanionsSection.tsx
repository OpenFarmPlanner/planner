import { useMemo, useState } from 'react';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import EditIcon from '@mui/icons-material/Edit';
import {
  Alert,
  Box,
  Button,
  IconButton,
  Link,
  Stack,
  Typography,
} from '@mui/material';

import type { CompanionKind, Crop, CropCompanion } from '../api/types';
import { AppTooltip } from '../components/AppTooltip';
import { useTranslation } from '../i18n';
import { showGlobalSnackbar } from '../utils/globalSnackbar';
import { CropCompanionDialog, type CompanionDraft } from './CropCompanionDialog';
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
}

type DialogState = { relation?: CropCompanion; kind: CompanionKind } | null;

const KIND_TITLE_KEYS: Record<CompanionKind, string> = {
  good: 'companions.goodColumn',
  bad: 'companions.badColumn',
};

/**
 * "Mischkultur" in the crop details: the Kultur's good and bad neighbours.
 * A Sorte shows its Kultur's list, which every Sorte shares; changes are
 * saved right away (see docs/crop-companions.md).
 */
export function CropCompanionsSection({ crop, crops, onCropSelect }: CropCompanionsSectionProps) {
  const { t } = useTranslation(['crops', 'common']);
  const families = usePlantFamilies();
  const { relations, loaded, failed, create, update, remove } = useCropCompanions(crops.length);
  const [dialog, setDialog] = useState<DialogState>(null);

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

  const handleSave = async (draft: CompanionDraft): Promise<void> => {
    if (dialog?.relation?.id !== undefined) {
      await update(dialog.relation.id, draft);
    } else {
      await create(draft);
    }
  };

  const handleDelete = async (relation: CropCompanion): Promise<void> => {
    if (relation.id === undefined) return;
    const name = partnerLabel(relation);
    try {
      await remove(relation.id);
    } catch (error) {
      console.error('Error deleting crop companion:', error);
      showGlobalSnackbar({ message: t('companions.deleteError'), severity: 'error' });
      return;
    }
    const restorable: CompanionDraft = {
      crop: relation.crop,
      companion_crop: relation.companion_crop,
      companion_family: relation.companion_family,
      companion_text: relation.companion_text,
      kind: relation.kind,
      reason: relation.reason,
      note: relation.note,
    };
    showGlobalSnackbar({
      message: t('companions.deleted', { name }),
      severity: 'success',
      actionLabel: t('common:actions.undo'),
      onAction: async () => { await create(restorable); },
    });
  };

  const renderRelation = (relation: CropCompanion) => {
    const partner = kulturId !== null ? relationPartner(relation, kulturId) : null;
    const partnerCrop = partner?.type === 'crop' ? cropsById.get(partner.cropId) : undefined;
    const label = partnerLabel(relation);
    const reasonLabel = relation.reason === 'other' ? '' : t(companionReasonLabelKey(relation.reason));
    const detail = [reasonLabel, relation.note].filter(Boolean).join(': ');
    return (
      <Stack
        key={relation.id}
        direction="row"
        spacing={1}
        data-testid="crop-companion-row"
        sx={{ alignItems: 'flex-start', justifyContent: 'space-between', py: 0.5 }}
      >
        <Box sx={{ minWidth: 0 }}>
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
        <Stack direction="row" sx={{ flexShrink: 0 }}>
          <AppTooltip title={t('companions.edit')}>
            <IconButton size="small" aria-label={t('companions.edit')} onClick={() => setDialog({ relation, kind: relation.kind })}>
              <EditIcon fontSize="small" />
            </IconButton>
          </AppTooltip>
          <AppTooltip title={t('companions.delete')}>
            <IconButton size="small" aria-label={t('companions.delete')} onClick={() => { void handleDelete(relation); }}>
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </AppTooltip>
        </Stack>
      </Stack>
    );
  };

  return (
    <Box sx={{ mb: 3 }} data-testid="crop-companions-section">
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1, gap: 1 }}>
        <Typography variant="h6">{t('companions.title')}</Typography>
        {kultur ? (
          <Button
            size="small"
            variant="outlined"
            startIcon={<AddIcon fontSize="small" />}
            onClick={() => setDialog({ kind: 'good' })}
          >
            {t('companions.add')}
          </Button>
        ) : null}
      </Stack>
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
        <Typography variant="body2" color="text.secondary">{t('companions.empty')}</Typography>
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
      {kultur && dialog ? (
        <CropCompanionDialog
          open
          kultur={kultur}
          crops={crops}
          families={families}
          relation={dialog.relation}
          initialKind={dialog.kind}
          onClose={() => setDialog(null)}
          onSave={handleSave}
        />
      ) : null}
    </Box>
  );
}
