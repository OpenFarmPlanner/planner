import type { JSX } from 'react';
import { Box, Stack, TextField, Typography } from '@mui/material';

import {
  REQUIRED_SPECIES_LANGUAGES,
  SPECIES_REGIONAL_NAME_KEYS,
  SPECIES_REGIONAL_NAME_LANGUAGE,
  type RequiredSpeciesLanguage,
  type SpeciesApprovalTranslation,
  type SpeciesApprovalTranslations,
} from '../../crops/cropSpeciesMatching';
import { useTranslation } from '../../i18n';
import { getLanguageDisplayName } from '../../i18n/languages';

interface SpeciesApprovalFieldsProps {
  translations: SpeciesApprovalTranslations;
  onChange: (languageCode: RequiredSpeciesLanguage, patch: Partial<SpeciesApprovalTranslation>) => void;
  disabled?: boolean;
}

/**
 * Name, synonyms and (German only) regional names of a species proposal in
 * every required language. Shared by every place a moderator approves a
 * species, so the review always covers all languages and never drops aliases.
 */
export function SpeciesApprovalFields({ translations, onChange, disabled = false }: SpeciesApprovalFieldsProps): JSX.Element {
  const { t, i18n } = useTranslation('crops');
  const displayLanguage = i18n.resolvedLanguage ?? i18n.language;

  return (
    <Stack spacing={2.5}>
      {REQUIRED_SPECIES_LANGUAGES.map((languageCode) => {
        const language = getLanguageDisplayName(languageCode, displayLanguage);
        const translation = translations[languageCode];
        return (
          <Box key={languageCode}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>{language}</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField
                label={t('library.moderation.species.commonNameLabel', { language })}
                value={translation.commonName}
                required
                fullWidth
                disabled={disabled}
                onChange={(event) => onChange(languageCode, { commonName: event.target.value })}
                slotProps={{ htmlInput: { lang: languageCode } }}
              />
              <TextField
                label={t('library.moderation.speciesAliases.fieldLabel', { language })}
                value={translation.synonyms}
                fullWidth
                disabled={disabled}
                onChange={(event) => onChange(languageCode, { synonyms: event.target.value })}
                slotProps={{ htmlInput: { lang: languageCode } }}
              />
            </Stack>
            {languageCode === SPECIES_REGIONAL_NAME_LANGUAGE ? (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 1.5 }}>
                {SPECIES_REGIONAL_NAME_KEYS.map((region) => (
                  <TextField
                    key={region}
                    label={t(`library.moderation.species.regionalName.${region}`)}
                    value={translation.regionalNames[region] ?? ''}
                    fullWidth
                    size="small"
                    disabled={disabled}
                    onChange={(event) => onChange(languageCode, {
                      regionalNames: { ...translation.regionalNames, [region]: event.target.value },
                    })}
                    slotProps={{ htmlInput: { lang: languageCode } }}
                  />
                ))}
              </Stack>
            ) : null}
          </Box>
        );
      })}
      <Typography variant="body2" color="text.secondary">
        {t('library.moderation.species.approvalHelper')}
      </Typography>
    </Stack>
  );
}
