import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import type { Bed, Field } from '../../../api/types';
import { useTranslation } from '../../../i18n';
import { DetailRow, DetailSection } from '../../layout/DetailPrimitives';
import LoadRetryButton from '../../LoadRetryButton';
import { useParcelRotationGroups } from './useParcelRotationGroups';

interface Props {
  fieldId: number;
  fields: readonly Field[];
  beds: readonly Bed[];
  canManage: boolean;
  /** Called after a group was saved or deleted, e.g. to refresh season-copy options. */
  onChanged?: () => void;
}

/** Rotation group and position of a parcel on its detail page, with access to the shared group dialog (#1576). */
export function ParcelRotationDetailSection({ fieldId, fields, beds, canManage, onChanged }: Props) {
  const { t } = useTranslation(['hierarchy', 'common']);
  const { memberships, status, reload, open, dialog } = useParcelRotationGroups({
    enabled: true, fields, beds, onChanged,
  });
  const membership = memberships.get(fieldId);
  if (status !== 'ready') {
    return (
      <Box data-testid="detail-section-rotation">
        <DetailSection title={t('parcelRotation.section')}>
          {status === 'loading' ? <CircularProgress size={20} aria-label={t('common:messages.loading')} /> : (
            <Alert severity="error" action={<LoadRetryButton onClick={reload} />}>{t('parcelRotation.loadError')}</Alert>
          )}
        </DetailSection>
        {dialog}
      </Box>
    );
  }
  return (
    <Box data-testid="detail-section-rotation">
      <DetailSection title={t('parcelRotation.section')}>
        <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
          {membership ? (
            <DetailRow
              label={t('parcelRotation.group')}
              value={membership.group}
              caption={t('parcelRotation.position', { position: membership.position, size: membership.size })}
              testId="detail-rotation-group"
            />
          ) : (
            <Typography variant="body2" color="text.secondary">{t('parcelRotation.unassigned')}</Typography>
          )}
          {canManage ? (
            <Button variant="outlined" startIcon={<AutorenewIcon fontSize="small" />} aria-haspopup="dialog"
              onClick={() => open(fieldId)}>
              {t(membership ? 'parcelRotation.manage' : 'parcelRotation.assign')}
            </Button>
          ) : null}
        </Stack>
      </DetailSection>
      {dialog}
    </Box>
  );
}
