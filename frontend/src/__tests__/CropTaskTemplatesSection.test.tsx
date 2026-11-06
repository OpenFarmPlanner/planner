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
    await screen.findByText('Beet vorbereiten');
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

  it('shows recurrence settings in the list for count and harvest endings', async () => {
    api.list.mockResolvedValue({ results: [
      { ...template, repeat_interval_days: 7, repeat_until: 'count', repeat_count: 3 },
      { ...template, id: 2, title: 'Mulch prüfen', repeat_interval_days: 30, repeat_until: 'harvest_end' },
    ] });
    render(<CropTaskTemplatesSection cropId={2} />);
    expect(await screen.findByText('Intervall: 7 Tage · 3 Aufgaben')).toBeInTheDocument();
    expect(screen.getByText('Intervall: 30 Tage · Bis Ernte abschließen')).toBeInTheDocument();
  });

  it('disables creation while loading and offers an empty-state Add action afterwards', async () => {
    let resolve!: (value: { results: CropTaskTemplate[] }) => void;
    api.list.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<CropTaskTemplatesSection cropId={2} />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vorlage hinzufügen' })).toBeDisabled();
    resolve({ results: [] });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Vorlage hinzufügen' })).toBeEnabled());
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Vorlage hinzufügen' }));
    expect(screen.getByRole('dialog', { name: 'Vorlage hinzufügen' })).toBeVisible();
  });

  it('validates signed offsets and recurrence limits before writing', async () => {
    render(<CropTaskTemplatesSection cropId={2} />);
    await screen.findByText('Beet vorbereiten');
    fireEvent.click(screen.getByRole('button', { name: 'Vorlage hinzufügen' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByRole('textbox', { name: 'Titel' }), { target: { value: 'Gießen' } });
    fireEvent.change(dialog.getByRole('spinbutton', { name: 'Abstand in Tagen' }), { target: { value: '-3651' } });
    expect(dialog.getByRole('button', { name: 'Speichern' })).toBeDisabled();
    fireEvent.change(dialog.getByRole('spinbutton', { name: 'Abstand in Tagen' }), { target: { value: '-3' } });
    fireEvent.click(dialog.getByRole('checkbox', { name: 'Wiederholen' }));
    fireEvent.change(dialog.getByRole('spinbutton', { name: 'Intervall in Tagen' }), { target: { value: '0' } });
    expect(dialog.getByRole('button', { name: 'Speichern' })).toBeDisabled();
    fireEvent.change(dialog.getByRole('spinbutton', { name: 'Intervall in Tagen' }), { target: { value: '7' } });
    fireEvent.change(dialog.getByRole('spinbutton', { name: 'Anzahl Aufgaben' }), { target: { value: '1001' } });
    expect(dialog.getByRole('button', { name: 'Speichern' })).toBeDisabled();
    expect(api.create).not.toHaveBeenCalled();
  });

});
