import { useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { Alert, Button, CircularProgress, List, ListItem, Stack, Typography } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import { taskAPI } from '../../api/api';
import { useTranslation } from '../../i18n';
import { formatSeasonDate, resolveSeasonDateLocale } from '../../seasons/formatSeasonDate';
import { DetailSection } from '../layout/DetailPrimitives';
import LoadRetryButton from '../LoadRetryButton';
import { isOpenTask } from './taskBoard';
import { bedTaskDateBounds, bedTaskUrgencyLabel, summarizeBedTasks } from './bedTaskUrgency';
import { taskDisplayTitle } from './taskTitles';
import { useBedTasks } from './useBedTasks';

export function BedTaskSection({ bedId, seasonId }: { bedId: number; seasonId?: number }) {
  const { t, i18n } = useTranslation(['fields', 'dashboard', 'common']);
  const locale = resolveSeasonDateLocale(i18n);
  const { tasksByBed, loading, failed, refresh } = useBedTasks('bed', bedId, seasonId);
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const tasks = [...(tasksByBed.get(bedId) ?? [])].sort((a, b) => {
    if (a.due_date === b.due_date) return a.id - b.id;
    if (a.due_date === null) return 1;
    if (b.due_date === null) return -1;
    return a.due_date.localeCompare(b.due_date);
  });
  const { urgency, outstanding, undated } = summarizeBedTasks(tasks, bedTaskDateBounds(new Date()));

  const complete = async (id: number) => {
    if (saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    setSaveError(false);
    try {
      await taskAPI.updateStatus(id, 'completed');
      refresh();
    } catch {
      setSaveError(true);
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  };

  return (
    <DetailSection title={t('dashboard:board.title')}>
      {loading ? <CircularProgress size={20} aria-label={t('common:messages.loading')} /> : null}
      {failed ? <Alert severity="error" action={<LoadRetryButton onClick={refresh} />}>
        {t('fields:graphical.taskLayer.loadError')}
      </Alert> : null}
      {saveError ? <Alert severity="error">{t('fields:graphical.taskLayer.saveError')}</Alert> : null}
      {!loading && !failed && (tasks.length === 0 ? (
        <Typography variant="body2">{t('fields:graphical.taskLayer.none')}</Typography>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary">
            {urgency ? `${bedTaskUrgencyLabel(urgency, t)} · ` : ''}
            {t('fields:graphical.taskLayer.outstanding', { count: outstanding })}
            {undated > 0 ? ` · ${t('fields:graphical.taskLayer.undatedCount', { count: undated })}` : ''}
          </Typography>
          <List dense disablePadding>
            {tasks.map(task => {
              const title = taskDisplayTitle(task, t);
              return (
                <ListItem key={task.id} disableGutters sx={{ py: 0.5, gap: 1, alignItems: 'center' }}>
                  <Stack spacing={0.25} sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                    <Typography variant="body1">{title}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {task.due_date ? formatSeasonDate(task.due_date, locale) : t('dashboard:board.noDate')}
                      {' · '}{task.status !== 'cancelled' && t(`dashboard:board.status.${task.status}`)}
                    </Typography>
                  </Stack>
                  {isOpenTask(task) && <Button size="small" startIcon={<CheckIcon fontSize="small" />}
                    aria-label={t('fields:graphical.taskLayer.completeNamed', { title })}
                    onClick={() => void complete(task.id)} disabled={saving}
                    sx={{ minHeight: 44, flexShrink: 0 }}>
                    {t('fields:graphical.taskLayer.complete')}
                  </Button>}
                </ListItem>
              );
            })}
          </List>
        </>
      ))}
      <Button component={RouterLink} to="/app/dashboard">{t('fields:graphical.taskLayer.allTasks')}</Button>
    </DetailSection>
  );
}
