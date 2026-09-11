import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Link,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import PersonOutlineIcon from '@mui/icons-material/PersonOutlineOutlined';
import { Link as RouterLink } from 'react-router';
import type { TFunction } from 'i18next';

import type { CropHistoryEntry } from '../api/types';
import {
  getBatchSummary,
  getHistoryEntryTarget,
  getHistoryEntryTitle,
  isBatchGroupEntry,
} from '../pages/cropsHistoryUtils';

interface ProjectHistoryDialogProps {
  open: boolean;
  items: CropHistoryEntry[];
  isPhonePortrait: boolean;
  fallbackActorLabel: string | undefined;
  formatTimestamp: (value: string) => string;
  onClose: () => void;
  onRestore: (entry: CropHistoryEntry) => void;
  onRevertBatch: (entry: CropHistoryEntry) => void;
  /** `navigation` namespace translator (also resolves `common:`/`navigation:`). */
  t: TFunction;
  tCrops: TFunction<'crops'>;
}

/**
 * Presentational project version-history dialog. A cascading action (season
 * create/delete/undelete/data-copy) arrives from the API as one `is_batch`
 * entry that renders as a single row with a single "rückgängig machen"; every
 * other revision renders flat with "Version wiederherstellen". State, data
 * loading and the action handlers live in RootLayout.tsx. German-only copy is
 * intentional, matching RestoreVersionDialog.
 */
export function ProjectHistoryDialog({
  open,
  items,
  isPhonePortrait,
  fallbackActorLabel,
  formatTimestamp,
  onClose,
  onRestore,
  onRevertBatch,
  t,
  tCrops,
}: ProjectHistoryDialogProps) {
  const actorOf = (entry: CropHistoryEntry): string => (
    entry.actor_label?.trim()
    || entry.history_user?.trim()
    || fallbackActorLabel?.trim()
    || t('commandPalette.unknownUser')
  );

  const renderBatchMeta = (entry: CropHistoryEntry) => (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
      <PersonOutlineIcon sx={{ fontSize: 14, color: 'text.secondary', flexShrink: 0 }} />
      <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>
        {t('commandPalette.historyBy', { actor: actorOf(entry) })}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        · {formatTimestamp(entry.history_date)}
      </Typography>
    </Box>
  );

  const restoreButton = (onClick: () => void) => (
    isPhonePortrait ? (
      <>
        <Divider />
        <Button variant="outlined" size="small" onClick={onClick} sx={{ alignSelf: 'flex-start', minHeight: 34 }}>
          {t('commandPalette.restoreVersion')}
        </Button>
      </>
    ) : (
      <Button onClick={onClick} sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
        {t('commandPalette.restoreVersion')}
      </Button>
    )
  );

  const renderBatchGroup = (entry: CropHistoryEntry) => {
    const summary = getBatchSummary(entry, tCrops);
    const action = restoreButton(() => onRevertBatch(entry));

    if (isPhonePortrait) {
      return (
        <Paper variant="outlined" sx={{ width: '100%', p: 1.25, borderRadius: 1.5 }}>
          <Stack spacing={1}>
            <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.35 }}>{summary}</Typography>
            {renderBatchMeta(entry)}
            {action}
          </Stack>
        </Paper>
      );
    }
    return (
      <Stack direction="row" spacing={2} sx={{ width: '100%', alignItems: 'flex-start' }}>
        <ListItemText
          sx={{ mr: 1 }}
          disableTypography
          primary={<Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.35 }}>{summary}</Typography>}
          secondary={renderBatchMeta(entry)}
        />
        {action}
      </Stack>
    );
  };

  const renderEntry = (entry: CropHistoryEntry) => {
    const historyTarget = getHistoryEntryTarget(entry);
    const title = getHistoryEntryTitle(entry, tCrops);
    const actorLabel = actorOf(entry);
    const timestampLabel = formatTimestamp(entry.history_date);
    const targetLink = historyTarget ? (
      <Link
        component={RouterLink}
        to={historyTarget}
        underline="hover"
        onClick={onClose}
        sx={isPhonePortrait ? { fontSize: '0.78rem', color: 'text.secondary', flexShrink: 0 } : undefined}
      >
        {entry.object_type === 'crop' ? tCrops('crop') : t('navigation:plantingPlans')}
      </Link>
    ) : null;

    if (isPhonePortrait) {
      return (
        <Paper variant="outlined" sx={{ width: '100%', p: 1.25, borderRadius: 1.5 }}>
          <Stack spacing={1}>
            {targetLink ? (
              <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>{targetLink}</Box>
            ) : null}
            <Typography
              variant="body2"
              sx={{
                fontWeight: 600,
                lineHeight: 1.35,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                wordBreak: 'normal',
                overflowWrap: 'break-word',
              }}
            >
              {title}
            </Typography>
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
              <PersonOutlineIcon sx={{ fontSize: 14, color: 'text.secondary', flexShrink: 0 }} />
              <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>
                {t('commandPalette.historyBy', { actor: actorLabel })}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                · {timestampLabel}
              </Typography>
            </Box>
            {restoreButton(() => onRestore(entry))}
          </Stack>
        </Paper>
      );
    }

    return (
      <Stack direction="row" spacing={2} sx={{ width: '100%', alignItems: 'flex-start' }}>
        <ListItemText
          sx={{ mr: 1 }}
          primary={(
            <>
              {title}
              {targetLink ? (
                <>
                  {' · '}
                  {targetLink}
                </>
              ) : null}
            </>
          )}
          secondary={(
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
              <PersonOutlineIcon sx={{ fontSize: 14, color: 'text.secondary', flexShrink: 0 }} />
              <Typography component="span" variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>
                {t('commandPalette.historyBy', { actor: actorLabel })}
              </Typography>
              <Typography component="span" variant="caption" color="text.secondary">
                · {timestampLabel}
              </Typography>
            </Box>
          )}
        />
        {restoreButton(() => onRestore(entry))}
      </Stack>
    );
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('commandPalette.versionHistoryTitle')}</DialogTitle>
      <DialogContent sx={{ py: isPhonePortrait ? 1 : 2 }}>
        {items.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
            {t('commandPalette.versionHistoryEmpty')}
          </Typography>
        ) : null}
        <List>
          {items.map((item) => (
            <ListItem
              key={isBatchGroupEntry(item) ? `batch-${item.batch_id}` : item.history_id}
              disableGutters
              sx={{ mb: isPhonePortrait ? 1 : 0 }}
            >
              {isBatchGroupEntry(item) ? renderBatchGroup(item) : renderEntry(item)}
            </ListItem>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:actions.close')}</Button>
      </DialogActions>
    </Dialog>
  );
}
