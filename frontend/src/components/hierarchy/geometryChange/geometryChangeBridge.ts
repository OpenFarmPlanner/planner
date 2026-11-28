import axios from 'axios';
import type { AreaInUse, GeometryPreviewRequired } from '../../../api/types';

/**
 * Lets the HTTP client hand a `geometry_preview_required` conflict to the
 * mounted dialog and wait for the user's decision (#1634). Every structure
 * write (List, detail pages, Graphic) reaches the same preview/confirm
 * workflow without its own handling.
 */
export type GeometryChangeHandler = (request: GeometryPreviewRequired) => Promise<boolean>;

let activeHandler: GeometryChangeHandler | null = null;

export function registerGeometryChangeHandler(handler: GeometryChangeHandler): () => void {
  activeHandler = handler;
  return () => {
    if (activeHandler === handler) activeHandler = null;
  };
}

export function geometryPreviewRequest(error: unknown): GeometryPreviewRequired | null {
  if (!axios.isAxiosError(error) || error.response?.status !== 409) return null;
  const data: unknown = error.response.data;
  if (!data || typeof data !== 'object' || (data as { code?: unknown }).code !== 'geometry_preview_required') {
    return null;
  }
  return data as GeometryPreviewRequired;
}

/** Resolves true once the user confirmed the change, false when cancelled or unhandled. */
export async function requestGeometryChange(request: GeometryPreviewRequired): Promise<boolean> {
  return activeHandler ? activeHandler(request) : false;
}

/** Offers retirement for a used area whose deletion was refused (#1634). */
export type AreaRetirementHandler = (request: AreaInUse) => Promise<boolean>;

let retirementHandler: AreaRetirementHandler | null = null;

export function registerAreaRetirementHandler(handler: AreaRetirementHandler): () => void {
  retirementHandler = handler;
  return () => {
    if (retirementHandler === handler) retirementHandler = null;
  };
}

export function areaInUseRequest(error: unknown): AreaInUse | null {
  if (!axios.isAxiosError(error) || error.response?.status !== 409) return null;
  const data: unknown = error.response.data;
  if (!data || typeof data !== 'object' || (data as { code?: unknown }).code !== 'area_in_use') {
    return null;
  }
  return data as AreaInUse;
}

/**
 * For a refused deletion of a used area, offers retirement instead.
 * Returns null for any other error, otherwise whether the area was retired.
 */
export async function retireInsteadOfDelete(error: unknown): Promise<boolean | null> {
  const request = areaInUseRequest(error);
  if (!request) return null;
  return retirementHandler ? retirementHandler(request) : false;
}
