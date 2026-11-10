/**
 * Display helpers for public crop-library entries.
 *
 * The API already resolves the caller's language and reports which language it
 * actually served (`display_language_code` / `description_language_code`). These
 * helpers turn that into what the UI needs: a name that is never empty, and a
 * flag for whether description text is a real translation or a fallback from
 * another language.
 *
 * Variety names are proper names and are never translated — they are appended
 * verbatim in every language.
 */

import type { TFunction } from 'i18next';

import type { PublicCrop } from '../api/types';
import { getLanguageDisplayName, normalizeLanguageTag, type SupportedLanguage } from '../i18n/languages';

export interface LocalizedText {
  /** The text to render. Never empty, never `undefined`/`null`/a raw id. */
  text: string;
  /** The language the text came from, or `null` when nothing was available. */
  languageCode: SupportedLanguage | null;
  /** True when the text is a fallback from a language other than the UI one. */
  isFallback: boolean;
}

/**
 * Normalize a served value plus its language tag into a {@link LocalizedText},
 * deciding fallback status by comparing normalized language tags (so a regional
 * tag such as `de-DE` still counts as the `de` UI language). Shared by the
 * public-library helpers and by any caller that already holds the raw text and
 * its served language (e.g. a project crop's description).
 */
export function buildLocalizedText(
  value: string | null | undefined,
  servedLanguage: string | null | undefined,
  currentLanguage: string,
  fallbackText: string,
): LocalizedText {
  const text = (value ?? '').trim();
  const served = normalizeLanguageTag(servedLanguage);
  if (!text) {
    return { text: fallbackText, languageCode: null, isFallback: false };
  }
  return {
    text,
    languageCode: served,
    // `served === null` means the backend had no translation at all and fell
    // back to a canonical/legacy value; that is a fallback too.
    isFallback: served !== normalizeLanguageTag(currentLanguage),
  };
}

/**
 * Species name of a public entry in the current UI language.
 *
 * @param fallbackText Shown when the entry has no usable name at all, so the
 *   UI renders a readable placeholder rather than an empty cell.
 */
export function getPublicCropName(
  crop: PublicCrop,
  currentLanguage: string,
  fallbackText: string,
): LocalizedText {
  return buildLocalizedText(
    crop.display_name || crop.crop_species_name || crop.name,
    crop.display_language_code,
    currentLanguage,
    fallbackText,
  );
}

/** Public description of an entry in the current UI language. */
export function getPublicCropDescription(
  crop: PublicCrop,
  currentLanguage: string,
): LocalizedText {
  return buildLocalizedText(
    crop.description || crop.notes,
    crop.description_language_code,
    currentLanguage,
    '',
  );
}

/**
 * Full title: localized species name plus the untranslated variety name.
 *
 * Renders as "Tomate (Moneymaker)" in German and "Tomato (Moneymaker)" in
 * English — same variety, same crop, one record.
 */
export function getPublicCropTitle(
  crop: PublicCrop,
  currentLanguage: string,
  fallbackText: string,
): string {
  const { text } = getPublicCropName(crop, currentLanguage, fallbackText);
  return crop.variety ? `${text} (${crop.variety})` : text;
}

/**
 * Tooltip text for the "only available in another language" hint, or `null`
 * when the content really is in the current language.
 */
export function getFallbackNotice(
  localized: LocalizedText,
  t: TFunction,
  displayLanguage: string,
): { label: string; tooltip: string } | null {
  if (!localized.text || !localized.isFallback || !localized.languageCode) {
    return null;
  }
  const languageName = getLanguageDisplayName(localized.languageCode, displayLanguage);
  return {
    label: t('library.translation.fallbackNotice', { language: languageName }),
    tooltip: t('library.translation.fallbackNoticeTooltip', { language: languageName }),
  };
}

/**
 * Same as {@link getFallbackNotice}, but for the description specifically:
 * the tooltip also invites the reader to contribute a translation in their
 * own UI language, since (unlike the species name) the description is
 * something any signed-in user can translate via the edit dialog.
 */
export function getDescriptionFallbackNotice(
  localized: LocalizedText,
  t: TFunction,
  displayLanguage: string,
): { label: string; tooltip: string } | null {
  if (!localized.text || !localized.isFallback || !localized.languageCode) {
    return null;
  }
  const languageName = getLanguageDisplayName(localized.languageCode, displayLanguage);
  const targetLanguageName = getLanguageDisplayName(displayLanguage, displayLanguage);
  return {
    label: t('library.translation.fallbackNotice', { language: languageName }),
    tooltip: t('library.translation.descriptionFallbackNoticeTooltip', {
      language: languageName,
      targetLanguage: targetLanguageName,
    }),
  };
}
