import http from './httpClient';
import type {
  ApiToken,
  ApiTokenCreatePayload,
  ApiTokenCreated,
  AppNotification,
  NotificationListResponse,
  Crop,
  CropDeletePreview,
  Location,
  Field,
  Bed,
  PlantingPlan,
  PaginatedResponse,
  Supplier,
  SeedDemand,
  YieldCalendarWeek,
  NoteAttachment,
  CropHistoryEntry,
  CropDuplicateCheckResponse,
  CropPublicUpdate,
  SeedRateConstraintsResponse,
  ImportPublicCropResponse,
  MediaFileRef,
  PublicCrop,
  PublicCropChangeProposal,
  PublicCropDiscussionComment,
  PublicCropDiscussionTopic,
  PublicCropMatchResponse,
  PublicCropRemovalReason,
  PublicCropRevision,
  PublicCropDuplicateCandidate,
  PublicCropTranslations,
  CropSpecies,
  CropSpeciesTranslation,
  PublicLibraryModeratorRequest,
  PublicLibraryModeratorRequestMine,
  PublishPublicCropPreview,
  PublishPublicCropResponse,
  RemainingAreaResponse,
  BedLayoutEntry,
  FieldLayoutEntry,
  LocationLayoutsResponse,
  CropSupplierData,
  SupplierDeleteResponse,
  SupplierDeleteUsage,
  SupplierDeleteUndoPayload,
  SupplierRestoreUnlinkedDeleteResponse,
  SupplierUnlinkDeleteResponse,
  Season,
  SeasonPattern,
  SeasonPatternPreviewResponse,
  SeasonCreationOptions,
  SeasonCreateTransitionResponse,
  SeasonDueSuggestion,
  SeasonCopyFromResponse,
  SeasonSetupStatus,
  SeasonSetupApplyResponse,
} from './types';

export async function fetchAllPaginated<T>(
  initialPath: string,
): Promise<PaginatedResponse<T>> {
  const results: T[] = [];
  const initialSeparator = initialPath.includes('?') ? '&' : '?';
  let nextPath: string | null = `${initialPath}${initialSeparator}page_size=1000`;
  let count = 0;

  while (nextPath) {
    const response: { data: PaginatedResponse<T> } = await http.get<
      PaginatedResponse<T>
    >(nextPath);
    results.push(...response.data.results);
    count = response.data.count;
    // DRF returns an absolute URL for `next`, built from the backend's own host.
    // Following it directly would bypass the frontend's dev proxy (and drop
    // same-origin cookies), so only the query string is reused against the
    // original relative path.
    const next = response.data.next;
    nextPath = next ? `${initialPath}?${new URL(next, window.location.origin).searchParams.toString()}` : null;
  }

  return {
    count,
    next: null,
    previous: null,
    results,
  };
}

const getActiveProjectId = (): number | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  const rawValue = window.localStorage.getItem('activeProjectId');
  if (!rawValue) {
    return null;
  }
  const parsedValue = Number(rawValue);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : null;
};

const withActiveProject = <T extends object>(data: T): T | (T & { project: number }) => {
  const payload = data as T & { project?: unknown };
  if (typeof payload.project === 'number' && payload.project > 0) {
    return data;
  }
  const activeProjectId = getActiveProjectId();
  if (!activeProjectId) {
    return data;
  }
  return { ...data, project: activeProjectId };
};

export const cropAPI = {
  list: (url = '/crops/') => http.get<PaginatedResponse<Crop>>(url),
  listAll: () => fetchAllPaginated<Crop>('/crops/'),
  get: (id: number) => http.get<Crop>(`/crops/${id}/`),
  duplicateCheck: (params: { name: string; variety: string; exclude_id?: number }, signal?: AbortSignal) =>
    http.get<CropDuplicateCheckResponse>('/crops/duplicate-check/', { params, signal }),
  seedRateConstraints: () => http.get<SeedRateConstraintsResponse>('/crops/seed-rate-constraints/'),
  create: (data: Crop) => http.post<Crop>('/crops/', withActiveProject(data)),
  update: (id: number, data: Crop) => http.put<Crop>(`/crops/${id}/`, withActiveProject(data)),
  deletePreview: (id: number) => http.get<CropDeletePreview>(`/crops/${id}/delete-preview/`),
  delete: (id: number) => http.delete(`/crops/${id}/`),
  history: (id: number) => http.get<CropHistoryEntry[]>(`/crops/${id}/history/`),
  restore: (id: number, history_id: number) => http.post<Crop>(`/crops/${id}/restore/`, { history_id }),
  undelete: (id: number) => http.post<Crop>(`/crops/${id}/undelete/`, {}),
  globalHistory: () => http.get<CropHistoryEntry[]>('/history/global/'),
  globalRestore: (history_id: number) => http.post<Crop>('/history/global/restore/', { history_id }),
  projectHistory: () => http.get<CropHistoryEntry[]>('/history/project/'),
  projectRestore: (history_id: number) => http.post<{ detail: string }>('/history/project/restore/', { history_id }),
  revertBatch: (batch_id: number) => http.post<{ detail: string }>(`/history/batch/${batch_id}/revert/`, {}),
  // Legacy import flow split into preview/apply endpoints.
  importPreview: (data: Record<string, unknown>[]) => http.post<{
    results: Array<{
      index: number;
      status: 'create' | 'update_candidate';
      matched_crop_id?: number;
      diff?: Array<{ field: string; current: unknown; new: unknown }>;
      import_data: Record<string, unknown>;
      error?: string;
    }>;
  }>('/crops/import/preview/', data),
  importApply: (data: {
    items: Record<string, unknown>[];
    confirm_updates: boolean;
  }) => http.post<{
    created_count: number;
    updated_count: number;
    skipped_count: number;
    errors: Array<{ index: number; error: unknown }>;
  }>('/crops/import/apply/', data),
  publishPreview: (id: number, params: { crop_species_id?: number | null; original_language_code?: string; publish_as_general?: boolean }) =>
    http.get<PublishPublicCropPreview>(`/crops/${id}/publish-public/preview/`, { params }),
  publishPublic: (id: number, data: { accepted_public_library_terms: boolean; crop_species_id?: number | null; original_language_code?: string; publish_as_general?: boolean }) =>
    http.post<PublishPublicCropResponse>(`/crops/${id}/publish-public/`, data),
  linkPublicCrop: (id: number, publicCropId: number) =>
    http.post<Crop>(`/crops/${id}/link-public-crop/`, { public_crop_id: publicCropId }),
  // Read-only preview of the pending library update; applying it goes through
  // publicCropAPI.importToProject(publicCropId, 'update').
  publicUpdate: (id: number) => http.get<CropPublicUpdate>(`/crops/${id}/public-update/`),
  // Records the explicit "do not take this version" decision. Nothing is copied;
  // only the notice for exactly this public version disappears.
  rejectPublicUpdate: (id: number) => http.post<Crop>(`/crops/${id}/public-update/reject/`),
};

export const notificationAPI = {
  /**
   * Newest first; the unread count rides along so the bell needs one request.
   * `is_read` narrows the rows (the dropdowns ask for unread only) while the
   * count stays account-wide; the history page pages through the same endpoint
   * unfiltered.
   */
  list: (params?: { page?: number; page_size?: number; is_read?: boolean }) =>
    http.get<NotificationListResponse>('/notifications/', { params }),
  markRead: (id: number) => http.post<AppNotification>(`/notifications/${id}/read/`),
};

export const cropSpeciesAPI = {
  list: (params?: { q?: string; include_proposed?: boolean; status?: CropSpecies['status']; page_size?: number }) =>
    http.get<PaginatedResponse<CropSpecies>>('/crop-species/', { params }),
  propose: (name: string, languageCode?: string) => http.post<CropSpecies>('/crop-species/', {
    name,
    ...(languageCode ? { translations: [{ language_code: languageCode, common_name: name }] } : {}),
  }),
  approve: (id: number, reviewNote = '', translations?: CropSpeciesTranslation[]) => http.post<CropSpecies>(
    `/crop-species/${id}/approve/`,
    { review_note: reviewNote, ...(translations ? { translations } : {}) },
  ),
  reject: (id: number, reviewNote = '') => http.post<CropSpecies>(`/crop-species/${id}/reject/`, { review_note: reviewNote }),
  // Moderator-only: search aliases are curated here, so a regional name never
  // has to become a second crop species.
  updateTranslations: (id: number, translations: CropSpeciesTranslation[]) =>
    http.patch<CropSpecies>(`/crop-species/${id}/`, { translations }),
};

export const publicLibraryModeratorRequestAPI = {
  mine: () => http.get<PublicLibraryModeratorRequestMine>('/public-library/moderator-requests/mine/'),
  create: (motivation: string) => http.post<PublicLibraryModeratorRequest>('/public-library/moderator-requests/', { motivation }),
  list: (params?: { status?: PublicLibraryModeratorRequest['status']; page_size?: number }) =>
    http.get<PaginatedResponse<PublicLibraryModeratorRequest>>('/public-library/moderator-requests/', { params }),
  approve: (id: number, reviewNote = '') =>
    http.post<PublicLibraryModeratorRequest>(`/public-library/moderator-requests/${id}/approve/`, { review_note: reviewNote }),
  reject: (id: number, reviewNote = '') =>
    http.post<PublicLibraryModeratorRequest>(`/public-library/moderator-requests/${id}/reject/`, { review_note: reviewNote }),
};


export const publicCropAPI = {
  list: (params?: { q?: string; name?: string; variety?: string; crop_species?: number; status?: 'removed'; page_size?: number }, signal?: AbortSignal) =>
    http.get<PaginatedResponse<PublicCrop>>('/public-crops/', { params, signal }),
  listAll: () => fetchAllPaginated<PublicCrop>('/public-crops/'),
  get: (id: number) => http.get<PublicCrop>(`/public-crops/${id}/`),
  update: (id: number, data: Partial<PublicCrop> & { base_version?: number }) =>
    http.patch<PublicCrop>(`/public-crops/${id}/`, data),
  match: (params: { name: string; variety: string }, signal?: AbortSignal) =>
    http.get<PublicCropMatchResponse>('/public-crops/match/', { params, signal }),
  importToProject: (id: number, mode?: 'update' | 'new') =>
    http.post<ImportPublicCropResponse>(`/public-crops/${id}/import/`, mode ? { mode } : {}),
  // Contributors remove their own entry without a reason; moderators removing
  // somebody else's entry must supply a structured moderation reason.
  remove: (id: number, reason?: PublicCropRemovalReason) =>
    http.post<PublicCrop>(`/public-crops/${id}/remove/`, reason ? { reason } : {}),
  // Moderator-only undo for a moderator removal; no time limit (see
  // reinstate_removed_public_crop on the backend for why a contributor
  // can't just republish their way past a moderation decision).
  restore: (id: number) => http.post<PublicCrop>(`/public-crops/${id}/restore/`, {}),
  hardDelete: (id: number) => http.post<void>(`/public-crops/${id}/hard-delete/`, {}),
  discussionTopics: (id: number) => http.get<PublicCropDiscussionTopic[]>(`/public-crops/${id}/discussion-topics/`),
  createDiscussionTopic: (id: number, data: { title: string; body: string; revision?: number }) =>
    http.post<PublicCropDiscussionTopic>(`/public-crops/${id}/discussion-topics/`, data),
  discussionComments: (id: number, topicId: number) =>
    http.get<PublicCropDiscussionComment[]>(`/public-crops/${id}/discussion-topics/${topicId}/comments/`),
  createDiscussionComment: (id: number, topicId: number, body: string, parent?: number) =>
    http.post<PublicCropDiscussionComment>(`/public-crops/${id}/discussion-topics/${topicId}/comments/`, { body, parent }),
  updateDiscussionComment: (id: number, commentId: number, body: string) =>
    http.patch<PublicCropDiscussionComment>(`/public-crops/${id}/discussion-comments/${commentId}/`, { body }),
  deleteDiscussionComment: (id: number, commentId: number) =>
    http.delete(`/public-crops/${id}/discussion-comments/${commentId}/`),
  versions: (id: number) => http.get<PublicCropRevision[]>(`/public-crops/${id}/versions/`),
  revert: (id: number, data: { version: number; base_version?: number }) =>
    http.post<PublicCrop>(`/public-crops/${id}/revert/`, data),
  getTranslations: (id: number) =>
    http.get<PublicCropTranslations>(`/public-crops/${id}/translations/`),
  updateTranslations: (id: number, translations: Record<string, string>) =>
    http.put<PublicCropTranslations>(`/public-crops/${id}/translations/`, { translations }),
  changeProposals: (id: number) => http.get<PublicCropChangeProposal[]>(`/public-crops/${id}/change-proposals/`),
  createChangeProposal: (id: number, data: { summary: string; proposed_data: Partial<PublicCrop> }) =>
    http.post<PublicCropChangeProposal>(`/public-crops/${id}/change-proposals/`, data),
  approveChangeProposal: (id: number, proposalId: number, reviewNote = '') =>
    http.post<PublicCropChangeProposal>(`/public-crops/${id}/change-proposals/${proposalId}/approve/`, { review_note: reviewNote }),
  rejectChangeProposal: (id: number, proposalId: number, reviewNote = '') =>
    http.post<PublicCropChangeProposal>(`/public-crops/${id}/change-proposals/${proposalId}/reject/`, { review_note: reviewNote }),
};

export const supplierAPI = {
  list: (query?: string) => {
    const params = query ? { q: query } : {};
    return http.get<PaginatedResponse<Supplier>>('/suppliers/', { params });
  },
  get: (id: number) => http.get<Supplier>(`/suppliers/${id}/`),
  create: (name: string, homepage_url: string, allowed_domains: string[] = []) => http.post<Supplier>('/suppliers/', { name, homepage_url, allowed_domains }),
  update: (id: number, data: Partial<Supplier>) => http.put<Supplier>(`/suppliers/${id}/`, data),
  deleteUsage: (id: number) => http.get<SupplierDeleteUsage>(`/suppliers/${id}/delete-usage/`),
  unlinkAndDelete: (id: number) => http.post<SupplierUnlinkDeleteResponse>(`/suppliers/${id}/unlink-and-delete/`, {}),
  restoreUnlinkedDelete: (undoPayload: SupplierDeleteUndoPayload) =>
    http.post<SupplierRestoreUnlinkedDeleteResponse>('/suppliers/restore-unlinked-delete/', undoPayload),
  delete: (id: number) => http.delete<SupplierDeleteResponse>(`/suppliers/${id}/`),
};

export const cropSupplierDataAPI = {
  list: () => http.get<PaginatedResponse<CropSupplierData>>('/crop-supplier-data/'),
  create: (data: CropSupplierData) => http.post<CropSupplierData>('/crop-supplier-data/', withActiveProject(data)),
  update: (id: number, data: CropSupplierData) => http.put<CropSupplierData>(`/crop-supplier-data/${id}/`, withActiveProject(data)),
  delete: (id: number) => http.delete(`/crop-supplier-data/${id}/`),
};

export const bedAPI = {
  list: () => http.get<PaginatedResponse<Bed>>('/beds/'),
  listAll: () => fetchAllPaginated<Bed>('/beds/'),
  get: (id: number) => http.get<Bed>(`/beds/${id}/`),
  create: (data: Bed) => http.post<Bed>('/beds/', withActiveProject(data)),
  update: (id: number, data: Bed) => http.put<Bed>(`/beds/${id}/`, withActiveProject(data)),
  delete: (id: number) => http.delete(`/beds/${id}/`),
};

export const plantingPlanAPI = {
  list: () => http.get<PaginatedResponse<PlantingPlan>>('/planting-plans/'),
  listAll: () => fetchAllPaginated<PlantingPlan>('/planting-plans/'),
  get: (id: number) => http.get<PlantingPlan>(`/planting-plans/${id}/`),
  create: (data: PlantingPlan) => http.post<PlantingPlan>('/planting-plans/', withActiveProject(data)),
  update: (id: number, data: PlantingPlan) => http.put<PlantingPlan>(`/planting-plans/${id}/`, withActiveProject(data)),
  patch: (id: number, data: Partial<PlantingPlan>) => http.patch<PlantingPlan>(`/planting-plans/${id}/`, withActiveProject(data)),
  delete: (id: number) => http.delete(`/planting-plans/${id}/`),
  remainingArea: (params: { bed_id: number; start_date: string; end_date: string; exclude_plan_id?: number }) =>
    http.get<RemainingAreaResponse>('/planting-plans/remaining-area/', { params }),
};



export const seasonAPI = {
  list: () => http.get<PaginatedResponse<Season>>('/seasons/', { params: { page_size: 1000 } }),
  create: (data: { start_date: string; end_date: string; custom_label?: string }) =>
    http.post<Season>('/seasons/', data),
  update: (id: number, data: Partial<{ custom_label: string; start_date: string; end_date: string }>) =>
    http.patch<Season>(`/seasons/${id}/`, data),
  delete: (id: number) => http.delete(`/seasons/${id}/`),
  undelete: (id: number) => http.post<Season>(`/seasons/${id}/undelete/`, {}),
  copyFrom: (targetId: number, sourceSeasonId: number) =>
    http.post<SeasonCopyFromResponse>(`/seasons/${targetId}/copy-from/`, { source_season_id: sourceSeasonId }),
  dueSuggestion: () => http.get<SeasonDueSuggestion>('/seasons/due-suggestion/'),
  creationOptions: (params?: { manual_start_date?: string }) =>
    http.get<SeasonCreationOptions>('/seasons/creation-options/', { params }),
  createTransition: (data: { copy: boolean }) =>
    http.post<SeasonCreateTransitionResponse>('/seasons/create-transition/', data),
};

export const seasonPatternAPI = {
  get: () => http.get<SeasonPattern>('/season-pattern/'),
  update: (data: { start_day: number; start_month: number }) =>
    http.patch<SeasonPattern>('/season-pattern/', data),
  preview: (params?: { start_day?: number; start_month?: number }) =>
    http.get<SeasonPatternPreviewResponse>('/season-pattern/preview/', { params }),
};

export const seasonSetupAPI = {
  status: (params?: { start_day?: number; start_month?: number }) =>
    http.get<SeasonSetupStatus>('/season-setup/status/', { params }),
  apply: (data: { start_day: number; start_month: number }) =>
    http.post<SeasonSetupApplyResponse>('/season-setup/apply/', data),
};

export const layoutAPI = {
  listByLocation: (locationId: number) => http.get<LocationLayoutsResponse>(`/locations/${locationId}/layouts/`),
  saveByLocation: (locationId: number, payload: { bed_layouts: BedLayoutEntry[]; field_layouts: FieldLayoutEntry[] }) =>
    http.put<LocationLayoutsResponse>(`/locations/${locationId}/layouts/`, payload),
};


export const mediaFileAPI = {
  upload: (file: File) => {
    const formData = new FormData();
    formData.append('file', file, file.name || 'crop-media');
    return http.post<MediaFileRef>('/media-files/upload/', formData);
  },
};

export const noteAttachmentAPI = {
  list: (noteId: number) => http.get<NoteAttachment[]>(`/notes/${noteId}/attachments/`),
  upload: (noteId: number, file: File, caption = '', onUploadProgress?: (progress: number) => void) => {
    const formData = new FormData();
    formData.append('image', file, file.name || 'note-attachment');
    formData.append('caption', caption);
    return http.post<NoteAttachment>(`/notes/${noteId}/attachments/`, formData, {
      onUploadProgress: (event) => {
        if (!onUploadProgress || !event.total) return;
        onUploadProgress(Math.round((event.loaded / event.total) * 100));
      },
    });
  },
  delete: (attachmentId: number) => http.delete(`/attachments/${attachmentId}/`),
};

export const seedDemandAPI = {
  list: (supplierSelection?: string) => http.get<PaginatedResponse<SeedDemand>>('/seed-demand/', {
    params: supplierSelection ? { supplier_selection: supplierSelection } : {},
  }),
  saveSupplierSelection: (cropId: number, supplierId: number | null) =>
    http.post<{ crop_id: number; selected_supplier_id: number | null }>('/seed-demand/', {
      crop_id: cropId,
      supplier_id: supplierId,
    }),
};

export const yieldCalendarAPI = {
  // No year: the endpoint scopes to the active season (via the X-Season-Id
  // header) and returns every ISO year that season spans. An explicit year is
  // still accepted for direct API callers.
  list: (year?: number) =>
    http.get<YieldCalendarWeek[]>('/yield-calendar/', {
      params: year === undefined ? {} : { year },
    }),
};

export const fieldAPI = {
  list: () => http.get<PaginatedResponse<Field>>('/fields/'),
  listAll: () => fetchAllPaginated<Field>('/fields/'),
  get: (id: number) => http.get<Field>(`/fields/${id}/`),
  create: (data: Field) => http.post<Field>('/fields/', withActiveProject(data)),
  update: (id: number, data: Field) => http.put<Field>(`/fields/${id}/`, withActiveProject(data)),
  delete: (id: number) => http.delete(`/fields/${id}/`),
};

export const locationAPI = {
  list: () => http.get<PaginatedResponse<Location>>('/locations/'),
  listAll: () => fetchAllPaginated<Location>('/locations/'),
  get: (id: number) => http.get<Location>(`/locations/${id}/`),
  create: (data: Location) => http.post<Location>('/locations/', withActiveProject(data)),
  update: (id: number, data: Location) => http.put<Location>(`/locations/${id}/`, withActiveProject(data)),
  delete: (id: number) => http.delete(`/locations/${id}/`),
};

export interface ProjectPayload {
  id: number;
  name: string;
  slug: string;
  description: string;
  region: ProjectRegion;
  is_active: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ProjectRegion = 'germany' | 'austria' | 'switzerland';

export interface ProjectInvitationPayload {
  id: number;
  email: string;
  role: 'admin' | 'member';
  token: string;
  status: 'pending' | 'accepted' | 'revoked';
  resolved_status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface ProjectMemberPayload {
  id: number;
  user: number;
  user_email: string;
  user_display_name: string;
  project: number;
  role: 'admin' | 'member';
  created_at: string;
}

export interface InvitationPublicStatus {
  code: string;
  token?: string;
  project_name?: string;
  email_masked?: string;
  requires_auth: boolean;
  expires_at?: string;
}

export interface InvitationAcceptResponse {
  code: string;
  detail: string;
  project_id?: number;
  project?: {
    id: number;
    name: string;
    slug: string;
  };
}

export interface VersionResponse {
  version: string;
}

export const projectAPI = {
  create: (data: { name: string; description?: string }) =>
    http.post<ProjectPayload>('/projects/', data),
  createDemo: () =>
    http.post<ProjectPayload>('/projects/create-demo/', {}),
  update: (projectId: number, data: { name?: string; region?: ProjectRegion }) =>
    http.patch<ProjectPayload>(`/projects/${projectId}/`, data),
  delete: (projectId: number) =>
    http.delete(`/projects/${projectId}/`),
  listDeleted: () =>
    http.get<PaginatedResponse<ProjectPayload> | ProjectPayload[]>('/projects/', { params: { deleted: true } }),
  restore: (projectId: number) =>
    http.post<ProjectPayload>(`/projects/${projectId}/restore/`),
  permanentDelete: (projectId: number) =>
    http.delete(`/projects/${projectId}/permanent/`),
  invite: (projectId: number, data: { email: string; role: 'admin' | 'member' }) =>
    http.post(`/projects/${projectId}/invitations/`, data),
  listMembers: (projectId: number) =>
    http.get<ProjectMemberPayload[]>(`/projects/${projectId}/members/`),
  updateMember: (projectId: number, membershipId: number, role: 'admin' | 'member') =>
    http.patch<ProjectMemberPayload>(`/projects/${projectId}/members/`, { membership_id: membershipId, role }),
  removeMember: (projectId: number, membershipId: number) =>
    http.delete(`/projects/${projectId}/members/`, { data: { membership_id: membershipId } }),
  listInvitations: (projectId: number) =>
    http.get<ProjectInvitationPayload[]>(`/projects/${projectId}/invitations/`),
  revokeInvitation: (projectId: number, invitationId: number) =>
    http.post(`/projects/${projectId}/invitations/${invitationId}/revoke/`),
  getInvitationStatus: (token: string) =>
    http.get<InvitationPublicStatus>(`/project-invitations/${token}/`),
  getPendingInvitation: () =>
    http.get<InvitationPublicStatus>('/project-invitations/pending/'),
  clearPendingInvitation: () =>
    http.delete('/project-invitations/pending/'),
  acceptPendingInvitation: () =>
    http.post<InvitationAcceptResponse>('/project-invitations/pending/accept/'),
  acceptInvitationByToken: (token: string) =>
    http.post<InvitationAcceptResponse>(`/project-invitations/${token}/accept/`),
  acceptInvitation: (token: string) =>
    http.post<InvitationAcceptResponse>('/invitations/accept/', { token }),
};

export const versionAPI = {
  get: () => http.get<VersionResponse>('/version/'),
};

export type FeedbackCategory = 'bug' | 'idea' | 'question' | 'other';

export interface FeedbackPayload {
  /** Empty string when the user picked no category — the field is optional. */
  category: FeedbackCategory | '';
  message: string;
  project_name: string;
  route: string;
  browser_info: string;
  /** When true the backend attaches the account email as the mail's reply-to. */
  contact_consent: boolean;
}

export interface FeedbackResponse {
  id: number;
  email_delivered: boolean;
}

export const feedbackAPI = {
  submit: (payload: FeedbackPayload) => http.post<FeedbackResponse>('/feedback/', payload),
};

/**
 * Project-bound API tokens for external agents.
 *
 * `create` is the only call that ever returns the plaintext token; the backend
 * stores it hashed and cannot show it again. Revocation is a DELETE that marks
 * the token revoked rather than removing the audit row.
 */
export const apiTokenAPI = {
  list: () => http.get<ApiToken[]>('/api-tokens/'),
  create: (payload: ApiTokenCreatePayload) =>
    http.post<ApiTokenCreated>('/api-tokens/', payload),
  revoke: (id: number) => http.delete<ApiToken>(`/api-tokens/${id}/`),
};

export type {
  ApiToken,
  ApiTokenCreatePayload,
  ApiTokenCreated,
  Crop,
  Location,
  Field,
  Bed,
  PlantingPlan,
  PaginatedResponse,
  Supplier,
  SeedDemand,
  YieldCalendarWeek,
  NoteAttachment,
  CropHistoryEntry,
  MediaFileRef,
  PublicCrop,
  PublicCropChangeProposal,
  PublicCropDiscussionComment,
  PublicCropRemovalReason,
  PublicCropRevision,
  PublicCropDuplicateCandidate,
  CropSpecies,
  PublishPublicCropPreview,
  RemainingAreaResponse,
  BedLayoutEntry,
  FieldLayoutEntry,
  LocationLayoutsResponse,
  CropSupplierData,
};

export default {
  crops: cropAPI,
  cropSpecies: cropSpeciesAPI,
  notifications: notificationAPI,
  publicCrops: publicCropAPI,
  suppliers: supplierAPI,
  cropSupplierData: cropSupplierDataAPI,
  beds: bedAPI,
  plantingPlans: plantingPlanAPI,
  fields: fieldAPI,
  locations: locationAPI,
  seedDemand: seedDemandAPI,
  yieldCalendar: yieldCalendarAPI,
  noteAttachments: noteAttachmentAPI,
  mediaFiles: mediaFileAPI,
  layouts: layoutAPI,
  projects: projectAPI,
  feedback: feedbackAPI,
};
