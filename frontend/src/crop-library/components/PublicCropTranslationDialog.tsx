import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';

import { publicCropAPI } from '../../api/api';
import type { PublicCrop } from '../../api/types';
import { useTranslation } from '../../i18n';
import { getLanguageDisplayName } from '../../i18n/languages';
import { DisabledActionTooltip } from '../../components/DisabledActionTooltip';

interface PublicCropTranslationDialogProps {
  open: boolean;
  crop: PublicCrop;
  /** UI language being edited; translators work in their own language. */
  language: string;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

export function PublicCropTranslationDialog({
  open,
  crop,
  language,
  onClose,
  onSaved,
}: PublicCropTranslationDialogProps) {
  const { t, i18n } = useTranslation('crops');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [originalLanguageCode, setOriginalLanguageCode] = useState('');
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [editedText, setEditedText] = useState('');

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    setError('');
    /* eslint-enable react-hooks/set-state-in-effect */
    publicCropAPI.getTranslations(crop.id)
      .then((response) => {
        if (cancelled) {
          return;
        }
        setOriginalLanguageCode(response.data.original_language_code);
        setTranslations(response.data.translations);
        setEditedText(response.data.translations[language] ?? '');
      })
      .catch(() => {
        if (!cancelled) {
          setError(t('library.translation.loadError'));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, crop.id, language, t]);

  const originalText = translations[originalLanguageCode] ?? crop.notes ?? '';
  const showOriginal = !loading
    && language !== originalLanguageCode
    && Boolean(originalText.trim());
  const displayLanguage = i18n.resolvedLanguage ?? i18n.language;
  const languageName = getLanguageDisplayName(language, displayLanguage);
  const originalLanguageName = getLanguageDisplayName(originalLanguageCode, displayLanguage);
  const editorLabel = t('library.translation.editorSectionTitle', { language: languageName });

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    setError('');
    try {
      await publicCropAPI.updateTranslations(crop.id, { [language]: editedText });
      await onSaved();
      onClose();
    } catch {
      setError(t('library.translation.saveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('library.translation.editDialogTitle')}</DialogTitle>
      <DialogContent>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={28} />
          </Box>
        ) : (
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            {showOriginal ? (
              <Box>
                <Typography variant="subtitle2" color="text.secondary">
                  {t('library.translation.originalSectionTitle', { language: originalLanguageName })}
                </Typography>
                <Box
                  sx={{
                    mt: 0.5,
                    p: 1.5,
                    borderRadius: 1,
                    border: '1px solid',
                    borderColor: 'divider',
                    bgcolor: 'action.hover',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  <Typography variant="body2">{originalText}</Typography>
                </Box>
              </Box>
            ) : null}
            <TextField
              fullWidth
              multiline
              minRows={6}
              maxRows={20}
              label={editorLabel}
              value={editedText}
              onChange={(event) => setEditedText(event.target.value)}
              placeholder={t('library.translation.descriptionPlaceholder')}
            />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <DisabledActionTooltip title={saving ? t('common:disabledReasons.busy') : ''}>
          <Button onClick={onClose} disabled={saving}>{t('form.cancel')}</Button>
        </DisabledActionTooltip>
        <DisabledActionTooltip title={loading || saving ? t('common:disabledReasons.busy') : ''}>
          <Button variant="contained" onClick={() => void handleSave()} disabled={loading || saving}>
            {saving ? t('library.page.edit.saving') : t('library.page.edit.save')}
          </Button>
        </DisabledActionTooltip>
      </DialogActions>
    </Dialog>
  );
}
