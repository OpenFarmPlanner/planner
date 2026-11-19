import {
  Alert,
  Box,
  Button,
  Chip,
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
import { useEffect, useRef } from 'react';
import { Link as RouterLink } from 'react-router';

import type { TFunction } from 'i18next';

import type { CropHistoryEntry } from '../api/types';
import {
  formatHistoryChangeValue,
  getHistoryChangeFieldLabel,
  getHistoryEntryMeta,
  getHistoryEntryTarget,
  getHistoryEntryTitle,
  isCurrentHistoryEntry,
  type HistoryScope,
} from './cropsHistoryUtils';

type CropsHistoryDialogProps = {
  open: boolean;
  scope: HistoryScope;
  items: CropHistoryEntry[];
  isMobile: boolean;
  fallbackActorLabel: string | undefined;
  restoreError?: string | null;
  onClose: () => void;
  onRestore: (historyId: number) => void;
  t: TFunction<'crops'>;
};

/**
 * Presentational history dialog for the crops page (crop, project and
 * global scopes; mobile card and desktop list layouts). State, data loading
 * and the restore handler live in Crops.tsx.
 */
export function CropsHistoryDialog({
  open,
  scope,
  items,
  isMobile,
  fallbackActorLabel,
  restoreError,
  onClose,
  onRestore,
  t,
}: CropsHistoryDialogProps) {
  const restoreErrorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && restoreError) restoreErrorRef.current?.focus();
  }, [open, restoreError]);
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {scope === 'project'
          ? t('history.titles.project')
          : scope === 'global'
            ? t('history.titles.global')
            : t('history.titles.crop')}
      </DialogTitle>
      <DialogContent sx={{ pt: items.length === 0 ? 1 : 2, pb: items.length === 0 ? 1 : 2 }}>
        {restoreError ? (
          <Alert severity="error" tabIndex={-1} ref={restoreErrorRef} sx={{ mb: 1 }}>
            {restoreError}
          </Alert>
        ) : null}
        {items.length === 0 ? (
          <Box sx={{ py: isMobile ? 0.5 : 1 }}>
            <Typography variant="body2" color="text.secondary">
              {t('history.emptyState.title')}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {t('history.emptyState.description')}
            </Typography>
          </Box>
        ) : (
          <>
          <List>
            {items.map((item, index) => {
              const isCurrentVersion = isCurrentHistoryEntry(item, index);
              const isCropHistory = scope === 'crop';
              const historyTarget = getHistoryEntryTarget(item);
              const mobileTitle = getHistoryEntryTitle(item, t);
              const mobileMeta = getHistoryEntryMeta(item, t, fallbackActorLabel);
              const changes = item.changes ?? [];
              const changeList = changes.length > 0 ? (
                <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                    {t('history.changedFields')}
                  </Typography>
                  <Stack component="ul" spacing={0.25} sx={{ m: 0, pl: 2 }}>
                    {changes.map((change) => (
                      <Typography
                        key={`${item.history_id}-${change.field}`}
                        component="li"
                        variant="caption"
                        color="text.secondary"
                        sx={{ lineHeight: 1.35 }}
                      >
                        <Typography component="span" variant="caption" sx={{ color: 'text.primary', fontWeight: 600 }}>
                          {getHistoryChangeFieldLabel(change, t)}
                        </Typography>
                        {': '}
                        {change.field === 'created'
                          ? formatHistoryChangeValue(change.new_value, change.field, t)
                          : `${formatHistoryChangeValue(change.old_value, change.field, t)} → ${formatHistoryChangeValue(change.new_value, change.field, t)}`}
                      </Typography>
                    ))}
                  </Stack>
                </Stack>
              ) : null;
              return (
                <ListItem key={item.history_id} disableGutters sx={{ mb: isMobile ? 1 : 0 }}>
                  {isMobile ? (
                    <Paper variant="outlined" sx={{ width: '100%', p: 1.25, borderRadius: 1.5 }}>
                      <Stack spacing={1}>
                        {!isCropHistory ? (
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                            <Chip
                              size="small"
                              label={item.object_type === 'crop' ? t('history.objectTypes.crop') : t('history.objectTypes.plantingPlan')}
                              variant="outlined"
                            />
                            {historyTarget ? (
                              <Link
                                component={RouterLink}
                                to={historyTarget}
                                underline="hover"
                                onClick={onClose}
                                sx={{ fontSize: '0.78rem', color: 'text.secondary', flexShrink: 0 }}
                              >
                                {t('history.objectTypes.openTarget')}
                              </Link>
                            ) : null}
                          </Box>
                        ) : null}
                        {!isCropHistory ? (
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
                            {mobileTitle}
                          </Typography>
                        ) : null}
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{
                            lineHeight: 1.3,
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            wordBreak: 'normal',
                            overflowWrap: 'break-word',
                          }}
                        >
                          {mobileMeta}
                        </Typography>
                        {isCropHistory ? changeList : null}
                        <Divider />
                        {isCurrentVersion ? (
                          <Chip
                            label={t('history.currentVersion')}
                            size="small"
                            color="success"
                            variant="outlined"
                            sx={{ alignSelf: 'flex-start' }}
                          />
                        ) : (
                          <Button
                            variant="outlined"
                            size="small"
                            onClick={() => onRestore(item.history_id)}
                            sx={{ alignSelf: 'flex-start', minHeight: 34 }}
                          >
                            {t('history.restoreButton')}
                          </Button>
                        )}
                      </Stack>
                    </Paper>
                  ) : (
                    <Stack direction="row" spacing={2} sx={{ width: '100%',
                      alignItems: "flex-start", }}  >
                      <ListItemText
                        sx={{ mr: 1 }}
                        disableTypography
                        primary={!isCropHistory ? (
                          <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.35 }}>
                            {mobileTitle}
                            {historyTarget ? (
                              <>
                                {' · '}
                                <Link component={RouterLink} to={historyTarget} underline="hover" onClick={onClose}>
                                  {item.object_type === 'crop' ? t('history.objectTypes.crop') : t('history.objectTypes.plantingPlan')}
                                </Link>
                              </>
                            ) : null}
                          </Typography>
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            {mobileMeta}
                          </Typography>
                        )}
                        secondary={isCropHistory ? changeList : (
                          <Typography variant="caption" color="text.secondary">
                            {mobileMeta}
                          </Typography>
                        )}
                      />
                      {isCurrentVersion ? (
                        <Chip
                          label={t('history.currentVersion')}
                          size="small"
                          color="success"
                          variant="outlined"
                        />
                      ) : (
                        <Button onClick={() => onRestore(item.history_id)} sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                          {t('history.restoreButton')}
                        </Button>
                      )}
                    </Stack>
                  )}
                </ListItem>
              );
            })}
          </List>
          {items.length === 1 && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, pt: 1, borderTop: 1, borderColor: 'divider' }}>
              {t('history.emptyState.onlyCurrentVersion')}
            </Typography>
          )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('history.closeButton')}</Button>
      </DialogActions>
    </Dialog>
  );
}
