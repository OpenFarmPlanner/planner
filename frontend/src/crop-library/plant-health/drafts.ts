import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../../i18n/languages';
import type { PlantHealthSource, PlantHealthTranslation } from './types';

export type NameDrafts = Record<SupportedLanguage, PlantHealthTranslation>;
export function createNameDrafts(rows: PlantHealthTranslation[]): NameDrafts {
  return Object.fromEntries(SUPPORTED_LANGUAGES.map(({ code }) => [code, {
    language_code: code, preferred_name: '', synonyms: [], regional_names: {}, is_scientific_fallback: false,
    fallback_reason: '', ...rows.find(row => row.language_code === code),
  }])) as NameDrafts;
}
export function sourcePayload(rows: PlantHealthSource[]): PlantHealthSource[] | null {
  const supplied = rows.filter(row => row.url.trim() || row.title?.trim() || row.evidence?.trim());
  if (supplied.some(row => {
    try {
      const parsed = new URL(row.url);
      return !['http:', 'https:'].includes(parsed.protocol) || Boolean(parsed.username || parsed.password);
    } catch { return true; }
  })) return null;
  return supplied.map(row => ({ ...row, url: row.url.trim() }));
}
export function translationPayload(drafts: NameDrafts): PlantHealthTranslation[] | null {
  if (Object.values(drafts).some(row => !row.preferred_name.trim() && (
    row.synonyms?.some(name => name.trim()) || Object.keys(row.regional_names ?? {}).length
    || row.is_scientific_fallback || row.fallback_reason?.trim()
  ))) return null;
  const rows = Object.values(drafts).filter(row => row.preferred_name.trim());
  if (rows.some(row => row.is_scientific_fallback && !row.fallback_reason?.trim())) return null;
  if (rows.some(row => Object.entries(row.regional_names ?? {}).some(([country, name]) => !/^[A-Z]{2}$/.test(country) || !name.trim()))) return null;
  return rows.map(row => ({ ...row, preferred_name: row.preferred_name.trim(),
    synonyms: (row.synonyms ?? []).map(name => name.trim()).filter(Boolean),
  }));
}
