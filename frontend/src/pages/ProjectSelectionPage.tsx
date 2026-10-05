import {
  Alert,
  Box,
  Button,
  CircularProgress,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { projectAPI, type ProjectPayload } from '../api/api';
import { useAuth } from '../auth/useAuth';
import { useGuestDemoGuard } from '../auth/useGuestDemoGuard';
import { useTranslation } from '../i18n';
import { createDemoProjectAndSwitch } from '../projects/demoProjectFlow';
import { clearDevOnboardingPreview, isDevOnboardingPreviewEnabled } from '../projects/devOnboardingPreview';
import { openProjectCreationFlow } from '../projects/projectCreationFlow';
import { showProjectDeleteUndoSnackbar } from '../projects/projectDeletionFeedback';
import { confirmAction } from '../utils/confirmAction';
import { showGlobalSnackbar } from '../utils/globalSnackbar';
import { AppTooltip } from '../components/AppTooltip';

const isDevQuickDeleteEnabled = import.meta.env.DEV;

export default function ProjectSelectionPage() {
  const { user, switchActiveProject, refreshUser } = useAuth();
  const { blockInGuestDemo } = useGuestDemoGuard();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation(['navigation', 'common', 'projectInvitations']);
  const memberships = user?.memberships ?? [];
  const [isDevOnboardingPreview, setIsDevOnboardingPreview] = useState(() => isDevOnboardingPreviewEnabled());
  const [deletedProjects, setDeletedProjects] = useState<ProjectPayload[]>([]);
  const [trashError, setTrashError] = useState<string | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);
  const [isCreatingDemoProject, setIsCreatingDemoProject] = useState(false);
  const [quickDeletingProjectId, setQuickDeletingProjectId] = useState<number | null>(null);
  const [renderedAt] = useState(() => Date.now());
  const isMountedRef = useRef(false);
  const isTrashView = searchParams.get('trash') === '1';

  const loadDeletedProjects = useCallback(async (): Promise<void> => {
    try {
      const response = await projectAPI.listDeleted();
      if (!isMountedRef.current) {
        return;
      }
      const payload = response.data;
      setDeletedProjects(Array.isArray(payload) ? payload : payload.results);
      setTrashError(null);
    } catch {
      if (!isMountedRef.current) {
        return;
      }
      setDeletedProjects([]);
      setTrashError(t('projectTrash.loadError'));
    }
  }, [t]);

  useEffect(() => {
    isMountedRef.current = true;
    if (!isTrashView) {
      return () => {
        isMountedRef.current = false;
      };
    }
    const timeoutId = window.setTimeout(() => {
      void loadDeletedProjects();
    }, 0);

    return () => {
      isMountedRef.current = false;
      window.clearTimeout(timeoutId);
    };
  }, [isTrashView, loadDeletedProjects]);

  const deletedProjectsByName = useMemo(
    () => [...deletedProjects].sort((left, right) => left.name.localeCompare(right.name, 'de')),
    [deletedProjects],
  );
  const visibleMemberships = isDevOnboardingPreview ? [] : memberships;
  const isOnboardingState = !isTrashView && visibleMemberships.length === 0;

  const stopDevOnboardingPreview = (): void => {
    clearDevOnboardingPreview();
    setIsDevOnboardingPreview(false);
  };

  const openProject = async (projectId: number): Promise<void> => {
    stopDevOnboardingPreview();
    await switchActiveProject(projectId);
    navigate('/app/fields-beds', { replace: true });
  };

  const showSnackbar = (message: string, severity: 'success' | 'error'): void => {
    showGlobalSnackbar({ message, severity });
  };

  const createDemoProject = async (): Promise<void> => {
    if (isCreatingDemoProject || blockInGuestDemo('createProject')) {
      return;
    }
    setIsCreatingDemoProject(true);
    setDemoError(null);
    try {
      await createDemoProjectAndSwitch(switchActiveProject);
      stopDevOnboardingPreview();
      showSnackbar(t('common:projectOnboarding.demoCreatedHint'), 'success');
      navigate('/app/fields-beds', { replace: true });
    } catch (error) {
      console.error('Error creating demo project:', error);
      setDemoError(t('common:projectOnboarding.demoCreateError'));
    } finally {
      if (isMountedRef.current) {
        setIsCreatingDemoProject(false);
      }
    }
  };

  const getDeletedAgeLabel = (deletedAt: string | null): string => {
    if (!deletedAt) {
      return t('projectTrash.deletedUnknown');
    }
    const deletedTime = new Date(deletedAt).getTime();
    if (!Number.isFinite(deletedTime)) {
      return t('projectTrash.deletedUnknown');
    }
    const days = Math.max(0, Math.floor((renderedAt - deletedTime) / 86_400_000));
    return t('projectTrash.deletedDays', { count: days });
  };

  const restoreProject = async (projectId: number): Promise<void> => {
    try {
      await projectAPI.restore(projectId);
      await refreshUser();
      await loadDeletedProjects();
      window.dispatchEvent(new CustomEvent('ofp:project-trash-changed'));
      showSnackbar(t('projectTrash.restoreSuccess'), 'success');
    } catch {
      showSnackbar(t('projectTrash.restoreError'), 'error');
    }
  };

  const quickDeleteProject = async (membership: { project_id: number; project_name: string }): Promise<void> => {
    if (!isDevQuickDeleteEnabled || quickDeletingProjectId !== null) {
      return;
    }
    if (!confirmAction(t('projectInvitations:projectDelete.devQuickDeleteFromListConfirm', { name: membership.project_name }))) {
      return;
    }
    setQuickDeletingProjectId(membership.project_id);
    try {
      const { project_id: projectId } = membership;
      await projectAPI.delete(projectId);
      await refreshUser();
      showProjectDeleteUndoSnackbar({
        projectId,
        deletedMessage: t('projectInvitations:projectDelete.success'),
        undoLabel: t('projectInvitations:projectDelete.undo'),
        restoreSuccessMessage: t('projectInvitations:projectDelete.restoreSuccess'),
        restoreErrorMessage: t('projectInvitations:projectDelete.restoreError'),
        refreshUser,
      });
    } catch {
      showSnackbar(t('projectInvitations:projectDelete.error'), 'error');
    } finally {
      if (isMountedRef.current) {
        setQuickDeletingProjectId(null);
      }
    }
  };

  const permanentlyDeleteProject = async (project: ProjectPayload): Promise<void> => {
    if (!confirmAction(t('projectTrash.permanentConfirm', { name: project.name }))) {
      return;
    }
    try {
      await projectAPI.permanentDelete(project.id);
      setDeletedProjects((current) => current.filter((item) => item.id !== project.id));
      window.dispatchEvent(new CustomEvent('ofp:project-trash-changed'));
      showSnackbar(t('projectTrash.permanentSuccess'), 'success');
    } catch {
      showSnackbar(t('projectTrash.permanentError'), 'error');
    }
  };

  return (
    <Box sx={{ p: 3, maxWidth: isOnboardingState ? 780 : 720 }}>
      <Stack spacing={2.5}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ justifyContent: "space-between",
          alignItems: { xs: 'stretch', sm: 'flex-start' }, }}  >
          <Box>
            <Typography variant="h5">
              {isTrashView
                ? t('projectTrash.title')
                : isOnboardingState ? t('common:projectOnboarding.pageTitle') : t('project.switch')}
            </Typography>
            {isOnboardingState ? (
              <Typography color="text.secondary" sx={{ mt: 0.75, maxWidth: 620, lineHeight: 1.6 }}>
                {t('common:projectOnboarding.pageDescription')}
              </Typography>
            ) : null}
          </Box>
        </Stack>

        {isTrashView ? (
          <Paper variant="outlined" sx={{ p: 2, bgcolor: 'background.paper', borderRadius: 1 }}>
            <Stack spacing={1.5}>
              {!trashError && deletedProjectsByName.length > 0 ? (
                <Alert
                  severity="success"
                  variant="outlined"
                  sx={{
                    alignItems: 'center',
                    bgcolor: 'transparent',
                    '& .MuiAlert-message': { width: '100%' },
                  }}
                >
                  {t('projectTrash.retentionNotice')}
                </Alert>
              ) : null}
              {trashError ? <Alert severity="error">{trashError}</Alert> : null}
              {!trashError && deletedProjectsByName.length === 0 ? (
                <Alert severity="info">{t('projectTrash.empty')}</Alert>
              ) : null}
              {!trashError && deletedProjectsByName.length > 0 ? (
                <List>
                  {deletedProjectsByName.map((project) => (
                    <ListItem
                      key={project.id}
                      secondaryAction={(
                        <Stack direction="row" spacing={1}>
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => {
                              void restoreProject(project.id);
                            }}
                          >
                            {t('projectTrash.restore')}
                          </Button>
                          <Button
                            size="small"
                            color="error"
                            onClick={() => {
                              void permanentlyDeleteProject(project);
                            }}
                          >
                            {t('projectTrash.permanentDelete')}
                          </Button>
                        </Stack>
                      )}
                    >
                      <ListItemText
                        primary={project.name}
                        secondary={getDeletedAgeLabel(project.deleted_at)}
                      />
                    </ListItem>
                  ))}
                </List>
              ) : null}
            </Stack>
          </Paper>
        ) : isOnboardingState ? (
          <Stack spacing={2}>
            {demoError ? <Alert severity="error">{demoError}</Alert> : null}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Paper
                variant="outlined"
                sx={{ flex: 1, p: 2, bgcolor: 'background.paper', borderRadius: 1 }}
              >
                <Stack spacing={1.5} sx={{ height: '100%' }}>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      {t('common:projectOnboarding.emptyTitle')}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, lineHeight: 1.55 }}>
                      {t('common:projectOnboarding.emptyDescription')}
                    </Typography>
                  </Box>
                  <Button
                    variant="outlined"
                    onClick={() => {
                      stopDevOnboardingPreview();
                      openProjectCreationFlow();
                    }}
                    disabled={isCreatingDemoProject}
                  >
                    {t('common:projectOnboarding.emptyAction')}
                  </Button>
                </Stack>
              </Paper>
              <Paper
                variant="outlined"
                sx={{ flex: 1, p: 2, bgcolor: 'background.paper', borderRadius: 1 }}
              >
                <Stack spacing={1.5} sx={{ height: '100%' }}>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      {t('common:projectOnboarding.demoTitle')}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, lineHeight: 1.55 }}>
                      {t('common:projectOnboarding.demoDescription')}
                    </Typography>
                  </Box>
                  <Button
                    variant="contained"
                    onClick={() => {
                      void createDemoProject();
                    }}
                    disabled={isCreatingDemoProject}
                    startIcon={isCreatingDemoProject ? <CircularProgress color="inherit" size={16} /> : undefined}
                  >
                    {isCreatingDemoProject
                      ? t('common:projectOnboarding.demoCreating')
                      : t('common:projectOnboarding.demoAction')}
                  </Button>
                </Stack>
              </Paper>
            </Stack>
          </Stack>
        ) : (
          <>
            <Box>
              <Button variant="outlined" onClick={() => openProjectCreationFlow()}>
                {t('project.create')}
              </Button>
            </Box>
            <List>
              {visibleMemberships.map((membership) => (
                <ListItem
                  key={membership.project_id}
                  secondaryAction={(
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center", }} >
                      <Button
                        variant="contained"
                        onClick={() => {
                          void openProject(membership.project_id);
                        }}
                      >
                        {t('projectSwitcher.openProjectAction')}
                      </Button>
                      {isDevQuickDeleteEnabled ? (
                        <AppTooltip title={t('projectInvitations:projectDelete.devQuickHint')}>
                          <span>
                            <Button
                              size="small"
                              color="error"
                              variant="text"
                              disabled={quickDeletingProjectId === membership.project_id}
                              onClick={() => {
                                void quickDeleteProject(membership);
                              }}
                              aria-label={t('projectInvitations:projectDelete.devQuickButton')}
                              sx={{ minWidth: 0, px: 0.5 }}
                            >
                              <DeleteOutlineIcon fontSize="small" />
                            </Button>
                          </span>
                        </AppTooltip>
                      ) : null}
                    </Stack>
                  )}
                >
                  <ListItemText
                    primary={membership.project_name}
                    secondary={t(`projectRoles.${membership.role}`)}
                  />
                </ListItem>
              ))}
            </List>
          </>
        )}

      </Stack>
    </Box>
  );
}
