import { useEffect, useRef, useState } from 'react';
import { Alert, Button, IconButton, List, ListItem, Stack, Typography } from '@mui/material';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { taskAPI } from '../api/api';
import type { PlantingPlanDetail, Task, TaskWritePayload } from '../api/types';
import { DetailSection } from '../components/layout/DetailPrimitives';
import LoadRetryButton from '../components/LoadRetryButton';
import TaskFormDialog from '../components/tasks/TaskFormDialog';
import { taskDisplayTitle } from '../components/tasks/taskTitles';
import { useTranslation } from '../i18n';
import { formatSeasonDate, resolveSeasonDateLocale } from '../seasons/formatSeasonDate';

interface Props {
  plan: PlantingPlanDetail;
  projectId: number;
  recordSeasonId?: number;
  editableSeasonLabel?: string;
}

export function PlantingPlanTasks({ plan, projectId, recordSeasonId, editableSeasonLabel }: Props) {
  const { t, i18n } = useTranslation(['plantingPlans', 'dashboard']);
  const locale = resolveSeasonDateLocale(i18n);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [editor, setEditor] = useState<Task | 'new' | null>(null);
  const taskLoad = useRef<AbortController>(null);
  const planId = plan.id;
  const seasonId = recordSeasonId ?? plan.season;
  const canEdit = seasonId != null && editableSeasonLabel !== undefined;

  useEffect(() => {
    const controller = new AbortController();
    taskLoad.current = controller;
    void taskAPI.listForPlan(planId, controller.signal, recordSeasonId).then(({ results }) => {
      if (!controller.signal.aborted) setTasks(results);
    }).catch(() => {
      if (!controller.signal.aborted) setLoadFailed(true);
    });
    return () => controller.abort();
  }, [attempt, planId, recordSeasonId]);

  const refresh = () => {
    taskLoad.current?.abort();
    setLoadFailed(false);
    setAttempt(value => value + 1);
  };

  const saveTask = async (payload: TaskWritePayload) => {
    const { data } = editor && editor !== 'new'
      ? await taskAPI.update(editor.id, payload, recordSeasonId)
      : await taskAPI.create(payload);
    setTasks(previous => [...previous.filter(task => task.id !== data.id), data]);
    refresh();
  };

  return <>
    {loadFailed && <Alert severity="error" action={<LoadRetryButton onClick={refresh} />}>
      {t('details.tasksLoadFailed')}
    </Alert>}
    {(tasks.length > 0 || canEdit) && <DetailSection title={t('details.tasks')}>
      {tasks.length > 0 && <List dense disablePadding>
        {tasks.map(task => <ListItem key={task.id} disableGutters sx={{ py: 0.5, gap: 1 }}>
          <Stack spacing={0.25} sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
            <Typography variant="body1">{taskDisplayTitle(task, t)}</Typography>
            <Typography variant="body2" color="text.secondary">
              {[task.due_date ? formatSeasonDate(task.due_date, locale) : '', task.status === 'cancelled'
                ? t('details.taskCancelled') : t(`dashboard:board.status.${task.status}`)].filter(Boolean).join(' · ')}
            </Typography>
          </Stack>
          {canEdit && <IconButton onClick={() => setEditor(task)} sx={{ width: 44, height: 44 }}
            aria-label={`${t('dashboard:form.edit')} · ${taskDisplayTitle(task, t)}`}>
            <EditOutlinedIcon fontSize="small" />
          </IconButton>}
        </ListItem>)}
      </List>}
      {canEdit && <Button onClick={() => setEditor('new')}>
        {t('dashboard:form.add')}
      </Button>}
    </DetailSection>}
    {editor && canEdit && <TaskFormDialog task={editor === 'new' ? null : editor}
      planContext={{ plan, projectId, seasonId, seasonLabel: editableSeasonLabel }}
      onSave={saveTask} onClose={() => setEditor(null)} />}
  </>;
}
