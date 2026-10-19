// Presentational building blocks for the account settings page: success/error
// alerts and the inline editor wrapper.

import {
  Alert,
  Button,
  Collapse,
  Stack,
  type SxProps,
  type Theme,
} from '@mui/material';
import type { FormEvent, ReactNode } from 'react';
import { useTranslation } from '../i18n';
import { DisabledActionTooltip } from '../components/DisabledActionTooltip';
import { actionButtonSx, type SectionSubmit } from './accountSettingsForm';

export function SectionAlerts({ message, error }: { message?: string | null } & Pick<SectionSubmit, 'error'>) {
  return (
    <>
      {message ? <Alert severity="success">{message}</Alert> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
    </>
  );
}

interface InlineEditorProps {
  open: boolean;
  saveLabel: ReactNode;
  onSave: () => void;
  onCancel: () => void;
  submitting: boolean;
  saveDisabled?: boolean;
  sx?: SxProps<Theme>;
  children: ReactNode;
}

export function InlineEditor({ open, saveLabel, onSave, onCancel, submitting, saveDisabled = false, sx, children }: InlineEditorProps) {
  const { t } = useTranslation(['account', 'common']);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (submitting || saveDisabled) {
      return;
    }
    onSave();
  };

  return (
    <Collapse in={open} unmountOnExit>
      <Stack component="form" spacing={2} sx={sx} onSubmit={handleSubmit}>
        {children}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <DisabledActionTooltip
            title={submitting
              ? t('common:disabledReasons.busy')
              : saveDisabled
                ? t('common:disabledReasons.requiredFields')
                : ''}
          >
            <Button type="submit" variant="contained" disabled={submitting || saveDisabled} sx={actionButtonSx}>
              {saveLabel}
            </Button>
          </DisabledActionTooltip>
          <DisabledActionTooltip title={submitting ? t('common:disabledReasons.busy') : ''}>
            <Button type="button" variant="text" onClick={onCancel} disabled={submitting} sx={actionButtonSx}>
              {t('cancel')}
            </Button>
          </DisabledActionTooltip>
        </Stack>
      </Stack>
    </Collapse>
  );
}
