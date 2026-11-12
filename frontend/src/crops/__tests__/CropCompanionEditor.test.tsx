import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Crop, CropCompanion } from '../../api/types';
import { CropCompanionEditor } from '../CropCompanionEditor';
import { resetPlantFamiliesCache } from '../plantFamilies';

const api = vi.hoisted(() => ({ listForCrop: vi.fn(), replace: vi.fn(), families: vi.fn() }));
vi.mock('../../api/api', async () => ({
  ...await vi.importActual<typeof import('../../api/api')>('../../api/api'),
  cropCompanionAPI: { listForCrop: api.listForCrop, replace: api.replace },
  plantFamilyAPI: { list: api.families },
}));

const crops = [
  { id: 1, name: 'Stored tomato', crop_display_name: 'Tomate', variety: '' },
  { id: 2, name: 'Stored potato', crop_display_name: 'Kartoffel', variety: '' },
  { id: 3, name: 'Basilikum', variety: '' },
] as Crop[];
const pair: CropCompanion = {
  id: 10, crop: 2, companion_crop: 1, companion_family: null, companion_text: '',
  kind: 'bad', reason: 'competition', note: 'Quelle DE', notes: { de: 'Quelle DE', en: 'Source EN' },
};
const open = (crop = crops[0]) => {
  const onClose = vi.fn();
  const onSaved = vi.fn().mockResolvedValue(undefined);
  render(<CropCompanionEditor crop={crop} crops={crops} onClose={onClose} onSaved={onSaved} />);
  return { onClose, onSaved };
};
const editPotato = async () => fireEvent.click(await screen.findByRole('button', { name: 'Kartoffel bearbeiten' }));

describe('CropCompanionEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPlantFamiliesCache();
    api.families.mockResolvedValue({ data: [{ botanical_name: 'Brassicaceae', translations: { de: 'Kreuzblütler' }, default_rotation_break_years: 3 }] });
    api.listForCrop.mockResolvedValue({ data: [pair] });
    api.replace.mockResolvedValue({ data: [] });
  });

  it('starts compact, edits the reciprocal pair on its owner and preserves other note languages', async () => {
    const { onSaved, onClose } = open();
    await screen.findByRole('button', { name: 'Kartoffel bearbeiten' });
    expect(screen.getByText('Gilt für alle Sorten von Tomate.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Nachbar' })).not.toBeInTheDocument();
    await editPotato();
    fireEvent.change(screen.getByRole('textbox', { name: 'Notiz' }), { target: { value: 'Neue Quelle DE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Zu den guten Nachbarn verschieben' }));
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(api.replace).toHaveBeenCalledWith(1, [{
      companion_crop: 2, companion_family: null, companion_text: '', kind: 'good', reason: 'competition', note: 'Neue Quelle DE', note_language_code: 'de', notes: { de: 'Neue Quelle DE' },
    }]));
    expect(onSaved).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('adds a free-text neighbour without modifying existing pairs', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Guten Nachbarn hinzufügen' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Nachbar' }), { target: { value: 'Dill' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(api.replace).toHaveBeenCalledWith(1, expect.arrayContaining([
      expect.objectContaining({ companion_crop: 2, kind: 'bad', note: 'Quelle DE' }),
      expect.objectContaining({ companion_text: 'Dill', kind: 'good' }),
    ])));
  });

  it('prevents a conflicting duplicate across good and bad groups', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Guten Nachbarn hinzufügen' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Nachbar' }), { target: { value: 'Kartoffel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText('Dieser Nachbar ist bereits erfasst.')).toBeInTheDocument();
    expect(api.replace).not.toHaveBeenCalled();
  });

  it('removes the final pair through the same atomic replace operation', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Nachbar entfernen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(api.replace).toHaveBeenCalledWith(1, []));
  });

  it('retains drafts after a save failure and can retry', async () => {
    api.replace.mockRejectedValueOnce(new Error('offline'));
    open();
    await editPotato();
    fireEvent.change(screen.getByRole('textbox', { name: 'Notiz' }), { target: { value: 'Keep this draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText('Die Nachbarn konnten nicht gespeichert werden. Deine Änderungen bleiben erhalten.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Notiz' })).toHaveValue('Keep this draft');
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(api.replace).toHaveBeenCalledTimes(2));
  });

  it('blocks writes after a failed load and retries loading safely', async () => {
    api.listForCrop.mockRejectedValueOnce(new Error('offline'));
    open();
    const alert = await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Guten Nachbarn hinzufügen' })).toBeDisabled();
    fireEvent.click(within(alert).getByRole('button'));
    expect(await screen.findByRole('button', { name: 'Kartoffel bearbeiten' })).toBeInTheDocument();
    expect(api.replace).not.toHaveBeenCalled();
  });

  it('confirms discarding unsaved edits without making any write', async () => {
    const { onClose } = open();
    await editPotato();
    fireEvent.change(screen.getByRole('textbox', { name: 'Notiz' }), { target: { value: 'Unsaved' } });
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(await screen.findByText('Änderungen verwerfen?')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Verwerfen' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(api.replace).not.toHaveBeenCalled();
  });

  it('cannot save a variety as the owner', async () => {
    open({ ...crops[0], variety: 'Roma', general_crop: 1 });
    await screen.findByRole('button', { name: 'Kartoffel bearbeiten' });
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('dialog', { name: 'Mischkultur bearbeiten' }));
    expect(api.replace).not.toHaveBeenCalled();
  });

  it('keeps only the selected row expanded and preserves an informational row verbatim', async () => {
    const prose = 'No specific bad neighbors known — all-rounder';
    api.listForCrop.mockResolvedValue({ data: [pair, { ...pair, id: 11, crop: 1, companion_crop: null, companion_text: prose, reason: 'other', note: '', notes: {} }] });
    open();
    await editPotato();
    fireEvent.click(screen.getByRole('button', { name: `${prose} bearbeiten` }));
    expect(screen.getAllByRole('combobox', { name: 'Nachbar' })).toHaveLength(1);
    expect(screen.getByRole('combobox', { name: 'Nachbar' })).toHaveValue(prose);
    fireEvent.click(screen.getByRole('button', { name: 'Kartoffel bearbeiten' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Notiz' }), { target: { value: 'Updated only this note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(api.replace).toHaveBeenCalledWith(1, expect.arrayContaining([
      expect.objectContaining({ companion_text: prose, kind: 'bad', note: '', reason: 'other' }),
    ])));
  });

  it('adds a whole family using the shared target resolver', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Guten Nachbarn hinzufügen' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Nachbar' }), { target: { value: 'Kreuzblütler' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(api.replace).toHaveBeenCalledWith(1, expect.arrayContaining([
      expect.objectContaining({ companion_family: 'Brassicaceae', companion_crop: null, companion_text: '', kind: 'good' }),
    ])));
  });

  it('refreshes owner and target labels without refetching or losing a note draft', async () => {
    const props = { crop: crops[0], crops, onClose: vi.fn(), onSaved: vi.fn().mockResolvedValue(undefined) };
    const { rerender } = render(<CropCompanionEditor {...props} />);
    await editPotato();
    fireEvent.change(screen.getByRole('textbox', { name: 'Notiz' }), { target: { value: 'Unsaved note' } });
    rerender(<CropCompanionEditor {...props} crops={crops.map(crop => ({
      ...crop, crop_display_name: crop.id === 1 ? 'Updated tomato' : 'Updated potato',
    }))} />);
    expect(screen.getByRole('heading', { name: 'Updated tomato' })).toBeInTheDocument();
    expect(screen.getByText('Gilt für alle Sorten von Updated tomato.')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Nachbar' })).toHaveValue('Updated potato');
    expect(screen.getByRole('textbox', { name: 'Notiz' })).toHaveValue('Unsaved note');
    expect(api.listForCrop).toHaveBeenCalledTimes(1);
  });
});
