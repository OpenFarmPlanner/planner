import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import { Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, FormHelperText, InputLabel, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useOutletContext } from 'react-router';
import { projectAPI, type ProjectInvitationPayload, type ProjectMemberPayload, type ProjectRegion } from '../api/api';
import { useAuth } from '../auth/useAuth';
import { ConfirmationDialog } from '../components/feedback/ConfirmationDialog';
import { DisabledActionTooltip } from '../components/DisabledActionTooltip';
import { TypeaheadSelect as Select } from '../components/inputs/TypeaheadSelect';
import { useTranslation } from '../i18n';
import { showProjectDeleteUndoSnackbar } from '../projects/projectDeletionFeedback';
import { compactFieldSx, wideFieldSx } from '../components/forms/formLayout';
import { SeasonPatternCard } from '../seasons/SeasonPatternCard';
import type { RootLayoutOutletContext } from '../navigation/topbarTypes';

interface InviteFeedback {
  severity: 'success' | 'warning' | 'error';
  text: string;
}

export default function ProjectSettingsPage() {
  const { t } = useTranslation('projectInvitations');
  const navigate = useNavigate();
  const { hash } = useLocation();
  const outletContext = useOutletContext<RootLayoutOutletContext | null>();
  const { user, refreshUser, activeProjectId } = useAuth();
  const resolvedActiveProjectId = activeProjectId ?? Number(window.localStorage.getItem('activeProjectId'));
  const activeMembership = useMemo(
    () => (user?.memberships ?? []).find((membership) => membership.project_id === resolvedActiveProjectId),
    [resolvedActiveProjectId, user?.memberships],
  );

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [feedback, setFeedback] = useState<InviteFeedback | null>(null);
  const [invitations, setInvitations] = useState<ProjectInvitationPayload[]>([]);
  const [members, setMembers] = useState<ProjectMemberPayload[]>([]);
  const [pendingRemovalMember, setPendingRemovalMember] = useState<ProjectMemberPayload | null>(null);
  const [memberLoadError, setMemberLoadError] = useState<string | null>(null);
  const [invitationLoadError, setInvitationLoadError] = useState<string | null>(null);
  const [projectNameDraft, setProjectNameDraft] = useState('');
  const [projectNameError, setProjectNameError] = useState<string | null>(null);
  const [isSavingProjectName, setIsSavingProjectName] = useState(false);
  const [isSavingRegion, setIsSavingRegion] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
  const [isDeletingProject, setIsDeletingProject] = useState(false);

  const isProjectAdmin = activeMembership?.role === 'admin';
  const canManageMembers = isProjectAdmin;
  const normalizedProjectName = projectNameDraft.trim();
  const hasProjectNameChanges = normalizedProjectName !== (activeMembership?.project_name ?? '');
  const activeProjectRegion = activeMembership?.project_region ?? 'germany';
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
      setInvitationLoadError(t('projectMembers.invitations.loadError'));
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
    setProjectNameError(null);
  }, [activeMembership?.project_name]);

  // Support deep links to a specific section (e.g. the season-pattern hint in
  // the "create season" dialog navigates here with #season-pattern).
  useEffect(() => {
    if (!hash) {
      return;
    }
    const target = document.getElementById(hash.slice(1));
    if (typeof target?.scrollIntoView === 'function') {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [hash]);

  const sortedInvitations = useMemo(() => (
    [...invitations].sort((left, right) => {
      const expiryDelta = new Date(right.expires_at).getTime() - new Date(left.expires_at).getTime();
      if (expiryDelta !== 0) {
        return expiryDelta;
      }
      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
    })
  ), [invitations]);

  if (!activeMembership) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">{t('noActiveProject')}</Alert>
      </Box>
    );
  }

  const handleInvite = async (): Promise<void> => {
    if (!canManageMembers) {
      setFeedback({ severity: 'error', text: t('projectMembers.invite.noPermission') });
      return;
    }

    setFeedback(null);
    try {
      const response = await projectAPI.invite(activeMembership.project_id, { email, role });
      const data = response.data as { code?: string; mail_sent?: boolean; invite_link?: string };
      if (data.code === 'invitation_resent') {
        setFeedback({ severity: 'success', text: t('inviteResent') });
      } else {
        setFeedback({ severity: 'success', text: t('inviteSent') });
      }
      if (!data.mail_sent && data.invite_link) {
        setFeedback({ severity: 'warning', text: `${t('inviteSentNoMail')} ${data.invite_link}` });
      }
      setEmail('');
      setRole('member');
      await loadInvitations();
    } catch (inviteError: unknown) {
      const payload = extractErrorPayload(inviteError);
      const message = payload.code
        ? t(`error.${payload.code}`, { defaultValue: payload.message ?? payload.detail ?? t('inviteFailed') })
        : (payload.message ?? payload.detail ?? t('inviteFailed'));
      setFeedback({ severity: 'error', text: message });
    }
  };

  const handleProjectNameCommit = async (): Promise<void> => {
    if (!activeMembership || !isProjectAdmin || isSavingProjectName) {
      return;
    }

    const previousProjectName = activeMembership.project_name;
    if (normalizedProjectName === previousProjectName) {
      setProjectNameDraft(previousProjectName);
      setProjectNameError(null);
      return;
    }

    if (normalizedProjectName.length === 0) {
      setProjectNameDraft(previousProjectName);
      setProjectNameError(t('projectRename.empty'));
      setFeedback({ severity: 'error', text: t('projectRename.empty') });
      return;
    }

    if (normalizedProjectName.length < 2) {
      setProjectNameDraft(previousProjectName);
      setProjectNameError(t('projectRename.minLength'));
      setFeedback({ severity: 'error', text: t('projectRename.minLength') });
      return;
    }

    setIsSavingProjectName(true);
    setProjectNameError(null);
    setFeedback(null);
    try {
      await projectAPI.update(activeMembership.project_id, { name: normalizedProjectName });
      await refreshUser();
      setProjectNameDraft(normalizedProjectName);
      setFeedback({ severity: 'success', text: t('projectRename.success') });
    } catch {
      setProjectNameDraft(previousProjectName);
      setFeedback({ severity: 'error', text: t('projectRename.error') });
    } finally {
      setIsSavingProjectName(false);
    }
  };

  const handleProjectRegionChange = async (nextRegion: ProjectRegion): Promise<void> => {
    if (!activeMembership || !isProjectAdmin || isSavingRegion || nextRegion === activeProjectRegion) {
      return;
    }

    setIsSavingRegion(true);
    setFeedback(null);
    try {
      await projectAPI.update(activeMembership.project_id, { region: nextRegion });
      await refreshUser();
      setFeedback({ severity: 'success', text: t('projectRegion.success') });
    } catch {
      setFeedback({ severity: 'error', text: t('projectRegion.error') });
    } finally {
      setIsSavingRegion(false);
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
    setFeedback(null);
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
      setFeedback({ severity: 'error', text: t('projectDelete.error') });
    } finally {
      setIsDeletingProject(false);
    }
  };

  const handleRevoke = async (invitationId: number): Promise<void> => {
    setFeedback(null);
    try {
      await projectAPI.revokeInvitation(activeMembership.project_id, invitationId);
      await loadInvitations();
      setFeedback({ severity: 'success', text: t('revokeSuccess') });
    } catch {
      setFeedback({ severity: 'error', text: t('revokeFailed') });
    }
  };

  const handleMemberRoleChange = async (membershipId: number, nextRole: 'admin' | 'member', isCurrentUser: boolean): Promise<void> => {
    if (isCurrentUser) {
      setFeedback({ severity: 'error', text: t('roleChangeBlocked') });
      return;
    }
    try {
      await projectAPI.updateMember(activeMembership.project_id, membershipId, nextRole);
      setFeedback({ severity: 'success', text: t('memberRoleUpdated') });
      await loadMembers();
    } catch (memberError: unknown) {
      const payload = extractErrorPayload(memberError);
      const message = payload.code
        ? t(`error.${payload.code}`, { defaultValue: payload.message ?? payload.detail ?? t('memberRoleUpdateFailed') })
        : (payload.message ?? payload.detail ?? t('memberRoleUpdateFailed'));
      setFeedback({ severity: 'error', text: message });
    }
  };

  const handleRemoveMember = async (membershipId: number, isCurrentUser: boolean): Promise<void> => {
    if (isCurrentUser) {
      setFeedback({ severity: 'error', text: t('removeBlocked') });
      return;
    }
    try {
      await projectAPI.removeMember(activeMembership.project_id, membershipId);
      setFeedback({ severity: 'success', text: t('memberRemoved') });
      setPendingRemovalMember(null);
      await loadMembers();
    } catch (memberError: unknown) {
      const payload = extractErrorPayload(memberError);
      const message = payload.code
        ? t(`error.${payload.code}`, { defaultValue: payload.message ?? payload.detail ?? t('memberRemoveFailed') })
        : (payload.message ?? payload.detail ?? t('memberRemoveFailed'));
      setFeedback({ severity: 'error', text: message });
    }
  };

  const invitationStatus = (() => {
    if (!canManageMembers) {
      return <Alert severity="info">{t('projectMembers.invitations.noAccess')}</Alert>;
    }
    if (invitationLoadError) {
      return <Alert severity="error">{invitationLoadError}</Alert>;
    }
    if (invitations.length === 0) {
      return <Alert severity="info">{t('projectMembers.invitations.empty')}</Alert>;
    }
    return null;
  })();

  const sectionCardContentSx = { p: { xs: 2, sm: 2.5 }, '&:last-child': { pb: { xs: 2, sm: 2.5 } } };

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 760, mx: 'auto' }}>
      {feedback ? <Alert severity={feedback.severity} sx={{ mb: 2.5, wordBreak: 'break-all' }}>{feedback.text}</Alert> : null}

      <Stack spacing={2.5}>
        <Card variant="outlined" aria-labelledby="project-context-title">
          <CardContent sx={sectionCardContentSx}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              sx={{ alignItems: { xs: 'stretch', sm: 'flex-start' }, width: 'fit-content', maxWidth: '100%' }}
            >
              <TextField
                id="project-context-title"
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
                    return;
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void handleProjectNameCommit();
                  }
                }}
                disabled={!isProjectAdmin || isSavingProjectName}
                error={projectNameError !== null}
                helperText={projectNameError ?? ' '}
                sx={{
                  width: { xs: '100%', sm: 300 },
                  maxWidth: '100%',
                  flex: '0 0 auto',
                  '& input': {
                    cursor: isProjectAdmin ? 'text' : 'default',
                    fontSize: (theme) => theme.typography.h6.fontSize,
                    fontWeight: 600,
                  },
                }}
                slotProps={{ htmlInput: { 'aria-label': t('currentProjectLabel') } }}
              />
              <DisabledActionTooltip
                title={!isProjectAdmin
                  ? t('memberManagementNoAccess')
                  : isSavingProjectName
                    ? t('common:disabledReasons.busy')
                    : !hasProjectNameChanges
                      ? t('common:disabledReasons.noChanges')
                      : ''}
              >
                <Button
                  variant="contained"
                  onClick={() => void handleProjectNameCommit()}
                  disabled={!isProjectAdmin || isSavingProjectName || !hasProjectNameChanges}
                  sx={{ alignSelf: { xs: 'stretch', sm: 'flex-start' }, minHeight: 56, minWidth: 140 }}
                >
                  {t('projectRename.save')}
                </Button>
              </DisabledActionTooltip>
            </Stack>
            <Divider sx={{ my: 2 }} />
            <FormControl
              disabled={!isProjectAdmin || isSavingRegion}
              sx={wideFieldSx}
            >
              <InputLabel id="project-region-label">{t('projectRegion.label')}</InputLabel>
              <Select
                fullWidth
                labelId="project-region-label"
                label={t('projectRegion.label')}
                value={activeProjectRegion}
                onChange={(event) => void handleProjectRegionChange(event.target.value as ProjectRegion)}
              >
                <MenuItem value="germany">{t('projectRegion.options.germany')}</MenuItem>
                <MenuItem value="austria">{t('projectRegion.options.austria')}</MenuItem>
                <MenuItem value="switzerland">{t('projectRegion.options.switzerland')}</MenuItem>
              </Select>
            </FormControl>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t('projectRegion.help')}
            </Typography>
          </CardContent>
        </Card>

        <SeasonPatternCard id="season-pattern" onSaved={() => outletContext?.reloadActiveSeason()} />

        <Card variant="outlined" aria-labelledby="project-invite-section-title">
          <CardContent sx={sectionCardContentSx}>
            <Typography id="project-invite-section-title" variant="h6" sx={{ mb: 2 }}>{t('inviteSectionTitle')}</Typography>
            {!canManageMembers ? (
              <Alert severity="info" sx={{ mb: 2 }}>{t('memberManagementNoAccess')}</Alert>
            ) : null}
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              sx={{ alignItems: { xs: 'stretch', sm: 'flex-start' }, width: 'fit-content', maxWidth: '100%' }}
            >
              <TextField
                label={t('emailLabel')}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={!canManageMembers}
                sx={{ width: { xs: '100%', sm: 300 }, maxWidth: '100%', flex: '0 0 auto' }}
              />
              <FormControl disabled={!canManageMembers} sx={compactFieldSx}>
                <InputLabel id="project-invite-role-label">{t('roleLabel')}</InputLabel>
                <Select
                  fullWidth
                  labelId="project-invite-role-label"
                  label={t('roleLabel')}
                  value={role}
                  onChange={(event) => setRole(event.target.value as 'admin' | 'member')}
                >
                  <MenuItem value="member">{t('roleMember')}</MenuItem>
                  <MenuItem value="admin">{t('roleAdmin')}</MenuItem>
                </Select>
              </FormControl>
              <DisabledActionTooltip
                title={!canManageMembers
                  ? t('projectMembers.invite.noPermission')
                  : !email.trim()
                    ? t('common:disabledReasons.requiredFields')
                    : ''}
              >
                <Button
                  variant="contained"
                  onClick={() => void handleInvite()}
                  disabled={!canManageMembers || !email.trim()}
                  sx={{ alignSelf: { xs: 'stretch', sm: 'center' } }}
                >
                  {t('sendInvite')}
                </Button>
              </DisabledActionTooltip>
            </Stack>

            {!canManageMembers ? (
              <Alert severity="info" sx={{ mt: 2 }}>{t('projectMembers.invite.noPermission')}</Alert>
            ) : null}
          </CardContent>
        </Card>

        <Card variant="outlined" aria-labelledby="project-members-section-title">
          <CardContent sx={sectionCardContentSx}>
            <Typography id="project-members-section-title" variant="h6" sx={{ mb: 2 }}>{t('membersSectionTitle')}</Typography>
            <Stack spacing={0} divider={<Divider flexItem />}>
              {memberLoadError ? <Alert severity="error">{memberLoadError}</Alert> : null}
              {!memberLoadError ? members.map((member) => {
                const isCurrentUser = member.user === user?.id;
                const displayName = member.user_display_name.trim() || member.user_email || t('memberDisplayFallback');
                const showEmailSecondary = member.user_email && member.user_email !== displayName;

                return (
                  <Box key={member.id} sx={{ py: 1.5 }}>
                    <Stack direction={{ xs: 'column', md: 'row' }} sx={{ justifyContent: "space-between",
                      alignItems: { xs: 'flex-start', md: 'center' }, }}   spacing={2}>
                      <Box>
                        <Stack direction="row" spacing={1} sx={{ mb: 0.5,
                          alignItems: "center", }}  >
                          <Typography sx={{ fontWeight: 600 }}>{displayName}</Typography>
                          {isCurrentUser ? <Chip label={t('memberYou')} size="small" /> : null}
                        </Stack>
                        {showEmailSecondary ? (
                          <Typography variant="body2" color="text.secondary">{member.user_email}</Typography>
                        ) : null}
                      </Box>
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { xs: 'stretch', sm: 'center' }, width: { xs: '100%', md: 'auto' }, }} >
                        <FormControl
                          size="small"
                          disabled={!canManageMembers || isCurrentUser}
                          sx={compactFieldSx}
                        >
                          <InputLabel id={`project-member-role-label-${member.id}`}>{t('memberRoleLabel')}</InputLabel>
                          <Select
                            fullWidth
                            labelId={`project-member-role-label-${member.id}`}
                            size="small"
                            label={t('memberRoleLabel')}
                            value={member.role}
                            onChange={(event) => void handleMemberRoleChange(member.id, event.target.value as 'admin' | 'member', isCurrentUser)}
                          >
                            <MenuItem value="member">{t('roleMember')}</MenuItem>
                            <MenuItem value="admin">{t('roleAdmin')}</MenuItem>
                          </Select>
                          {isCurrentUser ? <FormHelperText>{t('roleChangeBlocked')}</FormHelperText> : null}
                        </FormControl>
                        <DisabledActionTooltip
                          title={!canManageMembers
                            ? t('memberManagementNoAccess')
                            : isCurrentUser
                              ? t('removeBlocked')
                              : ''}
                        >
                          <Button
                            size="small"
                            variant="outlined"
                            color="error"
                            onClick={() => setPendingRemovalMember(member)}
                            disabled={!canManageMembers || isCurrentUser}
                          >
                            {t('removeMember')}
                          </Button>
                        </DisabledActionTooltip>
                      </Stack>
                    </Stack>
                  </Box>
                );
              }) : null}
              {!memberLoadError && members.length === 0 ? <Alert severity="info">{t('membersEmpty')}</Alert> : null}
            </Stack>
          </CardContent>
        </Card>

        <Card variant="outlined" aria-labelledby="project-invitations-section-title">
          <CardContent sx={sectionCardContentSx}>
            <Typography id="project-invitations-section-title" variant="h6" sx={{ mb: 2 }}>{t('listTitle')}</Typography>
            <Stack spacing={0} divider={<Divider flexItem />}>
              {canManageMembers && !invitationLoadError ? sortedInvitations.map((invitation) => (
                <Box key={invitation.id} sx={{ py: 1.5 }}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: "space-between",
                    alignItems: { xs: 'flex-start', sm: 'center' }, }}   spacing={2}>
                    <Box>
                      <Typography sx={{ fontWeight: 600 }}>{invitation.email}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {t('expiresAt', { date: new Date(invitation.expires_at).toLocaleString('de-DE') })}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center", }} >
                      <Chip label={t(`status.${invitation.resolved_status}`)} size="small" />
                      {invitation.resolved_status === 'pending' ? (
                        <Button size="small" variant="outlined" color="error" onClick={() => void handleRevoke(invitation.id)}>
                          {t('revoke')}
                        </Button>
                      ) : null}
                    </Stack>
                  </Stack>
                </Box>
              )) : null}
              {invitationStatus}
            </Stack>
          </CardContent>
        </Card>

        {isProjectAdmin ? (
          <Card variant="outlined" aria-labelledby="project-management-section-title" sx={{ borderColor: 'error.light' }}>
            <CardContent sx={sectionCardContentSx}>
              <Typography id="project-management-section-title" variant="h6" sx={{ mb: 1 }} color="error.main">{t('projectDelete.managementTitle')}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t('projectDelete.managementDescription')}
              </Typography>
              <Box sx={{ mt: 2, mb: 2 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {t('projectDelete.shortInfoTitle')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('projectDelete.shortInfoText')}
                </Typography>
              </Box>
              <Button
                color="error"
                variant="contained"
                startIcon={<DeleteOutlineIcon />}
                onClick={() => setDeleteDialogOpen(true)}
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
                  >
                    {t('projectDelete.devQuickButton')}
                  </Button>
                </Box>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </Stack>

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
            void handleRemoveMember(pendingRemovalMember.id, pendingRemovalMember.user === user?.id);
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
