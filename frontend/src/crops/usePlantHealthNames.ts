import { useEffect, useState } from 'react';
import type { PlantHealthSelection } from '../api/types';
import { plantHealthAPI } from '../crop-library/plant-health/api';
import type { PlantHealthEntry } from '../crop-library/plant-health/types';
import { useTranslation } from '../i18n';

/** One bounded lookup for translated selected identities, with ordinary catalogue visibility. */
export function usePlantHealthNames(entries: readonly PlantHealthSelection[]) {
  const { i18n } = useTranslation('crops');
  const identities = [...new Set(entries.flatMap(entry => entry.catalogue_identity ? [entry.catalogue_identity] : []))].slice(0, 40).sort().join(',');
  const language = i18n?.resolvedLanguage ?? i18n?.language ?? 'de';
  const [attempt, setAttempt] = useState(0);
  const key = `${language}:${identities}:${attempt}`;
  const [result, setResult] = useState<{ key: string; entries: PlantHealthEntry[]; error: boolean }>();
  useEffect(() => {
    if (!identities) return;
    const controller = new AbortController();
    void plantHealthAPI.list({ identities, status: 'published', page_size: 40 }, controller.signal)
      .then(response => { if (!controller.signal.aborted) setResult({ key, entries: response.data.results, error: false }); })
      .catch(() => { if (!controller.signal.aborted) setResult({ key, entries: [], error: true }); });
    return () => controller.abort();
  }, [identities, key]);
  const current = result?.key === key ? result : undefined;
  return {
    catalogue: new Map((current?.entries ?? []).map(entry => [entry.identity_key, entry])),
    loading: Boolean(identities) && !current,
    error: current?.error ?? false,
    retry: () => setAttempt(value => value + 1),
  };
}
