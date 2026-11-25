import { useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, List, ListItem, Stack, Typography } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import { taskAPI } from '../../api/api';
import type { Task } from '../../api/types';
import { useTranslation } from '../../i18n';
import { formatSeasonDate, resolveSeasonDateLocale } from '../../seasons/formatSeasonDate';
import LoadRetryButton from '../LoadRetryButton';
import { isOpenTask } from './taskBoard';
import { bedTaskDateBounds, bedTaskUrgencyLabel, orderBedTasks, summarizeBedTasks } from './bedTaskUrgency';
import { taskDisplayTitle } from './taskTitles';

interface BedTaskListProps {
  tasks: readonly Task[];
  loading: boolean;
  failed: boolean;
  refresh: () => void;
  canComplete?: boolean;
  onOpenDetails?: () => void;
}

export function BedTaskList({
  tasks, loading, failed, refresh, canComplete = true, onOpenDetails,
}: BedTaskListProps) {
  const { t, i18n } = useTranslation(['fields', 'dashboard', 'common']);
  const locale = resolveSeasonDateLocale(i18n);
  const [failedTask, setFailedTask] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const taskList = useRef<HTMLDivElement>(null);
  const compact = onOpenDetails !== undefined;
  const ordered = orderBedTasks(tasks);
  const open = ordered.filter(isOpenTask);
  const completed = ordered.filter(task => task.status === 'completed');
  const { urgency, outstanding, undated } = summarizeBedTasks(compact ? open : ordered, bedTaskDateBounds(new Date()));
  const visible = compact ? open.slice(0, 3) : open;
  const more = open.length - visible.length;

  const complete = async (id: number, button?: HTMLElement) => {
    if (!canComplete || saveLock.current || !tasks.some(task => task.id === id && isOpenTask(task))) return;
    const restoreFocus = button && document.activeElement === button;
    saveLock.current = true;
    setSaving(true);
    setFailedTask(null);
    try {
      await taskAPI.updateStatus(id, 'completed');
      if (restoreFocus && (document.activeElement === button || document.activeElement === document.body)) {
        taskList.current?.focus({ preventScroll: true });
      }
      refresh();
    } catch {
      setFailedTask(id);
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  };

  const renderTask = (task: Task) => {
    const title = taskDisplayTitle(task, t);
    return (
      <ListItem key={task.id} disableGutters sx={{ py: 0.5, gap: 1, alignItems: 'center' }}>
        <Stack spacing={0.25} sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
          <Typography variant={compact ? 'body2' : 'body1'}>{title}</Typography>
          <Typography variant={compact ? 'caption' : 'body2'} color="text.secondary">
            {task.due_date ? formatSeasonDate(task.due_date, locale) : t('dashboard:board.noDate')}
            {' · '}{task.status !== 'cancelled' && t(`dashboard:board.status.${task.status}`)}
          </Typography>
        </Stack>
        {canComplete && isOpenTask(task) && <Button size="small" startIcon={<CheckIcon fontSize="small" />}
          aria-label={t('fields:graphical.taskLayer.completeNamed', { title })}
          onClick={event => void complete(task.id, event.currentTarget)} disabled={saving}
          sx={{ minHeight: 44, flexShrink: 0 }}>
          {t('fields:graphical.taskLayer.complete')}
        </Button>}
      </ListItem>
    );
  };

  return (
    <Box ref={taskList} tabIndex={-1} aria-label={t('dashboard:board.title')}>
      {loading ? <CircularProgress size={20} aria-label={t('common:messages.loading')} /> : null}
      {failed ? <Alert severity="error" action={<LoadRetryButton onClick={refresh} />}>
        {t('fields:graphical.taskLayer.loadError')}
      </Alert> : null}
      {failedTask !== null && !loading && tasks.some(task => task.id === failedTask && isOpenTask(task)) ? (
        <Alert severity="error" action={<LoadRetryButton onClick={() => void complete(failedTask)} />}>
          {t('fields:graphical.taskLayer.saveError')}
        </Alert>
      ) : null}
      {!loading && !failed && (
        <Typography role={compact ? 'status' : undefined} variant="body2" color="text.secondary">
          {(compact ? open.length : ordered.length) === 0 ? t(compact ? 'graphical.objects.noOpenTasks' : 'graphical.taskLayer.none') : (
            <>
              {urgency ? `${bedTaskUrgencyLabel(urgency, t)} · ` : ''}
              {t('graphical.taskLayer.outstanding', { count: outstanding })}
              {undated > 0 ? ` · ${t('graphical.taskLayer.undatedCount', { count: undated })}` : ''}
            </>
          )}
        </Typography>
      )}
      {visible.length > 0 && <List dense disablePadding>{visible.map(renderTask)}</List>}
      {!compact && completed.length > 0 && (
        <Box component="details">
          <Box component="summary" sx={{ cursor: 'pointer', typography: 'body2', py: 1.25, minHeight: 44 }}>
            {t('graphical.display.completedTasks', { count: completed.length })}
          </Box>
          <List dense disablePadding>{completed.map(renderTask)}</List>
        </Box>
      )}
      {more > 0 && <Button size="small" onClick={onOpenDetails} sx={{ minHeight: 44 }}>
        {t('graphical.objects.moreTasks', { count: more })}
      </Button>}
    </Box>
  );
}
