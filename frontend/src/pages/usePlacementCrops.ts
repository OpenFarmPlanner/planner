import { useEffect, useState } from 'react';
import { cropAPI } from '../api/api';
import type { Crop } from '../api/types';

export function usePlacementCrops(source: 'all' | number | null) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    source: 'all' | number; attempt: number; crops: Crop[] | null;
  } | null>(null);
  useEffect(() => {
    if (source === null) return;
    const request = new AbortController();
    const load = source === 'all'
      ? cropAPI.listAll(request.signal).then(({ results }) => results.filter(crop => crop.id != null))
      : cropAPI.get(source).then(({ data }) => [data]);
    void load.then(crops => {
      if (!request.signal.aborted) setResult({ source, attempt, crops });
    }).catch(() => {
      if (!request.signal.aborted) setResult({ source, attempt, crops: null });
    });
    return () => request.abort();
  }, [source, attempt]);
  const current = result?.source === source && result.attempt === attempt ? result : null;
  return {
    crops: current?.crops ?? null,
    failed: current?.crops === null,
    loading: source !== null && current === null,
    retry: () => setAttempt(value => value + 1),
  };
}
