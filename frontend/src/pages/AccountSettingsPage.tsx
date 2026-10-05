import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  publicLibraryModeratorRequestAPI,
} from '../api/api';
import {
  changePassword,
  getAccountDataExport,
  requestEmailChange,
  updateProfile,
  updatePublicDisplayName,
} from '../auth/authApi';
import { useAuth } from '../auth/useAuth';
import { useGuestDemoGuard } from '../auth/useGuestDemoGuard';
import { GuestDemoNotice } from '../components/GuestDemoNotice';
import { useTranslation } from '../i18n';
import { useNavigationBlocker } from '../hooks/useNavigationBlocker';
import { enableDevOnboardingPreview } from '../projects/devOnboardingPreview';
import { clearContextMenuHintDismissals } from '../components/data-grid';
import {
  mediumStackedFieldSx,
  wideSingleColumnFieldSx,
  wideStackedFieldSx,
} from '../components/forms/formLayout';
import { actionButtonSx, useSectionSubmit } from './accountSettingsForm';
import {
  InlineEditor,
  SectionAlerts,
  SettingsCard,
} from './accountSettingsCards';
import { AccountSettingsSocialMethods } from './accountSettingsSocialCard';
import AccountSettingsApiTokensCard from './accountSettingsApiTokensCard';
import AccountSettingsCropLibraryTokenCard from './accountSettingsCropLibraryTokenCard';
import { AccountLanguageSelect } from '../i18n/LanguageSwitcher';

export default function AccountSettingsPage() {
  const { user, requestAccountDeletion, refreshUser } = useAuth();
  const { blockInGuestDemo } = useGuestDemoGuard();
  const { t } = useTranslation('account');
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState(user?.display_name ?? '');
  const [publicDisplayName, setPublicDisplayName] = useState(user?.public_display_name ?? '');
  const [moderatorMotivation, setModeratorMotivation] = useState('');
  const [moderatorRequestStatus, setModeratorRequestStatus] = useState<'none' | 'pending' | 'approved' | 'rejected' | 'moderator' | 'loading'>('loading');
  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');

  const profileSection = useSectionSubmit(t('errors.generic'));
  const publicProfileSection = useSectionSubmit(t('errors.generic'));
  const moderatorRequestSection = useSectionSubmit(t('errors.generic'));
  const emailSection = useSectionSubmit(t('errors.generic'));
  const passwordSection = useSectionSubmit(t('errors.generic'));
  const dataExportSection = useSectionSubmit(t('errors.generic'));

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [activeEditor, setActiveEditor] = useState<'displayName' | 'publicDisplayName' | 'email' | 'password' | null>(null);
  const [hintsResetDone, setHintsResetDone] = useState(false);

  // Accounts created through Google/Microsoft have no password to confirm
  // sensitive actions with; the backend accepts the authenticated session
  // instead (see accounts/views.py `_password_confirmation_is_valid`).
  const hasPassword = user?.has_password ?? true;
  const deletePhrase = t('deletePhrase');
  const requiresDeletePhrase = deleteConfirmationText.trim() === deletePhrase;
  const canDelete = (!hasPassword || deletePassword.trim().length > 0) && requiresDeletePhrase;

  const hasUnsavedChanges = useMemo(() => {
    if (activeEditor === 'displayName') return displayName !== (user?.display_name ?? '');
    if (activeEditor === 'publicDisplayName') return publicDisplayName !== (user?.public_display_name ?? '');
    if (activeEditor === 'email') return !!newEmail || !!emailPassword;
    if (activeEditor === 'password') return !!currentPassword || !!newPassword || !!repeatPassword;
    return false;
  }, [
    activeEditor,
    currentPassword,
    displayName,
    emailPassword,
    newEmail,
    newPassword,
    publicDisplayName,
    repeatPassword,
    user?.display_name,
    user?.public_display_name,
  ]);

  useEffect(() => {
    let cancelled = false;
    publicLibraryModeratorRequestAPI.mine()
      .then((response) => {
        if (cancelled) return;
        if (response.data.is_moderator) {
          setModeratorRequestStatus('moderator');
          return;
        }
        setModeratorRequestStatus(response.data.request?.status ?? 'none');
      })
      .catch(() => {
        if (!cancelled) {
          setModeratorRequestStatus('none');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useNavigationBlocker(hasUnsavedChanges, t('unsavedChangesWarning'));

  // The guest demo has no real account: every account change is rejected by
  // the backend, so the explanation comes before the form instead of after it.
  const openEditor = (editor: NonNullable<typeof activeEditor>): void => {
    if (!blockInGuestDemo()) {
      setActiveEditor(editor);
    }
  };

  const closeDisplayNameEditor = (): void => {
    setActiveEditor(null);
    setDisplayName(user?.display_name ?? '');
    profileSection.clearError();
  };

  const closePublicDisplayNameEditor = (): void => {
    setActiveEditor(null);
    setPublicDisplayName(user?.public_display_name ?? '');
    publicProfileSection.clearError();
  };

  const closeEmailEditor = (): void => {
    setActiveEditor(null);
    setNewEmail('');
    setEmailPassword('');
    emailSection.clearError();
  };

  const closePasswordEditor = (): void => {
    setActiveEditor(null);
    setCurrentPassword('');
    setNewPassword('');
    setRepeatPassword('');
    passwordSection.clearError();
  };

  const handleProfileSave = (): Promise<void> =>
    profileSection.submit(
      () => updateProfile(displayName),
      async () => {
        await refreshUser();
        setActiveEditor(null);
      },
    );

  const handlePublicProfileSave = (): Promise<void> =>
    publicProfileSection.submit(
      () => updatePublicDisplayName(publicDisplayName),
      async () => {
        await refreshUser();
        setActiveEditor(null);
      },
    );

  const handleModeratorRequestSubmit = async (): Promise<void> => {
    if (blockInGuestDemo()) {
      return;
    }
    await moderatorRequestSection.submit(
      async () => {
        await publicLibraryModeratorRequestAPI.create(moderatorMotivation.trim());
        return { detail: t('moderatorRequest.success') };
      },
      () => {
        setModeratorMotivation('');
        setModeratorRequestStatus('pending');
      },
    );
  };

  const handleEmailChangeRequest = (): Promise<void> =>
    emailSection.submit(() => requestEmailChange(newEmail, emailPassword), closeEmailEditor);

  const handlePasswordChange = (): Promise<void> =>
    passwordSection.submit(() => changePassword(currentPassword, newPassword, repeatPassword), closePasswordEditor);

  const handleDataExport = async (): Promise<void> => {
    if (blockInGuestDemo()) {
      return;
    }
    await dataExportSection.submit(async () => {
      const payload = await getAccountDataExport();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'openfarmplanner-data-export.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      return { detail: t('dataExport.success') };
    });
  };

  const handleResetHints = (): void => {
    localStorage.removeItem('ofp.shortcutHintSeen');
    clearContextMenuHintDismissals(user?.id);
    setHintsResetDone(true);
  };

  const handleShowOnboardingPreview = (): void => {
    enableDevOnboardingPreview();
    localStorage.removeItem('activeProjectId');
    navigate('/app/project-selection');
  };

  const handleDelete = async (): Promise<void> => {
    setDeleteSubmitting(true);
    setDeleteError(null);
    try {
      const response = await requestAccountDeletion(deletePassword);
      setDeleteDialogOpen(false);
      navigate('/login', { replace: true, state: { deletionScheduled: response.scheduled_deletion_at } });
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : t('errors.delete'));
    } finally {
      setDeleteSubmitting(false);
    }
  };

  return (
    <Box sx={{ p: 3, width: '100%', boxSizing: 'border-box' }}>
      <Stack spacing={3}>
        <GuestDemoNotice messageKey="accountSettingsNotice" />
        <SettingsCard title={t('sections.profile')} collapsible defaultExpanded>
          <Stack spacing={2}>
            <Typography>
              <strong>{t('email')}:</strong> {user?.email}
            </Typography>
            <Typography>
              <strong>{t('displayName')}:</strong> {user?.display_name || t('noDisplayName')}
            </Typography>
            <SectionAlerts message={profileSection.message} error={profileSection.error} />
            <Box>
              {activeEditor !== 'displayName' ? (
                <Button variant="outlined" onClick={() => openEditor('displayName')} sx={actionButtonSx}>
                  {t('actions.editDisplayName')}
                </Button>
              ) : null}
            </Box>
            <InlineEditor
              open={activeEditor === 'displayName'}
              saveLabel={t('actions.save')}
              onSave={() => void handleProfileSave()}
              onCancel={closeDisplayNameEditor}
              submitting={profileSection.submitting}
            >
              <TextField
                label={t('displayName')}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                sx={wideSingleColumnFieldSx}
                slotProps={{ htmlInput: { maxLength: 255 } }}
              />
            </InlineEditor>

            <Divider />

            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {t('sections.publicProfile')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('publicProfile.description')}
            </Typography>
            <Typography>
              <strong>{t('publicProfile.publicDisplayName')}:</strong>{' '}
              {user?.public_display_name || t('publicProfile.noPublicDisplayName')}
            </Typography>
            <SectionAlerts message={publicProfileSection.message} error={publicProfileSection.error} />
            <Box>
              {activeEditor !== 'publicDisplayName' ? (
                <Button variant="outlined" onClick={() => openEditor('publicDisplayName')} sx={actionButtonSx}>
                  {user?.public_display_name
                    ? t('publicProfile.actions.editPublicDisplayName')
                    : t('publicProfile.actions.setPublicDisplayName')}
                </Button>
              ) : null}
            </Box>
            <InlineEditor
              open={activeEditor === 'publicDisplayName'}
              saveLabel={t('actions.save')}
              onSave={() => void handlePublicProfileSave()}
              onCancel={closePublicDisplayNameEditor}
              submitting={publicProfileSection.submitting}
            >
              <TextField
                label={t('publicProfile.publicDisplayName')}
                value={publicDisplayName}
                onChange={(event) => setPublicDisplayName(event.target.value)}
                sx={wideSingleColumnFieldSx}
                helperText={t('publicProfile.helperText')}
                slotProps={{ htmlInput: { maxLength: 255 } }}
              />
            </InlineEditor>

            <Divider />

            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {t('moderatorRequest.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('moderatorRequest.description')}
            </Typography>
            <SectionAlerts message={moderatorRequestSection.message} error={moderatorRequestSection.error} />
            {moderatorRequestStatus === 'loading' ? (
              <Typography variant="body2" color="text.secondary">{t('moderatorRequest.loading')}</Typography>
            ) : moderatorRequestStatus === 'moderator' ? (
              <Alert severity="success">{t('moderatorRequest.alreadyModerator')}</Alert>
            ) : moderatorRequestStatus === 'pending' ? (
              <Alert severity="info">{t('moderatorRequest.pending')}</Alert>
            ) : (
              <Stack spacing={1.5}>
                {moderatorRequestStatus === 'rejected' ? (
                  <Alert severity="info">{t('moderatorRequest.rejectedHint')}</Alert>
                ) : null}
                <TextField
                  label={t('moderatorRequest.motivationLabel')}
                  value={moderatorMotivation}
                  onChange={(event) => setModeratorMotivation(event.target.value)}
                  multiline
                  minRows={3}
                  maxRows={4}
                  sx={wideStackedFieldSx}
                  slotProps={{ htmlInput: { maxLength: 2000 } }}
                />
                <Box>
                  <Button
                    variant="outlined"
                    onClick={() => void handleModeratorRequestSubmit()}
                    disabled={!moderatorMotivation.trim() || moderatorRequestSection.submitting}
                    sx={actionButtonSx}
                  >
                    {moderatorRequestSection.submitting ? t('moderatorRequest.sending') : t('moderatorRequest.submit')}
                  </Button>
                </Box>
              </Stack>
            )}
          </Stack>
        </SettingsCard>

        <SettingsCard title={t('sections.security')} collapsible defaultExpanded>
          <Stack spacing={2}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {t('security.credentials')}
            </Typography>

            <SectionAlerts message={emailSection.message} error={emailSection.error} />
            <SectionAlerts message={passwordSection.message} error={passwordSection.error} />

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <Button
                variant={activeEditor === 'email' ? 'contained' : 'outlined'}
                onClick={() => openEditor('email')}
                sx={actionButtonSx}
              >
                {t('security.changeEmailTitle')}
              </Button>
              {hasPassword ? (
                <Button
                  variant={activeEditor === 'password' ? 'contained' : 'outlined'}
                  onClick={() => openEditor('password')}
                  sx={actionButtonSx}
                >
                  {t('security.changePasswordTitle')}
                </Button>
              ) : null}
            </Stack>

            {hasPassword ? null : (
              <Typography variant="body2" color="text.secondary">
                {t('security.noPasswordHint')}
              </Typography>
            )}

            <InlineEditor
              open={activeEditor === 'email'}
              saveLabel={t('actions.sendConfirmationLink')}
              onSave={() => void handleEmailChangeRequest()}
              onCancel={closeEmailEditor}
              submitting={emailSection.submitting}
              saveDisabled={!newEmail.trim() || (hasPassword && !emailPassword.trim())}
            >
              <TextField
                label={t('security.newEmail')}
                type="email"
                sx={wideSingleColumnFieldSx}
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
              />
              {hasPassword ? (
                <TextField
                  label={t('currentPassword')}
                  type="password"
                  sx={mediumStackedFieldSx}
                  value={emailPassword}
                  onChange={(event) => setEmailPassword(event.target.value)}
                />
              ) : null}
            </InlineEditor>

            <InlineEditor
              open={activeEditor === 'password'}
              saveLabel={t('actions.savePassword')}
              onSave={() => void handlePasswordChange()}
              onCancel={closePasswordEditor}
              submitting={passwordSection.submitting}
              saveDisabled={!currentPassword || !newPassword || !repeatPassword}
            >
              <TextField
                label={t('currentPassword')}
                type="password"
                sx={mediumStackedFieldSx}
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
              <TextField
                label={t('security.newPassword')}
                type="password"
                sx={mediumStackedFieldSx}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
              <TextField
                label={t('security.repeatNewPassword')}
                type="password"
                sx={mediumStackedFieldSx}
                value={repeatPassword}
                onChange={(event) => setRepeatPassword(event.target.value)}
              />
            </InlineEditor>

            <Divider />

            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {t('loginMethods.title')}
            </Typography>
            <AccountSettingsSocialMethods />
          </Stack>
        </SettingsCard>

        <AccountSettingsApiTokensCard />
        <AccountSettingsCropLibraryTokenCard />

        <SettingsCard title={t('sections.language')} description={t('language.description')} collapsible>
          <AccountLanguageSelect />
        </SettingsCard>

        <SettingsCard title={t('sections.privacy')} description={t('dataExport.description')} collapsible>
          <SectionAlerts message={dataExportSection.message} error={dataExportSection.error} />
          <Button
            variant="outlined"
            onClick={() => void handleDataExport()}
            disabled={dataExportSection.submitting}
            sx={actionButtonSx}
          >
            {t('dataExport.downloadButton')}
          </Button>
        </SettingsCard>

        {import.meta.env.DEV ? (
          <SettingsCard title={t('developer.title')} description={t('developer.hintsDescription')} collapsible>
            {hintsResetDone ? <Alert severity="success" sx={{ mb: 2 }}>{t('developer.hintsResetDone')}</Alert> : null}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <Button variant="outlined" onClick={handleResetHints}>
                {t('developer.resetHintsAction')}
              </Button>
              <Button variant="outlined" onClick={handleShowOnboardingPreview}>
                {t('developer.showOnboardingAction')}
              </Button>
            </Stack>
          </SettingsCard>
        ) : null}

        <SettingsCard
          title={t('sections.account')}
          description={`${t('deleteDescription')} ${t('restoreDescription')}`}
        >
          <Button color="error" variant="outlined" onClick={() => { if (!blockInGuestDemo()) setDeleteDialogOpen(true); }}>
            {t('deleteButton')}
          </Button>
        </SettingsCard>
      </Stack>

      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{t('dialogTitle')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="warning">
              {hasPassword
                ? t('dialogWarning', { phrase: deletePhrase })
                : t('dialogWarningWithoutPassword', { phrase: deletePhrase })}
            </Alert>
            <Typography>{t('deleteDescription')}</Typography>
            <Typography>{t('restoreDescription')}</Typography>
            {hasPassword ? (
              <TextField
                sx={mediumStackedFieldSx}
                type="password"
                label={t('currentPassword')}
                value={deletePassword}
                onChange={(event) => setDeletePassword(event.target.value)}
              />
            ) : null}
            <TextField
              sx={wideSingleColumnFieldSx}
              label={t('deletePhraseLabel')}
              value={deleteConfirmationText}
              onChange={(event) => setDeleteConfirmationText(event.target.value)}
              helperText={t('deletePhraseHelper', { phrase: deletePhrase })}
            />
            {deleteError ? <Alert severity="error">{deleteError}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>{t('cancel')}</Button>
          <Button color="error" variant="contained" disabled={!canDelete || deleteSubmitting} onClick={() => void handleDelete()}>
            {t('confirmDelete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
