import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMock, postMock, putMock, patchMock, deleteMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  putMock: vi.fn(),
  patchMock: vi.fn(),
  deleteMock: vi.fn(),
}));

vi.mock('../api/httpClient', () => ({
  default: {
    get: getMock,
    post: postMock,
    put: putMock,
    patch: patchMock,
    delete: deleteMock,
  },
}));

import api, {
  apiTokenAPI,
  bedAPI,
  cropAPI,
  cropSpeciesAPI,
  cropSupplierDataAPI,
  feedbackAPI,
  fieldAPI,
  layoutAPI,
  locationAPI,
  mediaFileAPI,
  noteAttachmentAPI,
  notificationAPI,
  plantingPlanAPI,
  projectAPI,
  publicLibraryModeratorRequestAPI,
  seasonAPI,
  seasonPatternAPI,
  seasonSetupAPI,
  supplierAPI,
  seedDemandAPI,
  versionAPI,
  yieldCalendarAPI,
  fetchAllPaginated,
} from '../api/api';

describe('API Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('follows every backend pagination link', async () => {
    getMock
      .mockResolvedValueOnce({
        data: {
          count: 3,
          next: '/planting-plans/?page=2',
          previous: null,
          results: [{ id: 1 }, { id: 2 }],
        },
      })
      .mockResolvedValueOnce({
        data: {
          count: 3,
          next: null,
          previous: '/planting-plans/',
          results: [{ id: 3 }],
        },
      });

    await expect(fetchAllPaginated<{ id: number }>('/planting-plans/')).resolves.toEqual({
      count: 3,
      next: null,
      previous: null,
      results: [{ id: 1 }, { id: 2 }, { id: 3 }],
    });
    expect(getMock).toHaveBeenNthCalledWith(1, '/planting-plans/?page_size=1000');
    expect(getMock).toHaveBeenNthCalledWith(2, '/planting-plans/?page=2');
  });

  it('strips the host from an absolute pagination `next` URL so requests stay same-origin', async () => {
    // DRF builds `next` as an absolute URL using the backend's own host (e.g. when the
    // dev proxy rewrites the request Host header). Following it verbatim would bypass
    // the frontend's proxy and drop same-origin cookies, so only the query string may be reused.
    getMock
      .mockResolvedValueOnce({
        data: {
          count: 3,
          next: 'http://127.0.0.1:8000/api/planting-plans/?page=2&page_size=1000',
          previous: null,
          results: [{ id: 1 }, { id: 2 }],
        },
      })
      .mockResolvedValueOnce({
        data: {
          count: 3,
          next: null,
          previous: '/planting-plans/',
          results: [{ id: 3 }],
        },
      });

    await expect(fetchAllPaginated<{ id: number }>('/planting-plans/')).resolves.toEqual({
      count: 3,
      next: null,
      previous: null,
      results: [{ id: 1 }, { id: 2 }, { id: 3 }],
    });
    expect(getMock).toHaveBeenNthCalledWith(1, '/planting-plans/?page_size=1000');
    expect(getMock).toHaveBeenNthCalledWith(2, '/planting-plans/?page=2&page_size=1000');
  });

  it('calls all crop endpoints with expected URLs and payloads', () => {
    const cropData = { name: 'Karotte' };
    const importPreviewData = [{ name: 'Tomate' }];
    const importApplyData = { items: importPreviewData, confirm_updates: true };

    cropAPI.list();
    cropAPI.get(7);
    cropAPI.create(cropData as never);
    cropAPI.update(7, cropData as never);
    cropAPI.delete(7);
    cropAPI.importPreview(importPreviewData);
    cropAPI.importApply(importApplyData);

    expect(getMock).toHaveBeenCalledWith('/crops/');
    expect(getMock).toHaveBeenCalledWith('/crops/7/');
    expect(postMock).toHaveBeenCalledWith('/crops/', cropData);
    expect(putMock).toHaveBeenCalledWith('/crops/7/', cropData);
    expect(deleteMock).toHaveBeenCalledWith('/crops/7/');
    expect(postMock).toHaveBeenCalledWith('/crops/import/preview/', importPreviewData);
    expect(postMock).toHaveBeenCalledWith('/crops/import/apply/', importApplyData);
  });

  it('calls supplier endpoints and handles optional query params', () => {
    const supplierData = { id: 1, name: 'Biohof' };

    supplierAPI.list();
    supplierAPI.list('bio');
    supplierAPI.get(1);
    supplierAPI.create('Neuer Lieferant');
    supplierAPI.update(1, supplierData as never);
    supplierAPI.delete(1);

    expect(getMock).toHaveBeenCalledWith('/suppliers/', { params: {} });
    expect(getMock).toHaveBeenCalledWith('/suppliers/', { params: { q: 'bio' } });
    expect(getMock).toHaveBeenCalledWith('/suppliers/1/');
    expect(postMock).toHaveBeenCalledWith('/suppliers/', {
      name: 'Neuer Lieferant',
      homepage_url: undefined,
      allowed_domains: [],
    });
    expect(putMock).toHaveBeenCalledWith('/suppliers/1/', supplierData);
    expect(deleteMock).toHaveBeenCalledWith('/suppliers/1/');
  });

  it('calls bed endpoints', () => {
    const bedData = { name: 'Beet A' };

    bedAPI.list();
    bedAPI.get(3);
    bedAPI.create(bedData as never);
    bedAPI.update(3, bedData as never);
    bedAPI.delete(3);

    expect(getMock).toHaveBeenCalledWith('/beds/');
    expect(getMock).toHaveBeenCalledWith('/beds/3/');
    expect(postMock).toHaveBeenCalledWith('/beds/', bedData);
    expect(putMock).toHaveBeenCalledWith('/beds/3/', bedData);
    expect(deleteMock).toHaveBeenCalledWith('/beds/3/');
  });

  it('calls planting plan endpoints', () => {
    const planData = { name: 'Frühjahr' };

    plantingPlanAPI.list();
    plantingPlanAPI.get(4);
    plantingPlanAPI.create(planData as never);
    plantingPlanAPI.update(4, planData as never);
    plantingPlanAPI.delete(4);
    plantingPlanAPI.remainingArea({
      bed_id: 3,
      start_date: '2024-03-01',
      end_date: '2024-04-01',
      exclude_plan_id: 4,
    });

    expect(getMock).toHaveBeenCalledWith('/planting-plans/');
    expect(getMock).toHaveBeenCalledWith('/planting-plans/4/');
    expect(postMock).toHaveBeenCalledWith('/planting-plans/', planData);
    expect(putMock).toHaveBeenCalledWith('/planting-plans/4/', planData);
    expect(deleteMock).toHaveBeenCalledWith('/planting-plans/4/');
    expect(getMock).toHaveBeenCalledWith('/planting-plans/remaining-area/', {
      params: {
        bed_id: 3,
        start_date: '2024-03-01',
        end_date: '2024-04-01',
        exclude_plan_id: 4,
      },
    });
  });

  it('calls field and location endpoints', () => {
    const fieldData = { name: 'Feld 1' };
    const locationData = { name: 'Nord' };

    fieldAPI.list();
    fieldAPI.get(5);
    fieldAPI.create(fieldData as never);
    fieldAPI.update(5, fieldData as never);
    fieldAPI.delete(5);

    locationAPI.list();
    locationAPI.get(9);
    locationAPI.create(locationData as never);
    locationAPI.update(9, locationData as never);
    locationAPI.delete(9);

    expect(getMock).toHaveBeenCalledWith('/fields/');
    expect(getMock).toHaveBeenCalledWith('/fields/5/');
    expect(postMock).toHaveBeenCalledWith('/fields/', fieldData);
    expect(putMock).toHaveBeenCalledWith('/fields/5/', fieldData);
    expect(deleteMock).toHaveBeenCalledWith('/fields/5/');

    expect(getMock).toHaveBeenCalledWith('/locations/');
    expect(getMock).toHaveBeenCalledWith('/locations/9/');
    expect(postMock).toHaveBeenCalledWith('/locations/', locationData);
    expect(putMock).toHaveBeenCalledWith('/locations/9/', locationData);
    expect(deleteMock).toHaveBeenCalledWith('/locations/9/');
  });


  it('calls seed demand endpoint', () => {
    seedDemandAPI.list();
    seedDemandAPI.list('3:11');
    seedDemandAPI.saveSupplierSelection(3, 11);
    seedDemandAPI.saveSupplierSelection(3, null);

    expect(getMock).toHaveBeenCalledWith('/seed-demand/', { params: {} });
    expect(getMock).toHaveBeenCalledWith('/seed-demand/', { params: { supplier_selection: '3:11' } });
    expect(postMock).toHaveBeenCalledWith('/seed-demand/', { crop_id: 3, supplier_id: 11 });
    expect(postMock).toHaveBeenCalledWith('/seed-demand/', { crop_id: 3, supplier_id: null });
  });

  it('exports grouped default API object', () => {
    expect(api.crops).toBe(cropAPI);
    expect(api.suppliers).toBe(supplierAPI);
    expect(api.beds).toBe(bedAPI);
    expect(api.plantingPlans).toBe(plantingPlanAPI);
    expect(api.fields).toBe(fieldAPI);
    expect(api.locations).toBe(locationAPI);
    expect(api.seedDemand).toBe(seedDemandAPI);
  });
});

describe('withActiveProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  const bodyOf = (mock: typeof postMock) => mock.mock.calls[0]?.[1] as Record<string, unknown>;

  it('stamps the active project onto a create that does not name one', () => {
    // Without this the backend would reject the row, or worse, attach it to
    // whichever project the session last touched.
    window.localStorage.setItem('activeProjectId', '7');

    bedAPI.create({ name: 'Beet 1' } as never);

    expect(bodyOf(postMock)).toMatchObject({ name: 'Beet 1', project: 7 });
  });

  it('never overrides a project the caller named itself', () => {
    window.localStorage.setItem('activeProjectId', '7');

    bedAPI.create({ name: 'Beet 1', project: 3 } as never);

    expect(bodyOf(postMock)).toMatchObject({ project: 3 });
  });

  it.each([
    ['nothing stored', null],
    ['an empty string', ''],
    ['a non-numeric value', 'sieben'],
    ['zero', '0'],
    ['a negative id', '-1'],
    ['Infinity', 'Infinity'],
  ])('sends the payload untouched when localStorage holds %s', (_label, stored) => {
    // A zero, negative or infinite id is not a real project; stamping one would
    // write to nothing, which is harder to diagnose than the backend's own
    // rejection. Note that the leading `if (!rawValue)` guard is redundant
    // against the checks that follow — `Number(null)` and `Number('')` are both
    // 0, which the positivity check already rejects.
    if (stored !== null) {
      window.localStorage.setItem('activeProjectId', stored);
    }

    bedAPI.create({ name: 'Beet 1' } as never);

    expect(bodyOf(postMock)).not.toHaveProperty('project');
  });

  it.each([
    ['null', null],
    ['zero', 0],
    ['a negative id', -1],
    ['a numeric string', '3'],
  ])('replaces a project field of %s, which is not a usable id', (_label, project) => {
    window.localStorage.setItem('activeProjectId', '7');

    bedAPI.create({ name: 'Beet 1', project } as never);

    expect(bodyOf(postMock)).toMatchObject({ project: 7 });
  });

  it('does not mutate the object the caller passed in', () => {
    window.localStorage.setItem('activeProjectId', '7');
    const payload = { name: 'Beet 1' };

    bedAPI.create(payload as never);

    expect(payload).not.toHaveProperty('project');
  });

  it('applies to updates as well as creates', () => {
    window.localStorage.setItem('activeProjectId', '7');

    bedAPI.update(1, { name: 'Beet 1' } as never);

    expect(putMock.mock.calls[0]?.[1]).toMatchObject({ project: 7 });
  });

  it('applies to a partial planting-plan patch too', () => {
    window.localStorage.setItem('activeProjectId', '7');

    plantingPlanAPI.patch(1, { quantity: 5 } as never);

    expect(patchMock.mock.calls[0]?.[1]).toMatchObject({ project: 7 });
  });

  it.each([
    ['cropSupplierData', () => cropSupplierDataAPI.create({ crop: 1 } as never)],
    ['fields', () => fieldAPI.create({ name: 'P1' } as never)],
    ['locations', () => locationAPI.create({ name: 'S1' } as never)],
  ])('%s creates are project-scoped too', (_label, call) => {
    window.localStorage.setItem('activeProjectId', '7');

    call();

    expect(bodyOf(postMock)).toMatchObject({ project: 7 });
  });
});

describe('untested endpoint groups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('asks for notifications and their unread count in one request', () => {
    notificationAPI.list({ is_read: false, page_size: 5 });
    expect(getMock).toHaveBeenCalledWith('/notifications/', {
      params: { is_read: false, page_size: 5 },
    });
  });

  it('marks a notification read by POST, not by PATCH', () => {
    notificationAPI.markRead(4);
    expect(postMock).toHaveBeenCalledWith('/notifications/4/read/');
  });

  it('proposes a crop species without a translation when no language is given', () => {
    cropSpeciesAPI.propose('Pastinake');
    expect(postMock).toHaveBeenCalledWith('/crop-species/', { name: 'Pastinake' });
  });

  it('attaches the common name as a translation when a language is given', () => {
    cropSpeciesAPI.propose('Pastinake', 'de');
    expect(postMock).toHaveBeenCalledWith('/crop-species/', {
      name: 'Pastinake',
      translations: [{ language_code: 'de', common_name: 'Pastinake' }],
    });
  });

  it('sends an empty review note by default rather than omitting the field', () => {
    cropSpeciesAPI.approve(3);
    expect(postMock).toHaveBeenCalledWith('/crop-species/3/approve/', { review_note: '' });
    cropSpeciesAPI.reject(3);
    expect(postMock).toHaveBeenCalledWith('/crop-species/3/reject/', { review_note: '' });
  });

  it('omits translations from an approval that carries none', () => {
    cropSpeciesAPI.approve(3, 'ok');
    expect(postMock.mock.calls[0]?.[1]).not.toHaveProperty('translations');
  });

  it('curates search aliases through a PATCH on the species itself', () => {
    const translations = [{ language_code: 'de', common_name: 'Möhre' }];
    cropSpeciesAPI.updateTranslations(3, translations as never);
    expect(patchMock).toHaveBeenCalledWith('/crop-species/3/', { translations });
  });

  it('routes moderator requests through the public-library namespace', () => {
    publicLibraryModeratorRequestAPI.mine();
    expect(getMock).toHaveBeenCalledWith('/public-library/moderator-requests/mine/');
    publicLibraryModeratorRequestAPI.create('Ich möchte helfen');
    expect(postMock).toHaveBeenCalledWith(
      '/public-library/moderator-requests/', { motivation: 'Ich möchte helfen' },
    );
  });

  it('asks for every season in one page, since the switcher shows them all', () => {
    seasonAPI.list();
    expect(getMock).toHaveBeenCalledWith('/seasons/', { params: { page_size: 1000 } });
  });

  it('updates a season by PATCH, so an unnamed field is left alone', () => {
    // A PUT would clear the custom label whenever only the dates are edited.
    seasonAPI.update(2, { start_date: '2026-03-01' });
    expect(patchMock).toHaveBeenCalledWith('/seasons/2/', { start_date: '2026-03-01' });
    expect(putMock).not.toHaveBeenCalled();
  });

  it('undeletes and copies with an explicit body, not an empty POST', () => {
    seasonAPI.undelete(2);
    expect(postMock).toHaveBeenCalledWith('/seasons/2/undelete/', {});
    seasonAPI.copyFrom(2, 1);
    expect(postMock).toHaveBeenCalledWith('/seasons/2/copy-from/', { source_season_id: 1 });
  });

  it('names the copy target in the path and the source in the body', () => {
    // Swapping the two would copy in the wrong direction and overwrite the
    // season the user meant to copy from.
    seasonAPI.copyFrom(9, 4);
    expect(postMock.mock.calls[0]?.[0]).toContain('/seasons/9/');
    expect(postMock.mock.calls[0]?.[1]).toEqual({ source_season_id: 4 });
  });

  it('reads and writes the season pattern on one path', () => {
    seasonPatternAPI.get();
    expect(getMock).toHaveBeenCalledWith('/season-pattern/');
    seasonPatternAPI.update({ start_day: 1, start_month: 9 });
    expect(patchMock).toHaveBeenCalledWith('/season-pattern/', { start_day: 1, start_month: 9 });
  });

  it('previews the season pattern without writing it', () => {
    seasonPatternAPI.preview({ start_day: 15, start_month: 3 });
    expect(getMock).toHaveBeenCalledWith('/season-pattern/preview/', {
      params: { start_day: 15, start_month: 3 },
    });
    expect(patchMock).not.toHaveBeenCalled();
  });

  it('separates the season-setup status read from the apply write', () => {
    seasonSetupAPI.status();
    expect(getMock).toHaveBeenCalledWith('/season-setup/status/', { params: undefined });
    seasonSetupAPI.apply({ start_day: 1, start_month: 9 });
    expect(postMock).toHaveBeenCalledWith('/season-setup/apply/', { start_day: 1, start_month: 9 });
  });

  it('reads and writes layouts under the location that owns them', () => {
    layoutAPI.listByLocation(5);
    expect(getMock).toHaveBeenCalledWith('/locations/5/layouts/');
    const payload = { bed_layouts: [], field_layouts: [] };
    layoutAPI.saveByLocation(5, payload);
    expect(putMock).toHaveBeenCalledWith('/locations/5/layouts/', payload);
  });

  it('uploads a media file as multipart form data', () => {
    const file = new File(['x'], 'beet.png', { type: 'image/png' });

    mediaFileAPI.upload(file);

    const body = postMock.mock.calls[0]?.[1] as FormData;
    expect(postMock.mock.calls[0]?.[0]).toBe('/media-files/upload/');
    expect(body).toBeInstanceOf(FormData);
    expect((body.get('file') as File).name).toBe('beet.png');
  });

  it('names an unnamed upload rather than sending a blank filename', () => {
    const file = new File(['x'], '', { type: 'image/png' });

    mediaFileAPI.upload(file);

    expect(((postMock.mock.calls[0]?.[1] as FormData).get('file') as File).name)
      .toBe('crop-media');
  });

  it('sends a note attachment with its caption', () => {
    const file = new File(['x'], 'foto.png', { type: 'image/png' });

    noteAttachmentAPI.upload(3, file, 'Vor der Ernte');

    const body = postMock.mock.calls[0]?.[1] as FormData;
    expect(postMock.mock.calls[0]?.[0]).toBe('/notes/3/attachments/');
    expect(body.get('caption')).toBe('Vor der Ernte');
    expect((body.get('image') as File).name).toBe('foto.png');
  });

  it('sends an empty caption by default', () => {
    noteAttachmentAPI.upload(3, new File(['x'], 'f.png'));
    expect((postMock.mock.calls[0]?.[1] as FormData).get('caption')).toBe('');
  });

  it('reports upload progress as a whole percentage', () => {
    const onProgress = vi.fn();
    noteAttachmentAPI.upload(3, new File(['x'], 'f.png'), '', onProgress);

    const config = postMock.mock.calls[0]?.[2] as {
      onUploadProgress: (event: { loaded: number; total?: number }) => void;
    };
    config.onUploadProgress({ loaded: 333, total: 1000 });

    expect(onProgress).toHaveBeenCalledWith(33);
  });

  it('reports nothing while the total size is still unknown', () => {
    // Axios omits `total` until the request headers are out; dividing by it
    // then would report Infinity or NaN as a percentage.
    const onProgress = vi.fn();
    noteAttachmentAPI.upload(3, new File(['x'], 'f.png'), '', onProgress);

    const config = postMock.mock.calls[0]?.[2] as {
      onUploadProgress: (event: { loaded: number; total?: number }) => void;
    };
    config.onUploadProgress({ loaded: 100 });
    config.onUploadProgress({ loaded: 100, total: 0 });

    expect(onProgress).not.toHaveBeenCalled();
  });

  it('deletes an attachment by its own id, not under its note', () => {
    noteAttachmentAPI.delete(9);
    expect(deleteMock).toHaveBeenCalledWith('/attachments/9/');
  });

  it('omits the year from a yield-calendar request so the season header decides', () => {
    // Asserted on the keys, not with toHaveBeenCalledWith: that compares with
    // `toEqual` semantics, under which `{ year: undefined }` and `{}` are the
    // same object. Axios drops an undefined param either way, so this pins the
    // shape rather than a behavioural difference.
    yieldCalendarAPI.list();
    const config = getMock.mock.calls[0]?.[1] as { params: Record<string, unknown> };
    expect(Object.keys(config.params)).toEqual([]);
  });

  it('still honours an explicit year', () => {
    yieldCalendarAPI.list(2026);
    expect(getMock).toHaveBeenCalledWith('/yield-calendar/', { params: { year: 2026 } });
  });

  it('sends no supplier filter when none is selected', () => {
    // Same shape-versus-equality point as the yield calendar above.
    seedDemandAPI.list();
    const config = getMock.mock.calls[0]?.[1] as { params: Record<string, unknown> };
    expect(Object.keys(config.params)).toEqual([]);
  });

  it('sends a null supplier id to clear a selection, rather than omitting it', () => {
    // Omitting the key would leave the previous selection in place.
    seedDemandAPI.saveSupplierSelection(4, null);
    expect(postMock).toHaveBeenCalledWith('/seed-demand/', { crop_id: 4, supplier_id: null });
  });

  it('lists deleted projects through a query flag on the normal endpoint', () => {
    projectAPI.listDeleted();
    expect(getMock).toHaveBeenCalledWith('/projects/', { params: { deleted: true } });
  });

  it('keeps the permanent delete on its own path, away from the soft one', () => {
    projectAPI.delete(2);
    expect(deleteMock).toHaveBeenCalledWith('/projects/2/');
    projectAPI.permanentDelete(2);
    expect(deleteMock).toHaveBeenCalledWith('/projects/2/permanent/');
  });

  it('identifies a member to remove in the request body, since the path has no id', () => {
    projectAPI.removeMember(2, 11);
    expect(deleteMock).toHaveBeenCalledWith('/projects/2/members/', {
      data: { membership_id: 11 },
    });
  });

  it('updates a member role on the collection path with the membership in the body', () => {
    projectAPI.updateMember(2, 11, 'admin');
    expect(patchMock).toHaveBeenCalledWith('/projects/2/members/', {
      membership_id: 11, role: 'admin',
    });
  });

  it('has three distinct ways to accept an invitation, on three distinct paths', () => {
    // The pending one uses the session; the other two carry the token in the
    // path and in the body respectively. Collapsing any two would break a link.
    projectAPI.acceptPendingInvitation();
    projectAPI.acceptInvitationByToken('abc');
    projectAPI.acceptInvitation('abc');

    expect(postMock.mock.calls.map((call) => call[0])).toEqual([
      '/project-invitations/pending/accept/',
      '/project-invitations/abc/accept/',
      '/invitations/accept/',
    ]);
    expect(postMock.mock.calls[2]?.[1]).toEqual({ token: 'abc' });
  });

  it('reads the version and submits feedback on their own endpoints', () => {
    versionAPI.get();
    expect(getMock).toHaveBeenCalledWith('/version/');

    const payload = {
      category: 'bug' as const,
      message: 'Kaputt',
      project_name: 'Hof',
      route: '/crops',
      browser_info: 'jsdom',
      contact_consent: true,
    };
    feedbackAPI.submit(payload);
    expect(postMock).toHaveBeenCalledWith('/feedback/', payload);
  });

  it('revokes an API token with DELETE, which the backend records rather than erases', () => {
    apiTokenAPI.list();
    expect(getMock).toHaveBeenCalledWith('/api-tokens/');
    apiTokenAPI.revoke(5);
    expect(deleteMock).toHaveBeenCalledWith('/api-tokens/5/');
  });
});
