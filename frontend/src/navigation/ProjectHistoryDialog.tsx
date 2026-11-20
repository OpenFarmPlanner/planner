import {
  Box,
  Button,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Link,
  IconButton,
  Menu,
  MenuItem,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import PersonOutlineIcon from '@mui/icons-material/PersonOutlineOutlined';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { useState } from 'react';
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

/** Grouped history retains a full-version action and secondary operation undo. */
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
  const [expanded, setExpanded] = useState<number[]>([]);
  const [menu, setMenu] = useState<{ element: HTMLElement; entry: CropHistoryEntry } | null>(null);
  const actorOf = (entry: CropHistoryEntry): string => (
    entry.actor_label?.trim()
    || entry.history_user?.trim()
    || fallbackActorLabel?.trim()
    || t('commandPalette.unknownUser')
  );

  const renderEntryMeta = (entry: CropHistoryEntry) => (
    <Box component="span" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, minWidth: 0, width: '100%' }}>
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'flex-start', gap: 0.5, flex: '1 1 160px', minWidth: 0 }}>
        <PersonOutlineIcon sx={{ fontSize: 14, mt: 0.5, color: 'text.secondary', flexShrink: 0 }} />
        <Typography component="span" variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', minWidth: 0, overflowWrap: 'anywhere' }}>
          {t('commandPalette.historyBy', { actor: actorOf(entry) })}
        </Typography>
      </Box>
      <Typography component="span" variant="caption" color="text.secondary" sx={{ maxWidth: '100%', overflowWrap: 'anywhere' }}>
        · {formatTimestamp(entry.history_date)}
      </Typography>
    </Box>
  );

  const restoreButton = (onClick: () => void) => (
    isPhonePortrait ? (
      <>
        <Divider />
        <Button variant="outlined" size="small" onClick={onClick} sx={{ alignSelf: 'flex-start', minHeight: 44 }}>
          {t('commandPalette.restoreVersion')}
        </Button>
      </>
    ) : (
      <Button onClick={onClick} sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
        {t('commandPalette.restoreVersion')}
      </Button>
    )
  );

  const currentVersionBadge = (
    <>
      {isPhonePortrait ? <Divider /> : null}
      <Chip
        label={tCrops('history.currentVersion')}
        size="small"
        color="success"
        variant="outlined"
        sx={{ alignSelf: 'flex-start', flexShrink: 0 }}
      />
    </>
  );

  const entryAction = (entry: CropHistoryEntry) => (
    entry.is_current_version ? currentVersionBadge : restoreButton(() => onRestore(entry))
  );

  const renderBatchGroup = (entry: CropHistoryEntry) => {
    const summary = getBatchSummary(entry, tCrops);
    const isImport = entry.batch_operation_type === 'crop_import';
    const action = entryAction(entry);
    const hideRevert = entry.batch_operation_type === 'crop_bulk_undelete'
      || (entry.batch_operation_type === 'crop_bulk_delete' && entry.batch_context?.is_reverted)
      || (entry.batch_operation_type === 'batch_reverted'
        && entry.batch_context?.reverted_operation_type === 'crop_import');
    const menuButton = hideRevert ? null : (
        <IconButton aria-label={isImport ? tCrops('history.import.actions') : t('globalMenu.moreActions')}
          sx={{ minWidth: { xs: 48, sm: 40 }, minHeight: { xs: 48, sm: 40 } }}
          onClick={event => setMenu({ element: event.currentTarget, entry })}>
          <MoreVertIcon />
        </IconButton>
      );
    if (isImport) {
      const children = [...new Map((entry.children ?? []).map(child => [
        `${child.object_type}-${child.object_id}`, child,
      ])).values()];
      const isExpanded = expanded.includes(entry.batch_id!);
      return (
        <Paper variant="outlined" sx={{ width: '100%', p: 1.5 }}>
          <Stack spacing={1}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{summary}</Typography>
                <Typography variant="caption" color="text.secondary" component="div">
                  {tCrops('import.created', { count: Number(entry.batch_context?.created_count ?? 0) })}
                  {' · '}
                  {tCrops('import.updated', { count: Number(entry.batch_context?.updated_count ?? 0) })}
                </Typography>
                {renderEntryMeta(entry)}
              </Box>
              {menuButton}
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}
              sx={{ flexWrap: 'wrap', '& .MuiButton-root': { minHeight: { xs: 48, sm: 40 } } }} useFlexGap>
              {action}
              <Button size="small" aria-expanded={isExpanded} onClick={() => setExpanded(previous => isExpanded ? previous.filter(id => id !== entry.batch_id) : [...previous, entry.batch_id!])}>
                {tCrops('history.import.details')}
              </Button>
            </Stack>
            <Collapse in={isExpanded}>
              <List disablePadding aria-label={tCrops('history.import.details')}>
                {children.map(child => <ListItem key={`${child.object_type}-${child.object_id}`} disableGutters>
                  <ListItemText primary={getHistoryEntryTarget(child) ? (
                    <Link component={RouterLink} to={getHistoryEntryTarget(child)!} onClick={onClose}
                      underline="hover" sx={{ display: 'block', py: 0.5 }}>
                      {getHistoryEntryTitle(child, tCrops)}
                    </Link>
                  ) : getHistoryEntryTitle(child, tCrops)} sx={{ overflowWrap: 'anywhere' }} />
                </ListItem>)}
              </List>
            </Collapse>
          </Stack>
        </Paper>
      );
    }

    if (isPhonePortrait) {
      return (
        <Paper variant="outlined" sx={{ width: '100%', p: 1.25, borderRadius: 1.5 }}>
          <Stack spacing={1}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
              <Typography variant="body2" sx={{ flex: 1, fontWeight: 600, lineHeight: 1.35 }}>{summary}</Typography>
              {menuButton}
            </Stack>
            {renderEntryMeta(entry)}
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
          secondary={renderEntryMeta(entry)}
        />
        {action}
        {menuButton}
      </Stack>
    );
  };

  const renderEntry = (entry: CropHistoryEntry) => {
    const historyTarget = getHistoryEntryTarget(entry);
    const title = getHistoryEntryTitle(entry, tCrops);
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
            {renderEntryMeta(entry)}
            {entryAction(entry)}
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
          secondary={renderEntryMeta(entry)}
        />
        {entryAction(entry)}
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
      <Menu anchorEl={menu?.element} open={Boolean(menu)} onClose={() => setMenu(null)}>
        <MenuItem sx={{ whiteSpace: 'normal', maxWidth: 'calc(100vw - 32px)' }} onClick={() => {
          if (menu) onRevertBatch(menu.entry);
          setMenu(null);
        }}>{tCrops(menu?.entry.batch_operation_type === 'crop_import' ? 'history.import.undo' : 'history.batch.undo')}</MenuItem>
      </Menu>
    </Dialog>
  );
}
