import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
const button = (mode: 'copy' | 'link' = 'copy') => screen.getByRole('button', { name: t(`library.importDecision.${mode}`) });

function setup(candidates = [candidate]) {
  const onLinked = vi.fn();
  const onClose = vi.fn();
  render(<ExistingCropLinkDialog publicCrop={publicCrop} candidates={candidates} onClose={onClose} onLinked={onLinked} />);
  return { onLinked, onClose };
}

describe('ExistingCropLinkDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    preview.mockResolvedValue({ data: { public_version: 4, crop_updated_at: '2026-11-14T12:00:00Z', changes: [
      { field: 'growth_duration_days', local_value: 90, public_value: 80, pushable: true },
      { field: 'notes', local_value: 'Private notes', public_value: '', pushable: true, pinnable: true },
    ] } });
    link.mockResolvedValue({ data: { id: 1, name: 'Tomato' } });
    copy.mockResolvedValue({ data: { id: 1, name: 'Tomato' } });
    importNew.mockResolvedValue({ data: { crop: { id: 3, name: 'Tomato' } } });
  });

  it('explains one stable match and defaults to a one-time copy without publishing', async () => {
    const { onLinked } = setup();
    expect(screen.getByRole('combobox')).toHaveTextContent('Tomato');
    expect(screen.getByText(t('library.importDecision.existing'))).toBeVisible();
    expect(screen.getByText(t('library.importDecision.copyHelp'))).toBeVisible();
    await waitFor(() => expect(button()).toBeEnabled());
    expect(copy).not.toHaveBeenCalled();
    fireEvent.click(button());
    await waitFor(() => expect(copy).toHaveBeenCalledWith(1, 77, ['growth_duration_days'], 4, '2026-11-14T12:00:00Z'));
    expect(onLinked).toHaveBeenCalledWith({ id: 1, name: 'Tomato' });
    expect(link).not.toHaveBeenCalled();
    expect(screen.queryByTestId('public-crop-sync-local-info')).not.toBeInTheDocument();
  });

  it('offers linking with the existing third local-only column and pin behavior', async () => {
    setup();
    fireEvent.click(screen.getByRole('radio', { name: t('library.importDecision.link') }));
    await waitFor(() => expect(button('link')).toBeEnabled());
    const notes = await screen.findByTestId('public-crop-sync-row-notes');
    fireEvent.click(notes.querySelector('input[value="local"]')!);
    expect(screen.getByTestId('public-crop-sync-local-info')).toBeInTheDocument();
    fireEvent.click(button('link'));
    await waitFor(() => expect(link).toHaveBeenCalledWith(1, 77, ['growth_duration_days'], 4, '2026-11-14T12:00:00Z', ['notes']));
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
    await waitFor(() => expect(copy).toHaveBeenCalledWith(2, 77, ['growth_duration_days'], 4, '2026-11-14T12:00:00Z'));
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
    await waitFor(() => expect(importNew).toHaveBeenCalledWith(77, undefined, { linkToLibrary: mode === 'link', baseVersion: 4 }));
    expect(onLinked).toHaveBeenCalledWith({ id: 3, name: 'Tomato' });
    expect(copy).not.toHaveBeenCalled();
  });

  it('explains that an already-linked target keeps its link', () => {
    setup([{ ...candidate, source_public_crop: 77 }]);
    expect(screen.getByText(t('library.importDecision.alreadyLinked'))).toBeVisible();
    expect(button()).toBeDisabled();
    expect(preview).not.toHaveBeenCalled();
  });

  it('keeps the decision open after a stale confirmation and reloads its comparison', async () => {
    copy.mockRejectedValueOnce(new Error('stale'));
    const { onLinked } = setup();
    await waitFor(() => expect(button()).toBeEnabled());
    fireEvent.click(button());
    await screen.findByText(t('library.importDecision.failed'));
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
    expect(onLinked).not.toHaveBeenCalled();
    expect(copy).toHaveBeenCalledTimes(1);
  });

  it('cancels without changing either record', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(link).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
    expect(importNew).not.toHaveBeenCalled();
  });
});
