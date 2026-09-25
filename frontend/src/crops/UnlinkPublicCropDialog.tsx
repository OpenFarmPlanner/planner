import { Alert, Box, Stack, Typography } from '@mui/material';
import { useTranslation } from '../i18n';
import type { Crop } from '../api/types';
import { ConfirmationDialog } from '../components/feedback/ConfirmationDialog';
import { formatCropDisplayName } from './cropDisplay';

interface UnlinkPublicCropDialogProps {
  open: boolean;
  crop: Crop | undefined;
  /** Whether Sorten of this Kultur have library links of their own (they keep them). */
  hasLinkedVarieties: boolean;
  /** The localized rejection of the last attempt, shown inline. */
  errorText?: string;
  submitting?: boolean;
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
  errorText = '',
  submitting = false,
  onCancel,
  onConfirm,
}: UnlinkPublicCropDialogProps) {
  const { t } = useTranslation('crops');

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
              public: crop?.source_public_crop_title || t('library.unlink.publicEntryFallback'),
            })}
          </Box>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }} data-testid="unlink-public-crop-bullets">
            {bullets.map((bullet) => (
              <Typography key={bullet} component="li" variant="body2">{bullet}</Typography>
            ))}
          </Box>
          {errorText ? <Alert severity="error" data-testid="unlink-public-crop-error">{errorText}</Alert> : null}
        </Stack>
      )}
      cancelLabel={t('common:actions.cancel')}
      confirmLabel={t('library.unlink.confirm')}
      confirmButtonProps={{ variant: 'contained', color: 'warning', disabled: submitting }}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
