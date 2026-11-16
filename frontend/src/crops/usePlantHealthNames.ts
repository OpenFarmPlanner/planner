import { useEffect, useState } from 'react';
import type { PlantHealthSelection } from '../api/types';
import { plantHealthAPI } from '../crop-library/plant-health/api';
import type { PlantHealthEntry } from '../crop-library/plant-health/types';
import { useTranslation } from '../i18n';

/** Bounded, cancellable identity lookups with ordinary catalogue visibility. */
export function usePlantHealthNames(entries: readonly PlantHealthSelection[], lookupAll = false) {
  const { i18n } = useTranslation('crops');
  const allIdentities = [...new Set(entries.flatMap(entry => entry.catalogue_identity ? [entry.catalogue_identity] : []))];
  const identities = (lookupAll ? allIdentities : allIdentities.slice(0, 40)).sort().join(',');
  const language = i18n?.resolvedLanguage ?? i18n?.language ?? 'de';
  const [attempt, setAttempt] = useState(0);
  const key = `${language}:${identities}:${attempt}`;
  const [result, setResult] = useState<{ key: string; entries: PlantHealthEntry[]; error: boolean }>();
  useEffect(() => {
    if (!identities) return;
    const controller = new AbortController();
    const keys = identities.split(',');
    const batches = Array.from({ length: Math.ceil(keys.length / 40) }, (_unused, index) => keys.slice(index * 40, (index + 1) * 40).join(','));
    let next = 0;
    const found: PlantHealthEntry[] = [];
    void Promise.all(Array.from({ length: Math.min(4, batches.length) }, async () => {
      while (next < batches.length && !controller.signal.aborted) {
        const batch = batches[next++];
        const response = await plantHealthAPI.list({ identities: batch, status: 'published', page_size: 40 }, controller.signal);
        found.push(...response.data.results);
      }
    }))
      .then(() => { if (!controller.signal.aborted) setResult({ key, entries: found, error: false }); })
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
