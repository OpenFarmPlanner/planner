import { useCallback, useMemo, useReducer } from 'react';
import type { ImportFailedEntry, ImportPreviewResult } from './cropsPageUtils';

type ImportStatus = 'idle' | 'ready' | 'uploading' | 'success' | 'error';

type CropImportState = {
  previewCount: number;
  validCount: number;
  invalidEntries: string[];
  payload: Record<string, unknown>[];
  previewResults: ImportPreviewResult[];
  status: ImportStatus;
  error: string | null;
  success: string | null;
  failedEntries: ImportFailedEntry[];
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

type SetPartialFailurePayload = {
  error: string;
  failedEntries: ImportFailedEntry[];
  /** What did go through ("21 neue Kulturen erstellt"), if anything. */
  summary?: string;
};

type ImportAction =
  | { type: 'reset' }
  | { type: 'set_error'; payload: SetErrorPayload }
  | { type: 'set_preview_ready'; payload: SetPreviewReadyPayload }
  | { type: 'set_uploading' }
  | { type: 'set_partial_failure'; payload: SetPartialFailurePayload }
  | { type: 'set_success'; payload: { message: string } };

const INITIAL_IMPORT_STATE: CropImportState = {
  previewCount: 0,
  validCount: 0,
  invalidEntries: [],
  payload: [],
  previewResults: [],
  status: 'idle',
  error: null,
  success: null,
  failedEntries: [],
};

const cropImportReducer = (state: CropImportState, action: ImportAction): CropImportState => {
  switch (action.type) {
    case 'reset':
      return INITIAL_IMPORT_STATE;
    case 'set_error':
      return {
        ...state,
        status: 'error',
        error: action.payload.error,
        success: null,
        failedEntries: [],
        previewCount: action.payload.previewCount ?? state.previewCount,
        validCount: action.payload.validCount ?? state.validCount,
        invalidEntries: action.payload.invalidEntries ?? state.invalidEntries,
      };
    case 'set_preview_ready':
      return {
        ...state,
        status: 'ready',
        error: null,
        success: null,
        failedEntries: [],
        previewCount: action.payload.previewCount,
        validCount: action.payload.validCount,
        invalidEntries: action.payload.invalidEntries,
        payload: action.payload.payload,
        previewResults: action.payload.previewResults,
      };
    case 'set_uploading':
      return {
        ...state,
        status: 'uploading',
        error: null,
        success: null,
        failedEntries: [],
      };
    case 'set_partial_failure':
      return {
        ...state,
        status: 'error',
        error: action.payload.error,
        success: action.payload.summary || null,
        failedEntries: action.payload.failedEntries,
      };
    case 'set_success':
      return {
        ...state,
        status: 'success',
        success: action.payload.message,
        error: null,
        failedEntries: [],
      };
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

  const setUploading = useCallback(() => {
    dispatch({ type: 'set_uploading' });
  }, []);

  const setPartialFailure = useCallback((payload: SetPartialFailurePayload) => {
    dispatch({ type: 'set_partial_failure', payload });
  }, []);

  const setSuccessState = useCallback((message: string) => {
    dispatch({ type: 'set_success', payload: { message } });
  }, []);

  const hasImportableEntries = state.validCount > 0 && state.payload.length > 0;

  return useMemo(() => ({
    state,
    hasImportableEntries,
    reset,
    setErrorState,
    setPreviewReadyState,
    setUploading,
    setPartialFailure,
    setSuccessState,
  }), [hasImportableEntries, reset, setErrorState, setPartialFailure, setPreviewReadyState, setSuccessState, setUploading, state]);
};

export type { CropImportState, ImportStatus };
