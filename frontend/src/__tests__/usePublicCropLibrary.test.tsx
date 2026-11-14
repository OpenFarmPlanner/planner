import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { usePublicCropLibrary } from '../pages/usePublicCropLibrary';
import type { Crop } from '../api/types';

const {
  publishPublicMock,
  linkPublicCropMock,
  publicSyncMock,
  unlinkPublicCropMock,
  refreshUserMock,
  importPreviewMock,
  importToProjectMock,
} = vi.hoisted(() => ({
  publishPublicMock: vi.fn(),
  linkPublicCropMock: vi.fn(),
  publicSyncMock: vi.fn(),
  unlinkPublicCropMock: vi.fn(),
  refreshUserMock: vi.fn(),
  importPreviewMock: vi.fn().mockResolvedValue({ data: { candidates: [] } }),
  importToProjectMock: vi.fn(),
}));

vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return {
    ...actual,
    cropAPI: {
      ...actual.cropAPI,
      publishPublic: publishPublicMock,
      linkPublicCrop: linkPublicCropMock,
      publicSync: publicSyncMock,
      unlinkPublicCrop: unlinkPublicCropMock,
    },
    publicCropAPI: {
      ...actual.publicCropAPI,
      importToProject: importToProjectMock,
      importPreview: importPreviewMock,
    },
  };
});

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ refreshUser: refreshUserMock }),
}));

const SELECTED_CROP: Crop = { id: 1, name: 'Tomate', variety: '' };

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>{children}</MemoryRouter>
);

const renderLibraryHook = (showSnackbar: ReturnType<typeof vi.fn>) => renderHook(
  () => usePublicCropLibrary({
    shouldShowProjectRequiredState: false,
    selectedCrop: SELECTED_CROP,
    onImportSuccess: vi.fn(),
    onClearForm: vi.fn(),
    showSnackbar,
  }),
  { wrapper },
);

describe('usePublicCropLibrary co-publishing Sorten', () => {
  beforeEach(() => {
    publishPublicMock.mockReset();
    publishPublicMock.mockResolvedValue({ data: { operation: 'created' } });
    linkPublicCropMock.mockReset();
    linkPublicCropMock.mockResolvedValue({ data: {} });
    refreshUserMock.mockReset();
  });

  it('reports the Kultur and its Sorten in a single snackbar message', async () => {
    // The snackbar holds one message at a time, so a second call would replace
    // the Kultur's confirmation before the user has read it.
    const showSnackbar = vi.fn();
    const { result } = renderLibraryHook(showSnackbar);

    await result.current.handlePublishCurrentCrop(false, {
      cropSpeciesId: 1,
      originalLanguageCode: 'de',
      publishAsGeneral: true,
      varieties: [
        { cropId: 2, publicCropId: null },
        { cropId: 3, publicCropId: 40 },
      ],
    });

    await waitFor(() => expect(showSnackbar).toHaveBeenCalledTimes(1));
    const [message, severity] = showSnackbar.mock.calls[0];
    expect(message).toContain('„Tomate“ wurde in die Kulturbibliothek veröffentlicht.');
    expect(message).toContain('2 Sorten wurden mitveröffentlicht.');
    expect(severity).toBe('success');
  });

  it('keeps the Kultur confirmation visible when a Sorte fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    publishPublicMock
      .mockResolvedValueOnce({ data: { operation: 'created' } })
      .mockRejectedValueOnce(new Error('nope'));
    const showSnackbar = vi.fn();
    const { result } = renderLibraryHook(showSnackbar);

    await result.current.handlePublishCurrentCrop(false, {
      cropSpeciesId: 1,
      originalLanguageCode: 'de',
      publishAsGeneral: true,
      varieties: [{ cropId: 2, publicCropId: null }],
    });

    await waitFor(() => expect(showSnackbar).toHaveBeenCalledTimes(1));
    const [message, severity] = showSnackbar.mock.calls[0];
    expect(message).toContain('„Tomate“ wurde in die Kulturbibliothek veröffentlicht.');
    expect(message).toContain('1 Sorte konnte nicht mitveröffentlicht werden.');
    expect(severity).toBe('error');
  });

  it('shows the plain Kultur message when no Sorte was selected', async () => {
    const showSnackbar = vi.fn();
    const { result } = renderLibraryHook(showSnackbar);

    await result.current.handlePublishCurrentCrop(false, {
      cropSpeciesId: 1,
      originalLanguageCode: 'de',
      publishAsGeneral: true,
    });

    await waitFor(() => expect(showSnackbar).toHaveBeenCalledTimes(1));
    expect(showSnackbar.mock.calls[0][0]).toBe('„Tomate“ wurde in die Kulturbibliothek veröffentlicht.');
  });
});

describe('usePublicCropLibrary field-by-field sync', () => {
  const LINK_DATA = {
    acceptedPublicLibraryTerms: false,
    cropSpeciesId: 1,
    originalLanguageCode: 'de',
    publicCropId: 77,
    baseVersion: 4,
    pullFields: ['growth_duration_days'],
    pushFields: ['notes'],
  };

  beforeEach(() => {
    linkPublicCropMock.mockReset();
    linkPublicCropMock.mockResolvedValue({ data: {} });
    publicSyncMock.mockReset();
    publicSyncMock.mockResolvedValue({ data: { operation: 'synced', crop: {}, change_proposal: null } });
    refreshUserMock.mockReset();
  });

  it('links and pulls atomically without pushing even when legacy callers send push fields', async () => {
    const showSnackbar = vi.fn();
    const { result } = renderLibraryHook(showSnackbar);
    await expect(result.current.handleLinkPublicCrop(LINK_DATA)).resolves.toBe(true);
    expect(linkPublicCropMock).toHaveBeenCalledWith(1, 77, ['growth_duration_days'], 4, undefined, undefined);
    expect(publicSyncMock).not.toHaveBeenCalled();
    expect(showSnackbar).toHaveBeenCalledWith('„Tomate“ wurde mit der Kulturbibliothek verknüpft.', 'success');
  });

  it('does not publish selected varieties as a side effect of linking', async () => {
    publishPublicMock.mockClear();
    const { result } = renderLibraryHook(vi.fn());
    await result.current.handleLinkPublicCrop({ ...LINK_DATA, varieties: [{ cropId: 2, publicCropId: null }] });
    expect(publicSyncMock).not.toHaveBeenCalled();
    expect(publishPublicMock).not.toHaveBeenCalled();
    expect(refreshUserMock).not.toHaveBeenCalled();
  });

  it('does not call the push when every field comes from the library', async () => {
    const { result } = renderLibraryHook(vi.fn());

    await result.current.handleLinkPublicCrop({ ...LINK_DATA, pullFields: ['growth_duration_days', 'notes'], pushFields: [] });

    expect(publicSyncMock).not.toHaveBeenCalled();
  });

  it('reports a sync that became a proposal under review', async () => {
    publicSyncMock.mockResolvedValue({
      data: { operation: 'pending_moderation', crop: {}, change_proposal: { id: 1 } },
    });
    const showSnackbar = vi.fn();
    const { result } = renderLibraryHook(showSnackbar);

    await expect(result.current.handleSyncPublicCrop({
      acceptedPublicLibraryTerms: false,
      publicCropId: 77,
      baseVersion: 4,
      pullFields: [],
      pushFields: ['notes'],
    })).resolves.toBe(true);

    expect(showSnackbar).toHaveBeenCalledWith(
      '„Tomate“ wurde abgeglichen. Deine Änderungen an der Kulturbibliothek warten auf Freigabe.',
      'success',
    );
  });
});

describe('usePublicCropLibrary unlink', () => {
  it('removes the link and confirms with "Verknüpfung aufgehoben."', async () => {
    unlinkPublicCropMock.mockReset();
    unlinkPublicCropMock.mockResolvedValue({ data: { id: 1, source_public_crop: null } });
    const showSnackbar = vi.fn();
    const { result } = renderLibraryHook(showSnackbar);

    await expect(result.current.handleUnlinkPublicCrop(SELECTED_CROP)).resolves.toBe(true);

    expect(unlinkPublicCropMock).toHaveBeenCalledWith(1);
    expect(showSnackbar).toHaveBeenCalledWith('Verknüpfung aufgehoben.', 'success');
  });
});

describe('usePublicCropLibrary import', () => {
  it('keeps the dialog open after a successful import, so several crops can be imported in one sitting', async () => {
    // Regression test: a prior refactor accidentally reintroduced a
    // setPublicLibraryOpen(false) call here, silently closing the dialog on
    // every import despite the deliberate "stay open" behavior this hook
    // documents - see e2e/public-crop-library.spec.ts for the user-facing
    // symptom that surfaced it (a dialog button becoming unclickable mid
    // close-transition).
    importToProjectMock.mockReset();
    importToProjectMock.mockResolvedValue({
      data: { crop: { id: 1, name: 'Tomate', variety: '' }, operation: 'unchanged' },
    });
    const showSnackbar = vi.fn();
    const { result } = renderLibraryHook(showSnackbar);

    act(() => {
      result.current.setPublicLibraryOpen(true);
    });
    expect(result.current.publicLibraryOpen).toBe(true);

    await act(async () => {
      await result.current.handleImportPublicCrop({ id: 42, name: 'Tomate', variety: '', project_import_status: { crop_id: 1 } } as never);
    });

    expect(importToProjectMock).toHaveBeenCalledWith(42, undefined);
    expect(result.current.publicLibraryOpen).toBe(true);
  });
});

it('offers existing import targets without mutating the project before confirmation', async () => {
  importPreviewMock.mockResolvedValueOnce({ data: { candidates: [{ id: 9, name: 'Tomate', variety: '', species_match: true }] } });
  importToProjectMock.mockClear();
  const { result } = renderLibraryHook(vi.fn());
  await act(async () => {
    await result.current.handleImportPublicCrop({ id: 77, name: 'Tomate', variety: '' } as never);
  });
  expect(result.current.importLink?.candidates[0].id).toBe(9);
  expect(importToProjectMock).not.toHaveBeenCalled();
});


it('offers an explicit import method even when creating a new crop', async () => {
  importPreviewMock.mockResolvedValueOnce({ data: { candidates: [] } });
  importToProjectMock.mockClear();
  const { result } = renderLibraryHook(vi.fn());
  await act(async () => { await result.current.handleImportPublicCrop({ id: 88, name: 'Bean' } as never); });
  expect(result.current.importLink).toMatchObject({ publicCrop: { id: 88 }, candidates: [] });
  expect(importToProjectMock).not.toHaveBeenCalled();
});
