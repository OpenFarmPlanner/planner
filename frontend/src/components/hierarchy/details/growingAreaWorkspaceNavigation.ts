import type { CropDateSelection } from '../../../pages/graphicalCultivation';

export interface GrowingAreaListPosition {
  rowId: string | number | null;
  top: number;
  left?: number;
  firstRowIndex?: number;
  layout: 'grid' | 'mobile';
}

export type GrowingAreaWorkspacePosition =
  | { view: 'list'; position: GrowingAreaListPosition }
  | { view: 'graphic'; cropDate: CropDateSelection | null };

interface GrowingAreaDetailOrigin {
  projectId: number | null;
  view: GrowingAreaWorkspacePosition['view'];
  steps: number;
}

const storageKey = (projectId: number) => `growingAreaDetailOrigin.${projectId}`;

/** The workspace entry stays in browser history while related details are opened. */
export function beginGrowingAreaDetail(projectId: number | null, key: string, workspace: GrowingAreaWorkspacePosition) {
  if (projectId !== null) {
    try { sessionStorage.setItem(storageKey(projectId), JSON.stringify({ key, workspace })); }
    catch { /* Storage may be disabled. */ }
  }
  return relatedGrowingAreaDetail({ projectId, view: workspace.view, steps: 0 });
}

export function relatedGrowingAreaDetail(origin: GrowingAreaDetailOrigin | null) {
  return origin ? { growingAreaDetailOrigin: { ...origin, steps: origin.steps + 1 } } : undefined;
}

export function getGrowingAreaDetailOrigin(state: unknown, projectId: number | null): GrowingAreaDetailOrigin | null {
  const origin = (state as { growingAreaDetailOrigin?: GrowingAreaDetailOrigin } | null)?.growingAreaDetailOrigin;
  return origin && origin.projectId === projectId && (origin.view === 'list' || origin.view === 'graphic')
    && Number.isSafeInteger(origin.steps) && origin.steps > 0 ? origin : null;
}

export function getGrowingAreaWorkspacePosition(projectId: number | null, key: string): GrowingAreaWorkspacePosition | null {
  if (projectId === null) return null;
  try {
    const stored = JSON.parse(sessionStorage.getItem(storageKey(projectId)) ?? 'null') as
      { key: string; workspace: GrowingAreaWorkspacePosition } | null;
    return stored?.key === key ? stored.workspace : null;
  } catch {
    return null;
  }
}
