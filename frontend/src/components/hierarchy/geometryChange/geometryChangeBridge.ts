import axios from 'axios';
import type { GeometryPreviewRequired } from '../../../api/types';

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
