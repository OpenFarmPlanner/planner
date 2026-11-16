import http from '../../api/httpClient';
import type { PaginatedResponse } from '../../api/types';
import type { PlantHealthEntry, PlantHealthEntryWrite, PlantHealthHost, PlantHealthHostWrite, PlantHealthRevision } from './types';

const entries = '/plant-health/entries/';
const hosts = '/plant-health/hosts/';
export const plantHealthAPI = {
  list: (params: { q?: string; identities?: string; status?: string; include_proposed?: boolean; page?: number; page_size?: number }, signal?: AbortSignal) =>
    http.get<PaginatedResponse<PlantHealthEntry>>(entries, { params, signal }),
  create: (payload: PlantHealthEntryWrite) => http.post<PlantHealthEntry>(entries, payload),
  update: (id: number, payload: PlantHealthEntryWrite) => http.patch<PlantHealthEntry>(`${entries}${id}/`, payload),
  approve: (id: number, payload: PlantHealthEntryWrite) => http.post<PlantHealthEntry>(`${entries}${id}/approve/`, payload),
  review: (id: number, action: 'reject' | 'archive' | 'reopen', review_note: string) =>
    http.post<PlantHealthEntry>(`${entries}${id}/${action}/`, { review_note }),
  history: (id: number) => http.get<PlantHealthRevision[]>(`${entries}${id}/history/`),
  saveHost: (payload: PlantHealthHostWrite, id?: number) => id === undefined
    ? http.post<PlantHealthHost>(hosts, payload)
    : http.patch<PlantHealthHost>(`${hosts}${id}/`, payload),
  archiveHost: (id: number) => http.post<PlantHealthHost>(`${hosts}${id}/archive/`),
};
