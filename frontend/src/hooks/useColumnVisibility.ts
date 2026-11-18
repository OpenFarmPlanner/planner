import { useCallback, useMemo, useState } from 'react';
import type { GridColumnVisibilityModel } from '@mui/x-data-grid';

const COLUMN_VISIBILITY_PREFIX = 'tableColumns.';

function loadFromStorage(key: string): GridColumnVisibilityModel | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    const obj = parsed as Record<string, unknown>;

    // Legacy format from the old Autofit-based implementation: { autofit, model }.
    if ('model' in obj && obj.model !== null && typeof obj.model === 'object') {
      return obj.model as GridColumnVisibilityModel;
    }

    // Plain visibility model object (current format).
    return obj as GridColumnVisibilityModel;
  } catch { /* ignore malformed data */ }
  return null;
}

function saveToStorage(key: string, model: GridColumnVisibilityModel): void {
  localStorage.setItem(key, JSON.stringify(model));
}

export interface UseColumnVisibilityOptions {
  tableKey: string;
  /**
   * Fields hidden by default while the screen is small (`isSmallScreen`) and
   * the user hasn't made an explicit choice yet. Once the user changes
   * visibility, their saved choice always wins and is no longer affected by
   * screen size.
   */
  defaultHiddenFieldsOnSmallScreen?: string[];
  isSmallScreen?: boolean;
  /**
   * Optional columns hidden on every screen size until the user shows them.
   * Unlike the small-screen defaults these stay hidden under a saved model
   * that predates them (it has no entry for them yet).
   */
  defaultHiddenFields?: readonly string[];
}

const NO_FIELDS: readonly string[] = [];

export function useColumnVisibility({
  tableKey,
  defaultHiddenFieldsOnSmallScreen = [],
  isSmallScreen = false,
  defaultHiddenFields = NO_FIELDS,
}: UseColumnVisibilityOptions): {
  columnVisibilityModel: GridColumnVisibilityModel;
  /** Call this whenever the user changes visibility (native panel, column menu, ...). */
  setColumnVisibilityModel: (model: GridColumnVisibilityModel) => void;
} {
  const storageKey = `${COLUMN_VISIBILITY_PREFIX}${tableKey}`;

  const [savedModel, setSavedModel] = useState<GridColumnVisibilityModel | null>(
    () => loadFromStorage(storageKey),
  );

  const setColumnVisibilityModel = useCallback(
    (model: GridColumnVisibilityModel) => {
      setSavedModel(model);
      saveToStorage(storageKey, model);
    },
    [storageKey],
  );

  const defaultModel = useMemo<GridColumnVisibilityModel>(() => {
    if (!isSmallScreen || defaultHiddenFieldsOnSmallScreen.length === 0) return {};
    return Object.fromEntries(defaultHiddenFieldsOnSmallScreen.map((field) => [field, false]));
  }, [isSmallScreen, defaultHiddenFieldsOnSmallScreen]);

  const columnVisibilityModel = useMemo<GridColumnVisibilityModel>(() => {
    const base = savedModel ?? defaultModel;
    if (defaultHiddenFields.length === 0) return base;
    return {
      ...Object.fromEntries(defaultHiddenFields.map((field) => [field, false])),
      ...base,
    };
  }, [defaultHiddenFields, defaultModel, savedModel]);

  return {
    columnVisibilityModel,
    setColumnVisibilityModel,
  };
}
