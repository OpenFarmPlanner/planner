import { useState, type FormEvent } from 'react';
import { Alert, Box, Button, Stack, TextField } from '@mui/material';
import { getLocalizedFieldError, updatePublicDisplayName } from '../../../auth/authApi';
import { useAuth } from '../../../auth/useAuth';

export interface AnonymousPostingNoticeProps {
  t: (key: string, options?: Record<string, unknown>) => string;
  /** Called after the public name was stored and the session user refreshed. */
  onSaved: () => void | Promise<void>;
}

/**
 * Tells a signed-in author without a public name that they appear as
 * "Anonym N" and lets them set a name inline. Posting anonymously stays possible.
 */
export function AnonymousPostingNotice({ t, onSaved }: AnonymousPostingNoticeProps) {
  const { refreshUser } = useAuth();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const closeEditor = (): void => {
    setEditing(false);
    setName('');
    setError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    event.stopPropagation();
    setSaving(true);
    setError(null);
    try {
      await updatePublicDisplayName(name.trim());
      await refreshUser();
      await onSaved();
    } catch (saveError) {
      setError(getLocalizedFieldError(saveError, 'public_display_name') ?? t('library.page.discussion.anonymousNotice.saveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Alert
      severity="info"
      action={editing ? undefined : (
        <Button color="inherit" size="small" onClick={() => setEditing(true)}>
          {t('library.page.discussion.anonymousNotice.setPublicName')}
        </Button>
      )}
    >
      {t('library.page.discussion.anonymousNotice.message')}
      {editing ? (
        <Box component="form" onSubmit={(event) => void handleSubmit(event)} sx={{ display: 'grid', gap: 1, mt: 1.5 }}>
          <TextField
            autoFocus
            size="small"
            label={t('library.page.discussion.anonymousNotice.publicNameLabel')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={Boolean(error)}
            helperText={error ?? t('library.page.discussion.anonymousNotice.publicNameHelper')}
            disabled={saving}
            slotProps={{ htmlInput: { maxLength: 255 } }}
          />
          <Stack direction="row" spacing={1}>
            <Button type="submit" variant="contained" size="small" disabled={saving || !name.trim()}>
              {t('library.page.discussion.anonymousNotice.save')}
            </Button>
            <Button size="small" onClick={closeEditor} disabled={saving}>
              {t('library.page.discussion.anonymousNotice.cancel')}
            </Button>
          </Stack>
        </Box>
      ) : null}
    </Alert>
  );
}
