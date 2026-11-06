import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CropTaskTemplatesSection } from '../crops/CropTaskTemplatesSection';
import type { CropTaskTemplate } from '../api/types';

const api = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() }));
vi.mock('../api/api', () => ({ cropTaskTemplateAPI: api }));
const template: CropTaskTemplate = { id: 1, project: 1, crop: 2, title: 'Beet vorbereiten', description: 'Werkzeug prüfen', reference_event: 'planting', day_offset: -3 };

describe('CropTaskTemplatesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue({ results: [template] });
    api.create.mockImplementation(async (data) => ({ data: { ...data, id: 3, project: 1 } }));
    api.update.mockImplementation(async (id, data) => ({ data: { ...data, id, project: 1 } }));
    api.delete.mockResolvedValue({});
  });
  it('loads crop-scoped templates and saves a signed offset independently', async () => {
    render(<CropTaskTemplatesSection cropId={2} />);
    expect(await screen.findByText('Beet vorbereiten')).toBeInTheDocument();
    expect(api.list).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByRole('button', { name: 'Vorlage hinzufügen' }));
    const dialog = screen.getByRole('dialog', { name: 'Vorlage hinzufügen' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Titel' }), { target: { value: 'Abdecken' } });
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Abstand in Tagen' }), { target: { value: '-5' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText('Abdecken')).toBeInTheDocument();
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ crop: 2, day_offset: -5 }));
  });
  it('retains edits on failure and requires explicit confirmation for deletion', async () => {
    api.update.mockRejectedValue(new Error('offline'));
    render(<CropTaskTemplatesSection cropId={2} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Vorlage bearbeiten: Beet vorbereiten' }));
    const dialog = screen.getByRole('dialog', { name: 'Vorlage bearbeiten' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Titel' }), { target: { value: 'Entwurf' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Die Vorlage konnte nicht gespeichert werden.');
    expect(within(dialog).getByRole('textbox', { name: 'Titel' })).toHaveValue('Entwurf');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Vorlage löschen: Beet vorbereiten' }));
    expect(api.delete).not.toHaveBeenCalled();
    const confirmation = screen.getByRole('dialog');
    expect(within(confirmation).getByRole('button', { name: 'Abbrechen' })).toHaveFocus();
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(screen.queryByText('Beet vorbereiten')).not.toBeInTheDocument());
  });
  it('keeps a template after failed deletion and retries failed loading', async () => {
    api.list.mockRejectedValueOnce(new Error('offline'));
    api.delete.mockRejectedValue(new Error('offline'));
    render(<CropTaskTemplatesSection cropId={2} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Erneut versuchen' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Vorlage löschen: Beet vorbereiten' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Löschen' }));
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Beet vorbereiten')).toBeInTheDocument();
  });
  it('saves recurring rules with a bounded count and omits count for event endings', async () => {
    render(<CropTaskTemplatesSection cropId={2} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Vorlage hinzufügen' }));
    const dialog = screen.getByRole('dialog', { name: 'Vorlage hinzufügen' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Titel' }), { target: { value: 'Gießen' } });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Wiederholen' }));
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Intervall in Tagen' }), { target: { value: '5' } });
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Anzahl Aufgaben' }), { target: { value: '4' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(api.create).toHaveBeenCalledWith(expect.objectContaining({
      repeat_interval_days: 5, repeat_until: 'count', repeat_count: 4,
    })));
  });

});
