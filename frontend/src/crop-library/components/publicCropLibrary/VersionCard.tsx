import { Box, Button, Chip, Stack, Typography } from '@mui/material';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import RestoreOutlinedIcon from '@mui/icons-material/RestoreOutlined';
import type { PublicCropRevision } from '../../../api/types';
import { getPublicCropFieldLabel, getRevisionValueLabel } from './formatters';
import { DisabledActionTooltip } from '../../../components/DisabledActionTooltip';

export interface VersionCardProps {
  revision: PublicCropRevision;
  currentVersion: number;
  anonymousLabel: string;
  formatDate: (value?: string | null) => string;
  onRevert: (version: number) => Promise<void>;
  revertingVersion: number | null;
  t: (key: string, options?: Record<string, unknown>) => string;
  onDiscuss: (revision: PublicCropRevision) => void;
}

export function VersionCard({
  revision,
  currentVersion,
  anonymousLabel,
  formatDate,
  onRevert,
  revertingVersion,
  t,
  onDiscuss,
}: VersionCardProps) {
  const isCurrentVersion = revision.version === currentVersion;
  const changedFields = revision.changed_fields ?? [];

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { xs: 'flex-start', sm: 'center' },
        justifyContent: "space-between", }}  >
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {t('library.page.versions.versionTitle', { version: revision.version })}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t('library.page.metaByDate', {
              author: revision.created_by_label || anonymousLabel,
              date: formatDate(revision.created_at),
            })}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", }} >
          {revision.action === 'restored' && revision.restored_from_version ? (
            <Chip size="small" label={t('library.page.versions.restoredFrom', { version: revision.restored_from_version })} variant="outlined" />
          ) : null}
          <Chip
            size="small"
            label={isCurrentVersion ? t('library.page.versions.current') : t(`library.page.versions.actions.${revision.action}`)}
            color={isCurrentVersion ? 'success' : 'default'}
          />
        </Stack>
      </Stack>
      {changedFields.length > 0 ? (
        <Stack spacing={0.75} sx={{ mt: 1.25 }}>
          {changedFields.map((change) => (
            <Box key={change.field}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {getPublicCropFieldLabel(change.field, t)}
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {getRevisionValueLabel(change.old_value, t('library.page.notSpecified'))}
                {' → '}
                {getRevisionValueLabel(change.new_value, t('library.page.notSpecified'))}
              </Typography>
            </Box>
          ))}
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.25 }}>
          {t('library.page.versions.noFieldChanges')}
        </Typography>
      )}
      {!isCurrentVersion ? (
        <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
          <DisabledActionTooltip title={revertingVersion !== null ? t('common:disabledReasons.busy') : ''}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<RestoreOutlinedIcon />}
              disabled={revertingVersion !== null}
              onClick={() => void onRevert(revision.version)}
            >
              {revertingVersion === revision.version ? t('library.page.versions.reverting') : t('library.page.versions.revert')}
            </Button>
          </DisabledActionTooltip>
          <Button size="small" variant="text" startIcon={<ForumOutlinedIcon />} onClick={() => onDiscuss(revision)}>
            {t('library.page.versions.discuss')}
          </Button>
        </Stack>
      ) : null}
    </Box>
  );
}
