import { useCallback, useMemo, useReducer } from 'react';
import type { SeedRateUnitConstraints } from '../api/types';
import type { ImportFailedEntry, ImportPreviewResult } from './cropsPageUtils';

type ImportStatus = 'idle' | 'ready' | 'preview_error' | 'applying' | 'finished';

type CropImportResult = {
  outcome: 'complete' | 'partial' | 'unknown';
  error: string | null;
  savedSummary: string;
  details: string;
  failedEntries: ImportFailedEntry[];
  confirmedRows: number[];
  /** The seed-rate rules, to explain a failed row like the crop form would. */
  seedRateConstraints: Partial<SeedRateUnitConstraints> | null;
};

type CropImportState = {
  previewCount: number;
  validCount: number;
  invalidEntries: string[];
  payload: Record<string, unknown>[];
  previewResults: ImportPreviewResult[];
  status: ImportStatus;
  previewError: string | null;
  result: CropImportResult | null;
};

type SetErrorPayload = {
  error: string;
  previewCount?: number;
  validCount?: number;
  invalidEntries?: string[];
};

type SetPreviewReadyPayload = {
  previewCount: number;
  validCount: number;
  invalidEntries: string[];
  payload: Record<string, unknown>[];
  previewResults: ImportPreviewResult[];
};

type ImportAction =
  | { type: 'reset' }
  | { type: 'set_error'; payload: SetErrorPayload }
  | { type: 'set_preview_ready'; payload: SetPreviewReadyPayload }
  | { type: 'start_apply' }
  | { type: 'finish_apply'; payload: CropImportResult };

const INITIAL_IMPORT_STATE: CropImportState = {
  previewCount: 0,
  validCount: 0,
  invalidEntries: [],
  payload: [],
  previewResults: [],
  status: 'idle',
  previewError: null,
  result: null,
};

const cropImportReducer = (state: CropImportState, action: ImportAction): CropImportState => {
  switch (action.type) {
    case 'reset':
      return INITIAL_IMPORT_STATE;
    case 'set_error':
      return {
        ...state,
        status: 'preview_error',
        previewError: action.payload.error,
        result: null,
        previewCount: action.payload.previewCount ?? state.previewCount,
        validCount: action.payload.validCount ?? state.validCount,
        invalidEntries: action.payload.invalidEntries ?? state.invalidEntries,
      };
    case 'set_preview_ready':
      return {
        ...state,
        status: 'ready',
        previewError: null,
        result: null,
        previewCount: action.payload.previewCount,
        validCount: action.payload.validCount,
        invalidEntries: action.payload.invalidEntries,
        payload: action.payload.payload,
        previewResults: action.payload.previewResults,
      };
    case 'start_apply':
      return { ...state, status: 'applying', previewError: null, result: null };
    case 'finish_apply':
      return { ...state, status: 'finished', result: action.payload };
    default:
      return state;
  }
};

export const useCropImportState = () => {
  const [state, dispatch] = useReducer(cropImportReducer, INITIAL_IMPORT_STATE);

  const reset = useCallback(() => {
    dispatch({ type: 'reset' });
  }, []);

  const setErrorState = useCallback((payload: SetErrorPayload) => {
    dispatch({ type: 'set_error', payload });
  }, []);

  const setPreviewReadyState = useCallback((payload: SetPreviewReadyPayload) => {
    dispatch({ type: 'set_preview_ready', payload });
  }, []);

  const startApply = useCallback(() => {
    dispatch({ type: 'start_apply' });
  }, []);

  const finishApply = useCallback((payload: CropImportResult) => {
    dispatch({ type: 'finish_apply', payload });
  }, []);

  const hasImportableEntries = state.status === 'ready' && state.validCount > 0 && state.payload.length > 0;

  return useMemo(() => ({
    state,
    hasImportableEntries,
    reset,
    setErrorState,
    setPreviewReadyState,
    startApply,
    finishApply,
  }), [hasImportableEntries, reset, setErrorState, setPreviewReadyState, startApply, finishApply, state]);
};

export type { CropImportResult, CropImportState, ImportStatus };
