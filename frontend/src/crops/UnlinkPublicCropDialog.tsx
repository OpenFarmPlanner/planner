import { useEffect, useState } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { useTranslation } from '../i18n';
import { publicCropAPI } from '../api/api';
import type { Crop } from '../api/types';
import { ConfirmationDialog } from '../components/feedback/ConfirmationDialog';
import { getPublicCropTitle } from '../crop-library/publicCropDisplay';
import { formatCropDisplayName } from './cropDisplay';

interface UnlinkPublicCropDialogProps {
  open: boolean;
  crop: Crop | undefined;
  /** Whether Sorten of this Kultur have library links of their own (they keep them). */
  hasLinkedVarieties: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Confirms "Verknüpfung aufheben": the crop stops syncing with somebody
 * else's public entry. Nothing is lost, which the bullet list spells out.
 */
export function UnlinkPublicCropDialog({
  open,
  crop,
  hasLinkedVarieties,
  onCancel,
  onConfirm,
}: UnlinkPublicCropDialogProps) {
  const { t, i18n } = useTranslation('crops');
  const language = i18n.resolvedLanguage ?? i18n.language;
  const [publicName, setPublicName] = useState('');
  const publicCropId = crop?.source_public_crop ?? null;

  useEffect(() => {
    queueMicrotask(() => setPublicName(''));
    if (!open || !publicCropId) return undefined;
    let cancelled = false;
    publicCropAPI.get(publicCropId)
      .then((response) => {
        if (!cancelled) {
          setPublicName(getPublicCropTitle(response.data, language, t('library.translation.missingName')));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [language, open, publicCropId, t]);

  const bullets = [
    t('library.unlink.keepsValues'),
    t('library.unlink.keepsLibraryValues'),
    ...(hasLinkedVarieties ? [t('library.unlink.keepsVarietyLinks')] : []),
    t('library.unlink.canRelink'),
  ];

  return (
    <ConfirmationDialog
      open={open}
      title={t('library.unlink.title')}
      maxWidth="sm"
      fullWidth
      messageTypographyProps={{ component: 'div' }}
      message={(
        <Stack spacing={1}>
          <Box component="span">
            {t('library.unlink.description', {
              local: crop ? formatCropDisplayName(crop) : '',
              public: publicName || t('library.unlink.publicEntryFallback'),
            })}
          </Box>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }} data-testid="unlink-public-crop-bullets">
            {bullets.map((bullet) => (
              <Typography key={bullet} component="li" variant="body2">{bullet}</Typography>
            ))}
          </Box>
        </Stack>
      )}
      cancelLabel={t('common:actions.cancel')}
      confirmLabel={t('library.unlink.confirm')}
      confirmButtonProps={{ variant: 'contained', color: 'warning' }}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
