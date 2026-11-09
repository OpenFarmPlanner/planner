import { loadRetryAlertSx } from '../components/loadRetryStyles';
import LoadRetryButton from '../components/LoadRetryButton';
import { Alert, Box, Button, Card, CardContent, Divider, Stack, Typography } from '@mui/material';
import { Link as RouterLink, useOutletContext } from 'react-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../i18n';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import SproutOutlinedIcon from '@mui/icons-material/SpaOutlined';
import { bedAPI, cropAPI, fieldAPI, plantingPlanAPI, projectAPI, taskAPI, type Bed, type Crop, type Field, type PlantingPlan, type ProjectMemberPayload } from '../api/api';
import PageContainer from '../components/layout/PageContainer';
import PageSurface from '../components/layout/PageSurface';
import ProjectRequiredState from '../components/project/ProjectRequiredState';
import { useProjectRequirement } from '../hooks/useProjectRequirement';
import { getFirstMissingProjectSetupStep, getTranslatedProjectSetupActions } from './requirementFlow';
import TaskBoard from '../components/tasks/TaskBoard';
import { taskDisplayTitle } from '../components/tasks/taskTitles';
import TaskFormDialog from '../components/tasks/TaskFormDialog';
import { ConfirmationDialog } from '../components/feedback/ConfirmationDialog';
import { EMPTY_TASK_FILTERS, type BoardStatus, type TaskFilters } from '../components/tasks/taskBoard';
import type { Task, TaskWritePayload } from '../api/types';
import type { RootLayoutOutletContext } from '../navigation/topbarTypes';

export default function Dashboard() {
  const { t } = useTranslation(['dashboard', 'common']);
  const { shouldShowProjectRequiredState, missingProjectReason, activeProjectId } = useProjectRequirement();
  const [isFetching, setLoading] = useState(true);
  const [fetchError, setError] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<ProjectMemberPayload[]>([]);
  const [filters, setFilters] = useState<TaskFilters>({ ...EMPTY_TASK_FILTERS });
  const [savingIds, setSavingIds] = useState<number[]>([]);
  const [saveError, setSaveError] = useState(false);
  const [editor, setEditor] = useState<Task | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const deleteLock = useRef(false);
  const pendingIds = useRef(new Set<number>());
  const loadGeneration = useRef(0);
  const context = useOutletContext<RootLayoutOutletContext | undefined>();
  const seasonId = context?.activeSeason?.id;
  const waitingForSeason = context?.activeSeasonLoaded === false;
  const [fields, setFields] = useState<Field[]>([]);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [crops, setCrops] = useState<Crop[]>([]);
  const [plans, setPlans] = useState<PlantingPlan[]>([]);

  // Without a project there is nothing to fetch, so the page is neither
  // loading nor in error. Derived rather than pushed into state from the
  // effect below — the fetched collections do not need clearing either,
  // because the project-required branch renders before they are read and
  // `loading` is back to true by the time a project appears.
  const loading = shouldShowProjectRequiredState ? false : isFetching || waitingForSeason;
  const error = shouldShowProjectRequiredState ? null : fetchError;

  useEffect(() => {
    if (shouldShowProjectRequiredState || !activeProjectId || waitingForSeason) {
      return;
    }
    let cancelled = false;
    loadGeneration.current += 1;
    const fetchData = async (): Promise<void> => {
      try {
        setLoading(true);
        const [fieldsRes, bedsRes, cropsRes, plansRes, tasksRes, membersRes] = await Promise.all([
          fieldAPI.listAll(), bedAPI.listAll(), cropAPI.listAll(), plantingPlanAPI.listAll(), taskAPI.listAll(), projectAPI.listMembers(activeProjectId),
        ]);
        if (cancelled) return;
        setTasks(tasksRes.results);
        setMembers(membersRes.data);
        setFields(fieldsRes.results);
        setBeds(bedsRes.results);
        setCrops(cropsRes.results);
        setPlans(plansRes.results);
        setError(false);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void fetchData();
    return () => { cancelled = true; };
  }, [shouldShowProjectRequiredState, activeProjectId, seasonId, waitingForSeason, retryAttempt]);

  const changeStatus = async (id: number, status: BoardStatus): Promise<boolean> => {
    const task = tasks.find((row) => row.id === id);
    if (!task || task.status === status || pendingIds.current.has(id)) return false;
    const generation = loadGeneration.current;
    pendingIds.current.add(id);
    setSavingIds((previous) => [...previous, id]);
    setSaveError(false);
    setTasks((previous) => previous.map((row) => row.id === id ? { ...row, status } : row));
    try {
      const response = await taskAPI.updateStatus(id, status);
      if (generation === loadGeneration.current) {
        setTasks((previous) => previous.map((row) => row.id === id ? response.data : row));
      }
      return generation === loadGeneration.current;
    } catch {
      if (generation === loadGeneration.current) {
        setTasks((previous) => previous.map((row) => row.id === id ? task : row));
        setSaveError(true);
      }
      return false;
    } finally {
      pendingIds.current.delete(id);
      setSavingIds((previous) => previous.filter((value) => value !== id));
    }
  };

  const saveTask = async (payload: TaskWritePayload): Promise<void> => {
    const response = editor ? await taskAPI.update(editor.id, payload) : await taskAPI.create(payload);
    setTasks((previous) => editor
      ? previous.map((task) => task.id === editor.id ? response.data : task)
      : [...previous, response.data]);
    if (!editor) setFilters({ ...EMPTY_TASK_FILTERS });
  };

  const deleteTask = async (): Promise<void> => {
    if (!deleting || deleteLock.current) return;
    deleteLock.current = true;
    setDeleteBusy(true);
    setDeleteError(false);
    try {
      await taskAPI.delete(deleting.id);
      setTasks((previous) => previous.filter((task) => task.id !== deleting.id));
      setDeleting(null);
    } catch {
      setDeleteError(true);
    } finally {
      deleteLock.current = false;
      setDeleteBusy(false);
    }
  };

  const firstMissingChecklistStep = getFirstMissingProjectSetupStep({
    hasFields: fields.length > 0,
    hasBeds: beds.length > 0,
    hasCrops: crops.length > 0,
    hasPlans: plans.length > 0,
  });

  const checklistItems = [
    { key: 'fields', label: t('dashboard:checklist.field'), done: fields.length > 0 },
    { key: 'beds', label: t('dashboard:checklist.bed'), done: beds.length > 0 },
    { key: 'crops', label: t('dashboard:checklist.crop'), done: crops.length > 0 },
    { key: 'plans', label: t('dashboard:checklist.plan'), done: plans.length > 0 },
  ] as const;

  if (loading) return <PageContainer mobileInset><PageSurface variant="contentFit"><Typography>{t('common:messages.loading')}</Typography></PageSurface></PageContainer>;
  if (shouldShowProjectRequiredState && missingProjectReason) return <PageContainer mobileInset><PageSurface variant="contentFit"><ProjectRequiredState reason={missingProjectReason} /></PageSurface></PageContainer>;

  if (error) {
    return (
      <PageContainer mobileInset>
        <Alert severity="error" sx={loadRetryAlertSx} action={<LoadRetryButton disabled={loading} onClick={() => setRetryAttempt((attempt) => attempt + 1)} />}>
          {t('dashboard:errors.load')}
        </Alert>
      </PageContainer>
    );
  }

  const isSetupComplete = firstMissingChecklistStep === null;
  const nextSetupActions = firstMissingChecklistStep ? getTranslatedProjectSetupActions(firstMissingChecklistStep, t) : [];

  return (
    <PageContainer mobileInset>

      {!isSetupComplete ? (
        <PageSurface variant="contentFit" sx={{ mb: 2, minWidth: { md: 480 } }}>
        <Card variant="outlined" sx={{ width: 'fit-content', maxWidth: '100%' }}>
          <CardContent>
            <Stack direction="row" spacing={1} sx={{ mb: 0.75,
              alignItems: "center", }}  >
              <SproutOutlinedIcon fontSize="small" sx={{ color: 'text.secondary' }} />
              <Typography variant="h6">{t('dashboard:checklist.title')}</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.75, maxWidth: 720, lineHeight: 1.5 }}>
              {t('dashboard:checklist.intro')}
            </Typography>
            <Divider sx={{ mb: 2 }} />
            <Stack spacing={1.6} sx={{ mb: 2.75 }}>
              {checklistItems.map((item) => {
                const isNextStep = firstMissingChecklistStep === item.key;
                return (
                  <Box key={item.key} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25 }}>
                    <Box sx={{ mt: 0.1 }}>
                      {item.done ? (
                        <CheckBoxIcon fontSize="small" color="success" />
                      ) : (
                        <CheckBoxOutlineBlankIcon fontSize="small" color={isNextStep ? 'primary' : 'disabled'} />
                      )}
                    </Box>
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: isNextStep ? 700 : 500,
                        color: isNextStep ? 'text.primary' : 'text.secondary',
                        lineHeight: 1.45,
                      }}
                    >
                      {item.label}
                    </Typography>
                  </Box>
                );
              })}
            </Stack>
            {nextSetupActions.length > 0 ? (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                {nextSetupActions.map((action, index) => (
                  <Button
                    key={action.to}
                    component={RouterLink}
                    to={action.to}
                    variant={index === 0 ? 'contained' : 'outlined'}
                  >
                    {action.label}
                  </Button>
                ))}
              </Stack>
            ) : null}
          </CardContent>
        </Card>
        </PageSurface>
      ) : null}

      {(seasonId || tasks.length > 0 || isSetupComplete) && <PageSurface variant="fullWorkspace">
        {saveError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setSaveError(false)}>
          {t('dashboard:board.saveError')}
        </Alert>}
        <TaskBoard tasks={tasks} crops={crops} fields={fields} beds={beds} plans={plans}
          members={members} savingIds={savingIds} filters={filters} onFiltersChange={setFilters}
          onStatusChange={changeStatus}
          hasSeason={Boolean(seasonId)} onCreate={() => {
            if (seasonId) setEditor(null);
            else context?.requestSeasonCreation();
          }} onEdit={setEditor} onDelete={(task) => { setDeleteError(false); setDeleting(task); }} />
      </PageSurface>}
      {editor !== undefined && <TaskFormDialog key={editor?.id ?? 'new'} task={editor} seasonId={seasonId}
        crops={crops} fields={fields} beds={beds} plans={plans} members={members}
        onSave={saveTask} onClose={() => setEditor(undefined)} />}
      <ConfirmationDialog open={Boolean(deleting)} title={t('dashboard:form.delete')}
        message={<>{t('dashboard:form.deleteConfirm', { title: deleting ? taskDisplayTitle(deleting, t) : '' })}
          {deleteError && <Alert severity="error" sx={{ mt: 2 }}>{t('dashboard:form.deleteError')}</Alert>}</>}
        messageTypographyProps={{ component: 'div' }}
        cancelLabel={t('common:actions.cancel')} confirmLabel={t('common:actions.delete')}
        onCancel={() => { if (!deleteBusy) setDeleting(null); }} onConfirm={() => { void deleteTask(); }}
        cancelButtonProps={{ disabled: deleteBusy }} confirmButtonProps={{ color: 'error', disabled: deleteBusy }} />
    </PageContainer>
  );
}
