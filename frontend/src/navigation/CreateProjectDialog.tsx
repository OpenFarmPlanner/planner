import { useCallback, useEffect, useRef, type FormEvent } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from '@mui/material';

import { useTranslation } from '../i18n';
import { DisabledActionTooltip } from '../components/DisabledActionTooltip';

interface CreateProjectDialogProps {
  open: boolean;
  name: string;
  onNameChange: (value: string) => void;
  isCreating: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

/**
 * Presentational create-project dialog. The draft name, submit handler and
 * open state live in RootLayout.tsx; this component only renders the form.
 */
export function CreateProjectDialog({
  open,
  name,
  onNameChange,
  isCreating,
  onClose,
  onSubmit,
}: CreateProjectDialogProps) {
  const { t } = useTranslation('navigation');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hasAppliedOpeningFocusRef = useRef(false);

  const focusProjectNameInput = useCallback((input: HTMLInputElement): void => {
    input.focus({ preventScroll: true });
    if (input.value) {
      input.select();
      return;
    }
    input.setSelectionRange(input.value.length, input.value.length);
  }, []);

  const setProjectNameInputRef = useCallback((input: HTMLInputElement | null): void => {
    inputRef.current = input;
    if (!input || !open || hasAppliedOpeningFocusRef.current) {
      return;
    }
    hasAppliedOpeningFocusRef.current = true;
    focusProjectNameInput(input);
  }, [focusProjectNameInput, open]);

  useEffect(() => {
    if (!open) {
      hasAppliedOpeningFocusRef.current = false;
      return;
    }
    if (!inputRef.current || hasAppliedOpeningFocusRef.current) {
      return;
    }
    hasAppliedOpeningFocusRef.current = true;
    focusProjectNameInput(inputRef.current);
  }, [focusProjectNameInput, open]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <Box component="form" onSubmit={onSubmit}>
        <DialogTitle>{t('projectSwitcher.createDialogTitle')}</DialogTitle>
        <DialogContent sx={{ pt: 1, pb: 1 }}>
          <Stack spacing={1.5} sx={{ mt: 0.5 }}>
            <TextField
              label={t('projectSwitcher.createNameLabel')}
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              autoFocus
              inputRef={setProjectNameInputRef}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button type="button" onClick={onClose}>{t('projectSwitcher.createCancel')}</Button>
          <DisabledActionTooltip title={isCreating ? t('common:disabledReasons.busy') : !name.trim() ? t('common:disabledReasons.requiredFields') : ''}>
            <Button type="submit" variant="contained" disabled={!name.trim() || isCreating}>
              {t('projectSwitcher.createSubmit')}
            </Button>
          </DisabledActionTooltip>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
