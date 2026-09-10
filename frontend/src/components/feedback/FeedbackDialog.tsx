/**
 * In-app user feedback form, opened from the global menu. Unrelated to the
 * snackbar/confirmation components in this folder: those give feedback *to*
 * the user, this one collects feedback *from* them.
 */
import { useEffect, useId, useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlineOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import HelpOutlineIcon from '@mui/icons-material/HelpOutlineOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined';
import MailOutlineIcon from '@mui/icons-material/MailOutlineOutlined';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import type { SvgIconComponent } from '@mui/icons-material';
import { feedbackAPI, type FeedbackCategory } from '../../api/api';
import { useTranslation } from '../../i18n';
import { DisabledActionTooltip } from '../DisabledActionTooltip';

const CATEGORY_ICONS: Record<FeedbackCategory, SvgIconComponent> = {
  bug: ErrorOutlineIcon,
  idea: LightbulbOutlinedIcon,
  question: HelpOutlineIcon,
  other: MoreHorizIcon,
};

const CATEGORIES: FeedbackCategory[] = ['bug', 'idea', 'question', 'other'];

interface FeedbackDialogProps {
  open: boolean;
  /** Active project name; empty when the user has no project selected. */
  projectName: string;
  /** Current route, shown in the context box and sent along. */
  route: string;
  /** Account email — only transmitted when the user allows being contacted. */
  userEmail: string;
  onClose: () => void;
}

function describeBrowser(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  return `${window.navigator.userAgent} – ${window.innerWidth}x${window.innerHeight}`;
}

export function FeedbackDialog({ open, projectName, route, userEmail, onClose }: FeedbackDialogProps) {
  const { t } = useTranslation('feedback');
  const [category, setCategory] = useState<FeedbackCategory | ''>('');
  const [message, setMessage] = useState('');
  const [contactConsent, setContactConsent] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const [isSent, setIsSent] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    setCategory('');
    setMessage('');
    setContactConsent(false);
    setIsSending(false);
    setError('');
    setIsSent(false);
  }, [open]);

  const canSubmit = message.trim().length > 0 && !isSending;

  const submitFeedback = async (): Promise<void> => {
    if (!canSubmit) {
      return;
    }
    try {
      setIsSending(true);
      setError('');
      await feedbackAPI.submit({
        category,
        message: message.trim(),
        project_name: projectName,
        route,
        browser_info: describeBrowser(),
        contact_consent: contactConsent,
      });
      setIsSent(true);
    } catch (submitError) {
      console.error('Error sending feedback', submitError);
      setError(t('dialog.error'));
    } finally {
      setIsSending(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void submitFeedback();
  };

  const handleClose = (): void => {
    if (!isSending) {
      onClose();
    }
  };

  if (isSent) {
    return (
      <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm" aria-labelledby={titleId}>
        <DialogContent>
          <Stack spacing={1.5} sx={{ alignItems: 'center', textAlign: 'center', py: 2 }}>
            <CheckCircleOutlineIcon fontSize="large" sx={{ color: 'primary.main' }} />
            <Typography id={titleId} variant="h6" component="h2">{t('success.title')}</Typography>
            <Typography variant="body2" color="text.secondary">{t('success.text')}</Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={onClose}>{t('success.close')}</Button>
        </DialogActions>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm" aria-labelledby={titleId}>
      <Box component="form" onSubmit={handleSubmit}>
        <DialogTitle id={titleId} sx={{ pb: 0.5 }}>{t('dialog.title')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('dialog.subtitle')}
          </Typography>

          <Typography variant="subtitle2" component="p" sx={{ mb: 1 }}>
            {t('dialog.categoryLabel')}
          </Typography>
          <Stack
            direction="row"
            role="group"
            aria-label={t('dialog.categoryAriaLabel')}
            sx={{ gap: 1, flexWrap: 'wrap', mb: 2 }}
          >
            {CATEGORIES.map((value) => {
              const Icon = CATEGORY_ICONS[value];
              const selected = category === value;
              return (
                <Chip
                  key={value}
                  clickable
                  variant="outlined"
                  aria-pressed={selected}
                  icon={<Icon fontSize="small" />}
                  label={t(`dialog.categories.${value}`)}
                  onClick={() => setCategory(selected ? '' : value)}
                  sx={(theme) => ({
                    borderColor: selected ? theme.palette.primary.main : theme.palette.divider,
                    color: selected ? theme.palette.primary.dark : theme.palette.text.secondary,
                    fontWeight: selected ? 500 : 400,
                    bgcolor: selected
                      ? alpha(theme.palette.primary.main, 0.12)
                      : 'transparent',
                    '&:hover': {
                      bgcolor: selected
                        ? alpha(theme.palette.primary.main, 0.18)
                        : theme.palette.action.hover,
                    },
                    '& .MuiChip-icon': { color: 'inherit' },
                  })}
                />
              );
            })}
          </Stack>

          <TextField
            fullWidth
            required
            multiline
            minRows={4}
            label={t('dialog.messageLabel')}
            placeholder={t('dialog.messagePlaceholder')}
            value={message}
            disabled={isSending}
            onChange={(event) => setMessage(event.target.value)}
          />

          <Box
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 1,
              mt: 2,
              p: 1.5,
              borderRadius: 1,
              bgcolor: 'action.hover',
            }}
          >
            <InfoOutlinedIcon fontSize="small" sx={{ color: 'text.secondary' }} />
            <Typography variant="caption" color="text.secondary">
              {t('dialog.context', {
                project: projectName || t('dialog.contextNoProject'),
                route,
              })}
            </Typography>
          </Box>

          <Box sx={{ mt: 2 }}>
            <FormControlLabel
              control={(
                <Checkbox
                  checked={contactConsent}
                  disabled={isSending}
                  onChange={(event) => setContactConsent(event.target.checked)}
                />
              )}
              label={t('dialog.contactConsent')}
            />
            <Typography variant="caption" color="text.secondary" component="p" sx={{ ml: 4 }}>
              {t('dialog.contactConsentHint')}
            </Typography>
            {contactConsent ? (
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', ml: 4, mt: 1 }}>
                <MailOutlineIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                <Typography variant="body2" color="text.secondary">
                  {t('dialog.contactEmail', { email: userEmail })}
                </Typography>
              </Stack>
            ) : null}
          </Box>

          {error ? <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert> : null}
        </DialogContent>
        <DialogActions>
          <DisabledActionTooltip title={isSending ? t('common:disabledReasons.busy') : ''}>
            <Button type="button" onClick={handleClose} disabled={isSending}>{t('dialog.cancel')}</Button>
          </DisabledActionTooltip>
          <DisabledActionTooltip title={isSending ? t('common:disabledReasons.busy') : message.trim().length === 0 ? t('dialog.messageRequiredTooltip') : ''}>
            <Button
              type="submit"
              variant="contained"
              disabled={!canSubmit}
              startIcon={isSending ? <CircularProgress size={16} color="inherit" /> : undefined}
            >
              {t('dialog.submit')}
            </Button>
          </DisabledActionTooltip>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
