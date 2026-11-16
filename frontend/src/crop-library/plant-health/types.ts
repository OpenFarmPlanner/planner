import type { SupportedLanguage } from '../../i18n/languages';

export type PlantHealthKind = 'pest' | 'pathogen' | 'disease' | 'group';
export type PlantHealthStatus = 'proposed' | 'published' | 'rejected' | 'archived';
export interface PlantHealthSource { url: string; title?: string; evidence?: string }
export interface PlantHealthTranslation {
  language_code: SupportedLanguage;
  preferred_name: string;
  synonyms?: string[];
  regional_names?: Record<string, string>;
  is_scientific_fallback?: boolean;
  fallback_reason?: string;
}
export interface PlantHealthHost {
  id: number;
  entry: number;
  species: number;
  species_name: string;
  species_status?: string;
  variety_name: string;
  qualification: string;
  sources: PlantHealthSource[];
  is_confirmed: boolean;
  is_active: boolean;
}
export interface PlantHealthEntry {
  id: number;
  identity_key: string;
  name: string;
  scientific_name: string;
  kind: PlantHealthKind;
  eppo_code: string;
  sources: PlantHealthSource[];
  status: PlantHealthStatus;
  reviewed_at: string | null;
  review_note: string;
  translations: PlantHealthTranslation[];
  display_name: string;
  display_language_code: string;
  has_specific_identity: boolean;
  hosts: PlantHealthHost[];
}
export type PlantHealthEntryWrite = Pick<PlantHealthEntry,
  'name' | 'scientific_name' | 'kind' | 'eppo_code' | 'sources' | 'translations'>;
export type PlantHealthHostWrite = Pick<PlantHealthHost,
  'entry' | 'species' | 'variety_name' | 'qualification' | 'sources' | 'is_confirmed'>;
export interface PlantHealthRevision {
  id: number;
  actor_label: string;
  actor_anonymous_number: number | null;
  action: string;
  created_at: string;
  snapshot: PlantHealthEntryWrite & { status: PlantHealthStatus; review_note: string; hosts: PlantHealthHost[] };
}
