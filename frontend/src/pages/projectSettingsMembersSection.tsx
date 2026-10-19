import MoreVertIcon from '@mui/icons-material/MoreVert';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useState, type FormEvent, type MouseEvent } from 'react';
import type { ProjectInvitationPayload, ProjectMemberPayload } from '../api/api';
import { GuestDemoNotice } from '../components/GuestDemoNotice';
import { TypeaheadSelect as Select } from '../components/inputs/TypeaheadSelect';
import { SettingsSection, SettingsSubsection } from '../components/settings/SettingsSection';
import { settingsActionButtonSx, settingsFlatAlertSx } from '../components/settings/settingsStyles';
import { useTranslation } from '../i18n';
import { getActiveFormattingLocale } from '../utils/numberLocalization';
import { EMAIL_PATTERN, memberInitials, type MembersFeedback, type ProjectRole } from './projectSettingsMembers';

interface ProjectSettingsMembersSectionProps {
  currentUserId: number | undefined;
  canManageMembers: boolean;
  members: ProjectMemberPayload[];
  memberLoadError: string | null;
  invitations: ProjectInvitationPayload[];
  invitationLoadError: string | null;
  feedback: MembersFeedback | null;
  /** Returns true when the invitation was sent, so the form can reset. */
  onInvite: (email: string, role: ProjectRole) => Promise<boolean>;
  /** Returns false when the guest demo blocked the action. */
  canStartInvite: () => boolean;
  onChangeRole: (member: ProjectMemberPayload, role: ProjectRole) => void;
  onRequestRemove: (member: ProjectMemberPayload) => void;
  onRevokeInvitation: (invitationId: number) => void;
}

export function ProjectSettingsMembersSection({
  currentUserId,
  canManageMembers,
  members,
  memberLoadError,
  invitations,
  invitationLoadError,
  feedback,
  onInvite,
  canStartInvite,
  onChangeRole,
  onRequestRemove,
  onRevokeInvitation,
}: ProjectSettingsMembersSectionProps) {
  const { t } = useTranslation('projectInvitations');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ProjectRole>('member');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; member: ProjectMemberPayload } | null>(null);

  const pendingInvitations = invitations
    .filter((invitation) => invitation.resolved_status === 'pending')
    .sort((left, right) => new Date(right.expires_at).getTime() - new Date(left.expires_at).getTime());

  const handleInviteSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (sending || !canStartInvite()) {
      return;
    }
    const trimmed = email.trim();
    if (!trimmed) {
      setEmailError(t('emailRequired'));
      return;
    }
    if (!EMAIL_PATTERN.test(trimmed)) {
      setEmailError(t('error.invalid_email'));
      return;
    }
    setEmailError(null);
    setSending(true);
    try {
      if (await onInvite(trimmed, role)) {
        setEmail('');
        setRole('member');
      }
    } finally {
      setSending(false);
    }
  };

  const openMenu = (event: MouseEvent<HTMLElement>, member: ProjectMemberPayload): void => {
    setMenu({ anchor: event.currentTarget, member });
  };

  const runMenuAction = (action: (member: ProjectMemberPayload) => void): void => {
    if (menu) {
      action(menu.member);
    }
    setMenu(null);
  };

  return (
    <SettingsSection id="members" title={t('membersSectionTitle')}>
      <Stack spacing={3} divider={<Divider />}>
        {feedback ? (
          <Alert severity={feedback.severity} sx={{ ...settingsFlatAlertSx, wordBreak: 'break-word' }}>
            {feedback.text}
          </Alert>
        ) : null}

        {canManageMembers ? (
          <SettingsSubsection title={t('inviteSectionTitle')}>
            <GuestDemoNotice messageKey="inviteMembers" />
            <Stack
              component="form"
              noValidate
              onSubmit={(event) => void handleInviteSubmit(event)}
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1.5}
              sx={{ alignItems: { xs: 'stretch', sm: 'flex-start' } }}
            >
              <TextField
                label={t('emailLabel')}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setEmailError(null);
                }}
                error={emailError !== null}
                helperText={emailError ?? ' '}
                sx={{ flex: { sm: '1 1 auto' }, minWidth: 0 }}
              />
              <FormControl sx={{ width: { xs: '100%', sm: 180 }, flexShrink: 0 }}>
                <InputLabel id="project-invite-role-label">{t('roleLabel')}</InputLabel>
                <Select
                  fullWidth
                  labelId="project-invite-role-label"
                  label={t('roleLabel')}
                  value={role}
                  onChange={(event) => setRole(event.target.value as ProjectRole)}
                >
                  <MenuItem value="member">{t('roleMember')}</MenuItem>
                  <MenuItem value="admin">{t('roleAdmin')}</MenuItem>
                </Select>
              </FormControl>
              <Button
                type="submit"
                variant="contained"
                disabled={sending}
                sx={{ ...settingsActionButtonSx, minHeight: 56, flexShrink: 0 }}
              >
                {t('sendInvite')}
              </Button>
            </Stack>
          </SettingsSubsection>
        ) : (
          <Alert severity="info" sx={settingsFlatAlertSx}>{t('memberManagementNoAccess')}</Alert>
        )}

        <SettingsSubsection title={t('membersCount', { count: members.length })}>
          {memberLoadError ? <Alert severity="error" sx={settingsFlatAlertSx}>{memberLoadError}</Alert> : null}
          {!memberLoadError && members.length === 0 ? (
            <Typography variant="body2" color="text.secondary">{t('membersEmpty')}</Typography>
          ) : null}
          {!memberLoadError && members.length > 0 ? (
            <Stack component="ul" divider={<Divider component="li" aria-hidden="true" />} sx={{ listStyle: 'none', m: 0, p: 0 }}>
              {members.map((member) => {
                const isCurrentUser = member.user === currentUserId;
                const displayName = member.user_display_name.trim() || member.user_email || t('memberDisplayFallback');
                const showEmail = Boolean(member.user_email) && member.user_email !== displayName;
                const showMenu = canManageMembers && !isCurrentUser;
                return (
                  <Stack
                    component="li"
                    key={member.id}
                    direction="row"
                    spacing={1.5}
                    sx={{ alignItems: 'center', py: 1.5, minHeight: 44 }}
                  >
                    <Avatar aria-hidden="true" sx={{ width: 36, height: 36, fontSize: '0.875rem', bgcolor: 'primary.main' }}>
                      {memberInitials(displayName)}
                    </Avatar>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{displayName}</Typography>
                        {isCurrentUser ? <Chip label={t('memberYou')} size="small" /> : null}
                      </Stack>
                      {showEmail ? (
                        <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                          {member.user_email}
                        </Typography>
                      ) : null}
                    </Box>
                    <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
                      {member.role === 'admin' ? t('roleAdmin') : t('roleMember')}
                    </Typography>
                    {showMenu ? (
                      <IconButton
                        aria-label={t('memberActions', { name: displayName })}
                        aria-haspopup="menu"
                        onClick={(event) => openMenu(event, member)}
                        sx={{ width: 44, height: 44, flexShrink: 0 }}
                      >
                        <MoreVertIcon />
                      </IconButton>
                    ) : (
                      // Keeps the role column aligned with rows that have a menu.
                      canManageMembers ? <Box aria-hidden="true" sx={{ width: 44, flexShrink: 0 }} /> : null
                    )}
                  </Stack>
                );
              })}
            </Stack>
          ) : null}
          <Menu anchorEl={menu?.anchor ?? null} open={menu !== null} onClose={() => setMenu(null)}>
            {menu?.member.role === 'admin' ? (
              <MenuItem sx={{ minHeight: 44 }} onClick={() => runMenuAction((member) => onChangeRole(member, 'member'))}>
                {t('makeMember')}
              </MenuItem>
            ) : (
              <MenuItem sx={{ minHeight: 44 }} onClick={() => runMenuAction((member) => onChangeRole(member, 'admin'))}>
                {t('makeAdmin')}
              </MenuItem>
            )}
            <MenuItem sx={{ minHeight: 44, color: 'error.main' }} onClick={() => runMenuAction(onRequestRemove)}>
              {t('removeMember')}
            </MenuItem>
          </Menu>
        </SettingsSubsection>

        {canManageMembers ? (
          <SettingsSubsection title={t('listTitle')}>
            {invitationLoadError ? <Alert severity="error" sx={settingsFlatAlertSx}>{invitationLoadError}</Alert> : null}
            {!invitationLoadError && pendingInvitations.length === 0 ? (
              <Typography variant="body2" color="text.secondary">{t('listEmpty')}</Typography>
            ) : null}
            {!invitationLoadError && pendingInvitations.length > 0 ? (
              <Stack component="ul" divider={<Divider component="li" aria-hidden="true" />} sx={{ listStyle: 'none', m: 0, p: 0 }}>
                {pendingInvitations.map((invitation) => (
                  <Stack
                    component="li"
                    key={invitation.id}
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    sx={{ alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between', py: 1.5 }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{invitation.email}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {t('expiresAt', { date: new Date(invitation.expires_at).toLocaleString(getActiveFormattingLocale()) })}
                        {' · '}
                        {invitation.role === 'admin' ? t('roleAdmin') : t('roleMember')}
                      </Typography>
                    </Box>
                    <Button
                      variant="outlined"
                      color="error"
                      onClick={() => onRevokeInvitation(invitation.id)}
                      sx={{ ...settingsActionButtonSx, flexShrink: 0 }}
                    >
                      {t('revoke')}
                    </Button>
                  </Stack>
                ))}
              </Stack>
            ) : null}
          </SettingsSubsection>
        ) : null}
      </Stack>
    </SettingsSection>
  );
}
