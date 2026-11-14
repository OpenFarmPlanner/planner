import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ExistingCropLinkDialog, type CropLinkCandidate } from '../crops/ExistingCropLinkDialog';
import type { PublicCrop } from '../api/types';
import i18n from '../i18n';

const { preview, link, copy, importNew } = vi.hoisted(() => ({ preview: vi.fn(), link: vi.fn(), copy: vi.fn(), importNew: vi.fn() }));
vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return { ...actual,
    cropAPI: { ...actual.cropAPI, publicSyncPreview: preview, linkPublicCrop: link, copyPublicCrop: copy },
    publicCropAPI: { ...actual.publicCropAPI, importToProject: importNew },
  };
});
const t = i18n.getFixedT('de', 'crops');
const publicCrop = { id: 77, name: 'Tomato', variety: '', version: 4 } as PublicCrop;
const candidate: CropLinkCandidate = { id: 1, name: 'Tomato', variety: '', source_public_crop: null, species_match: true };
const button = (mode: 'copy' | 'link' = 'link') => screen.getByRole('button', { name: t(`library.importDecision.${mode}`) });
const contribution = { pushFields: [], acceptedPublicLibraryTerms: false };

function setup(candidates = [candidate], termsAlreadyAccepted = true) {
  const onLinked = vi.fn();
  const onClose = vi.fn();
  render(<MemoryRouter><ExistingCropLinkDialog publicCrop={publicCrop} candidates={candidates}
    termsAlreadyAccepted={termsAlreadyAccepted} onClose={onClose} onLinked={onLinked} /></MemoryRouter>);
  return { onLinked, onClose };
}

describe('ExistingCropLinkDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.setItem('activeProjectId', '42');
    preview.mockResolvedValue({ data: { public_version: 4, crop_updated_at: '2026-11-14T12:00:00Z', changes: [
      { field: 'growth_duration_days', local_value: 90, public_value: 80, pushable: true, pinnable: true },
      { field: 'notes', local_value: 'Private notes', public_value: '', pushable: true, pinnable: true },
    ] } });
    link.mockResolvedValue({ data: { id: 1, name: 'Tomato' } });
    copy.mockResolvedValue({ data: { id: 1, name: 'Tomato' } });
    importNew.mockResolvedValue({ data: { crop: { id: 3, name: 'Tomato' } } });
  });

  it('explains one stable match and defaults to linking without sharing private values', async () => {
    const { onLinked } = setup();
    expect(screen.getByRole('combobox')).toHaveTextContent('Tomato');
    expect(screen.getByText(t('library.importDecision.existing'))).toBeVisible();
    expect(screen.getByText(t('library.importDecision.linkHelp'))).toBeVisible();
    expect(screen.getAllByRole('radio')[0]).toHaveAccessibleName(t('library.importDecision.link'));
    expect(screen.getAllByRole('radio')[0]).toBeChecked();
    await waitFor(() => expect(button()).toBeEnabled());
    expect(copy).not.toHaveBeenCalled();
    fireEvent.click(button());
    await waitFor(() => expect(link).toHaveBeenCalledWith(1, 77, ['growth_duration_days'], 4, '2026-11-14T12:00:00Z', ['notes'], contribution));
    expect(onLinked).toHaveBeenCalledWith({ id: 1, name: 'Tomato' });
    expect(copy).not.toHaveBeenCalled();
    expect(screen.getByTestId('public-crop-sync-local-info')).toBeInTheDocument();
  });

  it('offers linking with the existing third local-only column and pin behavior', async () => {
    setup();
    fireEvent.click(screen.getByRole('radio', { name: t('library.importDecision.link') }));
    await waitFor(() => expect(button('link')).toBeEnabled());
    const notes = await screen.findByTestId('public-crop-sync-row-notes');
    fireEvent.click(notes.querySelector('input[value="local"]')!);
    expect(screen.getByTestId('public-crop-sync-local-info')).toBeInTheDocument();
    fireEvent.click(button('link'));
    await waitFor(() => expect(link).toHaveBeenCalledWith(1, 77, ['growth_duration_days'], 4, '2026-11-14T12:00:00Z', ['notes'], contribution));
    expect(copy).not.toHaveBeenCalled();
  });

  it('requires an explicit target for multiple candidates', async () => {
    setup([candidate, { ...candidate, id: 2, name: 'Another Tomato' }]);
    expect(preview).not.toHaveBeenCalled();
    expect(button()).toBeDisabled();
    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: 'Another Tomato' }));
    await waitFor(() => expect(button()).toBeEnabled());
    fireEvent.click(button());
    await waitFor(() => expect(link).toHaveBeenCalledWith(2, 77, ['growth_duration_days'], 4, '2026-11-14T12:00:00Z', ['notes'], contribution));
  });

  it('keeps name-only matches as suggestions requiring target confirmation', () => {
    setup([{ ...candidate, species_match: false }]);
    expect(preview).not.toHaveBeenCalled();
    expect(button()).toBeDisabled();
    fireEvent.mouseDown(screen.getByRole('combobox'));
    expect(screen.getByRole('option', { name: t('library.importConflictDialog.importAsNew') })).toBeVisible();
  });

  it.each(['copy', 'link'] as const)('imports a new crop using the confirmed %s mode', async mode => {
    const { onLinked } = setup([]);
    expect(screen.getByText(t('library.importDecision.newCrop'))).toBeVisible();
    if (mode === 'link') fireEvent.click(screen.getByRole('radio', { name: t('library.importDecision.link') }));
    fireEvent.click(button(mode));
    await waitFor(() => expect(importNew).toHaveBeenCalledWith(77, undefined, { linkToLibrary: mode === 'link', baseVersion: 4, expectedProjectId: 42 }));
    expect(onLinked).toHaveBeenCalledWith({ id: 3, name: 'Tomato' });
    expect(copy).not.toHaveBeenCalled();
  });

  it('explains that an already-linked target keeps its link', () => {
    setup([{ ...candidate, source_public_crop: 77 }]);
    expect(screen.getByText(t('library.importDecision.alreadyLinked'))).toBeVisible();
    expect(button('copy')).toBeDisabled();
    expect(preview).not.toHaveBeenCalled();
  });

  it('keeps the decision open after a stale confirmation and reloads its comparison', async () => {
    link.mockRejectedValueOnce(new Error('stale'));
    const { onLinked } = setup();
    await waitFor(() => expect(button()).toBeEnabled());
    fireEvent.click(button());
    await screen.findByText(t('library.importDecision.failed'));
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
    expect(onLinked).not.toHaveBeenCalled();
    expect(link).toHaveBeenCalledTimes(1);
  });

  it('cancels without changing either record', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(link).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
    expect(importNew).not.toHaveBeenCalled();
  });
  it('binds a new import to the project shown when opening the decision', async () => {
    importNew.mockRejectedValueOnce({ isAxiosError: true, response: { data: { code: 'public_crop_import_project_changed' } } });
    const { onLinked } = setup([]);
    window.localStorage.setItem('activeProjectId', '84');
    fireEvent.click(button('copy'));
    await waitFor(() => expect(importNew).toHaveBeenCalledWith(77, undefined, {
      linkToLibrary: false, baseVersion: 4, expectedProjectId: 42,
    }));
    expect(await screen.findByText(t('library.importDecision.projectChanged'))).toBeVisible();
    expect(onLinked).not.toHaveBeenCalled();
  });

  it('preserves chosen values across import methods without pinning a one-time copy', async () => {
    setup();
    fireEvent.click(screen.getByRole('radio', { name: t('library.importDecision.copy') }));
    await waitFor(() => expect(button('copy')).toBeEnabled());
    const growth = screen.getByTestId('public-crop-sync-row-growth_duration_days');
    fireEvent.click(growth.querySelector('input[value="mine"]')!);
    fireEvent.click(screen.getByRole('radio', { name: t('library.importDecision.link') }));
    await waitFor(() => expect(button('link')).toBeEnabled());
    expect(growth.querySelector('input[value="local"]')).toBeChecked();
    const notes = screen.getByTestId('public-crop-sync-row-notes');
    fireEvent.click(notes.querySelector('input[value="local"]')!);
    fireEvent.click(screen.getByRole('radio', { name: t('library.importDecision.copy') }));
    await waitFor(() => expect(button('copy')).toBeEnabled());
    expect(growth.querySelector('input[value="mine"]')).toBeChecked();
    expect(notes.querySelector('input[value="mine"]')).toBeChecked();
    expect(notes.querySelector('input[value="local"]')).not.toBeInTheDocument();
    fireEvent.click(button('copy'));
    await waitFor(() => expect(copy).toHaveBeenCalledWith(1, 77, [], 4, '2026-11-14T12:00:00Z'));
    expect(link).not.toHaveBeenCalled();
  });

  it('retains untouched pin decisions when editing another field in copy mode', async () => {
    preview.mockResolvedValue({ data: {
      public_version: 4, crop_updated_at: '2026-11-14T12:00:00Z', changes: [
        { field: 'growth_duration_days', local_value: 90, public_value: 80, pushable: true, pinnable: true },
        { field: 'notes', local_value: 'Private notes', public_value: 'Library notes', pushable: true, pinnable: true },
        { field: 'harvest_duration_days', local_value: 20, public_value: 15, pushable: true, pinnable: true },
      ],
    } });
    setup();
    await waitFor(() => expect(button()).toBeEnabled());
    fireEvent.click(screen.getByRole('radio', { name: t('library.importDecision.link') }));
    for (const field of ['growth_duration_days', 'notes']) {
      fireEvent.click(screen.getByTestId(`public-crop-sync-row-${field}`).querySelector('input[value="local"]')!);
    }
    fireEvent.click(screen.getByRole('radio', { name: t('library.importDecision.copy') }));
    fireEvent.click(screen.getByTestId('public-crop-sync-row-harvest_duration_days').querySelector('input[value="mine"]')!);
    fireEvent.click(screen.getByRole('radio', { name: t('library.importDecision.link') }));
    for (const field of ['growth_duration_days', 'notes']) {
      expect(screen.getByTestId(`public-crop-sync-row-${field}`).querySelector('input[value="local"]')).toBeChecked();
    }
    expect(screen.getByTestId('public-crop-sync-row-harvest_duration_days').querySelector('input[value="local"]')).toBeChecked();
    fireEvent.click(button('link'));
    await waitFor(() => expect(link).toHaveBeenCalledWith(1, 77, [], 4, '2026-11-14T12:00:00Z', ['growth_duration_days', 'notes', 'harvest_duration_days'], contribution));
  });

  it('shares only explicitly selected fields and keeps private notes pinned', async () => {
    setup();
    await waitFor(() => expect(button()).toBeEnabled());
    fireEvent.click(screen.getByTestId('public-crop-sync-row-growth_duration_days').querySelector('input[value="mine"]')!);
    expect(screen.getByTestId('public-crop-sync-row-notes').querySelector('input[value="local"]')).toBeChecked();
    fireEvent.click(button());
    await waitFor(() => expect(link).toHaveBeenCalledWith(1, 77, [], 4, '2026-11-14T12:00:00Z', ['notes'],
      { pushFields: ['growth_duration_days'], acceptedPublicLibraryTerms: false }));
  });

  it('expires an earlier share decision when returning from copy mode', async () => {
    setup();
    await waitFor(() => expect(button()).toBeEnabled());
    const growth = screen.getByTestId('public-crop-sync-row-growth_duration_days');
    fireEvent.click(growth.querySelector('input[value="mine"]')!);
    fireEvent.click(screen.getByRole('radio', { name: t('library.importDecision.copy') }));
    fireEvent.click(screen.getByRole('radio', { name: t('library.importDecision.link') }));
    expect(growth.querySelector('input[value="local"]')).toBeChecked();
    fireEvent.click(button());
    await waitFor(() => expect(link).toHaveBeenCalledWith(1, 77, [], 4, '2026-11-14T12:00:00Z', ['growth_duration_days', 'notes'], contribution));
  });

  it('requires contribution consent only for an explicit public share', async () => {
    setup([candidate], false);
    await waitFor(() => expect(button()).toBeEnabled());
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('public-crop-sync-row-growth_duration_days').querySelector('input[value="mine"]')!);
    expect(button()).toBeDisabled();
    expect(screen.getByRole('link', { name: t('library.publishConfirm.privacyLinkLabel') })).toHaveAttribute('target', '_blank');
    fireEvent.click(screen.getByRole('checkbox', { name: t('library.publishConfirm.acceptLicense') }));
    fireEvent.click(button());
    await waitFor(() => expect(link).toHaveBeenCalledWith(1, 77, [], 4, '2026-11-14T12:00:00Z', ['notes'],
      { pushFields: ['growth_duration_days'], acceptedPublicLibraryTerms: true }));
  });

  it('allows private linking while direct contributions are restricted', async () => {
    const data = (await preview()).data;
    preview.mockResolvedValue({ data: { ...data, requires_moderation: true } });
    setup();
    await waitFor(() => expect(button()).toBeEnabled());
    expect(screen.getByText(t('library.importDecision.shareUnavailable'))).toBeVisible();
    expect(screen.getByTestId('public-crop-sync-row-growth_duration_days').querySelector('input[value="mine"]')).toBeDisabled();
    fireEvent.click(button());
    await waitFor(() => expect(link).toHaveBeenCalledWith(1, 77, ['growth_duration_days'], 4, '2026-11-14T12:00:00Z', ['notes'], contribution));
  });

});
