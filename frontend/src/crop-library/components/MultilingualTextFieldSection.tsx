import type { JSX } from 'react';
import TranslateOutlinedIcon from '@mui/icons-material/TranslateOutlined';
import { Alert, Box, Stack, TextField, Typography } from '@mui/material';

import { useTranslation } from '../../i18n';
import { getLanguageDisplayName, normalizeLanguageTag } from '../../i18n/languages';

interface MultilingualTextFieldSectionProps {
  title: string;
  fieldLabel: string;
  originalLanguageCode: string;
  currentLanguageCode: string;
  originalValue: string;
  translationValue: string;
  translationPlaceholder: string;
  onOriginalValueChange: (value: string) => void;
  onTranslationValueChange: (value: string) => void;
  minRows?: number;
  maxRows?: number;
}

export function MultilingualTextFieldSection({
  title,
  fieldLabel,
  originalLanguageCode,
  currentLanguageCode,
  originalValue,
  translationValue,
  translationPlaceholder,
  onOriginalValueChange,
  onTranslationValueChange,
  minRows = 4,
  maxRows = 20,
}: MultilingualTextFieldSectionProps): JSX.Element {
  const { t, i18n } = useTranslation('crops');
  const displayLanguage = i18n.resolvedLanguage ?? i18n.language;
  const originalCode = normalizeLanguageTag(originalLanguageCode) ?? normalizeLanguageTag(currentLanguageCode) ?? 'de';
  const currentCode = normalizeLanguageTag(currentLanguageCode) ?? originalCode;
  const originalLanguageName = getLanguageDisplayName(originalCode, displayLanguage);
  const currentLanguageName = getLanguageDisplayName(currentCode, displayLanguage);
  const editsTranslation = currentCode !== originalCode;
  const hasTranslation = translationValue.trim().length > 0;
  const showsOriginalFallback = editsTranslation && !hasTranslation && originalValue.trim().length > 0;

  return (
    <Box>
      <Typography variant="h6" sx={{ mt: 2 }}>
        {title}
      </Typography>
      <Stack spacing={1.5} sx={{ mt: 1 }}>
        <TextField
          fullWidth
          multiline
          minRows={minRows}
          maxRows={maxRows}
          label={fieldLabel}
          value={originalValue}
          onChange={(event) => onOriginalValueChange(event.target.value)}
          helperText={t('library.translation.originalLanguageLabel', { language: originalLanguageName })}
          slotProps={{ htmlInput: { lang: originalCode } }}
        />
        {editsTranslation ? (
          <>
            {showsOriginalFallback ? (
              <Alert
                severity="info"
                icon={<TranslateOutlinedIcon fontSize="small" />}
                sx={{ py: 0.75 }}
              >
                {t('library.translation.showingOriginalText', { language: originalLanguageName })}
              </Alert>
            ) : null}
            <TextField
              fullWidth
              multiline
              minRows={minRows}
              maxRows={maxRows}
              label={t('library.translation.translationFieldLabel', { language: currentLanguageName })}
              value={translationValue}
              onChange={(event) => onTranslationValueChange(event.target.value)}
              placeholder={translationPlaceholder}
              slotProps={{ htmlInput: { lang: currentCode } }}
            />
          </>
        ) : null}
      </Stack>
    </Box>
  );
}
