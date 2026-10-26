import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useOutletContext } from 'react-router';
import { projectAPI, type ProjectInvitationPayload, type ProjectMemberPayload, type ProjectRegion } from '../api/api';
import { useAuth } from '../auth/useAuth';
import { useGuestDemoGuard } from '../auth/useGuestDemoGuard';
import { ConfirmationDialog } from '../components/feedback/ConfirmationDialog';
import { DisabledActionTooltip } from '../components/DisabledActionTooltip';
import { SettingsLayout, type SettingsLayoutSection } from '../components/settings/SettingsLayout';
import { SettingsSection } from '../components/settings/SettingsSection';
import { settingsActionButtonSx, settingsFlatAlertSx } from '../components/settings/settingsStyles';
import { TypeaheadSelect as Select } from '../components/inputs/TypeaheadSelect';
import { useTranslation } from '../i18n';
import { showProjectDeleteUndoSnackbar } from '../projects/projectDeletionFeedback';
import { wideFieldSx, wideSingleColumnFieldSx } from '../components/forms/formLayout';
import { SeasonPatternCard } from '../seasons/SeasonPatternCard';
import type { RootLayoutOutletContext } from '../navigation/topbarTypes';
import { showGlobalSnackbar } from '../utils/globalSnackbar';
import { ProjectSettingsMembersSection } from './projectSettingsMembersSection';
import { ProjectSettingsSchedulingSection } from './projectSettingsSchedulingSection';
import type { MembersFeedback, ProjectRole } from './projectSettingsMembers';

const showSuccess = (message: string): void => showGlobalSnackbar({ message, severity: 'success' });

export default function ProjectSettingsPage() {
  const { t } = useTranslation('projectInvitations');
  const navigate = useNavigate();
  const outletContext = useOutletContext<RootLayoutOutletContext | null>();
  const { user, refreshUser, activeProjectId } = useAuth();
  const { blockInGuestDemo } = useGuestDemoGuard();
  const resolvedActiveProjectId = activeProjectId ?? Number(window.localStorage.getItem('activeProjectId'));
  const activeMembership = useMemo(
    () => (user?.memberships ?? []).find((membership) => membership.project_id === resolvedActiveProjectId),
    [resolvedActiveProjectId, user?.memberships],
  );

  const [membersFeedback, setMembersFeedback] = useState<MembersFeedback | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [invitations, setInvitations] = useState<ProjectInvitationPayload[]>([]);
  const [members, setMembers] = useState<ProjectMemberPayload[]>([]);
  const [pendingRemovalMember, setPendingRemovalMember] = useState<ProjectMemberPayload | null>(null);
  const [memberLoadError, setMemberLoadError] = useState<string | null>(null);
  const [invitationLoadError, setInvitationLoadError] = useState<string | null>(null);
  const [projectNameDraft, setProjectNameDraft] = useState('');
  const [projectNameError, setProjectNameError] = useState<string | null>(null);
  const [projectRegionDraft, setProjectRegionDraft] = useState<ProjectRegion>('germany');
  const [isSavingGeneral, setIsSavingGeneral] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
  const [isDeletingProject, setIsDeletingProject] = useState(false);

  const isProjectAdmin = activeMembership?.role === 'admin';
  const canManageMembers = isProjectAdmin;
  const normalizedProjectName = projectNameDraft.trim();
  const activeProjectRegion = activeMembership?.project_region ?? 'germany';
  const hasProjectNameChanges = normalizedProjectName !== (activeMembership?.project_name ?? '');
  const hasRegionChanges = projectRegionDraft !== activeProjectRegion;
  const hasGeneralChanges = hasProjectNameChanges || hasRegionChanges;
  const canDeleteProject = deleteConfirmationText === (activeMembership?.project_name ?? '');
  const canQuickDeleteProjectInDev = import.meta.env.DEV && isProjectAdmin;

  const extractErrorPayload = (error: unknown): { code: string | null; detail: string | null; message: string | null } => {
    const payload = (error as { response?: { data?: { code?: string; detail?: string; message?: string } } })?.response?.data;
    const detail = payload?.detail ?? null;
    const message = payload?.message ?? null;
    const sanitizedDetail = typeof detail === 'string' && /^<!doctype html|^<html|<body[\s>]/i.test(detail.trim()) ? null : detail;
    const sanitizedMessage = typeof message === 'string' && /^<!doctype html|^<html|<body[\s>]/i.test(message.trim()) ? null : message;
    return {
      code: payload?.code ?? null,
      detail: sanitizedDetail,
      message: sanitizedMessage,
    };
  };

  const loadInvitations = useCallback(async (): Promise<void> => {
    if (!activeMembership || !canManageMembers) {
      setInvitations([]);
      setInvitationLoadError(null);
      return;
    }
    try {
      const response = await projectAPI.listInvitations(activeMembership.project_id);
      setInvitations(response.data);
      setInvitationLoadError(null);
    } catch {
      setInvitations([]);
      setInvitationLoadError(t('listLoadFailed'));
    }
  }, [activeMembership, canManageMembers, t]);

  const loadMembers = useCallback(async (): Promise<void> => {
    if (!activeMembership) {
      return;
    }
    try {
      const response = await projectAPI.listMembers(activeMembership.project_id);
      setMembers(response.data);
      setMemberLoadError(null);
    } catch {
      setMembers([]);
      setMemberLoadError(t('memberListLoadFailed'));
    }
  }, [activeMembership, t]);

  useEffect(() => {
    window.setTimeout(() => {
      void loadMembers();
    }, 0);
  }, [loadMembers]);

  useEffect(() => {
    window.setTimeout(() => {
      void loadInvitations();
    }, 0);
  }, [loadInvitations]);

  useEffect(() => {
    setProjectNameDraft(activeMembership?.project_name ?? '');
    setProjectRegionDraft(activeProjectRegion);
    setProjectNameError(null);
  }, [activeMembership?.project_name, activeProjectRegion]);

  if (!activeMembership) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">{t('noActiveProject')}</Alert>
      </Box>
    );
  }

  const handleInvite = async (email: string, role: ProjectRole): Promise<boolean> => {
    setMembersFeedback(null);
    try {
      const response = await projectAPI.invite(activeMembership.project_id, { email, role });
      const data = response.data as { code?: string; mail_sent?: boolean; invite_link?: string };
      if (!data.mail_sent && data.invite_link) {
        // The link has to stay on screen so the admin can pass it on by hand.
        setMembersFeedback({ severity: 'warning', text: `${t('inviteSentNoMail')} ${data.invite_link}` });
      } else {
        showSuccess(data.code === 'invitation_resent' ? t('inviteResent') : t('inviteSent'));
      }
      await loadInvitations();
      return true;
    } catch (inviteError: unknown) {
      const payload = extractErrorPayload(inviteError);
      const message = payload.code
        ? t(`error.${payload.code}`, { defaultValue: payload.message ?? payload.detail ?? t('inviteFailed') })
        : (payload.message ?? payload.detail ?? t('inviteFailed'));
      setMembersFeedback({ severity: 'error', text: message });
      return false;
    }
  };

  const validateProjectName = (): string | null => {
    if (normalizedProjectName.length === 0) {
      return t('projectRename.empty');
    }
    if (normalizedProjectName.length < 2) {
      return t('projectRename.minLength');
    }
    return null;
  };

  const handleGeneralCancel = (): void => {
    setProjectNameDraft(activeMembership.project_name);
    setProjectRegionDraft(activeProjectRegion);
    setProjectNameError(null);
    setGeneralError(null);
  };

  const handleGeneralSave = async (event?: FormEvent<HTMLFormElement>): Promise<void> => {
    event?.preventDefault();
    if (!isProjectAdmin || isSavingGeneral || !hasGeneralChanges) {
      return;
    }
    const nameError = hasProjectNameChanges ? validateProjectName() : null;
    if (nameError) {
      setProjectNameError(nameError);
      return;
    }

    setIsSavingGeneral(true);
    setGeneralError(null);
    try {
      await projectAPI.update(activeMembership.project_id, {
        ...(hasProjectNameChanges ? { name: normalizedProjectName } : {}),
        ...(hasRegionChanges ? { region: projectRegionDraft } : {}),
      });
      await refreshUser();
      setProjectNameDraft(normalizedProjectName);
      showSuccess(t('general.saved'));
    } catch {
      setGeneralError(t('general.saveError'));
    } finally {
      setIsSavingGeneral(false);
    }
  };

  const handleDeleteDialogClose = (): void => {
    if (isDeletingProject) {
      return;
    }
    setDeleteDialogOpen(false);
    setDeleteConfirmationText('');
  };

  const handleProjectDelete = async (options: { skipNameConfirmation?: boolean } = {}): Promise<void> => {
    const skipNameConfirmation = options.skipNameConfirmation === true;
    if (!activeMembership || !isProjectAdmin || (!skipNameConfirmation && !canDeleteProject)) {
      return;
    }

    const deletedProjectId = activeMembership.project_id;
    setIsDeletingProject(true);
    setDeleteError(null);
    try {
      await projectAPI.delete(deletedProjectId);
      setDeleteDialogOpen(false);
      setDeleteConfirmationText('');
      await refreshUser();
      showProjectDeleteUndoSnackbar({
        projectId: deletedProjectId,
        deletedMessage: t('projectDelete.success'),
        undoLabel: t('projectDelete.undo'),
        restoreSuccessMessage: t('projectDelete.restoreSuccess'),
        restoreErrorMessage: t('projectDelete.restoreError'),
        refreshUser,
      });
      navigate('/app/project-selection', { replace: true });
    } catch {
      setDeleteError(t('projectDelete.error'));
    } finally {
      setIsDeletingProject(false);
    }
  };

  const handleRevoke = async (invitationId: number): Promise<void> => {
    setMembersFeedback(null);
    try {
      await projectAPI.revokeInvitation(activeMembership.project_id, invitationId);
      await loadInvitations();
      showSuccess(t('revokeSuccess'));
    } catch {
      setMembersFeedback({ severity: 'error', text: t('revokeFailed') });
    }
  };

  const memberErrorMessage = (memberError: unknown, fallbackKey: string): string => {
    const payload = extractErrorPayload(memberError);
    return payload.code
      ? t(`error.${payload.code}`, { defaultValue: payload.message ?? payload.detail ?? t(fallbackKey) })
      : (payload.message ?? payload.detail ?? t(fallbackKey));
  };

  const handleMemberRoleChange = async (member: ProjectMemberPayload, nextRole: ProjectRole): Promise<void> => {
    setMembersFeedback(null);
    try {
      await projectAPI.updateMember(activeMembership.project_id, member.id, nextRole);
      showSuccess(t('memberRoleUpdated'));
      await loadMembers();
    } catch (memberError: unknown) {
      setMembersFeedback({ severity: 'error', text: memberErrorMessage(memberError, 'memberRoleUpdateFailed') });
    }
  };

  const handleRemoveMember = async (membershipId: number): Promise<void> => {
    setMembersFeedback(null);
    try {
      await projectAPI.removeMember(activeMembership.project_id, membershipId);
      showSuccess(t('memberRemoved'));
      setPendingRemovalMember(null);
      await loadMembers();
    } catch (memberError: unknown) {
      setPendingRemovalMember(null);
      setMembersFeedback({ severity: 'error', text: memberErrorMessage(memberError, 'memberRemoveFailed') });
    }
  };

  const sections: SettingsLayoutSection[] = [
    { id: 'general', label: t('general.title') },
    { id: 'season-pattern', label: t('navigation:seasonPattern.title') },
    { id: 'scheduling', label: t('scheduling.title') },
    { id: 'members', label: t('membersSectionTitle') },
    ...(isProjectAdmin ? [{ id: 'delete-project', label: t('projectDelete.title'), tone: 'danger' as const }] : []),
  ];

  const generalDisabledReason = isSavingGeneral
    ? t('common:disabledReasons.busy')
    : !hasGeneralChanges
      ? t('common:disabledReasons.noChanges')
      : '';

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, width: '100%', maxWidth: 820, mx: 'auto', boxSizing: 'border-box' }}>
      <SettingsLayout sections={sections} navPlacement="top">
        <SettingsSection
          id="general"
          title={t('general.title')}
          actions={isProjectAdmin ? (
            <>
              <DisabledActionTooltip title={generalDisabledReason}>
                <Button
                  onClick={handleGeneralCancel}
                  disabled={isSavingGeneral || !hasGeneralChanges}
                  sx={settingsActionButtonSx}
                >
                  {t('general.cancel')}
                </Button>
              </DisabledActionTooltip>
              <DisabledActionTooltip title={generalDisabledReason}>
                <Button
                  type="submit"
                  form="project-general-form"
                  variant="contained"
                  disabled={isSavingGeneral || !hasGeneralChanges}
                  sx={settingsActionButtonSx}
                >
                  {t('general.save')}
                </Button>
              </DisabledActionTooltip>
            </>
          ) : undefined}
        >
          <Stack
            component="form"
            id="project-general-form"
            noValidate
            spacing={2.5}
            onSubmit={(event) => void handleGeneralSave(event)}
          >
            <TextField
              label={t('currentProjectLabel')}
              value={projectNameDraft}
              onChange={(event) => {
                setProjectNameDraft(event.target.value);
                setProjectNameError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setProjectNameDraft(activeMembership.project_name);
                  setProjectNameError(null);
                }
              }}
              disabled={!isProjectAdmin || isSavingGeneral}
              error={projectNameError !== null}
              helperText={projectNameError ?? undefined}
              sx={wideSingleColumnFieldSx}
              slotProps={{ htmlInput: { maxLength: 255 } }}
            />
            <Box>
              <FormControl disabled={!isProjectAdmin || isSavingGeneral} sx={wideSingleColumnFieldSx}>
                <InputLabel id="project-region-label">{t('projectRegion.label')}</InputLabel>
                <Select
                  fullWidth
                  labelId="project-region-label"
                  label={t('projectRegion.label')}
                  value={projectRegionDraft}
                  onChange={(event) => setProjectRegionDraft(event.target.value as ProjectRegion)}
                >
                  <MenuItem value="germany">{t('projectRegion.options.germany')}</MenuItem>
                  <MenuItem value="austria">{t('projectRegion.options.austria')}</MenuItem>
                  <MenuItem value="switzerland">{t('projectRegion.options.switzerland')}</MenuItem>
                </Select>
              </FormControl>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {t('projectRegion.help')}
              </Typography>
            </Box>
            {generalError ? <Alert severity="error" sx={settingsFlatAlertSx}>{generalError}</Alert> : null}
          </Stack>
        </SettingsSection>

        <SeasonPatternCard id="season-pattern" onSaved={() => outletContext?.reloadActiveSeason()} />

        <ProjectSettingsSchedulingSection
          id="scheduling"
          projectId={activeMembership.project_id}
          canEdit={isProjectAdmin}
        />

        <ProjectSettingsMembersSection
          currentUserId={user?.id}
          canManageMembers={canManageMembers}
          members={members}
          memberLoadError={memberLoadError}
          invitations={invitations}
          invitationLoadError={invitationLoadError}
          feedback={membersFeedback}
          onInvite={handleInvite}
          // The guest demo's backend rejects invitations; its project is single-person and temporary.
          canStartInvite={() => !blockInGuestDemo()}
          onChangeRole={(member, nextRole) => void handleMemberRoleChange(member, nextRole)}
          onRequestRemove={setPendingRemovalMember}
          onRevokeInvitation={(invitationId) => void handleRevoke(invitationId)}
        />

        {isProjectAdmin ? (
          <SettingsSection
            id="delete-project"
            tone="danger"
            title={t('projectDelete.title')}
            description={t('projectDelete.restoreHint')}
          >
            {deleteError ? <Alert severity="error" sx={{ ...settingsFlatAlertSx, mb: 2 }}>{deleteError}</Alert> : null}
            <Button
              color="error"
              variant="outlined"
              onClick={() => setDeleteDialogOpen(true)}
              sx={settingsActionButtonSx}
            >
              {t('projectDelete.openButton')}
            </Button>
            {canQuickDeleteProjectInDev ? (
              <Box sx={{ mt: 2 }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {t('projectDelete.devQuickDescription')}
                </Typography>
                <Button
                  color="error"
                  variant="outlined"
                  startIcon={<DeleteOutlineIcon />}
                  onClick={() => void handleProjectDelete({ skipNameConfirmation: true })}
                  disabled={isDeletingProject}
                  sx={settingsActionButtonSx}
                >
                  {t('projectDelete.devQuickButton')}
                </Button>
              </Box>
            ) : null}
          </SettingsSection>
        ) : null}
      </SettingsLayout>

      <ConfirmationDialog
        open={pendingRemovalMember !== null}
        fullWidth
        title={t('removeDialogTitle')}
        message={t('removeDialogText', {
          email: pendingRemovalMember?.user_email ?? '',
          name: pendingRemovalMember?.user_display_name || t('memberDisplayFallback'),
        })}
        cancelLabel={t('removeDialogCancel')}
        confirmLabel={t('removeDialogConfirm')}
        onCancel={() => setPendingRemovalMember(null)}
        onConfirm={() => {
          if (pendingRemovalMember) {
            void handleRemoveMember(pendingRemovalMember.id);
          }
        }}
        messageTypographyProps={{ variant: 'body1' }}
        confirmButtonProps={{ color: 'error', variant: 'contained' }}
      />

      <Dialog open={deleteDialogOpen} onClose={handleDeleteDialogClose} fullWidth maxWidth="sm">
        <DialogTitle>{t('projectDelete.dialogTitle')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography>
              {t('projectDelete.dialogText')}
            </Typography>
            <Typography sx={{ fontWeight: 600 }}>
              {t('projectLabel', { name: activeMembership.project_name })}
            </Typography>
            <TextField
              label={t('projectDelete.confirmationLabel')}
              value={deleteConfirmationText}
              onChange={(event) => setDeleteConfirmationText(event.target.value)}
              disabled={isDeletingProject}
              sx={wideFieldSx}
              autoFocus
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteDialogClose} disabled={isDeletingProject}>
            {t('projectDelete.cancel')}
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => void handleProjectDelete()}
            disabled={!canDeleteProject || isDeletingProject}
          >
            {t('projectDelete.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
