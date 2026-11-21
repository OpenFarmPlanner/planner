import { useEffect, useRef, useState } from 'react';
import { Alert, Button, List, ListItem, Stack, Typography } from '@mui/material';
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
  editableSeasonLabel?: string;
}

export function PlantingPlanTasks({ plan, projectId, editableSeasonLabel }: Props) {
  const { t, i18n } = useTranslation(['plantingPlans', 'dashboard']);
  const locale = resolveSeasonDateLocale(i18n);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const taskLoad = useRef<AbortController>(null);
  const planId = plan.id;

  useEffect(() => {
    const controller = new AbortController();
    taskLoad.current = controller;
    void taskAPI.listForPlan(planId, controller.signal).then(({ results }) => {
      if (!controller.signal.aborted) setTasks(results);
    }).catch(() => {
      if (!controller.signal.aborted) setLoadFailed(true);
    });
    return () => controller.abort();
  }, [attempt, planId]);

  const refresh = () => {
    taskLoad.current?.abort();
    setLoadFailed(false);
    setAttempt(value => value + 1);
  };

  const saveTask = async (payload: TaskWritePayload) => {
    const { data } = await taskAPI.create(payload);
    setTasks(previous => [...previous.filter(task => task.id !== data.id), data]);
    refresh();
  };

  return <>
    {loadFailed && <Alert severity="error" action={<LoadRetryButton onClick={refresh} />}>
      {t('details.tasksLoadFailed')}
    </Alert>}
    {(tasks.length > 0 || editableSeasonLabel !== undefined) && <DetailSection title={t('details.tasks')} outlined>
      {tasks.length > 0 && <List dense disablePadding>
        {tasks.map(task => <ListItem key={task.id} disableGutters sx={{ py: 0.5 }}>
          <Stack spacing={0.25} sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            <Typography variant="body1">{taskDisplayTitle(task, t)}</Typography>
            <Typography variant="body2" color="text.secondary">
              {[task.due_date ? formatSeasonDate(task.due_date, locale) : '', task.status === 'cancelled'
                ? t('details.taskCancelled') : t(`dashboard:board.status.${task.status}`)].filter(Boolean).join(' · ')}
            </Typography>
          </Stack>
        </ListItem>)}
      </List>}
      {editableSeasonLabel !== undefined && <Button onClick={() => setEditorOpen(true)}>
        {t('dashboard:form.add')}
      </Button>}
    </DetailSection>}
    {editorOpen && editableSeasonLabel !== undefined && <TaskFormDialog task={null}
      planContext={{ plan, projectId, seasonLabel: editableSeasonLabel }}
      onSave={saveTask} onClose={() => setEditorOpen(false)} />}
  </>;
}
