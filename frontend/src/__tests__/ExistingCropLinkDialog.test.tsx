import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ExistingCropLinkDialog } from '../crops/ExistingCropLinkDialog';
import type { PublicCrop } from '../api/types';

const { preview, link } = vi.hoisted(() => ({ preview: vi.fn(), link: vi.fn() }));
vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return { ...actual, cropAPI: { ...actual.cropAPI, publicSyncPreview: preview, linkPublicCrop: link } };
});
const publicCrop = { id: 77, name: 'Tomato', variety: '', version: 4 } as PublicCrop;
const candidates = [{ id: 1, name: 'Tomato', variety: '', source_public_crop: null }];

describe('ExistingCropLinkDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    preview.mockResolvedValue({ data: { public_version: 4, changes: [
      { field: 'growth_duration_days', local_value: 90, public_value: 80, pushable: true },
      { field: 'notes', local_value: 'Private notes', public_value: '', pushable: true, pinnable: true },
    ] } });
    link.mockResolvedValue({ data: { id: 1, name: 'Tomato' } });
  });
  it('requires explicit target selection and keeps local values without pushing', async () => {
    const onLinked = vi.fn();
    render(<ExistingCropLinkDialog publicCrop={publicCrop} candidates={candidates} onClose={vi.fn()} onLinked={onLinked} />);
    expect(preview).not.toHaveBeenCalled();
    const button = screen.getByRole('button', { name: 'Verknüpfen und Werte übernehmen' });
    expect(button).toBeDisabled();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Vorhandene Kultur im Projekt' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Tomato' }));
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(link).toHaveBeenCalledWith(1, 77, ['growth_duration_days'], 4, undefined, []));
    expect(onLinked).toHaveBeenCalledWith({ id: 1, name: 'Tomato' });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
  it('sends the permanent local choice separately from fields to pull', async () => {
    render(<ExistingCropLinkDialog publicCrop={publicCrop} candidates={candidates} onClose={vi.fn()} onLinked={vi.fn()} />);
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Vorhandene Kultur im Projekt' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Tomato' }));
    await screen.findByTestId('public-crop-sync-row-notes');
    const notes = screen.getByTestId('public-crop-sync-row-notes');
    fireEvent.click(notes.querySelector('input[value="local"]')!);
    expect(screen.getByTestId('public-crop-sync-local-info')).toBeInTheDocument();
    expect(screen.queryByText('Alle teilen')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Verknüpfen und Werte übernehmen' }));
    await waitFor(() => expect(link).toHaveBeenCalledWith(1, 77, ['growth_duration_days'], 4, undefined, ['notes']));
  });
  it.each([
    ['', true, false],
    ['Roma', true, true],
    ['', false, true],
  ] as const)('offers a new copy for variety=%s, stable match=%s: %s', (variety, speciesMatch, allowed) => {
    const onImportAsNew = vi.fn();
    render(<ExistingCropLinkDialog publicCrop={{ ...publicCrop, variety }}
      candidates={[{ ...candidates[0], variety, species_match: speciesMatch }]}
      onClose={vi.fn()} onLinked={vi.fn()} onImportAsNew={onImportAsNew} />);
    const action = screen.queryByRole('button', { name: 'Als neue Kultur importieren' });
    if (allowed) {
      expect(action).toBeInTheDocument();
      fireEvent.click(action!);
      expect(onImportAsNew).toHaveBeenCalledOnce();
    } else {
      expect(action).not.toBeInTheDocument();
    }
  });
  it('cancels without changing either record', () => {
    const onClose = vi.fn();
    render(<ExistingCropLinkDialog publicCrop={publicCrop} candidates={candidates} onClose={onClose} onLinked={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(link).not.toHaveBeenCalled();
  });
});
