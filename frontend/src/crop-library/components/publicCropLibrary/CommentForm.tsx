import type { FormEvent, Ref } from 'react';
import { Box, Button, Stack, TextField } from '@mui/material';

import { DisabledActionTooltip } from '../../../components/DisabledActionTooltip';

export interface CommentFormProps {
  body: string;
  disabled?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  label: string;
  submitLabel: string;
  t: (key: string, options?: Record<string, unknown>) => string;
  onBodyChange: (body: string) => void;
  onCancel?: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function CommentForm({
  body,
  disabled = false,
  inputRef,
  label,
  submitLabel,
  t,
  onBodyChange,
  onCancel,
  onSubmit,
}: CommentFormProps) {
  return (
    <Box component="form" onSubmit={onSubmit} sx={{ display: 'grid', gap: 1, maxWidth: 720 }}>
      <TextField
        inputRef={inputRef}
        label={label}
        value={body}
        onChange={(event) => onBodyChange(event.target.value)}
        multiline
        minRows={2}
        maxRows={8}
      />
      <Stack direction="row" spacing={1}>
        <DisabledActionTooltip
          title={disabled
            ? t('common:disabledReasons.busy')
            : !body.trim()
              ? t('disabledReasons.requiredComment')
              : ''}
        >
          <Button type="submit" variant="contained" disabled={disabled || !body.trim()}>
            {submitLabel}
          </Button>
        </DisabledActionTooltip>
        {onCancel ? <Button onClick={onCancel}>{t('library.page.discussion.cancel')}</Button> : null}
      </Stack>
    </Box>
  );
}
