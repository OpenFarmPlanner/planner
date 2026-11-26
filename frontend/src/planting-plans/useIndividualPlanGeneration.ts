import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { IndividualPlanGenerationRequest, type GenerationInput, type GenerationResult } from './IndividualPlanGenerationRequest';

/** Await explicit preview confirmation in the grid's existing row save gate. */
export function useIndividualPlanGeneration(scopeKey: string) {
  const pending = useRef<{ scopeKey: string; finish: (result: GenerationResult) => void } | null>(null);
  const [request, setRequest] = useState<{ scopeKey: string; input: GenerationInput } | null>(null);
  const complete = useCallback((result: GenerationResult) => {
    const current = pending.current;
    if (!current || current.scopeKey !== scopeKey) return;
    pending.current = null;
    setRequest(null);
    current.finish(result);
  }, [scopeKey]);
  useEffect(() => () => {
    if (pending.current?.scopeKey !== scopeKey) return;
    const current = pending.current;
    pending.current = null;
    current.finish(null);
  }, [scopeKey]);

  const confirmGeneration = useCallback((input: GenerationInput): Promise<GenerationResult> => {
    if (pending.current) return Promise.resolve(null);
    return new Promise(finish => {
      pending.current = { scopeKey, finish };
      setRequest({ scopeKey, input });
    });
  }, [scopeKey]);

  const dialog = request?.scopeKey === scopeKey ? createElement(IndividualPlanGenerationRequest, { input: request.input, onComplete: complete }) : null;
  return { confirmGeneration, dialog };
}
