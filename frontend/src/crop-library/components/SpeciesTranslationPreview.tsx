import type { JSX } from 'react';
import { Box, Chip, Stack, Typography } from '@mui/material';

import type { CropSpecies, CropSpeciesTranslation } from '../../api/types';
import { AppTooltip } from '../../components/AppTooltip';
import {
  getSpeciesTranslation,
  REQUIRED_SPECIES_LANGUAGES,
  SPECIES_REGIONAL_NAME_KEYS,
  type RequiredSpeciesLanguage,
} from '../../crops/cropSpeciesMatching';
import { useTranslation } from '../../i18n';
import { getLanguageDisplayName } from '../../i18n/languages';

/** Synonyms and (German) regional names under a translated name, as small secondary lines. */
function TranslationDetails({ translation }: { translation: CropSpeciesTranslation }): JSX.Element | null {
  const { t } = useTranslation('crops');
  const synonyms = translation.synonyms ?? [];
  const regionalNames = SPECIES_REGIONAL_NAME_KEYS
    .map((region) => [region, translation.regional_names?.[region]] as const)
    .filter(([, name]) => Boolean(name));
  if (synonyms.length === 0 && regionalNames.length === 0) return null;
  return (
    <>
      {synonyms.length > 0 ? (
        <Typography variant="caption" sx={{ display: 'block', color: 'inherit', opacity: 0.8 }}>
          {t('library.moderation.species.previewSynonyms', { synonyms: synonyms.join(', ') })}
        </Typography>
      ) : null}
      {regionalNames.map(([region, name]) => (
        <Typography key={region} variant="caption" sx={{ display: 'block', color: 'inherit', opacity: 0.8 }}>
          {`${t(`library.moderation.species.regionalName.${region}`)}: ${name}`}
        </Typography>
      ))}
    </>
  );
}

/**
 * One chip per required language; a missing common name shows as a faded
 * outline. Hovering, focusing or tapping a chip shows that language's name,
 * synonyms and regional names, so a moderator can check a translation
 * without opening the approval dialog.
 */
export function SpeciesLanguageChips({ species }: { species: CropSpecies }): JSX.Element {
  const { t, i18n } = useTranslation('crops');
  return (
    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
      {REQUIRED_SPECIES_LANGUAGES.map((languageCode) => {
        const language = getLanguageDisplayName(languageCode, i18n.resolvedLanguage ?? i18n.language);
        const translation = getSpeciesTranslation(species, languageCode);
        const label = translation ? language : t('library.moderation.species.languageMissing', { language });
        return (
          <AppTooltip
            key={languageCode}
            enterTouchDelay={0}
            leaveTouchDelay={4000}
            title={translation ? (
              <Box lang={languageCode}>
                <Typography variant="caption" sx={{ display: 'block', fontWeight: 600 }}>{language}</Typography>
                <Typography variant="body2" sx={{ color: 'inherit' }}>{translation.common_name}</Typography>
                <TranslationDetails translation={translation} />
              </Box>
            ) : label}
          >
            <Chip
              size="small"
              tabIndex={0}
              label={languageCode.toUpperCase()}
              variant={translation ? 'filled' : 'outlined'}
              color={translation ? 'success' : 'default'}
              aria-label={label}
              sx={translation ? undefined : { opacity: 0.6, borderStyle: 'dashed' }}
            />
          </AppTooltip>
        );
      })}
    </Stack>
  );
}

/** Table cell content for one language: the name with its synonyms below, or a "missing" marker. */
export function SpeciesTranslationCell({
  species, languageCode,
}: { species: CropSpecies; languageCode: RequiredSpeciesLanguage }): JSX.Element {
  const { t } = useTranslation('crops');
  const translation = getSpeciesTranslation(species, languageCode);
  if (!translation) {
    return (
      <Typography variant="body2" color="error" sx={{ fontStyle: 'italic' }}>
        {t('library.moderation.species.previewMissing')}
      </Typography>
    );
  }
  return (
    <Box lang={languageCode} sx={{ color: 'text.secondary' }}>
      <Typography variant="body2" color="text.primary">{translation.common_name}</Typography>
      <TranslationDetails translation={translation} />
    </Box>
  );
}
